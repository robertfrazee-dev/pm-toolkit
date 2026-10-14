# Matchbook

Swipe on places with friends, then rank your matches.

1. Start a deck: pick a category (bars, restaurants, activities, sights and more), type an area or tap **Near me**, and set a radius.
2. Google Maps finds real places with photos, ratings, prices and opening hours.
3. Tap **Invite** to send friends a link. They don't need an account; they just type their name.
4. Everyone swipes. A place everyone says yes to is a match.
5. Everyone drags the matches into their own order. The app adds up the rankings and names a winner.

Decks expire after a week.

## How it's built

- `index.html`: the whole front end. Plain HTML, CSS and JavaScript, no build step.
- `api/deck.js`: creates a deck with Google Places Text Search and returns a deck with everyone's swipes and rankings.
- `api/action.js`: saves swipes and rankings, and starts the ranking round.
- `api/photo.js`: sends place photos without exposing the API key. Vercel caches each photo for a day.
- Storage is Upstash Redis through its REST API, so there are no npm packages to install.
- Friends' screens refresh every 3 seconds while a deck is open.

## Put it online (about 20 minutes, works from a phone)

You need three free accounts. Google asks for a card, but it gives you a free monthly allowance.

### 1. Google Maps API key

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and create a project called `matchbook`.
2. Turn on billing for the project when it asks.
3. Search for **Places API (New)** and tap **Enable**. Make sure it's the one marked "(New)".
4. Go to **APIs & Services → Credentials → Create credentials → API key**.
5. Tap the new key, then under **API restrictions** choose **Restrict key** and select only **Places API (New)**. Save. Leave "Application restrictions" set to None, because the key is used by the server, not the browser.
6. Optional but recommended: in **APIs & Services → Places API (New) → Quotas**, lower the daily request limit (for example to 1,000) so a shared link can never run up a big bill.

Copy the key. You'll paste it into Vercel in step 2.

Each new deck costs about 2 to 4 searches, plus one photo lookup per card the first time it's shown. Check current prices and free allowances at [Google Maps Platform pricing](https://mapsplatform.google.com/pricing/).

### 2. Vercel (hosting)

1. Sign up at [vercel.com](https://vercel.com) with your GitHub account.
2. **Add New → Project**, then import `pm-toolkit`.
3. Set **Root Directory** to `matchbook`. Leave Framework Preset as **Other**.
4. Under **Environment Variables**, add `GOOGLE_MAPS_API_KEY` with your key.
5. Tap **Deploy**.

### 3. Upstash Redis (where decks are saved)

1. In your Vercel project, go to **Storage → Create Database** (or **Marketplace**) and choose **Upstash for Redis**. The free plan is enough.
2. Connect it to the Matchbook project. Vercel adds the database settings for you (`KV_REST_API_URL` and `KV_REST_API_TOKEN`).
3. Go to **Deployments**, open the menu on the latest deployment, and tap **Redeploy** so it picks up the new settings.

Open the `.vercel.app` address Vercel shows you. Add it to your home screen so it opens like an app.

If something isn't set up, the app says which setting is missing when you try to start a deck.

## Booking buttons and partner IDs

The winner card shows **Reserve a table** (OpenTable) for restaurants, **Get tickets** (Viator) for activities and sights, plus **Ride there** (Uber), **Website** and **Call**. They work as plain links until you add partner IDs in Vercel → Settings → Environment Variables:

- `VIATOR_PID` and `VIATOR_MCID`: from the Viator Partner Program.
- `OPENTABLE_LINK_TEMPLATE`: your affiliate network's tracking link for OpenTable, with `{url}` where the OpenTable page address goes.

Redeploy after adding them. Taps are counted per month in Redis under `stats:clicks:YYYY-MM`.

## Limits built in

- 20 new decks per hour from one connection, so a shared link can't burn your Google quota.
- Up to 40 cards per deck and a radius of up to 25 miles.
- Anyone with a deck's link can swipe on it. Codes are random, but don't post a link publicly.
