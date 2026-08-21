# packdrop-prices

Daily price sync for PackDrop, sourced from tcgcsv.com (a free mirror of
TCGplayer's catalog/pricing API). Runs once a day via GitHub Actions,
publishes small per-set JSON files that PackDrop fetches client-side
through jsDelivr — no server to host, no API key needed.

## One-time setup

1. Create a new **public** GitHub repo and push this folder to it.
   (Must be public so jsDelivr's `gh` CDN can serve the files for free.)
2. Fill in `config/sets.json` with the real `groupId` for each set —
   look it up at `https://tcgcsv.com/tcgplayer/{categoryId}/groups`
   (open it directly in a browser tab; the CORS restriction only blocks
   JS `fetch()`, not normal navigation).
3. In `scripts/fetch-prices.mjs`, replace `PUT_YOUR_REPO_HERE` in the
   `USER_AGENT` constant with your actual repo URL — tcgcsv.com asks for
   a real identifying User-Agent per their usage guidelines.
4. Push. The workflow runs automatically every day at 21:30 UTC, or
   trigger it manually from the repo's Actions tab (`Run workflow`) to
   test it immediately without waiting for the schedule.

## Testing locally before relying on the Action

```bash
node scripts/fetch-prices.mjs
cat prices/mep.json | head -c 500
```

## Once a set has run successfully

Your prices are live at:

```
https://cdn.jsdelivr.net/gh/YOUR_USER/YOUR_REPO@main/prices/mep.json
https://cdn.jsdelivr.net/gh/YOUR_USER/YOUR_REPO@main/prices/index.json
```

jsDelivr caches aggressively (up to ~24h, matching our own update cadence
fine), so PackDrop can just `fetch()` that URL directly with no auth,
no CORS issues, and a client-side `localStorage` cache with a 24h TTL
on top so it's not re-fetching every page load.

## Adding another set or game later

Add an entry to `config/sets.json` with its `categoryId` (Pokémon=3,
Magic has its own id — check `https://tcgcsv.com/tcgplayer/categories`)
and `groupId`. Nothing else in the pipeline needs to change — this is
the "future proof" part.
