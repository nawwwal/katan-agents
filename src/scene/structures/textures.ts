import * as THREE from 'three'

// Procedural canvas textures for the game pieces. Everything is generated once,
// keyed by name, and cached for the life of the page. Every random draw comes
// from a seeded generator so the same board always bakes the same pixels.

type Rng = () => number

export const makeRng = (seed: number): Rng => {
  let value = seed >>> 0
  return () => {
    value += 0x6d2b79f5
    let t = value
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const hashString = (input: string): number => {
  let hash = 2166136261
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

const surface = (size: number) => {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) throw new Error('2d canvas context unavailable')
  return { canvas, context }
}

const finish = (canvas: HTMLCanvasElement, repeat = 1, srgb = true) => {
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(repeat, repeat)
  texture.anisotropy = 16
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

/** Sobel a greyscale height canvas into a tangent-space normal map. */
const normalFromHeight = (height: HTMLCanvasElement, strength: number) => {
  const size = height.width
  const source = height.getContext('2d')
  if (!source) throw new Error('2d canvas context unavailable')
  const data = source.getImageData(0, 0, size, size).data
  const { canvas, context } = surface(size)
  const out = context.createImageData(size, size)
  const at = (x: number, y: number) => data[(((y + size) % size) * size + ((x + size) % size)) * 4] / 255
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (at(x - 1, y) - at(x + 1, y)) * strength
      const dy = (at(x, y - 1) - at(x, y + 1)) * strength
      const length = Math.hypot(dx, dy, 1)
      const index = (y * size + x) * 4
      out.data[index] = ((dx / length) * 0.5 + 0.5) * 255
      out.data[index + 1] = ((dy / length) * 0.5 + 0.5) * 255
      out.data[index + 2] = ((1 / length) * 0.5 + 0.5) * 255
      out.data[index + 3] = 255
    }
  }
  context.putImageData(out, 0, 0)
  return canvas
}

const speckle = (context: CanvasRenderingContext2D, size: number, random: Rng, count: number, alpha: number) => {
  for (let index = 0; index < count; index += 1) {
    const x = random() * size
    const y = random() * size
    const radius = 0.4 + random() * 1.9
    const shade = Math.floor(random() * 90)
    context.fillStyle = `rgba(${shade},${shade},${shade},${alpha * (0.3 + random() * 0.7)})`
    context.beginPath()
    context.arc(x, y, radius, 0, Math.PI * 2)
    context.fill()
  }
}

const mottle = (context: CanvasRenderingContext2D, size: number, random: Rng, count: number, alpha: number, light: boolean) => {
  for (let index = 0; index < count; index += 1) {
    const x = random() * size
    const y = random() * size
    const radius = size * (0.02 + random() * 0.08)
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius)
    const tone = light ? '255,250,238' : '48,40,30'
    gradient.addColorStop(0, `rgba(${tone},${alpha})`)
    gradient.addColorStop(1, `rgba(${tone},0)`)
    context.fillStyle = gradient
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2)
  }
}

export type SurfaceMaps = { map: THREE.Texture; normalMap: THREE.Texture; roughnessMap: THREE.Texture }

const mapCache = new Map<string, SurfaceMaps>()

const cached = (key: string, build: () => SurfaceMaps): SurfaceMaps => {
  const hit = mapCache.get(key)
  if (hit) return hit
  const made = build()
  mapCache.set(key, made)
  return made
}

type BlockOptions = {
  size: number
  rows: number
  columns: number
  base: [number, number, number]
  mortar: string
  jitter: number
  bevel: number
  stagger: boolean
  round: number
  seed: number
  roughRange: [number, number]
}

