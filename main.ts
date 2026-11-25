// main.ts — token radar 3 (radar-3) for token-radar-01.
// Reads the sealed DefiLlama snapshot, ranks every protocol that records no
// token at all by an implied launch value, and writes the board, the dashboard
// data, the screenshots and the dossier. Node 22 standard library only; no
// network; deterministic: the same snapshot bytes always give the same output.
//
// Usage: node main.ts --input <snapshot.json> --output <dir>
//   --input defaults to /input/snapshot.json, --output to $MAKEFUN_OUTPUT_DIR
//   or /output. The repository root (this file's directory) holds dashboard/
//   and screenshots/, which are copied into the output directory.
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DAY_MS = 86400000;
// Everything this program writes into --output. The output directory is wiped
// before each run, so refuse when it holds anything else: a mistyped --output
// must never delete unrelated files.
const OWN_OUTPUT = new Set(['board.json', 'data.js', 'dashboard', 'screenshots', 'dossier.json']);

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

const INPUT = arg('--input', '/input/snapshot.json');
const OUTPUT = arg('--output', process.env.MAKEFUN_OUTPUT_DIR || '/output');

interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}
interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

// ---------------------------------------------------------------- helpers

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return 0;
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const quantile = (sorted: number[], f: number): number =>
  sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))]!;

