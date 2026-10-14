// Google Places search shared by new decks and "Deal 10 more".
import { bump } from "./_lib.js";

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
export const PRICE_LEVELS = ["PRICE_LEVEL_INEXPENSIVE", "PRICE_LEVEL_MODERATE", "PRICE_LEVEL_EXPENSIVE", "PRICE_LEVEL_VERY_EXPENSIVE"];
const MI = 1609.344;

export async function google(payload) {
  const r = await fetch(PLACES, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": process.env.GOOGLE_MAPS_API_KEY, "X-Goog-FieldMask": FIELDS },
    body: JSON.stringify(payload),
  });
  const j = await r.json().catch(() => ({}));
  await bump("google_searches");
  if (!r.ok) {
    const err = new Error(j.error?.message || `Google Places returned ${r.status}`);
    // What people see; the raw message goes to the logs.
    err.friendly = r.status === 429 ? "Google Maps is busy right now. Try again in a minute."
      : r.status === 403 ? "Place search is unavailable right now. Try again later, or swipe your saved places."
      : "Couldn't reach Google Maps. Try again in a minute.";
    throw err;
  }
  return j;
}

export function miles(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude), dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return (2 * 6371000 * Math.asin(Math.sqrt(h))) / MI;
}

export function box(center, radiusMi) {
  const dLat = (radiusMi * MI) / 111320;
  const dLng = dLat / Math.max(Math.cos((center.latitude * Math.PI) / 180), 0.01);
  return {
    low: { latitude: Math.max(center.latitude - dLat, -90), longitude: Math.max(center.longitude - dLng, -180) },
    high: { latitude: Math.min(center.latitude + dLat, 90), longitude: Math.min(center.longitude + dLng, 180) },
  };
}

export function shape(p, i, center) {
  const photo = p.photos?.[0];
  return {
    id: "p" + (i + 1),
    gid: p.id, // Google's place ID; safe to keep, and lets saved places stay matched to the real place
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

// Big national chains rarely win a "where should we go" vote, so they're left out unless asked for by name.
export const CHAINS = /^(?:mcdonald'?s|starbucks|dunkin'?(?: donuts)?|subway|chipotle(?: mexican grill)?|taco bell|wendy'?s|burger king|kfc|popeyes|chick-fil-a|domino'?s|pizza hut|papa john'?s|little caesars|panera(?: bread)?|applebee'?s|olive garden|chili'?s|tgi friday'?s|buffalo wild wings|five guys|panda express|jersey mike'?s|jimmy john'?s|qdoba|denny'?s|ihop|outback steakhouse|red lobster|the cheesecake factory|cheesecake factory|p\.?f\.? chang'?s|hooters|7-eleven|tim hortons|krispy kreme|baskin-robbins|dairy queen|cold stone creamery|arby'?s|white castle|pret a manger|potbelly|sweetgreen|cava|just salad|dig|joe & the juice|le pain quotidien|au bon pain|sbarro|nathan'?s famous)\b/i;

// Run a search (up to 3 pages of 20), keeping open places inside the circle that aren't excluded.
export async function findPlaces(search, { want, exclude = new Set() }) {
  const { textQuery, center, radius, openNow, priceLevels, skipChains } = search;
  const query = { textQuery, pageSize: 20, locationRestriction: { rectangle: box(center, radius) } };
  if (openNow) query.openNow = true;
  if (priceLevels?.length) query.priceLevels = priceLevels;
  const seen = new Set(), kept = [];
  let pageToken;
  for (let page = 0; page < 3 && kept.length < want; page++) {
    const r = await google(pageToken ? { ...query, pageToken } : query);
    for (const p of r.places || []) {
      if (seen.has(p.id) || exclude.has(p.id) || (p.businessStatus && p.businessStatus !== "OPERATIONAL")) continue;
      seen.add(p.id);
      if (p.location && miles(center, p.location) > radius) continue;
      if (skipChains && CHAINS.test(p.displayName?.text || "")) continue;
      kept.push(p);
    }
    pageToken = r.nextPageToken;
    if (!pageToken) break;
  }
  return kept.slice(0, want);
}
