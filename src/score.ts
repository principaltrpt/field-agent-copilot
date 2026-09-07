/**
 * Attention score: 0 = healthy, 100 = needs attention now.
 *
 * This decides an agent's call order, so it is a standalone pure module. No
 * browser, no database, no network. That makes it testable, and it puts the
 * weights somewhere a reader can actually find them.
 *
 * ---------------------------------------------------------------------------
 * The one design decision worth reading
 * ---------------------------------------------------------------------------
 * Three terms drive the score: an engagement gap, a conversion gap, and
 * staleness. The engagement gap needs `jobsSeen`, which in most real systems is
 * the least measurable number in the funnel (see `types.ts`).
 *
 * When a term's inputs are missing there are three options:
 *
 *   1. Impute a value. Invents a gap that may not exist.
 *   2. Treat it as zero. Hides a gap that may exist, and quietly rewards
 *      providers with the worst instrumentation.
 *   3. Drop the term and renormalize the survivors to sum to 1.
 *
 * This module does (3). Dropping and renormalizing keeps every score on the
 * same 0-100 scale, so a provider missing a signal stays comparable to one that
 * has it, and no number enters the ranking that nobody can stand behind.
 *
 * The cost is that two providers can be scored on different evidence. That is
 * real, so the score carries `termsUsed` and the reason line says so. Better a
 * visible caveat than an invisible fabrication.
 */

import type { FunnelCounts } from './types.ts'

/**
 * Term weights. They must sum to 1. Change them here and nowhere else.
 *
 * The conversion gap carries the most weight because it is the term an agent
 * can actually coach against on a call. Staleness is deliberately light: it is
 * a tiebreaker, not a diagnosis.
 */
export const WEIGHTS = {
  engagementGap: 0.30,
  conversionGap: 0.55,
  staleness: 0.15,
} as const

export type TermName = keyof typeof WEIGHTS

/** Days without a quote at which the staleness term saturates. */
export const STALENESS_CEILING_DAYS = 45

/**
 * Expected rates for a healthy provider. Gaps are measured against these, not
 * against perfection.
 *
 * This is the correction that makes the score usable. Measuring a conversion
 * gap as `1 - won/quoted` treats every provider who does not win 100% of their
 * quotes as having a gap, which is everyone. The result compresses the whole
 * book into a narrow band and the ranking becomes noise.
 *
 * Measured against a benchmark instead, a provider at or above the expected
 * rate scores 0 on that term, and the score reads as shortfall against a
 * standard rather than distance from the impossible.
 *
 * These two numbers are the first thing to replace with your own. They are the
 * only place in the module where a real book's behaviour has to be known.
 */
export const BENCHMARKS = {
  /** Share of jobs seen that a healthy provider quotes. */
  quoteRate: 0.55,
  /** Share of quotes a healthy provider wins. */
  winRate: 0.30,
} as const

/**
 * Pseudo-counts for rate shrinkage. Higher means more evidence is required
 * before an observed rate is believed over the benchmark.
 *
 * This is the fix for the failure mode that makes naive scoring useless in
 * practice: a provider with 0 wins on 1 quote has a 0% win rate, which reads as
 * the worst possible performance, when it is actually no evidence at all. Left
 * alone, the entire top of the call list fills with providers who have barely
 * done anything, and the agent's morning goes to noise.
 *
 * So each rate is shrunk toward the benchmark in proportion to how thin the
 * sample is:
 *
 *     adjusted = (observed + k * benchmark) / (denominator + k)
 *
 * With k = 8, a provider with 0 wins on 1 quote lands near the benchmark and
 * barely registers. A provider with 0 wins on 40 quotes stays near 0% and rises
 * to the top, which is correct: that one is a real finding.
 *
 * The cost is that a genuinely bad provider takes a few more quotes to surface.
 * That is the right trade for a list someone works top-down.
 */
export const SHRINKAGE = { quotes: 8, wins: 8 } as const

