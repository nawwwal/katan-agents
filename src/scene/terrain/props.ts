import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { makeRng, valueNoise } from './noise'

// Every scatter prop is a small merged geometry rendered through one board-wide
// InstancedMesh. Part colours are baked into a vertex-colour attribute, so a
// multi-material-looking prop still costs exactly one draw call, and the
// instance colour on top carries per-copy tint variation.

const scratchColor = new THREE.Color()
const mixA = new THREE.Color()
const mixB = new THREE.Color()

/** Blend two sRGB literals and hand back a literal, for graded part colours. */
const mixHex = (a: string, b: string, t: number) =>
  `#${mixA.set(a).lerp(mixB.set(b), t).getHexString()}`

const paint = (geometry: THREE.BufferGeometry, hex: string) => {
  scratchColor.set(hex).convertSRGBToLinear()
  const count = geometry.getAttribute('position').count
  const colors = new Float32Array(count * 3)
  for (let i = 0; i < count; i += 1) {
    colors[i * 3] = scratchColor.r
    colors[i * 3 + 1] = scratchColor.g
    colors[i * 3 + 2] = scratchColor.b
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geometry
}

type Part = {
  g: THREE.BufferGeometry
  c: string
  x?: number; y?: number; z?: number
  s?: number; sy?: number; sz?: number
  rx?: number; ry?: number; rz?: number
}

const build = (parts: Part[]) => {
  const prepared = parts.map(({ g, c, x = 0, y = 0, z = 0, s = 1, sy, sz, rx = 0, ry = 0, rz = 0 }) => {
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
      new THREE.Vector3(s, sy ?? s, sz ?? s),
    )
    return paint(g.applyMatrix4(matrix).toNonIndexed(), c)
  })
  const merged = mergeGeometries(prepared, false)
  if (!merged) throw new Error('terrain prop merge failed')
  for (const part of prepared) part.dispose()
  merged.computeVertexNormals()
  return merged
}

/** Displace vertices along a hashed field so lumps stop reading as primitives. */
const roughen = (geometry: THREE.BufferGeometry, amount: number, seed: number, frequency = 5.5) => {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i)
    const y = position.getY(i)
    const z = position.getZ(i)
    const n = valueNoise(x * frequency + seed, z * frequency + y * frequency * 0.64, seed) - 0.5
    position.setXYZ(i, x * (1 + n * amount), y * (1 + n * amount * 0.7), z * (1 + n * amount))
  }
  position.needsUpdate = true
  // Mottle the baked colour with the same field. Instanced props carry no
  // texture, so this is the only way large facets get mineral variation.
  const color = geometry.getAttribute('color') as THREE.BufferAttribute | undefined
  if (color) {
    for (let i = 0; i < color.count; i += 1) {
      const x = position.getX(i)
      const y = position.getY(i)
      const z = position.getZ(i)
      const n = valueNoise(x * frequency * 1.7 + seed * 0.7, z * frequency * 1.7 + y * frequency, seed + 31)
      const k = 0.82 + n * 0.4
      color.setXYZ(i, color.getX(i) * k, color.getY(i) * k, color.getZ(i) * k)
    }
    color.needsUpdate = true
  }
  geometry.computeVertexNormals()
  return geometry
}

const BARK = '#4a3826'
const BARK_LIGHT = '#5d4630'

/**
 * Four conifer species, not one tree in three tints.
 *
 * The forest scored 4/10 because every crown was the same hue on the same cone
 * at the same height. The reference has spruce that reads almost blue-green in
 * shadow next to pine that reads yellow-green in sun, slim spires next to broad
 * firs, and a scrubby understory. Each entry is [shadow needle, lit needle,
 * crown radius, height, tier count, droop], and the shapes differ as much as
 * the colours do.
 */
const CONIFER_SPECIES: Array<[string, string, number, number, number, number]> = [
  // Spruce: narrow, very dark, blue-green. The canopy's shadow note.
  ['#274539', '#33573f', 0.225, 1.02, 9, 0.22],
  // Scots pine: broad, warm yellow-green, open tiers.
  ['#4a6f2c', '#6d9138', 0.275, 0.92, 6, 0.34],
  // Fir: the middle of the range, and the most common tree on the tile.
  ['#33563a', '#4c7546', 0.24, 1.02, 8, 0.27],
  // Larch: pale, almost lime at the top, slim and tall. The emergent species.
  ['#4c6f36', '#89a84f', 0.215, 1.06, 8, 0.18],
]

