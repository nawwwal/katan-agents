import type { Terrain } from '../../game/types'
import { hexNorm, insideHex } from './hex'
import { jitter, makeRng, range, type Rng } from './noise'

export type PropInstance = {
  family: string
  x: number
  y: number
  z: number
  ry: number
  rx: number
  rz: number
  s: number
  sy: number
  /** Multiplied onto the prop's baked vertex colours. */
  tint: number
  /** Slight hue shift: positive warms, negative cools. */
  warm: number
}

type Ctx = {
  rng: Rng
  height: (x: number, z: number) => number
  out: PropInstance[]
}

/** Keep the hex centre clear so number tokens and the robber stay readable. */
const TOKEN_CLEARANCE = 0.36

/**
 * Keep the hex *rim* clear of the road.
 *
 * The rebuilt road is a causeway with a deck 0.104 above `GROUND_Y` and an
 * inner edge 0.72 from the tile centre, measured perpendicular to the hex edge.
 * `hexNorm` is exactly that perpendicular distance normalised by the apothem,
 * so 0.72 / 0.866 = 0.831 is where a prop starts touching the kerb. Everything
 * placed by this module is held inside 0.80, which is the same test whichever
 * direction the point lies in -- more robust than tuning each caller's inset,
 * because a hex corner is 15% further from the centre than a hex edge is.
 */
const ROAD_CLEARANCE = 0.8

const slope = (height: (x: number, z: number) => number, x: number, z: number) => {
  const d = 0.06
  const dx = height(x + d, z) - height(x - d, z)
  const dz = height(x, z + d) - height(x, z - d)
  return Math.sqrt(dx * dx + dz * dz) / (2 * d)
}

type PlaceOptions = {
  count: number
  minDist: number
  inset?: number
  /** Reject anything closer to the centre than this. */
  clear?: number
  maxSlope?: number
  /** Bias placement towards (1) or away from (-1) the hex rim. */
  rimBias?: number
  /**
   * Draw around a handful of centres instead of filling the hex evenly. Real
   * canopy grows in clumps with real gaps between them; Poisson sampling gives
   * the opposite, which is why the forest read as popcorn.
   */
  clumps?: { count: number; spread: number }
  /** Veto a candidate point, used to carve clearings and tracks. */
  reject?: (x: number, z: number) => boolean
}

const scatterPoints = (ctx: Ctx, options: PlaceOptions) => {
  const { count, minDist, clear = 0, maxSlope = Infinity, rimBias = 0, clumps, reject } = options
  const inset = Math.min(options.inset ?? 0.84, ROAD_CLEARANCE)
  const points: Array<[number, number]> = []
  const attempts = count * (clumps ? 40 : 26)

  const centres: Array<[number, number]> = []
  if (clumps) {
    for (let i = 0; i < clumps.count * 8 && centres.length < clumps.count; i += 1) {
      const [cx, cz] = insideHex(ctx.rng(), ctx.rng(), inset * 0.82)
      if (clear > 0 && cx * cx + cz * cz < clear * clear) continue
      if (reject?.(cx, cz)) continue
      centres.push([cx, cz])
    }
  }

  for (let i = 0; i < attempts && points.length < count; i += 1) {
    let x: number
    let z: number
    if (centres.length) {
      const [cx, cz] = centres[Math.floor(ctx.rng() * centres.length)]
      const angle = ctx.rng() * Math.PI * 2
      // sqrt keeps the density even inside the clump instead of piling every
      // tree onto the centre point.
      const radius = Math.sqrt(ctx.rng()) * clumps!.spread
      x = cx + Math.cos(angle) * radius
      z = cz + Math.sin(angle) * radius
      if (hexNorm(x, z) > inset) continue
    } else {
      let u = ctx.rng()
      if (rimBias > 0) u = Math.pow(u, 1 - rimBias * 0.6)
      if (rimBias < 0) u = Math.pow(u, 1 - rimBias * 1.4)
      ;[x, z] = insideHex(u, ctx.rng(), inset)
    }
    if (clear > 0 && x * x + z * z < clear * clear) continue
    if (reject?.(x, z)) continue
    if (maxSlope < Infinity && slope(ctx.height, x, z) > maxSlope) continue
    let ok = true
    for (const [px, pz] of points) {
      if ((px - x) * (px - x) + (pz - z) * (pz - z) < minDist * minDist) { ok = false; break }
    }
    if (ok) points.push([x, z])
  }
  return points
}

