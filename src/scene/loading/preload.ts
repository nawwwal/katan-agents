import { SOUNDS, SOUND_IDS } from '../../audio/soundbank'
import { DEVELOPMENT_ART, RESOURCE_IMAGE } from '../../ui/gameVisuals'
import { PLAYER_BANNER, PLAYER_COLORS, PLAYER_ROOF } from '../playerColors'
import * as structureMaterials from '../structures/materials'
import { preloadTerrainMaterials } from '../terrain/textures'
import { loadBakedManifest } from './manifest'

/**
 * Everything the board needs, fetched and decoded once, before the first
 * interactive frame.
 *
 * The brief for this was blunt: the game should not lag while it is being
 * played. Almost none of the stutter in a scene like this comes from raw
 * triangle count -- it comes from work that happens the first time something
 * is needed. A texture decoded mid-turn, a canvas-painted material baked when
 * the first city goes down, an mp3 fetched when the dice land. Each is a
 * one-off stall that never shows up in an average frame rate and is obvious to
 * anyone holding the mouse.
 *
 * So the rule is: no first time during play. This module does all of it up
 * front and reports honest progress while it works. Shader compilation is the
 * other half of the same problem and lives in `precompile.ts`.
 */

export type PreloadPhase = 'idle' | 'manifest' | 'models' | 'textures' | 'surfaces' | 'audio' | 'done'

export type PreloadState = {
  phase: PreloadPhase
  /** 0..1 across every step, weighted by rough cost rather than file count. */
  progress: number
  label: string
  done: boolean
  /** Non-fatal failures. A missing asset degrades the scene, it does not stop it. */
  failures: string[]
  /** Wall-clock milliseconds from start to done. */
  elapsedMs: number
}

const KIT_URL = '/assets/3d/katan-kit.glb'

declare global {
  // eslint-disable-next-line no-var
  var __katanLoad: Record<string, number> | undefined
}

type Listener = (state: PreloadState) => void

const listeners = new Set<Listener>()
let state: PreloadState = { phase: 'idle', progress: 0, label: 'Preparing the island', done: false, failures: [], elapsedMs: 0 }

const publish = (patch: Partial<PreloadState>) => {
  state = { ...state, ...patch }
  for (const listener of listeners) listener(state)
}

export const preloadState = () => state

export const subscribeToPreload = (listener: Listener) => {
  listeners.add(listener)
  listener(state)
  return () => { listeners.delete(listener) }
}

/** Let the browser paint the progress bar between chunks of blocking work. */
const yieldToPaint = () => new Promise<void>((resolve) => {
  requestAnimationFrame(() => setTimeout(resolve, 0))
})

const warmFetch = async (url: string) => {
  // Pulling the bytes into the HTTP cache is enough: whatever parses them
  // later -- GLTFLoader, decodeAudioData, an <img> -- then hits memory rather
  // than the network, and none of those parses stall a frame the way a
  // round trip does.
  const response = await fetch(url, { cache: 'force-cache' })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  await response.arrayBuffer()
}

const decodeImage = async (url: string) => {
  if (typeof createImageBitmap === 'function') {
    const response = await fetch(url, { cache: 'force-cache' })
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
    const bitmap = await createImageBitmap(await response.blob())
    bitmap.close?.()
    return
  }
  await new Promise<void>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve()
    image.onerror = () => reject(new Error('decode failed'))
    image.src = url
  })
}

type Step = {
  phase: PreloadPhase
  label: string
  /** Relative cost, used to weight progress so the bar does not lurch. */
  weight: number
  run: (tick: (fraction: number) => void) => Promise<void>
}

const failures: string[] = []

