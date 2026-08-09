# The Barn — Bar Inventory

A mobile-first, offline-capable inventory app for The Barn's bar operations: daily physical counts, deliveries, event consumption, and reporting. No Microsoft account, no Copilot/Power Apps, no backend to stand up — it runs entirely in the browser and installs like a native app on a phone.

## What it does

- **Inventory** — every product has a category, measurement unit (liquid ounces for liquor, bottles for wine/beer/mixers/table-side wine), beginning inventory, current on-hand, par level, cost per unit, and computed total value.
- **Daily count** — enter what's physically on hand; the app diffs it against the last on-hand figure and logs the difference as usage (a decrease) or a positive adjustment (an increase), so consumption can never go negative.
- **Restocks** — record a delivery and the received quantity is added straight to on-hand.
- **Events** — tag a count with an event to get a per-event consumption report (servings, revenue, ounces, bottles).
- **Reports** — 7/30/90-day or custom date ranges: total consumption, expected revenue, inventory value, low-stock items, top consumed products, a day-by-day trend chart, consumption by category, and consumption by event. Exportable as CSV; printable to PDF.
- **DNI bank ("Do Not Inventory")** — write off product from official on-hand and cost (e.g. during a period with strong food/beverage cost) and bank it separately. Banked stock can later be poured or comped for free — drawing it down never touches on-hand or cost again, since it was already written off once. Every write-off and draw-down is logged.
- **Activity history** — a complete, filterable audit log of every count, restock, adjustment, write-off, DNI use, and item change.
- **Backup & restore** — export everything to a JSON file, restore it on any device, or reset back to the bundled sample data.
- **Installable PWA** — add-to-home-screen on iPhone and Android, works fully offline after first load. Bottom-nav tabs and PWA shortcuts (Count, Reports, DNI) are deep-linkable via URL hash (e.g. `#dni`).

The app opens with realistic sample data modelled on the venue's existing consumption spreadsheet, so it looks and reconciles correctly on first run.

## Project structure

```
index.html            Markup for every screen (single page, seven views + modal)
styles.css             Design system: warm paper background, forest green, sage/brass accents
src/core.mjs           Pure domain logic — inventory math, validation, reporting (no DOM, no storage)
src/storage.mjs        Persistence adapter + repository (localStorage today, swappable later)
src/seed.mjs           Deterministic sample data, built by replaying real counts/restocks
src/app.js             UI controller: rendering, events, modals — the only file that touches the DOM
manifest.webmanifest   PWA manifest
sw.js                  Offline service worker (cache-first app shell)
icons/                 App icons (SVG source + generated PNGs)
server.mjs             Zero-dependency static file server for local development
tests/                 Unit tests (node:test) for every inventory calculation
```

`src/core.mjs` has zero dependencies on the DOM or on `localStorage`. All state changes flow through it, and all persistence flows through the single adapter interface in `src/storage.mjs`. That split is deliberate: to move The Barn onto a shared, multi-device backend later, write one more adapter (a stub is sketched, commented out, at the bottom of `storage.mjs`) that talks to your API instead of `localStorage` — nothing in `app.js` or `core.mjs` has to change.

## Running it locally

Requires Node 18+. No install step — the app has zero runtime dependencies.

```bash
npm start
```

This starts a tiny static server (see `server.mjs`) and prints a local and a network URL, e.g.:

```
Local:   http://localhost:4173
Network: http://10.0.0.184:4173
```