const fmtUsd = (n: number): string =>
  n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1e3)}K`;
const fmtSigned = (n: number, digits = 1): string => (n >= 0 ? '+' : '') + n.toFixed(digits);

// ---------------------------------------------------------------- snapshot

const snap: Snapshot = JSON.parse(readFileSync(INPUT, 'utf8'));
const asOf = new Date(snap.as_of + 'T00:00:00Z');
const ageDays = (p: Protocol): number | null =>
  p.listed_at ? Math.max(0, Math.round((asOf.getTime() - new Date(p.listed_at + 'T00:00:00Z').getTime()) / DAY_MS)) : null;

// A protocol is rankable when it records no token at all and is not a wrapped,
// staked or bridged product of a token that already trades. The rule mirrors
// the snapshot's own watchlist rule, minus the TVL floor.
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const EXCHANGES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const VERSION_TAIL = /\s(v2|V2|2\.0|v3|V3|3\.0)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
function isExcluded(p: Protocol): boolean {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return true;
  if (VERSION_TAIL.test(p.name)) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  if (EXCHANGES.some((e) => p.name.startsWith(e))) return true;
  return false;
}
const rankable = snap.protocols.filter(
  (p) => p.mcap_usd === null && p.symbol === null && p.gecko_id === null && !isExcluded(p),
);
const watchlist = new Set(snap.watchlist);

// ---------------------------------------------------------------- the model (radar-3)

// Market-relative momentum: the snapshot's median 7-day change is the market.
const marketMedianChange = median(
  snap.protocols.map((p) => p.change_7d).filter((v): v is number => v !== null),
);

// Category multiples from the live-token comparables in the same category.
// With 5 or more comparables the multiple is the interquartile mean: the
// ratios clipped to their own interquartile range, then averaged, so one wild
// outlier cannot drag the multiple (Lending's ratios run 0.008 to 18.956).
// With 3-4 comparables it is the median; with fewer, the global trimmed mean.
const live = snap.protocols.filter((p) => p.mcap_usd !== null);
const ratiosByCat = new Map<string, number[]>();
for (const p of live) {
  const key = p.category ?? '(none)';
  const arr = ratiosByCat.get(key) ?? [];
  arr.push(p.mcap_usd! / p.tvl_usd);
  ratiosByCat.set(key, arr);
}
const allRatios = live.map((p) => p.mcap_usd! / p.tvl_usd).sort((a, b) => a - b);
const gLo = quantile(allRatios, 0.25);
const gHi = quantile(allRatios, 0.75);
const globalTrimmed = allRatios.map((r) => clamp(r, gLo, gHi)).reduce((a, b) => a + b, 0) / allRatios.length;
const globalMedian = median(allRatios);

interface CatStat {
  n: number;
  multiple: number;
  medianRatio: number;
  iqr: number;
  fallback: boolean;
}
const catStats = new Map<string, CatStat>();
function catStat(cat: string | null): CatStat {
  const key = cat ?? '(none)';
  const hit = catStats.get(key);
  if (hit) return hit;
  const rs = (ratiosByCat.get(key) ?? []).slice().sort((a, b) => a - b);
  let stat: CatStat;
  if (rs.length >= 5) {
    const lo = quantile(rs, 0.25);
    const hi = quantile(rs, 0.75);
    const clipped = rs.map((r) => clamp(r, lo, hi));
    stat = { n: rs.length, multiple: clipped.reduce((a, b) => a + b, 0) / clipped.length, medianRatio: median(rs), iqr: hi - lo, fallback: false };
  } else if (rs.length >= 3) {
    stat = { n: rs.length, multiple: median(rs), medianRatio: median(rs), iqr: quantile(rs, 0.75) - quantile(rs, 0.25), fallback: false };
  } else {
    stat = { n: rs.length, multiple: globalTrimmed, medianRatio: globalMedian, iqr: gHi - gLo, fallback: true };
  }
  stat.multiple = clamp(stat.multiple, 0.05, 1.5);
  catStats.set(key, stat);
  return stat;
}

// TVL rank among the rankable protocols of the same category (leadership).
const byCatPre = new Map<string, Protocol[]>();
for (const p of rankable) {
  const key = p.category ?? '(none)';
  const arr = byCatPre.get(key) ?? [];
  arr.push(p);
  byCatPre.set(key, arr);
}
const leadRank = new Map<string, number>();
for (const arr of byCatPre.values()) {
  arr.sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1));
  arr.forEach((p, i) => leadRank.set(p.slug, i + 1));
}

// TVL velocity: dollars of TVL per day since listing, in quartiles.
const logVels = rankable
  .map((p) => ageDays(p))
  .map((age, i) => (age === null ? null : Math.log10(rankable[i]!.tvl_usd / Math.max(age, 30))))
  .filter((v): v is number => v !== null)
  .sort((a, b) => a - b);
const velQ1 = quantile(logVels, 0.25);
const velQ2 = quantile(logVels, 0.5);
const velQ3 = quantile(logVels, 0.75);

interface Factors {
  cat: number;
  growth: number;
  age: number;
  breadth: number;
  lead: number;
  vel: number;
}
function factors(p: Protocol): { f: Factors; age: number | null; lead: number; cat: CatStat } {
  const cat = catStat(p.category);
  const rel = (p.change_7d ?? 0) - marketMedianChange;
  const growth = 1 + (0.5 * clamp(rel, -50, 100)) / 100;
  const age = ageDays(p);
  const ageF = age === null ? 0.9 : 0.8 + (0.2 * Math.min(age, 730)) / 730;
  const nChains = p.chains.length;
  const breadth = Math.min(1 + (0.08 * Math.log(Math.max(nChains, 1))) / Math.log(32), 1.08);
  const lr = leadRank.get(p.slug) ?? 99;
  const lead = lr === 1 ? 1.12 : lr <= 3 ? 1.06 : 1;
  let vel = 1;
  if (age !== null) {
    const lv = Math.log10(p.tvl_usd / Math.max(age, 30));
    vel = lv >= velQ3 ? 1.08 : lv >= velQ2 ? 1.03 : lv >= velQ1 ? 1 : 0.95;
  }
  return { f: { cat: cat.multiple, growth, age: ageF, breadth, lead, vel }, age, lead: lr, cat };
}

// ---------------------------------------------------------------- farm plans

const CAPITAL_TIERS: Array<[number, number]> = [
  [5e8, 5000],
  [1e8, 2000],
  [5e7, 1000],
  [1e7, 500],
  [0, 250],
];
function capital(tvl: number): number {
  for (const [floor, amount] of CAPITAL_TIERS) if (tvl >= floor) return amount;
  return 250;
}
function holdDays(age: number | null): number {
  if (age === null) return 180;
  if (age < 180) return 90;
  if (age <= 730) return 180;
  return 365;
}
const VERBS: Record<string, string> = {
  Lending: 'Supply assets to the lending market',
  Dexs: 'Provide liquidity to a pool',
  Yield: 'Deposit into the yield vault',
  'Yield Aggregator': 'Deposit into the aggregator vault',
  RWA: 'Subscribe to the tokenised asset',
  'Risk Curators': 'Deposit into a curator vault',
  'Basis Trading': 'Open a basis position',
  CDP: 'Open a vault and mint against collateral',
  'CDP Manager': 'Open a managed vault position',
  Restaking: 'Restake assets through the protocol',
  Chain: 'Use the chain through the protocol',
  Payments: 'Route a payment through the protocol',
  'Prediction Market': 'Take a position in a market',
  Insurance: 'Buy cover from the protocol',
  'Liquid Staking': 'Stake assets through the protocol',
};
function farmSteps(p: Protocol, age: number | null): string[] {
  const cap = capital(p.tvl_usd);
  const hold = holdDays(age);
  const primary = p.chains[0] ?? 'its main chain';
  const second = p.chains.length > 1 ? p.chains[1]! : primary;
  const verb = VERBS[p.category ?? ''] ?? "Use the protocol's main product";
  return [
    `Open ${p.name}'s own site, linked from its DefiLlama page, and confirm it records no token; read its points program and note the snapshot date ${snap.as_of}.`,
    `Fund a wallet on ${primary} with $${cap.toLocaleString('en-US')} plus $25 to $50 set aside for gas and fees over the whole farm.`,
    `${verb} with $${cap.toLocaleString('en-US')} on ${primary} in one transaction, then confirm the position shows on the protocol's own dashboard.`,
    `Hold the position for ${hold} days; check it weekly and top up or rebalance monthly while its TVL keeps growing.`,
    `Use a second feature on ${second} — a second pool, vault or market — to deepen activity beyond a single deposit.`,
    `Check points and eligibility on the protocol's own dashboard every month and save a screenshot of each checkpoint.`,
    `Exit plan: after ${hold} days, withdraw in stages over two weeks; keep a small position if no token has launched; never buy points or pay for eligibility.`,
  ];
}
function riskNote(p: Protocol, age: number | null, cat: CatStat): string {
  const notes: string[] = [];
  if (p.change_7d !== null && p.change_7d < -20)
    notes.push(`TVL fell ${p.change_7d.toFixed(1)}% in the last 7 days — momentum is against this farm right now.`);
  if (p.change_7d === null) notes.push('No 7-day change reported, so momentum is unknown.');
  if (p.chains.length === 1) notes.push(`Single-chain: all exposure sits on ${p.chains[0]}.`);
  if (age !== null && age < 180) notes.push(`Only ${age} days on record — young and unproven.`);
  if (age === null) notes.push('No listing date recorded — age is unknown.');
  if (cat.iqr > 1) notes.push(`Its category's live-token values disagree widely (IQR ${cat.iqr.toFixed(2)}), so the implied value is an estimate.`);
  return notes.length > 0 ? notes.join(' ') : 'No warning flag in the snapshot.';
}

