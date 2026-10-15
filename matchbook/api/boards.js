// "Best of Manhattan": category lists, the Matchups game, and check-ins.
// Where (on every list call): nothing = all of Manhattan · hood=West Village · area=<typed neighborhood> · lat&lng&mi=near me
// GET  /api/boards?op=boards                         the categories, in sections, and the neighborhood list
// GET  /api/boards?op=board&slug=pizza&me=PID&<where>  the list: ranked by Google ratings to start, then by Matchbook votes
//                                                    and group picks; plus your champ and your crews' top 3
// GET  /api/boards?op=tier&slug=pizza&me=PID&<where>  Tier It: the next places to tier, and your tier list so far
// POST /api/boards { op: "tierset", me, slug, gid, t: "S"|"A"|"B"|"C"|"D"|"want"|"skip"|"clear" }
// GET  /api/boards?op=crewtier&crew=ID&slug=pizza&me=PID  a crew's merged tier list, hot take, and what it says you should try
// GET  /api/boards?op=crew&crew=ID                   a crew's tier lists across categories (for the crew page)
// POST /api/boards { op: "queststart", me, crew, slug, <where> }   a crew takes on a list (up to 30 spots, snapshotted)
// POST /api/boards { op: "queststart", me, crew, slug, title, gids }   …or its own list of place IDs
// GET  /api/boards?op=quest&crew=ID&id=QID&me=PID    progress (from crew check-ins), the crew's ranking (Tier It), spots
// GET  /api/boards?op=quests&crew=ID                 a crew's quests with progress
// Tier It on a quest: op=tier&slug=…&crew=ID&quest=QID (cards are the quest's spots)
// GET  /api/boards?op=nearby&lat&lng                 places close enough to check in at
// POST /api/boards { op: "checkin", me, name, gid, lat, lng, tell }
// GET  /api/boards?op=mine&me=PID                    your check-in points, weekly streak, spots
// GET  /api/boards?op=tonight&<where>                anonymous: where people are out tonight
import { PLAYER_RE, redis, pipeline, send, body, clientIp, allow, missingConfig, bump, cleanName } from "./_lib.js";
import { BOARDS, SECTIONS, boardBySlug, HOOD_NAMES, whereFrom, candidates, scored, details, MIN_VOTES } from "./_best.js";
import { checkIn, CheckinError, myStats, tonight, tonightCounts, nearby } from "./_checkin.js";
import { CREW_RE, getCrew, memberPids, isMember } from "./_crew.js";
import { createQuest, getQuest, crewQuests, crewCheckins, progressOf, QUEST_RE, MAX_SPOTS } from "./_quests.js";
import { TIERS, MARKS, marksOf, setMark, crewTier, checkedIn } from "./_tiers.js";
import { miles } from "./_places.js";

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
    const marks = await marksOf(me, b.slug);
    for (const p of out.places) if (marks[p.gid]) p.mine = marks[p.gid].t;
    out.myTiers = Object.fromEntries([...TIERS, "want"].map((t) => [t, Object.values(marks).filter((m) => m.t === t).length]));
    out.crews = [];
    for (const id of ((await redis("SMEMBERS", `pcrews:${me}`)) || []).slice(0, 3)) {
      const crew = await getCrew(id); if (!crew) continue;
      const ct = await crewTier(crew, b.slug, me);
      if (!ct.list.length) { out.crews.push({ id, name: crew.name, list: [], hotTake: null, sayGo: [] }); continue; }
      out.crews.push({ id, name: crew.name, ...(await withPlaces(ct, places)) });
    }
  }
  return send(res, 200, out);
}