type Variant = { family: string; weight?: number }

type PropOptions = PlaceOptions & {
  variants: Variant[]
  scale: [number, number]
  /** Extra squash/stretch on Y, as a multiplier range on `scale`. */
  stretch?: [number, number]
  tilt?: number
  /** Sink the prop into the ground by this much so it never floats. */
  sink?: number
  tintRange?: number
  warmRange?: number
  /** Constant added to every instance tint, before the per-instance jitter. */
  tintBias?: number
  warmBias?: number
}

const addProps = (ctx: Ctx, options: PropOptions) => {
  const points = scatterPoints(ctx, options)
  const { variants, scale, stretch = [1, 1], tilt = 0.05, sink = 0.01, tintRange = 0.16, warmRange = 0.05, tintBias = 0, warmBias = 0 } = options
  for (const [x, z] of points) {
    const pick = variants[Math.floor(ctx.rng() * variants.length)]
    const s = range(ctx.rng, scale[0], scale[1])
    ctx.out.push({
      family: pick.family,
      x,
      y: ctx.height(x, z) - sink * s,
      z,
      ry: ctx.rng() * Math.PI * 2,
      rx: jitter(ctx.rng) * tilt,
      rz: jitter(ctx.rng) * tilt,
      s,
      sy: s * range(ctx.rng, stretch[0], stretch[1]),
      tint: 1 + tintBias + jitter(ctx.rng) * tintRange,
      warm: warmBias + jitter(ctx.rng) * warmRange,
    })
  }
  return points
}

/** Straight run of props between two local points, used for fences and walls. */
const addLine = (
  ctx: Ctx,
  family: string,
  from: [number, number],
  to: [number, number],
  segments: number,
  scale = 1,
) => {
  const [x0, z0] = from
  const [x1, z1] = to
  for (let i = 0; i < segments; i += 1) {
    const t0 = i / segments
    const x = x0 + (x1 - x0) * t0
    const z = z0 + (z1 - z0) * t0
    if (hexNorm(x, z) > ROAD_CLEARANCE) continue
    const length = Math.hypot(x1 - x0, z1 - z0) / segments
    ctx.out.push({
      family,
      x, y: ctx.height(x, z) - 0.012, z,
      ry: -Math.atan2(z1 - z0, x1 - x0),
      rx: 0, rz: 0,
      s: length * scale, sy: scale,
      tint: 1 + jitter(ctx.rng) * 0.1,
      warm: jitter(ctx.rng) * 0.04,
    })
  }
}

/**
 * A forest is clumps and gaps, not a lawn of trees.
 *
 * Three things were wrong and all three were placement rather than modelling:
 * one silhouette, one scale, and even spacing. So this places four species
 * around a handful of canopy centres, carves a clearing the way the reference
 * has a track running through it, and adds emergents that stand a head above
 * the canopy line -- which is the cue that says "forest" rather than
 * "arrangement of trees".
 */
