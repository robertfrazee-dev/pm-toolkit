// POST /api/action  { code, playerId, name, type, ... }
//   type "swipe": { likes, passes, done }  saves this player's swipes
//   type "rank":  { order }                 saves this player's ranking
//   type "phase": { minYes }                host only: places with at least minYes yeses go to the ranking round
//   type "close": {}                        host only: ends ranking so the result is final
import { TTL, CODE_RE, PLAYER_RE, redis, pipeline, hashToObject, send, body, clientIp, allow, missingConfig, cleanName, cleanIds } from "./_lib.js";

const MAX_RANKED = 10; // more than this is a chore to drag around on a phone

export default async function handler(req, res) {
  const missing = missingConfig();
  if (missing.length) return send(res, 503, { error: "The app isn't set up yet. Missing: " + missing.join(", ") });
  if (req.method !== "POST") return send(res, 405, { error: "Use POST." });
  try {
    const b = body(req);
    const code = String(b.code || "").toUpperCase();
    const playerId = String(b.playerId || "");
    if (!CODE_RE.test(code) || !PLAYER_RE.test(playerId)) return send(res, 400, { error: "Bad deck code or player." });
    if (!(await allow(`rl:act:${clientIp(req)}`, 600, 600))) return send(res, 429, { error: "Slow down a little and try again." });

    const raw = await redis("GET", `deck:${code}`);
    if (!raw) return send(res, 404, { error: `No deck with code ${code}.` });
    const deck = JSON.parse(raw);
    const valid = new Set(deck.places.map((p) => p.id));
    const name = cleanName(b.name) || "Someone";

    if (b.type === "swipe") {
      const likes = cleanIds(b.likes, valid);
      const passes = cleanIds(b.passes, valid).filter((id) => !likes.includes(id));
      const entry = { playerId, name, likes, passes, done: !!b.done, at: Date.now() };
      await pipeline([["HSET", `deck:${code}:swipes`, playerId, JSON.stringify(entry)], ["EXPIRE", `deck:${code}:swipes`, TTL]]);
      return send(res, 200, { ok: true });
    }

    if (b.type === "rank") {
      if (deck.phase !== "ranking") return send(res, 409, { error: deck.phase === "done" ? "Voting is closed for this deck." : "Ranking hasn't started for this deck." });
      const order = cleanIds(b.order, new Set(deck.matches));
      if (order.length !== deck.matches.length) return send(res, 400, { error: "Rank every match before submitting." });
      const entry = { playerId, name, order, at: Date.now() };
      await pipeline([["HSET", `deck:${code}:ranks`, playerId, JSON.stringify(entry)], ["EXPIRE", `deck:${code}:ranks`, TTL]]);
      return send(res, 200, { ok: true });
    }

    const isHost = !deck.hostId || deck.hostId === playerId;

    if (b.type === "phase") {
      if (!isHost) return send(res, 403, { error: "Only the person who started this deck can start ranking." });
      if (deck.phase !== "swiping") return send(res, 200, { ok: true, matches: deck.matches });
      const swipes = Object.values(hashToObject(await redis("HGETALL", `deck:${code}:swipes`)));
      const voters = Math.max(swipes.length, 1);
      const minYes = Math.min(Math.max(Math.round(Number(b.minYes) || voters), 1), voters);
      const yes = {};
      for (const s of swipes) for (const id of s.likes || []) if (valid.has(id)) yes[id] = (yes[id] || 0) + 1;
      const matches = deck.places.map((p) => p.id).filter((id) => (yes[id] || 0) >= minYes)
        .sort((x, y) => yes[y] - yes[x]).slice(0, MAX_RANKED);
      if (!matches.length) return send(res, 400, { error: `No place has ${minYes} yeses yet. Lower the bar or wait for more swipes.` });
      await redis("SET", `deck:${code}`, JSON.stringify({ ...deck, phase: "ranking", matches, minYes, voters, rankingAt: Date.now() }), "KEEPTTL");
      return send(res, 200, { ok: true, matches });
    }

    if (b.type === "close") {
      if (!isHost) return send(res, 403, { error: "Only the person who started this deck can close voting." });
      if (deck.phase === "ranking") await redis("SET", `deck:${code}`, JSON.stringify({ ...deck, phase: "done", closedAt: Date.now() }), "KEEPTTL");
      return send(res, 200, { ok: true });
    }

    return send(res, 400, { error: "Unknown action." });
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: "Something went wrong on the server. Try again." });
  }
}
