/**
 * `npm run qa`. Tier 1 and tier 2, one table, no images.
 *
 * The two tiers run at the same time on purpose: tier 1 is CPU in this process
 * group and tier 2 spends most of its wall clock waiting on a browser, so
 * running them together costs about what tier 2 costs alone.
 *
 * Flags: `--tier1` or `--tier2` to run one of them.
 */
import { execFile } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import { promisify } from 'node:util'
import { runBrowserChecks } from './browser'
import { renderTable, summarise, type Check } from './table'

const run = promisify(execFile)

/**
 * Every tier 1 check, with the number to pull out of its last line. The engine
 * is a pure reducer, so all of this is memory and arithmetic.
 */
const TIER_ONE: { name: string; script: string; unit: string }[] = [
  { name: 'board', script: 'src/game/board.check.ts', unit: 'boards' },
  { name: 'engine', script: 'src/game/engine.check.ts', unit: 'revisions' },
  { name: 'integrity', script: 'src/game/integrity.check.ts', unit: 'assertions' },
  { name: 'rules', script: 'src/game/rules.check.ts', unit: 'rules' },
  { name: 'simulation', script: 'src/game/simulation.check.ts', unit: 'actions' },
  { name: 'qa-rules', script: 'src/game/qa.check.ts', unit: 'actions' },
  { name: 'assets', script: 'scripts/qa/assets.check.ts', unit: 'files' },
  { name: 'manifest', script: 'src/scene/loading/manifest.check.ts', unit: 'textures' },
  { name: 'dice', script: 'src/scene/motion/diceThrow.check.ts', unit: 'throws' },
  { name: 'sightline', script: 'src/scene/structures/sightline.check.ts', unit: 'cases' },
]

/** The largest number a check printed, which is the one worth reporting. */
const biggestNumber = (text: string) => {
  const numbers = [...text.matchAll(/\b(\d[\d,]*)\b/g)].map((match) => Number(match[1].replaceAll(',', '')))
  return numbers.length ? Math.max(...numbers) : 0
}

const tierOne = async (): Promise<Check[]> => Promise.all(TIER_ONE.map(async ({ name, script, unit }) => {
  try {
    const { stdout } = await run('npx', ['tsx', script], { maxBuffer: 8 * 1024 * 1024 })
    // Some checks print a verdict and no number. Passing is the measurement.
    const measured = biggestNumber(stdout)
    return { name: `t1.${name}`, ok: true, value: measured || 1, unit: measured ? unit : 'ok' }
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string }
    const detail = `${failure.stderr ?? ''}${failure.stdout ?? ''}`
    const line = detail.split('\n').find((candidate) => /AssertionError|Error:/.test(candidate)) ?? detail.split('\n')[0]
    return { name: `t1.${name}`, ok: false, value: 0, unit, note: line.trim().slice(0, 180) }
  }
}))

const main = async () => {
  const only = process.argv.find((argument) => argument === '--tier1' || argument === '--tier2')
  const started = performance.now()
  const [one, two] = await Promise.all([
    only === '--tier2' ? Promise.resolve([] as Check[]) : tierOne(),
    only === '--tier1' ? Promise.resolve([] as Check[]) : runBrowserChecks(),
  ])
  const checks = [...one, ...two]
  const seconds = ((performance.now() - started) / 1000).toFixed(1)
  const { total, failed } = summarise(checks)
  console.log(renderTable(`katan qa  ${total - failed}/${total} pass  ${seconds}s`, checks))
  if (failed) console.log(`\n${failed} failing. Tier 3 (npm run qa:visual) answers "does it look right", never "does it work".`)
  process.exitCode = failed ? 1 : 0
}

await main()
