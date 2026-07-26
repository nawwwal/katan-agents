// Piece materials, ported from src/scene/structures/textures.ts.
//
// The runtime originals are drawn with canvas2d fills, which means they cannot
// run in Node and, more importantly, they do not tile: a rounded rect drawn at
// x=0 is clipped rather than wrapped, so every masonry wall has a visible seam
// down one edge. Rebuilt here as per-texel signed-distance evaluation on a
// wrapping cell grid, which tiles exactly and gives clean bevels for free.
//
// Palettes are held close to the shipped ones so the pieces do not change
// character; what changes is that the detail is now real geometry in the height
// field rather than alpha-blended blobs.

import { blend, lerp3, rgb, saturate, set2, shade } from './palette.mjs'
import {
  clamp01, crackle, fbm, fbmAniso, fract, noise, ridge, sdRoundBox,
  smoothstep, tri, vnoise, warp, worley,
} from './noise.mjs'

const W = [0, 0]
const W2 = [0, 0, 0]
const CELL = { f1: 0, f2: 0, id: 0, cx: 0, cy: 0 }

/**
 * Staggered block course evaluated as an SDF. Returns the distance to the block
 * edge (negative inside), the block's stable id, and local coordinates.
 */
const blockAt = (u, v, rows, columns, stagger, jitter, seed, out) => {
  const y = v * rows
  const row = Math.floor(y)
  const ry = y - row
  const rowWrapped = ((row % rows) + rows) % rows
  const offset = stagger && rowWrapped % 2 === 1 ? 0.5 : 0
  const x = u * columns + offset
  const col = Math.floor(x)
  const rx = x - col
  const colWrapped = ((col % columns) + columns) % columns
  const id = vnoise((colWrapped + 0.5) / columns, (rowWrapped + 0.5) / rows, columns, rows, seed)
  const wobbleX = (fract(id * 31.7) - 0.5) * jitter
  const wobbleY = (fract(id * 17.3) - 0.5) * jitter * 0.6
  out.id = id
  out.lx = (rx - 0.5) + wobbleX
  out.ly = (ry - 0.5) + wobbleY
  out.row = rowWrapped
  out.col = colWrapped
  return out
}

const BLOCK = { id: 0, lx: 0, ly: 0, row: 0, col: 0 }

/** Shared builder for masonry, cobble kerbs and stacked quay stone. */
const blockPainter = ({ rows, columns, base, mortar, jitter, round, stagger, seed, roughRange, wear }) => {
  const BASE = rgb(base)
  // A lighter draw of the same stone, so a course is not one flat colour.
  const BASE_LIT = rgb(base).map((c) => Math.min(1, c * 1.32))
  const MORTAR = rgb(mortar)
  const WEAR = rgb(wear)
  return (u, v, out) => {
    // Mortar bed first: coarse sandy render with its own grit.
    set2(out, MORTAR, MORTAR, 0)
    const grit = noise(u, v, 256, seed + 7)
    shade(out, 0.86 + grit * 0.28)

    blockAt(u, v, rows, columns, stagger, jitter, seed, BLOCK)
    const half = 0.5 - 0.5 / Math.min(rows, columns) * 0.6
    const d = sdRoundBox(BLOCK.lx, BLOCK.ly, half * 0.92, half * 0.90, round)
    const face = smoothstep(0.010, -0.006, d)
    const bevel = smoothstep(-0.004, -0.045, d)

    const tone = 0.80 + fract(BLOCK.id * 11.9) * 0.42
    lerp3(W2, BASE, BASE_LIT, fract(BLOCK.id * 5.3))
    W2[0] *= tone
    W2[1] *= tone
    W2[2] *= tone
    blend(out, W2, face)

    // Per-stone weathering: mineral staining, pitting, and a chipped corner or
    // two. Without this every block in the course reads identical.
    const stain = fbm(u + BLOCK.id, v, 12, 4, seed + 41)
    blend(out, WEAR, face * smoothstep(0.52, 0.88, stain) * 0.5)
    const pit = smoothstep(0.02, 0.0, crackle(u, v, 64, seed + 97))
    shade(out, 1 - face * pit * 0.30)

    // Ambient darkening down in the mortar joint.
    shade(out, 1 - (1 - face) * 0.34)
    // Lit top arris, so each course catches an edge highlight.
    const arris = smoothstep(0.0, -0.018, d) * smoothstep(0.0, -0.25, BLOCK.ly)
    shade(out, 1 + arris * 0.10)

    out.h = clamp01(0.18 + face * 0.62 - (face - bevel) * 0.12 + grit * 0.05 - pit * 0.10 + (fract(BLOCK.id * 3.7) - 0.5) * 0.06 * face)
    out.rough = clamp01(roughRange[1] - face * (roughRange[1] - roughRange[0]) * (0.4 + fract(BLOCK.id * 23.1) * 0.6) + pit * 0.06)
  }
}