/** Shared builder for masonry, cobble kerbs and stacked quay stone. */
const blockMaps = (options: BlockOptions): SurfaceMaps => {
  const { size, rows, columns, base, mortar, jitter, bevel, stagger, round, seed, roughRange } = options
  const random = makeRng(seed)
  const albedo = surface(size)
  const height = surface(size)
  const rough = surface(size)
  albedo.context.fillStyle = mortar
  albedo.context.fillRect(0, 0, size, size)
  height.context.fillStyle = '#101010'
  height.context.fillRect(0, 0, size, size)
  rough.context.fillStyle = `rgb(${Math.round(roughRange[1] * 255)},${Math.round(roughRange[1] * 255)},${Math.round(roughRange[1] * 255)})`
  rough.context.fillRect(0, 0, size, size)

  const rowHeight = size / rows
  const columnWidth = size / columns
  const roundedRect = (context: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
    context.beginPath()
    context.moveTo(x + r, y)
    context.arcTo(x + w, y, x + w, y + h, r)
    context.arcTo(x + w, y + h, x, y + h, r)
    context.arcTo(x, y + h, x, y, r)
    context.arcTo(x, y, x + w, y, r)
    context.closePath()
  }

  for (let row = 0; row < rows; row += 1) {
    const offset = stagger && row % 2 === 1 ? columnWidth / 2 : 0
    for (let column = -1; column <= columns; column += 1) {
      const wobble = (random() - 0.5) * columnWidth * 0.14
      const x = column * columnWidth + offset + bevel + wobble
      const y = row * rowHeight + bevel + (random() - 0.5) * rowHeight * 0.08
      const w = columnWidth - bevel * 2
      const h = rowHeight - bevel * 2
      const shade = 1 + (random() - 0.5) * jitter
      const color = base.map((channel) => Math.max(0, Math.min(255, Math.round(channel * shade))))
      albedo.context.fillStyle = `rgb(${color[0]},${color[1]},${color[2]})`
      roundedRect(albedo.context, x, y, w, h, round)
      albedo.context.fill()
      const lift = Math.round(150 + random() * 70)
      height.context.fillStyle = `rgb(${lift},${lift},${lift})`
      roundedRect(height.context, x, y, w, h, round)
      height.context.fill()
      const wear = roughRange[0] + random() * (roughRange[1] - roughRange[0])
      const wearByte = Math.round(wear * 255)
      rough.context.fillStyle = `rgb(${wearByte},${wearByte},${wearByte})`
      roundedRect(rough.context, x, y, w, h, round)
      rough.context.fill()
    }
  }
  speckle(albedo.context, size, random, size * 6, 0.16)
  mottle(albedo.context, size, random, 26, 0.14, false)
  mottle(albedo.context, size, random, 18, 0.12, true)
  speckle(height.context, size, random, size * 3, 0.1)
  return {
    map: finish(albedo.canvas),
    normalMap: finish(normalFromHeight(height.canvas, 2.6), 1, false),
    roughnessMap: finish(rough.canvas, 1, false),
  }
}

export const masonryMaps = () => cached('masonry', () => blockMaps({
  size: 512, rows: 9, columns: 7, base: [205, 190, 160], mortar: '#8b8069', jitter: 0.16,
  bevel: 3, stagger: true, round: 3, seed: 11, roughRange: [0.62, 0.92],
}))

export const cobbleMaps = () => cached('cobble', () => blockMaps({
  size: 512, rows: 16, columns: 16, base: [186, 176, 152], mortar: '#6d6350', jitter: 0.22,
  bevel: 4, stagger: true, round: 7, seed: 29, roughRange: [0.55, 0.9],
}))

export const quayMaps = () => cached('quay', () => blockMaps({
  size: 512, rows: 7, columns: 6, base: [126, 128, 126], mortar: '#4c4b46', jitter: 0.2,
  bevel: 4, stagger: true, round: 5, seed: 71, roughRange: [0.7, 0.95],
}))

export const plasterMaps = () => cached('plaster', () => {
  const size = 512
  const random = makeRng(53)
  const albedo = surface(size)
  const height = surface(size)
  const rough = surface(size)
  albedo.context.fillStyle = '#e2d6b8'
  albedo.context.fillRect(0, 0, size, size)
  mottle(albedo.context, size, random, 90, 0.16, false)
  mottle(albedo.context, size, random, 70, 0.2, true)
  speckle(albedo.context, size, random, size * 4, 0.08)
  height.context.fillStyle = '#909090'
  height.context.fillRect(0, 0, size, size)
  // Chipped plaster reveals the coarse render underneath.
  for (let index = 0; index < 40; index += 1) {
    const x = random() * size
    const y = random() * size
    const radius = 3 + random() * 12
    height.context.fillStyle = `rgba(40,40,40,${0.35 + random() * 0.4})`
    height.context.beginPath()
    height.context.arc(x, y, radius, 0, Math.PI * 2)
    height.context.fill()
    albedo.context.fillStyle = `rgba(150,136,110,${0.25 + random() * 0.3})`
    albedo.context.beginPath()
    albedo.context.arc(x, y, radius, 0, Math.PI * 2)
    albedo.context.fill()
  }
  speckle(height.context, size, random, size * 5, 0.14)
  rough.context.fillStyle = '#d8d8d8'
  rough.context.fillRect(0, 0, size, size)
  mottle(rough.context, size, random, 40, 0.2, false)
  return {
    map: finish(albedo.canvas),
    normalMap: finish(normalFromHeight(height.canvas, 1.4), 1, false),
    roughnessMap: finish(rough.canvas, 1, false),
  }
})

