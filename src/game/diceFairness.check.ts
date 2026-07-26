import assert from 'node:assert/strict'
import { randomInt } from 'node:crypto'
import { seededRandom } from './board'
import { applyAction, createGame, currentActorId, getPlayerView } from './engine'
import { chooseSimulationAction } from './simulationPolicy'
import type { GameState } from './types'

// Are the dice fair, and does a real game get fair ones?
//
// Run with `npx tsx src/game/diceFairness.check.ts`.
//
// Two random sources reach `applyAction`. A served game passes `secureRandom`
// from `server/room-service.ts`, which is `randomInt(2^32) / 2^32` out of the
// platform CSPRNG. Anything that omits the argument, which is every test, lab
// and replay, falls back to a mulberry32 stream freshly seeded per action from
// `privateRandomSeed ^ ((revision + 1) * 0x9e3779b1)`. Taking only the first
// outputs of a generator reseeded from a linearly stepping input is a real way
// to get correlated rolls, so the fallback is measured here at full size and
// the served path is measured beside it as the control.
//
// Every test runs on both sources with the same sampling shape, so a harness
// artefact shows up in both columns and cannot be mistaken for a defect.

const TRIANGLE = [0, 0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1]
/** Relative step below which the gamma expansions have converged. */
const CONVERGED = 1e-17
const MAX_LAG = 12
/** Fails the check. Loose enough that a sound source never trips it. */
const ALPHA = 1e-4

// ------------------------------------------------------------------- stats

const LGAMMA_COF = [76.18009172947146, -86.50532032941678, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5]
const lgamma = (value: number) => {
  let y = value
  let tmp = value + 5.5
  tmp -= (value + 0.5) * Math.log(tmp)
  let ser = 1.000000000190015
  for (let j = 0; j < 6; j += 1) {
    y += 1
    ser += LGAMMA_COF[j] / y
  }
  return -tmp + Math.log((2.5066282746310007 * ser) / value)
}

/** Regularised incomplete gamma, series below the crossover and continued fraction above. */
const gammaSeries = (a: number, x: number) => {
  let ap = a
  let sum = 1 / a
  let term = sum
  for (let n = 0; n < 100000; n += 1) {
    ap += 1
    term *= x / ap
    sum += term
    if (Math.abs(term) < Math.abs(sum) * CONVERGED) break
  }
  return sum * Math.exp(-x + a * Math.log(x) - lgamma(a))
}

const gammaContinued = (a: number, x: number) => {
  const tiny = 1e-300
  let b = x + 1 - a
  let c = 1 / tiny
  let d = 1 / b
  let h = d
  for (let i = 1; i < 100000; i += 1) {
    const an = -i * (i - a)
    b += 2
    d = an * d + b
    if (Math.abs(d) < tiny) d = tiny
    c = b + an / c
    if (Math.abs(c) < tiny) c = tiny
    d = 1 / d
    const step = d * c
    h *= step
    if (Math.abs(step - 1) < CONVERGED) break
  }
  return Math.exp(-x + a * Math.log(x) - lgamma(a)) * h
}

/** Upper tail of the chi-square distribution. */
const chiSquareP = (stat: number, df: number) => {
  if (!Number.isFinite(stat) || stat <= 0 || df <= 0) return 1
  const a = df / 2
  const x = stat / 2
  return x < a + 1 ? 1 - gammaSeries(a, x) : gammaContinued(a, x)
}