export const masonry = blockPainter({
  rows: 9, columns: 7, stagger: true, jitter: 0.10, round: 0.05, seed: 11,
  base: '#cdbea0', mortar: '#8b8069', wear: '#9a8f74', roughRange: [0.62, 0.92],
})

export const cobble = blockPainter({
  rows: 16, columns: 16, stagger: true, jitter: 0.16, round: 0.22, seed: 29,
  base: '#bab098', mortar: '#6d6350', wear: '#8e8570', roughRange: [0.55, 0.90],
})

export const quay = blockPainter({
  rows: 7, columns: 6, stagger: true, jitter: 0.12, round: 0.08, seed: 71,
  base: '#7e807e', mortar: '#4c4b46', wear: '#5f6a63', roughRange: [0.70, 0.95],
})

// --------------------------------------------------------------- plaster ----

const PLASTER = rgb('#e2d6b8')
const PLASTER_WARM = rgb('#f2e9cf')
const PLASTER_DIRT = rgb('#b7a888')
const PLASTER_RENDER = rgb('#96886a')

export const plaster = (u, v, out) => {
  warp(u, v, 4, 0.05, 53, W)
  set2(out, PLASTER, PLASTER_WARM, smoothstep(0.30, 0.75, fbm(W[0], W[1], 5, 4, 53)))
  // Trowel sweeps.
  const trowel = fbmAniso(u, v, 6, 40, 3, 149)
  shade(out, 0.95 + trowel * 0.10)
  // Rain-run dirt down the wall and grime settling at the bottom of a course.
  blend(out, PLASTER_DIRT, smoothstep(0.58, 0.92, fbmAniso(u, v, 22, 5, 3, 227)) * 0.35)
  // Chipped patches revealing the coarse render underneath.
  worley(u, v, 9, 311, CELL)
  const chip = smoothstep(0.20, 0.10, CELL.f1) * smoothstep(0.70, 0.90, CELL.id)
  blend(out, PLASTER_RENDER, chip * 0.8)
  const aggregate = noise(u, v, 320, 389)
  shade(out, 1 - chip * (1 - aggregate) * 0.25)
  out.h = clamp01(0.62 + (trowel - 0.5) * 0.18 - chip * 0.34 + chip * aggregate * 0.12 + (noise(u, v, 160, 431) - 0.5) * 0.05)
  out.rough = clamp01(0.88 + chip * 0.09 - trowel * 0.04)
}

// ------------------------------------------------------------------ roof ----
// Near-white base so a player colour tints it cleanly.

const ROOF_TILE = rgb('#ece4d6')
const ROOF_TILE_DEEP = rgb('#c9bda9')
const ROOF_SHADOW = rgb('#4a3126')
const ROOF_MOSS = rgb('#8f9a6b')

