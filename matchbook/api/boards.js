// "Best of NYC" boards and the games that rank them.
// GET  /api/boards?op=boards&me=PID[&lat&lng&mi]          every board (in sections) with its #1, near me or all NYC
// GET  /api/boards?op=board&slug=pizza&me=PID[&hood|&lat&lng&mi]  a board's top 10, rising, my champ, my crews' top 3
// GET  /api/boards?op=play&me=PID&day=YYYY-MM-DD          This or That: today's 5 matchups
// POST /api/boards { op: "vote", me, day, i, pick: "a"|"b" }
// GET  /api/boards?op=hill&me&slug[&lat&lng&mi][&fresh=1] King of the Hill: the champ stays until something beats it
// POST /api/boards { op: "hillvote", me, slug, pick: "champ"|"chal" }
// GET  /api/boards?op=bracket&me&slug                     my bracket on a board (if one's going)
// POST /api/boards { op: "bracket", me, slug, size: 8|16, lat?, lng?, mi? }  start a bracket, seeded by rank
// POST /api/boards { op: "bracketvote", me, slug, m, pick: "a"|"b" }
// GET  /api/boards?op=crew&crew=ID                        a crew's own top 3 on every board
// GET  /api/boards?op=search&q=joe                        find a place in the NYC list (to nominate it)
// POST /api/boards { op: "nominate", me, slug, id }
// GET  /api/boards?op=nearby&me&lat&lng                 places on the list close enough to check in at
// POST /api/boards { op: "checkin", me, name, id, lat, lng, tell }  check in (you have to be there); tells your crews
// GET  /api/boards?op=mine&me=PID                         your points, weekly streak, spots and recent check-ins
// GET  /api/boards?op=tonight[&lat&lng&mi]                anonymous: where people are out tonight
// POST /api/boards { op: "build", part } / { op: "finish" }  owner only (x-stats-key): pull NYC from OpenStreetMap
// Rankings: each place has a chess-style rating from every head-to-head vote (all three games), plus points for being
// picked by real groups in decks (a group win counts most). A place needs 5 votes or one group win for an official rank.
// Each vote also counts on the voter's crews' own boards, so every crew has its own top 3.
import { PLAYER_RE, redis, pipeline, hashToObject, send, body, clientIp, allow, missingConfig, bump, cleanName } from "./_lib.js";
import { checkIn, CheckinError, myStats, tonight, tonightCounts, VERIFY_M } from "./_checkin.js";
import { BOARDS, SECTIONS, boardBySlug, PARTS, NEIGHBORHOODS, fromOsm, savePart, finishBuild, catalog, matchPlace, kindLabel, mapsUrl, milesBetween, nearbyPlaces } from "./_nyc.js";
import { CREW_RE, getCrew } from "./_crew.js";

const START = 1500, MIN_VOTES = 5, PER_DAY = 5;
const GROUP_POINTS = { yes: 1, match: 6, win: 20 };
const KEEP = 400 * 86400, GAME_KEEP = 30 * 86400;
const RADII = [0.5, 1, 2, 5, 10];
const week = (t = Date.now()) => Math.floor(t / (7 * 864e5));
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ALL_HOODS = new Set(NEIGHBORHOODS.flatMap((b) => b.hoods));
const view = (p, near) => p && { id: p.id, name: p.n, hood: p.hood, borough: p.b || "", kind: kindLabel(p), addr: p.addr, maps: mapsUrl(p), lat: p.lat, lng: p.lng, web: p.web, ...(near ? { mi: Math.round(milesBetween(near, p) * 10) / 10 } : {}) };
const pairs = (f) => { const o = {}; for (let i = 0; i + 1 < (f || []).length; i += 2) o[f[i]] = Number(f[i + 1]); return o; };
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const shuffle = (arr) => arr.map((x) => [Math.random(), x]).sort((a, b) => a[0] - b[0]).map(([, x]) => x);

