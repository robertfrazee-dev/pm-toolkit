// "Best of Manhattan" boards and the daily This or That game.
// GET  /api/boards?op=boards&me=PID            every board with its current #1, plus my streak
// GET  /api/boards?op=board&slug=pizza&hood=…   a board's top 10 and what's rising this week
// GET  /api/boards?op=play&me=PID&day=YYYY-MM-DD  today's 5 matchups
// POST /api/boards { op: "vote", me, day, i, pick: "a"|"b" }
// GET  /api/boards?op=search&q=joe              find a place in the Manhattan list (to nominate it)
// POST /api/boards { op: "nominate", me, slug, id }
// POST /api/boards { op: "build", part } / { op: "finish" }  owner only (x-stats-key): pull Manhattan from OpenStreetMap
// Rankings: each place has a chess-style rating from votes, plus points for being picked by real groups in decks
// (a group win counts most). A place needs 5 votes or one group win before it gets an official rank.
import { PLAYER_RE, redis, pipeline, hashToObject, send, body, clientIp, allow, missingConfig, bump } from "./_lib.js";
import { BOARDS, boardBySlug, PARTS, NEIGHBORHOODS, fromOsm, savePart, finishBuild, catalog, matchPlace, kindLabel, mapsUrl } from "./_nyc.js";

const START = 1500, MIN_VOTES = 5, PER_DAY = 5;
const GROUP_POINTS = { yes: 1, match: 6, win: 20 };
const week = (t = Date.now()) => Math.floor(t / (7 * 864e5));
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const view = (p) => p && { id: p.id, name: p.n, hood: p.hood, kind: kindLabel(p), addr: p.addr, maps: mapsUrl(p), lat: p.lat, lng: p.lng, web: p.web };

// ---------- group picks from decks ----------
// Decks queue what happened to Manhattan places (yes, made the final vote, won); here they're matched to the list.
async function drainQueue() {
  const items = await redis("LRANGE", "nyc:queue", 0, 299);
  if (!items?.length) return;
  await redis("LTRIM", "nyc:queue", items.length, -1);
  const cmds = [];
  for (const raw of items) {
    let ev; try { ev = JSON.parse(raw); } catch { continue; }
    const p = await matchPlace(ev); if (!p) continue;
    cmds.push(["HINCRBY", `nyc:grp:${p.id}`, ev.field, ev.n]);
    const boards = BOARDS.filter((b) => b.test(p));
    // Google knows sports bars better than the map does: a group pick of one puts it on the board.
    if (/sports/i.test(ev.kind || "") && !boards.includes(boardBySlug["sports-bars"])) { boards.push(boardBySlug["sports-bars"]); cmds.push(["SADD", "bd:sports-bars:extra", p.id]); }
    for (const b of boards) cmds.push(["ZINCRBY", `bd:${b.slug}:grp`, GROUP_POINTS[ev.field] * ev.n, p.id]);
  }
  if (cmds.length) await pipeline(cmds);
}

