// GET  /api/deck?code=ABCDE  -> the deck plus everyone's swipes and rankings
// POST /api/deck             -> look up places with Google and start a new deck
import { parseMood } from "./_mood.js";
import { CATEGORIES, PRICE_LEVELS, CHAINS, google, shape, findPlaces } from "./_places.js";
export { CATEGORIES };
import { TTL, CODE_RE, PLAYER_RE, bump, underDailyCap, redis, pipeline, hashToObject, send, body, clientIp, allow, missingConfig } from "./_lib.js";

const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

async function create(req, res) {
  const b = body(req);
  if (Array.isArray(b.saved)) return createFromSaved(req, res, b);
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
  // Every Google-backed deck costs money, so there's a ceiling per day (DAILY_DECK_LIMIT, default 300).
  if (!(await underDailyCap("decks", Number(process.env.DAILY_DECK_LIMIT) || 300))) {
    return send(res, 503, { error: "Matchbook hit its limit for new searches today. Try again tomorrow, or swipe your saved places." });
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
  const maxPrice = Math.round(Number(b.maxPrice) || parsed.maxPrice || 0);
  // Kept with the deck so "Deal 10 more" can run the same search again.
  const search = {
    textQuery, center, radius, openNow: !!(b.openNow || parsed.openNow),
    priceLevels: maxPrice >= 1 && maxPrice <= 4 ? PRICE_LEVELS.slice(0, maxPrice) : [],
    skipChains: !CHAINS.test(mood),
  };
  const kept = await findPlaces(search, { want: count });
  if (!kept.length) return send(res, 404, { error: "Google found nothing that fits. Try a bigger radius or turn off filters." });

  const places = kept.map((p, i) => shape(p, i, center));
  const deck = {
    category: cat, mood, label: mood ? mood.charAt(0).toUpperCase() + mood.slice(1) : CATEGORIES[cat].label,
    area: areaLabel, radius, center, places, phase: "swiping", matches: [], createdAt: Date.now(), search, deals: 0,
    hostId: PLAYER_RE.test(String(b.playerId || "")) ? b.playerId : null,
  };
  await bump("decks_google");
  return saveDeck(res, deck);
}

async function saveDeck(res, deck) {
  for (let tries = 0; tries < 5; tries++) {
    let code = "";
    for (let i = 0; i < 5; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    const ok = await redis("SET", `deck:${code}`, JSON.stringify({ ...deck, code }), "EX", TTL, "NX");
    if (ok === "OK") return send(res, 201, { code });
  }
  return send(res, 500, { error: "Couldn't save the deck. Try again." });
}

// A deck made from someone's saved places: no Google search, so it costs nothing.
// The places come from the phone, so keep only plain text and https links.
const text = (v, n) => String(v ?? "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, n);
const https = (v) => (/^https:\/\/[^\s"'<>]+$/i.test(String(v || "")) ? String(v).slice(0, 500) : "");
const coord = (v, lo, hi) => (Number.isFinite(+v) && +v >= lo && +v <= hi && v !== null && v !== "" ? Math.round(+v * 1e5) / 1e5 : null);

async function createFromSaved(req, res, b) {
  const seen = new Set();
  const places = b.saved.slice(0, 40).map((f) => ({
    gid: text(f?.gid, 200), name: text(f?.name, 80), kind: text(f?.kind, 40), address: text(f?.address, 100),
    price: /^\${1,4}$/.test(f?.price) ? f.price : "", maps: https(f?.maps), website: https(f?.website),
    phone: text(f?.phone, 30).replace(/[^\d+()\-. ]/g, ""), lat: coord(f?.lat, -90, 90), lng: coord(f?.lng, -180, 180),
    cat: CATEGORIES[f?.category] ? f.category : "", rating: null, ratings: 0, summary: "", openNow: null, photo: "", photoBy: "", distance: null,
  })).filter((p) => p.name && !seen.has(p.gid || p.name) && seen.add(p.gid || p.name)).map((p, i) => ({ id: "p" + (i + 1), ...p }));
  if (places.length < 2) return send(res, 400, { error: "Save at least two places to swipe on them." });
  if (!(await allow(`rl:create:${clientIp(req)}`, 20, 3600))) return send(res, 429, { error: "Too many new decks from this connection. Try again in an hour." });
  const pts = places.filter((p) => p.lat != null);
  const center = pts.length ? { latitude: pts.reduce((a, p) => a + p.lat, 0) / pts.length, longitude: pts.reduce((a, p) => a + p.lng, 0) / pts.length } : null;
  await bump("decks_saved");
  // The same kind of deck can come from the hot list; it's labeled for where it came from.
  const hot = b.source === "hot", near = text(b.area, 60);
  return saveDeck(res, {
    category: "saved", mood: "", label: hot ? (near ? `Hot near ${near}` : "Hot nearby") : "Our saved places", area: hot ? "the hot list" : "your saved list", radius: 0, center, places,
    phase: "swiping", matches: [], createdAt: Date.now(), hostId: PLAYER_RE.test(String(b.playerId || "")) ? b.playerId : null,
  });
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
    return send(res, 502, { error: e.friendly || "Something went wrong on our end. Try again in a minute." });
  }
}