// Near me: a point and a radius in miles (from the query string or a POST body).
function nearFrom(src) {
  const get = (k) => (src instanceof URLSearchParams ? src.get(k) : src[k]);
  const lat = Number(get("lat")), lng = Number(get("lng")), mi = Number(get("mi"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !RADII.includes(mi)) return null;
  if (lat < 40.4 || lat > 41 || lng < -74.4 || lng > -73.6) return null; // outside the city: show all NYC
  return { lat, lng, mi };
}
const within = (near, hood, byId) => (id) => {
  const p = byId.get(id); if (!p) return false;
  if (hood) return p.hood === hood;
  return !near || milesBetween(near, p) <= near.mi;
};

// ---------- group picks from decks ----------
// Decks queue what happened to NYC places (yes, made the final vote, won); here they're matched to the list.
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
    // Google knows sports bars better than the map does: a group pick of one puts it on the game-day boards.
    if (/sports/i.test(ev.kind || "")) for (const slug of ["sports-bars", "nfl"]) if (!boards.includes(boardBySlug[slug])) { boards.push(boardBySlug[slug]); cmds.push(["SADD", `bd:${slug}:extra`, p.id]); }
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
const scoreOf = (elo, grp, id) => Math.round((elo[id] ?? START) + Math.min(150, grp[id] || 0));
async function ranked(slug, { hood = "", near = null, limit = 10, all = false } = {}) {
  const c = await catalog(), inPool = await pool(slug), ok = within(near, hood, c.byId);
  const deep = hood || near ? 1999 : 299;
  const [eloFlat, grpFlat, wkFlat] = await pipeline([["ZREVRANGE", `bd:${slug}:elo`, 0, deep, "WITHSCORES"], ["ZREVRANGE", `bd:${slug}:grp`, 0, deep, "WITHSCORES"], ["ZREVRANGE", `bd:${slug}:wk:${week()}`, 0, 99, "WITHSCORES"]]);
  const elo = pairs(eloFlat), grp = pairs(grpFlat), wk = pairs(wkFlat);
  const ids = [...new Set([...Object.keys(elo), ...Object.keys(grp)])].filter((id) => inPool.has(id) && ok(id)).sort((a, b) => scoreOf(elo, grp, b) - scoreOf(elo, grp, a)).slice(0, all ? 400 : 120);
  const rows = await pipeline([...ids.map((id) => ["HGET", `bd:${slug}:n`, id]), ...ids.map((id) => ["HGET", `nyc:grp:${id}`, "win"])]);
  const list = ids.map((id, i) => {
    const votes = Number(rows[i]) || 0, wins = Math.max(0, Number(rows[ids.length + i]) || 0);
    return { ...view(c.byId.get(id), near), votes, wins, score: scoreOf(elo, grp, id), eligible: votes >= MIN_VOTES || wins >= 1 };
  });
  const top = list.filter((x) => x.eligible).slice(0, limit);
  const rising = Object.entries(wk).filter(([id]) => inPool.has(id) && ok(id)).slice(0, 5).map(([id, n]) => ({ ...view(c.byId.get(id), near), weekWins: n }));
  const size = near || hood ? [...inPool].filter(ok).length : inPool.size;
  return { top, rising, pool: size, unranked: list.filter((x) => !x.eligible).length, list: all ? list : undefined };
}
// The places in a board's running (near me, if set), as ids.
async function poolIds(slug, near) {
  const c = await catalog(), ok = within(near, "", c.byId);
  return [...(await pool(slug))].filter(ok);
}

// One head-to-head result: both ratings move (chess-style), the rising list and every one of the voter's crews count it.
async function headToHead(me, slug, win, lose, crewBonus = 0) {
  const [rw, rl, nw, nl, crews] = await pipeline([["ZSCORE", `bd:${slug}:elo`, win], ["ZSCORE", `bd:${slug}:elo`, lose], ["HGET", `bd:${slug}:n`, win], ["HGET", `bd:${slug}:n`, lose], ["SMEMBERS", `pcrews:${me}`]]);
  const Rw = Number(rw) || START, Rl = Number(rl) || START, ew = 1 / (1 + 10 ** ((Rl - Rw) / 400));
  const k = (n) => ((Number(n) || 0) < 10 ? 32 : 20);
  await pipeline([
    ["ZADD", `bd:${slug}:elo`, Math.round(Rw + k(nw) * (1 - ew)), win], ["ZADD", `bd:${slug}:elo`, Math.round(Rl - k(nl) * (1 - ew)), lose],
    ["HINCRBY", `bd:${slug}:n`, win, 1], ["HINCRBY", `bd:${slug}:n`, lose, 1],
    ["ZINCRBY", `bd:${slug}:wk:${week()}`, 1, win], ["EXPIRE", `bd:${slug}:wk:${week()}`, 21 * 86400],
    ...(crews || []).slice(0, 10).flatMap((id) => [["ZINCRBY", `crewbd:${id}:${slug}`, 1 + crewBonus, win], ["EXPIRE", `crewbd:${id}:${slug}`, KEEP]]),
  ]);
  await bump("tt_votes");
  const rank = await redis("ZREVRANK", `bd:${slug}:elo`, win);
  return rank == null ? null : rank + 1;
}
const voteLimit = (req) => allow(`rl:tt:${clientIp(req)}`, 400, 86400);
const TOO_MANY = "That's a lot of votes for one day. Come back tomorrow.";

// ---------- This or That ----------
async function makePair(slug) {
  const ids = [...(await pool(slug))];
  if (ids.length < 4) return null;
  const inPool = new Set(ids);
  const top = ((await redis("ZREVRANGE", `bd:${slug}:elo`, 0, 39)) || []).filter((id) => inPool.has(id));
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
    const boards = BOARDS.filter((b) => (c.pools[b.slug] || []).length >= 4);
    const chosen = [...shuffle(boards.filter((b) => b.featured)), ...shuffle(boards.filter((b) => !b.featured))].slice(0, PER_DAY);
    for (const b of chosen) { const m = await makePair(b.slug); if (m) rows.push(m); }
    if (rows.length) await pipeline([...rows.map((r, i) => ["HSET", key, String(i), JSON.stringify(r)]), ["EXPIRE", key, 3 * 86400]]);
  }
  return rows;
}
const yesterday = (day) => new Date(Date.parse(day + "T12:00:00Z") - 864e5).toISOString().slice(0, 10);
async function streakOf(me, day) {
  const s = JSON.parse((await redis("GET", `streak:${me}`)) || "null");
  return s ? { n: s.last === day || s.last === yesterday(day) ? s.n : 0, best: s.best } : { n: 0, best: 0 };
}
async function play(res, q) {
  const me = q.get("me") || "", day = q.get("day") || "";
  if (!PLAYER_RE.test(me) || !DAY_RE.test(day)) return send(res, 400, { error: "Bad request." });
  const c = await catalog();
  if (!c.places.length) return send(res, 200, { matchups: [], ready: false });
  const rows = await todays(me, day);
  return send(res, 200, {
    ready: true, streak: await streakOf(me, day),
    matchups: rows.map((r, i) => ({ i, slug: r.slug, title: boardBySlug[r.slug].title, emoji: boardBySlug[r.slug].emoji, noun: boardBySlug[r.slug].noun, a: view(c.byId.get(r.a)), b: view(c.byId.get(r.b)), pick: r.pick || null, split: r.split || null })),
  });
}
async function vote(req, res, b) {
  const me = String(b.me || ""), day = String(b.day || ""), i = Math.round(Number(b.i));
  if (!PLAYER_RE.test(me) || !DAY_RE.test(day) || !["a", "b"].includes(b.pick)) return send(res, 400, { error: "Bad vote." });
  if (Math.abs(Date.parse(day + "T12:00:00Z") - Date.now()) > 2 * 864e5) return send(res, 400, { error: "That day's over." });
  if (!(await voteLimit(req))) return send(res, 429, { error: TOO_MANY });
  const key = `tt:${me}:${day}`;
  const row = JSON.parse((await redis("HGET", key, String(i))) || "null");
  if (!row) return send(res, 404, { error: "That matchup isn't yours." });
  if (row.pick) return send(res, 200, { split: row.split, already: true });
  const { slug, a, b: bb } = row, win = b.pick === "a" ? a : bb, lose = b.pick === "a" ? bb : a;
  const rank = await headToHead(me, slug, win, lose);
  const pairKey = `pair:${slug}:${[a, bb].sort().join("|")}`;
  const [, cnt] = await pipeline([["HINCRBY", pairKey, win, 1], ["HGETALL", pairKey]]);
  const counts = hashToObject(cnt), total = (Number(counts[a]) || 0) + (Number(counts[bb]) || 0);
  const split = { a: Math.round(((Number(counts[a]) || 0) / total) * 100), b: Math.round(((Number(counts[bb]) || 0) / total) * 100), votes: total };
  await redis("HSET", key, String(i), JSON.stringify({ ...row, pick: b.pick, split }));
  // Streak: the first vote of a day keeps it going (or starts it).
  const st = JSON.parse((await redis("GET", `streak:${me}`)) || "null") || { n: 0, best: 0, last: "" };
  if (st.last !== day) { st.n = st.last === yesterday(day) ? st.n + 1 : 1; st.best = Math.max(st.best, st.n); st.last = day; await redis("SET", `streak:${me}`, JSON.stringify(st), "EX", KEEP); }
  return send(res, 200, { split, rank, streak: st.n });
}