// ---------- rankings ----------
async function pool(slug) {
  const c = await catalog();
  const extra = (await redis("SMEMBERS", `bd:${slug}:extra`)) || [];
  return new Set([...(c.pools[slug] || []), ...extra.filter((id) => c.byId.has(id))]);
}
async function ranked(slug, hood = "", limit = 10) {
  const c = await catalog(), inPool = await pool(slug);
  const [eloFlat, grpFlat, wkFlat] = await pipeline([["ZREVRANGE", `bd:${slug}:elo`, 0, 299, "WITHSCORES"], ["ZREVRANGE", `bd:${slug}:grp`, 0, 99, "WITHSCORES"], ["ZREVRANGE", `bd:${slug}:wk:${week()}`, 0, 19, "WITHSCORES"]]);
  const pairs = (f) => { const o = {}; for (let i = 0; i + 1 < (f || []).length; i += 2) o[f[i]] = Number(f[i + 1]); return o; };
  const elo = pairs(eloFlat), grp = pairs(grpFlat), wk = pairs(wkFlat);
  const ids = [...new Set([...Object.keys(elo), ...Object.keys(grp)])].filter((id) => inPool.has(id) && (!hood || c.byId.get(id)?.hood === hood));
  const rows = await pipeline([...ids.map((id) => ["HGET", `bd:${slug}:n`, id]), ...ids.map((id) => ["HGETALL", `nyc:grp:${id}`])]);
  const list = ids.map((id, i) => {
    const votes = Number(rows[i]) || 0, g = Object.fromEntries(Object.entries(hashToObject(rows[ids.length + i])).map(([k, v]) => [k, Number(v) || 0]));
    const wins = Math.max(0, g.win || 0), matches = Math.max(0, g.match || 0);
    return { ...view(c.byId.get(id)), votes, wins, matches, score: Math.round((elo[id] ?? START) + Math.min(150, (grp[id] || 0))), eligible: votes >= MIN_VOTES || wins >= 1 };
  }).sort((a, b) => b.score - a.score);
  const top = list.filter((x) => x.eligible).slice(0, limit);
  const rising = Object.entries(wk).filter(([id]) => inPool.has(id) && (!hood || c.byId.get(id)?.hood === hood)).slice(0, 5).map(([id, n]) => ({ ...view(c.byId.get(id)), weekWins: n }));
  return { top, rising, pool: inPool.size, unranked: list.filter((x) => !x.eligible).length };
}