const attempt = async (name: string, work: () => Promise<void>) => {
  try {
    await work()
  } catch (error) {
    failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Run a list of independent fetches with a small concurrency cap.
 *
 * Progress is weighted by cost rather than by file count, because the texture
 * step mixes a 700KB baked albedo with a 4KB resource icon and a bar that
 * counts files spends most of its travel on the cheap half of the list.
 */
const pooled = async (items: readonly { url: string; cost: number }[], limit: number, work: (url: string) => Promise<void>, tick: (fraction: number) => void) => {
  if (!items.length) return
  const total = items.reduce((sum, item) => sum + item.cost, 0) || items.length
  let index = 0
  let done = 0
  const worker = async () => {
    for (;;) {
      const next = index
      index += 1
      if (next >= items.length) return
      await attempt(items[next].url, () => work(items[next].url))
      done += items[next].cost || 1
      tick(done / total)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

/** What an asset with no recorded size is assumed to cost, in bytes. */
const ASSUMED_BYTES = 24_000

const buildSteps = (): Step[] => [
  {
    phase: 'manifest',
    label: 'Reading the asset manifest',
    weight: 1,
    run: async () => { await loadBakedManifest() },
  },
  {
    phase: 'models',
    label: 'Loading the island kit',
    weight: 6,
    run: async (tick) => {
      await attempt(KIT_URL, () => warmFetch(KIT_URL))
      tick(1)
    },
  },
  {
    // The heaviest step by a wide margin now that the baked manifest actually
    // parses: roughly ten megabytes of terrain against a few hundred kilobytes
    // of everything else. It was weighted at 8 back when it fetched only the
    // card art, which is how the bar reached "Ready" with the terrain still in
    // flight.
    phase: 'textures',
    label: 'Decoding textures',
    weight: 26,
    run: async (tick) => {
      const manifest = await loadBakedManifest()
      const items = [
        ...manifest.textures.map((texture) => ({ url: texture.url, cost: texture.bytes ?? ASSUMED_BYTES })),
        ...Object.values(RESOURCE_IMAGE).map((url) => ({ url, cost: ASSUMED_BYTES })),
        ...Object.values(DEVELOPMENT_ART).map((url) => ({ url, cost: ASSUMED_BYTES })),
      ]
      await pooled(items, 6, decodeImage, tick)
    },
  },
  {
    phase: 'surfaces',
    label: 'Painting terrain surfaces',
    weight: 14,
    run: async (tick) => {
      // These are painted pixel by pixel on the CPU, and they are the single
      // most expensive thing that used to happen lazily during play. Yield
      // between them or the loading screen freezes while it claims to be
      // loading, which is its own kind of lie.
      const surfaces = proceduralSurfaces()
      let finished = 0
      let sinceYield = performance.now()
      for (const surface of surfaces) {
        await attempt(surface.name, async () => { surface.build() })
        finished += 1
        tick(finished / surfaces.length)
        // Yield on a time budget, not once per surface. Handing a frame back
        // after every cheap material would spend more wall clock waiting for
        // vsync than painting pixels.
        if (performance.now() - sinceYield > 24) {
          await yieldToPaint()
          sinceYield = performance.now()
        }
      }
    },
  },
  {
    phase: 'audio',
    label: 'Fetching audio',
    weight: 5,
    run: async (tick) => {
      // Fetch only. Decoding needs an AudioContext, and creating one before a
      // user gesture is exactly the kind of thing browsers grumble about, so
      // the sound bank still owns decoding -- it just gets to do it from cache.
      await pooled(SOUND_IDS.map((id) => ({ url: SOUNDS[id].file, cost: ASSUMED_BYTES })), 6, warmFetch, tick)
    },
  },
]

/**
 * The procedurally painted materials, listed lazily so importing this module
 * does not immediately drag every texture generator into the initial bundle.
 */
const proceduralSurfaces = (): { name: string; build: () => void }[] => {
  const surfaces: { name: string; build: () => void }[] = [{ name: 'terrain', build: preloadTerrainMaterials }]

  for (const [name, value] of Object.entries(structureMaterials)) {
    if (typeof value !== 'function') continue
    const factory = value as (color?: string) => unknown
    if (factory.length === 0) {
      surfaces.push({ name, build: () => { factory() } })
      continue
    }
    // Player-tinted materials are a family, not one material. Every colour a
    // piece can be placed in gets built now, so the first settlement of each
    // colour is not its own texture bake.
    const palette = name === 'roofMaterial' ? PLAYER_ROOF : name === 'clothMaterial' ? PLAYER_BANNER : PLAYER_COLORS
    for (const [key, hex] of Object.entries(palette)) surfaces.push({ name: `${name}:${key}`, build: () => { factory(hex) } })
  }

  return surfaces
}

let running: Promise<PreloadState> | undefined

/** Idempotent. Every caller shares one run and one set of results. */
export const preloadEverything = (): Promise<PreloadState> => (running ??= (async () => {
  const started = performance.now()
  const steps = buildSteps()
  const total = steps.reduce((sum, step) => sum + step.weight, 0)
  let completed = 0

  const timings: Record<string, number> = {}

  for (const step of steps) {
    const stepStarted = performance.now()
    publish({ phase: step.phase, label: step.label, progress: completed / total })
    await step.run((fraction) => publish({ progress: (completed + step.weight * Math.min(1, fraction)) / total }))
    completed += step.weight
    timings[step.phase] = Math.round(performance.now() - stepStarted)
    publish({ progress: completed / total })
  }

  // Per-phase cost, so a slow load can be attributed rather than guessed at.
  // `startedAt` and `finishedAt` sit on the same clock as resource timing, so a
  // fetch can be checked against the window it was supposed to happen in rather
  // than assumed to have happened there.
  const finished = performance.now()
  globalThis.__katanLoad = { ...timings, startedAt: Math.round(started), finishedAt: Math.round(finished), totalMs: Math.round(finished - started) }

  publish({ phase: 'done', label: 'Ready', progress: 1, done: true, failures: [...failures], elapsedMs: Math.round(performance.now() - started) })
  if (failures.length) console.warn('[preload] some assets did not load:', failures)
  return state
})())
