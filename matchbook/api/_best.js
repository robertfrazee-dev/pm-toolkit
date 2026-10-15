// "Best of Manhattan": category leaderboards that start from what the world already knows (Google ratings and
// review counts) and then move with Matchbook: every matchup vote, and the places real groups pick in decks.
// Google's content (names, photos, ratings) is fetched live and only kept briefly in memory; Matchbook keeps
// just Google place IDs and its own numbers (allowed indefinitely).
import { redis, pipeline, underDailyCap } from "./_lib.js";
import { google, shape, box, miles, CHAINS } from "./_places.js";

// ---------- Manhattan ----------
// The island's outline (rough, but keeps out Brooklyn, Queens and New Jersey across the rivers).
const OUTLINE = [
  [40.7003, -74.0198], [40.7089, -74.0193], [40.7536, -74.0103], [40.7770, -73.9940], [40.8000, -73.9760], [40.8340, -73.9520],
  [40.8600, -73.9380], [40.8785, -73.9270], [40.8740, -73.9100], [40.8350, -73.9330], [40.8100, -73.9330], [40.7980, -73.9280],
  [40.7860, -73.9420], [40.7700, -73.9440], [40.7480, -73.9680], [40.7300, -73.9710], [40.7100, -73.9760], [40.7050, -73.9990],
];
export function inManhattan(lat, lng) {
  if (lat == null || lng == null) return false;
  let inside = false;
  for (let i = 0, j = OUTLINE.length - 1; i < OUTLINE.length; j = i++) {
    const [ai, bi] = OUTLINE[i], [aj, bj] = OUTLINE[j];
    if ((bi > lng) !== (bj > lng) && lat < ((aj - ai) * (lng - bi)) / (bj - bi) + ai) inside = !inside;
  }
  return inside;
}
const MANHATTAN = { low: { latitude: 40.6995, longitude: -74.0205 }, high: { latitude: 40.8790, longitude: -73.9070 } };
export const HOODS = [
  ["Inwood", 40.8677, -73.9212], ["Washington Heights", 40.8417, -73.9394], ["Hamilton Heights", 40.824, -73.9496], ["Harlem", 40.8116, -73.9465],
  ["East Harlem", 40.7957, -73.9389], ["Morningside Heights", 40.81, -73.962], ["Upper West Side", 40.787, -73.9754], ["Upper East Side", 40.7736, -73.9566],
  ["Hell's Kitchen", 40.7638, -73.9918], ["Midtown", 40.7549, -73.984], ["Midtown East", 40.754, -73.97], ["Murray Hill", 40.7479, -73.9757],
  ["Kips Bay", 40.742, -73.98], ["Chelsea", 40.7465, -74.0014], ["Hudson Yards", 40.7536, -74.001], ["Flatiron", 40.7411, -73.9897],
  ["Gramercy", 40.7368, -73.9845], ["NoMad", 40.7448, -73.988], ["Greenwich Village", 40.7319, -73.9966], ["West Village", 40.7358, -74.0036],
  ["East Village", 40.7265, -73.9815], ["Stuyvesant Town", 40.7316, -73.978], ["Lower East Side", 40.715, -73.9843], ["SoHo", 40.7233, -74.003],
  ["NoHo", 40.7272, -73.9925], ["Nolita", 40.7228, -73.9955], ["Chinatown", 40.7158, -73.997], ["Tribeca", 40.7163, -74.0086],
  ["Financial District", 40.7075, -74.0113], ["Battery Park City", 40.711, -74.016], ["Two Bridges", 40.711, -73.994], ["Little Italy", 40.7191, -73.9973],
  ["Meatpacking District", 40.7409, -74.0078], ["Lincoln Square", 40.7746, -73.9844], ["Yorkville", 40.7762, -73.9492], ["Lenox Hill", 40.7662, -73.9602],
  ["Times Square", 40.758, -73.9855], ["Koreatown", 40.7477, -73.9869], ["Union Square", 40.7359, -73.9911], ["Alphabet City", 40.7258, -73.9787],
];
export const HOOD_NAMES = HOODS.map(([n]) => n).sort();
export function hoodOf(lat, lng) {
  let best = null, bd = Infinity;
  for (const [n, a, b] of HOODS) { const d = (lat - a) ** 2 + ((lng - b) * 0.76) ** 2; if (d < bd) { bd = d; best = n; } }
  return best;
}
const norm = (s) => String(s || "").toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();
// "west vill", "the village", "hells kitchen" → a known neighborhood, if one matches.
export function matchHood(text) {
  const t = norm(text).replace(/^the /, ""); if (t.length < 2) return null;
  const exact = HOODS.find(([n]) => norm(n) === t); if (exact) return exact[0];
  const starts = HOODS.filter(([n]) => norm(n).startsWith(t)); if (starts.length === 1) return starts[0][0];
  const alias = { "fidi": "Financial District", "les": "Lower East Side", "ues": "Upper East Side", "uws": "Upper West Side", "hk": "Hell's Kitchen", "the village": "Greenwich Village", "village": "Greenwich Village", "ktown": "Koreatown", "k town": "Koreatown", "meatpacking": "Meatpacking District", "stuy town": "Stuyvesant Town", "bpc": "Battery Park City", "wash heights": "Washington Heights" };
  return alias[t] || null;
}

