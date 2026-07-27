/**
 * Tier 2: one browser boot, a battery of interaction assertions, no artifacts.
 *
 * Every check returns a boolean and a number. Nothing here takes a screenshot
 * and nothing here reads pixels; if a question can only be answered by looking,
 * it belongs in tier 3.
 *
 * The order matters. The room is parked at `setup-settlement` before the page
 * is opened, so the first thing the browser sees is a board full of legal
 * corners -- which is the cheapest possible reproduction of the bug this file
 * exists to guard: a pointer event at a legal vertex that hits nothing.
 */
import { spawn } from 'node:child_process'
import { pageScript, type PageConfig } from './page'
import { offerToViewer, saveForCity, startFixture, type Fixture, type Room } from './harness'
import { startTouch, type TouchSession } from './touch'
import type { GameAction, PlayerView } from '../../src/game/types'
import type { Check } from './table'

const SESSION = process.env.AGENT_BROWSER_SESSION || 'qaharness'

/** Desktop first, then the phone. Both are load-bearing sizes for this app. */
const DESKTOP = { width: 1920, height: 1200, minTarget: 28 }
const MOBILE = { width: 390, height: 844, minTarget: 44 }

/** `QA_DEBUG=1` narrates the run to stderr; the table itself stays silent. */
const trace = (message: string) => { if (process.env.QA_DEBUG) process.stderr.write(`[qa] ${message}\n`) }

/**
 * One agent-browser call. `execFile`'s `input` option is a `spawnSync`-only
 * idea, so `eval --stdin` has to be fed by hand or the child waits forever.
 */
const browser = (args: string[], input?: string) => new Promise<string>((resolve, reject) => {
  trace(args.slice(0, 2).join(' '))
  const child = spawn('agent-browser', ['--session', SESSION, ...args], {
    env: { ...process.env, AGENT_BROWSER_SESSION: SESSION },
  })
  let stdout = ''
  let stderr = ''
  const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`agent-browser ${args[0]} timed out`)) }, 90_000)
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  child.on('error', (error) => { clearTimeout(timer); reject(error) })
  child.on('close', (code) => {
    clearTimeout(timer)
    if (code === 0) resolve(stdout)
    else reject(new Error(`agent-browser ${args.join(' ')} exited ${code}: ${(stderr || stdout).slice(0, 200)}`))
  })
  child.stdin.end(input ?? '')
})

const evaluate = async <T>(config: PageConfig): Promise<T> => {
  const stdout = await browser(['eval', '--stdin'], pageScript(config))
  const trimmed = stdout.trim()
  try {
    return JSON.parse(trimmed) as T
  } catch {
    throw new Error(`page script returned unparseable output: ${trimmed.slice(0, 300)}`)
  }
}

type ConsoleMessage = { text: string; type: string }

const consoleMessages = async (): Promise<ConsoleMessage[]> => {
  const stdout = await browser(['console', '--json'])
  const payload = JSON.parse(stdout) as { data?: { messages?: ConsoleMessage[] } }
  return payload.data?.messages ?? []
}

/** Vite's own chatter and React's devtools nag are not the app's console. */
const NOISE = /^\[vite\]|Download the React DevTools|React DevTools/

/**
 * Interactive means three things at once: the preloader has published its
 * timings, the loading screen has finished dissolving, and the board is
 * offering the seat something to do. Waiting on the last one alone lands the
 * checks on a page that is still loading.
 */
const READY = "!!globalThis.__katanLoad && document.querySelectorAll('[aria-busy]').length === 0 && document.querySelectorAll('.board-targets button').length > 0"

/**
 * Returns whether the page ever became interactive. A page that never gets
 * there is a failed check, not a reason to abandon the run: the checks that
 * follow are exactly the ones that say why.
 */
const open = async (origin: string, path: string) => {
  await browser(['open', `${origin}${path}`])
  try {
    await browser(['wait', '--fn', READY, '--timeout', '25000'])
    return true
  } catch {
    return false
  }
}

const seat = async (origin: string, room: Room) => {
  await browser(['open', `${origin}/`])
  const credentials = JSON.stringify(room.human.credentials)
  const script = `(() => { sessionStorage.setItem(${JSON.stringify(`katan:room-seat:${room.code}`)}, ${JSON.stringify(credentials)}); return { seated: true } })()`
  await browser(['eval', '--stdin'], script)
}

