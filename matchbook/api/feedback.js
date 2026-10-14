// POST /api/feedback  { code, playerId, vote: "up" | "down", text? }  the "would you use this again?" answer
import { CODE_RE, PLAYER_RE, pipeline, send, body, clientIp, allow, missingConfig, bump } from "./_lib.js";

export default async function handler(req, res) {
  if (missingConfig().length) return send(res, 503, { error: "Not set up." });
  if (req.method !== "POST") return send(res, 405, { error: "Use POST." });
  try {
    const b = body(req);
    const vote = b.vote === "up" ? "up" : b.vote === "down" ? "down" : "";
    const code = String(b.code || "").toUpperCase(), playerId = String(b.playerId || "");
    if (!vote || !CODE_RE.test(code) || !PLAYER_RE.test(playerId)) return send(res, 400, { error: "Bad feedback." });
    if (!(await allow(`rl:fb:${clientIp(req)}`, 30, 3600))) return send(res, 429, { error: "Thanks, that's plenty for now." });
    const text = String(b.text || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 300);
    await bump(`fb_${vote}`);
    if (text) await pipeline([["LPUSH", "feedback", JSON.stringify({ at: Date.now(), vote, text, code })], ["LTRIM", "feedback", 0, 499]]);
    return send(res, 200, { ok: true });
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: "Couldn't send that. Try again." });
  }
}
