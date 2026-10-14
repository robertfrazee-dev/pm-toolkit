// GET /api/hot?code=ABCDE            -> how every group on Matchbook rates this deck's places (only places with enough swipes)
// GET /api/hot?lat=..&lng=..&cat=bars -> the hot list near a point: places groups say yes to and pick most, this month and last
import { CATEGORIES } from "./_places.js";
import { CODE_RE, redis, send, clientIp, allow, missingConfig, underDailyCap, bump } from "./_lib.js";
import { placeStats, areaBoard } from "./_hot.js";

// Google doesn't allow keeping place names, so the hot list looks each one up fresh (a cheap, names-only lookup).
const DETAILS_FIELDS = "id,displayName,shortFormattedAddress,primaryTypeDisplayName,googleMapsUri,location";
async function details(gid) {
  const r = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(gid)}`, {
    headers: { "X-Goog-Api-Key": process.env.GOOGLE_MAPS_API_KEY, "X-Goog-FieldMask": DETAILS_FIELDS },
  });
  if (!r.ok) return null;
  const p = await r.json().catch(() => null);
  if (!p?.displayName?.text) return null;
  return {
    gid, name: p.displayName.text, kind: p.primaryTypeDisplayName?.text || "", address: p.shortFormattedAddress || "", maps: p.googleMapsUri || "",
    lat: p.location ? Math.round(p.location.latitude * 1e5) / 1e5 : null, lng: p.location ? Math.round(p.location.longitude * 1e5) / 1e5 : null,
  };
}

async function forDeck(res, code) {
  const raw = await redis("GET", `deck:${code}`);
  if (!raw) return send(res, 404, { error: `No deck with code ${code}.` });
  const deck = JSON.parse(raw);
  return send(res, 200, { stats: await placeStats(deck.places.map((p) => p.gid).filter(Boolean)) });
}

async function board(req, res, q) {
  const lat = Number(q.get("lat")), lng = Number(q.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return send(res, 400, { error: "Pick an area first." });
  const cat = CATEGORIES[q.get("cat")] ? q.get("cat") : "all";
  const top = await areaBoard(lat, lng, cat);
  const stats = await placeStats(top.map((t) => t.gid));
  // Only places with enough swipes from enough groups make the list, best first.
  const ranked = top.filter((t) => stats[t.gid]).slice(0, 10);
  if (ranked.length < 3) return send(res, 200, { places: [], building: true });
  if (!(await allow(`rl:hot:${clientIp(req)}`, 30, 3600))) return send(res, 429, { error: "Too many looks at the hot list. Try again in a bit." });
  if (!(await underDailyCap("hot", Number(process.env.HOT_DAILY_LIMIT) || 200))) return send(res, 503, { error: "The hot list is resting for today. Try again tomorrow." });
  await bump("hot_views");
  const found = await Promise.all(ranked.map((t) => details(t.gid).catch(() => null)));
  const places = found.map((p, i) => p && { ...p, ...stats[ranked[i].gid], cat: cat === "all" ? "" : cat }).filter(Boolean);
  return send(res, 200, { places, building: places.length < 3 });
}

export default async function handler(req, res) {
  if (missingConfig().length) return send(res, 503, { error: "Not set up." });
  if (req.method !== "GET") return send(res, 405, { error: "Use GET." });
  try {
    const q = new URL(req.url, "http://x").searchParams;
    const code = String(q.get("code") || "").toUpperCase();
    if (code) return CODE_RE.test(code) ? await forDeck(res, code) : send(res, 400, { error: "Bad deck code." });
    return await board(req, res, q);
  } catch (e) {
    console.error(e);
    return send(res, 502, { error: "Couldn't load the hot list. Try again in a minute." });
  }
}