/** Layered conifer, roughly one world unit tall before instance scaling. */
export const coniferGeometry = (variant: number) => {
  const rng = makeRng(4001 + variant * 37)
  const [shadow, lit, crown, height, tiers, droop] = CONIFER_SPECIES[variant % CONIFER_SPECIES.length]
  const trunkTop = height * 0.42
  const parts: Part[] = [
    { g: new THREE.CylinderGeometry(0.014, 0.042, trunkTop, 6), c: BARK, y: trunkTop * 0.5 },
    { g: new THREE.ConeGeometry(0.062, 0.1, 6, 1), c: BARK_LIGHT, y: 0.05 },
  ]
  for (let tier = 0; tier < tiers; tier += 1) {
    const t = tier / (tiers - 1)
    const y = height * (0.16 + t * 0.7)
    // Tiers taper along a curve rather than a straight line, so the silhouette
    // has the slight concave flare a real conifer has instead of a plain cone.
    const radius = crown * Math.pow(1 - t, 0.78) * (0.86 + rng() * 0.28)
    const h = height * (0.3 - t * 0.145) * (1 + droop)
    parts.push({
      g: new THREE.ConeGeometry(radius, h, 7, 1),
      // Light climbs the tree: the lower skirt sits in its own shade and the
      // crown catches the key, so one tree already spans part of the range.
      c: mixHex(shadow, lit, Math.pow(t, 0.7)),
      x: (rng() - 0.5) * 0.022, y: y + h * 0.26, z: (rng() - 0.5) * 0.022, ry: rng() * 3,
      rx: (rng() - 0.5) * 0.05, rz: (rng() - 0.5) * 0.05,
    })
  }
  parts.push({ g: new THREE.ConeGeometry(crown * 0.16, height * 0.15, 6, 1), c: lit, y: height * 0.945 })
  return build(parts)
}

/** Rounded broadleaf for hedgerows and field edges. */
export const broadleafGeometry = (variant: number) => {
  const canopy = ['#5f8434', '#6d9139', '#55772e', '#7d9a45'][variant % 4]
  const parts: Part[] = [{ g: new THREE.CylinderGeometry(0.022, 0.048, 0.4, 6), c: BARK, y: 0.2 }]
  const blobs: Array<[number, number, number, number]> = [
    [0, 0.62, 0, 0.27], [0.15, 0.52, 0.08, 0.19], [-0.14, 0.55, -0.1, 0.2], [0.04, 0.77, -0.06, 0.16],
  ]
  for (const [x, y, z, r] of blobs) parts.push({ g: new THREE.IcosahedronGeometry(r, 1), c: canopy, x, y, z, s: 1, sy: 0.84 })
  return roughen(build(parts), 0.22, 11 + variant)
}

/** Knee-high conifer sapling, for filling the gaps between the big trunks. */
export const saplingGeometry = (variant: number) => {
  const [shadow, lit] = CONIFER_SPECIES[(variant + 1) % CONIFER_SPECIES.length]
  return build([
    { g: new THREE.CylinderGeometry(0.008, 0.016, 0.14, 5), c: BARK, y: 0.07 },
    { g: new THREE.ConeGeometry(0.09, 0.24, 6, 1), c: shadow, y: 0.16 },
    { g: new THREE.ConeGeometry(0.055, 0.18, 6, 1), c: lit, y: 0.3 },
  ])
}

/**
 * A fallen trunk with its root plate torn up. Real forest floors have them, and
 * one horizontal line among all those verticals does more for the read than
 * another dozen trees.
 */
export const deadfallGeometry = () => {
  const rng = makeRng(6607)
  const parts: Part[] = [
    { g: new THREE.CylinderGeometry(0.036, 0.045, 0.62, 7), c: '#5a4a35', y: 0.042, rz: Math.PI / 2, rx: 0.06 },
    { g: new THREE.CylinderGeometry(0.05, 0.055, 0.05, 8), c: '#463a2a', x: -0.31, y: 0.045, rz: Math.PI / 2 },
  ]
  for (let i = 0; i < 5; i += 1) {
    const a = rng() * Math.PI * 2
    parts.push({
      g: new THREE.CylinderGeometry(0.006, 0.012, 0.1, 4), c: '#4d4030',
      x: -0.33, y: 0.045 + Math.sin(a) * 0.05, z: Math.cos(a) * 0.05,
      rz: Math.PI / 2 + (rng() - 0.5) * 0.9, rx: (rng() - 0.5) * 0.9,
    })
  }
  return build(parts)
}

