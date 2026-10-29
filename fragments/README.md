# Fragments

An AI "external brain" for people with ADHD. Say anything and it gets filed.

Built one phase at a time. **Current status: Phase 1 (capture + storage).**

| Phase | Status |
|---|---|
| 1. Capture + storage | Done |
| 2. Organizer | Not started |
| 3. Today view + notifications | Not started |
| 4. Watch capture | Not started |
| 5. Premium actions | Not started |
| 6. Polish | Not started |

## Run it

```bash
cd fragments
npm install
cp .env.example .env     # DATABASE_URL defaults to a local SQLite file
npm run db:setup         # creates the database and seeds the default Areas
npm run dev
```

Open http://localhost:3000. Home goes to **Capture** until the Today view exists (Phase 3).

## What's here

- `prisma/schema.prisma`: the full data model from the spec. All tables exist now; later phases fill them.
- `prisma/seed.ts`: default Areas (Health, Work, Side Projects, Home, Money, People) and the settings row.
- `src/lib/fragments.ts`: `saveFragment()`, the one entry point every capture goes through. It saves the raw text first so nothing is lost.
- `/capture`: big mic button (browser dictation via the Web Speech API) plus a text box. Ctrl/Cmd+Enter saves.
- `/timeline`: every fragment, newest first, grouped by day, with its source and whether it's been organized.

Dictation works in Chrome, Edge and Safari. Firefox has no Web Speech API, so it shows the text box only.