type BootResult = {
  canvasWidth: number
  webgl: number
  loadingVisible: boolean
  preload: { totalMs: number; startedAt: number; finishedAt: number } | null
  preloadFetched: number
  lateHeavy: string[]
  lateHeavyCount: number
  failedResources: string[]
  failedCount: number
  domTargets: number
}

type TargetResult = {
  total: number; onScreen: number; reachable: number; smallestPx: number
  extentRatio: number; worstDrawnPx: number; worstHitPx: number; instanced: number
}
type EnvironmentResult = {
  width: number; height: number; dpr: number; maxTouchPoints: number
  touchEvents: boolean; coarse: boolean; hover: boolean; reducedMotion: boolean
}
type StageResult = { staged: boolean; tried: number; title: string; shape?: string; targets?: number }
type ConfirmResult = { confirmed: boolean; previewGone?: boolean }
type PlacementResult = { pressed: boolean; reason?: string; targets?: number }
type LayoutResult = {
  width: number; height: number; cls: number; overflow: number; controls: number
  smallCount: number; small: string[]
  unlabelledCount: number; unlabelled: string[]
  contrastFailures: number; contrastWorst: number; contrastSample: string[]
}

const first = (values: string[], limit = 3) => values.slice(0, limit).join(' | ')

/**
 * A group of checks that cannot take the run down with it. A page script that
 * throws is a finding about the page, so it becomes a failed line rather than
 * an abort that hides every check after it.
 */
