// "Best of Manhattan": category lists, the Matchups game, and check-ins.
// Where (on every list call): nothing = all of Manhattan · hood=West Village · area=<typed neighborhood> · lat&lng&mi=near me
// GET  /api/boards?op=boards                         the categories, in sections, and the neighborhood list
// GET  /api/boards?op=board&slug=pizza&me=PID&<where>  the list: ranked by Google ratings to start, then by Matchbook votes
//                                                    and group picks; plus your champ and your crews' top 3
// GET  /api/boards?op=match&slug=pizza&me=PID&<where>[&fresh=1]  Matchups: two places, the one you pick stays
// POST /api/boards { op: "pick", me, slug, pick: "champ"|"chal", chal }
// GET  /api/boards?op=crew&crew=ID                   a crew's own top 3 per category (from its members' matchups)
// GET  /api/boards?op=nearby&lat&lng                 places close enough to check in at
// POST /api/boards { op: "checkin", me, name, gid, lat, lng, tell }
// GET  /api/boards?op=mine&me=PID                    your check-in points, weekly streak, spots
// GET  /api/boards?op=tonight&<where>                anonymous: where people are out tonight
import { PLAYER_RE, redis, pipeline, send, body, clientIp, allow, missingConfig, bump, cleanName } from "./_lib.js";
import { BOARDS, SECTIONS, boardBySlug, HOOD_NAMES, whereFrom, candidates, scored, details, MIN_VOTES } from "./_best.js";
import { checkIn, CheckinError, myStats, tonight, tonightCounts, nearby } from "./_checkin.js";
import { CREW_RE, getCrew } from "./_crew.js";
import { miles } from "./_places.js";

const KEEP = 400 * 86400, GAME_KEEP = 30 * 86400;
const boardInfo = (b) => ({ slug: b.slug, sec: b.sec, emoji: b.emoji, title: b.title, short: b.short, noun: b.noun });
const whereInfo = (w) => ({ kind: w.kind, label: w.label });
const pairs = (f) => { const o = []; for (let i = 0; i + 1 < (f || []).length; i += 2) o.push([f[i], Number(f[i + 1])]); return o; };
const fail = (res, e) => send(res, e.friendly ? 503 : 500, { error: e.friendly || "Couldn't load that. Try again in a minute." });

async function ranked(board, where) {
  if (where.kind === "missing") return [];
  const list = await scored(board, await candidates(board, where));
  const counts = await tonightCounts(list.slice(0, 40).map((p) => p.gid));
  return list.map((p, i) => ({ ...p, rank: i + 1, tonight: counts[p.gid] || null }));
}

// ---------- lists ----------
async function boardsList(res) {
  return send(res, 200, { sections: SECTIONS, boards: BOARDS.map(boardInfo), hoods: HOOD_NAMES }, { "Cache-Control": "public, max-age=300, s-maxage=3600" });
}
async function board(res, q) {
  const b = boardBySlug[q.get("slug")]; if (!b) return send(res, 404, { error: "No such list." });
  const where = await whereFrom(q), me = q.get("me") || "";
  const places = await ranked(b, where);
  const out = { board: boardInfo(b), where: whereInfo(where), places: places.slice(0, 40), minVotes: MIN_VOTES };
  if (PLAYER_RE.test(me)) {
    const [champRaw, crewIds] = await pipeline([["GET", `champ:${me}:${b.slug}`], ["SMEMBERS", `pcrews:${me}`]]);
    const champ = JSON.parse(champRaw || "null");
    if (champ) out.myChamp = places.find((p) => p.gid === champ.gid) || (await details([champ.gid]))[champ.gid] || null;
    out.crews = [];
    for (const id of (crewIds || []).slice(0, 4)) {
      const crew = await getCrew(id); if (!crew) continue;
      const top = pairs(await redis("ZREVRANGE", `crewbd:${id}:${b.slug}`, 0, 2, "WITHSCORES"));
      const names = await details(top.map(([g]) => g).filter((g) => !places.some((p) => p.gid === g)));
      out.crews.push({ id, name: crew.name, top: top.map(([g, pts]) => ({ ...(places.find((p) => p.gid === g) || names[g]), pts })).filter((x) => x.name) });
    }
  }
  return send(res, 200, out);
}