/** Barrel roof tiles. Base is near-white so a player colour can tint it. */
export const roofMaps = () => cached('roof', () => {
  const size = 512
  const random = makeRng(97)
  const albedo = surface(size)
  const height = surface(size)
  const rough = surface(size)
  albedo.context.fillStyle = '#4a3126'
  albedo.context.fillRect(0, 0, size, size)
  height.context.fillStyle = '#202020'
  height.context.fillRect(0, 0, size, size)
  rough.context.fillStyle = '#c0c0c0'
  rough.context.fillRect(0, 0, size, size)
  const rows = 11
  const columns = 13
  const rowHeight = size / rows
  const columnWidth = size / columns
  for (let row = 0; row < rows; row += 1) {
    const offset = row % 2 === 1 ? columnWidth / 2 : 0
    for (let column = -1; column <= columns; column += 1) {
      const x = column * columnWidth + offset
      const y = row * rowHeight
      const shade = 0.82 + random() * 0.36
      const gradient = albedo.context.createLinearGradient(x, 0, x + columnWidth, 0)
      const tone = (factor: number) => {
        const r = Math.min(255, Math.round(236 * shade * factor))
        const g = Math.min(255, Math.round(228 * shade * factor))
        const b = Math.min(255, Math.round(214 * shade * factor))
        return `rgb(${r},${g},${b})`
      }
      gradient.addColorStop(0, tone(0.6))
      gradient.addColorStop(0.42, tone(1.05))
      gradient.addColorStop(1, tone(0.68))
      albedo.context.fillStyle = gradient
      albedo.context.fillRect(x + 1, y, columnWidth - 1.5, rowHeight * 1.06)
      const relief = height.context.createLinearGradient(x, 0, x + columnWidth, 0)
      relief.addColorStop(0, '#3a3a3a')
      relief.addColorStop(0.45, '#e8e8e8')
      relief.addColorStop(1, '#404040')
      height.context.fillStyle = relief
      height.context.fillRect(x + 1, y, columnWidth - 1.5, rowHeight * 1.06)
      // Shadow line under each course.
      height.context.fillStyle = 'rgba(0,0,0,0.75)'
      height.context.fillRect(x, y + rowHeight * 0.94, columnWidth, rowHeight * 0.12)
      albedo.context.fillStyle = 'rgba(60,40,28,0.30)'
      albedo.context.fillRect(x, y + rowHeight * 0.92, columnWidth, rowHeight * 0.14)
    }
  }
  mottle(albedo.context, size, random, 40, 0.18, false)
  speckle(albedo.context, size, random, size * 3, 0.1)
  return {
    map: finish(albedo.canvas),
    normalMap: finish(normalFromHeight(height.canvas, 2.2), 1, false),
    roughnessMap: finish(rough.canvas, 1, false),
  }
})

export const timberMaps = () => cached('timber', () => {
  const size = 512
  const random = makeRng(131)
  const albedo = surface(size)
  const height = surface(size)
  const rough = surface(size)
  albedo.context.fillStyle = '#6a4c30'
  albedo.context.fillRect(0, 0, size, size)
  height.context.fillStyle = '#8a8a8a'
  height.context.fillRect(0, 0, size, size)
  for (let index = 0; index < 260; index += 1) {
    const y = random() * size
    const thickness = 0.6 + random() * 2.6
    const shade = 0.6 + random() * 0.75
    albedo.context.strokeStyle = `rgba(${Math.round(96 * shade)},${Math.round(68 * shade)},${Math.round(42 * shade)},${0.35 + random() * 0.45})`
    albedo.context.lineWidth = thickness
    albedo.context.beginPath()
    albedo.context.moveTo(0, y)
    for (let x = 0; x <= size; x += 32) albedo.context.lineTo(x, y + Math.sin((x / size) * Math.PI * (1 + random())) * 3)
    albedo.context.stroke()
    height.context.strokeStyle = `rgba(20,20,20,${0.18 + random() * 0.3})`
    height.context.lineWidth = thickness
    height.context.stroke()
  }
  mottle(albedo.context, size, random, 30, 0.16, false)
  rough.context.fillStyle = '#cccccc'
  rough.context.fillRect(0, 0, size, size)
  mottle(rough.context, size, random, 30, 0.22, true)
  return {
    map: finish(albedo.canvas),
    normalMap: finish(normalFromHeight(height.canvas, 1.5), 1, false),
    roughnessMap: finish(rough.canvas, 1, false),
  }
})

