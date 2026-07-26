// The six biome painters, ported from src/scene/terrain/textures.ts and pushed
// well past what is affordable at load time.
//
// Three things changed in the port:
//
// 1. Every generator is tileable (see noise.mjs). The runtime versions seam on
//    every hex because terrain UVs run -0.28..1.28 under RepeatWrapping.
// 2. Detail is authored as *structure* rather than as summed noise: brick
//    fragments are rounded boxes with real contact shadows, dune ripples have an
//    asymmetric crest, wheat sits on the furrow ridge and soil sits in the
//    trough. Summed noise averages to grey under mipmapping, which is exactly
//    the "not sharp" the client saw. Structure survives.
// 3. The height field is authored deliberately, because it drives both the
//    Sobel normal map and the horizon-swept AO. Those two have to agree with the
//    albedo or the surface reads as a photograph of a material rather than the
//    material itself.
//
// Signature is (u, v, out) with u,v in [0,1). `out` carries linear-light rgb,
// height h in 0..1, and roughness in 0..1.

import { blend, lerp3, rgb, saturate, set2, shade } from './palette.mjs'
import {
  clamp01, crackle, fbm, fbmAniso, fract, noise, ridge, saw, sdRoundBox,
  smoothstep, stroke, tri, vnoise, warp, worley,
} from './noise.mjs'

const W = [0, 0]
const W2 = [0, 0, 0]
const CELL = { f1: 0, f2: 0, id: 0, cx: 0, cy: 0 }
const CELL2 = { f1: 0, f2: 0, id: 0, cx: 0, cy: 0 }

/**
 * Directional streak field. Four fixed axes are blended by a flow angle instead
 * of rotating the sample coordinates, because rotating them would break the
 * periodicity that keeps the texture seamless. The diagonal axes sample
 * (u+v, u-v), which still wraps as long as the frequencies are even.
 */
const combed = (u, v, angle, along, across, seed) => {
  const s = u + v
  const t = u - v
  const ea = Math.max(2, Math.round(along / 2) * 2)
  const eb = Math.max(2, Math.round(across / 2) * 2)
  const axes = [
    vnoise(u, v, along, across, seed),
    vnoise(s, t, ea, eb, seed + 31),
    vnoise(u, v, across, along, seed + 61),
    vnoise(t, s, eb, ea, seed + 97),
  ]
  let sum = 0
  let norm = 0
  for (let i = 0; i < 4; i += 1) {
    const dir = (i * Math.PI) / 4
    let w = Math.cos(2 * (angle - dir))
    w = w > 0 ? w * w * w : 0
    sum += axes[i] * w
    norm += w
  }
  return norm > 1e-4 ? sum / norm : axes[0]
}

/** Sparse discrete props on a jittered, wrapping grid: pebbles, bricks, shards. */
const scatterCell = (u, v, f, seed, out) => {
  worley(u, v, f, seed, out)
  return out
}

// ---------------------------------------------------------------- lumber ----

// Calibrated against art/reference/standalone-assets/01-terrain-forest.png: the
// forest floor there is olive-brown duff with muted moss, not saturated green.
const FOREST_HUMUS = rgb('#33291a')
const FOREST_DUFF = rgb('#5c4c2c')
const FOREST_SOIL = rgb('#6d5735')
const FOREST_MOSS = rgb('#556229')
const FOREST_MOSS_LIT = rgb('#77854a')
const FOREST_NEEDLE = rgb('#7a6538')
const FOREST_NEEDLE_DARK = rgb('#413320')
const FOREST_STONE = rgb('#8b8878')
const FOREST_FERN = rgb('#4f6330')

