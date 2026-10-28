// Product analytics: one record per event (who, which deck, which crew, when), plus a lasting record of each
// session's people so "groups" can be measured after decks expire (decks only live a week).
// A group is a crew, or 2+ players who shared a deck; sessions join the same group when they share a crew or 2+ players.
import { pipeline, today } from "./_lib.js";

export const EVENTS = ["session_created", "link_opened", "joined", "swiped", "matched", "revealed", "checked_in", "rated", "same_crew", "tab_started", "tab_opened", "tab_split", "tab_paid", "rsvp"];
const KEEP = 120 * 86400;

// Never throws: analytics must not break the app.
export async function track(e, { pid = "", code = "", crew = "", n = 1 } = {}) {
  if (!EVENTS.includes(e) || !n) return;
  const at = Date.now(), day = today();
  const cmds = [
    ["LPUSH", `ev:${day}`, JSON.stringify({ e, pid, code, crew, n, at })], ["LTRIM", `ev:${day}`, 0, 99999], ["EXPIRE", `ev:${day}`, KEEP],
    ["HINCRBY", `stats:day:${day}`, `ev_${e}`, n],
  ];
  if (code) {
    cmds.push(["EXPIRE", `mx:s:${code}`, KEEP], ["EXPIRE", `mx:p:${code}`, KEEP]);
    if (e === "session_created") cmds.push(["HSET", `mx:s:${code}`, "at", at, "crew", crew || ""], ["ZADD", "mx:sessions", at, code], ["EXPIRE", "mx:sessions", KEEP]);
    if (pid && (e === "session_created" || e === "joined")) cmds.push(["SADD", `mx:p:${code}`, pid]);
    if (e === "swiped") cmds.push(["HINCRBY", `mx:s:${code}`, "swipes", n]);
    if (e === "matched") cmds.push(["HINCRBY", `mx:s:${code}`, "matches", n]);
    if (e === "revealed") cmds.push(["HSET", `mx:s:${code}`, "revealed", at]);
    if ((e === "joined" || e === "same_crew") && crew) cmds.push(["HSET", `mx:s:${code}`, "crew", crew]); // a deck saved as a crew counts as that crew
  }
  try { await pipeline(cmds); } catch (err) { console.error("track", e, err); }
}

// ---------- metrics ----------
const DAY = 864e5, WEEK = 7 * DAY;
// Sessions with their people, from the last `days` days.
export async function sessions(days = 120) {
  const flat = await pipeline([["ZREVRANGE", "mx:sessions", 0, 4999, "WITHSCORES"]]);
  const since = Date.now() - days * DAY, codes = [];
  for (let i = 0; i + 1 < (flat[0] || []).length; i += 2) if (Number(flat[0][i + 1]) >= since) codes.push(flat[0][i]);
  if (!codes.length) return [];
  const rows = await pipeline(codes.flatMap((c) => [["HGETALL", `mx:s:${c}`], ["SMEMBERS", `mx:p:${c}`]]));
  return codes.map((code, i) => {
    const h = {}, f = rows[i * 2] || []; for (let k = 0; k + 1 < f.length; k += 2) h[f[k]] = f[k + 1];
    return { code, at: Number(h.at) || 0, crew: h.crew || "", swipes: Number(h.swipes) || 0, matches: Number(h.matches) || 0, revealed: !!h.revealed, people: rows[i * 2 + 1] || [] };
  }).filter((s) => s.at);
}

// Groups: union sessions that share a crew or share 2+ players. Only sessions with a crew or 2+ people count.
export function groupsOf(list) {
  const ss = list.filter((s) => s.crew || s.people.length >= 2).sort((a, b) => a.at - b.at);
  const parent = ss.map((_, i) => i), find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i]))), join = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };
  const byKey = new Map();
  ss.forEach((s, i) => {
    const keys = [];
    if (s.crew) keys.push(`c:${s.crew}`);
    const p = [...s.people].sort();
    for (let a = 0; a < p.length; a++) for (let b = a + 1; b < p.length; b++) keys.push(`p:${p[a]}|${p[b]}`);
    for (const k of keys) { if (byKey.has(k)) join(byKey.get(k), i); else byKey.set(k, i); }
  });
  const groups = new Map();
  ss.forEach((s, i) => { const r = find(i); (groups.get(r) || groups.set(r, []).get(r)).push(s); });
  return [...groups.values()].map((sessions) => ({ sessions: sessions.sort((a, b) => a.at - b.at), first: sessions[0].at, crew: sessions.find((s) => s.crew)?.crew || "" }));
}

export function metrics(list, now = Date.now()) {
  const groups = groupsOf(list);
  const weekStart = (t) => { const d = new Date(t); d.setUTCHours(0, 0, 0, 0); return d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY; }; // Monday
  const thisWeek = weekStart(now), weeks = Array.from({ length: 8 }, (_, i) => thisWeek - (7 - i) * WEEK);
  const weekly = weeks.map((w) => ({
    week: new Date(w).toISOString().slice(0, 10),
    created: groups.filter((g) => g.first >= w && g.first < w + WEEK).length,
    active: groups.filter((g) => g.sessions.some((s) => s.at >= w && s.at < w + WEEK)).length,
  }));
  // 2nd outing within 14 days: of groups whose first session is at least 14 days old, how many had another by day 14.
  const eligible = groups.filter((g) => now - g.first >= 14 * DAY);
  const returned = eligible.filter((g) => g.sessions.some((s) => s.at > g.first && s.at - g.first <= 14 * DAY));
  const pending = groups.filter((g) => now - g.first < 14 * DAY);
  const pendingBack = pending.filter((g) => g.sessions.length > 1);
  const recent = list.filter((s) => now - s.at <= 30 * DAY), sw = recent.reduce((a, s) => a + s.swipes, 0), mt = recent.reduce((a, s) => a + s.matches, 0);
  return {
    groups: groups.length, crewGroups: groups.filter((g) => g.crew).length,
    createdLast7: groups.filter((g) => now - g.first <= 7 * DAY).length, createdLast30: groups.filter((g) => now - g.first <= 30 * DAY).length,
    activeThisWeek: weekly.at(-1).active, weekly,
    secondOuting: { eligible: eligible.length, returned: returned.length, pct: eligible.length ? Math.round((returned.length / eligible.length) * 100) : null, pending: pending.length, pendingBack: pendingBack.length },
    swipesToMatch: { swipes: sw, matches: mt, ratio: mt ? Math.round((sw / mt) * 10) / 10 : null },
    sessions: list.length,
  };
}
