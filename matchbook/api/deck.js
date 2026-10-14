// GET  /api/deck?code=ABCDE  -> the deck plus everyone's swipes and rankings
// POST /api/deck             -> look up places with Google and start a new deck
import { parseMood } from "./_mood.js";
import { TTL, CODE_RE, PLAYER_RE, redis, pipeline, hashToObject, send, body, clientIp, allow, missingConfig } from "./_lib.js";

const PLACES = "https://places.googleapis.com/v1/places:searchText";
const FIELDS = [
  "places.id", "places.displayName", "places.formattedAddress", "places.shortFormattedAddress", "places.location",
  "places.rating", "places.userRatingCount", "places.priceLevel", "places.primaryTypeDisplayName", "places.photos",
  "places.googleMapsUri", "places.websiteUri", "places.nationalPhoneNumber", "places.editorialSummary", "places.businessStatus", "places.currentOpeningHours.openNow",
  "nextPageToken",
].join(",");

// What we ask Google for in each category.
export const CATEGORIES = {
  bars: { label: "Bars", query: "bars" },
  restaurants: { label: "Restaurants", query: "restaurants" },
  coffee: { label: "Coffee & brunch", query: "coffee shops and brunch" },
  activities: { label: "Activities", query: "fun things to do bowling arcade escape room mini golf" },
  sights: { label: "Sights & tourism", query: "tourist attractions and museums" },
  outdoors: { label: "Outdoors", query: "parks trails and outdoor spots" },
  music: { label: "Live music", query: "live music venues" },
  dessert: { label: "Dessert", query: "dessert and ice cream" },
};
const PRICE = { PRICE_LEVEL_FREE: "Free", PRICE_LEVEL_INEXPENSIVE: "$", PRICE_LEVEL_MODERATE: "$$", PRICE_LEVEL_EXPENSIVE: "$$$", PRICE_LEVEL_VERY_EXPENSIVE: "$$$$" };
const PRICE_LEVELS = ["PRICE_LEVEL_INEXPENSIVE", "PRICE_LEVEL_MODERATE", "PRICE_LEVEL_EXPENSIVE", "PRICE_LEVEL_VERY_EXPENSIVE"];
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const MI = 1609.344;

async function google(payload) {
  const r = await fetch(PLACES, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": process.env.GOOGLE_MAPS_API_KEY, "X-Goog-FieldMask": FIELDS },
    body: JSON.stringify(payload),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(j.error?.message || `Google Places returned ${r.status}`);
    err.google = true;
    throw err;
  }
  return j;
}

function miles(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude), dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return (2 * 6371000 * Math.asin(Math.sqrt(h))) / MI;
}

function box(center, radiusMi) {
  const dLat = (radiusMi * MI) / 111320;
  const dLng = dLat / Math.max(Math.cos((center.latitude * Math.PI) / 180), 0.01);
  return {
    low: { latitude: Math.max(center.latitude - dLat, -90), longitude: Math.max(center.longitude - dLng, -180) },
    high: { latitude: Math.min(center.latitude + dLat, 90), longitude: Math.min(center.longitude + dLng, 180) },
  };
}

function shape(p, i, center) {
  const photo = p.photos?.[0];
  return {
    id: "p" + (i + 1),
    name: p.displayName?.text || "Unnamed place",
    kind: p.primaryTypeDisplayName?.text || "",
    address: p.shortFormattedAddress || p.formattedAddress || "",
    distance: p.location ? Math.round(miles(center, p.location) * 10) / 10 : null,
    rating: p.rating ?? null,
    ratings: p.userRatingCount ?? 0,
    price: PRICE[p.priceLevel] || "",
    summary: p.editorialSummary?.text || "",
    openNow: p.currentOpeningHours?.openNow ?? null,
    maps: p.googleMapsUri || "",
    website: p.websiteUri || "",
    phone: p.nationalPhoneNumber || "",
    lat: p.location ? Math.round(p.location.latitude * 1e5) / 1e5 : null,
    lng: p.location ? Math.round(p.location.longitude * 1e5) / 1e5 : null,
    photo: photo?.name || "",
    photoBy: photo?.authorAttributions?.[0]?.displayName || "",
  };
}