const ERFC_COF = [
  -1.3026537197817094, 0.6419697923564902, 1.9476473204185836e-2, -9.56151478680863e-3,
  -9.46595344482036e-4, 3.66839497852761e-4, 4.2523324806907e-5, -2.0278578112534e-5,
  -1.624290004647e-6, 1.30365583558e-6, 1.5626441722e-8, -8.5238095915e-8, 6.529054439e-9,
  5.059343495e-9, -9.91364156e-10, -2.27365122e-10, 9.6467911e-11, 2.394038e-12,
  -6.886027e-12, 8.94487e-13, 3.13092e-13, -1.12708e-13, 3.81e-16, 7.106e-15,
]
const erfc = (value: number) => {
  const z = Math.abs(value)
  const t = 2 / (2 + z)
  const ty = 4 * t - 2
  let d = 0
  let dd = 0
  for (let j = ERFC_COF.length - 1; j > 0; j -= 1) {
    const previous = d
    d = ty * d - dd + ERFC_COF[j]
    dd = previous
  }
  const tail = t * Math.exp(-z * z + 0.5 * (ERFC_COF[0] + ty * d) - dd)
  return value >= 0 ? tail : 2 - tail
}

/** Two-tailed p-value for a standard normal deviate. */
const normalP = (z: number) => erfc(Math.abs(z) / Math.SQRT2)

const chiSquareGof = (observed: ArrayLike<number>, expected: ArrayLike<number>) => {
  let stat = 0
  let cells = 0
  for (let index = 0; index < observed.length; index += 1) {
    if (expected[index] <= 0) continue
    cells += 1
    const diff = observed[index] - expected[index]
    stat += (diff * diff) / expected[index]
  }
  return { stat, df: cells - 1, p: chiSquareP(stat, cells - 1) }
}

const chiSquareTable = (table: number[][]) => {
  const rowSums = table.map((row) => row.reduce((a, b) => a + b, 0))
  const colSums = table[0].map((_, column) => table.reduce((sum, row) => sum + row[column], 0))
  const total = rowSums.reduce((a, b) => a + b, 0)
  let stat = 0
  for (let r = 0; r < table.length; r += 1) {
    for (let c = 0; c < table[r].length; c += 1) {
      const expected = (rowSums[r] * colSums[c]) / total
      if (expected <= 0) continue
      const diff = table[r][c] - expected
      stat += (diff * diff) / expected
    }
  }
  const df = (rowSums.filter((value) => value > 0).length - 1) * (colSums.filter((value) => value > 0).length - 1)
  return { stat, df, p: chiSquareP(stat, df) }
}

const format = (p: number) => p < 1e-4 ? p.toExponential(2) : p.toFixed(4)
const failures: string[] = []
const expectFair = (label: string, p: number, alpha = ALPHA) => {
  if (!(p > alpha)) failures.push(`${label}: p = ${format(p)}`)
  return p
}

// ------------------------------------------------------------ accumulation

type Sample = { one: number; two: number; total: number }

/**
 * Pools every test over a stream broken into independent games. Nothing is
 * measured across a game boundary, and the runs test is pooled per game so a
 * boundary cannot invent a run.
 */
class Tally {
  totals = new Float64Array(13)
  faces = [new Float64Array(7), new Float64Array(7)]
  joint = Array.from({ length: 7 }, () => new Float64Array(7))
  lagTables = Array.from({ length: MAX_LAG + 1 }, () => Array.from({ length: 11 }, () => new Float64Array(11)))
  lagSums = Array.from({ length: MAX_LAG + 1 }, () => ({ n: 0, sx: 0, sy: 0, sxx: 0, syy: 0, sxy: 0 }))
  parity = [new Float64Array(13), new Float64Array(13)]
  groups = new Map<string, Float64Array>()
  gaps = new Float64Array(256)
  n = 0
  sum = 0
  games = 0
  runs = 0
  expectedRuns = 0
  varianceRuns = 0
  above = 0
  below = 0
  gapCount = 0
  gapSum = 0
  private window: number[] = []
  private gameAbove = 0
  private gameBelow = 0
  private gameRuns = 0
  private side = 0
  private sawSeven = false
  private sinceSeven = 0

