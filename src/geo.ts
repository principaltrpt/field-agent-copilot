/**
 * Territory matching: which open jobs near a provider are worth calling about.
 *
 * Pure functions over plain data, same as the scorer. Distance is straight-line
 * haversine, which is the right approximation here: the output is a call list,
 * not a route, and drive time would add a dependency and a network call to
 * change a ranking by one or two positions.
 */

import type { OpenJob, Prospect } from './types.ts'

const EARTH_RADIUS_MILES = 3958.8
const toRad = (deg: number): number => (deg * Math.PI) / 180

/** Great-circle distance in miles. */
export function distanceMiles(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(h))
}

export type NearbyJob = {
  job: OpenJob
  miles: number
  /** 0-1. Higher is a better job to open the call with. */
  pitchRank: number
}

export type NearbyOptions = {
  radiusMiles?: number
  limit?: number
}

/**
 * Open jobs a provider could plausibly take, best first.
 *
 * `pitchRank` blends three things an agent cares about on a call: the job is
 * close, it is worth money, and it is still fresh. Freshness carries real
 * weight because a three-week-old job has usually been claimed or abandoned,
 * and pitching a dead job is how an agent loses credibility on the first call.
 */
export function nearbyOpenJobs(
  prospect: Prospect,
  jobs: OpenJob[],
  { radiusMiles = 35, limit = 3 }: NearbyOptions = {},
): NearbyJob[] {
  const candidates: NearbyJob[] = []

  for (const job of jobs) {
    if (job.trade !== prospect.trade) continue
    const miles = distanceMiles(prospect, job)
    if (miles > radiusMiles) continue
    candidates.push({ job, miles, pitchRank: 0 })
  }

  if (candidates.length === 0) return []

  const maxValue = Math.max(...candidates.map((c) => c.job.estimatedValue))

  for (const c of candidates) {
    const proximity = 1 - c.miles / radiusMiles
    const value = c.job.estimatedValue / maxValue
    const freshness = Math.max(0, 1 - c.job.postedDaysAgo / 14)
    c.pitchRank = 0.4 * proximity + 0.3 * value + 0.3 * freshness
  }

  return candidates.sort((a, b) => b.pitchRank - a.pitchRank).slice(0, limit)
}
