# Matchbook: App Store listing

Copy these into App Store Connect. Character limits are Apple's.

## App information
- **Name** (30): Matchbook — if taken, try `Matchbook: Pick a Place` or `Matchbook Group Picker`
- **Subtitle** (30): Swipe together. Pick a place.
- **Bundle ID:** com.robertfrazee.matchbook
- **Primary category:** Food & Drink
- **Secondary category:** Lifestyle
- **Age rating:** answer "Infrequent/Mild" for *Alcohol, Tobacco, or Drug Use or References* (the app lists bars). Everything else "None". Expect 12+.

## Promotional text (170)
Can't decide where to go? Swipe on real places near you with friends or family, see what everyone said yes to, then rank your matches to pick a winner.

## Description
Picking a bar, a restaurant or something to do with a group usually means a long group chat and no decision. Matchbook makes it a two-minute game.

HOW IT WORKS
• Pick what you're deciding on: bars, restaurants, coffee and brunch, activities, sights, outdoors, live music, dessert, or anything you type.
• Search near you or anywhere, and set a radius.
• Send one link to your partner, your family or the whole group chat. No accounts, no sign-up.
• Everyone swipes: right for yes, left for no.
• When the last person finishes, everyone ranks the places the group agreed on, and Matchbook picks the winner.

MADE FOR GROUPS
• Works for two people or twelve.
• The host decides what counts as a match, like "at least 8 of 12 said yes."
• Get a notification when it's time to rank and when the winner is picked.

REAL PLACES
• Photos, ratings, prices, distance and opening hours from Google Maps.
• Open any place in Google Maps with one tap.

## Keywords (100, comma-separated, no spaces after commas)
group,decide,where to eat,restaurant,bar,swipe,friends,family,vote,date night,things to do,picker

## URLs
- **Support URL:** https://github.com/robertfrazee-dev/pm-toolkit/issues
- **Marketing URL:** https://pm-toolkit-matchbook.vercel.app
- **Privacy Policy URL:** https://pm-toolkit-matchbook.vercel.app/privacy.html

## App Privacy ("nutrition label")
Tracking: **No**. Data is **not linked to the user's identity** (there are no accounts).

| Data type | Collected | Purpose |
|---|---|---|
| Contact Info → Name | Yes (first name typed in) | App Functionality |
| Location → Coarse Location | Yes (only with Near me, rounded ~100 m) | App Functionality |
| User Content → Other User Content | Yes (swipes and rankings) | App Functionality |
| Identifiers → Device ID | Yes (random app ID, push token) | App Functionality |

## Screenshots
Use the five PNGs in `screenshots/` for the 6.9" iPhone slot (1290 × 2796). They use made-up places.

## Notes for App Review
Matchbook has no login. To try it on one device: enter a name, pick "Bars", type a city (for example "Chicago"), and tap Find places. Swipe through the deck, then tap Invite to see the share sheet. Group features (matching, the ranking round and the winner) need a second device or simulator: open the invite link there, join with another name and swipe. Native features: push notifications when it's time to rank and when a winner is picked, haptic feedback on swipes and matches, the iOS share sheet, and invite links that open the app (Universal Links).