  push(sample: Sample, revision: number, group?: string) {
    this.n += 1
    this.sum += sample.total
    this.totals[sample.total] += 1
    this.faces[0][sample.one] += 1
    this.faces[1][sample.two] += 1
    this.joint[sample.one][sample.two] += 1
    this.parity[revision & 1][sample.total] += 1
    if (group !== undefined) {
      let row = this.groups.get(group)
      if (!row) {
        row = new Float64Array(13)
        this.groups.set(group, row)
      }
      row[sample.total] += 1
    }

    for (let lag = 1; lag <= Math.min(MAX_LAG, this.window.length); lag += 1) {
      const earlier = this.window[this.window.length - lag]
      this.lagTables[lag][earlier - 2][sample.total - 2] += 1
      const sums = this.lagSums[lag]
      sums.n += 1
      sums.sx += earlier
      sums.sy += sample.total
      sums.sxx += earlier * earlier
      sums.syy += sample.total * sample.total
      sums.sxy += earlier * sample.total
    }
    this.window.push(sample.total)
    if (this.window.length > MAX_LAG) this.window.shift()

    if (sample.total === 7) {
      if (this.sawSeven) {
        this.gaps[Math.min(this.sinceSeven, this.gaps.length - 1)] += 1
        this.gapCount += 1
        this.gapSum += this.sinceSeven
      }
      this.sawSeven = true
      this.sinceSeven = 0
      return
    }
    const side = sample.total > 7 ? 1 : -1
    if (side === 1) this.gameAbove += 1
    else this.gameBelow += 1
    if (side !== this.side) this.gameRuns += 1
    this.side = side
    if (this.sawSeven) this.sinceSeven += 1
  }

  /** Close the current game. Call between games and once at the end. */
  endGame() {
    const n = this.gameAbove + this.gameBelow
    if (n > 1 && this.gameAbove > 0 && this.gameBelow > 0) {
      this.runs += this.gameRuns
      this.above += this.gameAbove
      this.below += this.gameBelow
      this.expectedRuns += (2 * this.gameAbove * this.gameBelow) / n + 1
      this.varianceRuns += (2 * this.gameAbove * this.gameBelow * (2 * this.gameAbove * this.gameBelow - n)) / (n * n * (n - 1))
      this.games += 1
    }
    this.gameAbove = 0
    this.gameBelow = 0
    this.gameRuns = 0
    this.side = 0
    this.window = []
    this.sawSeven = false
    this.sinceSeven = 0
  }
}

