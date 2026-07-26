import * as THREE from 'three'
import type { Board, PlayerColor } from '../../game/types'
import { PLAYER_BANNER, PLAYER_ROOF, PLAYER_TRIM } from '../playerColors'
import { banner, box, cone, cyl, gableRoof, merge, merlons, pennant, prism, type Part } from './geometry'
import {
  clothMaterial,
  glassMaterial,
  ironMaterial,
  paintedTrimMaterial,
  roofMaterial,
  terraceMaterial,
  timberMaterial,
  variedMasonryMaterial,
  variedPlasterMaterial,
} from './materials'
import { GROUND_Y, sightCeiling } from '../terrain/hex'
import { makeRng } from './textures'

// Settlement and city are authored as merged geometry groups — one group per
// material — so each building costs a handful of draw calls regardless of how
// much detail is in it.
//
// Ownership deliberately does NOT live in the roof any more. Saturated roofs
// were the strongest toy-model cue in the render. It now lives in cloth and
// paint: an oversized pennant, hanging banners, and painted trim on the door,
// shutters and eaves — plus the colour ring set into the terrace the building
// stands on, which `Pieces` draws and which is what actually carries the
// top-down read.

type Groups = {
  masonry: THREE.BufferGeometry
  plaster: THREE.BufferGeometry
  roof: THREE.BufferGeometry
  timber: THREE.BufferGeometry
  glass: THREE.BufferGeometry
  metal: THREE.BufferGeometry
  cloth: THREE.BufferGeometry
  /** Painted joinery in the owner's colour: door, shutters, eaves board. */
  trim: THREE.BufferGeometry
  floor?: THREE.BufferGeometry
}

const lazy = <T,>(build: () => T) => {
  let value: T | null = null
  return () => {
    if (value === null) value = build()
    return value
  }
}

/**
 * Stone value, warmed as it darkens. Uniformly pale masonry is what made the
 * city read as a sandcastle; everything that touches the ground, sits in a
 * crevice or catches soot gets pulled down and browner, and the courses the
 * sun hits get pushed up, so the walls carry a tonal range instead of one tone.
 */
const stone = (value: number): [number, number, number] => [value, value * (0.94 + value * 0.05), value * (0.86 + value * 0.1)]

/** Widen the gap between the darkest and lightest course on a piece. */
const spread = (value: number) => stone(0.5 + (value - 0.5) * 1.34)

/**
 * Wet stone: the courses that stay damp go cooler as well as darker. Every
 * other tint on the piece warms as it drops, so a single cool band at the foot
 * of the wall is what finally breaks the one-material sandcastle read.
 */
const damp = (value: number): [number, number, number] => [value * 0.94, value * 0.97, value * 1.06]

const quoins = (cx: number, cz: number, w: number, d: number, height: number, size: number): Part[] =>
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz], index) => ({
    geo: box(size, height, size),
    pos: [cx + (sx * w) / 2, height / 2, cz + (sz * d) / 2] as [number, number, number],
    uv: [2, height * 8] as [number, number],
    tint: stone(1.02 + index * 0.03) as [number, number, number],
  }))

/**
 * A window is a hole, and a hole is dark. The old opening was a pale frame with
 * a glass slab in it and no reveal, so it read as a sticker. This adds a sunk
 * near-black reveal behind the frame and a soot stain weeping down the wall
 * below the sill — the two things that make a small opening read as a recess.
 */
const windowOpening = (x: number, y: number, z: number, yaw: number, w = 0.045, h = 0.06): { frame: Part[]; glass: Part; grime: Part[] } => {
  const out: [number, number, number] = [Math.sin(yaw), 0, Math.cos(yaw)]
  const at = (offset: number, dy = 0): [number, number, number] => [x + out[0] * offset, y + dy, z + out[2] * offset]
  return {
    frame: [
      { geo: box(w + 0.018, h + 0.018, 0.014), pos: [x, y, z], rot: [0, yaw, 0], uv: [2, 2] },
      // Stone sill, proud of the wall so it throws its own line of shade.
      { geo: box(w + 0.03, 0.008, 0.018), pos: at(0.004, -h / 2 - 0.012), rot: [0, yaw, 0], uv: [2, 1] },
    ],
    glass: { geo: box(w, h, 0.02), pos: [x, y, z], rot: [0, yaw, 0], uv: [1, 1] },
    grime: [
      // Shadowed reveal: a dark plate a hair wider than the frame, so a rim of
      // it survives around the joinery as the shade a real opening throws.
      { geo: box(w + 0.03, h + 0.03, 0.006), pos: at(0.002), rot: [0, yaw, 0], uv: [1, 1], tint: [0.2, 0.19, 0.17] },
      // Weathering weeping down from the sill.
      { geo: box(w + 0.026, h * 0.8, 0.004), pos: at(0.003, -h * 0.86), rot: [0, yaw, 0], uv: [2, 2], tint: [0.52, 0.49, 0.44] },
    ],
  }
}

