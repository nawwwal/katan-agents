import * as THREE from 'three'
import type { Terrain } from '../../game/types'
import { fbm, hashString, ridge, valueNoise, worley } from './noise'

/** Board hexes are pointy-top with circumradius 1 and corners at 60k+30 degrees. */
export const HEX_R = 1
export const HEX_APOTHEM = Math.sqrt(3) / 2
/** World Y of the island plateau. Roads and buildings are placed at 0.478. */
export const GROUND_Y = 0.46

/** 1 at the hex boundary, 0 at the centre. Independent of orientation. */
const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

export const hexNorm = (x: number, z: number) => {
  const a = Math.abs(x * 0.5 + z * 0.8660254)
  const b = Math.abs(x * -0.5 + z * 0.8660254)
  const c = Math.abs(x)
  return Math.max(a, b, c) / HEX_APOTHEM
}

/**
 * The number token's sight line, as a hard contract every tile obeys.
 *
 * A number is game state, not scenery, and it was being buried: on all three
 * ore tiles the massif rose in front of the disc and the token was invisible
 * from every legal camera position. Clearing props out of the middle never
 * fixed that, because the thing doing the occluding was the ground itself.
 *
 * So the rule is stated once, here, and both the relief and the scatter are
 * clamped against it. Draw a cone from the top of the token disc, opening
 * upward and outward at `SIGHT_TAN`; nothing on the tile may poke through it on
 * the side the camera can be. That is a *geometric* guarantee rather than a
 * tuned one -- if a peak is under the cone it cannot be between the eye and the
 * token, whatever the rig does inside its limits.
 *
 * `SIGHT_ARC` is why the mountains still get to be mountains. The rig clamps
 * azimuth to +-1.25rad about +Z, so the camera can never get behind the board;
 * the far third of every tile is out of the sight line no matter what and is
 * left completely unconstrained. The massifs now open toward the viewer and
 * pile up at the back, which is both the fix and a better composition than the
 * old ring of even peaks around a hidden disc.
 *
 * `SIGHT_TAN` corresponds to about 30 degrees of elevation, measured at the
 * *far* rim of the board where the grazing angle is worst: at the rig's shallow
 * polar limit the camera sits 8.9 units up and 15.9 out from the furthest tile.
 */
/** Local Y of the token group above the tile origin: the plinth's cap. */
export const TOKEN_LIFT = 0.34
/** Top of the painted face, plus a little margin. */
const SIGHT_BASE = TOKEN_LIFT + 0.1
/**
 * Measured, not guessed. The rig's shallowest polar is 1.05rad at distance
 * 15.3, which puts the camera 7.66 up and 13.26 out from the target; the
 * furthest tile centre is another 3.47 out, and the token top sits 0.86 above
 * the target plane. That worst case is 7.12 over 16.73, or tan 0.426.
 */
const SIGHT_TAN = 0.42
const SIGHT_ARC = 1.45

/**
 * Every token a tile's own geometry can reach: its own, and the six neighbours
 * one hex-step away. A tile's back wall is on the near side of the tile behind
 * it, so protecting only the local token just moves the problem one hex north.
 */
const TOKEN_SITES: Array<[number, number]> = [
  [0, 0],
  [2 * HEX_APOTHEM, 0], [-2 * HEX_APOTHEM, 0],
  [HEX_APOTHEM, 1.5], [-HEX_APOTHEM, 1.5],
  [HEX_APOTHEM, -1.5], [-HEX_APOTHEM, -1.5],
]

/**
 * The cone from one token. `radius` is the horizontal reach of whatever is
 * standing at (x, z): a spire is more than a metre wide, and testing only its
 * axis let one sit with its flank directly over the disc.
 */
const coneFrom = (x: number, z: number, radius: number) => {
  const d = Math.sqrt(x * x + z * z)
  // A wide object occupies a wedge of azimuth, so it counts as "in front" if
  // any part of that wedge is.
  const spread = radius >= d ? Math.PI / 2 : Math.asin(radius / Math.max(d, 1e-4))
  const facing = Math.max(0, Math.abs(Math.atan2(x, z)) - spread)
  const behind = smoothstep(SIGHT_ARC, SIGHT_ARC + 0.5, facing)
  return SIGHT_BASE + Math.max(0, d - radius) * SIGHT_TAN + behind * 4
}

