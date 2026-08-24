// PackDrop price fetcher — pulls product+price data from tcgcsv.com for the
// sets configured in config/sets.json, joins them, and writes one compact
// JSON file per set into prices/. Meant to run once a day (see the GitHub
// Actions workflow) — never call this from the browser, tcgcsv.com's CORS
// policy is intentionally closed to client-side fetches.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const BASE = 'https://tcgcsv.com/tcgplayer';
const USER_AGENT = 'PackDropPriceSync/1.0 (github.com/PUT_YOUR_REPO_HERE)';
const SLEEP_MS = 100; // tcgcsv.com's usage guidelines ask for ~100ms between requests

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  const json = await res.json();
  if (json.success === false) throw new Error(`${url} -> API reported failure`);
  return json.results;
}

async function resolveGroupId(categoryId, setName, cachedGroupId) {
  if (cachedGroupId) return cachedGroupId;
  const groups = await fetchJson(`${BASE}/${categoryId}/groups`);
  await sleep(SLEEP_MS);
  const match = groups.find(
    (g) => g.name.trim().toLowerCase() === setName.trim().toLowerCase()
  );
  if (!match) {
    throw new Error(
      `Could not find a group named "${setName}" in category ${categoryId}. ` +
      `Check the name against https://tcgcsv.com/tcgplayer/${categoryId}/groups`
    );
  }
  return match.groupId;
}

// TCGplayer's "Number" extendedData field looks like "139/195" (Pokémon)
// or sometimes just "139". We store both the raw string and a normalized
// leading-number so the PackDrop client can match against Scryfall
// collector_number / TCGdex localId without worrying about formatting.
function normalizeNumber(raw) {
  if (!raw) return null;
  const match = raw.match(/^([A-Za-z0-9]+)/);
  return match ? match[1] : raw;
}

// Optional per-set manual overrides for cards the automatic Number-field
// matching gets wrong (promos, alt-art duplicates, TCGplayer typos, etc.).
// File: config/overrides/<packdropCode>.json — an array of either
//   { "productId": 451396, "numberKey": "139" }   -> force this key
//   { "productId": 451397, "exclude": true }      -> drop this product entirely
async function loadOverrides(packdropCode) {
  const overridePath = path.resolve(`config/overrides/${packdropCode}.json`);
  try {
    const raw = await readFile(overridePath, 'utf-8');
    const list = JSON.parse(raw);
    const map = new Map();
    for (const entry of list) map.set(entry.productId, entry);
    return map;
  } catch {
    return new Map(); // no override file for this set — fine, that's the default
  }
}

async function fetchSetPrices(set) {
  const groupId = await resolveGroupId(set.categoryId, set.name, set.groupId);
  const overrides = await loadOverrides(set.packdropCode);

  const products = await fetchJson(`${BASE}/${set.categoryId}/${groupId}/products`);
  await sleep(SLEEP_MS);
  const prices = await fetchJson(`${BASE}/${set.categoryId}/${groupId}/prices`);
  await sleep(SLEEP_MS);

  // Group prices by productId since one product can have several rows
  // (one per subTypeName — Normal, Holofoil, Reverse Holofoil, etc.)
  const pricesByProduct = new Map();
  for (const p of prices) {
    if (!pricesByProduct.has(p.productId)) pricesByProduct.set(p.productId, []);
    pricesByProduct.get(p.productId).push({
      finish: p.subTypeName,
      market: p.marketPrice,
      low: p.lowPrice,
    });
  }

  const cards = [];
  for (const product of products) {
    const override = overrides.get(product.productId);
    if (override?.exclude) continue;

    const numberField = product.extendedData?.find((f) => f.name === 'Number');
    if (!numberField && !override?.numberKey) continue; // sealed product, not a card

    const productPrices = pricesByProduct.get(product.productId) || [];
    if (productPrices.length === 0) continue; // no price data yet, skip

    cards.push({
      name: product.name,
      number: numberField?.value ?? null,
      numberKey: override?.numberKey ?? normalizeNumber(numberField.value),
      productId: product.productId,
      url: product.url,
      prices: productPrices,
    });
  }

  return {
    packdropCode: set.packdropCode,
    tcgplayerGroupId: groupId,
    updatedAt: new Date().toISOString(),
    cards,
  };
}

// Manually-priced cards for sets/cards that have no TCGplayer product to
// fetch from at all (not a matching problem — genuinely no listing yet,
// e.g. an ultra-low-pop chase with too few sales for TCGplayer to price).
// File: config/manual-prices/<packdropCode>.json — an array of:
//   { "numberKey": "551", "name": "Traveling Chocobo", "prices": [{ "finish": "Normal", "market": 350 }] }
// Merged into the output as-is (same shape as a fetched card), tagged
// `manual: true` for transparency. Never overwrites a real fetched entry
// for the same numberKey — if TCGplayer starts pricing it for real, the
// live data wins automatically and the manual entry becomes a no-op
// (safe to leave the file in place rather than remembering to clean it up).
async function loadManualPrices(packdropCode) {
  const manualPath = path.resolve(`config/manual-prices/${packdropCode}.json`);
  try {
    const raw = await readFile(manualPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return []; // no manual-prices file for this set — fine, that's the default
  }
}

async function main() {
  const setsConfigPath = path.resolve('config/sets.json');
  const sets = JSON.parse(await readFile(setsConfigPath, 'utf-8'));

  const outDir = path.resolve('prices');
  await mkdir(outDir, { recursive: true });

  const indexEntries = [];

  for (const set of sets) {
    console.log(`Fetching ${set.name} (${set.packdropCode})...`);
    try {
      const result = await fetchSetPrices(set);

      const manualEntries = await loadManualPrices(set.packdropCode);
      const existingKeys = new Set(result.cards.map((c) => c.numberKey));
      for (const entry of manualEntries) {
        if (existingKeys.has(entry.numberKey)) continue; // live data wins
        result.cards.push({ ...entry, manual: true });
      }

      const outPath = path.join(outDir, `${set.packdropCode}.json`);
      await writeFile(outPath, JSON.stringify(result));
      console.log(`  -> ${result.cards.length} cards written to ${outPath}`);
      indexEntries.push({
        packdropCode: set.packdropCode,
        name: set.name,
        cardCount: result.cards.length,
        updatedAt: result.updatedAt,
      });
    } catch (err) {
      console.error(`  FAILED: ${err.message}`);
      // Don't let one broken set kill the whole run — keep going so a
      // stale set doesn't block a fresh one, then fail the job at the end.
      process.exitCode = 1;
    }
  }

  await writeFile(
    path.join(outDir, 'index.json'),
    JSON.stringify({ updatedAt: new Date().toISOString(), sets: indexEntries }, null, 2)
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