const buildSettlement = (): Groups => {
  const masonry: Part[] = []
  const plaster: Part[] = []
  const roof: Part[] = []
  const timber: Part[] = []
  const glass: Part[] = []
  const metal: Part[] = []
  const cloth: Part[] = []
  const trim: Part[] = []

  const mainX = 0.07
  const mainW = 0.24
  const mainD = 0.24
  const mainTop = 0.26
  const wingX = -0.15
  const wingZ = 0.03
  const wingW = 0.19
  const wingD = 0.20
  const wingTop = 0.17

  // Footings, dirtied down where they meet the ground.
  masonry.push({ geo: box(mainW + 0.05, 0.05, mainD + 0.05), pos: [mainX, 0.025, 0], uv: [5, 1], tint: stone(0.5) })
  masonry.push({ geo: box(wingW + 0.05, 0.045, wingD + 0.045), pos: [wingX, 0.022, wingZ], uv: [4, 1], tint: stone(0.46) })
  // Rubble base course, then plastered walls above.
  masonry.push({ geo: box(mainW + 0.012, 0.075, mainD + 0.012), pos: [mainX, 0.075, 0], uv: [5, 1.4], tint: stone(0.72) })
  masonry.push({ geo: box(wingW + 0.012, 0.065, wingD + 0.012), pos: [wingX, 0.07, wingZ], uv: [4, 1.2], tint: stone(0.66) })
  plaster.push({ geo: box(mainW, mainTop, mainD), pos: [mainX, mainTop / 2, 0], uv: [4, 4], tint: stone(1.04) })
  plaster.push({ geo: box(wingW, wingTop, wingD), pos: [wingX, wingTop / 2, wingZ], uv: [3.4, 3], tint: stone(0.9) })
  masonry.push(...quoins(mainX, 0, mainW, mainD, mainTop, 0.042))
  masonry.push(...quoins(wingX, wingZ, wingW, wingD, wingTop, 0.036))

  // Gable ends, then the tiled roofs over them.
  const mainRise = 0.142
  plaster.push({ geo: prism(mainD, mainRise, mainW), pos: [mainX, mainTop + mainRise / 2 - 0.002, 0], rot: [0, Math.PI / 2, 0], uv: [3, 3], tint: stone(1.08) })
  for (const part of gableRoof(mainW, mainD, mainRise, 0.022, 0.028, 'x')) {
    roof.push({ ...part, pos: [mainX + (part.pos?.[0] ?? 0), mainTop + (part.pos?.[1] ?? 0), part.pos?.[2] ?? 0] })
  }
  const wingRise = 0.098
  plaster.push({ geo: prism(wingW, wingRise, wingD), pos: [wingX, wingTop + wingRise / 2 - 0.002, wingZ], uv: [2.6, 2.6], tint: stone(0.94) })
  for (const part of gableRoof(wingD, wingW, wingRise, 0.02, 0.024, 'z')) {
    roof.push({
      ...part,
      pos: [wingX + (part.pos?.[0] ?? 0), wingTop + (part.pos?.[1] ?? 0), wingZ + (part.pos?.[2] ?? 0)],
    })
  }

  // Eaves beams and rafter tails.
  for (const side of [-1, 1]) {
    timber.push({ geo: box(mainW + 0.03, 0.011, 0.014), pos: [mainX, mainTop - 0.012, side * (mainD / 2 + 0.012)], uv: [6, 1] })
    for (let index = 0; index < 4; index += 1) {
      const x = mainX - mainW / 2 + 0.032 + index * (mainW / 3.6)
      timber.push({ geo: box(0.011, 0.01, 0.042), pos: [x, mainTop - 0.02, side * (mainD / 2 + 0.014)], uv: [1, 1] })
    }
  }

  // Chimney, rising through the roof slope near the ridge.
  const chimneyX = mainX + 0.055
  masonry.push({ geo: box(0.05, 0.44, 0.05), pos: [chimneyX, 0.22, -0.045], uv: [1.6, 8], tint: stone(0.84) })
  masonry.push({ geo: box(0.07, 0.02, 0.07), pos: [chimneyX, 0.448, -0.045], uv: [2, 1], tint: stone(0.42) })

  // Door with a stone surround and a step.
  const doorX = mainX + mainW / 2
  masonry.push({ geo: box(0.02, 0.13, 0.085), pos: [doorX + 0.006, 0.065, 0.03], uv: [2, 2], tint: stone(1.05) })
  trim.push({ geo: box(0.014, 0.105, 0.058), pos: [doorX + 0.014, 0.052, 0.03], uv: [2, 2] })
  metal.push({ geo: cyl(0.008, 0.008, 0.008, 8), pos: [doorX + 0.023, 0.056, 0.05], rot: [0, 0, Math.PI / 2] })
  masonry.push({ geo: box(0.05, 0.02, 0.1), pos: [doorX + 0.036, 0.01, 0.03], uv: [1, 1], tint: stone(0.58) })

  for (const spec of [
    windowOpening(doorX + 0.004, 0.175, -0.03, Math.PI / 2),
    windowOpening(wingX - wingW / 2 - 0.002, 0.095, wingZ + 0.02, Math.PI / 2, 0.05, 0.05),
    windowOpening(mainX - 0.02, 0.11, mainD / 2 + 0.004, 0, 0.05, 0.05),
  ]) {
    trim.push(...spec.frame)
    glass.push(spec.glass)
    masonry.push(...spec.grime)
  }
  // Grime under the eaves: the strip of wall the roof keeps dry and dirty is
  // always the darkest band on a real building, and it is what stops a plaster
  // box reading as fresh-poured plastic.
  for (const [cx, cz, w, d, top] of [
    [mainX, 0, mainW, mainD, mainTop],
    [wingX, wingZ, wingW, wingD, wingTop],
  ] as Array<[number, number, number, number, number]>) {
    for (const side of [-1, 1]) {
      plaster.push({ geo: box(w + 0.002, 0.036, 0.004), pos: [cx, top - 0.026, cz + side * (d / 2 + 0.002)], uv: [6, 1], tint: stone(0.52) })
      plaster.push({ geo: box(0.004, 0.036, d + 0.002), pos: [cx + side * (w / 2 + 0.002), top - 0.026, cz], uv: [6, 1], tint: stone(0.52) })
    }
  }
  // Painted eaves board along the main range: a thin owner-coloured line that
  // survives the top-down view without turning the roof into a toy.
  for (const side of [-1, 1]) {
    trim.push({ geo: box(mainW + 0.06, 0.016, 0.012), pos: [mainX, mainTop - 0.004, side * (mainD / 2 + 0.03)], uv: [6, 1] })
  }

  // Mast and pennant: the ownership read that survives any camera angle.
  const mastX = mainX - 0.02
  timber.push({ geo: cyl(0.006, 0.008, 0.24, 6), pos: [mastX, mainTop + mainRise + 0.1, 0.02], uv: [1, 3] })
  metal.push({ geo: cone(0.014, 0.03, 6), pos: [mastX, mainTop + mainRise + 0.235, 0.02] })
  cloth.push({ geo: pennant(0.19, 0.108), pos: [mastX + 0.006, mainTop + mainRise + 0.155, 0.02], rot: [0, 0.22, 0], uv: [1, 1] })
  // Painted shield beside the door, and a banner hung off the wing gable.
  cloth.push({ geo: banner(0.07, 0.105), pos: [doorX + 0.014, 0.166, 0.07], rot: [0, Math.PI / 2, 0], uv: [1, 1] })
  cloth.push({ geo: banner(0.085, 0.125), pos: [wingX - wingW / 2 - 0.012, 0.105, wingZ - 0.03], rot: [0, Math.PI / 2, 0], uv: [1, 1] })

  return {
    masonry: merge(masonry),
    plaster: merge(plaster),
    roof: merge(roof),
    timber: merge(timber),
    glass: merge(glass),
    metal: merge(metal),
    cloth: merge(cloth),
    trim: merge(trim),
  }
}

