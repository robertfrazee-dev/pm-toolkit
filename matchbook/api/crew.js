// GET  /api/crew?id=CREWID&me=PLAYER   the crew: members, the live deck if one's going, history and stats
// POST /api/crew { type: "create", name, playerId, playerName, fromCode? }  make a crew (optionally from a deck's people)
// POST /api/crew { type: "join", id, playerId, name }   join from a crew link
// POST /api/crew { type: "leave", id, playerId }
// POST /api/crew { type: "rename", id, playerId, name } the person who made it
import { CODE_RE, PLAYER_RE, redis, pipeline, hashToObject, send, body, clientIp, allow, missingConfig, cleanName, bump } from "./_lib.js";
import { CREW_RE, getCrew, saveCrew, newCrewId, addMember, isMember, memberPids, recordCrewDeck, crewStats } from "./_crew.js";
import { winnerOf } from "./action.js";

const crewName = (s) => String(s || "").replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 40);

async function read(res, q) {
  const id = String(q.get("id") || "").toUpperCase(), me = q.get("me") || "";
  const crew = await getCrew(id);
  if (!crew) return send(res, 404, { error: "That crew wasn't found." });
  const raw = await redis("LRANGE", `crew:${id}:history`, 0, 99);
  const history = (raw || []).map((x) => { try { return JSON.parse(x); } catch { return null; } }).filter(Boolean);
  // A deck the crew is on right now, if it hasn't finished.
  let live = null;
  if (crew.liveCode) {
    const [d, sw, rk] = await pipeline([["GET", `deck:${crew.liveCode}`], ["HGETALL", `deck:${crew.liveCode}:swipes`], ["HGETALL", `deck:${crew.liveCode}:ranks`]]);
    if (d) {
      const deck = JSON.parse(d), swipes = hashToObject(sw), ranks = hashToObject(rk);
      if (deck.phase !== "done" && !deck.announced) live = { code: crew.liveCode, phase: deck.phase, label: deck.label, area: deck.area, people: Object.keys(swipes).length, done: deck.phase === "ranking" ? Object.keys(ranks).length : Object.values(swipes).filter((s) => s.done).length, endsAt: deck.phase === "ranking" ? deck.rankEndsAt : deck.swipeEndsAt };
    }
  }
  // Remembered per person, so their votes on the boards count toward this crew's own top 3.
  if (PLAYER_RE.test(me) && isMember(crew, me)) await redis("SADD", `pcrews:${me}`, crew.id);
  const members = Object.entries(crew.members).map(([k, m]) => ({ key: k, name: m.name, me: PLAYER_RE.test(me) && m.pids.includes(me) })).sort((a, b) => b.me - a.me || a.name.localeCompare(b.name));
  return send(res, 200, {
    crew: { id: crew.id, name: crew.name, createdAt: crew.createdAt, owner: crew.ownerId === me, decks: history.length },
    members, live, stats: crewStats(history, crew),
    history: history.slice(0, 30).map((h) => ({ code: h.code, at: h.at, label: h.label, area: h.area, winner: h.winner != null ? h.places[h.winner] : null, people: Object.keys(h.people).length, matches: h.matches.length })),
  });
}

async function create(req, res, b, playerId) {
  if (!(await allow(`rl:crew:${clientIp(req)}`, 20, 3600))) return send(res, 429, { error: "Too many new crews. Try again later." });
  const name = crewName(b.name), me = cleanName(b.playerName);
  if (name.length < 2) return send(res, 400, { error: "Give the crew a name." });
  if (!me) return send(res, 400, { error: "Add your name first." });
  const crew = { id: await newCrewId(), name, ownerId: playerId, members: {}, createdAt: Date.now(), liveCode: null, decks: 0 };
  addMember(crew, playerId, me);
  // Made from a deck: everyone in it joins, and if it's finished it becomes the crew's first night.
  let fromDeck = null;
  if (CODE_RE.test(String(b.fromCode || "").toUpperCase())) {
    const code = String(b.fromCode).toUpperCase();
    const [d, sw, rk] = await pipeline([["GET", `deck:${code}`], ["HGETALL", `deck:${code}:swipes`], ["HGETALL", `deck:${code}:ranks`]]);
    if (d) {
      const deck = JSON.parse(d), swipes = hashToObject(sw), ranks = hashToObject(rk);
      for (const [pid, s] of Object.entries(swipes)) addMember(crew, pid, s.name);
      for (const [pid, r] of Object.entries(ranks)) addMember(crew, pid, r.name);
      if (!deck.crew) {
        deck.crew = crew.id;
        await redis("SET", `deck:${code}`, JSON.stringify(deck), "KEEPTTL");
        fromDeck = { code, deck, swipes, ranks };
      }
    }
  }
  await saveCrew(crew);
  await pipeline(memberPids(crew).map((pid) => ["SADD", `pcrews:${pid}`, crew.id]));
  if (fromDeck) {
    const { code, deck, swipes, ranks } = fromDeck;
    if (deck.phase === "done" || deck.announced) await recordCrewDeck(code, deck, winnerOf(deck, Object.values(ranks)), swipes, ranks);
    else { crew.liveCode = code; await saveCrew(crew); }
  }
  await bump("crews");
  return send(res, 201, { id: crew.id });
}

export default async function handler(req, res) {
  if (missingConfig().length) return send(res, 503, { error: "Not set up." });
  try {
    if (req.method === "GET") return await read(res, new URL(req.url, "http://x").searchParams);
    if (req.method !== "POST") return send(res, 405, { error: "Use GET or POST." });
    const b = body(req), playerId = String(b.playerId || "");
    if (!PLAYER_RE.test(playerId)) return send(res, 400, { error: "Bad player." });
    if (!(await allow(`rl:crewact:${clientIp(req)}`, 200, 600))) return send(res, 429, { error: "Slow down a little." });
    if (b.type === "create") return await create(req, res, b, playerId);
    const id = String(b.id || "").toUpperCase();
    if (!CREW_RE.test(id)) return send(res, 400, { error: "Bad crew." });
    const crew = await getCrew(id);
    if (!crew) return send(res, 404, { error: "That crew wasn't found." });
    if (b.type === "join") {
      const name = cleanName(b.name); if (!name) return send(res, 400, { error: "Add your name first." });
      if (addMember(crew, playerId, name)) await saveCrew(crew);
      await redis("SADD", `pcrews:${playerId}`, crew.id);
      return send(res, 200, { ok: true });
    }
    if (b.type === "leave") {
      for (const [k, m] of Object.entries(crew.members)) { m.pids = m.pids.filter((p) => p !== playerId); if (!m.pids.length) delete crew.members[k]; }
      await saveCrew(crew);
      await redis("SREM", `pcrews:${playerId}`, crew.id);
      return send(res, 200, { ok: true });
    }
    if (b.type === "rename") {
      if (crew.ownerId !== playerId) return send(res, 403, { error: "Only the person who made the crew can rename it." });
      const name = crewName(b.name); if (name.length < 2) return send(res, 400, { error: "Give the crew a name." });
      crew.name = name; await saveCrew(crew);
      return send(res, 200, { ok: true });
    }
    return send(res, 400, { error: "Unknown action." });
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: "Something went wrong. Try again." });
  }
}

