import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The declared public market-data feed this settlement serves under its
// market-data-provision contract. Consumers fetch it themselves, read-only.
export const feed = JSON.parse(
  readFileSync(fileURLToPath(new URL('../content/config/feed.json', import.meta.url)), 'utf8'),
);
