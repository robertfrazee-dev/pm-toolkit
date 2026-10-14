// GET /api/photo?name=places/<id>/photos/<ref>&w=800
// Redirects to the Google photo without putting the API key in the page.
// Vercel's CDN caches the redirect for a day, so each photo is billed rarely.
import { send, clientIp, allow, missingConfig } from "./_lib.js";

const NAME_RE = /^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/;

export default async function handler(req, res) {
  if (missingConfig().length) return send(res, 503, { error: "Not set up." });
  const q = new URL(req.url, "http://x").searchParams;
  const name = q.get("name") || "";
  const width = Math.min(Math.max(parseInt(q.get("w"), 10) || 800, 100), 1600);
  if (!NAME_RE.test(name)) return send(res, 400, { error: "Bad photo name." });
  try {
    if (!(await allow(`rl:photo:${clientIp(req)}`, 400, 3600))) return send(res, 429, { error: "Too many photos." });
    const r = await fetch(`https://places.googleapis.com/v1/${name}/media?maxWidthPx=${width}&skipHttpRedirect=true`, {
      headers: { "X-Goog-Api-Key": process.env.GOOGLE_MAPS_API_KEY },
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.photoUri) return send(res, 404, { error: "Photo not available." });
    res.statusCode = 302;
    res.setHeader("Location", j.photoUri);
    res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=86400");
    res.end();
  } catch (e) {
    console.error(e);
    return send(res, 502, { error: "Photo not available." });
  }
}
