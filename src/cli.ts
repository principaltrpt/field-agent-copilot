/**
 * Ranked call list. This is the whole product in one screen: who to call, why,
 * and which open jobs to open the call with.
 *
 * Usage:
 *   node src/cli.ts               top 12 for the whole book
 *   node src/cli.ts --top 25
 *   node src/cli.ts --trade hvac
 *   node src/cli.ts --seed 7
 */

import { generate } from './generate.ts'
import { nearbyOpenJobs } from './geo.ts'
import { scoreProspect, BANDS } from './score.ts'
import type { Trade } from './types.ts'

const argv = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : undefined
}

const top = Number(flag('top') ?? 12)
const seed = Number(flag('seed') ?? 42)
const trade = flag('trade') as Trade | undefined

const { prospects, openJobs, markets } = generate({ seed })
const marketName = new Map(markets.map((m) => [m.id, m.name]))

const ranked = prospects
  .filter((p) => (trade ? p.trade === trade : true))
  .map((p) => ({ prospect: p, score: scoreProspect(p.funnel) }))
  .sort((a, b) => b.score.value - a.score.value)

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`
const colorFor = (v: number) =>
  v >= BANDS.needsAttention ? '\x1b[31m' : v >= BANDS.watch ? '\x1b[33m' : '\x1b[32m'

console.log()
console.log(bold(`Call list  ${dim(`seed ${seed}`)}`))
console.log(
  dim(
    `${ranked.length} providers${trade ? ` in ${trade}` : ''}, ${openJobs.length} open jobs. Synthetic data.`,
  ),
)
console.log()

for (const [i, { prospect, score }] of ranked.slice(0, top).entries()) {
  const nearby = nearbyOpenJobs(prospect, openJobs)
  const head = `${String(i + 1).padStart(2)}. ${prospect.name.padEnd(18)} ${prospect.trade.padEnd(12)} ${dim(marketName.get(prospect.marketId) ?? '')}`
  console.log(head)
  const severe = score.severeTerm ? ' \x1b[35m[severe]\x1b[0m' : ''
  console.log(
    `    ${colorFor(score.value)}${String(score.value).padStart(3)}  ${score.band}\x1b[0m${severe} ${dim(`(${score.confidence} confidence, ${score.termsUsed.length}/3 terms)`)}`,
  )
  console.log(`    ${score.reason}`)

  if (nearby.length === 0) {
    console.log(dim('    No open jobs in range. Nothing concrete to pitch.'))
  } else {
    const pitch = nearby
      .map((n) => `$${n.job.estimatedValue.toLocaleString()} ${n.miles.toFixed(0)}mi ${n.job.postedDaysAgo}d`)
      .join('  ')
    console.log(dim(`    Pitch: ${pitch}`))
  }
  console.log()
}

// Band distribution, because a call list where everything is urgent is not a
// ranking. If one band holds most of the book, the cut points need calibrating.
const counts = { healthy: 0, watch: 0, 'needs attention': 0 } as Record<string, number>
for (const r of ranked) counts[r.score.band]!++
const pct = (n: number) => `${Math.round((n / ranked.length) * 100)}%`
console.log(
  dim(
    `Bands: healthy ${pct(counts.healthy!)}, watch ${pct(counts.watch!)}, needs attention ${pct(counts['needs attention']!)}`,
  ),
)
const noData = ranked.filter((r) => r.score.confidence === 'low').length
const severeCount = ranked.filter((r) => r.score.severeTerm).length
console.log(dim(`Severe on one dimension: ${pct(severeCount)}. Scored on one term only: ${pct(noData)}.`))
console.log()