export const plankMaps = () => cached('plank', () => {
  const size = 512
  const random = makeRng(211)
  const albedo = surface(size)
  const height = surface(size)
  const rough = surface(size)
  albedo.context.fillStyle = '#463122'
  albedo.context.fillRect(0, 0, size, size)
  height.context.fillStyle = '#8c8c8c'
  height.context.fillRect(0, 0, size, size)
  const planks = 7
  const plankHeight = size / planks
  for (let index = 0; index < planks; index += 1) {
    const y = index * plankHeight
    const shade = 0.78 + random() * 0.42
    albedo.context.fillStyle = `rgb(${Math.round(118 * shade)},${Math.round(88 * shade)},${Math.round(60 * shade)})`
    albedo.context.fillRect(0, y + 1.5, size, plankHeight - 3)
    height.context.fillStyle = '#d8d8d8'
    height.context.fillRect(0, y + 1.5, size, plankHeight - 3)
    for (let grain = 0; grain < 26; grain += 1) {
      const gy = y + 2 + random() * (plankHeight - 5)
      albedo.context.strokeStyle = `rgba(58,40,26,${0.14 + random() * 0.3})`
      albedo.context.lineWidth = 0.6 + random() * 1.6
      albedo.context.beginPath()
      albedo.context.moveTo(0, gy)
      for (let x = 0; x <= size; x += 40) albedo.context.lineTo(x, gy + Math.sin(x * 0.02 + index) * 1.6)
      albedo.context.stroke()
    }
    // Nail heads at the plank ends.
    for (const nx of [size * 0.06, size * 0.94]) {
      albedo.context.fillStyle = 'rgba(38,32,28,0.85)'
      albedo.context.beginPath()
      albedo.context.arc(nx, y + plankHeight / 2, 3, 0, Math.PI * 2)
      albedo.context.fill()
    }
  }
  speckle(albedo.context, size, random, size * 2, 0.1)
  rough.context.fillStyle = '#d0d0d0'
  rough.context.fillRect(0, 0, size, size)
  mottle(rough.context, size, random, 26, 0.24, true)
  return {
    map: finish(albedo.canvas),
    normalMap: finish(normalFromHeight(height.canvas, 1.8), 1, false),
    roughnessMap: finish(rough.canvas, 1, false),
  }
})

export const gravelMaps = () => cached('gravel', () => {
  const size = 512
  const random = makeRng(307)
  const albedo = surface(size)
  const height = surface(size)
  const rough = surface(size)
  albedo.context.fillStyle = '#b09872'
  albedo.context.fillRect(0, 0, size, size)
  height.context.fillStyle = '#6a6a6a'
  height.context.fillRect(0, 0, size, size)
  for (let index = 0; index < 2600; index += 1) {
    const x = random() * size
    const y = random() * size
    const radius = 0.8 + random() * 3.4
    const shade = 0.7 + random() * 0.6
    albedo.context.fillStyle = `rgb(${Math.round(196 * shade)},${Math.round(176 * shade)},${Math.round(142 * shade)})`
    albedo.context.beginPath()
    albedo.context.arc(x, y, radius, 0, Math.PI * 2)
    albedo.context.fill()
    const lift = Math.round(110 + random() * 120)
    height.context.fillStyle = `rgb(${lift},${lift},${lift})`
    height.context.beginPath()
    height.context.arc(x, y, radius, 0, Math.PI * 2)
    height.context.fill()
  }
  mottle(albedo.context, size, random, 40, 0.16, false)
  rough.context.fillStyle = '#efefef'
  rough.context.fillRect(0, 0, size, size)
  return {
    map: finish(albedo.canvas),
    normalMap: finish(normalFromHeight(height.canvas, 2.2), 1, false),
    roughnessMap: finish(rough.canvas, 1, false),
  }
})

