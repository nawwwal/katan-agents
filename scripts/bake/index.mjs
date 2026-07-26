#!/usr/bin/env node
// Offline asset bake. `npm run bake`.
//
//   npm run bake            regenerate anything whose inputs changed
//   npm run bake -- --force rebuild everything
//   npm run bake -- --only brick,ore
//   npm run bake -- --sheet only redraw the contact sheet from what is on disk
//
// Skip-if-unchanged is keyed on a hash of the pipeline source plus the
// material's config entry, so editing one painter rebakes one material and
// editing noise.mjs rebakes all of them. Nothing here reads the clock or an RNG,
// so two runs from the same source produce byte-identical files.

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { cpus } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'

import { BUDGET_BYTES, MATERIALS, PIPELINE_VERSION } from './config.mjs'
import { buildSheet } from './contact-sheet.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const OUT = join(ROOT, 'public/assets/baked')
const MANIFEST = join(OUT, 'manifest.json')

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(`--${name}`)
const value = (name) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : null
}

const sha = (input) => createHash('sha256').update(input).digest('hex').slice(0, 16)

// Only the files that determine pixels. The orchestrator and the contact sheet
// are deliberately excluded, so editing either does not invalidate 8 MB of
// textures that would come out byte-identical anyway.
const PIXEL_SOURCES = ['config.mjs', 'noise.mjs', 'palette.mjs', 'render.mjs', 'structures.mjs', 'terrain.mjs', 'worker.mjs']

/** Hash of every source file the baked pixels depend on. */
const pipelineHash = async () => {
  const present = new Set(await readdir(HERE))
  const names = PIXEL_SOURCES.filter((n) => present.has(n))
  const hash = createHash('sha256')
  hash.update(PIPELINE_VERSION)
  for (const name of names) {
    hash.update(name)
    hash.update(await readFile(join(HERE, name)))
  }
  return hash.digest('hex').slice(0, 16)
}

const runWorker = (material) => new Promise((resolveWorker, rejectWorker) => {
  const worker = new Worker(join(HERE, 'worker.mjs'), { workerData: { material, outDir: OUT } })
  let settled = false
  worker.on('message', (message) => {
    settled = true
    if (message.error) rejectWorker(new Error(`${material.id}: ${message.error}`))
    else resolveWorker(message)
  })
  worker.on('error', rejectWorker)
  worker.on('exit', (code) => {
    if (!settled) rejectWorker(new Error(`${material.id}: worker exited with ${code}`))
  })
})

/** Fixed-size worker pool. One material per slot; painters are CPU bound. */
const pool = async (items, limit, task) => {
  const results = new Array(items.length)
  let next = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next
      next += 1
      if (i >= items.length) return
      results[i] = await task(items[i], i)
    }
  })
  await Promise.all(runners)
  return results
}

const kb = (n) => `${(n / 1024).toFixed(0)} kB`