async function create(req, res) {
  const b = body(req);
  const radius = Math.min(Math.max(Number(b.radiusMi) || 3, 0.5), 25);
  const count = Math.min(Math.max(Math.round(Number(b.count) || 15), 5), 40);
  const cat = CATEGORIES[b.category] ? b.category : "any";
  // A sentence like "cheap wings at a sports bar in Hoboken" becomes the search, the area and the filters.
  // With a category chip it narrows that category; with "Anything" it is the whole search.
  const raw = String(b.mood ?? b.custom ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  const parsed = parseMood(raw);
  const mood = (parsed.query || raw).slice(0, 80);
  if (cat === "any" && !mood) return send(res, 400, { error: "Type what you're in the mood for, or pick a kind of place." });

  if (!(await allow(`rl:create:${clientIp(req)}`, 20, 3600))) {
    return send(res, 429, { error: "Too many new decks from this connection. Try again in an hour." });
  }

  // Where to search: the phone's location, or the place the person typed.
  let center, areaLabel;
  const lat = Number(b.lat), lng = Number(b.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng) && b.lat !== null && b.lng !== null) {
    // Round to about 100 m: plenty for a search radius, and we don't keep anyone's exact position.
    center = { latitude: Math.round(lat * 1000) / 1000, longitude: Math.round(lng * 1000) / 1000 };
    areaLabel = String(b.areaLabel || "your location").slice(0, 80);
  } else {
    const area = (String(b.area || "").trim() || parsed.area).slice(0, 120);
    if (!area) return send(res, 400, { error: "Where should we look? Add a neighborhood or city (or say \"in Hoboken\"), or tap Near me." });
    const found = await google({ textQuery: area, pageSize: 1 });
    const hit = found.places?.[0];
    if (!hit?.location) return send(res, 404, { error: `Couldn't find "${area}" on the map. Try adding the city or state.` });
    center = hit.location;
    areaLabel = area;
  }

  const textQuery = cat === "any" ? mood : mood ? `${mood} ${CATEGORIES[cat].query}` : CATEGORIES[cat].query;
  const query = { textQuery, pageSize: 20, locationRestriction: { rectangle: box(center, radius) } };
  if (b.openNow || parsed.openNow) query.openNow = true;
  const maxPrice = Math.round(Number(b.maxPrice) || parsed.maxPrice || 0);
  if (maxPrice >= 1 && maxPrice <= 4) query.priceLevels = PRICE_LEVELS.slice(0, maxPrice);

  // Up to 3 pages of 20, keeping only places inside the circle.
  const seen = new Set(), kept = [];
  let pageToken;
  for (let page = 0; page < 3 && kept.length < count; page++) {
    const r = await google(pageToken ? { ...query, pageToken } : query);
    for (const p of r.places || []) {
      if (seen.has(p.id) || (p.businessStatus && p.businessStatus !== "OPERATIONAL")) continue;
      seen.add(p.id);
      if (p.location && miles(center, p.location) > radius) continue;
      kept.push(p);
    }
    pageToken = r.nextPageToken;
    if (!pageToken) break;
  }
  if (!kept.length) return send(res, 404, { error: "Google found nothing that fits. Try a bigger radius or turn off filters." });

  const places = kept.slice(0, count).map((p, i) => shape(p, i, center));
  const deck = {
    category: cat, mood, label: mood ? mood.charAt(0).toUpperCase() + mood.slice(1) : CATEGORIES[cat].label,
    area: areaLabel, radius, center, places, phase: "swiping", matches: [], createdAt: Date.now(),
    hostId: PLAYER_RE.test(String(b.playerId || "")) ? b.playerId : null,
  };
  for (let tries = 0; tries < 5; tries++) {
    let code = "";
    for (let i = 0; i < 5; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    const ok = await redis("SET", `deck:${code}`, JSON.stringify({ ...deck, code }), "EX", TTL, "NX");
    if (ok === "OK") return send(res, 201, { code });
  }
  return send(res, 500, { error: "Couldn't save the deck. Try again." });
}

// Affiliate IDs are public by nature (they end up in links), so the page gets them with the deck.
// Leave them unset to send people to the booking sites without a partner tag.
function bookingConfig() {
  return {
    opentableWrap: process.env.OPENTABLE_LINK_TEMPLATE || "", // e.g. an affiliate network link with {url} where the OpenTable URL goes
    viatorPid: process.env.VIATOR_PID || "",
    viatorMcid: process.env.VIATOR_MCID || "",
  };
}

async function read(req, res) {
  const code = String(req.query?.code || new URL(req.url, "http://x").searchParams.get("code") || "").toUpperCase();
  if (!CODE_RE.test(code)) return send(res, 400, { error: "Deck codes are 5 letters and numbers." });
  const [deck, swipes, ranks] = await pipeline([["GET", `deck:${code}`], ["HGETALL", `deck:${code}:swipes`], ["HGETALL", `deck:${code}:ranks`]]);
  if (!deck) return send(res, 404, { error: `No deck with code ${code}. It may have expired after a week.` });
  return send(res, 200, { deck: JSON.parse(deck), swipes: hashToObject(swipes), ranks: hashToObject(ranks), booking: bookingConfig() });
}

export default async function handler(req, res) {
  const missing = missingConfig();
  if (missing.length) return send(res, 503, { error: "The app isn't set up yet. Missing: " + missing.join(", ") });
  try {
    if (req.method === "GET") return await read(req, res);
    if (req.method === "POST") return await create(req, res);
    return send(res, 405, { error: "Use GET or POST." });
  } catch (e) {
    console.error(e);
    return send(res, 502, { error: e.google ? "Google Places error: " + e.message : "Something went wrong on the server. Try again." });
  }
}
