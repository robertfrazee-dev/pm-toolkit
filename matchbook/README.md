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

## Best of NYC: boards and games

`api/boards.js` and `api/_nyc.js`, shown on the app's **Top** tab.

- **The list:** bars, restaurants, cafés, nightlife, music venues, things to do, sights and parks in all five boroughs come from OpenStreetMap (free to store, credited on every board). It builds itself: the first time anyone opens the Top tab (or once the list is a month old, or from an older version), the app pulls the next part each call while showing progress, one part at a time behind a lock. The stats page ("Best of NYC list" → Build the list) can also force a rebuild. It pulls 32 parts from the Overpass API (a few per borough; a part that fails is retried in the background every 20 minutes until it's in) and sorts them into 33 boards in six sections: the big debates (Pizza, Bars, Buffalo Wings, Burger, Bagels), food (Italian, Thai, Chinese, Sushi, Mexican, Indian, Ramen, Steakhouse, Brunch, Restaurants, Dessert, Coffee), drinks (Espresso Martini, Pint of Guinness, Happy Hour, Dive Bar, Rooftop, Wine Bar), game day (Sports Bars, NFL Game Day Bar), nights out (Date Night Spot, Date Activities, Late-Night, Crazy Night, Live Music) and things to do. Rebuild every month or so; votes and rankings are kept. Optional: `OVERPASS_URL` to use a different Overpass server.
- **Near me:** every board, and every game, can be All NYC, a radius around you (½, 1, 2 or 5 miles; your location stays on your device and is only sent with board requests), or one neighborhood.
- **Rankings:** each place has a chess-style rating per board from every head-to-head vote, plus points when real groups pick it in an NYC deck (a group win counts most). A place needs 5 votes or one group win before it gets an official rank.
- **This or That:** 5 matchups a day per person, one per board, each a close match or a newcomer. Votes are tied to the matchups the server handed out (no stuffing), with a daily streak.
- **King of the Hill:** the champ stays on until a challenger beats it; every challenger is new to the run. Your longest reign is your record.
- **Brackets:** 8 or 16 places seeded by rank (near you or all NYC), 1 plays 8, 4 plays 5…, down to a champ.
- **Your champ and your crew's top 3:** the last place you crowned (on the hill or in a bracket) shows next to the city's #1. Every vote also counts on each of your crews' own boards, a bracket title counts extra and a crew night's winner counts most, so each crew has its own top 3 per board (on the board and on the crew page).
- People can nominate a missing place from the NYC list onto a board, and swipe a board's top list as a deck with friends.

## Check-ins

`api/_checkin.js`, routed through `api/boards.js` (no extra function), shown on the Top tab, the crew page and "Your nights".

- **Check in** at a place on the NYC list. Your phone's location has to be within 250 m of it (checked on the server), once per place per night (a night runs 5am to 5am New York time), up to 12 a night.
- **Your crews get a push:** "📍 Rob checked in at Hudson Hound in Hell's Kitchen" (one per person even across shared crews, at most one per crew every 15 minutes; it opens the crew page). You can turn "Tell my crews" off for a check-in.
- **Points:** 10 per check-in, +10 for a new spot, +5 when someone from your crew is checked in at the same place that night ("linked up"). **Streak:** at least one check-in each week. "Your nights" shows points, streak, check-ins, spots, your top spots and recent ones.
- **Crew page:** "Out and about" (crew check-ins from the last two days) and "Out the most this month" (points).
- **Out tonight:** anonymous counts of people checked in at each place tonight, on the Top tab (near you or all NYC) and on board rows. A place only shows once at least `TONIGHT_MIN` people (default 2) are there.
- A check-in is also a small real-world vote: a little credit on the city boards and the checker's crews' boards.