const buildCity = (): Groups => {
  const masonry: Part[] = []
  const plaster: Part[] = []
  const roof: Part[] = []
  const timber: Part[] = []
  const glass: Part[] = []
  const metal: Part[] = []
  const cloth: Part[] = []
  const trim: Part[] = []
  const floor: Part[] = []

  const random = makeRng(60451)
  const wallTop = 0.30
  // Battered curtain wall on a talus base. The talus is the dirtiest stone on
  // the piece and the wall lightens as it rises, which is what stops the whole
  // thing reading as one pale mass.
  masonry.push({ geo: cyl(0.315, 0.375, 0.1, 12), pos: [0, 0.05, 0], uv: [6, 1.4], tint: damp(0.5) })
  masonry.push({ geo: cyl(0.305, 0.315, 0.2, 12), pos: [0, 0.2, 0], uv: [6, 2.4], tint: spread(0.84) })
  masonry.push({ geo: cyl(0.335, 0.335, 0.026, 12), pos: [0, 0.312, 0], uv: [6, 0.5], tint: spread(1.14) })
  // Every merlon its own value, so the crown reads as set blocks with shadow
  // between them rather than a cast plastic crenellation.
  masonry.push(...merlons(0.312, 16, 0.062, 0.055, 0.352).map((part) => ({ ...part, tint: spread(0.66 + random() * 0.5) })))
  floor.push({ geo: cyl(0.30, 0.30, 0.02, 12), pos: [0, 0.315, 0], uv: [4, 4] })

  // Corner bastions.
  for (const angle of [Math.PI * 0.25, Math.PI * 0.75, Math.PI * 1.25, Math.PI * 1.75]) {
    const x = Math.cos(angle) * 0.295
    const z = Math.sin(angle) * 0.295
    masonry.push({ geo: cyl(0.075, 0.088, 0.4, 8), pos: [x, 0.2, z], uv: [3, 5], tint: spread(0.7 + random() * 0.3) })
    masonry.push({ geo: cyl(0.092, 0.092, 0.022, 8), pos: [x, 0.412, z], uv: [3, 0.5], tint: stone(1.04) })
  }

  // Keep: the tall tower that gives the city its silhouette.
  const keepBase = wallTop + 0.03
  const keepH = 0.34
  plaster.push({ geo: box(0.2, keepH, 0.2), pos: [-0.02, keepBase + keepH / 2, -0.02], uv: [4, 6], tint: stone(1.05) })
  masonry.push(...quoins(-0.02, -0.02, 0.2, 0.2, keepH, 0.04).map((part) => ({
    ...part,
    pos: [part.pos?.[0] ?? 0, keepBase + keepH / 2, part.pos?.[2] ?? 0] as [number, number, number],
  })))
  masonry.push({ geo: box(0.23, 0.02, 0.23), pos: [-0.02, keepBase + keepH - 0.03, -0.02], uv: [4, 0.4], tint: stone(0.68) })
  roof.push({ geo: cone(0.175, 0.15, 4), pos: [-0.02, keepBase + keepH + 0.075, -0.02], rot: [0, Math.PI / 4, 0], uv: [4, 4] })
  metal.push({ geo: cyl(0.006, 0.006, 0.05, 6), pos: [-0.02, keepBase + keepH + 0.17, -0.02] })
  metal.push({ geo: new THREE.SphereGeometry(0.014, 10, 8), pos: [-0.02, keepBase + keepH + 0.2, -0.02] })

  // Secondary tower and a lower hall, both tiled to match.
  const towerBase = wallTop + 0.02
  const towerH = 0.26
  plaster.push({ geo: box(0.115, towerH, 0.115), pos: [0.19, towerBase + towerH / 2, 0.13], uv: [2.4, 5], tint: stone(0.92) })
  masonry.push({ geo: box(0.135, 0.018, 0.135), pos: [0.19, towerBase + towerH - 0.02, 0.13], uv: [3, 0.4], tint: stone(0.66) })
  roof.push({ geo: cone(0.105, 0.1, 4), pos: [0.19, towerBase + towerH + 0.05, 0.13], rot: [0, Math.PI / 4, 0], uv: [3, 3] })
  metal.push({ geo: cone(0.012, 0.032, 6), pos: [0.19, towerBase + towerH + 0.115, 0.13] })

  const hallW = 0.26
  const hallD = 0.15
  const hallTop = 0.14
  plaster.push({ geo: box(hallW, hallTop, hallD), pos: [-0.03, towerBase + hallTop / 2, 0.19], uv: [5, 3], tint: stone(0.86) })
  plaster.push({ geo: prism(hallD, 0.065, hallW), pos: [-0.03, towerBase + hallTop + 0.032, 0.19], rot: [0, Math.PI / 2, 0], uv: [3, 3], tint: stone(0.98) })
  for (const part of gableRoof(hallW, hallD, 0.065, 0.018, 0.024, 'x')) {
    roof.push({ ...part, pos: [-0.03 + (part.pos?.[0] ?? 0), towerBase + hallTop + (part.pos?.[1] ?? 0), 0.19 + (part.pos?.[2] ?? 0)] })
  }

  // Gatehouse, arch and approach stair on the front face.
  masonry.push({ geo: box(0.17, 0.34, 0.09), pos: [-0.02, 0.17, -0.325], uv: [3.5, 6], tint: stone(0.8) })
  masonry.push(...merlons(0.0, 1, 0.19, 0.05, 0.36).map((part) => ({ ...part, pos: [-0.02, 0.365, -0.325] as [number, number, number], tint: stone(1.02) })))
  trim.push({ geo: box(0.088, 0.15, 0.02), pos: [-0.02, 0.09, -0.375], uv: [3, 3] })
  metal.push({ geo: box(0.096, 0.012, 0.006), pos: [-0.02, 0.135, -0.382] })
  metal.push({ geo: box(0.096, 0.012, 0.006), pos: [-0.02, 0.05, -0.382] })
  for (let step = 0; step < 3; step += 1) {
    masonry.push({ geo: box(0.14 + step * 0.02, 0.017, 0.03), pos: [-0.02, 0.045 - step * 0.017, -0.385 - step * 0.028], uv: [3, 0.4], tint: stone(0.62 - step * 0.06) })
  }

  for (const spec of [
    windowOpening(-0.02, keepBase + 0.24, 0.085, 0, 0.05, 0.065),
    windowOpening(0.083, keepBase + 0.15, -0.02, Math.PI / 2, 0.045, 0.06),
    windowOpening(-0.02, keepBase + 0.11, -0.125, 0, 0.045, 0.06),
    windowOpening(0.19, towerBase + 0.17, 0.19, 0, 0.04, 0.052),
    windowOpening(-0.115, towerBase + 0.07, 0.268, 0, 0.045, 0.05),
  ]) {
    timber.push(...spec.frame)
    glass.push(spec.glass)
    masonry.push(...spec.grime)
  }

  // Soot and rain staining under every cornice on the city, plus a wet band
  // round the foot of the curtain wall. The critic read the city as pale; the
  // fix is not to repaint it but to stop every course sharing one value.
  masonry.push({ geo: cyl(0.318, 0.318, 0.03, 12), pos: [0, 0.297, 0], uv: [6, 0.6], tint: stone(0.44) })
  masonry.push({ geo: cyl(0.379, 0.379, 0.03, 12), pos: [0, 0.016, 0], uv: [6, 0.6], tint: damp(0.34) })
  for (const [cx, cz, w, d, top] of [
    [-0.02, -0.02, 0.2, 0.2, keepBase + keepH - 0.04],
    [0.19, 0.13, 0.115, 0.115, towerBase + towerH - 0.036],
    [-0.03, 0.19, hallW, hallD, towerBase + hallTop - 0.03],
  ] as Array<[number, number, number, number, number]>) {
    for (const side of [-1, 1]) {
      plaster.push({ geo: box(w + 0.002, 0.03, 0.004), pos: [cx, top, cz + side * (d / 2 + 0.002)], uv: [6, 1], tint: stone(0.5) })
      plaster.push({ geo: box(0.004, 0.03, d + 0.002), pos: [cx + side * (w / 2 + 0.002), top, cz], uv: [6, 1], tint: stone(0.5) })
    }
  }

  // Hanging banners flanking the gate, plus the keep pennant.
  cloth.push({ geo: banner(0.086, 0.205), pos: [-0.122, 0.185, -0.356], rot: [0, Math.PI + 0.32, 0], uv: [1, 1] })
  cloth.push({ geo: banner(0.086, 0.205), pos: [0.082, 0.185, -0.356], rot: [0, Math.PI - 0.32, 0], uv: [1, 1] })
  // A third banner over the curtain wall, facing the island interior, so a city
  // is identifiable from any azimuth the rig allows.
  cloth.push({ geo: banner(0.09, 0.2), pos: [0.0, 0.235, 0.318], rot: [0, 0, 0], uv: [1, 1] })
  metal.push({ geo: cyl(0.005, 0.005, 0.07, 6), pos: [-0.115, 0.278, -0.352], rot: [Math.PI / 2, 0, 0.32] })
  metal.push({ geo: cyl(0.005, 0.005, 0.07, 6), pos: [0.075, 0.278, -0.352], rot: [Math.PI / 2, 0, -0.32] })
  // Both flagpoles are shorter than they want to be, and the reason is the
  // number tokens. The tallest thing on this piece stands a hex radius from a
  // neighbouring tile's disc, well inside the sight cone that terrain now obeys,
  // and a pole is the cheapest 15cm on the model to give back.
  timber.push({ geo: cyl(0.007, 0.008, 0.14, 6), pos: [0.19, towerBase + towerH + 0.15, 0.13], uv: [1, 3] })
  cloth.push({ geo: pennant(0.2, 0.1), pos: [0.196, towerBase + towerH + 0.175, 0.13], rot: [0, 0.2, 0], uv: [1, 1] })
  // Keep pennant as well: the tallest point on the piece should say who owns it.
  timber.push({ geo: cyl(0.007, 0.008, 0.12, 6), pos: [-0.02, keepBase + keepH + 0.15, -0.02], uv: [1, 3] })
  cloth.push({ geo: pennant(0.17, 0.09), pos: [-0.014, keepBase + keepH + 0.17, -0.02], rot: [0, -0.5, 0], uv: [1, 1] })

  return {
    masonry: merge(masonry),
    plaster: merge(plaster),
    roof: merge(roof),
    timber: merge(timber),
    glass: merge(glass),
    metal: merge(metal),
    cloth: merge(cloth),
    trim: merge(trim),
    floor: merge(floor),
  }
}