// ---------- This or That ----------
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
async function makePair(slug) {
  const ids = [...(await pool(slug))];
  if (ids.length < 4) return null;
  const top = ((await redis("ZREVRANGE", `bd:${slug}:elo`, 0, 39)) || []).filter((id) => ids.includes(id));
  const a = top.length && Math.random() < 0.6 ? pick(top) : pick(ids);
  const others = Array.from({ length: 14 }, () => pick(ids)).filter((id) => id !== a);
  if (!others.length) return null;
  const scores = await pipeline([a, ...others].map((id) => ["ZSCORE", `bd:${slug}:elo`, id]));
  const ra = Number(scores[0]) || START;
  // Mostly a close match (that's what moves rankings); sometimes a place nobody's voted on yet.
  const unrated = others.filter((_, i) => scores[i + 1] == null);
  const b = unrated.length && Math.random() < 0.35 ? pick(unrated) : others.map((id, i) => [id, Math.abs((Number(scores[i + 1]) || START) - ra)]).sort((x, y) => x[1] - y[1])[0][0];
  return { slug, a, b };
}
async function todays(me, day) {
  const key = `tt:${me}:${day}`;
  let rows = Object.entries(hashToObject(await redis("HGETALL", key))).sort((x, y) => x[0] - y[0]).map(([, v]) => v);
  if (!rows.length) {
    const c = await catalog();
    // Featured boards first, mixed up, each board at most once a day.
    const boards = BOARDS.filter((b) => (c.pools[b.slug] || []).length >= 4).sort((x, y) => (y.featured - x.featured) || Math.random() - 0.5);
    const chosen = [...boards.filter((b) => b.featured).sort(() => Math.random() - 0.5), ...boards.filter((b) => !b.featured).sort(() => Math.random() - 0.5)].slice(0, PER_DAY);
    for (const b of chosen) { const m = await makePair(b.slug); if (m) rows.push(m); }
    if (rows.length) await pipeline([...rows.map((r, i) => ["HSET", key, String(i), JSON.stringify(r)]), ["EXPIRE", key, 3 * 86400]]);
  }
  return rows;
}
async function play(res, q) {
  const me = q.get("me") || "", day = q.get("day") || "";
  if (!PLAYER_RE.test(me) || !DAY_RE.test(day)) return send(res, 400, { error: "Bad request." });
  const c = await catalog();
  if (!c.places.length) return send(res, 200, { matchups: [], ready: false });
  const rows = await todays(me, day);
  const streak = JSON.parse((await redis("GET", `streak:${me}`)) || "null");
  return send(res, 200, {
    ready: true, streak: streak ? { n: streak.last === day || streak.last === yesterday(day) ? streak.n : 0, best: streak.best } : { n: 0, best: 0 },
    matchups: rows.map((r, i) => ({ i, slug: r.slug, title: boardBySlug[r.slug].title, emoji: boardBySlug[r.slug].emoji, noun: boardBySlug[r.slug].noun, a: view(c.byId.get(r.a)), b: view(c.byId.get(r.b)), pick: r.pick || null, split: r.split || null })),
  });
}
const yesterday = (day) => new Date(Date.parse(day + "T12:00:00Z") - 864e5).toISOString().slice(0, 10);
async function vote(req, res, b) {
  const me = String(b.me || ""), day = String(b.day || ""), i = Math.round(Number(b.i));
  if (!PLAYER_RE.test(me) || !DAY_RE.test(day) || !["a", "b"].includes(b.pick)) return send(res, 400, { error: "Bad vote." });
  if (Math.abs(Date.parse(day + "T12:00:00Z") - Date.now()) > 2 * 864e5) return send(res, 400, { error: "That day's over." });
  if (!(await allow(`rl:tt:${clientIp(req)}`, 120, 86400))) return send(res, 429, { error: "That's a lot of votes for one day. Come back tomorrow." });
  const key = `tt:${me}:${day}`;
  const row = JSON.parse((await redis("HGET", key, String(i))) || "null");
  if (!row) return send(res, 404, { error: "That matchup isn't yours." });
  if (row.pick) return send(res, 200, { split: row.split, already: true });
  const { slug, a, b: bb } = row, win = b.pick === "a" ? a : bb, lose = b.pick === "a" ? bb : a;
  const [rw, rl, nw, nl] = await pipeline([["ZSCORE", `bd:${slug}:elo`, win], ["ZSCORE", `bd:${slug}:elo`, lose], ["HGET", `bd:${slug}:n`, win], ["HGET", `bd:${slug}:n`, lose]]);
  const Rw = Number(rw) || START, Rl = Number(rl) || START, ew = 1 / (1 + 10 ** ((Rl - Rw) / 400));
  const k = (n) => ((Number(n) || 0) < 10 ? 32 : 20);
  const pairKey = `pair:${slug}:${[a, bb].sort().join("|")}`;
  const res2 = await pipeline([
    ["ZADD", `bd:${slug}:elo`, Math.round(Rw + k(nw) * (1 - ew)), win], ["ZADD", `bd:${slug}:elo`, Math.round(Rl - k(nl) * (1 - ew)), lose],
    ["HINCRBY", `bd:${slug}:n`, win, 1], ["HINCRBY", `bd:${slug}:n`, lose, 1],
    ["ZINCRBY", `bd:${slug}:wk:${week()}`, 1, win], ["EXPIRE", `bd:${slug}:wk:${week()}`, 21 * 86400],
    ["HINCRBY", pairKey, win, 1], ["HGETALL", pairKey],
  ]);
  const counts = hashToObject(res2[7]), total = (Number(counts[a]) || 0) + (Number(counts[bb]) || 0);
  const split = { a: Math.round(((Number(counts[a]) || 0) / total) * 100), b: Math.round(((Number(counts[bb]) || 0) / total) * 100), votes: total };
  await redis("HSET", key, String(i), JSON.stringify({ ...row, pick: b.pick, split }));
  // Streak: the first vote of a day keeps it going (or starts it).
  const st = JSON.parse((await redis("GET", `streak:${me}`)) || "null") || { n: 0, best: 0, last: "" };
  if (st.last !== day) { st.n = st.last === yesterday(day) ? st.n + 1 : 1; st.best = Math.max(st.best, st.n); st.last = day; await redis("SET", `streak:${me}`, JSON.stringify(st), "EX", 400 * 86400); }
  const rank = await redis("ZREVRANK", `bd:${slug}:elo`, win);
  await bump("tt_votes");
  return send(res, 200, { split, rank: rank == null ? null : rank + 1, streak: st.n });
}