const forest = (ctx: Ctx) => {
  // A clearing wandering across the tile. The reference has exactly this: a
  // bare, rocky, mossy corridor that lets you see the forest floor.
  const angle = ctx.rng() * Math.PI * 2
  const dx = Math.cos(angle)
  const dz = Math.sin(angle)
  const bend = (ctx.rng() - 0.5) * 0.7
  const offset = (ctx.rng() - 0.5) * 0.5
  /** Perpendicular distance to the clearing's curved centreline. */
  const toClearing = (x: number, z: number) => {
    const along = x * dx + z * dz
    const across = -x * dz + z * dx
    return Math.abs(across - offset - bend * along * along)
  }
  const inClearing = (x: number, z: number) => toClearing(x, z) < 0.21
  const nearClearing = (x: number, z: number) => toClearing(x, z) < 0.13

  const species = [{ family: 'conifer0' }, { family: 'conifer1' }, { family: 'conifer2' }, { family: 'conifer3' }]
  // Main canopy, clumped. `warmRange` is wide on purpose: on a green base the
  // warm axis runs yellow-green to blue-green, which is the species-to-species
  // colour break the critic said was missing, for the price of an instance
  // colour that was already being written.
  addProps(ctx, {
    variants: species,
    count: 40, minDist: 0.15, inset: 0.88, clear: TOKEN_CLEARANCE, reject: inClearing,
    clumps: { count: 5, spread: 0.34 },
    scale: [0.3, 0.5], stretch: [0.85, 1.3], tilt: 0.04, sink: 0.02, tintRange: 0.26, warmRange: 0.2,
  })
  // Emergents: half a dozen trees that break the canopy line. Without these the
  // whole tile has one silhouette height and reads as a hedge.
  addProps(ctx, {
    variants: [{ family: 'conifer3' }, { family: 'conifer0' }],
    count: 6, minDist: 0.3, inset: 0.84, clear: TOKEN_CLEARANCE, reject: inClearing,
    scale: [0.56, 0.76], stretch: [0.95, 1.2], tilt: 0.03, sink: 0.025, tintRange: 0.2, warmRange: 0.16,
  })
  // Understory, thickest at the clumps' edges where the light gets in.
  addProps(ctx, {
    variants: [{ family: 'sapling0' }, { family: 'sapling1' }, { family: 'sapling2' }],
    count: 26, minDist: 0.1, inset: 0.88, clear: 0.24, reject: nearClearing,
    scale: [0.55, 1.25], tilt: 0.1, tintRange: 0.26, warmRange: 0.2,
  })
  addProps(ctx, {
    variants: [{ family: 'broadleaf0' }, { family: 'broadleaf1' }, { family: 'broadleaf3' }],
    count: 7, minDist: 0.24, inset: 0.86, clear: TOKEN_CLEARANCE, reject: inClearing,
    scale: [0.35, 0.6], tilt: 0.06, warmRange: 0.16,
  })
  addProps(ctx, { variants: [{ family: 'deadfall' }], count: 3, minDist: 0.4, inset: 0.8, clear: 0.3, scale: [0.7, 1.1], tilt: 0.05, sink: 0.005 })
  addProps(ctx, {
    variants: [{ family: 'bush0' }, { family: 'bush1' }, { family: 'bush2' }],
    count: 32, minDist: 0.1, inset: 0.88, clear: 0.2, scale: [0.5, 1.15], tilt: 0.14, warmRange: 0.16,
  })
  addProps(ctx, { variants: [{ family: 'tussock' }], count: 60, minDist: 0.07, inset: 0.88, scale: [0.6, 1.2], tilt: 0.16, warmRange: 0.14 })
  // The clearing floor gets the rock, which is what makes it read as a track
  // worn through the trees rather than as a hole where the scatter failed.
  addProps(ctx, {
    variants: [{ family: 'boulder0' }, { family: 'boulder1' }, { family: 'boulder2' }],
    count: 13, minDist: 0.15, inset: 0.86, clear: 0.22, scale: [0.5, 1.2], tilt: 0.2,
  })
  addProps(ctx, {
    variants: [{ family: 'pebble0' }, { family: 'pebble1' }, { family: 'pebble2' }],
    count: 30, minDist: 0.07, inset: 0.88, scale: [0.6, 1.4], tilt: 0.4,
  })
}