const settlementGeometry = lazy(buildSettlement)
const cityGeometry = lazy(buildCity)

// ---------------------------------------------------------------------------
// The number token's sight line
//
// A number is game state, and a building standing at a hex corner sits partly
// over the tile behind it. The terrain now obeys `sightCeiling` so no landform
// can bury a token; the pieces have to obey the same contract, because with the
// ground clear the walls were the next thing in the way at grazing angles.
//
// Measured off the merged geometry rather than guessed, and tested as a cone
// across the footprint the way `TerrainField` tests a crag. A building is much
// narrower at its ridge than at its talus, and treating it as a cylinder of its
// widest course protects airspace nothing is occupying — which for the city
// would mean shrinking every one of them by a fifth to clear eleven samples.
// ---------------------------------------------------------------------------

/** Where a piece stands relative to the plateau the tokens are measured from. */
const PIECE_BASE = 0.478 - GROUND_Y

/**
 * The scale each model is placed at, and the bounding box it was measured at.
 * The city came down from 1.05: with the flagpoles already shortened it still
 * broke a neighbouring token's cone, and an eighth off a keep is a far smaller
 * loss than a number you cannot read.
 */
export const BUILDING_SCALE = { settlement: 1.14, city: 0.9 } as const

export const BUILDING_PROFILE = {
  settlement: { top: 0.652 * BUILDING_SCALE.settlement, radius: 0.275 * BUILDING_SCALE.settlement, base: PIECE_BASE },
  city: { top: 0.885 * BUILDING_SCALE.city, radius: 0.456 * BUILDING_SCALE.city, base: PIECE_BASE },
} as const

