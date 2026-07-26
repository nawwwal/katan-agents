// Rasterise a painter into finished map buffers.
//
// This is the part that could never run at load time. Each texel is 2x2
// supersampled, the normal map is a full-resolution Sobel of the height field
// averaged down as vectors, and ambient occlusion is a 12-direction horizon
// sweep over that same height field. On a 2048 albedo that is roughly 50M
// painter evaluations and 130M occlusion samples per material — seconds offline,
// impossible in a frame budget.

import { clamp01 } from './noise.mjs'
import { toSrgb } from './palette.mjs'

const SS = 2

/** Evaluate the painter over a size x size grid with SSxSS supersampling. */
export const rasterise = (painter, size) => {
  const linear = new Float32Array(size * size * 3)
  const height = new Float32Array(size * size)
  const rough = new Float32Array(size * size)
  const out = { r: 0, g: 0, b: 0, h: 0, rough: 1 }
  const inv = 1 / (SS * SS)
  const step = 1 / (size * SS)
  const halfStep = step * 0.5

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0
      let g = 0
      let b = 0
      let h = 0
      let ro = 0
      for (let sy = 0; sy < SS; sy += 1) {
        const v = (y * SS + sy) * step + halfStep
        for (let sx = 0; sx < SS; sx += 1) {
          const u = (x * SS + sx) * step + halfStep
          out.r = 0; out.g = 0; out.b = 0; out.h = 0; out.rough = 1
          painter(u, v, out)
          r += out.r; g += out.g; b += out.b; h += out.h; ro += out.rough
        }
      }
      const i = y * size + x
      linear[i * 3] = r * inv
      linear[i * 3 + 1] = g * inv
      linear[i * 3 + 2] = b * inv
      height[i] = h * inv
      rough[i] = ro * inv
    }
  }
  return { linear, height, rough, size }
}

/** Linear-light float RGB to packed sRGB bytes. */
export const encodeAlbedo = (linear, size) => {
  const bytes = Buffer.allocUnsafe(size * size * 3)
  for (let i = 0; i < size * size; i += 1) {
    bytes[i * 3] = Math.round(clamp01(toSrgb(clamp01(linear[i * 3]))) * 255)
    bytes[i * 3 + 1] = Math.round(clamp01(toSrgb(clamp01(linear[i * 3 + 1]))) * 255)
    bytes[i * 3 + 2] = Math.round(clamp01(toSrgb(clamp01(linear[i * 3 + 2]))) * 255)
  }
  return bytes
}

/** Wrapping box downsample of a single-channel float field. */
export const downsample = (field, size, target) => {
  if (target === size) return field
  const factor = size / target
  if (!Number.isInteger(factor)) throw new Error(`downsample ${size} -> ${target} is not integral`)
  const out = new Float32Array(target * target)
  const inv = 1 / (factor * factor)
  for (let y = 0; y < target; y += 1) {
    for (let x = 0; x < target; x += 1) {
      let sum = 0
      for (let dy = 0; dy < factor; dy += 1) {
        const row = (y * factor + dy) * size
        for (let dx = 0; dx < factor; dx += 1) sum += field[row + x * factor + dx]
      }
      out[y * target + x] = sum * inv
    }
  }
  return out
}

/**
 * Tangent-space normal map, OpenGL convention (+Y up), from a wrapping Sobel of
 * the height field. Computed at full resolution then averaged as vectors and
 * renormalised, which preserves the mean slope — downsampling the height first
 * would quietly flatten every fine detail instead.
 */
