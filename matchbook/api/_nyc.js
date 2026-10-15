// New York City's places from OpenStreetMap (free to store and reuse; © OpenStreetMap contributors, ODbL),
// sorted into Matchbook's "Best of NYC" boards. The list is built once by the admin (see boards.js "build")
// and kept in Redis in chunks; each server instance loads it into memory.
import { redis, pipeline } from "./_lib.js";

// The five boroughs, roughly, and their neighborhoods (a place gets the nearest center in its borough).
export const inNYC = (lat, lng) => lat > 40.49 && lat < 40.92 && lng > -74.26 && lng < -73.69;
export const inManhattan = inNYC; // older callers: anything in the city now counts
export const BOROUGHS = [["Manhattan", "Q11299"], ["Brooklyn", "Q18419"], ["Queens", "Q18424"], ["The Bronx", "Q18426"], ["Staten Island", "Q18432"]];
const HOODS = {
  Manhattan: [
    ["Inwood", 40.8677, -73.9212], ["Washington Heights", 40.8417, -73.9394], ["Hamilton Heights", 40.824, -73.9496], ["Harlem", 40.8116, -73.9465],
    ["East Harlem", 40.7957, -73.9389], ["Morningside Heights", 40.81, -73.962], ["Upper West Side", 40.787, -73.9754], ["Upper East Side", 40.7736, -73.9566],
    ["Hell's Kitchen", 40.7638, -73.9918], ["Midtown", 40.7549, -73.984], ["Midtown East", 40.754, -73.97], ["Murray Hill", 40.7479, -73.9757],
    ["Kips Bay", 40.742, -73.98], ["Chelsea", 40.7465, -74.0014], ["Hudson Yards", 40.7536, -74.001], ["Flatiron", 40.7411, -73.9897],
    ["Gramercy", 40.7368, -73.9845], ["NoMad", 40.7448, -73.988], ["Greenwich Village", 40.7319, -73.9966], ["West Village", 40.7358, -74.0036],
    ["East Village", 40.7265, -73.9815], ["Stuyvesant Town", 40.7316, -73.978], ["Lower East Side", 40.715, -73.9843], ["SoHo", 40.7233, -74.003],
    ["NoHo", 40.7272, -73.9925], ["Nolita", 40.7228, -73.9955], ["Chinatown", 40.7158, -73.997], ["Tribeca", 40.7163, -74.0086],
    ["Financial District", 40.7075, -74.0113], ["Battery Park City", 40.711, -74.016], ["Two Bridges", 40.711, -73.994], ["Roosevelt Island", 40.7615, -73.95],
  ],
  Brooklyn: [
    ["Williamsburg", 40.7081, -73.9571], ["Greenpoint", 40.7305, -73.9515], ["Bushwick", 40.6944, -73.9213], ["Bed-Stuy", 40.6872, -73.9418],
    ["Park Slope", 40.671, -73.9814], ["Prospect Heights", 40.6775, -73.9692], ["Crown Heights", 40.6694, -73.9422], ["DUMBO", 40.7033, -73.9881],
    ["Brooklyn Heights", 40.696, -73.9936], ["Carroll Gardens", 40.682, -73.996], ["Fort Greene", 40.6892, -73.9742], ["Red Hook", 40.6734, -74.0083],
    ["Sunset Park", 40.6455, -74.0124], ["Bay Ridge", 40.6264, -74.0299], ["Flatbush", 40.6409, -73.9628], ["Downtown Brooklyn", 40.693, -73.985],
    ["Coney Island", 40.5755, -73.9707], ["Gowanus", 40.6733, -73.99],
  ],
  Queens: [
    ["Astoria", 40.7644, -73.9235], ["Long Island City", 40.7447, -73.9485], ["Sunnyside", 40.7433, -73.9196], ["Woodside", 40.7454, -73.903],
    ["Jackson Heights", 40.7557, -73.8831], ["Flushing", 40.7675, -73.8331], ["Ridgewood", 40.7043, -73.9018], ["Forest Hills", 40.7181, -73.8448],
    ["Rockaway", 40.586, -73.811], ["Jamaica", 40.7027, -73.789], ["Bayside", 40.768, -73.777], ["Elmhurst", 40.7364, -73.8781],
  ],
  "The Bronx": [["Mott Haven", 40.8091, -73.9229], ["Concourse", 40.827, -73.92], ["Arthur Avenue", 40.855, -73.888], ["Fordham", 40.8616, -73.8906], ["Riverdale", 40.89, -73.912], ["Pelham Bay", 40.8507, -73.8331]],
  "Staten Island": [["St. George", 40.6437, -74.0736], ["Stapleton", 40.627, -74.077], ["New Dorp", 40.573, -74.117], ["Great Kills", 40.554, -74.151]],
};
export const NEIGHBORHOODS = Object.entries(HOODS).map(([b, list]) => ({ borough: b, hoods: list.map(([n]) => n).sort() }));
export function hoodOf(lat, lng, borough) {
  const list = HOODS[borough] || Object.values(HOODS).flat();
  let best = null, bd = Infinity;
  for (const [n, a, b] of list) { const d = (lat - a) ** 2 + ((lng - b) * 0.76) ** 2; if (d < bd) { bd = d; best = n; } }
  return best;
}
// Distance in miles, for "near me".
export const milesBetween = (a, b) => Math.hypot((a.lat - b.lat) * 69.05, (a.lng - b.lng) * 52.4);

