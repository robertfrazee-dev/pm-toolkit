// Crews: a group that decides together again and again (your group chat, saved).
// A crew keeps a short summary of every deck it finishes, so its stats outlive the decks (which expire after a week).
// People are matched by name within a crew, so someone who joined from two browsers still counts as one person.
import { redis, pipeline, bump } from "./_lib.js";
import { BOARDS, matchPlace } from "./_nyc.js";

export const CREW_RE = /^[A-Z0-9]{8}$/;
const KEEP = 400 * 86400;
export const CREW_WIN = 5; // a crew night's winner, on the crew's own boards (one vote counts 1)
const CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const personKey = (name) => String(name || "").trim().toLowerCase().replace(/\s+/g, " ").slice(0, 30);

export async function getCrew(id) {
  if (!CREW_RE.test(id || "")) return null;
  const raw = await redis("GET", `crew:${id}`);
  return raw ? JSON.parse(raw) : null;
}
export const saveCrew = (crew) => redis("SET", `crew:${crew.id}`, JSON.stringify(crew), "EX", KEEP);

export async function newCrewId() {
  for (let t = 0; t < 5; t++) {
    let id = ""; for (let i = 0; i < 8; i++) id += CHARS[Math.floor(Math.random() * CHARS.length)];
    if (!(await redis("GET", `crew:${id}`))) return id;
  }
  throw new Error("Couldn't make a crew id.");
}

// Adds (or refreshes) a member. Returns true if the crew changed.
export function addMember(crew, pid, name) {
  const k = personKey(name); if (!k) return false;
  const m = crew.members[k] || { name: String(name).trim().slice(0, 30), pids: [], joinedAt: Date.now() };
  const isNew = !crew.members[k] || !m.pids.includes(pid);
  if (!m.pids.includes(pid)) m.pids = [...m.pids, pid].slice(-6);
  crew.members[k] = m;
  return isNew;
}
export const memberPids = (crew) => [...new Set(Object.values(crew.members).flatMap((m) => m.pids))];
export const isMember = (crew, pid) => Object.values(crew.members).some((m) => m.pids.includes(pid));

// What a finished deck adds to its crew's history: places, the winner, and each person's yeses and ranking (by place index).
export async function recordCrewDeck(code, deck, winner, swipes, ranks) {
  if (!deck.crew) return;
  if ((await redis("SET", `crewdeck:${code}`, "1", "EX", KEEP, "NX")) !== "OK") return; // once per deck
  const crew = await getCrew(deck.crew); if (!crew) return;
  const idx = Object.fromEntries(deck.places.map((p, i) => [p.id, i]));
  const people = {};
  for (const [pid, s] of Object.entries(swipes)) {
    const k = personKey(s.name); if (!k) continue;
    people[k] = { name: s.name, likes: (s.likes || []).map((id) => idx[id]).filter((i) => i != null), passes: (s.passes || []).map((id) => idx[id]).filter((i) => i != null) };
    addMember(crew, pid, s.name);
  }
  for (const [pid, r] of Object.entries(ranks)) {
    const k = personKey(r.name); if (!k) continue;
    (people[k] ||= { name: r.name, likes: [], passes: [] }).order = (r.order || []).map((id) => idx[id]).filter((i) => i != null);
    addMember(crew, pid, r.name);
  }
  const entry = {
    code, at: Date.now(), label: deck.label, area: deck.category === "saved" ? "" : deck.area,
    places: deck.places.map((p) => ({ name: p.name, maps: p.maps || "", gid: p.gid || "" })),
    matches: (deck.matches || []).map((id) => idx[id]).filter((i) => i != null),
    winner: winner ? idx[winner.id] : null, people,
  };
  if (crew.liveCode === code) crew.liveCode = null;
  crew.lastAt = entry.at; crew.decks = (crew.decks || 0) + 1;
  await pipeline([["LPUSH", `crew:${crew.id}:history`, JSON.stringify(entry)], ["LTRIM", `crew:${crew.id}:history`, 0, 99], ["EXPIRE", `crew:${crew.id}:history`, KEEP]]);
  await saveCrew(crew);
  // The night's winner counts big on the crew's own boards (when it's a place on the NYC list).
  if (winner) {
    try {
      const p = await matchPlace({ name: winner.name, lat: winner.lat, lng: winner.lng });
      if (p) await pipeline(BOARDS.filter((b) => b.test(p)).flatMap((b) => [["ZINCRBY", `crewbd:${crew.id}:${b.slug}`, CREW_WIN, p.id], ["EXPIRE", `crewbd:${crew.id}:${b.slug}`, KEEP]]));
    } catch (e) { console.error("crew board", e); }
  }
  await bump("crew_decks");
}

