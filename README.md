# field-agent-copilot

Turns a book of providers into a ranked call list: who an agent should call
next, why, and which nearby open jobs to open the call with.

The interesting part is not the ranking. It is what the scorer does when the
data is thin or missing, which in real operations is most of the time.

## Run it

No install step. Node 22.6 or newer runs the TypeScript directly.

```bash
node src/cli.ts --top 12
node src/cli.ts --trade hvac
node src/cli.ts --seed 7
node --test src/*.test.ts
```

## The five decisions worth reading

Every one of these came from watching the output be wrong first. The comments in
`src/score.ts` record what broke and why the fix is shaped the way it is.

1. **Missing signals are dropped, not imputed.** Whether a provider's
   impressions are measurable is a property of the instrumentation, not of the
   provider. When the input is absent the term is removed and the surviving
   weights are renormalized to sum to 1, so scores stay on one scale and nobody
   is penalised or rewarded for a gap in the plumbing. The alternative, filling
   a zero, quietly ranks the worst-instrumented providers as the healthiest.
2. **Gaps are measured against a benchmark, not against perfection.** The first
   version scored a conversion gap as `1 - won/quoted`, which treats every
   provider who does not win 100% of their quotes as deficient. That is
   everyone. It compressed the book into a narrow band and the ranking became
   noise. Rates are now compared to an expected rate, so at-or-above scores
   zero.
3. **Thin samples are shrunk toward the benchmark.** A provider with 0 wins on 1
   quote has a 0% win rate, which reads as the worst in the book and is actually
   no evidence at all. Before this, the top of the call list was entirely
   providers who had barely done anything. Each rate is now shrunk with 8
   pseudo-counts, so 0 wins on 40 quotes rises to the top and 0 wins on 1 quote
   does not.
4. **Severity is reported, never baked into the score.** A term capped at 30% of
   the weight cannot lift a score past a 40 threshold on its own, so a provider
   can be severely bad at one thing and still score low. I tried two fixes that
   both made it worse: flooring the score to the band cut point put 59% of the
   book on one identical number and destroyed the ordering, and overriding the
   band moved 30% of providers into 'watch' and inflated the middle bucket.
   Severity is now its own field. The score stays continuous and the display
   acts on the flag.
5. **The bands are calibrated, and the calibration is printed.** Cut points sit
   near p70 and p90 of the actual distribution, giving roughly 66% healthy, 24%
   watch, 10% needs attention. `cli.ts` prints the band split on every run,
   because a call list where everything is urgent is not a ranking, and that
   failure is easy to ship and hard to notice.

Two of those five bugs were in the data generator rather than the model. Both
are documented in `src/generate.ts`: uniform provider quality made the severity
flag fire on 54% of the book, and drawing days-since-last-quote uniformly across
0 to 75 days tripped a term that saturates at 45.

## No real data, by construction

Every number this tool displays is generated from parameters in
`src/generate.ts`. No provider, customer, or partner data of any kind is in this
repo, and none can be.

That is enforced rather than promised. `src/provenance.test.ts` fails the build
if any source file imports the filesystem, calls `fetch`, hardcodes a URL, or
reads an environment variable. With no way to ingest anything, there is nothing
to leak.

Generating from parameters is also a stronger guarantee than anonymising real
data would be. Masked or shuffled data keeps the real distributions, the real
place names, and the real row counts, so the shape of a business stays visible
and partial re-identification stays possible. It also has to be handled to be
produced, and git history is permanent once a repo goes public.

## Not built yet

1. Pitch generation. The tool surfaces which jobs to mention and leaves the
   words to the agent.
2. A map view. The territory logic is in `src/geo.ts` and has no UI.
3. Benchmarks per trade and market. `BENCHMARKS` is currently two global
   numbers, which is the biggest simplification in the model.

## Layout

| File | Contents |
| --- | --- |
| **`src/score.ts`** | The scorer. Weights, benchmarks, shrinkage, bands, and the reasoning behind each. |
| **`src/geo.ts`** | Distance and nearby-job ranking. Pure functions. |
| **`src/generate.ts`** | Synthetic data. The only source of numbers in the repo. |
| **`src/cli.ts`** | The ranked call list. |
| **`src/score.test.ts`** | Behaviour of the scorer, including every case above. |
| **`src/provenance.test.ts`** | Enforces the no-real-data guarantee. |