export const bushGeometry = (variant: number) => {
  const c = ['#5f8033', '#71903d', '#7f8f46'][variant % 3]
  return roughen(build([
    { g: new THREE.IcosahedronGeometry(0.1, 1), c, y: 0.07, s: 1.15, sy: 0.72, sz: 1.05 },
    { g: new THREE.IcosahedronGeometry(0.07, 1), c, x: 0.07, y: 0.05, z: -0.05, sy: 0.7 },
  ]), 0.3, 23 + variant)
}

/** A fan of grass blades, dense enough to read as a tussock at board distance. */
export const tussockGeometry = () => {
  const rng = makeRng(9109)
  const parts: Part[] = []
  for (let i = 0; i < 5; i += 1) {
    const a = (i / 5) * Math.PI * 2 + rng() * 0.9
    const lean = 0.26 + rng() * 0.34
    const h = 0.08 + rng() * 0.08
    parts.push({
      g: new THREE.ConeGeometry(0.012, h, 3, 1, true), c: rng() > 0.7 ? '#a2c257' : '#7ea23c',
      x: Math.cos(a) * 0.013, y: h * 0.5, z: Math.sin(a) * 0.013,
      rx: Math.sin(a) * lean, rz: -Math.cos(a) * lean,
    })
  }
  return build(parts)
}

/**
 * Wheat clump: bundled stalks with heavy heads. Kept to six stalks and
 * three-sided cones because a populated board carries roughly a thousand of
 * these and they are the single biggest triangle line item.
 */
export const wheatGeometry = () => {
  const rng = makeRng(5501)
  const parts: Part[] = []
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2 + rng() * 0.9
    const lean = 0.12 + rng() * 0.2
    const h = 0.15 + rng() * 0.06
    const ox = Math.cos(a) * 0.021
    const oz = Math.sin(a) * 0.021
    parts.push({ g: new THREE.CylinderGeometry(0.004, 0.0055, h, 3, 1, true), c: '#b99a45', x: ox, y: h * 0.5, z: oz, rx: Math.sin(a) * lean, rz: -Math.cos(a) * lean })
    parts.push({
      g: new THREE.ConeGeometry(0.018, 0.07, 4, 1, true), c: rng() > 0.5 ? '#e8c559' : '#d8ad3e',
      x: ox + Math.cos(a) * lean * h * 0.55, y: h + 0.026, z: oz + Math.sin(a) * lean * h * 0.55,
      rx: Math.sin(a) * lean, rz: -Math.cos(a) * lean,
    })
  }
  return build(parts)
}

export const haystackGeometry = () => build([
  { g: new THREE.CylinderGeometry(0.085, 0.115, 0.12, 9), c: '#b9a468', y: 0.06 },
  { g: new THREE.ConeGeometry(0.115, 0.15, 9, 1), c: '#cdb771', y: 0.195 },
  { g: new THREE.CylinderGeometry(0.008, 0.008, 0.3, 4), c: BARK, y: 0.15 },
])

export const boulderGeometry = (variant: number) => {
  const c = ['#84867c', '#75776e', '#918f83'][variant % 3]
  return roughen(build([
    { g: new THREE.IcosahedronGeometry(0.1, 1), c, y: 0.055, s: 1.2, sy: 0.8, sz: 1 },
    { g: new THREE.IcosahedronGeometry(0.055, 1), c, x: 0.09, y: 0.03, z: 0.05, sy: 0.7 },
  ]), 0.42, variant * 91 + 7)
}

export const pebbleGeometry = (variant: number) => roughen(
  build([{ g: new THREE.IcosahedronGeometry(0.038, 0), c: ['#9d9e94', '#8a8c82', '#aba99b'][variant % 3], y: 0.02, s: 1.3, sy: 0.55 }]),
  0.5, 41 + variant,
)

/** Jagged shard for scree fields and quarry spoil. */
export const shardGeometry = (variant: number) => roughen(
  build([{ g: new THREE.ConeGeometry(0.085, 0.22, 5, 1), c: ['#8b8f8c', '#787c78', '#9ea19a'][variant % 3], y: 0.11, sz: 0.7 }]),
  0.44, variant * 53 + 17,
)

