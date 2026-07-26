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
      // A massif wrapping a working quarry floor, so the peaks read as one
      // mountain and number tokens still sit on flat ground in the middle.
      const ring = Math.exp(-Math.pow((radial - 0.62) / 0.34, 2))
      const crest = ridge(x * 1.7 + s, z * 1.7, 4, s)
      const lobes = 0.4 + 0.6 * Math.pow(Math.sin(Math.atan2(z, x) * 2.5 + s * 0.001) * 0.5 + 0.5, 0.7)
      h = ring * (0.5 + crest * 0.95) * lobes - Math.exp(-Math.pow(radial / 0.36, 2)) * 0.1
      h += (fbm(x * 5 + s, z * 5, 3, s + 5) - 0.5) * 0.06
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
  return h * fade
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
      // Riser darkening is deliberately light. It exists to say "this face was
      // cut and is still damp", not to draw the shadow -- the sun does that now,
      // and at 0.3 the two stacked up and the pit interior went to mud.
      tint *= 0.88 * (1 + pan * 0.34) * (1 - riser * 0.15)
      warm = (1 - pan * 0.03) * (1 + riser * 0.2)
      cool = (1 + pan * 0.12) * (1 - riser * 0.34)
    }
    if (terrain === 'desert') {
      // The baked sand is very light by design so the ripple normals have
      // somewhere to go. Left alone at this exposure the tile clips to a white
      // plate, so the vertex pass carries the warmth back into it.
      tint *= 0.86
      warm = 1.07
      cool = 0.9
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