const main = async () => {
  const started = Date.now()
  await mkdir(OUT, { recursive: true })

  const base = await pipelineHash()
  const previous = existsSync(MANIFEST) ? JSON.parse(await readFile(MANIFEST, 'utf8')) : { materials: {} }

  const only = value('only')?.split(',').map((s) => s.trim()).filter(Boolean)
  const selected = only ? MATERIALS.filter((m) => only.includes(m.id)) : MATERIALS

  // --scale halves (or quarters) every resolution. Iteration aid only; the
  // shipped bake is always scale 1, and the scale is folded into the hash so a
  // preview bake can never masquerade as the real thing.
  const scale = Number(value('scale') ?? 1)
  if (!(scale > 0) || !Number.isInteger(1 / scale) && scale !== 1) throw new Error('--scale must be 1, 0.5, 0.25 ...')
  const planned = selected.map((source) => {
    const material = scale === 1 ? source : {
      ...source,
      albedo: Math.max(64, Math.round(source.albedo * scale)),
      normal: Math.max(32, Math.round(source.normal * scale)),
      arh: Math.max(32, Math.round(source.arh * scale)),
      scale,
    }
    return { material, hash: sha(`${base}|${JSON.stringify(material)}`) }
  })

  const stale = []
  const reused = []
  for (const entry of planned) {
    const prior = previous.materials?.[entry.material.id]
    const filesExist = prior && Object.values(prior.textures ?? {}).every((t) => existsSync(join(OUT, t.file)))
    if (!flag('force') && !flag('sheet') && prior?.hash === entry.hash && filesExist) reused.push({ entry, prior })
    else stale.push(entry)
  }

  if (flag('sheet')) {
    console.log('bake: --sheet, reusing everything on disk')
  }

  const concurrency = Math.max(1, Math.min(cpus().length - 1, stale.length))
  if (stale.length) {
    console.log(`bake: ${stale.length} material(s) to build on ${concurrency} worker(s), ${reused.length} reused`)
  } else {
    console.log(`bake: nothing to do, ${reused.length} material(s) up to date`)
  }

  const built = await pool(stale, concurrency, async ({ material, hash }) => {
    const result = await runWorker(material)
    const total = Object.values(result.files).reduce((s, f) => s + f.bytes, 0)
    console.log(
      `  ${material.id.padEnd(9)} ${String(material.albedo).padStart(4)}px  ${kb(total).padStart(8)}`
      + `  ao ${result.meanAo.toFixed(3)}  ${(result.ms / 1000).toFixed(1)}s`,
    )
    return { material, hash, result }
  })

  // ------------------------------------------------------------- manifest --
  const materials = {}
  for (const { entry, prior } of reused) materials[entry.material.id] = prior
  for (const { material, hash, result } of built) {
    const textures = {}
    for (const [channel, info] of Object.entries(result.files)) {
      textures[channel] = {
        file: info.file,
        size: [info.size, info.size],
        bytes: info.bytes,
        format: 'webp',
        colorSpace: channel === 'map' ? 'srgb' : 'linear',
        // Nothing is UV-atlased: every material below tiles with RepeatWrapping,
        // and a UV rect cannot wrap. The fields are here so a future atlas is a
        // manifest change and not a contract change.
        atlas: null,
        uvRect: [0, 0, 1, 1],
        ...(channel === 'normalMap' ? { encoding: 'tangent-space', handedness: 'opengl' } : {}),
        ...(channel === 'arhMap'
          ? { packing: { r: 'occlusion', g: 'roughness', b: 'height' }, note: 'do not bind as metalnessMap' }
          : {}),
      }
    }
    materials[material.id] = {
      id: material.id,
      group: material.group,
      hash,
      relief: material.relief,
      meanOcclusion: Number(result.meanAo.toFixed(4)),
      tiling: 'repeat',
      seamless: true,
      textures,
      runtime: material.runtime,
      bytes: Object.values(result.files).reduce((s, f) => s + f.bytes, 0),
    }
  }

  const ordered = {}
  for (const material of MATERIALS) if (materials[material.id]) ordered[material.id] = materials[material.id]

  const preload = []
  for (const material of Object.values(ordered)) {
    for (const texture of Object.values(material.textures)) preload.push(texture.file)
  }
  const totalBytes = Object.values(ordered).reduce((s, m) => s + m.bytes, 0)

  const manifest = {
    schema: 1,
    pipeline: { version: PIPELINE_VERSION, hash: base, generator: 'scripts/bake' },
    basePath: '/assets/baked/',
    // Documented contract for the loader. See art/bake-pipeline.md.
    contract: {
      map: 'THREE.SRGBColorSpace, material.map',
      normalMap: 'THREE.NoColorSpace, material.normalMap, OpenGL +Y, use runtime.normalScale',
      arhMap: 'THREE.NoColorSpace, bind the SAME texture to material.aoMap and material.roughnessMap, set texture.channel = 0. Leave metalnessMap unset.',
      wrapping: 'THREE.RepeatWrapping on S and T; every map is seamless',
      mipmaps: 'generateMipmaps = true, minFilter LinearMipmapLinear, anisotropy from runtime.anisotropy',
      lighting: 'terrain occlusion is baked; do not run SSAO on terrain and do not shadow-map the tile surfaces',
    },
    budget: { limitBytes: BUDGET_BYTES, usedBytes: totalBytes },
    preload,
    materials: ordered,
  }
  await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`)

  // Only redraw the sheet when something actually changed, so a no-op bake is
  // instant. `--sheet` forces it.
  if (built.length || flag('sheet')) {
    const sheet = join(ROOT, 'art/critique/bake-sheet.png')
    const sheetSize = await buildSheet(manifest, sheet)
    console.log(`bake: contact sheet ${sheetSize.width}x${sheetSize.height} -> art/critique/bake-sheet.png`)
  }

  const elapsed = (Date.now() - started) / 1000
  const pct = ((totalBytes / BUDGET_BYTES) * 100).toFixed(1)
  console.log(`bake: ${Object.keys(ordered).length} materials, ${(totalBytes / 1048576).toFixed(2)} MB of ${(BUDGET_BYTES / 1048576).toFixed(0)} MB (${pct}%), ${elapsed.toFixed(1)}s`)
  if (totalBytes > BUDGET_BYTES) {
    console.error(`bake: OVER BUDGET by ${kb(totalBytes - BUDGET_BYTES)}`)
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
