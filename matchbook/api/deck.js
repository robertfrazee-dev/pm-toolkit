// GET  /api/deck?code=ABCDE  -> the deck plus everyone's swipes and rankings
// POST /api/deck             -> look up places with Google and start a new deck
import { parseMood } from "./_mood.js";
import { CATEGORIES, PRICE_LEVELS, CHAINS, google, shape, findPlaces } from "./_places.js";
export { CATEGORIES };
import { TTL, CODE_RE, PLAYER_RE, bump, underDailyCap, redis, pipeline, hashToObject, send, body, clientIp, allow, missingConfig } from "./_lib.js";

const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

const fail = (status, message) => Object.assign(new Error(message), { status, friendly: message });

// Reads what to search for from the composer's fields. Throws a readable error for anything missing.
export function readSearch(b) {
  const radius = Math.min(Math.max(Number(b.radiusMi) || 3, 0.5), 25);
  const count = Math.min(Math.max(Math.round(Number(b.count) || 15), 5), 40);
  const cat = CATEGORIES[b.category] ? b.category : "any";
  // A sentence like "cheap wings at a sports bar in Hoboken" becomes the search, the area and the filters.
  // With a category chip it narrows that category; with "Anything" it is the whole search.
  const raw = String(b.mood ?? b.custom ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  const parsed = parseMood(raw);
  const mood = (parsed.query || raw).slice(0, 80);
  if (cat === "any" && !mood) throw fail(400, "Type what you're in the mood for, or pick a kind of place.");
  const lat = Number(b.lat), lng = Number(b.lng);
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng) && b.lat !== null && b.lng !== null;
  const area = (String(b.area || "").trim() || parsed.area).slice(0, 120);
  if (!hasCoords && !area) throw fail(400, "Where should we look? Add a neighborhood or city (or say \"in Hoboken\"), or tap Near me.");
  return {
    radius, count, cat, mood, area, areaLabel: String(b.areaLabel || "your location").slice(0, 80),
    // Round to about 100 m: plenty for a search radius, and we don't keep anyone's exact position.
    center: hasCoords ? { latitude: Math.round(lat * 1000) / 1000, longitude: Math.round(lng * 1000) / 1000 } : null,
    maxPrice: Math.round(Number(b.maxPrice) || parsed.maxPrice || 0), openNow: !!(b.openNow || parsed.openNow),
    hostId: PLAYER_RE.test(String(b.playerId || "")) ? b.playerId : null,
  };
}

// Where to search: the phone's location, or the place the person typed (looked up on the map once).
export async function locate(q) {
  if (q.center) return { center: q.center, areaLabel: q.areaLabel };
  const found = await google({ textQuery: q.area, pageSize: 1 });
  const hit = found.places?.[0];
  if (!hit?.location) throw fail(404, `Couldn't find "${q.area}" on the map. Try adding the city or state.`);
  return { center: hit.location, areaLabel: q.area };
}

// Runs the Google search and returns a new deck (not saved yet).
export async function buildDeck(q, { center, areaLabel }) {
  const { cat, mood, radius, maxPrice } = q;
  const textQuery = cat === "any" ? mood : mood ? `${mood} ${CATEGORIES[cat].query}` : CATEGORIES[cat].query;
  // Kept with the deck so "Deal 10 more" can run the same search again.
  const search = {
    textQuery, center, radius, openNow: q.openNow,
    priceLevels: maxPrice >= 1 && maxPrice <= 4 ? PRICE_LEVELS.slice(0, maxPrice) : [],
    skipChains: !CHAINS.test(mood),
  };
  const kept = await findPlaces(search, { want: q.count });
  if (!kept.length) throw fail(404, "Google found nothing that fits. Try a bigger radius or turn off filters.");
  return {
    category: cat, mood, label: mood ? mood.charAt(0).toUpperCase() + mood.slice(1) : CATEGORIES[cat].label,
    area: areaLabel, radius, center, places: kept.map((p, i) => shape(p, i, center)), phase: "swiping", matches: [],
    createdAt: Date.now(), search, deals: 0, hostId: q.hostId,
  };
}

// Limits on anything that runs a Google search: per connection per hour, and for the whole app per day.
export async function searchAllowed(req) {
  if (!(await allow(`rl:create:${clientIp(req)}`, 20, 3600))) throw fail(429, "Too many new decks from this connection. Try again in an hour.");
  // Every Google-backed deck costs money, so there's a ceiling per day (DAILY_DECK_LIMIT, default 300).
  if (!(await underDailyCap("decks", Number(process.env.DAILY_DECK_LIMIT) || 300))) {
    throw fail(503, "Matchbook hit its limit for new searches today. Try again tomorrow, or swipe your saved places.");
  }
}

async function create(req, res) {
  const b = body(req);
  if (Array.isArray(b.saved)) return createFromSaved(req, res, b);
  const q = readSearch(b);
  await searchAllowed(req);
  const deck = await buildDeck(q, await locate(q));
  await bump("decks_google");
  await countHost(q.hostId);
  return saveDeck(res, deck);
}

// Growth signal for the stats page: someone who first came in through a friend's link starts a deck of their own.
export async function countHost(hostId) {
  if (!hostId) return;
  try {
    const [first, joined] = await pipeline([["SET", `seen:hosted:${hostId}`, "1", "EX", 60 * 864e2, "NX"], ["GET", `seen:joined:${hostId}`]]);
    if (first === "OK") { await bump("new_hosts"); if (joined) await bump("joiners_became_hosts"); }
  } catch (e) { console.error("stats", e); }
}

// Saves a deck under a new random code and returns the code.
export async function storeDeck(deck) {
  for (let tries = 0; tries < 5; tries++) {
    let code = "";
    for (let i = 0; i < 5; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    const ok = await redis("SET", `deck:${code}`, JSON.stringify({ ...deck, code }), "EX", TTL, "NX");
    if (ok === "OK") return code;
  }
  throw fail(500, "Couldn't save the deck. Try again.");
}
const saveDeck = async (res, deck) => send(res, 201, { code: await storeDeck(deck) });

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
  await countHost(PLAYER_RE.test(String(b.playerId || "")) ? b.playerId : null);
  return saveDeck(res, {
    category: "saved", mood: "", label: "Our saved places", area: "your saved list", radius: 0, center, places,
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
  const d = JSON.parse(deck);
  // A deck that's one stop of a night out comes with the whole plan and who can make which night.
  let plan = null;
  if (d.plan?.id) {
    const [raw, votes] = await pipeline([["GET", `plan:${d.plan.id}`], ["HGETALL", `plan:${d.plan.id}:dates`]]);
    if (raw) plan = { ...JSON.parse(raw), votes: hashToObject(votes) };
  }
  return send(res, 200, { deck: d, plan, swipes: hashToObject(swipes), ranks: hashToObject(ranks), booking: bookingConfig() });
}

export default async function handler(req, res) {
  const missing = missingConfig();
  if (missing.length) return send(res, 503, { error: "The app isn't set up yet. Missing: " + missing.join(", ") });
  try {
    if (req.method === "GET") return await read(req, res);
    if (req.method === "POST") return await create(req, res);
    return send(res, 405, { error: "Use GET or POST." });
  } catch (e) {
    if (!e.status) console.error(e);
    return send(res, e.status || 502, { error: e.friendly || "Something went wrong on our end. Try again in a minute." });
  }
}
