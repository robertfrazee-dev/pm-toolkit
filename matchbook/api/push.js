// POST /api/push  { playerId, token }  remembers this iPhone (app) so Matchbook can notify it about its decks
// POST /api/push  { playerIds, sub }   remembers a browser's web push subscription for these players
// GET  /api/push                      the public key browsers need to subscribe
import crypto from "node:crypto";
import { PLAYER_RE, redis, pipeline, send, body, clientIp, allow, missingConfig } from "./_lib.js";
import { PUSH_TTL } from "./_push.js";
import { vapidKeys, validSub } from "./_webpush.js";

const TOKEN_RE = /^[A-Fa-f0-9]{32,200}$/;

export default async function handler(req, res) {
  if (missingConfig().length) return send(res, 503, { error: "Not set up." });
  try {
    if (req.method === "GET") return send(res, 200, { publicKey: (await vapidKeys()).publicKey });
    if (req.method !== "POST") return send(res, 405, { error: "Use GET or POST." });
    const b = body(req);
    if (!(await allow(`rl:push:${clientIp(req)}`, 60, 3600))) return send(res, 429, { error: "Too many requests." });
    if (b.sub) {
      // One browser can stand in for more than one player id (e.g. after "that's me" on another device's name).
      const ids = [...new Set((Array.isArray(b.playerIds) ? b.playerIds : [b.playerId]).map(String))].filter((id) => PLAYER_RE.test(id)).slice(0, 10);
      if (!ids.length || !validSub(b.sub)) return send(res, 400, { error: "Bad subscription." });
      const sub = { endpoint: b.sub.endpoint, keys: { p256dh: b.sub.keys.p256dh, auth: b.sub.keys.auth } };
      const key = crypto.createHash("sha256").update(sub.endpoint).digest("hex").slice(0, 24);
      await pipeline(ids.flatMap((id) => [["HSET", `wpush:${id}`, key, JSON.stringify(sub)], ["EXPIRE", `wpush:${id}`, PUSH_TTL]]));
      return send(res, 200, { ok: true });
    }
    const playerId = String(b.playerId || ""), token = String(b.token || "");
    if (!PLAYER_RE.test(playerId) || !TOKEN_RE.test(token)) return send(res, 400, { error: "Bad player or device token." });
    await redis("SET", `push:${playerId}`, token, "EX", PUSH_TTL);
    return send(res, 200, { ok: true });
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: "Couldn't turn on notifications. Try again." });
  }
}
