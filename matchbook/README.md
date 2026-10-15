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

## Notifications and timers

- **Web push** works with no setup: the server makes its push keys on first use and keeps them in Redis. Android and desktop browsers can turn notifications on from any deck. iPhones can only get web push after adding Matchbook to the Home Screen and opening it from there (Apple's rule); the app shows a tip for that.
- **Timers:** the host picks how long swiping stays open (default 15 minutes) and how long ranking gets (default 5). Two minutes before a step closes, everyone who isn't done gets a reminder; when time's up the step closes on its own and everyone is told.
- **QStash (recommended):** so reminders go out even when nobody has the app open, add `QSTASH_TOKEN` in Vercel (Upstash console → QStash → copy the token; it's free for this volume). Without it, timers still close the step and send reminders, but only when someone in the deck has Matchbook open.

## Crews

A crew is a group that decides together again and again (`api/crew.js`, `api/_crew.js`, links at `/c/CREWID`).

- Make one from the Crews tab, or tap "Save this group as a crew" on any deck's results (everyone in that deck joins; a finished deck becomes the crew's first night).
- "Start a deck for the crew" sends every member a push with the deck, so there's no link to pass around, and the crew page shows the live deck. Anyone who joins a crew deck, or opens the crew link, becomes a member.
- Each finished crew deck is kept as a short summary (places, winner, each person's yeses and ranking) for 400 days, so stats outlive the decks: best picker (whose #1 won), who's in sync (same yes/no on the same cards), wild card, easiest and hardest to please, most picked places, and "Next time?" (places lots of the crew liked that never won, swipeable as a deck).
- People are matched by name inside a crew, so someone who used two browsers still counts once.

## Best of Manhattan, Matchups and check-ins

`api/boards.js`, `api/_best.js` and `api/_checkin.js`, shown on the app's **Top** tab. Manhattan only.

- **Lists:** 34 categories in six sections (big debates like Pizza, Bars, Wings, Burger and Bagels; food; drinks like Espresso Martini, Guinness and Dive Bar; game day; nights out; things to do). Each list comes from a live Google Places search ("best pizza in West Village, Manhattan"), with photos, ratings and reviews.
- **Default order from real data:** a weighted rating (a 4.8 with 40 reviews doesn't beat a 4.6 with 3,000). Then Matchbook moves it: matchup votes (chess-style) and points when real groups pick a place in a deck (a group win counts most) or check in.
- **Where:** all of Manhattan, near me (½, 1 or 2 mi), or a neighborhood: pick from the list or type one ("west vill", "LES", "Hell's Kitchen" all work; anything else in Manhattan is looked up). A neighborhood shows only places in that neighborhood. The choice sticks until changed.
- **Matchups (the one game):** two places from the list; the one you pick stays on until something beats it, and challengers come down the list in order. Each pair counts once per person a week. Your last winner is "Your #1" on the list; every pick also counts on each of your crews' own top 3.
- **Check-ins:** Google's nearby places within 250 m of your phone; crews get a push, points (+10, +10 new spot, +5 linked up with crewmates), weekly streak, "Your nights", crew "Out and about" and "Out the most this month", anonymous "Out tonight" counts (from `TONIGHT_MIN` people, default 2).
- **Google costs:** results are kept in memory for an hour (Google's content isn't stored; Matchbook keeps place IDs and its own numbers). Daily caps: `BEST_DAILY_LIMIT` list searches (default 1500) and `CHECKIN_DAILY_LIMIT` nearby searches (default 1000).