/** Woven cloth, near-white so the player colour reads straight off the tint. */
export const clothMaps = () => cached('cloth', () => {
  const size = 256
  const random = makeRng(401)
  const albedo = surface(size)
  const height = surface(size)
  const rough = surface(size)
  albedo.context.fillStyle = '#f2ede2'
  albedo.context.fillRect(0, 0, size, size)
  height.context.fillStyle = '#888888'
  height.context.fillRect(0, 0, size, size)
  for (let index = 0; index < size; index += 3) {
    albedo.context.strokeStyle = `rgba(120,112,98,${0.05 + random() * 0.08})`
    albedo.context.lineWidth = 1
    albedo.context.beginPath()
    albedo.context.moveTo(index, 0)
    albedo.context.lineTo(index, size)
    albedo.context.moveTo(0, index)
    albedo.context.lineTo(size, index)
    albedo.context.stroke()
    height.context.strokeStyle = `rgba(40,40,40,${0.1 + random() * 0.12})`
    height.context.stroke()
  }
  mottle(albedo.context, size, random, 22, 0.1, false)
  rough.context.fillStyle = '#f4f4f4'
  rough.context.fillRect(0, 0, size, size)
  return {
    map: finish(albedo.canvas),
    normalMap: finish(normalFromHeight(height.canvas, 1.1), 1, false),
    roughnessMap: finish(rough.canvas, 1, false),
  }
})

const faceCache = new Map<number, SurfaceMaps>()

/** Engraved number-token face: painted numeral plus probability pips. */
export const tokenFaceMaps = (value: number): SurfaceMaps => {
  const hit = faceCache.get(value)
  if (hit) return hit
  const size = 512
  const random = makeRng(1000 + value)
  const hot = value === 6 || value === 8
  const albedo = surface(size)
  const height = surface(size)
  const rough = surface(size)
  const centre = size / 2

  const stone = albedo.context.createRadialGradient(centre, centre * 0.8, size * 0.05, centre, centre, size * 0.55)
  stone.addColorStop(0, '#f2e7cb')
  stone.addColorStop(0.7, '#e3d5b3')
  stone.addColorStop(1, '#c9b892')
  albedo.context.fillStyle = stone
  albedo.context.fillRect(0, 0, size, size)
  mottle(albedo.context, size, random, 46, 0.12, false)
  mottle(albedo.context, size, random, 30, 0.14, true)
  speckle(albedo.context, size, random, size * 3, 0.07)
  // Hairline crazing in the glaze.
  for (let index = 0; index < 26; index += 1) {
    albedo.context.strokeStyle = `rgba(120,104,78,${0.08 + random() * 0.12})`
    albedo.context.lineWidth = 0.7
    albedo.context.beginPath()
    let x = random() * size
    let y = random() * size
    albedo.context.moveTo(x, y)
    for (let step = 0; step < 5; step += 1) {
      x += (random() - 0.5) * 90
      y += (random() - 0.5) * 90
      albedo.context.lineTo(x, y)
    }
    albedo.context.stroke()
  }

  height.context.fillStyle = '#b4b4b4'
  height.context.fillRect(0, 0, size, size)
  speckle(height.context, size, random, size * 2, 0.08)
  rough.context.fillStyle = '#d2d2d2'
  rough.context.fillRect(0, 0, size, size)

  // Engraved inner circle.
  height.context.strokeStyle = '#4a4a4a'
  height.context.lineWidth = 7
  height.context.beginPath()
  height.context.arc(centre, centre, size * 0.41, 0, Math.PI * 2)
  height.context.stroke()
  albedo.context.strokeStyle = 'rgba(112,94,66,0.55)'
  albedo.context.lineWidth = 7
  albedo.context.beginPath()
  albedo.context.arc(centre, centre, size * 0.41, 0, Math.PI * 2)
  albedo.context.stroke()

  const ink = hot ? '#8e2317' : '#332417'
  const numeral = String(value)
  albedo.context.textAlign = 'center'
  albedo.context.textBaseline = 'middle'
  albedo.context.font = `700 ${size * 0.5}px "Times New Roman", Georgia, serif`
  // Chisel shadow, then the painted face of the numeral.
  albedo.context.fillStyle = 'rgba(255,250,232,0.75)'
  albedo.context.fillText(numeral, centre + 5, centre - 30 + 5)
  albedo.context.fillStyle = ink
  albedo.context.fillText(numeral, centre, centre - 34)
  height.context.textAlign = 'center'
  height.context.textBaseline = 'middle'
  height.context.font = albedo.context.font
  height.context.fillStyle = '#3a3a3a'
  height.context.fillText(numeral, centre, centre - 34)
  rough.context.textAlign = 'center'
  rough.context.textBaseline = 'middle'
  rough.context.font = albedo.context.font
  rough.context.fillStyle = '#7a7a7a'
  rough.context.fillText(numeral, centre, centre - 34)

  const pips = 6 - Math.abs(7 - value)
  const pipRadius = size * 0.019
  const spacing = pipRadius * 3.1
  const start = centre - ((pips - 1) * spacing) / 2
  for (let index = 0; index < pips; index += 1) {
    const x = start + index * spacing
    const y = centre + size * 0.29
    albedo.context.fillStyle = ink
    albedo.context.beginPath()
    albedo.context.arc(x, y, pipRadius, 0, Math.PI * 2)
    albedo.context.fill()
    height.context.fillStyle = '#3c3c3c'
    height.context.beginPath()
    height.context.arc(x, y, pipRadius, 0, Math.PI * 2)
    height.context.fill()
  }

  const maps: SurfaceMaps = {
    map: finish(albedo.canvas),
    normalMap: finish(normalFromHeight(height.canvas, 2.4), 1, false),
    roughnessMap: finish(rough.canvas, 1, false),
  }
  faceCache.set(value, maps)
  return maps
}