export const roof = (u, v, out) => {
  const rows = 11
  const columns = 13
  const y = v * rows
  const row = Math.floor(y)
  const ry = y - row
  const rowWrapped = ((row % rows) + rows) % rows
  const offset = rowWrapped % 2 === 1 ? 0.5 : 0
  const x = u * columns + offset
  const col = Math.floor(x)
  const rx = x - col
  const id = vnoise((((col % columns) + columns) % columns + 0.5) / columns, (rowWrapped + 0.5) / rows, columns, rows, 97)

  // Barrel profile across the tile: a rounded pan with a lit crown.
  const barrel = Math.sin(rx * Math.PI)
  const crown = Math.pow(barrel, 0.45)
  // Course overlap: the bottom eighth of every row is in the shadow of the row
  // above, which is what makes tiled roofs read as courses and not as stripes.
  const lap = smoothstep(0.84, 0.97, ry)

  const tone = 0.84 + fract(id * 7.9) * 0.34
  set2(out, ROOF_TILE_DEEP, ROOF_TILE, crown)
  shade(out, tone)
  shade(out, 1 - lap * 0.55)
  blend(out, ROOF_SHADOW, lap * 0.35)

  // Weathering: moss in the pans, chalky bloom on the crowns.
  const damp = fbm(u, v, 7, 4, 173) * (1 - crown)
  blend(out, ROOF_MOSS, smoothstep(0.52, 0.86, damp) * 0.45)
  const grain = noise(u, v, 384, 211)
  shade(out, 0.96 + grain * 0.08)

  out.h = clamp01(0.16 + crown * 0.70 - lap * 0.60 + (fract(id * 13.3) - 0.5) * 0.06 + grain * 0.03)
  out.rough = clamp01(0.78 + (1 - crown) * 0.14 + smoothstep(0.52, 0.86, damp) * 0.08)
}

// ---------------------------------------------------------------- timber ----

const TIMBER_DARK = rgb('#5a3f28')
const TIMBER_MID = rgb('#8a6440')
const TIMBER_LIT = rgb('#a8834f')

/** Shared wood grain: rings stretched along +u with a slow wander. */
const woodGrain = (u, v, rings, seed) => {
  const wander = (fbm(u, v, 4, 3, seed) - 0.5) * 0.09
  const t = v + wander
  return { ring: tri(t, rings), fibre: fbmAniso(u, v, 12, 256, 3, seed + 17), wander }
}

export const timber = (u, v, out) => {
  const g = woodGrain(u, v, 17, 131)
  set2(out, TIMBER_DARK, TIMBER_MID, smoothstep(0.20, 0.85, Math.pow(g.ring, 0.7)))
  blend(out, TIMBER_LIT, clamp01((g.fibre - 0.55) * 2.2) * 0.35)
  shade(out, 1 - clamp01((0.45 - g.fibre) * 2.2) * 0.22)
  // Knots. A couple per tile, with the grain visibly bending round them.
  worley(u, v, 4, 197, CELL)
  const knot = smoothstep(0.14, 0.02, CELL.f1) * smoothstep(0.80, 0.95, CELL.id)
  shade(out, 1 - knot * 0.55)
  // Splits and saw marks.
  const split = smoothstep(0.94, 1.0, ridge(u, v, 3, 48, 3, 263))
  shade(out, 1 - split * 0.45)
  out.h = clamp01(0.52 + (g.ring - 0.5) * 0.24 + (g.fibre - 0.5) * 0.30 - knot * 0.30 - split * 0.40)
  out.rough = clamp01(0.86 - g.ring * 0.06 + knot * 0.06 + split * 0.05)
}

// ----------------------------------------------------------------- plank ----

const PLANK_GAP = rgb('#3a2718')
const PLANK_BASE = rgb('#c19468')
const PLANK_DARK = rgb('#8d6845')
const NAIL = rgb('#3b3630')

export const plank = (u, v, out) => {
  const planks = 7
  const y = v * planks
  const index = Math.floor(y)
  const py = y - index
  const wrapped = ((index % planks) + planks) % planks
  const id = vnoise(0.5, (wrapped + 0.5) / planks, 1, planks, 211)

  set2(out, PLANK_GAP, PLANK_GAP, 0)
  // The board face, inset so the shiplap gap survives at every mip level.
  const face = smoothstep(0.030, 0.055, py) * (1 - smoothstep(0.945, 0.970, py))
  const tone = 0.80 + fract(id * 9.1) * 0.40
  const g = woodGrain(u + id, v, 5, 313 + wrapped * 13)
  lerp3(W2, PLANK_DARK, PLANK_BASE, smoothstep(0.15, 0.9, Math.pow(g.ring, 0.8)))
  W2[0] *= tone
  W2[1] *= tone
  W2[2] *= tone
  blend(out, W2, face)
  shade(out, 1 - face * clamp01((0.46 - g.fibre) * 2.0) * 0.26)
  blend(out, PLANK_BASE, face * clamp01((g.fibre - 0.58) * 2.0) * 0.30)

  // Nail heads near each board end, on a wrapping pair of columns.
  const nailU = Math.abs(fract(u + 0.5) - 0.5)
  const ndy = (py - 0.5) / planks
  const nd = Math.sqrt(nailU * nailU + ndy * ndy) - 0.006
  const nail = smoothstep(0.002, -0.002, nd) * face
  blend(out, NAIL, nail * 0.9)

  // Ambient occlusion in the shiplap gap.
  shade(out, 1 - (1 - face) * 0.55)

  out.h = clamp01(0.12 + face * 0.72 + (g.ring - 0.5) * 0.10 + (g.fibre - 0.5) * 0.14 - nail * 0.30)
  out.rough = clamp01(0.88 - face * 0.06 + (1 - face) * 0.06 - nail * 0.30)
}