// ---------- King of the Hill ----------
// The champ stays on until something beats it; every challenger is new to this run. The longest reign is your record.
const hillKey = (me, slug) => `hill:${me}:${slug}`;
async function nextChallenger(slug, near, champ, seen) {
  const ids = (await poolIds(slug, near)).filter((id) => id !== champ && !seen.includes(id));
  if (!ids.length) return null;
  // Half the time a top-rated place (a real test), otherwise anything in the running.
  const set = new Set(ids);
  const top = ((await redis("ZREVRANGE", `bd:${slug}:elo`, 0, 59)) || []).filter((id) => set.has(id));
  return top.length && Math.random() < 0.5 ? pick(top) : pick(ids);
}
async function hillView(st) {
  const c = await catalog(), b = boardBySlug[st.slug];
  return { board: { slug: b.slug, title: b.title, emoji: b.emoji, noun: b.noun }, champ: view(c.byId.get(st.champ), st.near), chal: st.chal ? view(c.byId.get(st.chal), st.near) : null, reign: st.reign, best: st.best, rounds: st.rounds, near: st.near, last: st.last || null };
}
async function hill(res, q) {
  const me = q.get("me") || "", b = boardBySlug[q.get("slug")];
  if (!PLAYER_RE.test(me) || !b) return send(res, 400, { error: "Bad request." });
  let st = JSON.parse((await redis("GET", hillKey(me, b.slug))) || "null");
  if (!st || q.get("fresh") === "1") {
    const near = nearFrom(q);
    const { top } = await ranked(b.slug, { near, limit: 1 });
    const ids = await poolIds(b.slug, near);
    if (ids.length < 2) return send(res, 200, { empty: true, board: { slug: b.slug, title: b.title, emoji: b.emoji } });
    // The board's #1 starts on the hill (near you, if you picked a radius); otherwise a random place.
    const champ = top[0]?.id || pick(ids);
    st = { slug: b.slug, near, champ, reign: 0, best: st?.best || 0, rounds: 0, seen: [champ], chal: null };
    st.chal = await nextChallenger(b.slug, near, champ, st.seen);
    await redis("SET", hillKey(me, b.slug), JSON.stringify(st), "EX", GAME_KEEP);
  }
  return send(res, 200, await hillView(st));
}
async function hillVote(req, res, b) {
  const me = String(b.me || ""), board = boardBySlug[b.slug];
  if (!PLAYER_RE.test(me) || !board || !["champ", "chal"].includes(b.pick)) return send(res, 400, { error: "Bad vote." });
  if (!(await voteLimit(req))) return send(res, 429, { error: TOO_MANY });
  const st = JSON.parse((await redis("GET", hillKey(me, board.slug))) || "null");
  if (!st?.chal) return send(res, 409, { error: "Start a new game." });
  // A double tap must not count twice: the vote is for the challenger the server last issued.
  if (b.chal && b.chal !== st.chal) return send(res, 200, { ...(await hillView(st)), already: true });
  const champWon = b.pick === "champ", win = champWon ? st.champ : st.chal, lose = champWon ? st.chal : st.champ;
  const rank = await headToHead(me, board.slug, win, lose);
  const c = await catalog();
  st.rounds++;
  st.last = { winner: c.byId.get(win)?.n || "", loser: c.byId.get(lose)?.n || "", dethroned: !champWon, reign: st.reign + (champWon ? 1 : 0), rank };
  if (champWon) st.reign++; else { st.champ = st.chal; st.reign = 1; }
  st.best = Math.max(st.best, st.reign);
  st.seen = [...st.seen, st.chal].slice(-300);
  st.chal = await nextChallenger(board.slug, st.near, st.champ, st.seen);
  await pipeline([["SET", hillKey(me, board.slug), JSON.stringify(st), "EX", GAME_KEEP], ["SET", `champ:${me}:${board.slug}`, JSON.stringify({ id: st.champ, how: "hill", at: Date.now() }), "EX", KEEP]]);
  return send(res, 200, await hillView(st));
}