// Closes at 1am or later (or never closes).
export function lateNight(oh) {
  if (!oh) return false;
  if (/24\/7/.test(oh)) return true;
  return /-\s*(0[1-6]|2[5-9]):\d\d/.test(oh) || /-\s*(0[1-6])(?!\d)/.test(oh);
}
const has = (list, re) => (list || []).some((x) => re.test(x));

// The boards, in sections. Each picks its starting places from the list; people can nominate more,
// and group picks from decks can add places too (e.g. Google calls it a sports bar).
export const SECTIONS = [
  ["debates", "🔥 The big debates"], ["food", "🍽️ Food"], ["drinks", "🍸 Drinks"], ["gameday", "🏈 Game day"], ["nights", "🌙 Nights out"], ["todo", "🎳 Things to do"],
];
const isBar = (p) => p.k === "bar";
const sportsTest = (p) => isBar(p) && (p.sp || /sport|stadium|tavern|ale house|pub|game/i.test(p.n));
export const BOARDS = [
  { slug: "pizza", sec: "debates", emoji: "🍕", title: "Best Pizza", noun: "pizza", featured: true, test: (p) => (p.k === "restaurant" || p.k === "quick") && (has(p.cu, /pizza/) || /pizza|pizzeria/i.test(p.n)) },
  { slug: "bars", sec: "debates", emoji: "🍸", title: "Best Bars", noun: "bar", featured: true, test: isBar },
  { slug: "wings", sec: "debates", emoji: "🍗", title: "Best Buffalo Wings", noun: "wings", featured: true, test: (p) => has(p.cu, /wings|chicken/) || /wing/i.test(p.n) || sportsTest(p) },
  { slug: "burger", sec: "debates", emoji: "🍔", title: "Best Burger", noun: "burger", featured: true, test: (p) => has(p.cu, /burger/) || /burger/i.test(p.n) || (p.pub && p.k === "bar") },
  { slug: "bagels", sec: "debates", emoji: "🥯", title: "Best Bagels", noun: "bagel", featured: true, test: (p) => has(p.cu, /bagel/) || /bagel/i.test(p.n) },
  { slug: "italian", sec: "food", emoji: "🍝", title: "Best Italian", noun: "Italian spot", test: (p) => p.k === "restaurant" && has(p.cu, /italian/) },
  { slug: "thai", sec: "food", emoji: "🍜", title: "Best Thai", noun: "Thai spot", test: (p) => has(p.cu, /thai/) },
  { slug: "chinese", sec: "food", emoji: "🥟", title: "Best Chinese", noun: "Chinese spot", test: (p) => has(p.cu, /chinese|dim_sum|cantonese|sichuan|szechuan|dumpling|shanghai/) },
  { slug: "sushi", sec: "food", emoji: "🍣", title: "Best Sushi", noun: "sushi spot", test: (p) => has(p.cu, /sushi/) || /sushi|omakase/i.test(p.n) },
  { slug: "mexican", sec: "food", emoji: "🌮", title: "Best Mexican", noun: "Mexican spot", test: (p) => has(p.cu, /mexican|tacos?|tex-mex|burrito/) || /taco|taqueria/i.test(p.n) },
  { slug: "indian", sec: "food", emoji: "🍛", title: "Best Indian", noun: "Indian spot", test: (p) => has(p.cu, /indian|pakistani|bangladeshi|nepalese/) },
  { slug: "ramen", sec: "food", emoji: "🍥", title: "Best Ramen", noun: "ramen spot", test: (p) => has(p.cu, /ramen|noodle/) || /ramen/i.test(p.n) },
  { slug: "steakhouse", sec: "food", emoji: "🥩", title: "Best Steakhouse", noun: "steakhouse", test: (p) => has(p.cu, /steak/) || /steak/i.test(p.n) },
  { slug: "brunch", sec: "food", emoji: "🥞", title: "Best Brunch", noun: "brunch", test: (p) => (p.k === "restaurant" || p.k === "cafe") && (has(p.cu, /brunch|breakfast/) || /brunch/i.test(p.n)) },
  { slug: "restaurants", sec: "food", emoji: "🍽️", title: "Best Restaurants", noun: "restaurant", test: (p) => p.k === "restaurant" },
  { slug: "dessert", sec: "food", emoji: "🍦", title: "Best Dessert", noun: "dessert spot", test: (p) => p.k === "sweet" || has(p.cu, /ice_cream|dessert|donut|frozen_yogurt|cake/) },
  { slug: "coffee", sec: "food", emoji: "☕", title: "Best Coffee", noun: "coffee shop", test: (p) => p.k === "cafe" && !has(p.cu, /ice_cream|dessert|bubble_tea/) },
  { slug: "espresso-martini", sec: "drinks", emoji: "🍸", title: "Best Espresso Martini", noun: "espresso martini", featured: true, test: (p) => isBar(p) && (p.cocktail || !p.pub) },
  { slug: "guinness", sec: "drinks", emoji: "🍺", title: "Best Pint of Guinness", noun: "Guinness pour", featured: true, test: (p) => isBar(p) && (p.pub || p.irish) },
  { slug: "happy-hour", sec: "drinks", emoji: "🍻", title: "Best Happy Hour", noun: "happy hour", test: (p) => isBar(p) || p.hh },
  { slug: "dive-bar", sec: "drinks", emoji: "🎱", title: "Best Dive Bar", noun: "dive bar", featured: true, test: (p) => isBar(p) && !p.cocktail && !p.roof && (p.dive || p.pub || /dive|tavern|saloon|ale house|inn|tap/i.test(p.n)) },
  { slug: "rooftop", sec: "drinks", emoji: "🌇", title: "Best Rooftop", noun: "rooftop", test: (p) => p.roof || /rooftop|roof|sky ?bar|terrace/i.test(p.n) },
  { slug: "wine-bar", sec: "drinks", emoji: "🍷", title: "Best Wine Bar", noun: "wine bar", test: (p) => p.wine },
  { slug: "sports-bars", sec: "gameday", emoji: "🏟️", title: "Best Sports Bars", noun: "sports bar", featured: true, test: sportsTest },
  { slug: "nfl", sec: "gameday", emoji: "🏈", title: "Best NFL Game Day Bar", noun: "game day bar", featured: true, test: sportsTest },
  { slug: "date-night", sec: "nights", emoji: "💘", title: "Best Date Night Spot", noun: "date night spot", featured: true, test: (p) => (p.k === "restaurant" && has(p.cu, /italian|french|wine|mediterranean|japanese|seafood|tapas|spanish/)) || p.wine || (isBar(p) && p.cocktail) },
  { slug: "date-activities", sec: "nights", emoji: "🎟️", title: "Best Date Activities", noun: "date activity", test: (p) => ["fun", "sight", "music"].includes(p.k) },
  { slug: "late-night", sec: "nights", emoji: "🌙", title: "Best Late-Night Hangouts", noun: "late-night spot", test: (p) => p.late && ["bar", "club", "restaurant", "quick"].includes(p.k) },
  { slug: "crazy-night", sec: "nights", emoji: "🪩", title: "Best Bars for a Crazy Night", noun: "bar for a crazy night", featured: true, test: (p) => p.k === "club" || (isBar(p) && (p.late || p.dance || /club|lounge|disco|dance|rooftop/i.test(p.n))) },
  { slug: "live-music", sec: "nights", emoji: "🎸", title: "Best Live Music", noun: "live music spot", test: (p) => p.k === "music" || (["bar", "club"].includes(p.k) && p.live) },
  { slug: "activities", sec: "todo", emoji: "🎳", title: "Best Things to Do", noun: "activity", test: (p) => p.k === "fun" },
  { slug: "sights", sec: "todo", emoji: "🗽", title: "Best Sights", noun: "sight", test: (p) => p.k === "sight" },
  { slug: "outdoors", sec: "todo", emoji: "🌳", title: "Best Outdoor Spots", noun: "outdoor spot", test: (p) => p.k === "park" },
];
export const boardBySlug = Object.fromEntries(BOARDS.map((b) => [b.slug, b]));