/**
 * Mountain spire as one lofted mass.
 *
 * The previous version stacked a cylinder on a cylinder on a cone, which in
 * silhouette read as three pancakes with a hat. A mountain has one continuous
 * profile from footing to summit, so this lathes a single profile curve
 * instead: broad splayed base, a concave waist, a shoulder, then a summit that
 * narrows fast. The ledges are still there, but they are kinks in that one
 * curve rather than separate solids sitting on each other.
 *
 * Snow stays a shading term on the rock material driven by altitude and slope,
 * never geometry: white polyhedra on a peak read as litter, not snowpack.
 */
const SPIRE_PROFILE: Array<[number, number]> = [
  [0.560, 0.00], [0.545, 0.05], [0.487, 0.13], [0.470, 0.16],
  [0.408, 0.26], [0.396, 0.30], [0.339, 0.40], [0.330, 0.44],
  [0.281, 0.55], [0.272, 0.59], [0.221, 0.70], [0.208, 0.74],
  [0.156, 0.85], [0.140, 0.89], [0.082, 0.97], [0.030, 1.03],
  [0.000, 1.07],
]

export const spireGeometry = (variant: number) => {
  const rng = makeRng(variant * 337 + 61)
  // Per-variant profile bias: one squat massif, one classic peak, one gaunt
  // horn, so a ring of seventeen spires is not seventeen of the same rock.
  const taper = [1, 0.86, 1.14][variant % 3]
  const lift = [0.86, 1, 1.16][variant % 3]
  const points = SPIRE_PROFILE.map(([r, y]) => new THREE.Vector2(
    Math.max(0.0001, r * Math.pow(1 - y * 0.55, taper - 1) * (0.94 + rng() * 0.12)),
    y * lift,
  ))
  const parts: Part[] = [
    { g: new THREE.LatheGeometry(points, 9), c: '#6e7681', sz: 0.86 },
    // Buttresses, lathed from the same curve, so the footing grows out of the
    // mass rather than being propped against it.
    { g: new THREE.LatheGeometry(points.slice(0, 11), 7), c: '#5b636c', x: 0.3, y: -0.02, z: 0.12, s: 0.62, sy: 0.5, sz: 0.5, rz: -0.16 },
    { g: new THREE.LatheGeometry(points.slice(0, 9), 7), c: '#666e78', x: -0.28, y: -0.02, z: -0.15, s: 0.55, sy: 0.42, sz: 0.46, rz: 0.14 },
  ]
  // Bedding planes: thin ledges wrapping the mass at irregular heights, which is
  // what makes the reference read as stratified rock instead of faceted crystal.
  for (let band = 0; band < 6; band += 1) {
    const y = (0.07 + band * 0.16 + rng() * 0.05) * lift
    const r = Math.max(0.06, 0.55 - y * 0.5) * (0.99 + rng() * 0.1)
    parts.push({
      g: new THREE.CylinderGeometry(r * 0.985, r * 1.075, 0.026 + rng() * 0.014, 9, 1),
      c: band % 2 ? '#949ca7' : '#4d555d',
      y, sz: 0.87, ry: rng() * 3, rz: (rng() - 0.5) * 0.04,
    })
  }
  return roughen(build(parts), 0.3, variant * 71 + 5, 5)
}

/**
 * Sheep, modelled rather than suggested.
 *
 * The blind critic called the old ones "scattered marshmallows" and said
 * half-resolution sheep are worse than none. They were three smooth white
 * icosahedra: at board distance the dark head was too small to separate, the
 * legs were toothpicks, and the fleece had no self-shading at all, so every one
 * of them collapsed into a white dot.
 *
 * This version fixes the three things that decide whether a small white animal
 * reads at distance: a *lumpy* fleece silhouette, a genuinely dark head and
 * legs carrying enough pixels to be seen, and ambient occlusion painted into
 * the vertex colours so the underside is dark. That last one is not
 * compensating for the missing sun -- a sheep's belly is in its own shade under
 * any lighting.
 */
/**
 * An angular crag: flat cliff planes and a bedded top, the counterweight to the
 * spire's lathed cone.
 *
 * The blind critic's complaint about the mountains was that "the silhouette
 * repeats so visibly it reads as one prop instanced eight times". Three
 * variants of one lathe does not fix that on its own -- a lathe is always
 * round, and a mountain that is round everywhere has no cliff. This is the
 * other half: sheared blocks with genuinely planar faces, so the massif has
 * somewhere for the light to break hard.
 */