// ---------- Brackets ----------
// 8 or 16 places seeded by their rank (near you, if you like), March Madness style: 1 plays 8, 4 plays 5…
const brKey = (me, slug) => `br:${me}:${slug}`;
function seedOrder(n) {
  let order = [1];
  while (order.length < n) { const m = order.length * 2 + 1; order = order.flatMap((s) => [s, m - s]); }
  return order;
}
async function bracketView(st) {
  const c = await catalog(), b = boardBySlug[st.slug];
  const seedOf = Object.fromEntries(st.rounds[0].map((id, i) => [id, st.seeds[i]]));
  const rounds = st.rounds.map((ids, r) => {
    const matches = [];
    for (let m = 0; m * 2 + 1 < ids.length; m++) {
      const [a, bb] = [ids[m * 2], ids[m * 2 + 1]];
      matches.push({ m, a: { ...view(c.byId.get(a), st.near), seed: seedOf[a] }, b: { ...view(c.byId.get(bb), st.near), seed: seedOf[bb] }, pick: st.picks[r]?.[m] || null });
    }
    return matches;
  });
  const champ = st.rounds.at(-1).length === 1 ? { ...view(c.byId.get(st.rounds.at(-1)[0]), st.near), seed: seedOf[st.rounds.at(-1)[0]] } : null;
  return { board: { slug: b.slug, title: b.title, emoji: b.emoji, noun: b.noun }, size: st.size, near: st.near, rounds, champ };
}
async function getBracket(res, q) {
  const me = q.get("me") || "", b = boardBySlug[q.get("slug")];
  if (!PLAYER_RE.test(me) || !b) return send(res, 400, { error: "Bad request." });
  const st = JSON.parse((await redis("GET", brKey(me, b.slug))) || "null");
  return send(res, 200, st ? await bracketView(st) : { none: true });
}
async function startBracket(req, res, b) {
  const me = String(b.me || ""), board = boardBySlug[b.slug];
  if (!PLAYER_RE.test(me) || !board) return send(res, 400, { error: "Bad request." });
  if (!(await allow(`rl:br:${clientIp(req)}`, 60, 86400))) return send(res, 429, { error: "That's a lot of brackets for one day." });
  const near = nearFrom(b), want = Number(b.size) === 16 ? 16 : 8;
  const { list } = await ranked(board.slug, { near, all: true });
  const ids = await poolIds(board.slug, near);
  // Seeds: best-rated first; if there aren't enough rated places, the rest come from the running at random.
  const rated = list.map((x) => x.id), set = new Set(rated);
  const field = [...rated, ...shuffle(ids.filter((id) => !set.has(id)))];
  const size = field.length >= want ? want : field.length >= 8 ? 8 : field.length >= 4 ? 4 : 0;
  if (!size) return send(res, 400, { error: near ? "Not enough places near you for a bracket. Try a bigger radius." : "Not enough places on this board yet." });
  const seeded = field.slice(0, size), order = seedOrder(size);
  const st = { slug: board.slug, size, near, seeds: order, rounds: [order.map((s) => seeded[s - 1])], picks: [[]], at: Date.now() };
  await redis("SET", brKey(me, board.slug), JSON.stringify(st), "EX", GAME_KEEP);
  await bump("brackets");
  return send(res, 200, await bracketView(st));
}
async function bracketVote(req, res, b) {
  const me = String(b.me || ""), board = boardBySlug[b.slug], m = Math.round(Number(b.m));
  if (!PLAYER_RE.test(me) || !board || !["a", "b"].includes(b.pick)) return send(res, 400, { error: "Bad vote." });
  if (!(await voteLimit(req))) return send(res, 429, { error: TOO_MANY });
  const st = JSON.parse((await redis("GET", brKey(me, board.slug))) || "null");
  if (!st) return send(res, 409, { error: "Start a new bracket." });
  const r = st.rounds.length - 1, ids = st.rounds[r];
  if (ids.length < 2 || !(m >= 0 && m * 2 + 1 < ids.length)) return send(res, 400, { error: "That matchup's done." });
  if (st.picks[r][m]) return send(res, 200, { ...(await bracketView(st)), already: true });
  const a = ids[m * 2], bb = ids[m * 2 + 1], win = b.pick === "a" ? a : bb, lose = b.pick === "a" ? bb : a;
  st.picks[r][m] = b.pick;
  const roundDone = ids.length / 2 === st.picks[r].filter(Boolean).length;
  const crowned = roundDone && ids.length === 2;
  // Crowning a bracket champ counts extra on your crews' boards.
  await headToHead(me, board.slug, win, lose, crowned ? 2 : 0);
  if (roundDone) {
    st.rounds.push(ids.filter((_, i) => i % 2 === 0).map((x, k) => (st.picks[r][k] === "a" ? ids[k * 2] : ids[k * 2 + 1])));
    st.picks.push([]);
  }
  const cmds = [["SET", brKey(me, board.slug), JSON.stringify(st), "EX", GAME_KEEP]];
  if (crowned) cmds.push(["SET", `champ:${me}:${board.slug}`, JSON.stringify({ id: win, how: "bracket", at: Date.now() }), "EX", KEEP]);
  await pipeline(cmds);
  return send(res, 200, await bracketView(st));
}

