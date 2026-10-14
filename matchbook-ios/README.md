# Matchbook for iPhone

The App Store version of [Matchbook](../matchbook). It's a [Capacitor](https://capacitorjs.com) app that loads the live site (`pm-toolkit-matchbook.vercel.app`), so web updates reach the app without a new App Store release. The app adds:

- **Push notifications:** "Alex joined your deck" (host), "Time to rank" (everyone), "It's decided" (everyone). Tapping one opens that deck.
- **Haptics** on swipes, matches, reordering and the winner.
- **The iOS share sheet** for invites.
- **Universal Links:** invite links (`/j/CODE`) open the app when it's installed and the website when it isn't.

The web page detects the app through `window.Capacitor` and uses the plugins only there, so the website is unchanged in a browser.

## What's here

| Path | What it is |
|---|---|
| `capacitor.config.json` | App ID `com.robertfrazee.matchbook`, name, and the live site URL |
| `ios/App` | The Xcode project (Swift Package Manager, no CocoaPods) |
| `ios/App/App/App.entitlements`, `AppRelease.entitlements` | Push and Associated Domains (development / App Store) |
| `www/` | Offline fallback page shown if the site can't load |
| `app-store/` | Listing text, privacy answers, review notes and screenshots |
| `../codemagic.yaml` | Cloud build that uploads to TestFlight, so no Mac is needed |

## Publishing, step by step

1. **Join the Apple Developer Program** ($99/year) at developer.apple.com/programs.
2. **Register the app ID.** In developer.apple.com → Certificates, IDs & Profiles → Identifiers → +, choose App IDs → App, set the Bundle ID to `com.robertfrazee.matchbook`, and tick **Push Notifications** and **Associated Domains**.
3. **Create a push key.** In Keys → +, tick **Apple Push Notifications service (APNs)**, then download the `.p8` file (you can only download it once). Note the **Key ID**, and your **Team ID** (top right of the developer site).
4. **Add the push key to Vercel.** In the `pm-toolkit-matchbook` project → Settings → Environment Variables, add:
   - `APNS_KEY`: the whole contents of the `.p8` file
   - `APNS_KEY_ID`: the Key ID
   - `APNS_TEAM_ID`: the Team ID

   Then redeploy. The Team ID also turns on invite links opening the app.
5. **Create the app in App Store Connect** (appstoreconnect.apple.com → Apps → +): platform iOS, name Matchbook (see `app-store/listing.md` if it's taken), bundle ID `com.robertfrazee.matchbook`, SKU `matchbook`. Copy the **Apple ID** number from App Information into `APP_STORE_APPLE_ID` in `../codemagic.yaml`.
6. **Create an App Store Connect API key** (Users and Access → Integrations → App Store Connect API → +, access **App Manager**). Download the `.p8`, and note the Issuer ID and Key ID.
7. **Set up Codemagic** (codemagic.io, sign in with GitHub): add `pm-toolkit`, then Team settings → Integrations → Developer Portal → add the API key from step 6 and name it **Matchbook**. Start the **Matchbook iOS** workflow. It builds on a Mac, signs the app, and uploads it to TestFlight.
8. **Test with TestFlight** on your iPhone. Then fill in the listing from `app-store/listing.md`, add the screenshots, and submit for review.

## Changing the app

- Web changes: push to `main` and Vercel deploys. The app picks them up next launch.
- Native changes (plugins, icon, permissions): edit here, run `npx cap sync ios`, bump the version in Xcode build settings (`MARKETING_VERSION`), and run the Codemagic workflow again.