/** Highest a tile-local point may be, in relief units above GROUND_Y. */
export const sightCeiling = (x: number, z: number, radius = 0) => {
  let limit = Infinity
  // The board is laid out with a slight rotation, so the ideal lattice above is
  // a few hundredths out from where the neighbouring tokens actually sit.
  // Padding the footprint absorbs that without pinning this module to whatever
  // orientation the board generator happens to use this week.
  const slack = radius + 0.09
  for (const [sx, sz] of TOKEN_SITES) limit = Math.min(limit, coneFrom(x - sx, z - sz, slack))
  return limit
}

/**
 * Rounded minimum. A hard `min` against the ceiling would shave the massif off
 * along a perfect cone and read as a machined bevel; blending over 0.12 keeps
 * the shoulder organic and still lands strictly below the limit.
 */
const smoothMin = (a: number, b: number, k: number) => {
  const t = Math.max(0, Math.min(1, 0.5 + (0.5 * (b - a)) / k))
  return a * t + b * (1 - t) - k * t * (1 - t)
}

/**
 * The clay pit's bench field, without the micro-relief on top.
 *
 * The old version stepped a clean function of radius, which produced concentric
 * contour rings on a cone -- the exact thing the client read as "not coming
 * through". A real pit is excavated from a couple of directions, so the benches
 * on one face sit at a different depth from the benches on the next and the
 * risers are cut, not eroded. Warping the radius by angle before quantising it
 * is what buys that, and it costs two sines.
 *
 * This is split out from `tileRelief` because the vertex shading needs its
 * *gradient*, and taking that off the full relief would just measure the ridged
 * noise. Everything the brick tile's colour does is derived from this one
 * function, so the paint cannot disagree with the shape -- which is the trap the
 * earlier texture-space terracing fell into.
 */
const brickBench = (x: number, z: number, s: number) => {
  // The workings are cut off-centre. Excavating from the middle outwards put the
  // deepest point of the pit directly under the number token, which left the
  // disc hanging over a hole -- and a pit centred on the tile centre is the
  // concentric read all over again.
  const px = x - Math.cos(s * 0.0011) * 0.3
  const pz = z - Math.sin(s * 0.0017) * 0.3
  const radial = Math.sqrt(px * px + pz * pz)
  const angle = Math.atan2(pz, px)
  // Two lobes, not three concentric rings. The reference pit is one working cut
  // into a plateau with a couple of bays in it, and the wall between the bays is
  // the tallest thing on the tile. Three evenly spaced rings around the centre
  // read as a contour map instead, so the angular warp is now strong enough to
  // pull the contours into lobes and there are fewer, taller steps.
  const face = Math.sin(angle * 2 + s * 0.0013) * 0.5 + Math.sin(angle * 3 - s * 0.0007) * 0.26
  const noise = fbm(x * 1.7 + s, z * 1.7, 3, s)
  const warped = Math.max(0, radial + face * 0.3 + (noise - 0.5) * 0.22)
  const benches = 2.2
  const field = warped * benches
  const band = field - Math.floor(field)
  // Sharp riser, dead-flat bench: the transition happens over the last sixth of
  // the band rather than being smeared across all of it.
  const step = (Math.floor(field) + smoothstep(0.82, 0.96, band)) / benches
  // The floor is flat, not a bowl. In the reference the pit bottom is a pale
  // worked pan with rubble on it, and a curved bottom would fight the benches
  // for the eye.
  const floor = -0.42 * smoothstep(0.9, 0.3, warped)
  const h = floor + step * 0.42
  // Flat pad under the number token, blended over the width of the disc. It is
  // a working level in the pit rather than a plug of untouched plateau, so it
  // sits below the rim and reads as the floor the barrows run across.
  const pad = smoothstep(0.5, 0.28, Math.sqrt(x * x + z * z))
  return h * (1 - pad) + -0.07 * pad
}

/**
 * Per-biome relief in world units, measured from GROUND_Y. Always fades to zero
 * at the hex boundary so neighbouring tiles meet as one continuous landmass and
 * roads and settlements keep sitting flush on the seam.
 */
