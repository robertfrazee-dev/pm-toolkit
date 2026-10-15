// Manhattan's places from OpenStreetMap (free to store and reuse; © OpenStreetMap contributors, ODbL),
// sorted into Matchbook's "Best of Manhattan" boards. The list is built once by the admin (see boards.js "build")
// and kept in Redis in chunks; each server instance loads it into memory.
import { redis, pipeline } from "./_lib.js";

// Manhattan, roughly, and its neighborhoods (a place gets the nearest neighborhood center).
export const inManhattan = (lat, lng) => lat > 40.68 && lat < 40.882 && lng > -74.03 && lng < -73.906;
const HOODS = [
  ["Inwood", 40.8677, -73.9212], ["Washington Heights", 40.8417, -73.9394], ["Hamilton Heights", 40.824, -73.9496], ["Harlem", 40.8116, -73.9465],
  ["East Harlem", 40.7957, -73.9389], ["Morningside Heights", 40.81, -73.962], ["Upper West Side", 40.787, -73.9754], ["Upper East Side", 40.7736, -73.9566],
  ["Hell's Kitchen", 40.7638, -73.9918], ["Midtown", 40.7549, -73.984], ["Midtown East", 40.754, -73.97], ["Murray Hill", 40.7479, -73.9757],
  ["Kips Bay", 40.742, -73.98], ["Chelsea", 40.7465, -74.0014], ["Hudson Yards", 40.7536, -74.001], ["Flatiron", 40.7411, -73.9897],
  ["Gramercy", 40.7368, -73.9845], ["NoMad", 40.7448, -73.988], ["Greenwich Village", 40.7319, -73.9966], ["West Village", 40.7358, -74.0036],
  ["East Village", 40.7265, -73.9815], ["Stuyvesant Town", 40.7316, -73.978], ["Lower East Side", 40.715, -73.9843], ["SoHo", 40.7233, -74.003],
  ["NoHo", 40.7272, -73.9925], ["Nolita", 40.7228, -73.9955], ["Chinatown", 40.7158, -73.997], ["Tribeca", 40.7163, -74.0086],
  ["Financial District", 40.7075, -74.0113], ["Battery Park City", 40.711, -74.016], ["Two Bridges", 40.711, -73.994], ["Roosevelt Island", 40.7615, -73.95],
];
export const NEIGHBORHOODS = HOODS.map(([n]) => n).sort();
export function hoodOf(lat, lng) {
  let best = null, bd = Infinity;
  for (const [n, a, b] of HOODS) { const d = (lat - a) ** 2 + ((lng - b) * 0.76) ** 2; if (d < bd) { bd = d; best = n; } }
  return best;
}

// Closes at 1am or later (or never closes).
export function lateNight(oh) {
  if (!oh) return false;
  if (/24\/7/.test(oh)) return true;
  return /-\s*(0[1-6]|2[5-9]):\d\d/.test(oh) || /-\s*(0[1-6])(?!\d)/.test(oh);
}
const has = (list, re) => (list || []).some((x) => re.test(x));

// The boards. Each picks its places from the list; people can also nominate places, and group picks
// (from decks) can add a place (e.g. Google calls it a sports bar).
export const BOARDS = [
  { slug: "sports-bars", emoji: "🏈", title: "Best Sports Bars", noun: "sports bar", test: (p) => p.k === "bar" && (p.sp || /sport|stadium|tavern|ale house|pub|game/i.test(p.n)), featured: true },
  { slug: "happy-hour", emoji: "🍻", title: "Best Happy Hour", noun: "happy hour", test: (p) => p.k === "bar" || p.hh, featured: true },
  { slug: "late-night", emoji: "🌙", title: "Best Late-Night Hangouts", noun: "late-night spot", test: (p) => p.late && ["bar", "club", "restaurant", "quick"].includes(p.k), featured: true },
  { slug: "crazy-night", emoji: "🪩", title: "Best Bars for a Crazy Night", noun: "bar for a crazy night", test: (p) => p.k === "club" || (p.k === "bar" && (p.late || p.dance || /club|lounge|disco|dance|rooftop/i.test(p.n))), featured: true },
  { slug: "italian", emoji: "🍝", title: "Best Italian Dinners", noun: "Italian dinner", test: (p) => p.k === "restaurant" && has(p.cu, /italian/), featured: true },
  { slug: "pizza", emoji: "🍕", title: "Best Pizza", noun: "pizza", test: (p) => (p.k === "restaurant" || p.k === "quick") && (has(p.cu, /pizza/) || /pizza|pizzeria/i.test(p.n)), featured: true },
  { slug: "bagels", emoji: "🥯", title: "Best Bagels", noun: "bagel", test: (p) => has(p.cu, /bagel/) || /bagel/i.test(p.n), featured: true },
  { slug: "brunch", emoji: "🥞", title: "Best Brunch", noun: "brunch", test: (p) => (p.k === "restaurant" || p.k === "cafe") && (has(p.cu, /brunch|breakfast/) || /brunch/i.test(p.n)), featured: true },
  { slug: "bars", emoji: "🍸", title: "Best Bars", noun: "bar", test: (p) => p.k === "bar" },
  { slug: "restaurants", emoji: "🍽️", title: "Best Restaurants", noun: "restaurant", test: (p) => p.k === "restaurant" },
  { slug: "coffee", emoji: "☕", title: "Best Coffee", noun: "coffee shop", test: (p) => p.k === "cafe" && !has(p.cu, /ice_cream|dessert|bubble_tea/) },
  { slug: "dessert", emoji: "🍦", title: "Best Dessert", noun: "dessert spot", test: (p) => p.k === "sweet" || has(p.cu, /ice_cream|dessert|donut|frozen_yogurt|cake/) },
  { slug: "live-music", emoji: "🎸", title: "Best Live Music", noun: "live music spot", test: (p) => p.k === "music" || (["bar", "club"].includes(p.k) && p.live) },
  { slug: "activities", emoji: "🎳", title: "Best Things to Do", noun: "activity", test: (p) => p.k === "fun" },
  { slug: "sights", emoji: "🗽", title: "Best Sights", noun: "sight", test: (p) => p.k === "sight" },
  { slug: "outdoors", emoji: "🌳", title: "Best Outdoor Spots", noun: "outdoor spot", test: (p) => p.k === "park" },
];
export const boardBySlug = Object.fromEntries(BOARDS.map((b) => [b.slug, b]));