/**
 * Band thresholds, on the 0-100 score.
 *
 * Calibrated against the synthetic book in `generate.ts`, whose score
 * distribution runs p25 = 7, p50 = 18, p70 = 25, p90 = 39, max = 56. The cut
 * points sit at roughly p70 and p90, which puts about 70% of providers in
 * 'healthy', 20% in 'watch' and 10% in 'needs attention'. That is the shape a
 * call list needs: a top decile worth working today.
 *
 * Note the max is 56, not 100. Once rates are shrunk toward a benchmark, a
 * perfect 100 requires a provider with a large sample failing on every
 * dimension at once, which is rare and should be. Bands anchored to 65 or 80 on
 * this scale would leave 'needs attention' permanently empty.
 *
 * Recalibrate before trusting them on a real book. If most of the book lands in
 * one band the score is not wrong, the cut points are, and an agent handed a
 * list where everything is urgent has been handed no ranking at all. That
 * failure is easy to ship and hard to notice, so `cli.ts` prints the band
 * distribution on every run.
 */
export const BANDS = { watch: 25, needsAttention: 40 } as const

export type Band = 'healthy' | 'watch' | 'needs attention'

/**
 * A single term this bad forces the score out of 'healthy' regardless of the
 * weighted average.
 *
 * A weighted average can hide one severe failure behind two healthy terms. The
 * case that forced this: a provider quoting 6 of 60 jobs seen but winning a
 * third of what they quote scored 29 and read as healthy. They are not healthy.
 * They are the best call in the book, because 54 jobs went untouched by someone
 * who wins when they engage.
 */
export const SEVERE_TERM = 0.70

/**
 * How much of the score rests on measured evidence.
 *
 * 'low' means one term survived, which in practice means staleness alone. The
 * number is still on the 0-100 scale and still sortable, but it is a placeholder
 * for a judgement rather than the judgement itself. Surfacing this changes the
 * reason line and the display, never the score.
 */
export type Confidence = 'high' | 'medium' | 'low'

export type Score = {
  /** 0-100, rounded. 0 = healthy. */
  value: number
  band: Band
  /** Which terms had usable inputs. Fewer than 3 means weights were renormalized. */
  termsUsed: TermName[]
  /** Per-term gap in 0-1, before weighting. Absent when the term was dropped. */
  terms: Partial<Record<TermName, number>>
  /** How much measured evidence the score rests on. */
  confidence: Confidence
  /**
   * The single term at or past `SEVERE_TERM`, if any. Set even when `value` is
   * low, because a term capped at 30% of the weight cannot lift the score on
   * its own. Display and sorting should treat this as a flag.
   */
  severeTerm: TermName | null
  /** One line an agent can read on the way into the call. */
  reason: string
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n)

/**
 * Shortfall of an observed rate against its benchmark, as 0-1.
 *
 * 0 means at or above benchmark. 1 means the provider does none of it. Returns
 * null when the denominator is zero or missing, because a rate over no
 * denominator is not a small gap, it is an unknown one, and those are different
 * facts that must not collapse into the same number.
 */
function shortfall(
  part: number,
  whole: number | null,
  benchmark: number,
  pseudoCount: number,
): number | null {
  if (whole === null || whole <= 0) return null
  const rate = (part + pseudoCount * benchmark) / (whole + pseudoCount)
  return clamp01(1 - rate / benchmark)
}

const LABELS: Record<TermName, string> = {
  engagementGap: 'quoting a small share of the jobs they see',
  conversionGap: 'quoting but not winning',
  staleness: 'gone quiet',
}