// ---------- where ----------
// One of: all of Manhattan, a neighborhood (from the list), a typed area (looked up once), or a radius around you.
export const RADII = [0.5, 1, 2];
const GEO_KEEP = 30 * 86400; // Google lets coordinates be kept up to 30 days
export async function whereFrom(src) {
  const get = (k) => (src instanceof URLSearchParams ? src.get(k) : src[k]);
  const hood = matchHood(get("hood") || get("area") || "");
  if (hood) { const [, lat, lng] = HOODS.find(([n]) => n === hood); return { kind: "hood", label: hood, lat, lng, mi: 0.45, key: `hood:${hood}` }; }
  const area = String(get("area") || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 60);
  if (area.length >= 2) {
    const k = `geo:${norm(area)}`;
    let at = JSON.parse((await redis("GET", k)) || "null");
    if (!at) {
      const r = await google({ textQuery: `${area}, Manhattan, New York`, pageSize: 1, locationRestriction: { rectangle: MANHATTAN } });
      const p = r.places?.[0]?.location;
      at = p && inManhattan(p.latitude, p.longitude) ? { lat: p.latitude, lng: p.longitude } : { none: true };
      await redis("SET", k, JSON.stringify(at), "EX", GEO_KEEP);
    }
    if (at.none) return { kind: "missing", label: area, key: `area:${norm(area)}` };
    return { kind: "area", label: area, lat: at.lat, lng: at.lng, mi: 0.5, key: `area:${norm(area)}` };
  }
  const lat = Number(get("lat")), lng = Number(get("lng")), mi = Number(get("mi"));
  if (Number.isFinite(lat) && Number.isFinite(lng) && RADII.includes(mi)) return { kind: "near", label: `Within ${mi === 0.5 ? "½" : mi} mi of you`, lat, lng, mi, key: `near:${lat.toFixed(3)},${lng.toFixed(3)},${mi}` };
  return { kind: "all", label: "Manhattan", key: "" };
}