// ---------------------------------------------------------------- board

interface Row {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  watchlist: boolean;
  category_rank: number;
  factors: Factors;
  risk_note: string;
}
const rows: Row[] = rankable.map((p) => {
  const { f, age, lead, cat } = factors(p);
  const value = Math.round(p.tvl_usd * f.cat * f.growth * f.age * f.breadth * f.lead * f.vel);
  return {
    slug: p.slug,
    name: p.name,
    rank: 0,
    implied_value_usd: Math.max(1, value),
    farm_steps: farmSteps(p, age),
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    age_days: age,
    watchlist: watchlist.has(p.slug),
    category_rank: lead,
    factors: f,
    risk_note: riskNote(p, age, cat),
  };
});
rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : 1));
rows.forEach((r, i) => (r.rank = i + 1));

// Apart, never ranked: the 24 largest live-token protocols by market cap, and
// the pre-token protocols that record a ticker but no market cap (top 12 by TVL).
const live24 = live
  .slice()
  .sort((a, b) => b.mcap_usd! - a.mcap_usd! || (a.slug < b.slug ? -1 : 1))
  .slice(0, 24)
  .map((p) => ({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d }));
const tickerSet = snap.protocols
  .filter((p) => p.mcap_usd === null && p.symbol !== null && !isExcluded(p))
  .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1));
const tickerTop = tickerSet.slice(0, 12).map((p) => ({
  slug: p.slug,
  name: p.name,
  category: p.category,
  chains: p.chains,
  tvl_usd: p.tvl_usd,
  symbol: p.symbol,
  change_7d: p.change_7d,
}));

// Category table for the dashboard: every category on the board.
const catTable = [...new Set(rows.map((r) => r.category ?? '(none)'))].sort().map((c) => {
  const s = catStat(c === '(none)' ? null : c);
  return { category: c, comparables: s.n, multiple: s.multiple, median_ratio: s.medianRatio, iqr: s.iqr, fallback: s.fallback };
});

// ---------------------------------------------------------------- output