export const tileRelief = (terrain: Terrain, x: number, z: number, seed: number): number => {
  const n = hexNorm(x, z)
  const fade = 1 - n * n * n * n
  if (fade <= 0) return 0
  const s = seed & 0xffff
  const radial = Math.sqrt(x * x + z * z)
  let h = 0
  switch (terrain) {
    case 'wool': {
      h = (fbm(x * 1.5 + s, z * 1.5, 3, s) - 0.5) * 0.09 + (fbm(x * 4 + s, z * 4, 2, s + 7) - 0.5) * 0.025
      break
    }
    case 'lumber': {
      h = (fbm(x * 1.3 + s, z * 1.3, 3, s) - 0.42) * 0.11 + (fbm(x * 5 + s, z * 5, 2, s + 3) - 0.5) * 0.02
      break
    }
    case 'grain': {
      // Broad tilled swell plus the furrow corduroy, oriented along +x.
      const furrow = Math.sin((z + fbm(x * 2, z * 2, 2, s) * 0.3) * 26) * 0.5 + 0.5
      h = (fbm(x * 1.2 + s, z * 1.2, 3, s) - 0.5) * 0.07 + furrow * 0.016
      break
    }
    case 'brick': {
      h = brickBench(x, z, s) + ridge(x * 3.4 + s, z * 3.4, 2, s + 11) * 0.018
      break
    }
    case 'ore': {
      // A massif standing off a genuinely flat quarry bench.
      //
      // The old ring peaked at radius 0.62 with a wide sigma, which meant it
      // still carried about 40% of its height at radius 0.3 -- directly under
      // the number token. That, not the props, is what buried the numbers. The
      // ring is now pushed out to 0.78 and tightened, and a bench mask holds
      // the inner third of the tile at zero, so the disc sits on a cut shelf
      // with the peaks out at the rim and corners where they belong.
      const ring = Math.exp(-Math.pow((radial - 0.64) / 0.30, 2))
      const crest = ridge(x * 1.7 + s, z * 1.7, 4, s)
      const lobes = 0.4 + 0.6 * Math.pow(Math.sin(Math.atan2(z, x) * 2.5 + s * 0.001) * 0.5 + 0.5, 0.7)
      const bench = smoothstep(0.34, 0.64, radial)
      // The massif is a cirque: low where it faces the camera, piling up round
      // the back. Without this the sight-line clamp would do the same job by
      // shaving the front off flat, and a shaved cone reads as a plateau. Doing
      // it in the relief means the shape is authored rather than trimmed.
      const back = radial > 1e-4 ? (1 - z / radial) * 0.5 : 0.5
      const cirque = 0.46 + 0.54 * Math.pow(back, 0.7)
      // Authored well above the sight ceiling on purpose. Tokens sit 1.73 apart,
      // so the tallest anything can be halfway between two of them is about
      // 0.94 -- and the previous pass fell so far short of that the massif read
      // as a grey plate. Over-driving the amplitude and letting the smooth clamp
      // take the top off puts the ridge line *at* its allowance instead of under
      // it, and the noise underneath means only the peaks actually clip.
      // Deliberately *not* saturating the sight ceiling. The tile only has about
      // 0.8 of headroom between the token and the cone, and if the ground eats
      // all of it there is nothing left for the crags to stand in -- which is
      // what turned this tile into a smooth grey dome. The relief is an apron;
      // the rock props are the mountain, and they have far better silhouettes.
      h = ring * (0.30 + crest * 0.5) * lobes * cirque
      // The cone takes the summits off, so the tile's ruggedness has to live in
      // the flanks instead. A second ridged octave under the clamp gives the
      // massif gullies and buttresses that survive being topped out.
      h += ridge(x * 4.3 + s, z * 4.3, 2, s + 21) * 0.10 * ring
      h += (fbm(x * 7 + s, z * 7, 3, s + 5) - 0.5) * 0.06
      // Flat means flat. Multiplying the micro-noise by the same mask is what
      // stops the shelf being a bench with gravel modelled into it.
      h *= bench
      // The working floor is scraped a little below the plateau, so the bench
      // reads as excavated rather than as a plug of untouched ground.
      h -= Math.exp(-Math.pow(radial / 0.44, 2)) * 0.05
      break
    }
    case 'desert': {
      // Two crossed dune trains, the second at a shallow angle, so the sand
      // reads as a drift field rather than corrugated iron.
      const warp = fbm(x * 1.1 + s, z * 1.1, 3, s) * 1.4
      const dune = Math.pow(Math.sin((x * 0.7 + z * 0.71) * 4.4 + warp * 2.2) * 0.5 + 0.5, 1.6)
      const cross = Math.pow(Math.sin((x * 0.96 - z * 0.28) * 2.6 + warp * 1.1) * 0.5 + 0.5, 2)
      h = dune * 0.2 + cross * 0.09 + (fbm(x * 3 + s, z * 3, 2, s + 9) - 0.5) * 0.026 - 0.015
      break
    }
  }
  // Every biome, not just the mountains: a wool hummock will never reach the
  // cone, but stating the rule once means no future relief can quietly bury a
  // number again.
  return smoothMin(h * fade, sightCeiling(x, z), 0.12)
}

