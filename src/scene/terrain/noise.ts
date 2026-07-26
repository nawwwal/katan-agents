// Deterministic noise helpers. Everything the terrain scatters or paints is
// derived from these, seeded off tile ids, so the same board always renders the
// same island.

export const hashString = (value: string): number => {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export type Rng = () => number

export const makeRng = (seed: number): Rng => {
  let state = (seed || 1) >>> 0
  return () => {
    state += 0x6d2b79f5
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Uniform in [min, max). */
export const range = (rng: Rng, min: number, max: number) => min + rng() * (max - min)

/** Roughly gaussian in [-1, 1], useful for tint and scale jitter. */
export const jitter = (rng: Rng) => (rng() + rng() + rng()) / 1.5 - 1

const hash2 = (x: number, y: number, seed: number) => {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed, 2246822519)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

const smooth = (t: number) => t * t * (3 - 2 * t)

export const valueNoise = (x: number, y: number, seed = 0) => {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = smooth(x - xi)
  const yf = smooth(y - yi)
  const a = hash2(xi, yi, seed)
  const b = hash2(xi + 1, yi, seed)
  const c = hash2(xi, yi + 1, seed)
  const d = hash2(xi + 1, yi + 1, seed)
  return (a + (b - a) * xf) * (1 - yf) + (c + (d - c) * xf) * yf
}

export const fbm = (x: number, y: number, octaves = 4, seed = 0, lacunarity = 2.07, gain = 0.5) => {
  let amplitude = 1
  let frequency = 1
  let sum = 0
  let norm = 0
  for (let i = 0; i < octaves; i += 1) {
    sum += valueNoise(x * frequency, y * frequency, seed + i * 131) * amplitude
    norm += amplitude
    amplitude *= gain
    frequency *= lacunarity
  }
  return sum / norm
}

/** Ridged variant — sharp creases, good for rock strata and dune crests. */
export const ridge = (x: number, y: number, octaves = 4, seed = 0) => {
  let amplitude = 1
  let frequency = 1
  let sum = 0
  let norm = 0
  for (let i = 0; i < octaves; i += 1) {
    const n = 1 - Math.abs(valueNoise(x * frequency, y * frequency, seed + i * 977) * 2 - 1)
    sum += n * n * amplitude
    norm += amplitude
    amplitude *= 0.52
    frequency *= 2.13
  }
  return sum / norm
}

/** Cheap Worley / cellular F1 distance in [0, 1]. Pebbles, scree, clay pits. */
export const worley = (x: number, y: number, seed = 0) => {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  let best = 4
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const cx = xi + dx
      const cy = yi + dy
      const px = cx + hash2(cx, cy, seed)
      const py = cy + hash2(cx, cy, seed + 5171)
      const d = (px - x) * (px - x) + (py - y) * (py - y)
      if (d < best) best = d
    }
  }
  return Math.min(1, Math.sqrt(best))
}
