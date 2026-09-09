# packdrop-prices

Daily price sync for PackDrop, sourced from tcgcsv.com (a free mirror of
TCGplayer's catalog/pricing API). Runs once a day via GitHub Actions,
publishes small per-set JSON files that PackDrop fetches client-side
through jsDelivr — no server to host, no API key needed.


## Testing locally before relying on the Action

```bash
node scripts/fetch-prices.mjs
cat prices/mep.json | head -c 500
```

## Once a set has run successfully

```
https://cdn.jsdelivr.net/gh/YOUR_USER/YOUR_REPO@main/prices/mep.json
https://cdn.jsdelivr.net/gh/YOUR_USER/YOUR_REPO@main/prices/index.json
```

jsDelivr caches aggressively up to ~24h

## Adding another set or game later

Add an entry to `config/sets.json` with its `categoryId` (Pokémon=3,
Magic has its own id — check `https://tcgcsv.com/tcgplayer/categories`)
and `groupId`.