const examine = (label: string, tally: Tally, alpha = ALPHA) => {
  const lines: string[] = [`\n${label}: ${tally.n.toLocaleString('en-US')} rolls across ${tally.games.toLocaleString('en-US')} games`]

  const expected = TRIANGLE.map((weight) => (tally.n * weight) / 36)
  const shape = chiSquareGof(tally.totals.slice(2), expected.slice(2))
  lines.push('  total    observed      expected    obs/exp        z')
  for (let total = 2; total <= 12; total += 1) {
    const seen = tally.totals[total]
    const want = expected[total]
    const z = (seen - want) / Math.sqrt(want * (1 - TRIANGLE[total] / 36))
    lines.push(`  ${String(total).padStart(5)}  ${seen.toFixed(0).padStart(10)}  ${want.toFixed(1).padStart(12)}  ${(seen / want).toFixed(5).padStart(9)}  ${z.toFixed(2).padStart(7)}`)
  }
  lines.push(`  triangular fit  chi2 = ${shape.stat.toFixed(3)}  df = ${shape.df}  p = ${format(expectFair(`${label} triangular fit`, shape.p, alpha))}`)
  const mean = tally.sum / tally.n
  lines.push(`  mean total ${mean.toFixed(5)} against 7`)
  if (Math.abs(mean - 7) > 0.02) failures.push(`${label}: mean total ${mean.toFixed(5)} is off 7`)

  for (const index of [0, 1] as const) {
    const test = chiSquareGof(tally.faces[index].slice(1), Array.from({ length: 6 }, () => tally.n / 6))
    lines.push(`  die ${index === 0 ? 'A' : 'B'} uniform  ${Array.from(tally.faces[index].slice(1)).map((value) => value.toFixed(0).padStart(9)).join('')}`)
    lines.push(`                chi2 = ${test.stat.toFixed(3)}  df = ${test.df}  p = ${format(expectFair(`${label} die ${index} uniformity`, test.p, alpha))}`)
  }

  const paired = chiSquareTable(tally.joint.slice(1).map((row) => Array.from(row.slice(1))))
  lines.push(`  die A against die B  chi2 = ${paired.stat.toFixed(3)}  df = ${paired.df}  p = ${format(expectFair(`${label} die independence`, paired.p, alpha))}`)

  lines.push('   lag        pairs    Pearson r    r p-value     chi2 11x11    chi2 p-value')
  for (let lag = 1; lag <= MAX_LAG; lag += 1) {
    const sums = tally.lagSums[lag]
    if (!sums.n) continue
    const r = (sums.n * sums.sxy - sums.sx * sums.sy) / Math.sqrt((sums.n * sums.sxx - sums.sx * sums.sx) * (sums.n * sums.syy - sums.sy * sums.sy))
    const correlation = normalP(r * Math.sqrt(sums.n))
    const contingency = chiSquareTable(tally.lagTables[lag].map((row) => Array.from(row)))
    lines.push(`  ${String(lag).padStart(4)}  ${sums.n.toFixed(0).padStart(11)}  ${r.toFixed(6).padStart(11)}  ${format(correlation).padStart(11)}  ${contingency.stat.toFixed(2).padStart(13)}  ${format(contingency.p).padStart(14)}`)
    expectFair(`${label} lag ${lag} correlation`, correlation, alpha)
    expectFair(`${label} lag ${lag} contingency`, contingency.p, alpha)
    if (Math.abs(r) > 8 / Math.sqrt(sums.n)) failures.push(`${label}: lag ${lag} correlation ${r.toFixed(6)} is too large for ${sums.n} pairs`)
  }

  const runsZ = (tally.runs - tally.expectedRuns) / Math.sqrt(tally.varianceRuns)
  lines.push(`  runs about 7  observed ${tally.runs}, expected ${tally.expectedRuns.toFixed(1)}, z = ${runsZ.toFixed(3)}, p = ${format(expectFair(`${label} runs`, normalP(runsZ), alpha))}`)
  lines.push(`  gaps between sevens  ${tally.gapCount.toLocaleString('en-US')} gaps, mean ${(tally.gapSum / tally.gapCount).toFixed(4)}, first ten ${Array.from(tally.gaps.slice(0, 10)).map((value) => value.toFixed(0)).join(' ')}`)

  const parity = [Array.from(tally.parity[0].slice(2)), Array.from(tally.parity[1].slice(2))]
  if (parity.every((row) => row.some((value) => value > 0))) {
    const test = chiSquareTable(parity)
    const meanOf = (row: number[]) => row.reduce((sum, count, index) => sum + count * (index + 2), 0) / row.reduce((a, b) => a + b, 0)
    lines.push(`  revision parity  even mean ${meanOf(parity[0]).toFixed(5)}, odd mean ${meanOf(parity[1]).toFixed(5)}, chi2 = ${test.stat.toFixed(3)}, df = ${test.df}, p = ${format(expectFair(`${label} revision parity`, test.p, alpha))}`)
  }

  if (tally.groups.size > 1) {
    const keys = [...tally.groups.keys()].sort()
    const table = keys.map((key) => Array.from(tally.groups.get(key)!.slice(2)))
    const test = chiSquareTable(table)
    for (let index = 0; index < keys.length; index += 1) {
      const row = table[index]
      const count = row.reduce((a, b) => a + b, 0)
      const groupMean = row.reduce((sum, value, offset) => sum + value * (offset + 2), 0) / count
      lines.push(`  ${keys[index].padEnd(10)} n = ${count.toFixed(0).padStart(8)}  mean ${groupMean.toFixed(5)}  P(7) = ${(row[5] / count).toFixed(5)}`)
    }
    lines.push(`  group homogeneity  chi2 = ${test.stat.toFixed(3)}  df = ${test.df}  p = ${format(expectFair(`${label} group homogeneity`, test.p, alpha))}`)
  }

  console.log(lines.join('\n'))
}

