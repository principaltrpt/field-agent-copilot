/** Domain types. Deliberately generic: any marketplace with providers, jobs, and territories. */

export type Trade =
  | 'plumbing'
  | 'electrical'
  | 'hvac'
  | 'roofing'
  | 'landscaping'

/**
 * The funnel this scores is SEEN -> QUOTED -> WON.
 *
 * `jobsSeen` is nullable on purpose. In most real systems, "how many jobs did
 * this provider actually get shown" is the hardest number in the funnel to
 * measure per provider, because impression logging and provider identity
 * usually live in different systems and join through a bridge that only exists
 * for providers who already transacted. That is circular.
 *
 * When it is null the scorer drops the term rather than imputing one. See
 * `score.ts` for why that matters.
 */
export type FunnelCounts = {
  /** Distinct jobs shown to the provider. `null` when not measurable. */
  jobsSeen: number | null
  /** Distinct jobs the provider quoted. Between `jobsSeen` and `jobsWon`. */
  quotesSent: number
  /** Distinct jobs the provider won. */
  jobsWon: number
  /** Whole days since the provider became active. */
  daysActive: number
  /** Whole days since their last quote. Drives the staleness term. */
  daysSinceLastQuote: number
}

export type Prospect = {
  id: string
  name: string
  trade: Trade
  marketId: string
  lat: number
  lon: number
  funnel: FunnelCounts
}

export type OpenJob = {
  id: string
  trade: Trade
  marketId: string
  lat: number
  lon: number
  postedDaysAgo: number
  /** Customer's stated budget, in whole dollars. */
  estimatedValue: number
}

export type Market = {
  id: string
  name: string
  lat: number
  lon: number
}

export type Dataset = {
  markets: Market[]
  prospects: Prospect[]
  openJobs: OpenJob[]
}
