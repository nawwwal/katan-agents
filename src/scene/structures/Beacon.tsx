import * as THREE from 'three'
import { BEACON_FRAME } from '../playerColors'
import { box, cyl, merge, prism } from './geometry'
import { beaconPoolTexture } from './textures'

// ---------------------------------------------------------------------------
// The legal-target marker language.
//
// One problem drives every decision here. A legal target has to be found in
// under a second, at the resting camera, against pale sand paths, bleached
// beach, dark forest canopy, grey rock, golden wheat, red clay and blue water,
// all of which can be in the same frame. No single flat colour survives that
// set, which is why the pale-cream pennant this replaces was invisible: it was
// one warm value on an island made of warm values.
//
// The road rebuild already solved the same problem, so this reuses its answer.
// Every marker is a pair: a bright, high-chroma half in the acting player's
// colour, and a near-black half. On dark ground the bright half carries; on
// pale ground the dark half carries; there is no ground on this island where
// both disappear. The pairing is repeated three times over, at three scales:
//
//   ground    a dark pool with a coloured ring laid on it
//   silhouette a near-black mast carrying a coloured blade, standing clear of
//             the ground plane so it breaks the terrain scatter line instead of
//             lying under it, and casting a real shadow now that shadows work
//   shape     the blade's outline, which is the non-colour channel: a caret
//             pointing down at open ground for "found here", a bar lying along
//             the edge for "pave here", a double chevron pointing up for
//             "raise this", which is the one that marks something already yours
//
// Motion is the fourth separator, and the cheapest: terrain never pulses. The
// ring breathes on a 1.6s cycle with a per-target phase seeded from the board
// id, so the set shimmers rather than strobing in unison.
// ---------------------------------------------------------------------------

/** Height of the blade's centre above the pad's top face. */
export const BLADE_Y = 0.34
const MAST_HEIGHT = 0.3

export const BEACON_PERIOD = 1.6

/**
 * How far the pad's top face stands above the piece plane.
 *
 * The dark half started as a decal laid flat on the ground and it barely
 * survived a single screenshot: a hex vertex is the busiest surface on the
 * island — a kerbed path, two rows of scattered kerbstones and the shoulders of
 * three tiles' relief all meet there — and a coplanar disc came back cut into
 * arcs, present on the beach where the land falls away and gone everywhere
 * else. So the dark half is a solid now. A volume displaces terrain instead of
 * arguing with it, it reads from the side as well as from above, and it casts a
 * real contact shadow.
 *
 * The height is measured too. At six centimetres the pad was visible on the
 * near half of the board and gone on the far half, because a shallow grazing
 * ray clears the tile shoulder in front of it. It now clears a road deck, which is the
 * tallest thing that can already be standing on the seam a legal corner sits
 * on, since a settlement is normally built onto your own road.
 */
export const PAD_TOP = 0.175
const PAD_HEIGHT = 0.25
export const PAD_RADIUS = 0.235

const lazy = <T,>(build: () => T) => {
  let value: T | null = null
  return () => {
    if (value === null) value = build()
    return value
  }
}

// ------------------------------------------------------------------ ground

/** The dark pad a target stands on: slightly conical, so it beds into a slope. */
export const padGeometry = lazy(() => {
  const geometry = new THREE.CylinderGeometry(PAD_RADIUS, PAD_RADIUS + 0.035, PAD_HEIGHT, 18)
  geometry.translate(0, PAD_TOP - PAD_HEIGHT / 2, 0)
  return geometry
})

/** The coloured band inset into the pad's top face. */
export const bandGeometry = lazy(() => {
  const geometry = new THREE.RingGeometry(PAD_RADIUS * 0.62, PAD_RADIUS * 0.9, 28)
  geometry.rotateX(-Math.PI / 2)
  geometry.translate(0, PAD_TOP + 0.002, 0)
  return geometry
})

/**
 * The dark ring set around a building you may upgrade. Sized to hug the
 * footing's dirt apron rather than the neighbourhood: at 0.8 it enclosed half a
 * hex and stopped pointing at anything.
 */
const COLLAR_R = 0.52
export const collarGeometry = lazy(() => {
  const geometry = new THREE.TorusGeometry(COLLAR_R, 0.055, 8, 40)
  geometry.rotateX(Math.PI / 2)
  geometry.scale(1, 0.6, 1)
  return geometry
})

/** Its bright inlay, nested on top so the pairing survives on any ground. */
export const collarBandGeometry = lazy(() => {
  const geometry = new THREE.TorusGeometry(COLLAR_R, 0.028, 8, 40)
  geometry.rotateX(Math.PI / 2)
  geometry.scale(1, 0.62, 1)
  geometry.translate(0, 0.024, 0)
  return geometry
})

// -------------------------------------------------------------- silhouette

export const frameMaterial = lazy(() => new THREE.MeshStandardMaterial({
  color: BEACON_FRAME,
  roughness: 0.7,
  metalness: 0,
}))

/**
 * The soft dark smear a road beacon lays along its edge. Roads are long and
 * low, so a pad would fight the causeway silhouette; this is the same contrast
 * floor spread thin instead.
 */
export const roadPoolMaterial = lazy(() => new THREE.MeshBasicMaterial({
  color: BEACON_FRAME,
  alphaMap: beaconPoolTexture(),
  transparent: true,
  opacity: 0.55,
  depthWrite: false,
  toneMapped: false,
}))