export const normalMap = (height, size, target, relief) => {
  const scale = relief * size * 0.5
  const nx = new Float32Array(size * size)
  const ny = new Float32Array(size * size)
  const nz = new Float32Array(size * size)
  const at = (x, y) => height[(((y % size) + size) % size) * size + (((x % size) + size) % size)]
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const tl = at(x - 1, y - 1); const t = at(x, y - 1); const tr = at(x + 1, y - 1)
      const l = at(x - 1, y); const r = at(x + 1, y)
      const bl = at(x - 1, y + 1); const b = at(x, y + 1); const br = at(x + 1, y + 1)
      const dx = ((tr + 2 * r + br) - (tl + 2 * l + bl)) * 0.25 * scale
      const dy = ((bl + 2 * b + br) - (tl + 2 * t + tr)) * 0.25 * scale
      const i = y * size + x
      // Texture v runs downward while tangent-space +Y runs up, so dy is negated.
      nx[i] = -dx
      ny[i] = dy
      nz[i] = 1
    }
  }

  const factor = size / target
  const bytes = Buffer.allocUnsafe(target * target * 3)
  for (let y = 0; y < target; y += 1) {
    for (let x = 0; x < target; x += 1) {
      let ax = 0; let ay = 0; let az = 0
      for (let dy = 0; dy < factor; dy += 1) {
        const row = (y * factor + dy) * size
        for (let dx = 0; dx < factor; dx += 1) {
          const i = row + x * factor + dx
          const len = Math.sqrt(nx[i] * nx[i] + ny[i] * ny[i] + nz[i] * nz[i])
          ax += nx[i] / len; ay += ny[i] / len; az += nz[i] / len
        }
      }
      const len = Math.sqrt(ax * ax + ay * ay + az * az) || 1
      const o = (y * target + x) * 3
      bytes[o] = Math.round(clamp01((ax / len) * 0.5 + 0.5) * 255)
      bytes[o + 1] = Math.round(clamp01((ay / len) * 0.5 + 0.5) * 255)
      bytes[o + 2] = Math.round(clamp01((az / len) * 0.5 + 0.5) * 255)
    }
  }
  return bytes
}

const DIRECTIONS = 12
const STEPS = 10

/**
 * Horizon-based ambient occlusion over the wrapping height field.
 *
 * For each texel and each azimuth the sweep tracks the maximum elevation angle
 * blocked by the terrain, then integrates sin(horizon) across azimuths. That is
 * the fraction of the hemisphere the surface cannot see. It is the cheap, exact
 * version of what SSAO approximates every frame at runtime, and once it is in
 * the texture the runtime does not need SSAO on terrain at all.
 *
 * Note there is deliberately no directional (sun) term here. Terrain tile UVs
 * are rotated by a per-tile angle in hex.ts, so any light direction baked into
 * texture space would point somewhere different on every hex. Occlusion is
 * rotation invariant; a key light is not.
 */
export const occlusionMap = (height, size, relief, strength = 1) => {
  const scale = relief * size
  const ao = new Float32Array(size * size)
  const radii = []
  for (let s = 0; s < STEPS; s += 1) {
    radii.push(1.4 * Math.pow(1.55, s))
  }
  const dirs = []
  for (let d = 0; d < DIRECTIONS; d += 1) {
    const a = (d / DIRECTIONS) * Math.PI * 2
    dirs.push([Math.cos(a), Math.sin(a)])
  }
  const at = (x, y) => height[(((y % size) + size) % size) * size + (((x % size) + size) % size)]

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const h0 = height[y * size + x] * scale
      let occ = 0
      for (let d = 0; d < DIRECTIONS; d += 1) {
        const [dx, dy] = dirs[d]
        let maxTan = 0
        for (let s = 0; s < STEPS; s += 1) {
          const r = radii[s]
          const hs = at(Math.round(x + dx * r), Math.round(y + dy * r)) * scale
          const t = (hs - h0) / r
          if (t > maxTan) maxTan = t
        }
        occ += maxTan / Math.sqrt(1 + maxTan * maxTan)
      }
      ao[y * size + x] = clamp01(1 - (occ / DIRECTIONS) * strength)
    }
  }
  return ao
}

/**
 * Pack ambient occlusion, roughness and height into one RGB texture.
 * R = AO   -> material.aoMap
 * G = rough-> material.roughnessMap
 * B = height (spare channel; NOT metalness, keep metalness at 0)
 */
export const packArh = (ao, rough, height, size) => {
  const bytes = Buffer.allocUnsafe(size * size * 3)
  for (let i = 0; i < size * size; i += 1) {
    bytes[i * 3] = Math.round(clamp01(ao[i]) * 255)
    bytes[i * 3 + 1] = Math.round(clamp01(rough[i]) * 255)
    bytes[i * 3 + 2] = Math.round(clamp01(height[i]) * 255)
  }
  return bytes
}
