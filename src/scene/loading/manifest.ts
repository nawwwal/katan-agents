/**
 * The baked-texture manifest, if the bake pipeline has produced one.
 *
 * `public/assets/baked/manifest.json` is written by a separate bake step that
 * may or may not have run. Everything here is written so that a missing,
 * empty or differently-shaped manifest costs nothing: the loader simply has
 * fewer files to warm and the game starts exactly as before.
 */

const MANIFEST_URL = '/assets/baked/manifest.json'

export type BakedTexture = {
  url: string
  /** Rough byte size, used to weight the progress bar. Optional. */
  bytes?: number
}

export type BakedManifest = {
  textures: BakedTexture[]
}

const asTexture = (value: unknown): BakedTexture | null => {
  if (typeof value === 'string') return value.startsWith('/') || value.startsWith('http') ? { url: value } : { url: `/assets/baked/${value}` }
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const url = record.url ?? record.file ?? record.path ?? record.src
  if (typeof url !== 'string' || !url) return null
  const bytes = typeof record.bytes === 'number' ? record.bytes : typeof record.size === 'number' ? record.size : undefined
  return { url: url.startsWith('/') || url.startsWith('http') ? url : `/assets/baked/${url}`, bytes }
}

/**
 * Accepts every reasonable shape the bake step might emit -- a bare array, a
 * `{ textures: [...] }` object, or `{ entries: [...] }` -- because the loader
 * should not be the thing that breaks when a sibling tool changes its output.
 */
const parse = (payload: unknown): BakedManifest => {
  const list = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object'
      ? ((payload as Record<string, unknown>).textures ?? (payload as Record<string, unknown>).entries ?? (payload as Record<string, unknown>).assets)
      : null
  if (!Array.isArray(list)) return { textures: [] }
  const textures: BakedTexture[] = []
  for (const entry of list) {
    const texture = asTexture(entry)
    if (texture) textures.push(texture)
  }
  return { textures }
}

let cached: Promise<BakedManifest> | undefined

export const loadBakedManifest = (): Promise<BakedManifest> => (cached ??= (async () => {
  try {
    const response = await fetch(MANIFEST_URL, { cache: 'force-cache' })
    if (!response.ok) return { textures: [] }
    // A dev server that rewrites unknown paths to index.html would otherwise
    // hand us HTML and throw inside JSON.parse.
    const type = response.headers.get('content-type') ?? ''
    if (!type.includes('json')) return { textures: [] }
    return parse(await response.json())
  } catch {
    return { textures: [] }
  }
})())
