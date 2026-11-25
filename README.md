[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Kamprett92/token-radar-v3/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Kamprett92/token-radar-v3/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

# Token Radar 3

Which pre-token protocol is worth farming next — and what do you do about it? Radar-3 reads the sealed DefiLlama snapshot (758 protocols, 14 November 2026), ranks every protocol that records **no token at all** by an implied launch value, and hands you a dashboard with a 7-step farm plan for each one.

## The radar-3 model

**Implied value = TVL × category × growth × age × breadth × leadership × velocity.** Every factor is computed from the snapshot at run time; no protocol name is special-cased.

- **Category:** the trimmed multiple of the category's live-token market-cap/TVL ratios — ratios clipped to their interquartile range, then averaged (median for 3–4 comparables; the global trimmed mean, 0.382, when fewer than 3). Clamped to 0.05–1.50. Radar-2 used the raw median; the trimmed mean uses the whole comparable distribution, which matters because comparables disagree wildly (Lending's ratios run 0.008 to 18.956).
- **Growth:** 1 + 0.5 × the protocol's 7-day TVL change *relative to the market median* (−8.23% this snapshot), clamped to −50%/+100%. A protocol growing while the market falls scores for it; radar-2 used the absolute change.
- **Age:** 0.80 + 0.20 × min(age, 730 days)/730 — older with no token scores higher; unknown age scores 0.90.
- **Breadth:** 1 + 0.08 × ln(chains)/ln(32), capped at 1.08 — running on more chains is wider distribution. New in radar-3: 407 of the snapshot's 758 protocols run on a single chain.
- **Leadership:** 1.12 for the largest pre-token protocol in its category by TVL, 1.06 for 2nd–3rd, else 1.00. New in radar-3: 7 of the 40 watchlist protocols lead their category.
- **Velocity:** TVL per day since listing, in quartiles across the board — top quartile 1.08, third 1.03, second 1.00, bottom 0.95. New in radar-3: a protocol that gathered $100M in 45 days is a hotter launch than one that gathered it over 1,500 days.

## The board

201 rows — every protocol that records no token (no market cap, no ticker, no listing) and is not a wrapped, staked or bridged product, a versioned copy or an exchange product. The 40-protocol watchlist is fully covered; its top members sit at ranks 2, 3, 4, 5, 6, 9, 10 and 12. Top implied values: Sentora Curator $1.26B, Steakhouse Financial $1.24B, Gauntlet $743M.

Shown apart, never ranked: the 24 largest live-token protocols by market cap, and the 162 pre-token protocols that record a ticker but no market cap (the largest is Morpho Blue at $10.4B TVL) — their token status is unclear, so the board does not rank them as launches.

## Farm plans

7 steps per protocol: capital by TVL tier ($250–$5,000), hold window by age (90/180/365 days), chain-aware, with an exit plan. Each row also carries a risk note where the data supports one (sharp 7-day TVL fall, single-chain exposure, very young, or a category whose comparables disagree widely).

## The dashboard

`dashboard/` is a static page (no network): a sortable, filterable board with search, category and chain filters, a watchlist toggle, a detail view per protocol showing every factor's contribution, the apart tables, the methodology and the category-multiple table. Each row shows its six factor multipliers, so the ranking rationale is visible at a glance.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Reads the snapshot, writes `board.json`, the dashboard data, copies `dashboard/` and `screenshots/` into the output, and writes `dossier.json` with `buildDossier` from `vendor/makefun-board.ts` (the kit's library, byte for byte). Runs twice byte-identical.

## Verification

Local run (Node v24.22.1, snapshot 2026-11-14), checked with an independent
gate script (not the kit CLI): **22 checks, 0 failed.**

- **Determinism:** two runs into separate directories are byte-identical
  (`diff -r` clean; all 10 output files match by sha256).
- **Dashboard files:** `index.html` + `app.css` + `app.js` + `zz-data.js`
  present; source 22,227 bytes (cap 65,536); dashboard total 278,986 bytes
  (cap 4 MiB); no `http(s)` anywhere in the dashboard files.
- **Data file:** `data.js` (270,907 bytes) at the output root, beside
  `dashboard/`; its `.rows` match `board.json`'s rows in slug order and
  implied value (201 rows).
- **Board file:** 201 rows (cap 100–4,000); ranks exactly 1–201; implied
  values positive integers, non-increasing, not all equal; every slug is a
  real snapshot protocol.
- **Sorted by value:** confirmed non-increasing across all 201 rows.
- **Coverage:** watchlist 40/40.
- **Farm steps:** 1,407 steps (201 × 7), 0 out of range; every step 94–172
  characters (allowed 20–600).
- **Screenshots:** 3 PNGs, all 1440×900 — `board.png` 191,393 B,
  `detail.png` 148,569 B, `filtered.png` 192,782 B (each under 512 KiB).
  Rendered in headless Chromium and read back visually: board, detail view,
  watchlist filter, apart tables and the category-multiple table are all
  legible, nothing cut off or overlapping.
- **Dossier:** `dossier.json` 734,628 bytes (cap 1.5 MiB), schema
  `makefun/dossier/v1`, cover = `board.png`; its three images match the
  screenshots byte for byte and by sha256; the file equals a fresh
  `buildDossier(output)` call byte for byte; dossier text 23,213 bytes
  (cap 65,536).

Implied values are this entry's own claim, never make.fun's. "Records no token" means DefiLlama's record carries none, not that none exists.