Open the **Local** URL on your computer. To try it on your phone while developing, open the **Network** URL from a phone on the same Wi-Fi (see the HTTPS note below for why install-to-home-screen won't work over that plain-HTTP network URL).

You do not need a build step, bundler, or framework — everything is native ES modules and CSS.

## Installing on a phone

**Important: installing to a home screen (the PWA "Add to Home Screen" / "Install app" flow) requires the page to be served over `https://`.** Browsers only register service workers and offer install prompts on a secure origin — `http://` (including a plain LAN address like `http://10.0.0.184:4173`) will run the app fine in a regular browser tab, but will not offer a real install.

To install it on a real phone:

1. Deploy the four static files (`index.html`, `styles.css`, `src/`, `manifest.webmanifest`, `sw.js`, `icons/`) to any HTTPS static host — GitHub Pages, Netlify, Vercel, Cloudflare Pages, or your own server behind TLS all work with no configuration changes.
2. Open the HTTPS URL on the phone.
3. **iPhone (Safari):** tap the Share icon → **Add to Home Screen**.
4. **Android (Chrome):** tap the **⋮** menu → **Add to Home screen** / **Install app** (Chrome may also show an automatic install banner).
5. Launch it from the home screen icon — it opens full-screen, with no browser chrome, and keeps working offline afterward.

The in-app **Settings → Install** button triggers the native install prompt when the browser supports it, and shows the right manual instructions otherwise.

## Data, sync & backups

This deployment shares one live inventory across every device that opens it, via a small Firestore-backed sync layer (`src/firestore-sync.mjs`):

- Every device that has the app open sees changes from any other device automatically, with no login and no manual refresh.
- Each device also keeps a local `localStorage` cache (`src/storage.mjs`), so the app still works — you can view and edit — if the connection drops. It reconciles with the shared copy once back online.
- Settings shows live sync status ("Synced live" / "Working locally only") so it's obvious when a device has fallen offline.
- Access is open by design (matching the venue's choice not to gate it behind a PIN) — the Firestore security rules (`firestore.rules`) expose only the `/barn/**` path this app uses, nothing else in the project.
- **Export a backup regularly anyway** (Settings → Export) — it's a single JSON file with every product, event, and history entry, useful as an independent copy or to migrate to a different backend later.
- **Import** (Settings → Import) replaces the *shared* inventory for every connected device — the app confirms before doing this.
- If `localStorage` is blocked (e.g. strict private-browsing mode), the app falls back to in-memory storage for that session and shows a warning in Settings.

To run this app as a fully local/offline-only tool instead (no shared backend), delete the `subscribeShared`/`writeShared` calls in `src/app.js`'s `boot()`/`save()` — `src/storage.mjs`'s local adapter keeps working standalone.

## Running the tests

```bash
npm test
```

This runs `node --test` over `tests/*.test.mjs` — no test framework dependency required. Coverage includes:

- inventory value and per-unit totals (ounces vs. bottles kept separate)
- low-stock / out-of-stock thresholds and reorder quantities
- count → usage/adjustment calculation, including partial counts, unchanged counts, counting to zero, and negative/non-numeric rejection
- restock behaviour, including fractional deliveries and rejecting zero/negative/unknown-item requests
- manual adjustments, including the floor-at-zero guard
- DNI write-offs and draw-downs: banking stock out of on-hand/cost, using banked stock without re-touching cost, preserving a product's balance across edits, and rejecting over-drawn amounts
- item validation (duplicate names, blank fields, category/unit defaults)
- reporting: date-range filtering, trend buckets, top products, consumption by category and by event
- backup export/import round-tripping and rejection of invalid files
- the bundled sample data set: it reconciles exactly against the venue's spreadsheet figures

**Latest run: 79/79 tests passing.**

## Design notes

The visual design intentionally avoids a generic admin-dashboard look: a warm off-white paper background, a deep forest-green primary color, sage and brass accents, a serif display face for headings paired with system sans-serif for everything else, sticky bottom navigation, a sticky save action on the count screen, and 44px+ tap targets throughout for one-handed use during service.

## What's not included (and why)

- No Microsoft/Copilot/Power Apps dependency of any kind.
- No bundler or framework — the app is native ES modules, loaded directly by the browser (Firebase's SDK loads the same way, from a CDN, only when sync is used), so there's nothing to build and nothing to keep updated.
- No required backend for the *code* — `src/storage.mjs` isolates persistence behind an adapter, and `src/firestore-sync.mjs` is an optional layer on top of it. This deployment happens to use that layer for live shared sync (see above), but the app runs fine local-only with it removed.
- No accounts or login — access control for this shared deployment is intentionally simple (open, scoped to one Firestore path); add real auth in `firestore.rules` if that stops being enough (e.g. the venue grows past one trusted device group).