// ---------- Tier It ----------
// Names and photos for places we know by ID: from the list in hand, else Google's basic details.
async function placesFor(gids, list = []) {
  const have = Object.fromEntries(list.map((p) => [p.gid, p]));
  const missing = gids.filter((g) => !have[g]);
  const found = missing.length ? await details(missing) : {};
  return Object.fromEntries(gids.map((g) => [g, have[g] || found[g]]).filter(([, p]) => p));
}
const brief = (p) => p && { gid: p.gid, name: p.name, hood: p.hood || "", photo: p.photo || "", rating: p.rating ?? null, ratings: p.ratings || 0, price: p.price || "", maps: p.maps || "", kind: p.kind || "" };
async function withPlaces(ct, list) {
  const gids = [...new Set([...ct.list.slice(0, 15).map((r) => r.gid), ...(ct.hotTake ? [ct.hotTake.gid] : []), ...ct.sayGo.map((r) => r.gid)])];
  const P = await placesFor(gids, list);
  return {
    list: ct.list.slice(0, 15).filter((r) => P[r.gid]).map((r) => ({ ...r, place: brief(P[r.gid]) })),
    hotTake: ct.hotTake && P[ct.hotTake.gid] ? { ...ct.hotTake, place: brief(P[ct.hotTake.gid]) } : null,
    sayGo: ct.sayGo.filter((r) => P[r.gid]).map((r) => ({ ...r, place: brief(P[r.gid]) })),
  };
}
// The next places to tier: ones your crews have tiered first (so you have opinions to compare), then ones you've
// checked in at, then what groups are picking, then the list's own order. Anything you've already marked is left out.
async function tier(res, q) {
  const me = q.get("me") || "", b = boardBySlug[q.get("slug")];
  if (!PLAYER_RE.test(me) || !b) return send(res, 400, { error: "Bad request." });
  const qt = q.get("quest") ? await questFor(q.get("crew"), q.get("quest")) : null;
  if (q.get("quest") && (!qt || qt.quest.slug !== b.slug)) return send(res, 404, { error: "That quest wasn't found." });
  const where = qt ? qt.quest.where || { kind: "list", label: qt.quest.title } : await whereFrom(q), list = qt ? qt.places : await ranked(b, where), marks = await marksOf(me, b.slug);
  const crewIds = ((await redis("SMEMBERS", `pcrews:${me}`)) || []).slice(0, 5);
  const crewPids = [...new Set((await Promise.all(crewIds.map(getCrew))).filter(Boolean).flatMap(memberPids))].filter((p) => p !== me).slice(0, 40);
  const crewRows = crewPids.length ? await pipeline(crewPids.map((p) => ["HKEYS", `tier:${p}:${b.slug}`])) : [];
  const crewKnown = new Set(crewRows.flat().filter(Boolean));
  const [mineBeen] = await checkedIn([me]);
  const rankOf = (p) => (crewKnown.has(p.gid) ? 0 : mineBeen.has(p.gid) ? 1 : p.wins || p.tonight ? 2 : 3);
  const cards = list.filter((p) => !marks[p.gid]).map((p, i) => [rankOf(p), i, p]).sort((x, y) => x[0] - y[0] || x[1] - y[1]).slice(0, 25)
    .map(([r, , p]) => ({ ...brief(p), crew: r === 0, been: mineBeen.has(p.gid) }));
  const mineList = await myTierList(me, b.slug, marks, list, mineBeen);
  return send(res, 200, { board: boardInfo(b), where: whereInfo(where), cards, mine: mineList, left: list.filter((p) => !marks[p.gid]).length, quest: qt ? { id: qt.quest.id, crew: qt.quest.crew, title: qt.quest.title } : null });
}
async function myTierList(me, slug, marks, list, been) {
  const gids = Object.keys(marks).filter((g) => marks[g].t !== "skip");
  const P = await placesFor(gids, list);
  const out = Object.fromEntries([...TIERS, "want"].map((t) => [t, []]));
  for (const g of gids) if (P[g]) out[marks[g].t].push({ ...brief(P[g]), been: been.has(g), at: marks[g].at });
  // Within a tier: places you've been first, then most recent.
  for (const t of Object.keys(out)) out[t].sort((a, b) => b.been - a.been || b.at - a.at);
  return out;
}
async function tierSet(req, res, b) {
  const me = String(b.me || ""), board = boardBySlug[b.slug], gid = String(b.gid || ""), t = String(b.t || "");
  if (!PLAYER_RE.test(me) || !board || !/^[A-Za-z0-9_-]{6,300}$/.test(gid) || ![...MARKS, "clear"].includes(t)) return send(res, 400, { error: "Bad tier." });
  if (!(await allow(`rl:tier:${clientIp(req)}`, 800, 86400))) return send(res, 429, { error: "That's a lot of tiering for one day. Come back tomorrow." });
  await setMark(me, board.slug, gid, t);
  if (TIERS.includes(t)) await bump("tiers");
  return send(res, 200, { ok: true });
}
async function crewTierList(res, q) {
  const id = String(q.get("crew") || "").toUpperCase(), b = boardBySlug[q.get("slug")], me = q.get("me") || "";
  if (!CREW_RE.test(id) || !b) return send(res, 400, { error: "Bad request." });
  const crew = await getCrew(id); if (!crew) return send(res, 404, { error: "That crew wasn't found." });
  return send(res, 200, { board: boardInfo(b), crew: { id, name: crew.name }, ...(await withPlaces(await crewTier(crew, b.slug, me), [])) });
}