// ---------- crews ----------
async function crewTops(crewId, slugs) {
  const rows = await pipeline(slugs.map((s) => ["ZREVRANGE", `crewbd:${crewId}:${s}`, 0, 2, "WITHSCORES"]));
  const c = await catalog();
  return Object.fromEntries(slugs.map((s, i) => [s, Object.entries(pairs(rows[i])).filter(([id, pts]) => pts > 0 && c.byId.has(id)).map(([id, pts]) => ({ ...view(c.byId.get(id)), pts }))]));
}
async function crewBoards(res, q) {
  const id = String(q.get("crew") || "").toUpperCase();
  if (!CREW_RE.test(id)) return send(res, 400, { error: "Bad crew." });
  const tops = await crewTops(id, BOARDS.map((b) => b.slug));
  return send(res, 200, { boards: BOARDS.filter((b) => tops[b.slug].length).map((b) => ({ slug: b.slug, title: b.title, emoji: b.emoji, top: tops[b.slug] })) });
}

// ---------- boards ----------
async function boards(res, q) {
  const c = await catalog(), near = nearFrom(q);
  // Every board's #1 in one go: the best few by score in range, then the first with an official rank.
  const zs = await pipeline(BOARDS.flatMap((b) => [["ZREVRANGE", `bd:${b.slug}:elo`, 0, near ? 999 : 49, "WITHSCORES"], ["ZREVRANGE", `bd:${b.slug}:grp`, 0, near ? 999 : 49, "WITHSCORES"], ["SMEMBERS", `bd:${b.slug}:extra`]]));
  const ok = within(near, "", c.byId), cands = [], sizes = {};
  BOARDS.forEach((b, i) => {
    const elo = pairs(zs[i * 3]), grp = pairs(zs[i * 3 + 1]);
    const inPool = new Set([...(c.pools[b.slug] || []), ...(zs[i * 3 + 2] || []).filter((id) => c.byId.has(id))]);
    sizes[b.slug] = near ? [...inPool].filter(ok).length : inPool.size;
    const ids = [...new Set([...Object.keys(elo), ...Object.keys(grp)])].filter((id) => inPool.has(id) && ok(id)).sort((x, y) => scoreOf(elo, grp, y) - scoreOf(elo, grp, x)).slice(0, 6);
    cands.push(ids);
  });
  const flat = cands.flatMap((ids, i) => ids.map((id) => [BOARDS[i].slug, id]));
  const rows = await pipeline(flat.flatMap(([slug, id]) => [["HGET", `bd:${slug}:n`, id], ["HGET", `nyc:grp:${id}`, "win"]]));
  const firsts = {};
  flat.forEach(([slug, id], k) => { if (!firsts[slug] && ((Number(rows[k * 2]) || 0) >= MIN_VOTES || (Number(rows[k * 2 + 1]) || 0) >= 1)) firsts[slug] = id; });
  const me = q.get("me") || "";
  const out = BOARDS.map((b) => {
    const p = firsts[b.slug] && c.byId.get(firsts[b.slug]);
    return { slug: b.slug, sec: b.sec, title: b.title, emoji: b.emoji, featured: !!b.featured, size: sizes[b.slug], first: p ? { name: p.n, hood: p.hood, ...(near ? { mi: Math.round(milesBetween(near, p) * 10) / 10 } : {}) } : null };
  });
  return send(res, 200, { boards: out, sections: SECTIONS, ready: c.places.length > 0, builtAt: c.meta?.builtAt || null, neighborhoods: NEIGHBORHOODS, near, streak: PLAYER_RE.test(me) && DAY_RE.test(q.get("day") || "") ? await streakOf(me, q.get("day")) : null });
}
async function board(res, q) {
  const b = boardBySlug[q.get("slug")];
  if (!b) return send(res, 404, { error: "No such board." });
  const hood = ALL_HOODS.has(q.get("hood")) ? q.get("hood") : "", near = hood ? null : nearFrom(q);
  const me = q.get("me") || "", c = await catalog();
  const out = { board: { slug: b.slug, title: b.title, emoji: b.emoji, noun: b.noun, sec: b.sec }, hood, near, ...(await ranked(b.slug, { hood, near })) };
  const counts = await tonightCounts(out.top.map((p) => p.id));
  for (const p of out.top) if (counts[p.id]) p.tonight = counts[p.id];
  // Your champ (from King of the Hill or a bracket) and your crews' own top 3, next to the city's.
  if (PLAYER_RE.test(me)) {
    const [champRaw, crewIds] = await pipeline([["GET", `champ:${me}:${b.slug}`], ["SMEMBERS", `pcrews:${me}`]]);
    const champ = JSON.parse(champRaw || "null");
    if (champ && c.byId.has(champ.id)) out.myChamp = { ...view(c.byId.get(champ.id)), how: champ.how };
    out.crews = [];
    for (const id of (crewIds || []).slice(0, 6)) {
      const crew = await getCrew(id); if (!crew) continue;
      const top = (await crewTops(id, [b.slug]))[b.slug];
      out.crews.push({ id, name: crew.name, top });
    }
    out.crews.sort((x, y) => y.top.length - x.top.length);
  }
  return send(res, 200, out);
}
async function search(res, q) {
  const s = String(q.get("q") || "").toLowerCase().trim(); if (s.length < 2) return send(res, 200, { places: [] });
  const c = await catalog();
  const hits = c.places.filter((p) => p.n.toLowerCase().includes(s)).sort((x, y) => x.n.toLowerCase().indexOf(s) - y.n.toLowerCase().indexOf(s) || x.n.length - y.n.length).slice(0, 8);
  return send(res, 200, { places: hits.map((p) => view(p)) });
}
async function nominate(req, res, b) {
  const board = boardBySlug[b.slug]; const c = await catalog();
  if (!board || !c.byId.has(b.id) || !PLAYER_RE.test(String(b.me || ""))) return send(res, 400, { error: "Bad nomination." });
  if (!(await allow(`rl:nom:${clientIp(req)}`, 20, 86400))) return send(res, 429, { error: "That's plenty of nominations for today." });
  await redis("SADD", `bd:${board.slug}:extra`, b.id);
  await bump("nominations");
  return send(res, 200, { ok: true });
}