// ---------- categories ----------
export const SECTIONS = [
  ["debates", "🔥 The big debates"], ["food", "🍽️ Food"], ["drinks", "🍸 Drinks"], ["gameday", "🏈 Game day"], ["nights", "🌙 Nights out"], ["todo", "🎳 Things to do"],
];
export const BOARDS = [
  ["pizza", "debates", "🍕", "Pizza", "pizza", "best pizza"], ["bars", "debates", "🍸", "Bars", "bar", "best bars"],
  ["wings", "debates", "🍗", "Buffalo Wings", "wings spot", "best buffalo wings"], ["burger", "debates", "🍔", "Burger", "burger", "best burger"],
  ["bagels", "debates", "🥯", "Bagels", "bagel", "best bagels"],
  ["italian", "food", "🍝", "Italian", "Italian spot", "best italian restaurant"], ["thai", "food", "🍜", "Thai", "Thai spot", "best thai restaurant"],
  ["chinese", "food", "🥟", "Chinese", "Chinese spot", "best chinese restaurant"], ["sushi", "food", "🍣", "Sushi", "sushi spot", "best sushi"],
  ["mexican", "food", "🌮", "Mexican", "Mexican spot", "best mexican restaurant tacos"], ["indian", "food", "🍛", "Indian", "Indian spot", "best indian restaurant"],
  ["ramen", "food", "🍥", "Ramen", "ramen spot", "best ramen"], ["steakhouse", "food", "🥩", "Steakhouse", "steakhouse", "best steakhouse"],
  ["brunch", "food", "🥞", "Brunch", "brunch spot", "best brunch"], ["dessert", "food", "🍦", "Dessert", "dessert spot", "best dessert"],
  ["coffee", "food", "☕", "Coffee", "coffee shop", "best coffee shop"],
  ["espresso-martini", "drinks", "🍸", "Espresso Martini", "espresso martini", "best espresso martini cocktail bar"], ["guinness", "drinks", "🍺", "Pint of Guinness", "Guinness pour", "best guinness irish pub"],
  ["happy-hour", "drinks", "🍻", "Happy Hour", "happy hour", "best happy hour"], ["dive-bar", "drinks", "🎱", "Dive Bar", "dive bar", "best dive bar"],
  ["rooftop", "drinks", "🌇", "Rooftop", "rooftop", "best rooftop bar"], ["wine-bar", "drinks", "🍷", "Wine Bar", "wine bar", "best wine bar"],
  ["cocktails", "drinks", "🍹", "Cocktail Bar", "cocktail bar", "best cocktail bar"],
  ["sports-bars", "gameday", "🏟️", "Sports Bar", "sports bar", "best sports bar"], ["nfl", "gameday", "🏈", "NFL Game Day Bar", "game day bar", "best bar to watch nfl football"],
  ["date-night", "nights", "💘", "Date Night Spot", "date night spot", "best romantic date night restaurant"], ["date-activities", "nights", "🎟️", "Date Activities", "date activity", "best date night activities"],
  ["late-night", "nights", "🌙", "Late-Night Food", "late-night spot", "best late night food"], ["crazy-night", "nights", "🪩", "Crazy Night Out", "spot for a crazy night", "best nightclub party bar"],
  ["live-music", "nights", "🎸", "Live Music", "live music spot", "best live music venue"], ["karaoke", "nights", "🎤", "Karaoke", "karaoke spot", "best karaoke bar"],
  ["activities", "todo", "🎳", "Things to Do", "activity", "best fun activities bowling arcade"], ["museums", "todo", "🖼️", "Museums", "museum", "best museums"],
  ["parks", "todo", "🌳", "Parks", "park", "best parks"],
].map(([slug, sec, emoji, title, noun, q]) => ({ slug, sec, emoji, title: `Best ${title}`, short: title, noun, q }));
export const boardBySlug = Object.fromEntries(BOARDS.map((b) => [b.slug, b]));

