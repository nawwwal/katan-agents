import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseBakedManifest } from './manifest'

// The preloader and the bake pipeline agree on a file neither of them owns, and
// for a while they did not agree at all: the parser accepted a bare array or a
// `textures` key, the pipeline emitted `{ basePath, preload, materials }`, and
// the result was an empty list that looked exactly like "the bake never ran".
// Ten megabytes of terrain then downloaded after the loading screen had already
// said Ready, which is the one thing the loading screen exists to prevent.
//
// Nothing rendered wrong, so nothing complained. That is why this is a test
// rather than a runtime throw: the game genuinely does still run on a manifest
// it cannot read, so failing hard in the browser would punish the player for a
// build-step problem. Failing hard here punishes the build step instead.

const raw = JSON.parse(readFileSync(new URL('../../../public/assets/baked/manifest.json', import.meta.url), 'utf8'))
const manifest = parseBakedManifest(raw)

assert.ok(manifest.textures.length > 0, 'the shipped baked manifest parsed to zero textures')

// Every file the pipeline asks to be warmed has to survive the parse in order,
// or the preloader warms a different set from the one terrain will ask for.
const preload: string[] = Array.isArray(raw.preload) ? raw.preload.filter((entry: unknown) => typeof entry === 'string') : []
assert.ok(preload.length > 0, 'the shipped baked manifest carries no preload list')
preload.forEach((file, index) => {
  assert.equal(manifest.textures[index]?.url, `${raw.basePath}${file}`, `preload entry ${index} (${file}) is not where the parse put it`)
})

// No URL twice: an atlassed slot is shared by several materials and counting it
// once per material would inflate the total the progress bar divides by.
const urls = manifest.textures.map((texture) => texture.url)
assert.equal(new Set(urls).size, urls.length, 'the parsed manifest lists the same file more than once')

// The byte total is what weights the loading bar, so it has to be real rather
// than a plausible-looking zero.
assert.ok(manifest.bytes > 1_000_000, `parsed byte total is only ${manifest.bytes}`)
assert.equal(manifest.bytes, raw.budget.usedBytes, 'parsed byte total disagrees with the pipeline budget')

// The loose path still has to work for a hand-written file.
assert.equal(parseBakedManifest(['a.webp', { file: 'b.webp', bytes: 12 }]).textures.length, 2, 'the loose fallback stopped accepting a bare array')
assert.equal(parseBakedManifest(undefined).textures.length, 0, 'a missing manifest should parse to nothing rather than throw')

console.log(`baked manifest: ${manifest.textures.length} textures, ${(manifest.bytes / 1_048_576).toFixed(2)} MB, ${preload.length} in preload order`)
