// POST /api/click  { code, kind }  counts taps on booking buttons (reserve, tickets, ride, website, call)
// POST /api/click  { kind: "event", e: "link_opened"|"same_crew", code, pid, crew }  product events seen only in the browser
import { CODE_RE, PLAYER_RE, redis, send, body, clientIp, allow, missingConfig, bump } from "./_lib.js";
import { track } from "./_events.js";
const CLIENT_EVENTS = new Set(["link_opened", "same_crew", "tab_opened"]);

const KINDS = new Set(["reserve", "resy", "tickets", "ride", "website", "call", "maps"]);

export default async function handler(req, res) {
  if (missingConfig().length) return send(res, 503, { error: "Not set up." });
  if (req.method !== "POST") return send(res, 405, { error: "Use POST." });
  try {
    const b = body(req);
    const kind = String(b.kind || ""), code = String(b.code || "").toUpperCase();
    if (kind === "event") {
      const pid = PLAYER_RE.test(String(b.pid || "")) ? b.pid : "", crew = /^[A-Z0-9]{8}$/.test(String(b.crew || "")) ? b.crew : "";
      if (!CLIENT_EVENTS.has(b.e) || (code && !CODE_RE.test(code))) return send(res, 400, { error: "Bad event." });
      if (!(await allow(`rl:ev:${clientIp(req)}`, 300, 3600))) return send(res, 429, { error: "Too many." });
      await track(b.e, { pid, code, crew });
      return send(res, 200, { ok: true });
    }
    if (!KINDS.has(kind) || !CODE_RE.test(code)) return send(res, 400, { error: "Bad click." });
    if (!(await allow(`rl:click:${clientIp(req)}`, 120, 3600))) return send(res, 429, { error: "Too many." });
    const month = new Date().toISOString().slice(0, 7);
    await redis("HINCRBY", `stats:clicks:${month}`, kind, 1);
    await bump(`tap_${kind}`);
    return send(res, 200, { ok: true });
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: "Couldn't count that." });
  }
}