export const lumber = (u, v, out) => {
  warp(u, v, 4, 0.10, 101, W)
  const wu = W[0]
  const wv = W[1]

  // Ground story: damp humus in the hollows, drier duff on the swells.
  const macro = fbm(wu, wv, 6, 5, 11)
  set2(out, FOREST_HUMUS, FOREST_DUFF, smoothstep(0.26, 0.80, macro))

  // Needle litter first, and loud, because it is the material. Combed by a slow
  // flow field so it drifts the way fallen needles actually pack.
  const flow = fbm(u, v, 3, 2, 419) * Math.PI * 2
  const needles = combed(u, v, flow, 288, 40, 733)
  const fineNeedles = combed(u, v, flow + 0.5, 704, 96, 751)
  const litter = needles * 0.6 + fineNeedles * 0.4
  blend(out, FOREST_NEEDLE, clamp01((litter - 0.44) * 2.8) * 0.40)
  blend(out, FOREST_NEEDLE_DARK, clamp01((0.44 - litter) * 2.8) * 0.34)
  // Individual needles on top: hard-edged strokes at two texel widths, which is
  // what the eye actually resolves when the camera comes in on a tile.
  const needleLit = stroke(fineNeedles, 0.70, 0.035)
  const needleDark = 1 - stroke(fineNeedles, 0.28, 0.035)
  blend(out, FOREST_NEEDLE, needleLit * 0.62)
  blend(out, FOREST_NEEDLE_DARK, needleDark * 0.42)

  // Moss spreads as broad ragged mats, not as discs. Thresholding two octaves of
  // fbm against a warped edge gives a margin that wanders; a Worley cell gives
  // a circle, which is what made the first bake read as polka dots.
  const mossField = fbm(wu, wv, 9, 5, 71) * 0.55 + fbm(u, v, 27, 3, 313) * 0.45
  const mossAmount = smoothstep(0.48, 0.70, mossField) * smoothstep(0.20, 0.55, macro)
  lerp3(W2, FOREST_MOSS, FOREST_MOSS_LIT, fbm(u, v, 23, 2, 331))
  blend(out, W2, mossAmount * 0.44)

  // Bracken: darker, cooler, sparse, and clipped to the mossy ground.
  const fernField = fbm(wu, wv, 13, 3, 617)
  const fern = smoothstep(0.70, 0.90, fernField) * (0.3 + mossAmount * 0.7)
  blend(out, FOREST_FERN, fern * 0.42)

  // Exposed root-worn track. One thin braided path per tile, no more.
  const trackField = ridge(wu, wv, 3, 3, 2, 1201)
  const track = smoothstep(0.82, 0.97, trackField) * (1 - mossAmount)
  blend(out, FOREST_SOIL, track * 0.7)

  // Grit and small stones, denser on the track where the litter is worn off.
  scatterCell(u, v, 46, 1451, CELL)
  const stone = smoothstep(0.18, 0.05, CELL.f1) * smoothstep(0.84, 0.96, CELL.id) * (0.3 + track * 0.7)
  blend(out, FOREST_STONE, stone * 0.7)

  // Canopy dapple. This is the one lighting term worth painting in: it is a
  // statistical shadow field, so it survives the per-tile UV rotation that
  // rules out any directional bake. Kept shallow — heavy dapple reads as mud.
  const dapple = fbm(wu, wv, 2, 4, 1777)
  shade(out, 0.88 + smoothstep(0.32, 0.82, dapple) * 0.20)

  out.h = clamp01(
    0.30 + (macro - 0.5) * 0.28 + litter * 0.20 + needleLit * 0.14 - needleDark * 0.08 + mossAmount * 0.14
    + stone * 0.30 + fern * 0.08 - track * 0.18,
  )
  out.rough = clamp01(0.93 - mossAmount * 0.05 - track * 0.10 + litter * 0.05 - stone * 0.14)
}

// ------------------------------------------------------------------ wool ----

// Calibrated against 02-terrain-pasture.png, which is a muted olive sward with
// warm dry tussocks — nowhere near the saturated green the runtime shader used.
const PASTURE_DEEP = rgb('#3f4d1e')
const PASTURE_MID = rgb('#657030')
const PASTURE_LIT = rgb('#8b944a')
const PASTURE_DRY = rgb('#a49763')
const PASTURE_EARTH = rgb('#75603a')
const PASTURE_TUSSOCK = rgb('#7d8a45')
const PASTURE_FLOWER = rgb('#e5e2c8')