const signCache = new Map<string, SurfaceMaps>()

const RESOURCE_GLYPH: Record<string, string> = {
  brick: 'BRICK',
  lumber: 'LUMBER',
  ore: 'ORE',
  grain: 'GRAIN',
  wool: 'WOOL',
}

/** Painted harbour trade board: ratio on top, cargo name burnt underneath. */
export const harborSignMaps = (ratio: number, resource?: string): SurfaceMaps => {
  const key = `${ratio}:${resource ?? 'any'}`
  const hit = signCache.get(key)
  if (hit) return hit
  // Large for a small object: this is the one place on the board where a
  // player has to read glyphs at distance, and mip filtering eats thin serifs.
  const width = 1024
  const heightPx = 512
  const random = makeRng(hashString(key))
  const canvasOf = () => {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = heightPx
    const context = canvas.getContext('2d')
    if (!context) throw new Error('2d canvas context unavailable')
    return { canvas, context }
  }
  const albedo = canvasOf()
  const relief = canvasOf()
  const rough = canvasOf()
  albedo.context.fillStyle = '#6b4b2e'
  albedo.context.fillRect(0, 0, width, heightPx)
  relief.context.fillStyle = '#9a9a9a'
  relief.context.fillRect(0, 0, width, heightPx)
  rough.context.fillStyle = '#d6d6d6'
  rough.context.fillRect(0, 0, width, heightPx)
  for (let index = 0; index < 4; index += 1) {
    const y = (index * heightPx) / 4
    const shade = 0.82 + random() * 0.4
    albedo.context.fillStyle = `rgb(${Math.round(126 * shade)},${Math.round(92 * shade)},${Math.round(58 * shade)})`
    albedo.context.fillRect(0, y + 1, width, heightPx / 4 - 2)
    for (let grain = 0; grain < 22; grain += 1) {
      albedo.context.strokeStyle = `rgba(60,42,26,${0.1 + random() * 0.22})`
      albedo.context.lineWidth = 1
      const gy = y + random() * (heightPx / 4)
      albedo.context.beginPath()
      albedo.context.moveTo(0, gy)
      albedo.context.lineTo(width, gy + (random() - 0.5) * 6)
      albedo.context.stroke()
    }
  }
  // Dark plaque behind the ratio, so pale paint on mid-brown wood still has a
  // value step at the distance the board is actually read from.
  albedo.context.fillStyle = 'rgba(34,22,12,0.72)'
  albedo.context.fillRect(width * 0.1, heightPx * 0.08, width * 0.8, heightPx * 0.52)
  albedo.context.textAlign = 'center'
  albedo.context.textBaseline = 'middle'
  albedo.context.font = `700 ${heightPx * 0.44}px "Times New Roman", Georgia, serif`
  albedo.context.fillStyle = 'rgba(20,12,6,0.55)'
  albedo.context.fillText(`${ratio}:1`, width / 2 + 4, heightPx * 0.34 + 4)
  albedo.context.fillStyle = '#ffeec4'
  albedo.context.fillText(`${ratio}:1`, width / 2, heightPx * 0.34)
  albedo.context.font = `600 ${heightPx * 0.17}px "Times New Roman", Georgia, serif`
  albedo.context.fillStyle = '#e2c48d'
  albedo.context.fillText(resource ? RESOURCE_GLYPH[resource] ?? 'TRADE' : 'ANY GOODS', width / 2, heightPx * 0.78)
  relief.context.textAlign = 'center'
  relief.context.textBaseline = 'middle'
  relief.context.font = `700 ${heightPx * 0.44}px "Times New Roman", Georgia, serif`
  relief.context.fillStyle = '#3c3c3c'
  relief.context.fillText(`${ratio}:1`, width / 2, heightPx * 0.34)

  const asTexture = (canvas: HTMLCanvasElement, srgb: boolean) => {
    const texture = new THREE.CanvasTexture(canvas)
    texture.anisotropy = 16
    if (srgb) texture.colorSpace = THREE.SRGBColorSpace
    return texture
  }
  const maps: SurfaceMaps = {
    map: asTexture(albedo.canvas, true),
    normalMap: asTexture(normalFromHeight(relief.canvas, 1.6), false),
    roughnessMap: asTexture(rough.canvas, false),
  }
  signCache.set(key, maps)
  return maps
}

