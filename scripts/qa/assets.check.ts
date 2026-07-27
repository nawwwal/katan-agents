/**
 * Tier 1: does every reference resolve to a real file?
 *
 * Sound ids, card art, resource glyphs and the baked texture manifest all name
 * paths under `public`. Whether those paths exist is a filesystem question, so
 * it is answered against the filesystem: a browser would only tell us the same
 * thing more slowly, and only for the assets that happened to be requested
 * during the run.
 */
import assert from 'node:assert/strict'
import { statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseBakedManifest } from '../../src/scene/loading/manifest'
import { SOUNDS, SOUND_IDS } from '../../src/audio/soundbank'
import { DEVELOPMENT_ART, RESOURCE_IMAGE } from '../../src/ui/gameVisuals'

const root = fileURLToPath(new URL('../../', import.meta.url))
const publicPath = (url: string) => `${root}public${url}`

const missing: string[] = []
const empty: string[] = []

const resolves = (url: string) => {
  if (!url.startsWith('/')) return
  try {
    const stats = statSync(publicPath(url))
    if (!stats.size) empty.push(url)
  } catch {
    missing.push(url)
  }
}

for (const id of SOUND_IDS) resolves(SOUNDS[id].file)
assert.equal(SOUND_IDS.length, new Set(SOUND_IDS.map((id) => SOUNDS[id].file)).size, 'two sound ids point at the same file')
for (const url of Object.values(RESOURCE_IMAGE)) resolves(url)
for (const url of Object.values(DEVELOPMENT_ART)) resolves(url)

// The baked manifest is optional. When it exists it has to parse to something,
// and everything it names has to be on disk, because the preloader weights its
// progress bar by those bytes.
let textures = 0
try {
  const raw = statSync(publicPath('/assets/baked/manifest.json'))
  assert.ok(raw.size, 'the baked manifest is empty')
  const payload = JSON.parse(await import('node:fs/promises').then((fs) => fs.readFile(publicPath('/assets/baked/manifest.json'), 'utf8')))
  const manifest = parseBakedManifest(payload)
  assert.ok(manifest.textures.length, 'the baked manifest exists but parses to no textures')
  textures = manifest.textures.length
  for (const texture of manifest.textures) resolves(texture.url)
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
}

assert.deepEqual(missing, [], `these referenced files are not on disk: ${missing.join(', ')}`)
assert.deepEqual(empty, [], `these referenced files are zero bytes: ${empty.join(', ')}`)

console.log(`asset check passed: ${SOUND_IDS.length} sounds, ${Object.keys(RESOURCE_IMAGE).length + Object.keys(DEVELOPMENT_ART).length} images, ${textures} baked textures all resolve`)