export const wool = (u, v, out) => {
  warp(u, v, 3, 0.09, 211, W)
  const wu = W[0]
  const wv = W[1]

  const macro = fbm(wu, wv, 4, 5, 23)
  set2(out, PASTURE_DEEP, PASTURE_MID, smoothstep(0.24, 0.76, macro))

  // Blades carry the material, so they go down before anything patchy and they
  // get the contrast. Two scales, both combed by the same wind flow field.
  const flow = fbm(u, v, 2, 3, 907) * Math.PI * 2 + 0.6
  const blades = combed(u, v, flow, 336, 56, 1013)
  const fine = combed(u, v, flow + 0.35, 640, 112, 1109)
  const bladeSignal = blades * 0.6 + fine * 0.4
  blend(out, PASTURE_LIT, clamp01((bladeSignal - 0.48) * 2.6) * 0.34)
  blend(out, PASTURE_DEEP, clamp01((0.48 - bladeSignal) * 2.6) * 0.30)
  // Individual blades: hard strokes, lit edge and shadow side.
  const bladeLit = stroke(fine, 0.68, 0.030)
  const bladeDark = 1 - stroke(fine, 0.30, 0.030)
  blend(out, PASTURE_LIT, bladeLit * 0.55)
  blend(out, PASTURE_DEEP, bladeDark * 0.40)

  // Tussocks: ragged, low contrast. Perturbing the cell distance by a fine noise
  // is what stops a Worley field reading as a field of bubbles.
  scatterCell(wu, wv, 15, 61, CELL)
  const ragged = CELL.f1 + (fbm(u, v, 34, 3, 79) - 0.5) * 0.55
  const clump = smoothstep(0.44, 0.14, ragged)
  blend(out, PASTURE_TUSSOCK, clump * (0.20 + fract(CELL.id * 5.7) * 0.28))

  // Sun-bleached crowns on the high ground, damp green in the hollows.
  const dry = smoothstep(0.58, 0.94, fbm(wu, wv, 6, 4, 199))
  blend(out, PASTURE_DRY, dry * 0.42)

  // A bare scuff or two where the flock has stood.
  const scuff = smoothstep(0.94, 1.0, fbm(wu, wv, 8, 3, 1487))
  blend(out, PASTURE_EARTH, scuff * 0.75)

  // A handful of flower heads. Sparse enough that they read as detail at close
  // range and vanish into the mip chain at the gameplay camera.
  scatterCell(u, v, 74, 1601, CELL2)
  const flower = smoothstep(0.070, 0.02, CELL2.f1) * smoothstep(0.975, 0.997, CELL2.id) * (1 - scuff)
  blend(out, PASTURE_FLOWER, flower * 0.85)

  out.h = clamp01(
    0.34 + (macro - 0.5) * 0.26 + clump * 0.22 + bladeSignal * 0.20
    + bladeLit * 0.16 - bladeDark * 0.10 - scuff * 0.22 + flower * 0.12,
  )
  out.rough = clamp01(0.95 - clump * 0.04 - dry * 0.03 + scuff * 0.03)
}

// ----------------------------------------------------------------- grain ----

const FIELD_SOIL = rgb('#6b4b28')
const FIELD_SOIL_LIT = rgb('#96703d')
const FIELD_STRAW = rgb('#c79a3a')
const FIELD_WHEAT = rgb('#e3bc55')
const FIELD_WHEAT_LIT = rgb('#f6de92')
const FIELD_STUBBLE = rgb('#a67c33')
const FIELD_CHAFF = rgb('#d9c48c')

export const grain = (u, v, out) => {
  // Furrows run along +u, matching the corduroy in tileRelief for 'grain'.
  const wobble = (fbm(u, v, 4, 3, 313) - 0.5) * 0.030
  const rowPhase = v + wobble
  const rows = 40
  const ridgeProfile = Math.pow(tri(rowPhase, rows), 1.35)
  const trough = 1 - ridgeProfile

  // Tramlines: the sprayer wheels flatten one row pair in every eight.
  const band = saw(rowPhase, rows / 8)
  const tram = smoothstep(0.055, 0.0, Math.abs(band - 0.18)) + smoothstep(0.055, 0.0, Math.abs(band - 0.30))
  const tramline = clamp01(tram)

  const macro = fbm(u, v, 5, 4, 401)
  set2(out, FIELD_SOIL, FIELD_SOIL_LIT, smoothstep(0.28, 0.76, macro))

  // Standing crop rides the ridge. Heads are long and thin along the row.
  const heads = fbmAniso(u, v, 448, 112, 3, 617)
  const seedHeads = clamp01((heads - 0.42) * 2.1)
  // Individual straws, hard edged so a row does not smear into a gold band.
  const straw = stroke(heads, 0.66, 0.032)
  const crop = smoothstep(0.22, 0.72, ridgeProfile) * (1 - tramline * 0.85)
  lerp3(W2, FIELD_STRAW, FIELD_WHEAT, smoothstep(0.30, 0.82, macro))
  blend(out, W2, crop * 0.94)
  blend(out, FIELD_WHEAT_LIT, crop * seedHeads * 0.42)
  blend(out, FIELD_WHEAT_LIT, crop * straw * 0.55)
  blend(out, FIELD_STUBBLE, crop * clamp01((0.42 - heads) * 2.1) * 0.4)

  // Clods of turned earth in the trough, and chaff blown into it.
  scatterCell(u, v, 56, 733, CELL)
  const clod = smoothstep(0.26, 0.04, CELL.f1) * trough
  blend(out, FIELD_SOIL_LIT, clod * 0.45)
  const chaff = smoothstep(0.66, 0.92, fbmAniso(u, v, 96, 288, 2, 881)) * trough * (1 - crop)
  blend(out, FIELD_CHAFF, chaff * 0.35)

  // Compacted, slightly damp wheel ruts.
  blend(out, FIELD_SOIL, tramline * 0.75)
  shade(out, 1 - tramline * 0.12)

  saturate(out, 1.04)

  out.h = clamp01(
    0.34 + ridgeProfile * 0.34 + crop * seedHeads * 0.12 + crop * straw * 0.14 + clod * 0.16
    + (macro - 0.5) * 0.16 - tramline * 0.24,
  )
  out.rough = clamp01(0.90 + crop * 0.05 - tramline * 0.14 - clod * 0.04)
}

