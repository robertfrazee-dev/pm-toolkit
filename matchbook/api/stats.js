// GET /api/stats?days=30  with header x-stats-key: <STATS_KEY>  → daily counts for the owner's stats page
import { pipeline, send } from "./_lib.js";

export default async function handler(req, res) {
  const key = process.env.STATS_KEY;
  if (!key) return send(res, 404, { error: "Stats are off. Set STATS_KEY in Vercel to turn them on." });
  if (req.headers["x-stats-key"] !== key) return send(res, 401, { error: "Wrong stats key." });
  try {
    const n = Math.min(Math.max(parseInt(new URL(req.url, "http://x").searchParams.get("days"), 10) || 30, 1), 120);
    const dates = Array.from({ length: n }, (_, i) => new Date(Date.now() - i * 864e5).toISOString().slice(0, 10));
    const rows = await pipeline(dates.map((d) => ["HGETALL", `stats:day:${d}`]));
    const days = dates.map((date, i) => ({ date, ...Object.fromEntries(Object.entries(hashToNumbers(rows[i]))) }));
    const [fb] = await pipeline([["LRANGE", "feedback", 0, 49]]);
    const feedback = (fb || []).map((x) => { try { return JSON.parse(x); } catch { return null; } }).filter(Boolean);
    return send(res, 200, { days, feedback });
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: "Couldn't load stats." });
  }
}

function hashToNumbers(flat) {
  const out = {};
  for (let i = 0; i + 1 < (flat || []).length; i += 2) out[flat[i]] = Number(flat[i + 1]) || 0;
  return out;
}