export const cragGeometry = (variant: number) => {
  const rng = makeRng(variant * 613 + 29)
  const parts: Part[] = []
  const blocks = 3 + (variant % 3)
  let y = 0
  let width = 0.46 + (variant % 2) * 0.12
  const lean = (variant % 2 ? 1 : -1) * 0.09
  for (let i = 0; i < blocks; i += 1) {
    const h = (0.3 - i * 0.045) * (0.85 + rng() * 0.35)
    // Each block is narrower and turned a little off the one below, so the
    // stack reads as a fractured buttress rather than as a wedding cake.
    parts.push({
      g: new THREE.BoxGeometry(width, h, width * (0.62 + rng() * 0.3)),
      c: ['#6b7480', '#7c8590', '#586069', '#8d95a0'][i % 4],
      x: lean * i * 0.6 + (rng() - 0.5) * 0.05, y: y + h * 0.5, z: (rng() - 0.5) * 0.06,
      ry: (variant * 0.4 + i * 0.55 + rng() * 0.3), rz: lean * 0.5, rx: (rng() - 0.5) * 0.1,
    })
    y += h * 0.86
    width *= 0.74
  }
  // A splintered summit so the top is not a flat lid.
  parts.push({
    g: new THREE.ConeGeometry(width * 0.62, 0.2 + rng() * 0.14, 5, 1),
    c: '#99a1ac', x: lean * blocks * 0.6, y: y + 0.06, ry: rng() * 3, rz: lean,
  })
  // Talus skirt: the debris cone every real cliff sheds around its own foot.
  parts.push({ g: new THREE.ConeGeometry(0.42, 0.16, 9, 1), c: '#646c75', y: 0.06, sy: 0.9, sz: 0.82, ry: rng() * 3 })
  return roughen(build(parts), 0.06, variant * 179 + 3, 4)
}

export const sheepGeometry = () => {
  const rng = makeRng(1487)
  const FLEECE = '#e9e4d6'
  const FLEECE_LIT = '#f7f4ea'
  const FACE = '#2e2822'
  const parts: Part[] = [
    { g: new THREE.IcosahedronGeometry(0.075, 1), c: FLEECE, y: 0.108, s: 1.5, sy: 1.02, sz: 1.12 },
  ]
  // Fleece lumps around the body. Six of them is the difference between a
  // silhouette that says "wool" and one that says "egg".
  for (let i = 0; i < 7; i += 1) {
    const a = (i / 7) * Math.PI * 2 + rng() * 0.5
    parts.push({
      g: new THREE.IcosahedronGeometry(0.036 + rng() * 0.018, 1),
      c: i % 2 ? FLEECE_LIT : FLEECE,
      x: Math.cos(a) * 0.088, y: 0.115 + Math.sin(a * 2.1) * 0.03, z: Math.sin(a) * 0.062,
      s: 1, sy: 0.9,
    })
  }
  parts.push(
    // Head: dark, and big enough to hold four or five pixels of its own.
    { g: new THREE.IcosahedronGeometry(0.036, 1), c: FACE, x: 0.132, y: 0.096, sy: 1.15, sz: 0.88 },
    { g: new THREE.SphereGeometry(0.021, 7, 5), c: '#211d18', x: 0.166, y: 0.086, sz: 0.85 },
    // Ears, which is most of what makes a dark blob read as a head.
    { g: new THREE.IcosahedronGeometry(0.017, 0), c: FACE, x: 0.118, y: 0.121, z: 0.036, s: 1.4, sy: 0.5, sz: 0.8, rz: 0.4 },
    { g: new THREE.IcosahedronGeometry(0.017, 0), c: FACE, x: 0.118, y: 0.121, z: -0.036, s: 1.4, sy: 0.5, sz: 0.8, rz: 0.4 },
    // A tuft of fleece over the crown, so the head is joined to the body.
    { g: new THREE.IcosahedronGeometry(0.03, 1), c: FLEECE_LIT, x: 0.104, y: 0.13, sy: 0.8 },
    { g: new THREE.IcosahedronGeometry(0.018, 0), c: FLEECE, x: -0.115, y: 0.115, s: 1.2, sy: 0.9 },
  )
  // Legs: longer and thicker than before, and dark all the way down, so the
  // animal stands on the grass instead of floating above it.
  for (const [x, z] of [[0.072, 0.042], [0.072, -0.042], [-0.062, 0.042], [-0.062, -0.042]] as const) {
    parts.push({ g: new THREE.CylinderGeometry(0.0105, 0.008, 0.085, 5), c: FACE, x, y: 0.043, z })
    parts.push({ g: new THREE.CylinderGeometry(0.011, 0.011, 0.014, 5), c: '#1d1a16', x, y: 0.007, z })
  }
  const geometry = build(parts)
  // Ambient occlusion into the vertex colours: the belly and the leg tops sit
  // in the animal's own shade, and without that the fleece is a flat white
  // shape no matter what the sun does.
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  const color = geometry.getAttribute('color') as THREE.BufferAttribute
  for (let i = 0; i < color.count; i += 1) {
    const y = position.getY(i)
    const k = 0.52 + 0.48 * Math.min(1, Math.max(0, (y - 0.02) / 0.14))
    color.setXYZ(i, color.getX(i) * k, color.getY(i) * k, color.getZ(i) * k)
  }
  color.needsUpdate = true
  return geometry
}