/** Soft radial falloff used by the placement halos. */
/**
 * Soft feathered band used as a baked contact shadow under ground pieces.
 * Opaque along the middle, falling off to nothing top and bottom, so a quad
 * stretched along a road or under a footing grounds it. This is deliberately
 * subtle: real cast shadows are coming, and these have to add to them rather
 * than double them.
 */
export const contactShadowTexture = (() => {
  let texture: THREE.Texture | null = null
  return () => {
    if (texture) return texture
    const size = 128
    const { canvas, context } = surface(size)
    const gradient = context.createLinearGradient(0, 0, 0, size)
    gradient.addColorStop(0, 'rgba(255,255,255,0)')
    gradient.addColorStop(0.22, 'rgba(255,255,255,0.34)')
    gradient.addColorStop(0.5, 'rgba(255,255,255,1)')
    gradient.addColorStop(0.78, 'rgba(255,255,255,0.34)')
    gradient.addColorStop(1, 'rgba(255,255,255,0)')
    context.fillStyle = gradient
    context.fillRect(0, 0, size, size)
    // Fade the two ends as well, so a road's shadow does not stop dead at the
    // junction where the next road's begins.
    const ends = context.createLinearGradient(0, 0, size, 0)
    ends.addColorStop(0, 'rgba(0,0,0,1)')
    ends.addColorStop(0.06, 'rgba(0,0,0,0)')
    ends.addColorStop(0.94, 'rgba(0,0,0,0)')
    ends.addColorStop(1, 'rgba(0,0,0,1)')
    context.globalCompositeOperation = 'destination-out'
    context.fillStyle = ends
    context.fillRect(0, 0, size, size)
    context.globalCompositeOperation = 'source-over'
    // Consumed as an alpha map, so it stays in linear space.
    texture = new THREE.CanvasTexture(canvas)
    texture.anisotropy = 8
    return texture
  }
})()

export const haloTexture = (() => {
  let texture: THREE.Texture | null = null
  return () => {
    if (texture) return texture
    const size = 256
    const { canvas, context } = surface(size)
    const gradient = context.createRadialGradient(size / 2, size / 2, size * 0.18, size / 2, size / 2, size * 0.5)
    gradient.addColorStop(0, 'rgba(255,255,255,0)')
    gradient.addColorStop(0.68, 'rgba(255,255,255,0.06)')
    gradient.addColorStop(0.86, 'rgba(255,255,255,0.9)')
    gradient.addColorStop(0.94, 'rgba(255,255,255,0.55)')
    gradient.addColorStop(1, 'rgba(255,255,255,0)')
    context.fillStyle = gradient
    context.fillRect(0, 0, size, size)
    texture = finish(canvas)
    return texture
  }
})()