// ---------- Matchups: two places, the one you pick stays ----------
const matchKey = (me, slug) => `mu:${me}:${slug}`;
function nextChallenger(list, st) {
  // Down the list in order (so the champ has to beat the best first), skipping anything already faced.
  return list.find((p) => p.gid !== st.champ && !st.seen.includes(p.gid))?.gid || null;
}
async function matchView(st) {
  const b = boardBySlug[st.slug], list = await ranked(b, st.where);
  const find = (g) => list.find((p) => p.gid === g) || null;
  return { board: boardInfo(b), where: whereInfo(st.where), champ: find(st.champ), chal: st.chal ? find(st.chal) : null, reign: st.reign, best: st.best, rounds: st.rounds, left: list.filter((p) => p.gid !== st.champ && !st.seen.includes(p.gid)).length, last: st.last || null };
}
async function match(res, q) {
  const me = q.get("me") || "", b = boardBySlug[q.get("slug")];
  if (!PLAYER_RE.test(me) || !b) return send(res, 400, { error: "Bad request." });
  const where = await whereFrom(q);
  let st = JSON.parse((await redis("GET", matchKey(me, b.slug))) || "null");
  // A new run when asked, or when you've changed where (a West Village run only has West Village places).
  if (!st || q.get("fresh") === "1" || st.wkey !== where.key) {
    const list = await ranked(b, where);
    if (list.length < 2) return send(res, 200, { empty: true, board: boardInfo(b), where: whereInfo(where) });
    st = { slug: b.slug, where, wkey: where.key, champ: list[0].gid, chal: null, seen: [list[0].gid], reign: 0, best: st?.best || 0, rounds: 0 };
    st.chal = nextChallenger(list, st);
    await redis("SET", matchKey(me, b.slug), JSON.stringify(st), "EX", GAME_KEEP);
  }
  return send(res, 200, await matchView(st));
}
async function pick(req, res, b) {
  const me = String(b.me || ""), board = boardBySlug[b.slug];
  if (!PLAYER_RE.test(me) || !board || !["champ", "chal"].includes(b.pick)) return send(res, 400, { error: "Bad pick." });
  if (!(await allow(`rl:pick:${clientIp(req)}`, 600, 86400))) return send(res, 429, { error: "That's a lot of matchups for one day. Come back tomorrow." });
  const st = JSON.parse((await redis("GET", matchKey(me, board.slug))) || "null");
  if (!st?.chal) return send(res, 409, { error: "Start a new run." });
  if (b.chal && b.chal !== st.chal) return send(res, 200, { ...(await matchView(st)), already: true }); // a double tap
  const champWon = b.pick === "champ", win = champWon ? st.champ : st.chal, lose = champWon ? st.chal : st.champ;
  const list = await ranked(board, st.where), byId = Object.fromEntries(list.map((p) => [p.gid, p]));
  // Chess-style: an upset moves the ratings more than an expected win.
  const W = byId[win], L = byId[lose];
  const Rw = (W?.prior || 1500) + (W?.delta || 0), Rl = (L?.prior || 1500) + (L?.delta || 0), ew = 1 / (1 + 10 ** ((Rl - Rw) / 400));
  const k = (n) => ((n || 0) < 10 ? 32 : 20);
  const crewIds = (await redis("SMEMBERS", `pcrews:${me}`)) || [];
  // The same pair only counts once per person a week (replaying a run can't stuff the list).
  const fresh = (await redis("SET", `mv:${me}:${board.slug}:${[win, lose].sort().join("|")}`, "1", "EX", 7 * 86400, "NX")) === "OK";
  if (fresh) await pipeline([
    ["ZINCRBY", `bx:${board.slug}:d`, Math.max(1, Math.round(k(W?.votes) * (1 - ew))), win], ["ZINCRBY", `bx:${board.slug}:d`, -Math.max(1, Math.round(k(L?.votes) * (1 - ew))), lose],
    ["HINCRBY", `bx:${board.slug}:n`, win, 1], ["HINCRBY", `bx:${board.slug}:n`, lose, 1],
    ...crewIds.slice(0, 10).flatMap((id) => [["ZINCRBY", `crewbd:${id}:${board.slug}`, 1, win], ["EXPIRE", `crewbd:${id}:${board.slug}`, KEEP]]),
  ]);
  st.rounds++;
  st.last = { winner: W?.name || "", loser: L?.name || "", dethroned: !champWon, reign: champWon ? st.reign + 1 : 1 };
  if (champWon) st.reign++; else { st.champ = st.chal; st.reign = 1; }
  st.best = Math.max(st.best, st.reign);
  st.seen = [...st.seen, st.chal].slice(-300);
  st.chal = nextChallenger(list, st);
  await pipeline([["SET", matchKey(me, board.slug), JSON.stringify(st), "EX", GAME_KEEP], ["SET", `champ:${me}:${board.slug}`, JSON.stringify({ gid: st.champ, at: Date.now() }), "EX", KEEP]]);
  await bump("matchup_votes");
  return send(res, 200, await matchView(st));
}