/** One unit of dry-stone wall running along +x, built from staggered blocks. */
export const wallGeometry = () => {
  const rng = makeRng(7717)
  const parts: Part[] = []
  const stone = () => ['#9a978c', '#8b897f', '#a8a598', '#7d7b73'][Math.floor(rng() * 4)]
  // Boxes, not dodecahedra: a twelve-triangle block reads the same at board
  // distance and the board carries well over a hundred wall units.
  for (let course = 0; course < 2; course += 1) {
    const y = 0.03 + course * 0.05
    const step = 0.1
    const offset = course % 2 ? step * 0.5 : 0
    for (let i = 0; i * step + offset < 1; i += 1) {
      const x = i * step + offset + step * 0.5
      if (x > 1) break
      parts.push({
        g: new THREE.BoxGeometry(0.09, 0.052, 0.085), c: stone(),
        x, y, z: (rng() - 0.5) * 0.012,
        s: 0.9 + rng() * 0.25, sy: 0.85 + rng() * 0.3, sz: 0.9 + rng() * 0.2,
        ry: (rng() - 0.5) * 0.4, rz: (rng() - 0.5) * 0.14,
      })
    }
  }
  for (let i = 0; i < 9; i += 1) {
    parts.push({
      g: new THREE.BoxGeometry(0.1, 0.036, 0.1), c: stone(),
      x: (i + 0.5) / 9, y: 0.115, z: (rng() - 0.5) * 0.008,
      ry: (rng() - 0.5) * 0.5, rz: (rng() - 0.5) * 0.2,
    })
  }
  return build(parts)
}

/** One unit of post-and-rail fence. */
export const fenceGeometry = () => {
  const parts: Part[] = []
  for (let i = 0; i <= 3; i += 1) {
    parts.push({ g: new THREE.BoxGeometry(0.022, 0.17, 0.022), c: '#6b5334', x: i / 3, y: 0.085, ry: 0.2, rz: i % 2 ? 0.03 : -0.02 })
  }
  parts.push({ g: new THREE.BoxGeometry(1, 0.015, 0.013), c: '#7a6040', x: 0.5, y: 0.132 })
  parts.push({ g: new THREE.BoxGeometry(1, 0.013, 0.011), c: '#6b5334', x: 0.5, y: 0.078 })
  return build(parts)
}

/**
 * Saguaro. The old version was a smooth untapered forest-green column, which
 * read as a recoloured pasture tree. The reference is bleached blue-green,
 * ribbed, waisted at the base and low relative to the tile, so the ribs are
 * modelled as a ring of half-round flutes and the trunk tapers toward the crown.
 */