// ----------------------------------------------------------------- brick ----
//
// The client called this one out by name: "the brick land, the clay land is not
// coming through". The runtime version is terracotta-tinted fbm, which reads as
// orange fog.
//
// The first two attempts here failed differently: quantising a warped field into
// quarry benches produced contour swirls that read as marbled paper. The mistake
// was doubling up — tileRelief already terraces the brick mesh, so terracing the
// texture too just fights it. This version paints only the material: raw clay,
// a dried and cracked pan where it has baked out, loose fired fragments, and
// grit. The landform stays in the mesh where it belongs.
//
// Calibrated against 04-terrain-hills.png. That reference is terracotta with a
// wide value range and a pale cracked floor, not a saturated orange field.

const CLAY_DEEP = rgb('#5e3220')
const CLAY_MID = rgb('#8d4b2f')
const CLAY_FIRED = rgb('#a75c39')
const CLAY_BRIGHT = rgb('#c07a51')
const CLAY_PAN = rgb('#a98a68')
const CLAY_PAN_PALE = rgb('#c2a884')
const CLAY_DUST = rgb('#c4ab8b')
const CLAY_SCORCH = rgb('#6d3a27')
const CLAY_WET = rgb('#79402a')

export const brick = (u, v, out) => {
  warp(u, v, 3, 0.06, 509, W)
  const wu = W[0]
  const wv = W[1]

  // Raw clay body: damp and dark in the hollows, fired and pale on the crowns.
  const macro = fbm(wu, wv, 4, 5, 511)
  set2(out, CLAY_DEEP, CLAY_MID, smoothstep(0.24, 0.72, macro))
  blend(out, CLAY_FIRED, smoothstep(0.52, 0.86, macro) * 0.75)
  blend(out, CLAY_WET, smoothstep(0.34, 0.10, macro) * 0.55)

  // Bedding strata, near-horizontal and uneven — cut clay always shows its beds.
  const strata = ridge(wu, wv, 5, 24, 4, 877)
  blend(out, CLAY_BRIGHT, Math.pow(strata, 1.2) * 0.38)
  blend(out, CLAY_SCORCH, smoothstep(0.56, 0.94, fbmAniso(wu, wv, 7, 30, 3, 1051)) * 0.34)

  // Spade and tool scrapes where the bank has been worked.
  // Vertical, so they cross the horizontal bedding instead of doubling it up.
  const scrape = fbmAniso(u, v, 288, 128, 2, 1231)
  blend(out, CLAY_DUST, stroke(scrape, 0.74, 0.05) * 0.09)
  shade(out, 1 - (1 - stroke(scrape, 0.26, 0.05)) * 0.06)

  // Dried pan: the pale, cracked mud plate that forms wherever the clay has
  // baked out flat. This is most of what makes the tile read as clay rather than
  // as orange rock, so it covers a good share of the surface.
  const panMask = smoothstep(0.54, 0.70, fbm(wu, wv, 6, 4, 1607))
  const crackA = crackle(wu, wv, 26, 1709)
  const crackB = crackle(wu, wv, 54, 1811)
  const crack = Math.min(smoothstep(0.0, 0.055, crackA), smoothstep(0.0, 0.028, crackB))
  lerp3(W2, CLAY_PAN, CLAY_PAN_PALE, fbm(u, v, 12, 3, 1657))
  blend(out, W2, panMask * 0.80)
  // Plates curl at their edges and catch light; the crack itself is dark.
  shade(out, 1 + panMask * smoothstep(0.08, 0.28, crack) * 0.10)
  shade(out, 1 - panMask * (1 - crack) * 0.62)

  // Loose fired fragments. Rare and large, so each one reads as a brick rather
  // than as gravel: a rotated rounded box with a bright top, a bevelled arris
  // and a real contact shadow.
  scatterCell(wu, wv, 13, 1913, CELL)
  const fu = wu * 13 - CELL.cx
  const fv = wv * 13 - CELL.cy
  const ang = fract(CELL.id * 11.7) * Math.PI
  const ca = Math.cos(ang)
  const sa = Math.sin(ang)
  const lx = fu * ca - fv * sa
  const ly = fu * sa + fv * ca
  const scale = 0.15 + fract(CELL.id * 3.31) * 0.07
  const d = sdRoundBox(lx, ly, scale * 2.15, scale, scale * 0.16)
  const present = smoothstep(0.70, 0.78, CELL.id)
  const fragment = smoothstep(0.010, -0.010, d) * present
  const bevel = smoothstep(-0.010, -0.055, d) * present
  const contact = smoothstep(0.085, 0.010, d) * (1 - fragment) * present

  lerp3(W2, CLAY_FIRED, CLAY_BRIGHT, fract(CELL.id * 17.3))
  blend(out, W2, fragment * 0.95)
  blend(out, CLAY_SCORCH, fragment * smoothstep(0.72, 0.98, fract(CELL.id * 23.9)) * 0.5)
  shade(out, 1 - (fragment - bevel) * 0.26)
  shade(out, 1 - contact * 0.42)

  // Grit and pitting over everything, so no part of the tile is a flat wash.
  const grit = noise(u, v, 224, 2111) * 0.6 + crackle(u, v, 88, 2137) * 0.4
  shade(out, 0.93 + grit * 0.16)

  out.h = clamp01(
    0.34 + (macro - 0.5) * 0.30 + strata * 0.14 + (grit - 0.5) * 0.10
    + fragment * 0.36 - (fragment - bevel) * 0.05 - contact * 0.04
    + panMask * crack * 0.05 - panMask * (1 - crack) * 0.16,
  )
  out.rough = clamp01(
    0.86 - smoothstep(0.34, 0.10, macro) * 0.28 - fragment * 0.08 + panMask * 0.08,
  )
}

