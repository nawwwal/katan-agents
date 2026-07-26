// Contact sheet. Lays every baked map out as one image so the bake can be
// judged by eye rather than by byte count.
//
// Columns, left to right:
//   albedo          the shipped colour map
//   albedo x4       the same map tiled 2x2, which is how a seam shows up
//   normal          tangent space
//   occlusion       R channel of the ARH map
//   roughness       G channel of the ARH map
//   lit preview     albedo x occlusion, relit by the normal under the golden-hour
//                   key, which is the closest thing to how it will actually read
//
// Written to art/critique/bake-sheet.png.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const OUT = join(ROOT, 'public/assets/baked')

const CELL = 208
const GAP = 8
const LABEL = 128
const HEADER = 34
const COLUMNS = ['albedo', 'albedo x4', 'normal', 'occlusion', 'roughness', 'lit preview']

const raw = async (file, size) => {
  const { data } = await sharp(join(OUT, file)).resize(size, size, { kernel: 'lanczos3' }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  return data
}

const grey = (rgbData, channel) => {
  const n = rgbData.length / 3
  const out = Buffer.allocUnsafe(n * 3)
  for (let i = 0; i < n; i += 1) {
    const v = rgbData[i * 3 + channel]
    out[i * 3] = v; out[i * 3 + 1] = v; out[i * 3 + 2] = v
  }
  return out
}

/**
 * Relight the albedo with the baked maps under the golden-hour key from
 * STYLE_BIBLE (#FFD39D at [-8, 12, 5]) plus a cool sky fill. This is a preview
 * only — nothing directional is written into the shipped textures.
 */
const relight = (albedo, normal, arh, size) => {
  const n = size * size
  const out = Buffer.allocUnsafe(n * 3)
  const L = [-8, 12, 5]
  const len = Math.hypot(...L)
  const lx = L[0] / len; const ly = L[1] / len; const lz = L[2] / len
  const key = [1.0, 0.827, 0.616]
  const sky = [0.518, 0.788, 0.863]
  for (let i = 0; i < n; i += 1) {
    // Texture space: +x -> world +x, +y(normal) -> world +z, +z -> world up.
    const nx = (normal[i * 3] / 255) * 2 - 1
    const nz = (normal[i * 3 + 1] / 255) * 2 - 1
    const ny = (normal[i * 3 + 2] / 255) * 2 - 1
    const ndl = Math.max(0, nx * lx + ny * ly + nz * lz)
    const ao = arh[i * 3] / 255
    const up = Math.max(0, ny)
    for (let c = 0; c < 3; c += 1) {
      const base = Math.pow(albedo[i * 3 + c] / 255, 2.2)
      const lit = base * (key[c] * ndl * 2.1 + sky[c] * (0.18 + up * 0.22) * ao + 0.06 * ao)
      // ACES-ish shoulder, matching the runtime's tone mapping closely enough
      // that the preview is not misleadingly bright.
      const t = (lit * (2.51 * lit + 0.03)) / (lit * (2.43 * lit + 0.59) + 0.14)
      out[i * 3 + c] = Math.round(Math.min(1, Math.max(0, Math.pow(t, 1 / 2.2))) * 255)
    }
  }
  return out
}

const svgText = (text, w, h, size, weight, colour) => Buffer.from(
  `<svg width="${w}" height="${h}"><text x="0" y="${Math.round(h * 0.72)}" `
  + `font-family="Helvetica, Arial, sans-serif" font-size="${size}" font-weight="${weight}" `
  + `fill="${colour}">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text></svg>`,
)

export const buildSheet = async (manifest, target) => {
  const materials = Object.values(manifest.materials)
  const width = LABEL + COLUMNS.length * (CELL + GAP) + GAP
  const height = HEADER + materials.length * (CELL + GAP) + GAP

  const layers = []
  for (let c = 0; c < COLUMNS.length; c += 1) {
    layers.push({
      input: svgText(COLUMNS[c].toUpperCase(), CELL, HEADER, 15, 600, '#6d6a63'),
      left: LABEL + c * (CELL + GAP),
      top: 4,
    })
  }

  for (let r = 0; r < materials.length; r += 1) {
    const material = materials[r]
    const top = HEADER + r * (CELL + GAP)
    const albedo = await raw(material.textures.map.file, CELL)
    const normal = await raw(material.textures.normalMap.file, CELL)
    const arh = await raw(material.textures.arhMap.file, CELL)

    const tiled = await sharp(await sharp(join(OUT, material.textures.map.file))
      .resize(CELL / 2, CELL / 2, { kernel: 'lanczos3' }).png().toBuffer())
      .extend({ top: 0, bottom: CELL / 2, left: 0, right: CELL / 2, extendWith: 'repeat' })
      .png().toBuffer()

    const cells = [
      await sharp(albedo, { raw: { width: CELL, height: CELL, channels: 3 } }).png().toBuffer(),
      tiled,
      await sharp(normal, { raw: { width: CELL, height: CELL, channels: 3 } }).png().toBuffer(),
      await sharp(grey(arh, 0), { raw: { width: CELL, height: CELL, channels: 3 } }).png().toBuffer(),
      await sharp(grey(arh, 1), { raw: { width: CELL, height: CELL, channels: 3 } }).png().toBuffer(),
      await sharp(relight(albedo, normal, arh, CELL), { raw: { width: CELL, height: CELL, channels: 3 } }).png().toBuffer(),
    ]
    for (let c = 0; c < cells.length; c += 1) {
      layers.push({ input: cells[c], left: LABEL + c * (CELL + GAP), top })
    }

    const px = material.textures.map.size[0]
    layers.push({ input: svgText(material.id, LABEL - 10, 26, 17, 700, '#1d1b17'), left: 6, top: top + 8 })
    layers.push({ input: svgText(`${px}px`, LABEL - 10, 22, 13, 400, '#6d6a63'), left: 6, top: top + 32 })
    layers.push({ input: svgText(`${(material.bytes / 1024).toFixed(0)} kB`, LABEL - 10, 22, 13, 400, '#6d6a63'), left: 6, top: top + 52 })
    layers.push({ input: svgText(`ao ${material.meanOcclusion.toFixed(2)}`, LABEL - 10, 22, 13, 400, '#6d6a63'), left: 6, top: top + 72 })
  }

  await mkdir(dirname(target), { recursive: true })
  await sharp({ create: { width, height, channels: 3, background: '#e9e6e0' } })
    .composite(layers)
    .png({ compressionLevel: 9 })
    .toFile(target)
  return { width, height }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const manifest = JSON.parse(await readFile(join(OUT, 'manifest.json'), 'utf8'))
  const target = join(ROOT, 'art/critique/bake-sheet.png')
  const size = await buildSheet(manifest, target)
  console.log(`sheet: ${target} ${size.width}x${size.height}`)
}
