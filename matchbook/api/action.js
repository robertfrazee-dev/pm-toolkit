// POST /api/action  { code, playerId, name, type, ... }
//   type "swipe": { likes, passes, done }  saves this player's swipes
//   type "rank":  { order }                 saves this player's ranking
//   type "phase": { matches }               moves the deck to the ranking round
import { TTL, CODE_RE, PLAYER_RE, redis, pipeline, send, body, clientIp, allow, missingConfig, cleanName, cleanIds } from "./_lib.js";

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
      if (deck.phase !== "ranking") return send(res, 409, { error: "Ranking hasn't started for this deck." });
      const order = cleanIds(b.order, new Set(deck.matches));
      if (order.length !== deck.matches.length) return send(res, 400, { error: "Rank every match before submitting." });
      const entry = { playerId, name, order, at: Date.now() };
      await pipeline([["HSET", `deck:${code}:ranks`, playerId, JSON.stringify(entry)], ["EXPIRE", `deck:${code}:ranks`, TTL]]);
      return send(res, 200, { ok: true });
    }

    if (b.type === "phase") {
      if (deck.phase === "ranking") return send(res, 200, { ok: true, matches: deck.matches });
      const matches = cleanIds(b.matches, valid);
      if (!matches.length) return send(res, 400, { error: "There's nothing to rank yet." });
      await redis("SET", `deck:${code}`, JSON.stringify({ ...deck, phase: "ranking", matches, rankingAt: Date.now() }), "KEEPTTL");
      return send(res, 200, { ok: true, matches });
    }

    return send(res, 400, { error: "Unknown action." });
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: "Something went wrong on the server. Try again." });
  }
}
