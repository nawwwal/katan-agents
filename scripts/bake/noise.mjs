// Periodic lattice noise for the offline bake.
//
// This is a port of src/scene/terrain/noise.ts with one structural change that
// matters more than anything else in the pipeline: every generator here is
// exactly tileable. The runtime version samples an unbounded lattice, so a
// texture painted with it shows a hard discontinuity wherever the UV crosses an
// integer — and terrain UVs run -0.28..1.28 with RepeatWrapping, so that seam
// lands on every hex. Wrapping the integer cell index by the frequency removes
// it. Frequencies must therefore be integers, and fbm has to use lacunarity 2.
//
// Everything is a pure function of (coords, frequency, seed). No RNG state, no
// Math.random, so two runs of the bake produce byte-identical output.

export const hashString = (value) => {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

const hash2 = (x, y, seed) => {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 2246822519)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

const wrapi = (v, p) => ((v % p) + p) % p
const smooth = (t) => t * t * t * (t * (t * 6 - 15) + 10)

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
export const mix = (a, b, t) => a + (b - a) * t
export const smoothstep = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0))
  return t * t * (3 - 2 * t)
}
export const fract = (v) => v - Math.floor(v)

/**
 * Tileable value noise. `fx`/`fy` are cycles across the unit square and must be
 * positive integers. Quintic interpolation (rather than the runtime's cubic)
 * because offline we can afford C2 continuity, and it keeps the Sobel-derived
 * normal map free of the faint lattice grid the cubic version leaves behind.
 */
export const vnoise = (u, v, fx, fy, seed) => {
  const x = u * fx
  const y = v * fy
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = smooth(x - xi)
  const yf = smooth(y - yi)
  const x0 = wrapi(xi, fx)
  const x1 = wrapi(xi + 1, fx)
  const y0 = wrapi(yi, fy)
  const y1 = wrapi(yi + 1, fy)
  const a = hash2(x0, y0, seed)
  const b = hash2(x1, y0, seed)
  const c = hash2(x0, y1, seed)
  const d = hash2(x1, y1, seed)
  return (a + (b - a) * xf) * (1 - yf) + (c + (d - c) * xf) * yf
}

/** Isotropic convenience wrapper. */
export const noise = (u, v, f, seed) => vnoise(u, v, f, f, seed)

/**
 * Tileable fbm. Lacunarity is locked to 2 so each octave's period stays an
 * integer multiple of the base and the whole stack wraps.
 */
export const fbm = (u, v, f, octaves, seed, gain = 0.5) => {
  let amplitude = 1
  let sum = 0
  let norm = 0
  let fx = f
  for (let i = 0; i < octaves; i += 1) {
    sum += vnoise(u, v, fx, fx, seed + i * 131) * amplitude
    norm += amplitude
    amplitude *= gain
    fx *= 2
  }
  return sum / norm
}

/** Anisotropic fbm — stretched cells, for streaks, strata and combed grass. */
export const fbmAniso = (u, v, fx, fy, octaves, seed, gain = 0.5) => {
  let amplitude = 1
  let sum = 0
  let norm = 0
  let ax = fx
  let ay = fy
  for (let i = 0; i < octaves; i += 1) {
    sum += vnoise(u, v, ax, ay, seed + i * 197) * amplitude
    norm += amplitude
    amplitude *= gain
    ax *= 2
    ay *= 2
  }
  return sum / norm
}

/** Ridged multifractal — sharp creases. Rock strata, dune crests, mud cracks. */
export const ridge = (u, v, fx, fy, octaves, seed, gain = 0.52) => {
  let amplitude = 1
  let sum = 0
  let norm = 0
  let ax = fx
  let ay = fy
  for (let i = 0; i < octaves; i += 1) {
    const n = 1 - Math.abs(vnoise(u, v, ax, ay, seed + i * 977) * 2 - 1)
    sum += n * n * amplitude
    norm += amplitude
    amplitude *= gain
    ax *= 2
    ay *= 2
  }
  return sum / norm
}

/**
 * Tileable Worley. Returns F1 and F2 distances plus a stable per-cell id, so a
 * caller can tint individual cells (moss patches, pebbles, clay plates) rather
 * than only reading the distance field.
 */
export const worley = (u, v, f, seed, out = { f1: 0, f2: 0, id: 0, cx: 0, cy: 0 }) => {
  const x = u * f
  const y = v * f
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  let f1 = 8
  let f2 = 8
  let id = 0
  let bx = 0
  let by = 0
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const cx = xi + dx
      const cy = yi + dy
      const wx = wrapi(cx, f)
      const wy = wrapi(cy, f)
      const px = cx + hash2(wx, wy, seed)
      const py = cy + hash2(wx, wy, seed + 5171)
      const ex = px - x
      const ey = py - y
      const d = Math.sqrt(ex * ex + ey * ey)
      if (d < f1) {
        f2 = f1
        f1 = d
        id = hash2(wx, wy, seed + 991)
        bx = px
        by = py
      } else if (d < f2) {
        f2 = d
      }
    }
  }
  out.f1 = Math.min(1, f1)
  out.f2 = Math.min(1, f2)
  out.id = id
  out.cx = bx
  out.cy = by
  return out
}

const CELL = { f1: 0, f2: 0, id: 0, cx: 0, cy: 0 }

/** F2-F1 crack network in 0..1, 0 on the cell walls. Mud cracks, rock fracture. */
export const crackle = (u, v, f, seed) => {
  worley(u, v, f, seed, CELL)
  return Math.min(1, CELL.f2 - CELL.f1)
}

/**
 * Periodic domain warp. Because the warp field itself wraps and the field being
 * warped wraps with the same period, the composition still tiles exactly.
 */
export const warp = (u, v, f, amount, seed, out) => {
  out[0] = u + (fbm(u, v, f, 3, seed) - 0.5) * amount
  out[1] = v + (fbm(u, v, f, 3, seed + 7919) - 0.5) * amount
  return out
}

/** Signed sine wave over an integer number of cycles, so it tiles. */
export const wave = (t, cycles) => Math.sin(t * cycles * Math.PI * 2)

/** Sawtooth in 0..1 over an integer number of cycles. */
export const saw = (t, cycles) => fract(t * cycles)

/** Triangle in 0..1 over an integer number of cycles. */
export const tri = (t, cycles) => {
  const s = fract(t * cycles)
  return s < 0.5 ? s * 2 : 2 - s * 2
}

/**
 * Hard-edged streak from a smooth field. Value noise is C2 continuous, which is
 * why a raw streak field reads as an airbrushed smear rather than as blades of
 * grass or fallen needles. Narrowing the transition to a couple of texels turns
 * the same field into crisp strokes that still mip down cleanly.
 */
export const stroke = (field, centre, width) => smoothstep(centre - width, centre + width, field)

/** Deterministic per-index float in 0..1. Used to place discrete props. */
export const rand1 = (i, seed) => hash2(i, 0x9e37, seed)

/** Rounded-box signed distance, negative inside. Bricks, planks, roof tiles. */
export const sdRoundBox = (px, py, hx, hy, r) => {
  const qx = Math.abs(px) - hx + r
  const qy = Math.abs(py) - hy + r
  const ox = Math.max(qx, 0)
  const oy = Math.max(qy, 0)
  return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(qx, qy), 0) - r
}