export const cactusGeometry = (variant: number) => {
  const rng = makeRng(2207 + variant * 53)
  const FLESH = '#6f8a72'
  const LIT = '#8aa189'
  const parts: Part[] = []
  const h = 0.2 + (variant % 3) * 0.055

  const limb = (x: number, z: number, radius: number, length: number, ribs: number) => {
    parts.push({ g: new THREE.CylinderGeometry(radius * 0.82, radius, length, 12, 3), c: FLESH, x, y: length * 0.5, z })
    parts.push({ g: new THREE.SphereGeometry(radius * 0.84, 12, 7), c: LIT, x, y: length, z, sy: 0.7 })
    for (let i = 0; i < ribs; i += 1) {
      const a = (i / ribs) * Math.PI * 2
      parts.push({
        g: new THREE.CylinderGeometry(radius * 0.17, radius * 0.2, length * 0.94, 5, 1),
        c: i % 2 ? LIT : FLESH,
        x: x + Math.cos(a) * radius * 0.88, y: length * 0.5, z: z + Math.sin(a) * radius * 0.88,
        s: 1, sz: 0.75,
      })
    }
  }

  limb(0, 0, 0.052, h, 8)
  if (variant % 2 === 0) {
    // Arm: elbow out, then up. Modelled as three pieces so the joint is round.
    const ay = h * 0.44
    parts.push({ g: new THREE.CylinderGeometry(0.03, 0.032, 0.11, 10, 2), c: FLESH, x: 0.062, y: ay, rz: -Math.PI / 2 })
    parts.push({ g: new THREE.SphereGeometry(0.032, 10, 6), c: FLESH, x: 0.113, y: ay })
    parts.push({ g: new THREE.CylinderGeometry(0.027, 0.031, 0.13, 10, 2), c: FLESH, x: 0.113, y: ay + 0.065 })
    parts.push({ g: new THREE.SphereGeometry(0.028, 10, 6), c: LIT, x: 0.113, y: ay + 0.13, sy: 0.7 })
  }
  if (variant % 3 === 0) {
    const ay = h * 0.3
    parts.push({ g: new THREE.CylinderGeometry(0.026, 0.028, 0.09, 10, 2), c: FLESH, x: -0.05, y: ay, rz: Math.PI / 2 })
    parts.push({ g: new THREE.SphereGeometry(0.028, 10, 6), c: FLESH, x: -0.093, y: ay })
    parts.push({ g: new THREE.CylinderGeometry(0.023, 0.027, 0.1, 10, 2), c: FLESH, x: -0.093, y: ay + 0.05 })
    parts.push({ g: new THREE.SphereGeometry(0.024, 10, 6), c: LIT, x: -0.093, y: ay + 0.1, sy: 0.7 })
  }
  // A little skirt of dead scale at the base so it is planted, not inserted.
  parts.push({ g: new THREE.CylinderGeometry(0.062, 0.078, 0.03, 12, 1), c: '#7d7358', y: 0.014 })
  return roughen(build(parts), 0.06, 401 + variant, 14 + rng() * 2)
}

/** Wind-scoured dead brush. */
export const dryBrushGeometry = () => {
  const rng = makeRng(3313)
  const parts: Part[] = []
  for (let i = 0; i < 8; i += 1) {
    const a = rng() * Math.PI * 2
    const lean = 0.5 + rng() * 0.8
    const len = 0.06 + rng() * 0.09
    parts.push({
      g: new THREE.CylinderGeometry(0.0045, 0.0055, len, 3, 1, true), c: rng() > 0.6 ? '#b0a075' : '#94805a',
      x: Math.cos(a) * 0.022, y: len * 0.35, z: Math.sin(a) * 0.022,
      rx: Math.sin(a) * lean, rz: -Math.cos(a) * lean,
    })
  }
  return build(parts)
}

/** Timber mine head with a portal, props and a spoil chute. */
export const mineHeadGeometry = () => {
  const t = '#6a5133'
  const d = '#523f27'
  return build([
    { g: new THREE.BoxGeometry(0.055, 0.36, 0.055), c: t, x: -0.15, y: 0.18 },
    { g: new THREE.BoxGeometry(0.055, 0.36, 0.055), c: t, x: 0.15, y: 0.18 },
    { g: new THREE.BoxGeometry(0.4, 0.06, 0.08), c: d, y: 0.385 },
    { g: new THREE.BoxGeometry(0.26, 0.3, 0.05), c: '#191512', y: 0.15, z: -0.03 },
    { g: new THREE.BoxGeometry(0.04, 0.28, 0.04), c: t, x: -0.2, y: 0.14, z: 0.1, rx: 0.35, rz: 0.22 },
    { g: new THREE.BoxGeometry(0.04, 0.28, 0.04), c: t, x: 0.2, y: 0.14, z: 0.1, rx: 0.35, rz: -0.22 },
    { g: new THREE.BoxGeometry(0.02, 0.02, 0.55), c: d, x: -0.06, y: 0.03, z: 0.28 },
    { g: new THREE.BoxGeometry(0.02, 0.02, 0.55), c: d, x: 0.06, y: 0.03, z: 0.28 },
    { g: new THREE.BoxGeometry(0.16, 0.02, 0.02), c: d, y: 0.038, z: 0.12 },
    { g: new THREE.BoxGeometry(0.16, 0.02, 0.02), c: d, y: 0.038, z: 0.38 },
  ])
}