/** Two-sample chi-square on two gap histograms, so identical censoring cancels. */
const compareGaps = (left: Tally, right: Tally, buckets = 30) => {
  const cut = (tally: Tally) => {
    const counts = Array.from(tally.gaps.slice(0, buckets))
    counts.push(Array.from(tally.gaps.slice(buckets)).reduce((a, b) => a + b, 0))
    return counts
  }
  const a = cut(left)
  const b = cut(right)
  const totalA = a.reduce((x, y) => x + y, 0)
  const totalB = b.reduce((x, y) => x + y, 0)
  let stat = 0
  let cells = 0
  for (let index = 0; index < a.length; index += 1) {
    const combined = a[index] + b[index]
    if (combined < 5) continue
    cells += 1
    const wantA = (combined * totalA) / (totalA + totalB)
    const wantB = (combined * totalB) / (totalA + totalB)
    stat += ((a[index] - wantA) ** 2) / wantA + ((b[index] - wantB) ** 2) / wantB
  }
  return { stat, df: cells - 1, p: chiSquareP(stat, cells - 1) }
}

// -------------------------------------------------------------- the source

const secureRandom = () => randomInt(0x1_0000_0000) / 0x1_0000_0000
/** Byte for byte what `applyAction` builds when no source is handed to it. */
const fallbackAt = (privateRandomSeed: number, revision: number) => seededRandom(privateRandomSeed ^ ((revision + 1) * 0x9e3779b1))
const rollFrom = (random: () => number): Sample => {
  const one = 1 + Math.floor(random() * 6)
  const two = 1 + Math.floor(random() * 6)
  return { one, two, total: one + two }
}

const reachPreRoll = (seed: number, privateRandomSeed: number) => {
  let game = createGame({ seed, privateRandomSeed, controllers: ['human', 'agent', 'agent'] })
  while (game.phase.startsWith('setup')) {
    const action = game.legalActions[0]
    assert.ok(action, 'setup stalled')
    const result = applyAction(game, action)
    assert.equal(result.ok, true)
    if (result.ok) game = result.state
  }
  assert.equal(game.phase, 'pre-roll')
  return game
}

// 1. Two dice, summed. Not one number picked out of eleven.
{
  const base = reachPreRoll(11, 0x1234abcd)
  for (let one = 0; one < 6; one += 1) {
    for (let two = 0; two < 6; two += 1) {
      // Mid-bucket values, so floor() cannot be flattered by an edge.
      const scripted = [(one + 0.5) / 6, (two + 0.5) / 6]
      let index = 0
      const result = applyAction(base, { type: 'roll-dice' }, () => scripted[index++] ?? 0.5)
      assert.equal(result.ok, true)
      if (!result.ok) continue
      assert.equal(index, 2, 'a roll must consume exactly two draws')
      assert.deepEqual(result.state.lastRoll, [one + 1, two + 1])
      const event = result.state.events.findLast((candidate) => candidate.type === 'dice')
      assert.equal(event?.publicData?.total, one + two + 2, 'the reported total must be the sum of the two dice')
      assert.equal(event?.publicData?.one, one + 1)
      assert.equal(event?.publicData?.two, two + 1)
    }
  }
  console.log('two dice are rolled and summed: all 36 ordered pairs map through applyAction unchanged')
}

// 2. The sampler below has to be the engine, not a paraphrase of it.
{
  const base = reachPreRoll(11, 0x1234abcd)
  let compared = 0
  for (let revision = 0; revision < 4_000; revision += 1) {
    const state = { ...base, revision } as GameState
    const result = applyAction(state, { type: 'roll-dice' })
    assert.equal(result.ok, true)
    if (!result.ok) continue
    const derived = rollFrom(fallbackAt(base.privateRandomSeed, revision))
    assert.deepEqual(result.state.lastRoll, [derived.one, derived.two], `derivation diverged at revision ${revision}`)
    compared += 1
  }
  console.log(`sampler matches applyAction on ${compared.toLocaleString('en-US')} consecutive revisions, so the bulk numbers below are the engine's`)
}

