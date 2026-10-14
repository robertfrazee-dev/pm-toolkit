// POST /api/push  { playerId, token }  remembers this phone so the app can notify it about its decks
import { PLAYER_RE, redis, send, body, clientIp, allow, missingConfig } from "./_lib.js";
import { PUSH_TTL } from "./_push.js";

const TOKEN_RE = /^[A-Fa-f0-9]{32,200}$/;

export default async function handler(req, res) {
  if (missingConfig().length) return send(res, 503, { error: "Not set up." });
  if (req.method !== "POST") return send(res, 405, { error: "Use POST." });
  try {
    const b = body(req);
    const playerId = String(b.playerId || ""), token = String(b.token || "");
    if (!PLAYER_RE.test(playerId) || !TOKEN_RE.test(token)) return send(res, 400, { error: "Bad player or device token." });
    if (!(await allow(`rl:push:${clientIp(req)}`, 60, 3600))) return send(res, 429, { error: "Too many requests." });
    await redis("SET", `push:${playerId}`, token, "EX", PUSH_TTL);
    return send(res, 200, { ok: true });
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: "Couldn't turn on notifications. Try again." });
  }
}