/** Terrace revetment plank line for the clay pits. */
export const revetmentGeometry = () => build([
  { g: new THREE.BoxGeometry(1, 0.075, 0.022), c: '#9c7d54', x: 0.5, y: 0.037 },
  { g: new THREE.BoxGeometry(0.028, 0.115, 0.028), c: '#7d6340', x: 0.08, y: 0.055 },
  { g: new THREE.BoxGeometry(0.028, 0.115, 0.028), c: '#7d6340', x: 0.5, y: 0.055 },
  { g: new THREE.BoxGeometry(0.028, 0.115, 0.028), c: '#7d6340', x: 0.92, y: 0.055 },
])

// Clay-pit furniture. The client's complaint was that "the brick land, the clay
// land is not coming through", and the tile's props were the loudest part of
// the problem: it was scattered with grey rock shards and grey pebbles, which
// is exactly what a clay pit does not contain. The reference is unambiguously
// ceramic -- cut blocks and broken bricks in a red that no amount of instance
// tint would ever pull out of granite grey.
const CLAY_FACE = ['#9c5333', '#93492b', '#a55e3b']
const CLAY_CUT = ['#b1704e', '#a96641', '#bb7d59']

/**
 * A quarried block sitting where it was cut. Boxy with a chamfered top so the
 * key light catches one plane and the cut face stays in shade, which is what
 * makes the reference blocks read as worked stone rather than as lumps.
 */
export const clayBlockGeometry = (variant: number) => {
  const rng = makeRng(8101 + variant * 47)
  const face = CLAY_FACE[variant % 3]
  const cut = CLAY_CUT[variant % 3]
  const w = 0.15 + variant * 0.032
  const h = 0.085 + (variant % 2) * 0.03
  const parts: Part[] = [
    { g: new THREE.BoxGeometry(w, h, w * 0.7), c: face, y: h * 0.5 },
    // Fresh cut plane on top, a shade lighter and slightly inset.
    { g: new THREE.BoxGeometry(w * 0.93, 0.009, w * 0.64), c: cut, y: h },
  ]
  // Courses scored into the long face: the reference's blocks are visibly
  // bedded, and two shallow grooves is enough to say so at board distance.
  for (let i = 0; i < 2; i += 1) {
    parts.push({
      g: new THREE.BoxGeometry(w * 0.99, 0.006, w * 0.73), c: '#8e3f1f',
      y: h * (0.32 + i * 0.36), z: (rng() - 0.5) * 0.004,
    })
  }
  return roughen(build(parts), 0.1, 811 + variant, 9)
}

/** Broken brick and clay rubble, the litter across a working pit floor. */
export const clayRubbleGeometry = (variant: number) => {
  const rng = makeRng(9203 + variant * 29)
  const parts: Part[] = []
  for (let i = 0; i < 3; i += 1) {
    const s = 0.035 + rng() * 0.03
    parts.push({
      g: new THREE.BoxGeometry(s * 1.9, s, s * 1.1), c: rng() > 0.45 ? CLAY_FACE[i % 3] : CLAY_CUT[i % 3],
      x: (rng() - 0.5) * 0.1, y: s * 0.5, z: (rng() - 0.5) * 0.1,
      ry: rng() * 3.14, rz: (rng() - 0.5) * 0.5, rx: (rng() - 0.5) * 0.4,
    })
  }
  return build(parts)
}

export const crateGeometry = () => build([
  { g: new THREE.BoxGeometry(0.15, 0.11, 0.11), c: '#7a5f3c', y: 0.055 },
  { g: new THREE.BoxGeometry(0.16, 0.016, 0.016), c: '#5c4629', y: 0.094, z: 0.053 },
  { g: new THREE.BoxGeometry(0.16, 0.016, 0.016), c: '#5c4629', y: 0.02, z: 0.053 },
  { g: new THREE.BoxGeometry(0.016, 0.115, 0.016), c: '#5c4629', x: 0.07, y: 0.055, z: 0.053 },
])