// The Overpass queries, one per part, so each stays small enough for a quick server call.
const AREA = 'area["wikidata"="Q11299"]->.m;';
const BANDS = [[40.68, 40.735], [40.735, 40.765], [40.765, 40.8], [40.8, 40.885]];
export const PARTS = [
  `nwr(area.m)["amenity"~"^(bar|pub|biergarten|nightclub|music_venue)$"];`,
  ...BANDS.map(([s, n]) => `nwr(area.m)(${s},-74.03,${n},-73.9)["amenity"="restaurant"];`),
  `nwr(area.m)["amenity"~"^(cafe|fast_food|ice_cream)$"];nwr(area.m)["shop"~"^(bakery|pastry|confectionery|chocolate|coffee)$"];`,
  `nwr(area.m)["leisure"~"^(bowling_alley|amusement_arcade|escape_game|miniature_golf|ice_rink|park|garden)$"]["name"];nwr(area.m)["amenity"~"^(karaoke_box|theatre)$"];nwr(area.m)["tourism"~"^(attraction|museum|gallery|viewpoint)$"]["name"];`,
].map((q) => `[out:json][timeout:25];${AREA}(${q});out center tags;`);

const cuisines = (t) => String(t.cuisine || "").toLowerCase().split(/[;,]/).map((x) => x.trim()).filter(Boolean).slice(0, 4);
// One OpenStreetMap element → a compact place, or null if it isn't something people go to.
export function fromOsm(el) {
  const t = el.tags || {}, lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon;
  const name = String(t.name || "").trim();
  if (!name || lat == null || !inManhattan(lat, lng) || t.disused || t["disused:amenity"]) return null;
  const a = t.amenity, cu = cuisines(t);
  let k = null;
  if (["bar", "pub", "biergarten"].includes(a)) k = "bar";
  else if (a === "nightclub") k = "club";
  else if (a === "music_venue") k = "music";
  else if (a === "restaurant") k = "restaurant";
  else if (a === "cafe" || t.shop === "coffee") k = "cafe";
  else if (a === "fast_food") k = "quick";
  else if (a === "ice_cream" || ["pastry", "confectionery", "chocolate"].includes(t.shop)) k = "sweet";
  else if (t.shop === "bakery") k = cu.some((c) => /bagel/.test(c)) || /bagel/i.test(name) ? "quick" : "sweet";
  else if (["bowling_alley", "amusement_arcade", "escape_game", "miniature_golf", "ice_rink"].includes(t.leisure) || a === "karaoke_box" || a === "theatre") k = "fun";
  else if (["attraction", "museum", "gallery", "viewpoint"].includes(t.tourism)) k = "sight";
  else if (["park", "garden"].includes(t.leisure)) k = "park";
  if (!k) return null;
  const r5 = (x) => Math.round(x * 1e5) / 1e5;
  const addr = [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ");
  return {
    id: el.type[0] + el.id, n: name.slice(0, 80), k, cu, lat: r5(lat), lng: r5(lng), hood: hoodOf(lat, lng), addr: addr.slice(0, 80),
    late: lateNight(t.opening_hours), sp: !!(t.sport || t["sport:screen"] || /sport/i.test(t.bar || "")), hh: !!t.happy_hours,
    dance: !!(t.dance || t["dance:venue"] || /dj|dance|electronic|techno|house/i.test(t.music || "")), live: t.live_music === "yes",
    web: /^https?:\/\//.test(t.website || "") ? t.website.slice(0, 200) : "",
  };
}

// What to show for a kind of place.
const KIND = { bar: "Bar", club: "Nightclub", music: "Music venue", restaurant: "Restaurant", cafe: "Café", quick: "Quick bite", sweet: "Dessert", fun: "Activity", sight: "Sight", park: "Park" };
const pretty = (c) => c.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
export const kindLabel = (p) => (p.cu?.length && ["restaurant", "quick", "cafe"].includes(p.k) ? pretty(p.cu[0]) : KIND[p.k] || "");
export const mapsUrl = (p) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${p.n}, ${p.addr ? p.addr + ", " : ""}New York, NY`)}`;

// ---------- the list in memory ----------
let mem = null, memAt = 0;
export async function catalog() {
  if (mem && Date.now() - memAt < 10 * 60e3) return mem;
  const meta = JSON.parse((await redis("GET", "nyc:meta")) || "null");
  if (!meta?.keys?.length) return (mem = { places: [], byId: new Map(), grid: new Map(), pools: {}, meta: null });
  const raws = await Promise.all(meta.keys.map((k) => redis("GET", k)));
  // A place can come up in two parts (say, a bar that's also a restaurant): keep the first.
  const seen = new Set(), places = raws.flatMap((r) => (r ? JSON.parse(r) : [])).filter((p) => !seen.has(p.id) && seen.add(p.id));
  const byId = new Map(places.map((p) => [p.id, p])), grid = new Map();
  for (const p of places) { const key = cellKey(p.lat, p.lng); (grid.get(key) || grid.set(key, []).get(key)).push(p); }
  const pools = Object.fromEntries(BOARDS.map((b) => [b.slug, places.filter(b.test).map((p) => p.id)]));
  mem = { places, byId, grid, pools, meta }; memAt = Date.now();
  return mem;
}
export const resetCatalog = () => { mem = null; };
const CELL = 0.002; // about 200 m
const cellKey = (lat, lng) => `${Math.floor(lat / CELL)}:${Math.floor(lng / CELL)}`;

// Saving one built part: places in chunks of 400 (keys listed in nyc:meta once the build finishes).
export async function savePart(part, places) {
  const keys = [];
  for (let i = 0; i * 400 < places.length; i++) {
    const key = `nyc:part:${part}:${i}`;
    keys.push(key);
    await redis("SET", key, JSON.stringify(places.slice(i * 400, (i + 1) * 400)));
  }
  await redis("SET", `nyc:partkeys:${part}`, JSON.stringify(keys));
  return keys;
}
export async function finishBuild() {
  const lists = await pipeline(PARTS.map((_, i) => ["GET", `nyc:partkeys:${i}`]));
  const keys = lists.flatMap((l) => (l ? JSON.parse(l) : []));
  await redis("SET", "nyc:meta", JSON.stringify({ keys, builtAt: Date.now() }));
  resetCatalog();
  const c = await catalog();
  return { places: c.places.length, boards: Object.fromEntries(Object.entries(c.pools).map(([k, v]) => [k, v.length])) };
}

// ---------- matching a Google place from a deck to the list ----------
const STOP = new Set(["the", "and", "nyc", "new", "york", "bar", "restaurant", "cafe", "grill", "kitchen", "co", "inc", "llc"]);
export const tokens = (s) => String(s).toLowerCase().replace(/&/g, " and ").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w && !STOP.has(w));
function nameScore(a, b) {
  const A = new Set(tokens(a)), B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let both = 0; for (const w of A) if (B.has(w)) both++;
  return both / Math.min(A.size, B.size);
}
const meters = (a, b) => Math.hypot((a.lat - b.lat) * 111320, (a.lng - b.lng) * 84300);
export async function matchPlace({ name, lat, lng }) {
  if (lat == null || !inManhattan(lat, lng)) return null;
  const c = await catalog(); if (!c.places.length) return null;
  const cx = Math.floor(lat / CELL), cy = Math.floor(lng / CELL);
  let best = null, bs = 0;
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    for (const p of c.grid.get(`${cx + dx}:${cy + dy}`) || []) {
      const d = meters({ lat, lng }, p); if (d > 160) continue;
      const s = nameScore(name, p.n) - d / 2000;
      if (s > bs) { bs = s; best = p; }
    }
  }
  return bs >= 0.6 ? best : null;
}