// ------------------------------------------------------------------- ore ----

// Calibrated against 05-terrain-mountains.png: cool dark blue-grey slate,
// weathered pale crests, warm rust bleeding from the joints, and flat angular
// facets rather than rounded cells. The first bake came out eggshell white.
const ROCK_DARK = rgb('#353c44')
const ROCK_MID = rgb('#565d63')
const ROCK_LIGHT = rgb('#7c8184')
const ROCK_PALE = rgb('#a8a396')
const ROCK_RUST = rgb('#7a5636')
const ROCK_GRAVEL = rgb('#8d8a80')
const ROCK_LICHEN = rgb('#78855e')

export const ore = (u, v, out) => {
  warp(u, v, 4, 0.06, 907, W)
  const wu = W[0]
  const wv = W[1]

  const macro = fbm(wu, wv, 4, 5, 911)
  set2(out, ROCK_DARK, ROCK_MID, smoothstep(0.24, 0.80, macro))

  // Bedding planes. Discrete bands with a hard top edge, each band a slightly
  // different stone, so the cliff reads as layered rather than as grey noise.
  const bedField = v * 16 + (fbm(wu, wv, 4, 4, 1201) - 0.5) * 5.5
  const bandId = Math.floor(bedField)
  const bandT = fract(bedField)
  const bandTone = fract(Math.sin(bandId * 12.9898) * 43758.5453)
  lerp3(W2, ROCK_DARK, ROCK_LIGHT, bandTone)
  blend(out, W2, 0.35)
  shade(out, 1 - smoothstep(0.10, 0.0, bandT) * 0.40)
  blend(out, ROCK_PALE, smoothstep(0.90, 1.0, bandT) * 0.22)

  // Strata grain running along the bedding.
  const strata = ridge(wu, wv, 8, 30, 4, 1301)
  blend(out, ROCK_LIGHT, Math.pow(strata, 1.2) * 0.30)

  // Conchoidal facets. Each joint cell gets one flat brightness, which is what
  // makes broken slate read as broken slate: hard-edged planes catching the key
  // at different angles, not a soft cellular web.
  const jointA = crackle(wu, wv, 8, 1451)
  const jointB = crackle(wu, wv, 19, 1601)
  worley(wu, wv, 8, 1451, CELL)
  const facet = fract(CELL.id * 6.13)
  shade(out, 0.80 + facet * 0.42)
  worley(wu, wv, 19, 1601, CELL2)
  shade(out, 0.92 + fract(CELL2.id * 3.77) * 0.17)

  // Two-scale joint network cutting between the facets.
  const joint = Math.min(smoothstep(0.0, 0.036, jointA), smoothstep(0.0, 0.020, jointB))
  shade(out, 1 - (1 - joint) * 0.70)

  // Crystalline grain across the faces. Without it the stone between the joints
  // is a flat wash, which is exactly how the first bake read at 1:1.
  const sparkleGrain = noise(u, v, 640, 2311)
  shade(out, 0.94 + sparkleGrain * 0.13)
  const micro = crackle(u, v, 110, 2371)
  shade(out, 1 - (1 - smoothstep(0.0, 0.05, micro)) * 0.22)
  blend(out, ROCK_PALE, stroke(sparkleGrain, 0.90, 0.03) * 0.28 * smoothstep(0.35, 0.75, macro))

  // Iron staining bleeding out of the joints — the "ore" read.
  blend(out, ROCK_RUST, smoothstep(0.20, 0.015, jointA) * smoothstep(0.55, 0.88, fbm(wu, wv, 6, 3, 1709)) * 0.60)

  // Pale mineral veins. Thin, bright, occasionally branching.
  const vein = smoothstep(0.92, 0.99, ridge(wu, wv, 7, 13, 3, 1877))
  blend(out, ROCK_PALE, vein * 0.75)

  // Scree collecting in the joint troughs.
  scatterCell(u, v, 54, 2003, CELL)
  const scree = smoothstep(0.20, 0.05, CELL.f1) * (0.25 + (1 - joint) * 0.75)
  lerp3(W2, ROCK_GRAVEL, ROCK_PALE, fract(CELL.id * 9.7))
  blend(out, W2, scree * 0.55)
  shade(out, 1 - smoothstep(0.30, 0.20, CELL.f1) * scree * 0.18)

  // Lichen. Sparse pale-green plates on the exposed faces only.
  const lichenField = fbm(wu, wv, 9, 4, 2129)
  const lichen = smoothstep(0.72, 0.88, lichenField) * joint
  blend(out, ROCK_LICHEN, lichen * 0.45)

  out.h = clamp01(
    0.34 + (macro - 0.5) * 0.30 + strata * 0.20 + scree * 0.26 + (facet - 0.5) * 0.10
    - (1 - joint) * 0.36 + vein * 0.05 + (sparkleGrain - 0.5) * 0.08
    - (1 - smoothstep(0.0, 0.05, micro)) * 0.10 - smoothstep(0.10, 0.0, bandT) * 0.14,
  )
  out.rough = clamp01(0.84 - strata * 0.14 - vein * 0.14 + (1 - joint) * 0.12 + lichen * 0.08)
}