const pasture = (ctx: Ctx) => {
  // A paddock wall cutting across the hex, the way the references divide grazing.
  const a = ctx.rng() * Math.PI
  addLine(ctx, 'wall', [Math.cos(a) * -0.72, Math.sin(a) * -0.72], [Math.cos(a) * 0.72, Math.sin(a) * 0.72], 12)
  addProps(ctx, { variants: [{ family: 'tussock' }], count: 130, minDist: 0.062, inset: 0.9, scale: [0.65, 1.45], tilt: 0.18, warmRange: 0.14, tintRange: 0.24 })
  // Sheep graze in a flock, not on a grid. Two clumps of five, at a size that
  // actually carries a head and four legs at board distance.
  addProps(ctx, {
    variants: [{ family: 'sheep' }], count: 8, minDist: 0.29, inset: 0.72, clear: TOKEN_CLEARANCE,
    clumps: { count: 2, spread: 0.38 },
    scale: [0.78, 1.0], tilt: 0.03, sink: 0.004, tintRange: 0.08, warmRange: 0.03,
  })
  addProps(ctx, {
    variants: [{ family: 'boulder0' }, { family: 'boulder1' }, { family: 'boulder2' }],
    count: 9, minDist: 0.22, inset: 0.86, clear: 0.26, scale: [0.45, 0.95], tilt: 0.2,
  })
  addProps(ctx, {
    variants: [{ family: 'bush0' }, { family: 'bush1' }], count: 12, minDist: 0.16, inset: 0.9, clear: 0.24, scale: [0.5, 0.95], tilt: 0.14,
  })
  addProps(ctx, {
    variants: [{ family: 'pebble0' }, { family: 'pebble1' }, { family: 'pebble2' }],
    count: 22, minDist: 0.08, inset: 0.92, scale: [0.5, 1.2], tilt: 0.4,
  })
  addProps(ctx, { variants: [{ family: 'broadleaf0' }, { family: 'broadleaf1' }], count: 3, minDist: 0.4, inset: 0.82, clear: 0.45, scale: [0.4, 0.62] })
}

const fields = (ctx: Ctx) => {
  // Crop rows run along +x, matching the furrow direction baked into the relief
  // and the albedo, so texture and geometry agree.
  const rows = 20
  for (let row = 0; row < rows; row += 1) {
    const z = -0.8 + (row / (rows - 1)) * 1.6
    // Rows alternate crop and headland so the furrow texture stays visible.
    const gap = row % 5 === 2
    const step = gap ? 0.16 : 0.082
    for (let x = -0.84; x <= 0.84; x += step) {
      const jx = x + (ctx.rng() - 0.5) * 0.03
      const jz = z + (ctx.rng() - 0.5) * 0.028
      if (hexNorm(jx, jz) > ROAD_CLEARANCE) continue
      if (jx * jx + jz * jz < TOKEN_CLEARANCE * TOKEN_CLEARANCE) continue
      if (gap && ctx.rng() > 0.35) continue
      const s = range(ctx.rng, 0.6, 0.95)
      ctx.out.push({
        family: 'wheat', x: jx, y: ctx.height(jx, jz) - 0.012, z: jz,
        ry: (ctx.rng() - 0.5) * 0.5, rx: jitter(ctx.rng) * 0.07, rz: jitter(ctx.rng) * 0.07,
        s, sy: s * range(ctx.rng, 0.85, 1.2),
        tint: 1 + jitter(ctx.rng) * 0.16, warm: jitter(ctx.rng) * 0.06,
      })
    }
  }
  addLine(ctx, 'fence', [-0.78, -0.5], [0.78, -0.5], 10)
  addLine(ctx, 'fence', [-0.78, 0.62], [0.78, 0.62], 10)
  addProps(ctx, {
    variants: [{ family: 'haystack' }], count: 4, minDist: 0.3, inset: 0.72, clear: 0.44,
    scale: [0.8, 1.25], tilt: 0.03, sink: 0.02,
  })
  addProps(ctx, { variants: [{ family: 'broadleaf0' }, { family: 'broadleaf1' }], count: 4, minDist: 0.36, inset: 0.86, clear: 0.5, rimBias: 1, scale: [0.4, 0.68] })
  addProps(ctx, { variants: [{ family: 'tussock' }], count: 34, minDist: 0.08, inset: 0.94, rimBias: 1, scale: [0.6, 1.1], tilt: 0.16 })
  addProps(ctx, { variants: [{ family: 'pebble0' }, { family: 'pebble2' }], count: 12, minDist: 0.1, inset: 0.93, rimBias: 1, scale: [0.5, 1], tilt: 0.4 })
}