const guard = async (name: string, checks: Check[], work: () => Promise<void>) => {
  try {
    await work()
  } catch (error) {
    checks.push({ name, ok: false, value: 0, unit: 'threw', note: (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').slice(0, 160) })
  }
}

/** The viewer's seat, playing only what it must so the turn reaches a rival. */
const passTheTurn = (view: PlayerView): GameAction | undefined =>
  view.legalActions.find((action) => action.type === 'roll-dice')
  ?? view.legalActions.find((action) => action.type === 'end-turn')
  ?? view.legalActions.find((action) => action.type === 'decline-trade' || (action.type === 'respond-trade' && !action.accept))
  ?? view.legalActions[0]

/** Click a board affordance for real, then confirm it and prove the room moved. */
const clickAndConfirm = async (room: Room, kind: 'vertex' | 'edge' | 'city', checks: Check[]) => {
  const before = await room.view()
  const staged = await evaluate<StageResult>({ mode: 'stage', kind })
  checks.push({
    name: `click.${kind}`,
    ok: staged.staged,
    value: staged.tried,
    unit: 'tries',
    note: staged.staged ? undefined : `no pointer click reached a legal ${kind}; ${staged.targets ?? 0} legal targets in the DOM`,
  })
  if (!staged.staged) {
    checks.push({ name: `submit.${kind}`, ok: false, value: 0, unit: 'rev', note: 'nothing was staged' })
    return false
  }
  const confirmed = await evaluate<ConfirmResult>({ mode: 'confirm' })
  let after = await room.view()
  for (let wait = 0; wait < 40 && after.game?.revision === before.game?.revision; wait += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50))
    after = await room.view()
  }
  const moved = (after.game?.revision ?? 0) > (before.game?.revision ?? 0)
  checks.push({
    name: `submit.${kind}`,
    ok: confirmed.confirmed && moved,
    value: after.game?.revision ?? 0,
    unit: 'rev',
    note: moved ? undefined : 'confirm did not reach the room service',
  })
  return moved
}

type TradeResult = {
  open: boolean; state: string; sendPresent: boolean; sendDisabled: boolean
  harborNote: string; responding: boolean; title: string
}

/**
 * The client's report, reduced to three assertions.
 *
 * "It glitches out after I do one trade" is a table that never leaves the last
 * result: complete one deal on your own turn, let the table close itself, open
 * it again and it has to be composing with Send present. The harbour rail then
 * has to give the real reason it is shut, and a directed offer from another
 * seat still has to reach the viewer as a response.
 */
const tradeChecks = async (room: Room, checks: Check[]) => {
  await evaluate<PlacementResult>({ mode: 'placement', button: 'trade' })
  const opened = await evaluate<TradeResult>({ mode: 'trade' })
  checks.push({ name: 'trade.open', ok: opened.open && opened.state === 'composing', value: opened.sendPresent ? 1 : 0, unit: `state ${opened.state || 'none'}`, note: 'the trade table did not open composing' })
  // The harbour is shut for one of two reasons and it has to name the right
  // one; "opens on your turn" while it is your turn is the wrong branch.
  const view = await room.view()
  const yourTurn = view.game?.legalActions.length ? true : false
  checks.push({
    name: 'trade.harbor',
    ok: !(yourTurn && /opens on your turn/i.test(opened.harborNote)),
    value: opened.harborNote.length,
    unit: 'chars of reason',
    note: `the rail says "${opened.harborNote}" while it is your turn`,
  })

  // One completed deal, over the real transport, on the viewer's own turn.
  const offer = await room.coverableOffer()
  if (!offer) {
    checks.push({ name: 'trade.reopen', ok: false, value: 0, unit: 'no offer', note: 'the seat had nothing to offer, so the second-trade path was not exercised' })
    return
  }
  await room.play(room.human, offer)
  const accepted = await room.acceptPendingTrade()
  checks.push({ name: 'trade.accepted', ok: accepted, value: accepted ? 1 : 0, unit: 'deal', note: 'no seat could accept the offer' })
  // The table closes itself 1.3s after a result, so wait past that and reopen.
  await new Promise((resolve) => setTimeout(resolve, 1_800))
  await evaluate<PlacementResult>({ mode: 'placement', button: 'trade' })
  const reopened = await evaluate<TradeResult>({ mode: 'trade' })
  checks.push({
    name: 'trade.reopen',
    ok: reopened.open && reopened.state === 'composing' && reopened.sendPresent,
    value: reopened.open ? 1 : 0,
    unit: `state ${reopened.state || 'closed'}`,
    note: `after one completed trade the table reopens as "${reopened.state}" instead of composing`,
  })
  await evaluate({ mode: 'closeDialog' })

  // A directed offer from another seat still has to reach this one as a
  // response panel, which is the half of the rework nothing had checked through
  // the components players actually use.
  const reached = await room.driveUntil(
    (seat) => seat.legalActions.some((action) => action.type === 'accept-trade' || action.type === 'decline-trade' || action.type === 'respond-trade'),
    { budget: 400, humanPolicy: passTheTurn, rivalPolicy: offerToViewer(room.human.credentials.playerId) },
  )
  if (!reached.reached) {
    checks.push({ name: 'trade.respond', ok: false, value: reached.actions, unit: 'actions', note: 'no rival offered to the viewer within the budget' })
    return
  }
  await browser(['wait', '--fn', "!!document.querySelector('.trade-table')", '--timeout', '10000']).catch(() => undefined)
  const responding = await evaluate<TradeResult>({ mode: 'trade' })
  checks.push({
    name: 'trade.respond',
    ok: responding.open && (responding.responding || responding.state === 'responding'),
    value: reached.actions,
    unit: `actions, state ${responding.state || 'closed'}`,
    note: 'a directed offer never reached the viewer as a response panel',
  })
}

const layoutChecks = async (label: string, minTarget: number, checks: Check[]) => {
  const layout = await evaluate<LayoutResult>({ mode: 'layout', minTarget })
  checks.push({ name: `layout.shift.${label}`, ok: layout.cls < 0.1, value: layout.cls, unit: 'cls' })
  checks.push({ name: `layout.overflow.${label}`, ok: layout.overflow === 0, value: layout.overflow, unit: 'px' })
  checks.push({
    name: `a11y.target.${label}`,
    ok: layout.smallCount === 0,
    value: layout.smallCount,
    unit: `of ${layout.controls} under ${minTarget}px`,
    note: layout.smallCount ? first(layout.small) : undefined,
  })
  checks.push({
    name: `a11y.label.${label}`,
    ok: layout.unlabelledCount === 0,
    value: layout.unlabelledCount,
    unit: 'unnamed',
    note: layout.unlabelledCount ? first(layout.unlabelled) : undefined,
  })
  checks.push({
    name: `a11y.contrast.${label}`,
    ok: layout.contrastFailures === 0,
    value: layout.contrastFailures,
    unit: `fail, worst ${layout.contrastWorst}:1`,
    note: layout.contrastFailures ? first(layout.contrastSample) : undefined,
  })
}

export const runBrowserChecks = async (): Promise<Check[]> => {
  const checks: Check[] = []
  let fixture: Fixture | undefined
  try {
    fixture = await startFixture()
    const setupRoom = await fixture.openRoom(28)
    const setupReady = await setupRoom.driveUntil((view) => view.legalActions.some((action) => action.type === 'place-settlement'))
    const cityRoom = await fixture.openRoom(28)
    // The viewer's seat saves rather than spends, so the city it can afford is
    // still unbuilt when the browser arrives.
    const cityReady = await cityRoom.driveUntil(
      (view) => view.phase === 'action' && view.legalActions.some((action) => action.type === 'build-city'),
      { humanPolicy: saveForCity },
    )
    checks.push({ name: 'fixture.states', ok: setupReady.reached && cityReady.reached, value: setupReady.actions + cityReady.actions, unit: 'actions driven' })

    await browser(['set', 'viewport', String(DESKTOP.width), String(DESKTOP.height)])
    await browser(['console', '--clear'])
    await seat(fixture.origin, setupRoom)
    await seat(fixture.origin, cityRoom)
    const interactive = await open(fixture.origin, `/?room=${setupRoom.code}`)
    checks.push({ name: 'boot.interactive', ok: interactive, value: interactive ? 1 : 0, unit: 'ready', note: 'the board never became interactive: still loading, or offering no legal target' })

    const boot = await evaluate<BootResult>({ mode: 'boot' })
    checks.push({ name: 'boot.webgl', ok: boot.webgl === 2 && boot.canvasWidth > 0, value: boot.canvasWidth, unit: `px wide, webgl${boot.webgl}` })
    checks.push({ name: 'boot.ready', ok: !boot.loadingVisible, value: boot.preload?.totalMs ?? 0, unit: 'ms preload' })
    checks.push({
      name: 'preload.window',
      ok: Boolean(boot.preload) && boot.preloadFetched > 0,
      value: boot.preloadFetched,
      unit: 'assets in window',
      note: boot.preload ? undefined : 'the preloader never published __katanLoad',
    })
    checks.push({
      name: 'preload.late',
      ok: boot.lateHeavyCount === 0,
      value: boot.lateHeavyCount,
      unit: 'heavy fetches after ready',
      note: boot.lateHeavyCount ? first(boot.lateHeavy) : undefined,
    })
    checks.push({
      name: 'net.status',
      ok: boot.failedCount === 0,
      value: boot.failedCount,
      unit: 'non-2xx',
      note: boot.failedCount ? first(boot.failedResources) : undefined,
    })

    const messages = (await consoleMessages()).filter((message) => !NOISE.test(message.text))
    const errors = messages.filter((message) => message.type === 'error')
    const warnings = messages.filter((message) => message.type === 'warning')
    const glWarnings = warnings.filter((message) => /webgl|gl_invalid|shader|three\./i.test(message.text))
    checks.push({ name: 'console.errors', ok: errors.length === 0, value: errors.length, unit: 'errors', note: errors.length ? first(errors.map((message) => message.text.slice(0, 90))) : undefined })
    checks.push({ name: 'console.webgl', ok: glWarnings.length === 0, value: glWarnings.length, unit: 'gl warnings', note: glWarnings.length ? first([...new Set(glWarnings.map((message) => message.text.slice(0, 90)))]) : undefined })

    const view = await setupRoom.view()
    const legalBoard = view.game?.legalActions.filter((action) => 'vertexId' in action || 'edgeId' in action || 'hexId' in action).length ?? 0
    checks.push({ name: 'targets.dom', ok: boot.domTargets === legalBoard && legalBoard > 0, value: boot.domTargets, unit: `of ${legalBoard} legal` })

    await guard('targets.hit', checks, async () => {
    const targets = await evaluate<TargetResult>({ mode: 'targets' })
    checks.push({
      name: 'targets.hit',
      ok: targets.onScreen > 0 && targets.reachable === targets.onScreen,
      value: targets.reachable,
      unit: `of ${targets.onScreen} on screen`,
      note: targets.reachable === targets.onScreen ? undefined : 'a legal marker is not hit-testable at its own centre',
    })
    checks.push({ name: 'targets.px', ok: targets.smallestPx >= 24, value: targets.smallestPx, unit: 'px smallest marker' })
    // A marker that answers to a fraction of what it draws is a quieter dead
    // click: the affordance is visible, aimed at, and mostly inert.
    // The rule is deliberately one-sided. A hit volume wider than the mark is
    // fine and often kind; a mark wider than its hit volume is the quiet
    // version of the dead click, and it is exactly what a staged corner did
    // when it grew to 1.7x while its cylinder stayed at 1x. Shrinking a
    // de-emphasised marker's hit area would be the opposite mistake, so the
    // check never asks the hit region to come down.
    checks.push({
      name: 'targets.extent',
      ok: targets.extentRatio >= 0.75,
      value: targets.extentRatio,
      unit: `hit/drawn, worst ${targets.worstHitPx}px of ${targets.worstDrawnPx}px`,
      note: 'a marker draws wider than the region that answers a pointer',
    })
    })

    await guard('click.vertex', checks, () => clickAndConfirm(setupRoom, 'vertex', checks).then(() => undefined))
    // Placing the settlement hands the same seat a road, so the edge affordance
    // is live on the very next frame with no other seat having to move.
    await guard('click.edge', checks, () => clickAndConfirm(setupRoom, 'edge', checks).then(() => undefined))

    await guard('layout.1920', checks, () => layoutChecks(String(DESKTOP.width), DESKTOP.minTarget, checks))

    const desktopEnvironment = await evaluate<EnvironmentResult>({ mode: 'environment' })
    checks.push({
      name: 'env.1920',
      ok: desktopEnvironment.width === DESKTOP.width && desktopEnvironment.hover && !desktopEnvironment.coarse,
      value: desktopEnvironment.width,
      unit: `px, hover ${desktopEnvironment.hover}, coarse ${desktopEnvironment.coarse}`,
    })

    // The city needs a settlement, ore and grain, so it lives in the room that
    // was driven forward before the browser ever saw it.
    if (cityReady.reached) {
      await open(fixture.origin, `/?room=${cityRoom.code}`)
      const placement = await evaluate<PlacementResult>({ mode: 'placement', button: 'city' })
      checks.push({ name: 'hud.city-mode', ok: placement.pressed, value: placement.targets ?? 0, unit: 'targets', note: placement.reason })
      if (placement.pressed) await clickAndConfirm(cityRoom, 'city', checks)
      await guard('trade', checks, () => tradeChecks(cityRoom, checks))
    } else {
      for (const name of ['hud.city-mode', 'click.city', 'submit.city', 'trade.reopen', 'trade.harbor', 'trade.respond']) {
        checks.push({ name, ok: false, value: 0, unit: 'unreached', note: 'no room reached a state where a city was affordable' })
      }
    }

    // Mobile, with touch actually on. `set viewport` alone leaves the page
    // reporting a mouse, and a phone check run against a mouse is fiction.
    let touch: TouchSession | undefined
    try {
      // A room of its own, parked where the viewer has something to do, because
      // the trade checks above hand the turn to a rival.
      const mobileRoom = await fixture.openRoom(29)
      await mobileRoom.driveUntil((view) => view.legalActions.some((action) => action.type === 'place-settlement'))
      await seat(fixture.origin, mobileRoom)
      await open(fixture.origin, `/?room=${mobileRoom.code}`)
      touch = await startTouch(SESSION, { width: MOBILE.width, height: MOBILE.height, scale: 3 })
      // `ontouchstart` only appears on the next document; the media features and
      // `maxTouchPoints` flip immediately.
      await browser(['eval', '--stdin'], '(() => { location.reload(); return { reloading: true } })()')
      await browser(['wait', '--fn', READY, '--timeout', '40000'])
      const mobileEnvironment = await evaluate<EnvironmentResult>({ mode: 'environment' })
      checks.push({
        name: 'env.390',
        ok: mobileEnvironment.width <= MOBILE.width && mobileEnvironment.coarse && !mobileEnvironment.hover && mobileEnvironment.maxTouchPoints > 0,
        value: mobileEnvironment.maxTouchPoints,
        unit: `touch points, coarse ${mobileEnvironment.coarse}, hover ${mobileEnvironment.hover}`,
        note: 'the page still reports a mouse, so every mobile line below is about a desktop at phone width',
      })
      await guard('layout.390', checks, () => layoutChecks(String(MOBILE.width), MOBILE.minTarget, checks))
    } finally {
      await touch?.release()
    }
  } catch (error) {
    checks.push({ name: 'tier2', ok: false, value: 0, unit: 'aborted', note: error instanceof Error ? error.message.slice(0, 200) : String(error) })
  } finally {
    await fixture?.stop()
    await browser(['close']).catch(() => undefined)
  }
  return checks
}