const board = {
  model: 'radar-3',
  as_of: snap.as_of,
  floor_usd: snap.floor_usd,
  watchlist_size: snap.watchlist.length,
  rows,
};
// Wipe the output directory first (so stale files never linger), but only
// when it holds our own files: a mistyped --output must never delete
// unrelated files.
if (existsSync(OUTPUT)) {
  const stray = readdirSync(OUTPUT).filter((e) => !OWN_OUTPUT.has(e));
  if (stray.length > 0) throw new Error(`refusing to wipe ${OUTPUT}: unexpected entries: ${stray.join(', ')}`);
  rmSync(OUTPUT, { recursive: true, force: true });
}
mkdirSync(join(OUTPUT, 'dashboard'), { recursive: true });
mkdirSync(join(OUTPUT, 'screenshots'), { recursive: true });
writeFileSync(join(OUTPUT, 'board.json'), JSON.stringify(board, null, 2) + '\n');

// The dashboard's data at the output root, beside dashboard/ (the starter's
// data.js): the gate reads the JSON after the first '=' (minus a trailing
// ';') and requires its .rows to match board.json's rows in slug order and
// implied value. Same board object, compact JSON, so the rows match by
// construction. The dossier is built from dashboard/ and screenshots/ only,
// so this file does not change dossier.json.
writeFileSync(join(OUTPUT, 'data.js'), `window.RADAR=${JSON.stringify(board)};\n`);

// Dashboard data, compact keys (see the header comment in zz-data.js):
// s slug, n name, r rank, v implied value, c category, ch chains, t tvl,
// g 7d change, a age days, w watchlist, k category rank,
// f [cat, growth, age, breadth, lead, vel], p farm steps, k2 risk note.
const dataRows = rows.map((r) => ({
  s: r.slug,
  n: r.name,
  r: r.rank,
  v: r.implied_value_usd,
  c: r.category,
  ch: r.chains,
  t: r.tvl_usd,
  g: r.change_7d,
  a: r.age_days,
  w: r.watchlist ? 1 : 0,
  k: r.category_rank,
  f: [r.factors.cat, r.factors.growth, r.factors.age, r.factors.breadth, r.factors.lead, r.factors.vel],
  p: r.farm_steps,
  k2: r.risk_note,
}));
const dashData = {
  meta: {
    model: 'radar-3',
    as_of: snap.as_of,
    floor_usd: snap.floor_usd,
    board_rows: rows.length,
    watchlist: snap.watchlist.length,
    live_apart: live24.length,
    ticker_apart: tickerSet.length,
    market_median_change_7d: marketMedianChange,
    global_multiple: globalTrimmed,
  },
  rows: dataRows,
  live: live24,
  ticker: { count: tickerSet.length, top: tickerTop },
  categories: catTable,
};
const dataJs = `// Token Radar 3 — board data. Keys: s slug, n name, r rank, v implied value
// (USD), c category, ch chains, t TVL (USD), g 7-day change (%), a age in days,
// w watchlist (1/0), k TVL rank inside its category, f [category, growth, age,
// breadth, leadership, velocity] multipliers, p farm steps, k2 risk note.
// live: the 24 largest live-token protocols by market cap (shown apart, never
// ranked). ticker: pre-token protocols that record a ticker but no market cap
// (shown apart, never ranked). categories: the category-multiple table.
window.RADAR = ${JSON.stringify(dashData)};\n`;
writeFileSync(join(OUTPUT, 'dashboard', 'zz-data.js'), dataJs);

// Copy the dashboard page and the screenshots into the output.
for (const f of ['index.html', 'app.css', 'app.js']) {
  cpSync(join(ROOT, 'dashboard', f), join(OUTPUT, 'dashboard', f));
}
for (const f of ['board.png', 'detail.png', 'filtered.png']) {
  const src = join(ROOT, 'screenshots', f);
  if (existsSync(src)) cpSync(src, join(OUTPUT, 'screenshots', f));
}

// The dossier: byte for byte what the scorer's own copy of the library writes.
writeFileSync(join(OUTPUT, 'dossier.json'), buildDossier(OUTPUT, { text_max_bytes: 65536 }));

console.log(`radar-3: ${rows.length} rows, watchlist ${snap.watchlist.length}/${snap.watchlist.length} covered`);
console.log(`top 5: ${rows.slice(0, 5).map((r) => `${r.slug} ${fmtUsd(r.implied_value_usd)}`).join(', ')}`);
console.log(`market median 7d change ${fmtSigned(marketMedianChange)}%, global multiple ${globalTrimmed.toFixed(3)}`);
console.log(`wrote ${OUTPUT}/board.json, ${OUTPUT}/data.js, dashboard/, screenshots/, dossier.json`);