// 3. Bulk sample, both sources, one shape: 20,000 games of 100 rolls each with
//    the revision walking the way a turn walks. Fixed seeds, so the fallback
//    column is deterministic and cannot flake.
const GAMES = 20_000
const ROLLS = 100
{
  const seedSource = seededRandom(0xc0ffee)
  const fallback = new Tally()
  const served = new Tally()
  for (let game = 0; game < GAMES; game += 1) {
    const privateRandomSeed = Math.floor(seedSource() * 0x1_0000_0000)
    const stepSource = seededRandom(privateRandomSeed ^ 0x5bf03635)
    let revision = 12
    for (let roll = 0; roll < ROLLS; roll += 1) {
      fallback.push(rollFrom(fallbackAt(privateRandomSeed, revision)), revision, `player ${(roll % 3) + 1}`)
      served.push(rollFrom(secureRandom), revision, `player ${(roll % 3) + 1}`)
      // A turn is a roll, some builds and an end, so revisions step by a few.
      revision += 2 + Math.floor(stepSource() * 6)
    }
    fallback.endGame()
    served.endGame()
  }
  examine('seeded fallback', fallback)
  // The served path is a CSPRNG sampled fresh every run, so it gets the looser
  // bound that a genuinely random column needs to survive repetition.
  examine('served secureRandom', served, 1e-6)
  const gaps = compareGaps(fallback, served)
  console.log(`\nseven-gap histograms, fallback against served, identical censoring: chi2 = ${gaps.stat.toFixed(3)}  df = ${gaps.df}  p = ${format(expectFair('gap histogram agreement', gaps.p, 1e-6))}`)
}

// 4. Whole games through the reducer, so nothing above rests on a shortcut.
{
  const fallback = new Tally()
  const served = new Tally()
  for (let index = 0; index < 16; index += 1) {
    const useServed = index % 2 === 1
    const tally = useServed ? served : fallback
    let game = createGame({
      seed: 4_100 + index,
      privateRandomSeed: 0x51ed0000 + index,
      controllers: Array(3 + (index % 2)).fill('agent'),
    })
    for (let step = 0; step < 4_000 && game.phase !== 'game-over'; step += 1) {
      const action = chooseSimulationAction(getPlayerView(game, currentActorId(game)))
      assert.ok(action, 'the policy could not resolve a phase')
      const revision = game.revision
      const seat = game.activePlayerIndex
      const result = applyAction(game, action, useServed ? secureRandom : undefined)
      assert.equal(result.ok, true, `rejected ${action.type} during ${game.phase}`)
      if (!result.ok) break
      game = result.state
      if (action.type === 'roll-dice' && game.lastRoll) {
        tally.push({ one: game.lastRoll[0], two: game.lastRoll[1], total: game.lastRoll[0] + game.lastRoll[1] }, revision, `seat ${seat}`)
      }
    }
    assert.equal(game.phase, 'game-over')
    tally.endGame()
  }
  // Eight games is far too small to test a distribution, so this only proves
  // the reducer really produces these rolls, turn after turn, seat after seat.
  console.log(`\nwhole games through applyAction: ${fallback.n} rolls on the fallback and ${served.n} on the served path, means ${(fallback.sum / fallback.n).toFixed(3)} and ${(served.sum / served.n).toFixed(3)}`)
  assert.ok(fallback.n > 200 && served.n > 200, 'the simulated games produced too few rolls to mean anything')
}

if (failures.length) {
  console.error(`\n${failures.length} fairness failure(s):`)
  for (const failure of failures) console.error(`  ${failure}`)
  process.exit(1)
}
console.log('\nok — both sources produce fair, independent, uncorrelated dice')