/**
 * The clay pit.
 *
 * This tile was the weakest thing on the board and the props were half the
 * reason. It was dressed with grey rock shards, grey pebbles and timber
 * revetment boards -- granite and carpentry in what is supposed to be an
 * excavated clay working. The reference has none of that: it has cut ceramic
 * blocks stacked on the benches, broken brick across a pale pan of a floor, and
 * dry scrub clinging to the rim. So that is what it gets. The revetments are
 * gone; the mesh already terraces itself and the boards were reading as a fence
 * around a contour line.
 */
const hills = (ctx: Ctx) => {
  // Cut blocks lined up along the bench edges, where they were quarried from.
  for (const radius of [0.4, 0.63]) {
    const segments = Math.round(radius * 14)
    // Three short runs per bench, not a closed loop. A ring of blocks around
    // the token read as a roofline, which is the opposite of the intent.
    const runStart = ctx.rng() * segments
    for (let i = 0; i < segments; i += 1) {
      const phase = ((i - runStart) / segments) * 3
      // Two short runs per bench rather than three, so the blocks read as a
      // couple of stacks somebody left where they cut them. Any more than that
      // and the eye counts them as a pattern round the token again.
      if (phase - Math.floor(phase) > 0.22) continue
      const a0 = (i / segments) * Math.PI * 2 + ctx.rng() * 0.2
      const x = Math.cos(a0) * (radius + (ctx.rng() - 0.5) * 0.12)
      const z = Math.sin(a0) * (radius + (ctx.rng() - 0.5) * 0.12)
      if (hexNorm(x, z) > ROAD_CLEARANCE) continue
      // Quarried slabs, not chips. In the reference the cut blocks are the
      // largest objects on the tile by a distance -- that size difference
      // against the rubble is a big part of why the pit reads as worked.
      const s = 0.95 + ctx.rng() * 0.85
      ctx.out.push({
        family: `clayBlock${Math.floor(ctx.rng() * 3)}`,
        x, y: ctx.height(x, z) - 0.01, z,
        ry: -a0 + Math.PI / 2 + (ctx.rng() - 0.5) * 0.6, rx: jitter(ctx.rng) * 0.08, rz: jitter(ctx.rng) * 0.08,
        s, sy: s * (0.85 + ctx.rng() * 0.4),
        tint: 1 + jitter(ctx.rng) * 0.14, warm: jitter(ctx.rng) * 0.06,
      })
    }
  }
  // Spoil heaped against the rim, where a working pit throws its waste.
  addProps(ctx, {
    variants: [{ family: 'clayBlock0' }, { family: 'clayBlock1' }, { family: 'clayBlock2' }],
    count: 6, minDist: 0.19, inset: 0.8, clear: 0.5, rimBias: 1,
    scale: [0.5, 0.95], tilt: 0.22, tintRange: 0.18, warmRange: 0.07,
  })
  // Broken brick, tipped in heaps rather than sprinkled.
  //
  // Twenty-four evenly Poisson-spaced rubble props across the whole tile is
  // exactly the "confetti" read: spoil does not distribute itself, it gets
  // barrowed to three or four places and dumped. Clumping the same material
  // also leaves clean pan between the heaps, which is where the pit floor gets
  // to be a pit floor instead of a texture with objects on it.
  addProps(ctx, {
    variants: [{ family: 'clayRubble0' }, { family: 'clayRubble1' }, { family: 'clayRubble2' }],
    count: 18, minDist: 0.075, inset: 0.72, clear: 0.3,
    clumps: { count: 4, spread: 0.16 },
    scale: [0.6, 1.5], tilt: 0.5, tintRange: 0.24, warmRange: 0.08,
  })
  addProps(ctx, { variants: [{ family: 'dryBrush' }], count: 18, minDist: 0.12, inset: 0.8, clear: 0.24, scale: [0.6, 1.25], tilt: 0.2 })
  addProps(ctx, { variants: [{ family: 'bush0' }, { family: 'bush2' }], count: 11, minDist: 0.15, inset: 0.8, rimBias: 1, clear: 0.45, scale: [0.5, 1], tilt: 0.16, warmRange: 0.14 })
  addProps(ctx, { variants: [{ family: 'crate' }], count: 3, minDist: 0.3, inset: 0.68, clear: 0.42, scale: [0.75, 1.05], tilt: 0.05 })
  addProps(ctx, { variants: [{ family: 'tussock' }], count: 28, minDist: 0.085, inset: 0.8, rimBias: 1, scale: [0.5, 0.95], tilt: 0.2, warmBias: 0.08 })
}