// The Overpass queries, one per part (per borough, restaurants split by latitude), so each stays quick.
const RESTAURANT_BANDS = { Manhattan: [40.68, 40.735, 40.765, 40.8, 40.885], Brooklyn: [40.56, 40.64, 40.69, 40.74], Queens: [40.54, 40.7, 40.75, 40.81] };
export const PARTS = BOROUGHS.flatMap(([borough, qid]) => {
  const area = `area["wikidata"="${qid}"]->.m;`;
  const q = (body) => ({ borough, query: `[out:json][timeout:25];${area}(${body});out center tags;` });
  const bands = RESTAURANT_BANDS[borough];
  return [
    q(`nwr(area.m)["amenity"~"^(bar|pub|biergarten|nightclub|music_venue)$"];`),
    ...(bands ? bands.slice(0, -1).map((s, i) => q(`nwr(area.m)(${s},-74.3,${bands[i + 1]},-73.6)["amenity"="restaurant"];`)) : [q(`nwr(area.m)["amenity"="restaurant"];`)]),
    q(`nwr(area.m)["amenity"~"^(cafe|fast_food|ice_cream)$"];nwr(area.m)["shop"~"^(bakery|pastry|confectionery|chocolate|coffee)$"];`),
    q(`nwr(area.m)["leisure"~"^(bowling_alley|amusement_arcade|escape_game|miniature_golf|ice_rink|park|garden)$"]["name"];nwr(area.m)["amenity"~"^(karaoke_box|theatre|cinema)$"];nwr(area.m)["tourism"~"^(attraction|museum|gallery|viewpoint|zoo|aquarium)$"]["name"];`),
  ];
});

