/**
 * The baked-texture manifest, if the bake pipeline has produced one.
 *
 * `public/assets/baked/manifest.json` is written by a separate bake step that
 * may or may not have run. Everything here is written so that a missing or
 * empty manifest costs nothing: the loader simply has fewer files to warm and
 * the game starts exactly as before.
 *
 * That tolerance had a cost. The parser accepted a bare array, `textures`,
 * `entries` or `assets`, and the pipeline emits none of those. It emits
 * `{ schema, pipeline, basePath, contract, budget, preload, materials }`, so
 * `loadBakedManifest()` returned an empty list, succeeded, and the preloader
 * skipped the largest asset class in the game. Nothing rendered wrong, because
 * `terrain/textures.ts` reads the same file independently and reads it
 * correctly, so ten megabytes of baked terrain simply arrived after the
 * loading screen had already said "Ready". The bar was measuring the work it
 * knew about rather than the work there was.
 *
 * The pipeline's shape is now the shape this file is built around, and the
 * loose fallbacks stay underneath it for anything hand-written. Silence is what
 * let the mismatch ship, so a manifest that exists and yields nothing now says
 * so on the console, and `manifest.check.ts` runs the real file through this
 * parser on every `npm test` so the next shape change fails in CI rather than
 * in a player's loading bar.
 */

const MANIFEST_URL = '/assets/baked/manifest.json'
const DEFAULT_BASE = '/assets/baked/'

export type BakedTexture = {
  url: string
  /** Byte size on disk, used to weight the progress bar. */
  bytes?: number
}

export type BakedManifest = {
  textures: BakedTexture[]
  /** Sum of every known `bytes`. Zero when the manifest carries no sizes. */
  bytes: number
}

const EMPTY: BakedManifest = { textures: [], bytes: 0 }

const totalled = (textures: BakedTexture[]): BakedManifest => ({
  textures,
  bytes: textures.reduce((sum, texture) => sum + (texture.bytes ?? 0), 0),
})

const resolve = (file: string, basePath: string) =>
  file.startsWith('/') || file.startsWith('http') ? file : `${basePath}${file.replace(/^\.?\//, '')}`

const asTexture = (value: unknown, basePath: string): BakedTexture | null => {
  if (typeof value === 'string') return value ? { url: resolve(value, basePath) } : null
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const file = record.file ?? record.url ?? record.path ?? record.src
  if (typeof file !== 'string' || !file) return null
  const bytes = typeof record.bytes === 'number' ? record.bytes : typeof record.size === 'number' ? record.size : undefined
  return { url: resolve(file, basePath), bytes }
}

/**
 * The pipeline shape: `materials` keyed by id, each carrying a `textures` map
 * of slot to entry. `preload` lists the same files in the order the pipeline
 * wants them warmed, so it drives ordering, while `materials` supplies the byte
 * counts that `preload` does not carry.
 */
const parsePipeline = (payload: Record<string, unknown>): BakedManifest | null => {
  const materials = payload.materials
  if (!materials || typeof materials !== 'object') return null
  const basePath = typeof payload.basePath === 'string' && payload.basePath ? payload.basePath : DEFAULT_BASE

  const byUrl = new Map<string, BakedTexture>()
  for (const material of Object.values(materials as Record<string, unknown>)) {
    if (!material || typeof material !== 'object') continue
    const slots = (material as Record<string, unknown>).textures
    if (!slots || typeof slots !== 'object') continue
    for (const slot of Object.values(slots as Record<string, unknown>)) {
      const texture = asTexture(slot, basePath)
      // An atlassed slot points several materials at one file. Keeping the
      // first occurrence counts those bytes once rather than once per material,
      // which would inflate the total the bar divides by.
      if (texture && !byUrl.has(texture.url)) byUrl.set(texture.url, texture)
    }
  }

  const preload = Array.isArray(payload.preload) ? payload.preload : []
  const ordered: BakedTexture[] = []
  for (const entry of preload) {
    if (typeof entry !== 'string') continue
    const url = resolve(entry, basePath)
    const known = byUrl.get(url)
    ordered.push(known ?? { url })
    byUrl.delete(url)
  }
  for (const texture of byUrl.values()) ordered.push(texture)

  return ordered.length ? totalled(ordered) : null
}

/** Anything hand-written: a bare array, or a single list under an obvious key. */
const parseLoose = (payload: unknown): BakedManifest => {
  const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : undefined
  const basePath = typeof record?.basePath === 'string' && record.basePath ? record.basePath : DEFAULT_BASE
  const list = Array.isArray(payload) ? payload : record ? (record.textures ?? record.entries ?? record.assets ?? record.preload) : null
  if (!Array.isArray(list)) return EMPTY
  const textures: BakedTexture[] = []
  for (const entry of list) {
    const texture = asTexture(entry, basePath)
    if (texture) textures.push(texture)
  }
  return totalled(textures)
}

export const parseBakedManifest = (payload: unknown): BakedManifest => {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const pipeline = parsePipeline(payload as Record<string, unknown>)
    if (pipeline) return pipeline
  }
  const loose = parseLoose(payload)
  // A manifest that exists but yields nothing looks identical to no manifest at
  // all, and looking identical is exactly how the last mismatch survived. It is
  // still not fatal at runtime -- terrain reads the file itself, so the game
  // runs either way -- but "the file is there and I understood none of it" now
  // reaches the console instead of quietly costing the player a warm cache.
  // The fatal version lives in `manifest.check.ts`, where it belongs.
  if (!loose.textures.length && payload) console.error('[manifest] baked manifest parsed to zero textures; preload will skip them', payload)
  return loose
}

let cached: Promise<BakedManifest> | undefined

export const loadBakedManifest = (): Promise<BakedManifest> => (cached ??= (async () => {
  try {
    const response = await fetch(MANIFEST_URL, { cache: 'force-cache' })
    if (!response.ok) return EMPTY
    // A dev server that rewrites unknown paths to index.html would otherwise
    // hand us HTML and throw inside JSON.parse.
    const type = response.headers.get('content-type') ?? ''
    if (!type.includes('json')) return EMPTY
    return parseBakedManifest(await response.json())
  } catch {
    return EMPTY
  }
})())