/**
 * Footprint samples, as fractions of the base radius, each with the share of
 * full height the silhouette actually carries there. Same shape as the terrain
 * field's prop cone and deliberately so: two rules for one contract is how the
 * board ends up with a token you can read from the ground and not from the air.
 */
const CONE_SAMPLES: Array<[number, number, number]> = (() => {
  const out: Array<[number, number, number]> = [[0, 0, 1]]
  for (let index = 0; index < 8; index += 1) {
    const angle = (index / 8) * Math.PI * 2
    for (const fraction of [0.45, 0.85]) {
      out.push([Math.cos(angle) * fraction, Math.sin(angle) * fraction, Math.max(0.18, 1 - 0.85 * fraction)])
    }
  }
  return out
})()

/** Highest a building at this corner may reach, in relief units above the plateau. */
export const buildingHeadroom = (board: Board, vertexId: string, type: 'settlement' | 'city') => {
  const vertex = board.vertices[vertexId]
  const profile = BUILDING_PROFILE[type]
  let allowed = Infinity
  for (const hexId of vertex.hexes) {
    const hex = board.hexes.find((candidate) => candidate.id === hexId)
    if (!hex) continue
    const localX = vertex.x - hex.x
    const localZ = vertex.z - hex.z
    for (const [ux, uz, share] of CONE_SAMPLES) {
      const ceiling = sightCeiling(localX + ux * profile.radius, localZ + uz * profile.radius)
      allowed = Math.min(allowed, (ceiling - profile.base) / share)
    }
  }
  return allowed
}