const cuisines = (t) => String(t.cuisine || "").toLowerCase().split(/[;,]/).map((x) => x.trim()).filter(Boolean).slice(0, 4);
// One OpenStreetMap element → a compact place, or null if it isn't something people go to.
export function fromOsm(el, borough) {
  const t = el.tags || {}, lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon;
  const name = String(t.name || "").trim();
  if (!name || lat == null || !inNYC(lat, lng) || t.disused || t["disused:amenity"]) return null;
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
  else if (["bowling_alley", "amusement_arcade", "escape_game", "miniature_golf", "ice_rink"].includes(t.leisure) || ["karaoke_box", "theatre", "cinema"].includes(a)) k = "fun";
  else if (["attraction", "museum", "gallery", "viewpoint", "zoo", "aquarium"].includes(t.tourism)) k = "sight";
  else if (["park", "garden"].includes(t.leisure)) k = "park";
  if (!k) return null;
  const r5 = (x) => Math.round(x * 1e5) / 1e5;
  const addr = [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ");
  return {
    id: el.type[0] + el.id, n: name.slice(0, 80), k, cu, lat: r5(lat), lng: r5(lng), b: borough || "", hood: hoodOf(lat, lng, borough), addr: addr.slice(0, 80),
    pub: a === "pub", cocktail: t.cocktails === "yes" || /cocktail|lounge|speakeasy|mixolog/i.test(name), irish: has(cu, /irish/) || /irish|guinness|\bo'|\bmc[a-z]/i.test(name),
    wine: t.bar === "wine" || has(cu, /wine/) || /\bwine|vino|enoteca|cave\b/i.test(name), roof: t.roof_top === "yes" || t.rooftop === "yes" || /rooftop|roof/i.test(name), dive: t.bar === "dive" || /dive/i.test(name),
    late: lateNight(t.opening_hours), sp: !!(t.sport || t["sport:screen"] || /sport/i.test(t.bar || "")), hh: !!t.happy_hours,
    dance: !!(t.dance || t["dance:venue"] || /dj|dance|electronic|techno|house/i.test(t.music || "")), live: t.live_music === "yes",
    web: /^https?:\/\//.test(t.website || "") ? t.website.slice(0, 200) : "",
  };
}

// What to show for a kind of place.
const KIND = { bar: "Bar", club: "Nightclub", music: "Music venue", restaurant: "Restaurant", cafe: "Café", quick: "Quick bite", sweet: "Dessert", fun: "Activity", sight: "Sight", park: "Park" };
const pretty = (c) => c.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
export const kindLabel = (p) => (p.cu?.length && ["restaurant", "quick", "cafe"].includes(p.k) ? pretty(p.cu[0]) : KIND[p.k] || "");
export const mapsUrl = (p) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${p.n}, ${p.addr ? p.addr + ", " : ""}${p.b && p.b !== "Manhattan" ? p.b + ", " : ""}New York, NY`)}`;

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
  if (lat == null || !inNYC(lat, lng)) return null;
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
