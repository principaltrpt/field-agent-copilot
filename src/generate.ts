/**
 * Synthetic data generator.
 *
 * Every number this repo displays comes from here. Nothing is derived from a
 * real book, a real export, or a real provider.
 *
 * This is deliberate, and it is a stronger guarantee than anonymizing real
 * data would be. Shuffled or masked real data keeps the real distributions, the
 * real place names, and the real row counts, so the shape of a business stays
 * visible and partial re-identification stays possible. Generating from
 * parameters means there is nothing to leak, and the git history is clean from
 * the first commit.
 *
 * It also makes for a better demo: the parameters below are tuned to produce
 * the cases that are actually interesting to look at, including providers with
 * no engagement data at all, rather than hoping a real sample happens to
 * contain them.
 */

import type { Dataset, Market, OpenJob, Prospect, Trade } from './types.ts'

const TRADES: Trade[] = ['plumbing', 'electrical', 'hvac', 'roofing', 'landscaping']

/** Fictional markets. Coordinates are real US points so the map math is sane. */
const MARKETS: Market[] = [
  { id: 'mkt-01', name: 'Fairmont',    lat: 40.7608, lon: -111.8910 },
  { id: 'mkt-02', name: 'Cedar Flats', lat: 39.7392, lon: -104.9903 },
  { id: 'mkt-03', name: 'Northgate',   lat: 47.6062, lon: -122.3321 },
  { id: 'mkt-04', name: 'Kestrel',     lat: 33.4484, lon: -112.0740 },
  { id: 'mkt-05', name: 'Ashford',     lat: 35.2271, lon: -80.8431 },
  { id: 'mkt-06', name: 'Rowan Park',  lat: 30.2672, lon: -97.7431 },
  { id: 'mkt-07', name: 'Brightwater', lat: 41.8781, lon: -87.6298 },
  { id: 'mkt-08', name: 'Silverton',   lat: 36.1627, lon: -86.7816 },
]

const FIRST = ['Ana','Ben','Cass','Dev','Elle','Finn','Gus','Hana','Ivo','Jae','Kit','Lou','Mira','Nico','Ola','Pia','Quinn','Rey','Sam','Tess']
const LAST  = ['Alvarez','Boyd','Chen','Dunn','Eriksen','Farrow','Gable','Haynes','Ibarra','Jonsson','Kaur','Lindqvist','Moreau','Nakamura','Oyelaran','Prince','Quintero','Rossi','Stavros','Tran']

/** Deterministic PRNG. The same seed always produces the same dataset. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pick = <T>(rng: () => number, xs: T[]): T => xs[Math.floor(rng() * xs.length)]!
const int = (rng: () => number, lo: number, hi: number): number =>
  lo + Math.floor(rng() * (hi - lo + 1))

/** Scatter a point within roughly `spreadMiles` of a market centre. */
function jitter(rng: () => number, m: Market, spreadMiles: number) {
  const dLat = ((rng() - 0.5) * 2 * spreadMiles) / 69
  const dLon =
    ((rng() - 0.5) * 2 * spreadMiles) / (69 * Math.cos((m.lat * Math.PI) / 180))
  return { lat: m.lat + dLat, lon: m.lon + dLon }
}

export type GenerateOptions = {
  seed?: number
  prospects?: number
  openJobs?: number
  /** Share of providers with no engagement data, exercising the dropped term. */
  missingEngagementRate?: number
}

export function generate({
  seed = 42,
  prospects: nProspects = 160,
  openJobs: nJobs = 420,
  missingEngagementRate = 0.28,
}: GenerateOptions = {}): Dataset {
  const rng = mulberry32(seed)

  const prospects: Prospect[] = []
  for (let i = 0; i < nProspects; i++) {
    const market = pick(rng, MARKETS)
    const { lat, lon } = jitter(rng, market, 18)
    const daysActive = int(rng, 1, 900)

    // A latent quality per provider, so the funnel is internally consistent
    // rather than three independent random numbers.
    //
    // Averaging three draws gives an approximately bell-shaped distribution
    // instead of a flat one. That matters: with uniform quality, half the book
    // ended up severely below benchmark on some dimension, which made the
    // severity flag fire on 54% of providers and therefore mean nothing. Real
    // marketplaces cluster near the middle with a thin bad tail, and a flag is
    // only useful if it picks out a minority.
    const quality = (rng() + rng() + rng()) / 3
    const jobsSeenTrue = Math.max(0, int(rng, 0, 90))
    const quoteRate = 0.05 + quality * 0.75
    const quotesSent = Math.min(jobsSeenTrue, Math.round(jobsSeenTrue * quoteRate))
    const winRate = 0.02 + quality * 0.45
    const jobsWon = Math.round(quotesSent * winRate)

    // Days since last quote, skewed toward recent and correlated with quality.
    //
    // Drawing this uniformly across 0-75 days was the second calibration bug in
    // this file. Staleness saturates at 45 days, so a flat draw tripped the
    // severity flag on 56% of the book by itself. Active providers cluster
    // toward recent activity and the stale tail is thin, so the draw is squared
    // to pull it toward zero and the ceiling scales with how weak the provider
    // is.
    const idleDays = Math.min(
      daysActive,
      Math.round(rng() ** 2 * (10 + (1 - quality) * 110)),
    )

    prospects.push({
      id: `pro-${String(i + 1).padStart(4, '0')}`,
      name: `${pick(rng, FIRST)} ${pick(rng, LAST)}`,
      trade: pick(rng, TRADES),
      marketId: market.id,
      lat,
      lon,
      funnel: {
        // Withheld for a share of providers, mirroring the real world: whether
        // a provider's impressions are measurable is a property of the
        // plumbing, not of the provider.
        jobsSeen: rng() < missingEngagementRate ? null : jobsSeenTrue,
        quotesSent,
        jobsWon,
        daysActive,
        daysSinceLastQuote: idleDays,
      },
    })
  }

  const openJobs: OpenJob[] = []
  for (let i = 0; i < nJobs; i++) {
    const market = pick(rng, MARKETS)
    const { lat, lon } = jitter(rng, market, 25)
    openJobs.push({
      id: `job-${String(i + 1).padStart(4, '0')}`,
      trade: pick(rng, TRADES),
      marketId: market.id,
      lat,
      lon,
      postedDaysAgo: int(rng, 0, 21),
      estimatedValue: int(rng, 1, 40) * 100 + 150,
    })
  }

  return { markets: MARKETS, prospects, openJobs }
}
