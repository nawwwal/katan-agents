import * as THREE from 'three'
import { BEACON_FRAME } from '../playerColors'
import { box, cyl, merge, prism, type Part } from './geometry'
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

/**
 * Why this is six brackets and not a ring.
 *
 * The first version was a continuous kerb-and-band annulus laid along the hex
 * seam and raised to nineteen centimetres so it would clear a built road. It
 * was legible, and it was wrong. Eighteen of nineteen tiles are legal on a
 * seven, so the whole island went to a closed red honeycomb, and because the
 * honeycomb ran along the seams — which is exactly where roads are — every
 * road on the board went under it. That is the single worst frame to lose road
 * information in: choosing where the robber goes is choosing whose settlements
 * you are throttling, and you read that off the road network.
 *
 * Three changes, all pulling the same way.
 *
 * The mark comes off the seam. Corners are inset to eighty percent of the
 * circumradius, which puts the arms seventeen centimetres inside the apothem —
 * clear of a road deck's half-width with room to spare — so no marker and no
 * road ever occupy the same ground.
 *
 * The mark drops below the deck. Nothing has to clear a road any more, so the
 * top face comes down from 0.185 to 0.12, under a road's 0.163. Where the two
 * are near each other in screen space the road now stands over the marker
 * instead of the other way round.
 *
 * And the mark stops being closed. Two short arms at each corner state the hex
 * as clearly as a full outline does — the eye completes a hexagon from six
 * corners without being asked — while removing something like sixty percent of
 * the red ink. Eighteen bracketed hexes read as eighteen offers. Eighteen
 * ringed hexes read as a lattice, which is a texture, not a set.
 *
 * The bracket is also the robber's letter in the shape alphabet the rest of
 * the board already speaks: caret down for "found here", bar for "pave here",
 * caret lifting for "raise this", corner brackets for "the robber lands here".
 */
const BRACKET_INSET = 0.8
const BRACKET_ARM = 0.3
const KERB_BASE = -0.06
const KERB_TOP = 0.12
const KERB_WIDTH = 0.105
const BAND_WIDTH = 0.055

/**
 * Two arms per corner, each running back along one of the edges that meets
 * there. Built once as one buffer, drawn as one instance per hex.
 */
const bracketRing = (width: number, height: number, base: number) => {
  const corner = (index: number) => {
    const angle = Math.PI / 6 + (index * Math.PI) / 3
    return [Math.cos(angle) * BRACKET_INSET, Math.sin(angle) * BRACKET_INSET] as const
  }
  const parts: Part[] = []
  for (let index = 0; index < 6; index += 1) {
    const [ax, az] = corner(index)
    const [bx, bz] = corner((index + 1) % 6)
    const length = Math.hypot(bx - ax, bz - az)
    const yaw = -Math.atan2(bz - az, bx - ax)
    // One arm from each end of this edge, leaving the middle of the side open.
    for (const from of [0, 1]) {
      const t = from === 0 ? BRACKET_ARM / 2 / length : 1 - BRACKET_ARM / 2 / length
      parts.push({
        geo: box(BRACKET_ARM, height, width),
        pos: [ax + (bx - ax) * t, base + height / 2, az + (bz - az) * t],
        rot: [0, yaw, 0],
      })
    }
  }
  return merge(parts)
}

/** The near-black half: a low kerb, sunk into the turf so it beds rather than floats. */
export const robberKerbGeometry = lazy(() => bracketRing(KERB_WIDTH, KERB_TOP - KERB_BASE, KERB_BASE))

/** The bright half, inlaid along the kerb's top face. */
export const robberBandGeometry = lazy(() => bracketRing(BAND_WIDTH, 0.02, KERB_TOP))

// ------------------------------------------------------------- robber aura

/**
 * The halo under the robber itself — the client's "aura", and the only piece of
 * the language that marks a thing rather than a place.
 *
 * It has to say two different things at two different moments, so it is one
 * geometry driven at two strengths rather than two objects: at rest it is the
 * "this is movable, and here it is" mark that answers a live finding from the
 * audit, which is that the robber could not be located on the board at all. Once
 * the piece is picked up it becomes the contact shadow — the reason the player
 * can still tell where the robber currently stands while it is thirty-five
 * centimetres in the air and following their finger.
 */
export const AURA_RADIUS = 0.44

export const robberAuraGeometry = lazy(() => {
  const geometry = new THREE.TorusGeometry(AURA_RADIUS, 0.036, 8, 44)
  geometry.rotateX(Math.PI / 2)
  geometry.scale(1, 0.55, 1)
  return geometry
})

export const robberAuraBandGeometry = lazy(() => {
  const geometry = new THREE.TorusGeometry(AURA_RADIUS, 0.018, 8, 44)
  geometry.rotateX(Math.PI / 2)
  geometry.scale(1, 0.6, 1)
  geometry.translate(0, 0.016, 0)
  return geometry
})