// ---------- Quests ----------
// A quest and its spots (names and photos live from Google: the list's search when it's still in memory, else details).
async function questFor(crewId, id) {
  const crewIdU = String(crewId || "").toUpperCase();
  if (!CREW_RE.test(crewIdU) || !QUEST_RE.test(String(id || ""))) return null;
  const quest = await getQuest(crewIdU, id); if (!quest) return null;
  const b = boardBySlug[quest.slug];
  const fromList = b && quest.where && quest.where.kind !== "near" ? await ranked(b, quest.where).catch(() => []) : [];
  const P = await placesFor(quest.gids, fromList);
  return { quest, places: quest.gids.filter((g) => P[g]).map((g) => ({ ...P[g], gid: g })) };
}
async function questStart(req, res, b) {
  const me = String(b.me || ""), board = boardBySlug[b.slug], crewId = String(b.crew || "").toUpperCase();
  if (!PLAYER_RE.test(me) || !board || !CREW_RE.test(crewId)) return send(res, 400, { error: "Bad request." });
  const crew = await getCrew(crewId);
  if (!crew || !isMember(crew, me)) return send(res, 403, { error: "Join the crew first." });
  if (!(await allow(`rl:quest:${clientIp(req)}`, 20, 86400))) return send(res, 429, { error: "That's plenty of new quests for today." });
  let where = null, gids, title;
  if (Array.isArray(b.gids)) {
    // The crew's own list of places.
    gids = b.gids.map(String).filter((g) => /^[A-Za-z0-9_-]{6,300}$/.test(g)).slice(0, MAX_SPOTS);
    title = String(b.title || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 60) || `${crew.name}'s ${board.short} quest`;
  } else {
    where = await whereFrom(b);
    const list = await ranked(board, where);
    gids = list.slice(0, MAX_SPOTS).map((p) => p.gid);
    title = `${board.short}${where.kind === "all" ? "" : ` · ${where.label}`}`;
  }
  if (gids.length < 3) return send(res, 400, { error: "A quest needs at least 3 spots. Try a bigger area." });
  // A near-me quest doesn't keep where you were standing: the spot list is all it needs.
  const keepWhere = where && (where.kind === "near" ? { kind: "near", label: where.label, key: "quest-near" } : where);
  const quest = await createQuest(crew, { slug: board.slug, where: keepWhere, title, gids, by: me });
  await bump("quests");
  return send(res, 201, { id: quest.id, crew: crew.id });
}
async function questView(res, q) {
  const qt = await questFor(q.get("crew"), q.get("id")); if (!qt) return send(res, 404, { error: "That quest wasn't found." });
  const { quest, places } = qt, crew = await getCrew(quest.crew), b = boardBySlug[quest.slug], me = q.get("me") || "";
  const tried = await crewCheckins(crew);
  // The crew's ranking: its Tier It marks on the quest's spots (checked-in votes count double).
  const ct = await crewTier(crew, quest.slug, me), set = new Set(quest.gids);
  const ranking = ct.list.filter((r) => set.has(r.gid)).map((r) => ({ ...r, place: brief(places.find((p) => p.gid === r.gid)) })).filter((r) => r.place);
  const spots = places.map((p) => ({ ...brief(p), lat: p.lat, lng: p.lng, website: p.website || "", tried: tried[p.gid] || [] }));
  return send(res, 200, {
    quest: { id: quest.id, crew: quest.crew, crewName: crew.name, title: quest.title, at: quest.at, slug: quest.slug, where: quest.where ? whereInfo(quest.where) : null },
    board: boardInfo(b), progress: progressOf(quest, tried), ranking, hotTake: ct.hotTake && set.has(ct.hotTake.gid) ? { ...ct.hotTake, place: brief(places.find((p) => p.gid === ct.hotTake.gid)) } : null, spots,
  });
}
async function questList(res, q) {
  const id = String(q.get("crew") || "").toUpperCase();
  if (!CREW_RE.test(id)) return send(res, 400, { error: "Bad crew." });
  const crew = await getCrew(id); if (!crew) return send(res, 404, { error: "That crew wasn't found." });
  const tried = await crewCheckins(crew);
  return send(res, 200, { quests: (await crewQuests(id)).map((x) => ({ id: x.id, title: x.title, slug: x.slug, emoji: boardBySlug[x.slug]?.emoji || "🗺️", at: x.at, progress: progressOf(x, tried) })) });
}