const mountains = (ctx: Ctx) => {
  // Spires ride the crest of the relief ring rather than scattering at random,
  // so the tile reads as one massif with a quarry floor cut into it.
  const start = ctx.rng() * Math.PI * 2
  const peaks = 10
  for (let i = 0; i < peaks; i += 1) {
    const angle = start + (i / peaks) * Math.PI * 2 + (ctx.rng() - 0.5) * 0.42
    const radius = 0.4 + ctx.rng() * 0.26
    const x = Math.cos(angle) * radius
    const z = Math.sin(angle) * radius
    if (hexNorm(x, z) > ROAD_CLEARANCE) continue
    const crest = ctx.height(x, z)
    if (crest < 0.1) continue
    // Six forms across two families and a scale range better than 3:1. The
    // repeating silhouette was the loudest defect on this tile and it came from
    // three near-identical props at near-identical size, not from the count.
    const crag = ctx.rng() > 0.38
    const pick = Math.floor(ctx.rng() * 3)
    const s = (crag ? 0.42 : 0.36) + crest * 0.95 + ctx.rng() * 0.3
    ctx.out.push({
      family: `${crag ? 'crag' : 'spire'}${pick}`,
      x, y: crest - 0.14 * s, z,
      ry: ctx.rng() * 6.283, rx: jitter(ctx.rng) * 0.06, rz: jitter(ctx.rng) * 0.06,
      // Wide, uncorrelated stretch on Y: the same form squat and gaunt does
      // more for variety than another mesh would.
      s, sy: s * (0.62 + ctx.rng() * 0.52),
      tint: 1 + jitter(ctx.rng) * 0.18, warm: jitter(ctx.rng) * 0.05,
    })
  }
  addProps(ctx, { variants: [{ family: 'mineHead' }], count: 1, minDist: 1, inset: 0.6, clear: 0.42, scale: [0.95, 1.05], tilt: 0.02, sink: 0.02 })
  addProps(ctx, {
    variants: [{ family: 'shard0' }, { family: 'shard1' }, { family: 'shard2' }],
    count: 44, minDist: 0.095, inset: 0.92, clear: 0.18, scale: [0.3, 0.85], stretch: [0.7, 1.5], tilt: 0.35, tintRange: 0.24,
  })
  addProps(ctx, {
    variants: [{ family: 'pebble0' }, { family: 'pebble1' }, { family: 'pebble2' }],
    count: 60, minDist: 0.06, inset: 0.94, scale: [0.6, 1.6], tilt: 0.5,
  })
  addProps(ctx, {
    variants: [{ family: 'conifer0' }, { family: 'conifer2' }],
    count: 10, minDist: 0.19, inset: 0.9, clear: 0.5, maxSlope: 0.75, scale: [0.26, 0.44], tilt: 0.06, sink: 0.02,
  })
  addProps(ctx, { variants: [{ family: 'dryBrush' }], count: 12, minDist: 0.14, inset: 0.92, clear: 0.3, scale: [0.5, 0.95], tilt: 0.25 })
}