// ---------------------------------------------------------------- gravel ----

const GRAVEL_FINES = rgb('#9b8664')
const GRAVEL_A = rgb('#c4b08a')
const GRAVEL_B = rgb('#a89a7c')
const GRAVEL_C = rgb('#8f8778')

export const gravel = (u, v, out) => {
  // Fines and dust between the stones.
  set2(out, GRAVEL_FINES, GRAVEL_A, fbm(u, v, 10, 4, 307) * 0.5)
  shade(out, 0.90 + noise(u, v, 384, 331) * 0.20)

  // Two size grades of stone stacked, coarse under fine, each with a contact
  // shadow so the bed reads as loose aggregate rather than as a speckle.
  let h = 0.24
  for (const [f, seed, size, amount] of [[26, 353, 0.30, 1], [44, 397, 0.26, 0.9], [72, 419, 0.22, 0.7]]) {
    worley(u, v, f, seed, CELL)
    const present = smoothstep(0.32, 0.52, CELL.id)
    const stone = smoothstep(size + 0.03, size - 0.03, CELL.f1) * present
    const contact = smoothstep(size + 0.16, size + 0.01, CELL.f1) * (1 - stone) * present
    const pick = fract(CELL.id * 19.7)
    lerp3(W2, GRAVEL_B, pick > 0.6 ? GRAVEL_C : GRAVEL_A, pick)
    blend(out, W2, stone * amount * 0.92)
    shade(out, 1 - contact * 0.26 * amount)
    // Domed profile so the normal map curves over each stone.
    h += stone * amount * 0.22 * (0.5 + 0.5 * smoothstep(size, 0, CELL.f1)) - contact * 0.04
  }

  out.h = clamp01(h + (noise(u, v, 256, 443) - 0.5) * 0.06)
  out.rough = clamp01(0.97 - smoothstep(0.3, 0.7, out.h) * 0.12)
}

// ----------------------------------------------------------------- cloth ----

const CLOTH_BASE = rgb('#f2ede2')
const CLOTH_SHADOW = rgb('#c6bfae')

export const cloth = (u, v, out) => {
  const threads = 64
  // Plain weave: warp over weft on alternate crossings.
  const wu = tri(u, threads)
  const wv = tri(v, threads)
  const overUnder = (Math.floor(u * threads) + Math.floor(v * threads)) % 2 === 0
  const top = overUnder ? wu : wv
  const bottom = overUnder ? wv : wu
  const fibre = noise(u, v, 512, 401)

  set2(out, CLOTH_SHADOW, CLOTH_BASE, Math.pow(top, 0.6))
  shade(out, 0.94 + fibre * 0.12)
  // Slub: occasional thicker thread, which is what stops woven cloth reading as
  // graph paper.
  const slub = smoothstep(0.72, 0.95, fbmAniso(u, v, 3, 48, 2, 457))
  shade(out, 1 - slub * 0.08)

  out.h = clamp01(0.34 + top * 0.42 + bottom * 0.10 + fibre * 0.06 + slub * 0.05)
  out.rough = clamp01(0.94 - top * 0.05)
}

export const STRUCTURE_PAINTERS = {
  masonry, plaster, timber, plank, cobble, gravel, quay, roof, cloth,
}