/**
 * How far a building at this corner has to be taken in to stay under every
 * token's cone. Normally 1, and never below 0.82 on a legal board — a corner is
 * a full hex radius from the token it could hide, which is most of the way to
 * the cone's reach already.
 */
export const buildingSightScale = (board: Board, vertexId: string, type: 'settlement' | 'city') => {
  const reach = BUILDING_PROFILE[type].top
  const allowed = buildingHeadroom(board, vertexId, type)
  return reach <= allowed ? 1 : Math.max(0.6, allowed / reach)
}

function Structure({ groups, color }: { groups: Groups; color: PlayerColor }) {
  return <group>
    <mesh geometry={groups.masonry} material={variedMasonryMaterial()} castShadow receiveShadow />
    <mesh geometry={groups.plaster} material={variedPlasterMaterial()} castShadow receiveShadow />
    <mesh geometry={groups.roof} material={roofMaterial(PLAYER_ROOF[color])} castShadow receiveShadow />
    <mesh geometry={groups.timber} material={timberMaterial()} castShadow receiveShadow />
    <mesh geometry={groups.glass} material={glassMaterial()} />
    <mesh geometry={groups.metal} material={ironMaterial()} castShadow />
    <mesh geometry={groups.cloth} material={clothMaterial(PLAYER_BANNER[color])} castShadow />
    <mesh geometry={groups.trim} material={paintedTrimMaterial(PLAYER_TRIM[color])} castShadow receiveShadow />
    {/* The courtyard is glimpsed between merlons, so it wants the fine, darker
        terrace cobble: the coarse pale one flashed as a white patch. */}
    {groups.floor ? <mesh geometry={groups.floor} material={terraceMaterial()} receiveShadow /> : null}
  </group>
}

export function SettlementModel({ color }: { color: PlayerColor }) {
  return <Structure groups={settlementGeometry()} color={color} />
}

export function CityModel({ color }: { color: PlayerColor }) {
  return <Structure groups={cityGeometry()} color={color} />
}

const ghostCache = new Map<string, THREE.MeshStandardMaterial>()
const ghostMaterial = (color: string, opacity: number) => {
  const key = `${color}:${opacity}`
  const hit = ghostCache.get(key)
  if (hit) return hit
  const material = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.5,
    transparent: true,
    opacity,
    depthWrite: false,
    roughness: 0.45,
  })
  ghostCache.set(key, material)
  return material
}

/** Translucent preview of what a placement would build. */
export function SettlementGhost({ color, opacity }: { color: string; opacity: number }) {
  const groups = settlementGeometry()
  const material = ghostMaterial(color, opacity)
  return <group>
    <mesh geometry={groups.masonry} material={material} />
    <mesh geometry={groups.plaster} material={material} />
    <mesh geometry={groups.roof} material={material} />
  </group>
}