/**
 * The blade is unlit on purpose. It is the one part of the marker that must
 * read the same in the sun and in the shadow of a headland, and a lit surface
 * loses half its value the moment a cloud shadow or a hex wall crosses it.
 */
export const bladeMaterial = lazy(() => new THREE.MeshBasicMaterial({
  color: '#ffffff',
  toneMapped: false,
}))

/**
 * Blades are crossed pairs so the silhouette is the same triangle from any
 * azimuth. A single plate goes edge-on as the camera orbits, which is how a
 * marker quietly stops existing on one side of the board.
 */
const crossed = (parts: Array<{ w: number; h: number; y: number; flip?: boolean }>) => merge(
  parts.flatMap(({ w, h, y, flip }) => [0, Math.PI / 2].map((yaw) => ({
    geo: prism(w, h, 0.03),
    pos: [0, y, 0] as [number, number, number],
    rot: [0, yaw, flip ? Math.PI : 0] as [number, number, number],
  }))),
)

export type BeaconKind = 'settlement' | 'road' | 'city'

/** A caret aimed at the ground: "found one here". */
const settlementBlade = lazy(() => crossed([{ w: 0.185, h: 0.175, y: 0, flip: true }]))
/**
 * A caret lifting off a sill: "raise the one that is already yours". The mirror
 * of the settlement caret, which is the point — one points down at open ground,
 * one points up off a building. It was two stacked chevrons for one pass and
 * came back reading as a fir tree, on an island covered in fir trees.
 */
const cityBlade = lazy(() => merge([
  ...[0, Math.PI / 2].map((yaw) => ({ geo: prism(0.2, 0.16, 0.03), pos: [0, 0.035, 0] as [number, number, number], rot: [0, yaw, 0] as [number, number, number] })),
  { geo: box(0.22, 0.036, 0.06), pos: [0, -0.09, 0] as [number, number, number] },
  { geo: box(0.06, 0.036, 0.22), pos: [0, -0.09, 0] as [number, number, number] },
]))
/** A bar lying along the edge: "pave this". */
const roadBlade = lazy(() => box(0.26, 0.052, 0.052))

export const bladeGeometry = (kind: BeaconKind) =>
  kind === 'city' ? cityBlade() : kind === 'road' ? roadBlade() : settlementBlade()

/**
 * Mast and collar in one buffer. The collar is a dark shoulder directly under
 * the blade so the bright shape always has a dark neighbour in screen space,
 * not only a dark pool a hundred pixels below it.
 */
export const mastGeometry = lazy(() => merge([
  { geo: cyl(0.019, 0.028, MAST_HEIGHT, 8), pos: [0, MAST_HEIGHT / 2, 0] },
  { geo: cyl(0.072, 0.086, 0.036, 12), pos: [0, MAST_HEIGHT - 0.014, 0] },
]))

/**
 * A standing marker with no ring — used where the ground read belongs to the
 * piece already sitting there, as on a city upgrade.
 */
export const dropLineGeometry = lazy(() => cyl(0.016, 0.016, 0.26, 6))

// ------------------------------------------------------------------- robber

/**
 * A hex a robber may be moved to.
 *
 * Same grammar as the rest, scaled up to a whole tile: a near-black kerb with
 * a bright band inlaid along its top. It replaces a flat `#ffd66a` outline at
 * 0.38 opacity, which was the same hue and value as the sand borders edging
 * every tile on this island and could not be found in a live capture at all.
 *
 * The hue is red rather than the acting player's colour, and that break is
 * deliberate: everywhere else a beacon says "this could be yours", and here it
 * says "this is where the robber lands". Red is also the one signal on the
 * board that never means ownership, since no player carries it as a beacon.
 */
export const ROBBER_MARK = '#ff4d2e'
/** Faster than the placement pulse: one set of answers to one urgent question. */
export const ROBBER_PERIOD = 1.05

const hexPrism = (inner: number, outer: number, height: number) => {
  const corners = (radius: number) => Array.from({ length: 6 }, (_, index) => {
    const angle = Math.PI / 6 + (index * Math.PI) / 3
    return new THREE.Vector2(Math.cos(angle) * radius, Math.sin(angle) * radius)
  })
  const shape = new THREE.Shape(corners(outer))
  shape.holes.push(new THREE.Path(corners(inner).reverse()))
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false })
  // Authored in XY and extruded along +Z; this stands it up on the ground plane.
  geometry.rotateX(-Math.PI / 2)
  return geometry
}

/**
 * The kerb has to clear everything already standing on a hex seam: the sand
 * path, its two rows of kerbstones and, on most of the northern half of this
 * board, a built road whose deck tops out sixteen centimetres above the
 * plateau. At fifteen the ring was visible only on the tiles nobody had paved
 * yet, which is the wrong half of the board twice over.
 */
const KERB_BASE = -0.05
const KERB_TOP = 0.185

export const robberKerbGeometry = lazy(() => {
  const geometry = hexPrism(0.862, 0.988, KERB_TOP - KERB_BASE)
  geometry.translate(0, KERB_BASE, 0)
  return geometry
})

export const robberBandGeometry = lazy(() => {
  const geometry = hexPrism(0.888, 0.962, 0.022)
  geometry.translate(0, KERB_TOP, 0)
  return geometry
})