// ---------- boards ----------
async function boards(res, q) {
  const c = await catalog();
  const out = [];
  for (const b of BOARDS) {
    const size = (c.pools[b.slug] || []).length;
    const { top } = size ? await ranked(b.slug, "", 1) : { top: [] };
    out.push({ slug: b.slug, title: b.title, emoji: b.emoji, featured: !!b.featured, size, first: top[0] ? { name: top[0].name, hood: top[0].hood } : null });
  }
  return send(res, 200, { boards: out, ready: c.places.length > 0, builtAt: c.meta?.builtAt || null, neighborhoods: NEIGHBORHOODS });
}
async function board(res, q) {
  const b = boardBySlug[q.get("slug")];
  if (!b) return send(res, 404, { error: "No such board." });
  const hood = NEIGHBORHOODS.includes(q.get("hood")) ? q.get("hood") : "";
  return send(res, 200, { board: { slug: b.slug, title: b.title, emoji: b.emoji, noun: b.noun }, hood, ...(await ranked(b.slug, hood)) });
}
async function search(res, q) {
  const s = String(q.get("q") || "").toLowerCase().trim(); if (s.length < 2) return send(res, 200, { places: [] });
  const c = await catalog();
  const hits = c.places.filter((p) => p.n.toLowerCase().includes(s)).sort((x, y) => x.n.toLowerCase().indexOf(s) - y.n.toLowerCase().indexOf(s) || x.n.length - y.n.length).slice(0, 8);
  return send(res, 200, { places: hits.map(view) });
}
async function nominate(req, res, b) {
  const board = boardBySlug[b.slug]; const c = await catalog();
  if (!board || !c.byId.has(b.id) || !PLAYER_RE.test(String(b.me || ""))) return send(res, 400, { error: "Bad nomination." });
  if (!(await allow(`rl:nom:${clientIp(req)}`, 20, 86400))) return send(res, 429, { error: "That's plenty of nominations for today." });
  await redis("SADD", `bd:${board.slug}:extra`, b.id);
  await bump("nominations");
  return send(res, 200, { ok: true });
}

// ---------- building the list (owner only) ----------
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
async function build(req, res, b) {
  if (!process.env.STATS_KEY || req.headers["x-stats-key"] !== process.env.STATS_KEY) return send(res, 401, { error: "Wrong key." });
  if (b.op === "finish") return send(res, 200, await finishBuild());
  const part = Math.round(Number(b.part));
  if (!(part >= 0 && part < PARTS.length)) return send(res, 400, { error: "Bad part." });
  let json = null, lastErr = "";
  for (const url of process.env.OVERPASS_URL ? [process.env.OVERPASS_URL] : OVERPASS) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Matchbook (Best of Manhattan)" }, body: "data=" + encodeURIComponent(PARTS[part]) });
      if (r.ok) { json = await r.json(); break; }
      lastErr = `${r.status}`;
    } catch (e) { lastErr = e.message; }
  }
  if (!json) return send(res, 502, { error: `OpenStreetMap didn't answer (${lastErr}). Try that part again in a minute.` });
  const places = (json.elements || []).map(fromOsm).filter(Boolean);
  await savePart(part, places);
  return send(res, 200, { part, parts: PARTS.length, places: places.length });
}

export default async function handler(req, res) {
  if (missingConfig().length) return send(res, 503, { error: "Not set up." });
  try {
    if (req.method === "GET") {
      const q = new URL(req.url, "http://x").searchParams, op = q.get("op");
      await drainQueue().catch((e) => console.error("queue", e));
      if (op === "boards") return await boards(res, q);
      if (op === "board") return await board(res, q);
      if (op === "play") return await play(res, q);
      if (op === "search") return await search(res, q);
      if (op === "status") { const c = await catalog(); return send(res, 200, { parts: PARTS.length, places: c.places.length, builtAt: c.meta?.builtAt || null }); }
      return send(res, 404, { error: "Unknown." });
    }
    if (req.method !== "POST") return send(res, 405, { error: "Use GET or POST." });
    const b = body(req);
    if (b.op === "vote") return await vote(req, res, b);
    if (b.op === "nominate") return await nominate(req, res, b);
    if (b.op === "build" || b.op === "finish") return await build(req, res, b);
    return send(res, 400, { error: "Unknown." });
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: "Couldn't load the boards. Try again in a minute." });
  }
}