// ---------- check-ins ----------
const coordsOk = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
async function nearby(res, q) {
  const lat = Number(q.get("lat")), lng = Number(q.get("lng"));
  if (!coordsOk(lat, lng)) return send(res, 400, { error: "Bad location." });
  const found = await nearbyPlaces(lat, lng, VERIFY_M, 25);
  const counts = await tonightCounts(found.map((f) => f.p.id));
  return send(res, 200, { places: found.map(({ p, m }) => ({ ...view(p), m, tonight: counts[p.id] || null })), within: VERIFY_M });
}
async function doCheckin(req, res, b) {
  const me = String(b.me || ""), name = cleanName(b.name), lat = Number(b.lat), lng = Number(b.lng);
  if (!PLAYER_RE.test(me) || !coordsOk(lat, lng)) return send(res, 400, { error: "Bad check-in." });
  if (!name) return send(res, 400, { error: "Add your name first." });
  if (!(await allow(`rl:ci:${clientIp(req)}`, 40, 86400))) return send(res, 429, { error: "That's a lot of check-ins for one day." });
  try { return send(res, 200, await checkIn({ pid: me, name, placeId: String(b.id || ""), lat, lng, tell: b.tell !== false })); }
  catch (e) { if (e instanceof CheckinError) return send(res, e.status, { error: e.message }); throw e; }
}
async function tonightList(res, q) {
  const c = await catalog(), near = nearFrom(q);
  const list = (await tonight(100)).map(([id, n]) => [c.byId.get(id), n]).filter(([p]) => p && (!near || milesBetween(near, p) <= near.mi)).slice(0, 10);
  return send(res, 200, { places: list.map(([p, n]) => ({ ...view(p, near), tonight: n })) });
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
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Matchbook (Best of NYC)" }, body: "data=" + encodeURIComponent(PARTS[part].query) });
      if (r.ok) { json = await r.json(); break; }
      lastErr = `${r.status}`;
    } catch (e) { lastErr = e.message; }
  }
  if (!json) return send(res, 502, { error: `OpenStreetMap didn't answer (${lastErr}). Try that part again in a minute.` });
  const places = (json.elements || []).map((el) => fromOsm(el, PARTS[part].borough)).filter(Boolean);
  await savePart(part, places);
  return send(res, 200, { part, parts: PARTS.length, borough: PARTS[part].borough, places: places.length });
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
      if (op === "hill") return await hill(res, q);
      if (op === "bracket") return await getBracket(res, q);
      if (op === "crew") return await crewBoards(res, q);
      if (op === "search") return await search(res, q);
      if (op === "nearby") return await nearby(res, q);
      if (op === "tonight") return await tonightList(res, q);
      if (op === "mine") return PLAYER_RE.test(q.get("me") || "") ? send(res, 200, await myStats(q.get("me"))) : send(res, 400, { error: "Bad request." });
      if (op === "status") { const c = await catalog(); return send(res, 200, { parts: PARTS.length, places: c.places.length, builtAt: c.meta?.builtAt || null }); }
      return send(res, 404, { error: "Unknown." });
    }
    if (req.method !== "POST") return send(res, 405, { error: "Use GET or POST." });
    const b = body(req);
    if (b.op === "vote") return await vote(req, res, b);
    if (b.op === "hillvote") return await hillVote(req, res, b);
    if (b.op === "bracket") return await startBracket(req, res, b);
    if (b.op === "bracketvote") return await bracketVote(req, res, b);
    if (b.op === "nominate") return await nominate(req, res, b);
    if (b.op === "checkin") return await doCheckin(req, res, b);
    if (b.op === "build" || b.op === "finish") return await build(req, res, b);
    return send(res, 400, { error: "Unknown." });
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: "Couldn't load the boards. Try again in a minute." });
  }
}
