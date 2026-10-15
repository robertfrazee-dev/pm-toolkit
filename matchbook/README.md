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
- `api/hot.js` and `api/_hot.js`: "Hot on Matchbook". Every swipe, match and win is counted per place (by Google place ID, the one piece of Google data that may be stored), plus monthly points per ~2 km square for each area's hot list. A place only shows stats once it has `HOT_MIN_SWIPES` swipes (default 20) from `HOT_MIN_GROUPS` groups (default 3). The area list looks up names fresh from Google each time (up to 10 lookups per view, capped by `HOT_DAILY_LIMIT` views a day, default 200).
- `api/market.js` (with `_market.js`, `_stripe.js`, `_auth.js`): group deals. Venues sign up at `/venue.html`, list offers (bundle, price per person, group size, weekly times, groups per time) and boost them; you approve venues at `/admin.html`. Groups book a time and each person pays their share from the booking link (`/b/ID`). Cards are only authorized when each person pays and are captured once every share is in; if the group doesn't fill by the deadline (2 hours before, at most 48 hours after booking) the holds are released and nobody is charged. Matchbook's cut (`MATCHBOOK_FEE_PERCENT`, default 10) is taken automatically through Stripe Connect. Boosted offers (`BOOST_DAILY_CENTS`, default 500) show as sponsored cards every 8 swipes nearby. One route handles all of it to stay within Vercel's function limit.
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

The winner card shows **OpenTable** and, for NYC-area decks, **Resy** reservation buttons for restaurants, **Get tickets** (Viator) for activities and sights, plus **Ride there** (Uber), **Website** and **Call**. They work as plain links until you add partner IDs in Vercel → Settings → Environment Variables:

- `VIATOR_PID` and `VIATOR_MCID`: from the Viator Partner Program.
- `OPENTABLE_LINK_TEMPLATE`: your affiliate network's tracking link for OpenTable, with `{url}` where the OpenTable page address goes.

Redeploy after adding them. Taps are counted per month in Redis under `stats:clicks:YYYY-MM`.

## Stats

Open `/stats.html` on your site and enter your stats key to see decks started, people joining, decks reaching ranking and a winner, booking taps, and Google usage by day. Turn it on by adding `STATS_KEY` (any long random password) in Vercel → Settings → Environment Variables, then redeploy.

## Limits built in

- 20 new decks per hour from one connection, so a shared link can't burn your Google quota.
- At most 300 Google-backed decks and 5,000 photos per day across everyone. Change them with `DAILY_DECK_LIMIT` and `DAILY_PHOTO_LIMIT` in Vercel. Past the photo limit, cards show without photos. Past the deck limit, people see a "try again tomorrow" message; saved-places decks still work.
- Up to 40 cards per deck and a radius of up to 25 miles.
- Anyone with a deck's link can swipe on it. Codes are random, but don't post a link publicly.

## Group deals setup

Group deals need these in Vercel (Settings → Environment Variables), then a redeploy:

- `STRIPE_SECRET_KEY`: from the Stripe dashboard (Developers → API keys). Use the test key (`sk_test_...`) first.
- `STRIPE_WEBHOOK_SECRET`: in Stripe, Developers → Webhooks → Add endpoint `https://YOUR-SITE/api/market?op=stripe` with the events `checkout.session.completed`, `checkout.session.expired` and `account.updated` (tick "Listen to events on Connected accounts" too). Copy its signing secret.
- `ADMIN_KEY`: any long random password; it opens `/admin.html` to approve venues.
- `CRON_SECRET`: any long random string; Vercel's daily job uses it to close bookings that ran out of time.
- Stripe Connect has to be turned on in your Stripe account (Connect → Get started, "Platform or marketplace").
- Optional: `MATCHBOOK_FEE_PERCENT`, `BOOST_DAILY_CENTS`, `SITE_URL`.

Without `STRIPE_SECRET_KEY`, venues can still sign up and create offers; booking shows "opens soon".
## Notifications and timers

- **Web push** works with no setup: the server makes its push keys on first use and keeps them in Redis. Android and desktop browsers can turn notifications on from any deck. iPhones can only get web push after adding Matchbook to the Home Screen and opening it from there (Apple's rule); the app shows a tip for that.
- **Timers:** the host picks how long swiping stays open (default 15 minutes) and how long ranking gets (default 5). Two minutes before a step closes, everyone who isn't done gets a reminder; when time's up the step closes on its own and everyone is told.
- **QStash (recommended):** so reminders go out even when nobody has the app open, add `QSTASH_TOKEN` in Vercel (Upstash console → QStash → copy the token; it's free for this volume). Without it, timers still close the step and send reminders, but only when someone in the deck has Matchbook open.
