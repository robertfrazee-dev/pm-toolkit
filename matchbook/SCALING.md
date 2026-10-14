# Matchbook scaling plan

For when the app is out and traffic takes off. Nothing here is needed while
it's friends-only. Google's free monthly usage and the daily caps cover that.

## What a deck costs today

- **Searches:** 1–3 Google Places Text Search calls per new deck
  (`api/_places.js`, up to 3 pages).
- **Photos:** about 15 photo lookups per deck (`api/photo.js`). Vercel's CDN
  caches each photo redirect for a day, so a group shares one charge per photo.
- **Rough cost:** 10–20¢ per deck past Google's free monthly usage. Check
  current prices on the Google Maps Platform pricing page.
- **At scale:** 1,000 decks/day is very roughly $3k–$6k/month.
- **Safety caps** (env vars): `DAILY_DECK_LIMIT` (300) and `DAILY_PHOTO_LIMIT`
  (5000). During a viral spike, the deck cap is what blocks new users, so raise
  it deliberately.

## Phase 0: Before launch (settings, no code)

1. Google Cloud budget alerts at $25 / $100 / $500.
2. A per-day request quota on the Places API in the Google Cloud console, as a
   hard backstop.
3. Vercel Pro (~$20/mo). Hobby is non-commercial only, and ads or affiliate
   links count as commercial.
4. Upstash Redis on pay-as-you-go. Each phone polls the deck every 3s, so a
   12-person deck makes a lot of reads. The free tier will likely run out
   before Google costs matter.

## Phase 1: Cut Google cost with no visible change

5. Cache popular searches (area + category/mood) in Redis for a few hours,
   following Google's caching terms. Searches cluster, so expect a big cut.
6. Trim the Text Search field mask to only fields the card shows. Fewer
   fields can mean a cheaper price tier.
7. Load photos only for the top 1–2 cards, not the whole deck.
8. Raise the daily caps as savings and revenue come in.

## Phase 2: NYC fallback mode (on/off switch)

9. Build an NYC place list from OpenStreetMap, which is free to store and
   reuse. Deal NYC decks from it, then call Google only for the 3–5 matched
   places (photos, rating, booking info). That's about 4 Google calls per deck
   instead of about 15.
10. Put it behind one Vercel env var, so it can be flipped on when the bill
    spikes. Outside NYC keeps using Google.

## Phase 3: Money in

11. Turn on affiliates (`VIATOR_PID`, `VIATOR_MCID`, `OPENTABLE_LINK_TEMPLATE`)
    and sell sponsored cards to NYC venues.
12. Apply for Google for Startups Cloud credits.

## Triggers (watch `/stats.html`)

| Signal | Action |
| --- | --- |
| Google spend over $20/day | Do Phase 1 |
| Decks near `DAILY_DECK_LIMIT` | Raise the cap or switch on Phase 2 |
| Steady week-over-week growth | Reinvest affiliate income into the caps |
