// One material per worker. Rasterise, derive, encode, write. Reporting the
// byte counts back lets the parent enforce the payload budget without reading
// the files again.

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { parentPort, workerData } from 'node:worker_threads'
import sharp from 'sharp'

import { TERRAIN_PAINTERS } from './terrain.mjs'
import { STRUCTURE_PAINTERS } from './structures.mjs'
import { downsample, encodeAlbedo, normalMap, occlusionMap, packArh, rasterise } from './render.mjs'

const PAINTERS = { ...TERRAIN_PAINTERS, ...STRUCTURE_PAINTERS }

const write = async (bytes, size, quality, path) => {
  await mkdir(dirname(path), { recursive: true })
  const buffer = await sharp(bytes, { raw: { width: size, height: size, channels: 3 } })
    .webp({ quality, effort: 6, smartSubsample: false, alphaQuality: 100 })
    .toBuffer()
  await writeFile(path, buffer)
  return buffer.length
}

const run = async () => {
  const { material, outDir } = workerData
  const painter = PAINTERS[material.painter]
  if (!painter) throw new Error(`No painter registered for "${material.painter}"`)

  const started = Date.now()
  const raster = rasterise(painter, material.albedo)

  const albedoBytes = encodeAlbedo(raster.linear, material.albedo)
  const normalBytes = normalMap(raster.height, material.albedo, material.normal, material.relief)

  const arhSize = material.arh
  const heightSmall = downsample(raster.height, material.albedo, arhSize)
  const roughSmall = downsample(raster.rough, material.albedo, arhSize)
  const ao = occlusionMap(heightSmall, arhSize, material.relief, material.aoStrength)
  const arhBytes = packArh(ao, roughSmall, heightSmall, arhSize)

  const base = join(outDir, material.group, material.id)
  const files = {
    map: { file: `${material.group}/${material.id}-albedo.webp`, size: material.albedo },
    normalMap: { file: `${material.group}/${material.id}-normal.webp`, size: material.normal },
    arhMap: { file: `${material.group}/${material.id}-arh.webp`, size: material.arh },
  }
  files.map.bytes = await write(albedoBytes, material.albedo, material.quality.albedo, `${base}-albedo.webp`)
  files.normalMap.bytes = await write(normalBytes, material.normal, material.quality.normal, `${base}-normal.webp`)
  files.arhMap.bytes = await write(arhBytes, material.arh, material.quality.arh, `${base}-arh.webp`)

  // Mean occlusion is a useful sanity number: a map that comes back at 0.99 has
  // a height field too flat to be doing anything.
  let aoSum = 0
  for (let i = 0; i < ao.length; i += 1) aoSum += ao[i]

  parentPort.postMessage({
    id: material.id,
    files,
    ms: Date.now() - started,
    meanAo: aoSum / ao.length,
  })
}

run().catch((error) => {
  parentPort.postMessage({ error: error.stack ?? String(error) })
})