// ---------- crews ----------
async function crewBoards(res, q) {
  const id = String(q.get("crew") || "").toUpperCase(), me = q.get("me") || "";
  if (!CREW_RE.test(id)) return send(res, 400, { error: "Bad crew." });
  const crew = await getCrew(id); if (!crew) return send(res, 404, { error: "That crew wasn't found." });
  const pids = memberPids(crew).slice(0, 40);
  const slugs = new Set((await pipeline(pids.map((p) => ["SMEMBERS", `tierslugs:${p}`]))).flat().filter(Boolean));
  const out = [];
  for (const b of BOARDS.filter((x) => slugs.has(x.slug)).slice(0, 10)) {
    const ct = await crewTier(crew, b.slug, me);
    if (!ct.list.length) continue;
    out.push({ ...boardInfo(b), ...(await withPlaces({ ...ct, list: ct.list.slice(0, 3), sayGo: [] }, [])) });
  }
  return send(res, 200, { boards: out });
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
      if (op === "tier") return await tier(res, q);
      if (op === "crewtier") return await crewTierList(res, q);
      if (op === "quest") return await questView(res, q);
      if (op === "quests") return await questList(res, q);
      if (op === "crew") return await crewBoards(res, q);
      if (op === "nearby") return await nearbyList(req, res, q);
      if (op === "tonight") return await tonightList(res, q);
      if (op === "mine") return PLAYER_RE.test(q.get("me") || "") ? send(res, 200, await myStats(q.get("me"))) : send(res, 400, { error: "Bad request." });
      return send(res, 404, { error: "Unknown." });
    }
    if (req.method !== "POST") return send(res, 405, { error: "Use GET or POST." });
    const b = body(req);
    if (b.op === "tierset") return await tierSet(req, res, b);
    if (b.op === "queststart") return await questStart(req, res, b);
    if (b.op === "checkin") return await doCheckin(req, res, b);
    return send(res, 400, { error: "Unknown." });
  } catch (e) {
    console.error(e);
    return fail(res, e);
  }
}
