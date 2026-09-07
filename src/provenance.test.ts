/**
 * Guard: this repo must not be able to read real data.
 *
 * Every number the tool displays comes from `generate.ts`. That is a promise
 * worth enforcing rather than remembering, because the failure mode is
 * permanent: once real provider or customer data lands in a commit, it stays in
 * the history after deletion, and a repo that goes public publishes the whole
 * history.
 *
 * So the guarantee is structural. If the source cannot open a file, reach the
 * network, or read an environment variable, it cannot ingest anything real, and
 * no amount of care about a particular commit is required.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = new URL('.', import.meta.url).pathname

/** Anything that could pull data in from outside this repo. */
const FORBIDDEN: Array<[RegExp, string]> = [
  [/\bfrom\s+['"]node:fs['"]/, 'filesystem import'],
  [/\brequire\(['"]fs['"]\)/, 'filesystem require'],
  [/\breadFileSync?\b/, 'file read'],
  [/\bcreateReadStream\b/, 'file stream'],
  [/\bfetch\s*\(/, 'network fetch'],
  [/\bhttps?:\/\//, 'hardcoded URL'],
  [/\bprocess\.env\b/, 'environment variable'],
]

const sourceFiles = readdirSync(SRC).filter(
  (f) => f.endsWith('.ts') && !f.endsWith('.test.ts'),
)

test('the repo ships source files to check', () => {
  assert.ok(sourceFiles.length >= 5, `found only ${sourceFiles.length}`)
})

for (const file of sourceFiles) {
  test(`${file} cannot ingest external data`, () => {
    const body = readFileSync(join(SRC, file), 'utf8')
    // Strip comments so prose about networks and files does not trip the guard.
    const code = body
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')

    for (const [pattern, label] of FORBIDDEN) {
      assert.ok(
        !pattern.test(code),
        `${file} contains a ${label}. Data must come from generate.ts only.`,
      )
    }
  })
}

test('no data files are committed alongside the source', () => {
  const dataLike = readdirSync(SRC).filter((f) =>
    /\.(csv|tsv|json|parquet|xlsx|sql|ndjson)$/i.test(f),
  )
  assert.deepEqual(dataLike, [], `unexpected data files: ${dataLike.join(', ')}`)
})
