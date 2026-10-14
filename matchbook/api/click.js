// POST /api/click  { code, kind }  counts taps on booking buttons (reserve, tickets, ride, website, call)
import { CODE_RE, redis, send, body, clientIp, allow, missingConfig } from "./_lib.js";

const KINDS = new Set(["reserve", "tickets", "ride", "website", "call", "maps"]);

export default async function handler(req, res) {
  if (missingConfig().length) return send(res, 503, { error: "Not set up." });
  if (req.method !== "POST") return send(res, 405, { error: "Use POST." });
  try {
    const b = body(req);
    const kind = String(b.kind || ""), code = String(b.code || "").toUpperCase();
    if (!KINDS.has(kind) || !CODE_RE.test(code)) return send(res, 400, { error: "Bad click." });
    if (!(await allow(`rl:click:${clientIp(req)}`, 120, 3600))) return send(res, 429, { error: "Too many." });
    const month = new Date().toISOString().slice(0, 7);
    await redis("HINCRBY", `stats:clicks:${month}`, kind, 1);
    return send(res, 200, { ok: true });
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: "Couldn't count that." });
  }
}