// ---------- the list for a category and a where ----------
// Starting order: a weighted rating (a 4.8 with 40 reviews doesn't beat a 4.6 with 3,000). Then Matchbook moves it:
// head-to-head votes (chess-style), and points when real groups pick a place.
const PRIOR_C = 4.3, PRIOR_M = 250;
export const priorOf = (rating, count) => (rating ? Math.round(1500 + (((rating * count + PRIOR_C * PRIOR_M) / (count + PRIOR_M)) - PRIOR_C) * 700) : 1400);
export const MIN_VOTES = 3;
const memo = new Map(); // brief in-memory cache of Google results, so a busy board isn't a search per view
const MEMO_MS = 60 * 60e3;
export async function candidates(board, where) {
  const key = `${board.slug}|${where.key}`, hit = memo.get(key);
  if (hit && Date.now() - hit.at < MEMO_MS) return hit.places;
  if (!(await underDailyCap("best_search", Number(process.env.BEST_DAILY_LIMIT) || 1500))) {
    const err = new Error("cap"); err.friendly = "The lists are resting for today (busy day!). Try again tomorrow."; throw err;
  }
  const local = where.kind !== "all";
  const center = local ? { latitude: where.lat, longitude: where.lng } : { latitude: 40.7831, longitude: -73.9712 };
  const textQuery = `${board.q} in ${where.kind === "hood" || where.kind === "area" ? `${where.label}, ` : ""}Manhattan`;
  const query = { textQuery, pageSize: 20, locationRestriction: { rectangle: local ? box(center, where.mi) : MANHATTAN } };
  const seen = new Set(), out = [];
  let token;
  for (let page = 0; page < (local ? 2 : 3); page++) {
    const r = await google(token ? { ...query, pageToken: token } : query);
    for (const p of r.places || []) {
      if (seen.has(p.id) || (p.businessStatus && p.businessStatus !== "OPERATIONAL") || !p.location) continue;
      seen.add(p.id);
      if (!inManhattan(p.location.latitude, p.location.longitude)) continue;
      if (local && miles(center, p.location) > where.mi * (where.kind === "near" ? 1 : 1.6)) continue;
      if (CHAINS.test(p.displayName?.text || "")) continue;
      out.push(p);
    }
    token = r.nextPageToken; if (!token) break;
  }
  let places = out.map((p, i) => {
    const s = shape(p, i, center);
    return { gid: s.gid, name: s.name, kind: s.kind, address: s.address, rating: s.rating, ratings: s.ratings, price: s.price, maps: s.maps, website: s.website, lat: s.lat, lng: s.lng, photo: s.photo, photoBy: s.photoBy, hood: hoodOf(s.lat, s.lng), mi: where.kind === "near" ? s.distance : null, prior: priorOf(s.rating, s.ratings) };
  });
  if (where.kind === "hood") places = places.filter((p) => p.hood === where.label); // West Village means West Village
  memo.set(key, { at: Date.now(), places });
  if (memo.size > 400) memo.delete(memo.keys().next().value);
  return places;
}

// Matchbook's own numbers per place: rating change from votes, votes, and group points (any category).
export async function scored(board, places) {
  if (!places.length) return [];
  const rows = await pipeline([...places.map((p) => ["ZSCORE", `bx:${board.slug}:d`, p.gid]), ...places.map((p) => ["HGET", `bx:${board.slug}:n`, p.gid]), ...places.map((p) => ["ZSCORE", "bx:grp", p.gid]), ...places.map((p) => ["HGET", "bx:wins", p.gid])]);
  const n = places.length;
  return places.map((p, i) => {
    const delta = Number(rows[i]) || 0, votes = Number(rows[n + i]) || 0, grp = Math.max(0, Number(rows[2 * n + i]) || 0), wins = Math.max(0, Number(rows[3 * n + i]) || 0);
    return { ...p, votes, wins, delta, score: Math.round(p.prior + delta + Math.min(150, grp)) };
  }).sort((a, b) => b.score - a.score);
}

// Names for places we only have IDs for (a crew's picks, out tonight): Google's basic details, live.
const detailMemo = new Map();
export async function details(gids) {
  const want = [...new Set(gids)].filter((g) => !detailMemo.has(g) || Date.now() - detailMemo.get(g).at > MEMO_MS);
  await Promise.all(want.slice(0, 20).map(async (gid) => {
    try {
      const r = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(gid)}`, { headers: { "X-Goog-Api-Key": process.env.GOOGLE_MAPS_API_KEY, "X-Goog-FieldMask": "id,displayName,shortFormattedAddress,primaryTypeDisplayName,googleMapsUri,location,photos" } });
      if (!r.ok) return;
      const p = await r.json();
      detailMemo.set(gid, { at: Date.now(), p: { gid, name: p.displayName?.text || "", kind: p.primaryTypeDisplayName?.text || "", address: p.shortFormattedAddress || "", maps: p.googleMapsUri || "", lat: p.location?.latitude ?? null, lng: p.location?.longitude ?? null, hood: p.location ? hoodOf(p.location.latitude, p.location.longitude) : "", photo: p.photos?.[0]?.name || "" } });
    } catch {}
  }));
  if (detailMemo.size > 2000) detailMemo.delete(detailMemo.keys().next().value);
  return Object.fromEntries(gids.map((g) => [g, detailMemo.get(g)?.p]).filter(([, p]) => p?.name));
}