const desert = (ctx: Ctx) => {
  addProps(ctx, {
    variants: [{ family: 'cactus0' }, { family: 'cactus1' }, { family: 'cactus2' }],
    count: 15, minDist: 0.2, inset: 0.87, clear: TOKEN_CLEARANCE, scale: [0.6, 1.35], tilt: 0.05, sink: 0.02, tintRange: 0.18,
  })
  addProps(ctx, { variants: [{ family: 'dryBrush' }], count: 52, minDist: 0.088, inset: 0.94, clear: 0.2, scale: [0.5, 1.25], tilt: 0.22, tintBias: 0.08 })
  // Desert grass is bleached straw, not pasture green: the tussock geometry is
  // shared with the wool tile, so the difference has to come out of the instance
  // tint, and on a green base a heavy warm bias is what turns it to hay.
  addProps(ctx, { variants: [{ family: 'tussock' }], count: 14, minDist: 0.16, inset: 0.93, clear: 0.3, rimBias: 1, scale: [0.45, 0.85], tilt: 0.25, tintRange: 0.2, warmRange: 0.1, tintBias: 0.2, warmBias: 0.22 })
  // Desert stone is sun-bleached, so it gets a much warmer instance tint than
  // the same boulders used on pasture and mountain.
  //
  // Counts are deliberately low now that the tile is tessellated finely enough
  // for its dune crests to survive to the screen. Twenty-two boulders and sixty
  // pebbles buried the sand under gravel, which is most of why the desert read
  // as an unfinished hex: an erg is mostly *empty*, and the emptiness is the
  // subject. What is left is pushed to the rim where drift piles against rock.
  addProps(ctx, {
    variants: [{ family: 'boulder0' }, { family: 'boulder1' }, { family: 'boulder2' }],
    count: 10, minDist: 0.2, inset: 0.91, clear: 0.34, rimBias: 1, scale: [0.5, 1.4], tilt: 0.26,
    tintRange: 0.14, warmRange: 0.03, tintBias: 0.2, warmBias: 0.16,
  })
  addProps(ctx, {
    variants: [{ family: 'pebble0' }, { family: 'pebble1' }, { family: 'pebble2' }],
    count: 26, minDist: 0.09, inset: 0.94, rimBias: 1, scale: [0.45, 1.2], tilt: 0.5, tintBias: 0.18, warmBias: 0.15,
  })
  addProps(ctx, { variants: [{ family: 'shard0' }, { family: 'shard1' }], count: 9, minDist: 0.18, inset: 0.92, clear: 0.34, rimBias: 1, scale: [0.35, 0.85], tilt: 0.32, tintRange: 0.18, warmRange: 0.04, tintBias: 0.18, warmBias: 0.16 })
}

const BIOMES: Record<Terrain, (ctx: Ctx) => void> = {
  lumber: forest,
  wool: pasture,
  grain: fields,
  brick: hills,
  ore: mountains,
  desert,
}

export const scatterTile = (
  terrain: Terrain,
  seed: number,
  height: (x: number, z: number) => number,
): PropInstance[] => {
  const out: PropInstance[] = []
  BIOMES[terrain]({ rng: makeRng(seed ^ 0x5bf03635), height, out })
  return out
}
