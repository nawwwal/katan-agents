/**
 * Tier 3: one contact sheet, for the only question the other tiers cannot
 * answer.
 *
 * Screenshots are here to say whether something looks right. They are never the
 * way to find out whether something works -- tier 2 costs a few hundred tokens
 * and answers that properly. So this shoots at half size, tiles every state
 * worth seeing onto one image with a caption strip, and hands back a single
 * file. One picture to read instead of twenty.
 *
 *   npm run qa:visual                     every stage
 *   npm run qa:visual -- trade robber     just those
 *
 * `scripts/shot.sh` still exists for a full-resolution look at one state; this
 * is the survey, not the close-up.
 */
import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { promisify } from 'node:util'

const run = promisify(execFile)

const SESSION = process.env.AGENT_BROWSER_SESSION || 'qaharness'
const ORIGIN = process.env.KATAN_ORIGIN || 'http://127.0.0.1:5173'
const OUT = process.env.QA_SHEET || 'art/qa/contact-sheet.png'

/**
 * Every state worth a look, and the query that pins it. `?ui=` is the dev-only
 * harness in `App.tsx`: it drives the interface into a state that would
 * otherwise need live opponents, which is why this needs no match at all.
 */
const STAGES: { name: string; query: string }[] = [
  { name: 'title', query: '' },
  { name: 'match', query: 'ui=match' },
  { name: 'setup', query: 'ui=setup' },
  { name: 'trade', query: 'ui=trade' },
  { name: 'trade-sent', query: 'ui=trade-sent' },
  { name: 'trade-response', query: 'ui=trade-response' },
  { name: 'trade-accepted', query: 'ui=trade-accepted' },
  { name: 'trade-declined', query: 'ui=trade-declined' },
  { name: 'robber', query: 'ui=robber' },
  { name: 'victim', query: 'ui=victim' },
  { name: 'cards', query: 'ui=cards' },
  { name: 'rules', query: 'ui=rules' },
  { name: 'history', query: 'ui=history' },
  { name: 'summary', query: 'ui=summary' },
]

const browser = (args: string[]) => run('agent-browser', ['--session', SESSION, ...args], {
  env: { ...process.env, AGENT_BROWSER_SESSION: SESSION },
  maxBuffer: 16 * 1024 * 1024,
})

const main = async () => {
  const wanted = process.argv.slice(2).filter((argument) => !argument.startsWith('-'))
  const stages = wanted.length ? STAGES.filter((stage) => wanted.includes(stage.name)) : STAGES
  if (!stages.length) throw new Error(`no such stage. Known: ${STAGES.map((stage) => stage.name).join(', ')}`)

  const response = await fetch(`${ORIGIN}/`).catch(() => undefined)
  if (!response?.ok) throw new Error(`no dev server at ${ORIGIN}. Start one with 'npm run dev'.`)

  const started = performance.now()
  const scratch = await mkdtemp(join(tmpdir(), 'katan-sheet-'))
  const shots: string[] = []
  try {
    // Half of 1920x1200. A contact sheet is for reading composition, colour and
    // hierarchy; nobody judges a serif at thumbnail size, and the full-size
    // shot is one `scripts/shot.sh` away when they need to.
    await browser(['set', 'viewport', '960', '600'])
    for (const stage of stages) {
      const file = join(scratch, `${stage.name}.png`)
      await browser(['open', `${ORIGIN}/?${stage.query}`])
      await new Promise((resolve) => setTimeout(resolve, Number(process.env.QA_SETTLE ?? 6_000)))
      await browser(['screenshot', file])
      shots.push(`${stage.name}=${file}`)
    }
    await run('python3', [new URL('./sheet.py', import.meta.url).pathname, OUT, ...shots])
    console.log(`${OUT}  ${stages.length} states  ${((performance.now() - started) / 1000).toFixed(1)}s`)
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

await main()