// Bragging rights, worked out from the crew's history.
export function crewStats(history, crew) {
  const nameOf = (k) => crew.members[k]?.name || history.find((h) => h.people[k])?.people[k].name || k;
  const picker = {}, yes = {}, winners = {}, almost = {};
  const pairs = {};
  for (const h of history) {
    const keys = Object.keys(h.people);
    for (const k of keys) {
      const p = h.people[k];
      if (p.order?.length && h.winner != null) {
        const s = (picker[k] ||= { won: 0, ranked: 0, posSum: 0 });
        s.ranked++; if (p.order[0] === h.winner) s.won++;
        const pos = p.order.indexOf(h.winner); if (pos >= 0) s.posSum += pos + 1;
      }
      const seen = p.likes.length + p.passes.length;
      if (seen) { const y = (yes[k] ||= { yes: 0, seen: 0 }); y.yes += p.likes.length; y.seen += seen; }
    }
    // How often two people made the same call on the same card.
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
      const a = h.people[keys[i]], b = h.people[keys[j]];
      const decided = (x) => new Map([...x.likes.map((n) => [n, 1]), ...x.passes.map((n) => [n, 0])]);
      const da = decided(a), db = decided(b);
      let both = 0, same = 0;
      for (const [n, v] of da) if (db.has(n)) { both++; if (db.get(n) === v) same++; }
      if (!both) continue;
      const key = [keys[i], keys[j]].sort().join("|");
      const pr = (pairs[key] ||= { both: 0, same: 0 }); pr.both += both; pr.same += same;
    }
    if (h.winner != null) { const w = h.places[h.winner]; const wk = w.gid || w.name; (winners[wk] ||= { ...w, n: 0 }).n++; }
    // Places a lot of the crew said yes to that didn't win: candidates for next time.
    const votes = {};
    for (const p of Object.values(h.people)) for (const n of p.likes) votes[n] = (votes[n] || 0) + 1;
    for (const [n, v] of Object.entries(votes)) {
      if (+n === h.winner || v < 2) continue;
      const pl = h.places[n]; const pk = pl.gid || pl.name;
      const a = (almost[pk] ||= { ...pl, yes: 0, decks: 0 }); a.yes += v; a.decks++;
    }
  }
  const wonNames = new Set(Object.values(winners).map((w) => w.gid || w.name));
  const pairList = Object.entries(pairs).filter(([, p]) => p.both >= 5).map(([k, p]) => ({ a: nameOf(k.split("|")[0]), b: nameOf(k.split("|")[1]), keys: k.split("|"), pct: Math.round((p.same / p.both) * 100) })).sort((x, y) => y.pct - x.pct);
  const avgSync = {};
  for (const p of pairList) for (const k of p.keys) (avgSync[k] ||= []).push(p.pct);
  const syncList = Object.entries(avgSync).filter(([, v]) => v.length >= 2).map(([k, v]) => ({ name: nameOf(k), pct: Math.round(v.reduce((a, b) => a + b, 0) / v.length) })).sort((a, b) => a.pct - b.pct);
  const yesList = Object.entries(yes).filter(([, y]) => y.seen >= 8).map(([k, y]) => ({ name: nameOf(k), pct: Math.round((y.yes / y.seen) * 100) })).sort((a, b) => b.pct - a.pct);
  return {
    decks: history.length,
    bestPickers: Object.entries(picker).map(([k, s]) => ({ name: nameOf(k), won: s.won, ranked: s.ranked, avgPos: s.ranked ? Math.round((s.posSum / s.ranked) * 10) / 10 : null })).sort((a, b) => b.won / b.ranked - a.won / a.ranked || b.won - a.won || a.avgPos - b.avgPos),
    inSync: pairList.slice(0, 3),
    wildCard: syncList.length >= 3 ? syncList[0] : null,
    easiest: yesList.length >= 2 ? yesList[0] : null,
    hardest: yesList.length >= 2 ? yesList.at(-1) : null,
    mostPicked: Object.values(winners).sort((a, b) => b.n - a.n).slice(0, 3),
    nextTime: Object.values(almost).filter((a) => !wonNames.has(a.gid || a.name)).sort((a, b) => b.yes - a.yes).slice(0, 5),
  };
}