// ---------------------------------------------------------------- desert ----

const SAND_SHADOW = rgb('#a8814a')
const SAND_MID = rgb('#d7b276')
const SAND_LIT = rgb('#f0dcac')
const SAND_PALE = rgb('#f7ecd2')
const SAND_MINERAL = rgb('#9d7b52')
const SAND_PEBBLE = rgb('#a89679')
const SAND_QUARTZ = rgb('#fffaf0')

/** Asymmetric ripple: short steep windward face, long shallow lee. */
const rippleProfile = (phase) => {
  const s = saw(phase, 1)
  const crest = 0.74
  return s < crest ? smoothstep(0, crest, s) : 1 - smoothstep(crest, 1, s)
}

export const desert = (u, v, out) => {
  warp(u, v, 3, 0.11, 1709, W)
  const wu = W[0]
  const wv = W[1]

  const macro = fbm(wu, wv, 4, 4, 1811)
  set2(out, SAND_SHADOW, SAND_MID, smoothstep(0.18, 0.70, macro))

  // Two crossing ripple trains. Integer direction coefficients keep both
  // periodic; the second is finer and crosses at a shallow angle.
  const dune = rippleProfile((u * 1 + v * 2) * 2 + (fbm(wu, wv, 3, 3, 1861) - 0.5) * 1.4)
  const rippleA = rippleProfile((u * 3 + v * 2) * 4 + (fbm(wu, wv, 4, 3, 1913) - 0.5) * 3.2)
  const rippleB = rippleProfile((u * 1 - v * 4) * 3 + (fbm(wu, wv, 5, 3, 2027) - 0.5) * 2.6)
  const ripple = clamp01(rippleA * 0.62 + rippleB * 0.24 + dune * 0.14)
  blend(out, SAND_LIT, Math.pow(ripple, 1.5) * 0.82)
  blend(out, SAND_SHADOW, Math.pow(1 - ripple, 2.0) * 0.38)

  // Wind-blown streaks smeared along the dominant ripple direction.
  const streak = fbmAniso(u, v, 24, 288, 3, 2131)
  blend(out, SAND_MINERAL, clamp01((0.44 - streak) * 2.0) * 0.18)
  blend(out, SAND_PALE, clamp01((streak - 0.58) * 2.0) * 0.24)
  // Fine wind-combed strokes, so the sand between ripples is not a flat wash.
  const fineStreak = fbmAniso(u, v, 48, 512, 2, 2153)
  blend(out, SAND_PALE, stroke(fineStreak, 0.68, 0.035) * 0.30)
  shade(out, 1 - (1 - stroke(fineStreak, 0.32, 0.035)) * 0.07)

  // Gypsum bleach patches.
  blend(out, SAND_PALE, smoothstep(0.68, 0.93, fbm(wu, wv, 6, 3, 2239)) * 0.45)

  // Lag deposit: coarse pebbles that the wind cannot lift, sitting in the
  // troughs with a proper contact shadow.
  scatterCell(wu, wv, 26, 2341, CELL)
  const pebbleSize = 0.08 + fract(CELL.id * 7.7) * 0.07
  const pebble = smoothstep(pebbleSize + 0.012, pebbleSize - 0.012, CELL.f1)
    * smoothstep(0.50, 0.70, CELL.id) * (0.45 + (1 - ripple) * 0.55)
  // Dome the stone: bright over the crown, darker toward the buried rim, or it
  // reads as a sticker rather than as a pebble sitting in the sand.
  const crown = smoothstep(pebbleSize, 0.0, CELL.f1)
  lerp3(W2, SAND_PEBBLE, SAND_MINERAL, fract(CELL.id * 13.1))
  blend(out, W2, pebble * 0.85)
  shade(out, 1 - pebble * (1 - crown) * 0.14)
  shade(out, 1 + pebble * crown * 0.20)
  const contact = smoothstep(pebbleSize + 0.10, pebbleSize + 0.01, CELL.f1) * (1 - pebble) * smoothstep(0.50, 0.70, CELL.id)
  shade(out, 1 - contact * 0.30)

  // Quartz sparkle. Single-texel bright grains; they disappear into the mips
  // at distance and glint when the camera comes in.
  const grain = noise(u, v, 768, 2447)
  const coarse = noise(u, v, 320, 2459)
  shade(out, 0.96 + coarse * 0.09)
  const sparkle = smoothstep(0.955, 0.99, grain) * (1 - pebble)
  blend(out, SAND_QUARTZ, sparkle * 0.8)
  const grainLift = (grain - 0.5) * 0.05
  out.r += grainLift
  out.g += grainLift * 0.96
  out.b += grainLift * 0.88

  saturate(out, 1.04)

  out.h = clamp01(
    0.32 + ripple * 0.34 + dune * 0.10 + (macro - 0.5) * 0.22 + pebble * 0.28
    + (streak - 0.5) * 0.08 + (fineStreak - 0.5) * 0.07 + grain * 0.04
    + (coarse - 0.5) * 0.05 - contact * 0.04,
  )
  out.rough = clamp01(0.92 - pebble * 0.20 - sparkle * 0.35 + ripple * 0.03)
}

export const TERRAIN_PAINTERS = { lumber, wool, grain, brick, ore, desert }