export const tileSeed = (tileId: string) => hashString(`katan-tile-${tileId}`)

/**
 * Concentric-ring tessellation of the unit hex. Rings land exactly on the hex
 * outline so adjacent tiles share a watertight edge.
 */
const hexRings = (divisions: number) => {
  const positions: Array<[number, number]> = [[0, 0]]
  const ringStart: number[] = [0]
  for (let ring = 1; ring <= divisions; ring += 1) {
    ringStart.push(positions.length)
    const r = ring / divisions
    for (let corner = 0; corner < 6; corner += 1) {
      const a0 = ((60 * corner + 30) * Math.PI) / 180
      const a1 = ((60 * (corner + 1) + 30) * Math.PI) / 180
      const x0 = Math.cos(a0) * r
      const z0 = Math.sin(a0) * r
      const x1 = Math.cos(a1) * r
      const z1 = Math.sin(a1) * r
      for (let step = 0; step < ring; step += 1) {
        const t = step / ring
        positions.push([x0 + (x1 - x0) * t, z0 + (z1 - z0) * t])
      }
    }
  }
  ringStart.push(positions.length)

  const at = (ring: number, k: number) => {
    if (ring === 0) return 0
    const count = ring * 6
    return ringStart[ring] + ((k % count) + count) % count
  }

  const indices: number[] = []
  for (let ring = 1; ring <= divisions; ring += 1) {
    for (let sector = 0; sector < 6; sector += 1) {
      for (let i = 0; i < ring; i += 1) {
        // Each sector of the outer ring has one more vertex than the inner one,
        // so it emits `ring` up-triangles and `ring - 1` down-triangles.
        indices.push(at(ring, sector * ring + i), at(ring - 1, sector * (ring - 1) + i), at(ring, sector * ring + i + 1))
        if (i < ring - 1) {
          indices.push(at(ring, sector * ring + i + 1), at(ring - 1, sector * (ring - 1) + i), at(ring - 1, sector * (ring - 1) + i + 1))
        }
      }
    }
  }
  return { positions, indices }
}

const RING_CACHE = new Map<number, ReturnType<typeof hexRings>>()
const rings = (divisions: number) => {
  let cached = RING_CACHE.get(divisions)
  if (!cached) {
    cached = hexRings(divisions)
    RING_CACHE.set(divisions, cached)
  }
  return cached
}

export type TileSurface = {
  geometry: THREE.BufferGeometry
  /** Relief lookup used by scatter so props sit on the surface, not through it. */
  height: (x: number, z: number) => number
}

/**
 * Build a tile's displaced ground mesh. UVs are rotated per tile so nineteen
 * hexes never show the same texture orientation, and a low-frequency vertex
 * tint breaks up the remaining repetition.
 */