export function scoreProspect(f: FunnelCounts): Score {
  const candidates: Partial<Record<TermName, number>> = {}

  const engagement = shortfall(
    f.quotesSent,
    f.jobsSeen,
    BENCHMARKS.quoteRate,
    SHRINKAGE.quotes,
  )
  if (engagement !== null) candidates.engagementGap = engagement

  const conversion = shortfall(
    f.jobsWon,
    f.quotesSent,
    BENCHMARKS.winRate,
    SHRINKAGE.wins,
  )
  if (conversion !== null) candidates.conversionGap = conversion

  // Staleness needs no denominator, so it is always available. It is also the
  // only term that survives for a provider who has done nothing at all, which
  // is the correct outcome: someone with no activity is exactly who to call.
  candidates.staleness = clamp01(f.daysSinceLastQuote / STALENESS_CEILING_DAYS)

  const termsUsed = (Object.keys(candidates) as TermName[]).sort(
    (a, b) => WEIGHTS[b] - WEIGHTS[a],
  )

  // Renormalize: divide each surviving weight by the weight actually available.
  const availableWeight = termsUsed.reduce((sum, t) => sum + WEIGHTS[t], 0)
  const raw = termsUsed.reduce(
    (sum, t) => sum + (WEIGHTS[t] / availableWeight) * candidates[t]!,
    0,
  )

  const value = Math.round(clamp01(raw) * 100)
  const confidence: Confidence =
    termsUsed.length >= 3 ? 'high' : termsUsed.length === 2 ? 'medium' : 'low'

  const band: Band =
    value >= BANDS.needsAttention
      ? 'needs attention'
      : value >= BANDS.watch
        ? 'watch'
        : 'healthy'

  // Severity is reported as its own field rather than folded into the score or
  // the band. Two earlier versions of this got it wrong and both are worth
  // recording, because the pull toward each is strong:
  //
  //   1. Flooring the score to the 'watch' cut point put 59% of the book on one
  //      identical number and destroyed the ordering inside the group the agent
  //      works first.
  //   2. Overriding the band instead moved 30% of providers from 'healthy' to
  //      'watch', which inflated the middle bucket into meaninglessness.
  //
  // Both were attempts to fix a weighting artifact by distorting the output. The
  // artifact is real: a term capped at 30% of the weight cannot on its own carry
  // a score past a 55 threshold, so a provider can be severely bad at one thing
  // and still score low. The honest fix is to say so in a field the display can
  // act on, and leave the number alone.
  const worstTerm = termsUsed.reduce((w, t) =>
    candidates[t]! > candidates[w]! ? t : w,
  )
  const severeTerm = candidates[worstTerm]! >= SEVERE_TERM ? worstTerm : null

  return {
    value,
    band,
    termsUsed,
    confidence,
    severeTerm,
    terms: candidates,
    reason: reasonFor(candidates, termsUsed, value, confidence, severeTerm, f),
  }
}

/**
 * One line an agent can read walking into the call.
 *
 * Order matters: a severe term is named even when the weighted score is low,
 * because that is precisely the case the score alone hides.
 */
function reasonFor(
  terms: Partial<Record<TermName, number>>,
  used: TermName[],
  value: number,
  confidence: Confidence,
  severeTerm: TermName | null,
  f: FunnelCounts,
): string {
  if (confidence === 'low') {
    return `Not enough activity to score yet: ${f.quotesSent} quotes in ${f.daysActive} days. Ranked on recency alone.`
  }

  const caveat = f.jobsSeen === null ? ' Scored without engagement data.' : ''

  if (severeTerm) {
    return `${capitalize(LABELS[severeTerm])}: ${detailFor(severeTerm, f)}.${caveat}`
  }

  if (value < BANDS.watch) return 'Healthy. No action needed.'

  const dominant = used.reduce((best, t) =>
    WEIGHTS[t] * terms[t]! > WEIGHTS[best] * terms[best]! ? t : best,
  )
  return `${capitalize(LABELS[dominant])}: ${detailFor(dominant, f)}.${caveat}`
}

function detailFor(term: TermName, f: FunnelCounts): string {
  switch (term) {
    case 'engagementGap':
      return `quoted ${f.quotesSent} of ${f.jobsSeen} jobs seen (${pct(f.quotesSent / (f.jobsSeen ?? 1))} vs ${pct(BENCHMARKS.quoteRate)} expected)`
    case 'conversionGap':
      return `${f.jobsWon} wins on ${f.quotesSent} quotes (${pct(f.quotesSent ? f.jobsWon / f.quotesSent : 0)} vs ${pct(BENCHMARKS.winRate)} expected)`
    case 'staleness':
      return `${f.daysSinceLastQuote} days since last quote`
  }
}

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

const pct = (n: number): string => `${Math.round(n * 100)}%`