// ---------- crews ----------
async function crewBoards(res, q) {
  const id = String(q.get("crew") || "").toUpperCase();
  if (!CREW_RE.test(id)) return send(res, 400, { error: "Bad crew." });
  const rows = await pipeline(BOARDS.map((b) => ["ZREVRANGE", `crewbd:${id}:${b.slug}`, 0, 2, "WITHSCORES"]));
  const lists = BOARDS.map((b, i) => [b, pairs(rows[i]).filter(([, n]) => n > 0)]).filter(([, t]) => t.length).slice(0, 8);
  const names = await details(lists.flatMap(([, t]) => t.map(([g]) => g)));
  return send(res, 200, { boards: lists.map(([b, t]) => ({ ...boardInfo(b), top: t.map(([g, pts]) => ({ ...names[g], pts })).filter((x) => x.name) })).filter((x) => x.top.length) });
}

// ---------- check-ins ----------
const coordsOk = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
async function nearbyList(req, res, q) {
  const lat = Number(q.get("lat")), lng = Number(q.get("lng"));
  if (!coordsOk(lat, lng)) return send(res, 400, { error: "Bad location." });
  if (!(await allow(`rl:near:${clientIp(req)}`, 60, 3600))) return send(res, 429, { error: "Slow down a little." });
  const places = await nearby(lat, lng);
  const counts = await tonightCounts(places.map((p) => p.gid));
  return send(res, 200, { places: places.map((p) => ({ ...p, tonight: counts[p.gid] || null })) });
}
async function doCheckin(req, res, b) {
  const me = String(b.me || ""), name = cleanName(b.name), lat = Number(b.lat), lng = Number(b.lng), gid = String(b.gid || "");
  if (!PLAYER_RE.test(me) || !coordsOk(lat, lng) || !/^[A-Za-z0-9_-]{6,300}$/.test(gid)) return send(res, 400, { error: "Bad check-in." });
  if (!name) return send(res, 400, { error: "Add your name first." });
  if (!(await allow(`rl:ci:${clientIp(req)}`, 40, 86400))) return send(res, 429, { error: "That's a lot of check-ins for one day." });
  try { return send(res, 200, await checkIn({ pid: me, name, gid, lat, lng, tell: b.tell !== false })); }
  catch (e) { if (e instanceof CheckinError) return send(res, e.status, { error: e.message }); throw e; }
}
async function tonightList(res, q) {
  const where = await whereFrom(q);
  const top = (await tonight(60)).slice(0, 30);
  const names = await details(top.map(([g]) => g));
  const inWhere = (p) => where.kind === "all" || (where.kind === "hood" ? p.hood === where.label : where.lat != null && miles({ latitude: where.lat, longitude: where.lng }, { latitude: p.lat, longitude: p.lng }) <= where.mi);
  return send(res, 200, { places: top.filter(([g]) => names[g] && inWhere(names[g])).slice(0, 8).map(([g, n]) => ({ ...names[g], tonight: n })) });
}

export default async function handler(req, res) {
  if (missingConfig().length) return send(res, 503, { error: "Not set up." });
  try {
    if (req.method === "GET") {
      const q = new URL(req.url, "http://x").searchParams, op = q.get("op");
      if (op === "boards") return await boardsList(res);
      if (op === "board") return await board(res, q);
      if (op === "match") return await match(res, q);
      if (op === "crew") return await crewBoards(res, q);
      if (op === "nearby") return await nearbyList(req, res, q);
      if (op === "tonight") return await tonightList(res, q);
      if (op === "mine") return PLAYER_RE.test(q.get("me") || "") ? send(res, 200, await myStats(q.get("me"))) : send(res, 400, { error: "Bad request." });
      return send(res, 404, { error: "Unknown." });
    }
    if (req.method !== "POST") return send(res, 405, { error: "Use GET or POST." });
    const b = body(req);
    if (b.op === "pick") return await pick(req, res, b);
    if (b.op === "checkin") return await doCheckin(req, res, b);
    return send(res, 400, { error: "Unknown." });
  } catch (e) {
    console.error(e);
    return fail(res, e);
  }
}
