import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scoreProspect, WEIGHTS, BENCHMARKS, BANDS, SEVERE_TERM } from './score.ts'
import type { FunnelCounts } from './types.ts'

const base: FunnelCounts = {
  jobsSeen: 100,
  quotesSent: 55,
  jobsWon: 17,
  daysActive: 300,
  daysSinceLastQuote: 1,
}

test('weights sum to 1', () => {
  const sum = Object.values(WEIGHTS).reduce((a, b) => a + b, 0)
  assert.equal(Math.round(sum * 1e6) / 1e6, 1)
})

test('a provider at benchmark on every rate scores healthy', () => {
  const s = scoreProspect(base)
  assert.equal(s.band, 'healthy')
  assert.equal(s.confidence, 'high')
  assert.ok(s.value < BANDS.watch, `expected < ${BANDS.watch}, got ${s.value}`)
})

test('scores stay within 0-100 across extremes', () => {
  const cases: FunnelCounts[] = [
    { jobsSeen: 0, quotesSent: 0, jobsWon: 0, daysActive: 0, daysSinceLastQuote: 0 },
    { jobsSeen: 1000, quotesSent: 0, jobsWon: 0, daysActive: 999, daysSinceLastQuote: 999 },
    { jobsSeen: 10, quotesSent: 10, jobsWon: 10, daysActive: 1, daysSinceLastQuote: 0 },
  ]
  for (const f of cases) {
    const s = scoreProspect(f)
    assert.ok(s.value >= 0 && s.value <= 100, `out of range: ${s.value}`)
  }
})

test('beating the benchmark is not a gap', () => {
  // Win rate double the benchmark should zero the conversion term, not go negative.
  const s = scoreProspect({ ...base, jobsWon: Math.round(base.quotesSent * BENCHMARKS.winRate * 2) })
  assert.equal(s.terms.conversionGap, 0)
})

test('missing engagement data drops the term instead of imputing one', () => {
  const s = scoreProspect({ ...base, jobsSeen: null })
  assert.ok(!s.termsUsed.includes('engagementGap'))
  assert.equal(s.terms.engagementGap, undefined)
  assert.equal(s.confidence, 'medium')
  assert.match(s.reason, /without engagement data|Healthy/)
})

test('dropping a term renormalizes rather than shrinking the score', () => {
  // Same underlying performance, with and without the engagement signal. The
  // score must stay on the same scale: a provider whose impressions happen to
  // be unmeasurable must not sort as healthier for that reason alone.
  const poor = { ...base, quotesSent: 40, jobsWon: 2, daysSinceLastQuote: 20 }
  const withSignal = scoreProspect(poor)
  const without = scoreProspect({ ...poor, jobsSeen: null })

  // Reconstruct the expected renormalized value from the surviving terms.
  const available = WEIGHTS.conversionGap + WEIGHTS.staleness
  const expected = Math.round(
    ((WEIGHTS.conversionGap / available) * without.terms.conversionGap! +
      (WEIGHTS.staleness / available) * without.terms.staleness!) *
      100,
  )
  assert.equal(without.value, expected)
  assert.ok(
    Math.abs(without.value - withSignal.value) < 30,
    `renormalized score drifted too far: ${without.value} vs ${withSignal.value}`,
  )
})

test('a severe term is surfaced even when the weighted score stays low', () => {
  // Quotes 6 of 60 seen (10% vs 55% expected) but converts above benchmark and
  // is recently active. The engagement term is capped at 30% of the weight, so
  // the score CANNOT reach the 'needs attention' threshold on that term alone.
  // The score is left alone and the severity is reported instead.
  const s = scoreProspect({
    jobsSeen: 60,
    quotesSent: 6,
    jobsWon: 2,
    daysActive: 120,
    daysSinceLastQuote: 12,
  })
  assert.ok(s.terms.engagementGap! >= SEVERE_TERM, `gap ${s.terms.engagementGap}`)
  assert.equal(s.severeTerm, 'engagementGap')
  assert.match(s.reason, /small share of the jobs they see/)
  // The number is not distorted to force the label.
  assert.ok(s.value < BANDS.needsAttention)
})

test('no severe term means the flag stays null', () => {
  const s = scoreProspect(base)
  assert.equal(s.severeTerm, null)
})

test('a provider with no measurable activity is flagged low confidence', () => {
  const s = scoreProspect({
    jobsSeen: null,
    quotesSent: 0,
    jobsWon: 0,
    daysActive: 3,
    daysSinceLastQuote: 3,
  })
  assert.equal(s.confidence, 'low')
  assert.deepEqual(s.termsUsed, ['staleness'])
  assert.match(s.reason, /Not enough activity/)
})

test('the reason line names the dominant term, not the score', () => {
  const stale = scoreProspect({ ...base, daysSinceLastQuote: 90 })
  assert.match(stale.reason, /quiet|quotes/i)
  assert.doesNotMatch(stale.reason, /^\d+$/)
})

test('a thin sample is shrunk toward the benchmark, not treated as failure', () => {
  // 0 wins on 1 quote is no evidence. 0 wins on 40 quotes is a finding.
  const thin = scoreProspect({
    jobsSeen: null, quotesSent: 1, jobsWon: 0, daysActive: 60, daysSinceLastQuote: 5,
  })
  const thick = scoreProspect({
    jobsSeen: null, quotesSent: 40, jobsWon: 0, daysActive: 60, daysSinceLastQuote: 5,
  })
  assert.ok(
    thick.value > thin.value + 30,
    `thin sample should not rival a real finding: ${thin.value} vs ${thick.value}`,
  )
  assert.ok(thin.terms.conversionGap! < 0.35, `thin gap too confident: ${thin.terms.conversionGap}`)
})
