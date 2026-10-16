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

### Pilot analytics (`api/_events.js`)

- **Events** (who, which deck, which crew, when; kept 120 days in `ev:{day}` lists, with daily totals on the stats page): session created, link opened, joined, swiped, matched, revealed, checked in, rated (counts once ratings ship), "same crew" (saving a deck's people as a crew, or starting a deck for a crew). "Link opened" and starting a crew deck are sent by the browser through `/api/click` (`kind: "event"`); the rest are recorded on the server.
- **Groups:** a crew, or 2+ people who shared a deck. Later decks with the same crew, or 2+ of the same people, belong to the same group. Each session's people are kept 120 days (`mx:s:{code}`, `mx:p:{code}`), so groups outlive decks.
- **Dashboard** (`/stats.html`, top panel): % of groups with a 2nd outing within 14 days (of groups whose first deck is 14+ days old, plus how many newer groups are already back), active groups this week, new groups (7/30 days), swipes per match (last 30 days), groups by week (8 weeks), and the event counts.

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

## Settle up (split the bill)

`api/_bill.js`, `api/_billops.js` and `api/_receipt.js`, served by `/api/action` (`GET ?bill=CODE`, `POST type: "bill*"`), at `/s/CODE`. **Matchbook never touches money:** it does the math and hands each person a pre-filled payment link to whoever paid.

- **Start:** "💸 Settle up" on a finished deck's results or on a crew page. Whoever taps it is the payer; people are filled in from the deck or crew, and the payer can add or remove names. Friends open the link in the browser, are recognized from the deck or crew (or pick their name, or add themselves).
- **The bill:** scan the receipt (the photo is shrunk on the phone, read once by Claude and never stored; quantity lines become single chips, "4 × Bud Light $28" → four $7 chips) or type the total. The payer can edit, add and delete items, with a warning when items don't add up to the subtotal. If the receipt has no tip: 18/20/22% or an amount.
- **Split:** tap an item to claim it, tap again to unclaim (two people tapping at once both land); hold an item to split it among chosen people or "split this line evenly"; or "just split everything evenly". Tax and tip split in proportion to each person's items. Unclaimed items show a counter and the payer can ping the group (push, at most every 2 minutes); at Finish, leftovers split evenly. Everything is in cents and the shares add up exactly to the total.
- **Pay back:** the payer adds a Venmo username and/or Cash App $cashtag once (saved for next time). Each person gets "Pay $23.40 with Venmo" (`https://venmo.com/USER?txn=pay&amount=…&note=Matchbook · Spot`), "Pay with Cash App" (`https://cash.app/$TAG/amount`, which prefills the amount; the note is copied), or "Copy amount", plus "I paid". The payer sees who's paid, can mark someone paid, and can remind who hasn't. The page refreshes every 3 seconds; bills last 30 days.
- **Settings:** `ANTHROPIC_API_KEY` (receipt reading; without it, people type the total) and `DAILY_RECEIPT_LIMIT` (receipts read per day, default 100). Receipts are read with `claude-opus-5-5` (with server-side fallback on refusals), roughly a cent or two each.
- **Events:** tab started, tab opened, split (first claim per person), paid.

## Best of Manhattan, Matchups and check-ins

`api/boards.js`, `api/_best.js` and `api/_checkin.js`, shown on the app's **Top** tab. Manhattan only.

- **Lists:** 34 categories in six sections (big debates like Pizza, Bars, Wings, Burger and Bagels; food; drinks like Espresso Martini, Guinness and Dive Bar; game day; nights out; things to do). Each list comes from a live Google Places search ("best pizza in West Village, Manhattan"), with photos, ratings and reviews.
- **Default order from real data:** a weighted rating (a 4.8 with 40 reviews doesn't beat a 4.6 with 3,000). Then it moves with what groups actually do: points when a place gets picked in a deck (a group win counts most) or checked in at.
- **Where:** all of Manhattan, near me (½, 1 or 2 mi), or a neighborhood: pick from the list or type one ("west vill", "LES", "Hell's Kitchen" all work; anything else in Manhattan is looked up). A neighborhood shows only places in that neighborhood. The choice sticks until changed.
- **Tier It (the one game, `api/_tiers.js`):** one tap per place: S, A, B, C, D, ♥ want to try, or skip. You can tier anywhere, been or not. Places your crews have tiered come first, then places you've checked in at. Your tiers make your own tier list (shareable image); your crew's tiers merge into the crew's tier list, where people who've checked in at a place count double. Also: the crew's hottest take (one person two or more tiers off from everyone else) and "Your crew says go" (places the crew puts in S or A that you haven't tiered or been to). Tiers never change the public lists.
- **Quests (`api/_quests.js`):** a crew takes on a list. "Start as a crew quest" on any Top list snapshots up to 30 spots for the current where (a near-me quest doesn't keep your location); the API also takes the crew's own list of place IDs. Progress ("9 of 30 tried") counts a spot once anyone in the crew has checked in there. The quest's ranking is the crew's Tier It marks on those spots (checked-in votes count double), with the hot take. "Swipe what we haven't tried" starts a crew deck of the untried spots; "Share progress" makes a progress-and-ranking image. Quests show on the crew page. It's always the crew's ranking, never a "best".
- **Check-ins:** Google's nearby places within 250 m of your phone; crews get a push, points (+10, +10 new spot, +5 linked up with crewmates), weekly streak, "Your nights", crew "Out and about" and "Out the most this month", anonymous "Out tonight" counts (from `TONIGHT_MIN` people, default 2).
- **Top tab = two chips, 🔥 Tonight and 🏆 Rankings** (remembered on the phone). **Tonight**: neighborhood heat boxes (color only, no photos or emoji: the more activity, the deeper the red; grey when quiet; top 4 at a glance, "All" shows the rest; LES, East Village, West Village, Chelsea, Murray Hill, UES, FiDi always listed; tap to filter), **Bars popping off tonight** as photo cards, everything else trending, swipe the hottest, check in. If tonight is still quiet it shows the most recent week or month and says so. **Rankings**: the best-of lists for the current neighborhood / radius, right away. The last answer is cached on the phone so the tab paints instantly; the server keeps each answer for a minute.
- **Trending (Top tab):** Tonight (5am–5am New York), This week and This month, computed only from what people do on Matchbook: swipe yeses (1 pt), making a group's shortlist (3), being a group's pick (8) and check-ins (5; a count only shows from 2 people). Never Google ratings, never paid. Filtered by the same neighborhood / near-me picker; falls back to a longer window when tonight is quiet. "Swipe the hottest N" turns the list into a deck. Redis: `tr:n:{night}` / `tr:w:{week}` (place → points, `:c` counts, `:h` neighborhoods) and `tr:loc` (place → coordinates, 30 days); This month reads the existing per-area hot lists. API: `GET /api/boards?op=trending&window=tonight|week|month[&auto=1][&area=…|&lat&lng&mi]`.
- **Google costs:** results are kept in memory for an hour (Google's content isn't stored; Matchbook keeps place IDs and its own numbers). Daily caps: `BEST_DAILY_LIMIT` list searches (default 1500) and `CHECKIN_DAILY_LIMIT` nearby searches (default 1000).