// 20 divisions put a vertex every 0.05 of a tile radius, and the clay pit's
// risers are about 0.044 wide -- so the mesh terracing was being sampled at
// roughly one vertex per step and averaged straight back out. Doubling it costs
// 19 tiles x 9.6k triangles, which is nothing, and it also lets the desert's
// dune crests and the ore massif's ridges survive to the screen.
export const createTileSurface = (terrain: Terrain, tileId: string, divisions = 40): TileSurface => {
  const seed = tileSeed(tileId)
  const { positions, indices } = rings(divisions)
  const count = positions.length
  const vertices = new Float32Array(count * 3)
  const uvs = new Float32Array(count * 2)
  const colors = new Float32Array(count * 3)
  const uvAngle = ((seed % 6) * 60 + (seed % 17)) * Math.PI / 180
  const cos = Math.cos(uvAngle)
  const sin = Math.sin(uvAngle)
  const height = (x: number, z: number) => tileRelief(terrain, x, z, seed)

  for (let i = 0; i < count; i += 1) {
    const [x, z] = positions[i]
    const y = height(x, z)
    vertices[i * 3] = x
    vertices[i * 3 + 1] = y
    vertices[i * 3 + 2] = z
    // Roughly three texture repeats across a tile. One repeat per hex put a
    // 2048px map behind about 200 screen pixels, so every mip above the fourth
    // was thrown away and the tile read as its own average colour -- which is
    // exactly the "not that sharp" the client saw. The baked maps are exactly
    // seamless, so tiling them harder is free, and the per-tile UV rotation
    // below stops nineteen hexes agreeing about where the pattern starts.
    uvs[i * 2] = (x * cos - z * sin) * 1.55 + 0.5
    uvs[i * 2 + 1] = (x * sin + z * cos) * 1.55 + 0.5
    // Macro tint: sun-bleached crowns, damp hollows, and a slightly darker rim
    // so the seam between tiles reads as shade rather than a plastic edge.
    const macro = fbm(x * 0.9 + seed * 0.013, z * 0.9, 3, seed)
    const rim = 1 - 0.16 * Math.pow(hexNorm(x, z), 6)
    let tint = (0.9 + macro * 0.24) * rim
    let warm = 1
    let cool = 1
    if (terrain === 'brick') {
      // Wet cut faces, dry benches.
      //
      // Depth alone was doing this before and depth alone is not enough: it
      // grades the tile from rim to floor, which at board distance is a soft
      // vignette, not strata. What makes the reference read as an excavation is
      // that the *risers* -- the vertical cut faces between benches -- are dark,
      // saturated, freshly-exposed wet clay, while the treads on either side of
      // them are pale dust. That is a hard edge repeated three times across the
      // tile, and it is the thing the eye counts as terracing.
      //
      // The riser mask is the gradient of the bench field itself, so it lands
      // exactly on the geometry's own steps rather than on a second contour
      // pattern quantised in texture space. That mistake made the tile look
      // like marbled paper last round.
      const d = 0.05
      const gx = brickBench(x + d, z, seed & 0xffff) - brickBench(x - d, z, seed & 0xffff)
      const gz = brickBench(x, z + d, seed & 0xffff) - brickBench(x, z - d, seed & 0xffff)
      const riser = smoothstep(0.22, 0.9, Math.hypot(gx, gz) / (2 * d))
      const pan = smoothstep(-0.08, -0.32, y)
      // The baked albedo carries pale dust patches that were built to be read
      // under a softer key. Against the current grade they blew out and the tile
      // went molten -- fired clay is a *dark* pigment and the reference plateau
      // sits well below mid grey. Pulling the whole tile down is what turns lava
      // back into terracotta; the pan and the risers then have somewhere to go.
      // The pan is *dust*, not slate: at cool 1.26 it went pale blue and read as
      // a puddle under the token. Dried clay loses chroma but keeps its warm
      // bias, so most of the lift belongs in the overall value, not in blue.
      // Riser darkening is back at full strength. It was cut to 0.15 while the
      // render was double-counting the baked ARH occlusion against a screen
      // space pass at 1.35 and the pit interior was going to mud. That is
      // fixed -- SSAO is down to 0.32 and the fill is up -- so the risers get to
      // carry the "cut, still damp" read again, which is the thing that makes
      // the eye count the terracing.
      tint *= 0.88 * (1 + pan * 0.34) * (1 - riser * 0.28)
      warm = (1 - pan * 0.03) * (1 + riser * 0.2)
      cool = (1 + pan * 0.12) * (1 - riser * 0.34)
    }
    if (terrain === 'desert') {
      // The baked sand is very light by design so the ripple normals have
      // somewhere to go. Left alone at this exposure the tile clips to a white
      // plate, so the vertex pass carries the warmth back into it.
      tint *= 0.86
      warm = 1.1
      cool = 0.87
    }
    colors[i * 3] = tint * warm
    colors[i * 3 + 1] = tint * (0.985 + macro * 0.03)
    colors[i * 3 + 2] = tint * (0.97 + macro * 0.02) * cool
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return { geometry, height }
}

/** Small helper for scatter: pick a point inside the hex, biased away from the rim. */
export const insideHex = (u: number, v: number, inset = 0.86) => {
  const r = Math.sqrt(u) * inset
  const a = v * Math.PI * 2
  let x = Math.cos(a) * r
  let z = Math.sin(a) * r
  const n = hexNorm(x, z)
  if (n > inset) {
    const k = inset / n
    x *= k
    z *= k
  }
  return [x, z] as const
}

export const surfaceNoise = { fbm, ridge, valueNoise, worley }
