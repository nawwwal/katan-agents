import * as THREE from 'three'
import type { PlayerColor } from '../../game/types'
import { BEACON_FRAME, PLAYER_BANNER, PLAYER_ROAD } from '../playerColors'
import { box, cone, cyl, merge, pennant, plate, type Part } from './geometry'
import { clothMaterial, paleStoneMaterial, pavingMaterial, timberMaterial } from './materials'
import { contactShadowTexture, makeRng } from './textures'

// A raised causeway: a stepped pale-limestone plinth and kerb carrying a wide
// band of player-coloured setts, with a waymark post at mid-span.
//
// The design is driven by one problem. The island already draws a road-like
// thing along every hex boundary: a dark stone wall with a pale sand path
// beside it. A player-coloured strip laid on that seam competes with it and
// loses, which is why the first rebuild still failed a blind read. So this
// piece is deliberately unlike a boundary. It is markedly wider than the
// border it sits on, it steps up out of the ground with a cross-section you
// can see from above, its kerb is pale where every border wall is dark, and it
// carries its own baked contact shadow so the colour separates from whatever
// terrain it crosses. The waymark repeats the colour above the scatter line.

type RoadGroups = {
  /** Plinth and kerbs. Pale stone, and the same for every player. */
  stone: THREE.BufferGeometry
  /** The player-coloured deck. */
  deck: THREE.BufferGeometry
}

type MarkGroups = {
  post: THREE.BufferGeometry
  cloth: THREE.BufferGeometry
  /** Merged into the road's plinth group so a road stays five draw calls. */
  stone: Part[]
}

const LENGTH = 1
/** Half-width of the coloured deck — by far the dominant read from above. */
const DECK_HALF = 0.142
/** Centre line of each kerb rail. */
const KERB_Z = 0.171
const KERB_W = 0.058
/** The plinth course steps out past the kerb, so the road has a visible base. */
const PLINTH_HALF = 0.228
/** Deck crowns above the kerb, so the colour is never hidden behind stone. */
const DECK_TOP = 0.142
const KERB_TOP = 0.118
const PLINTH_TOP = 0.052

/** Kerb rails sit in the band immediately outboard of the deck. */
const KERB_IN = KERB_Z - KERB_W / 2
const KERB_OUT = KERB_Z + KERB_W / 2

// ---------------------------------------------------------------------------
// Junctions
//
// Every board edge is length 1 and edges meet at a vertex at 120°, so each end
// of a road lands in a shared corner with up to two others. Square-cut ends
// notch each other there: a bend leaves a wedge of bare ground on the outside
// of the turn, and both kerbs run straight on across the other road's deck.
//
// The fix is a true mitre, and the hex board makes it exact. Take the hexagon
// centred on the vertex whose apothem is the deck half-width; because the three
// edge directions at a vertex are 120° apart, that hexagon's faces lie exactly
// on all six deck edges arriving there. Its six 60° triangles then divide the
// corner cleanly, and each road claims the arc between the bisectors to its
// neighbours: 120° at a three-way, 180° at a bend, the whole hexagon at a dead
// end. Claims tile the corner with no gap and no overlap.
//
// That last property is why this is a mitre and not a shared junction plate.
// Two players meeting at a vertex each pave their own half and meet on a
// straight radial line, so a route stays traceable through the joint instead of
// dissolving into a neutral node. There is also nothing extra to draw: the
// mitre is merged into the road's own two geometry groups, so a road is still
// four draw calls whatever its neighbours do.
// ---------------------------------------------------------------------------

const DEG = Math.PI / 180
/** Distance from the centre to a hexagon corner, given the apothem. */
const hexR = (apothem: number) => apothem / Math.cos(30 * DEG)
/** Distance to the hexagon outline at `deg`, with corners on 0°, 60°, 120°… */
const hexRadius = (apothem: number, deg: number) =>
  apothem / Math.cos(((((deg % 60) + 60) % 60) - 30) * DEG)
const hexPoint = (apothem: number, deg: number, scale = 1): [number, number] => {
  const r = hexRadius(apothem, deg) * scale
  return [r * Math.cos(deg * DEG), r * Math.sin(deg * DEG)]
}
/** Where the radial line at `deg` crosses a given `z`. */
const rayX = (z: number, deg: number) => z / Math.tan(deg * DEG)

/** Setts and plinth blocks stop short of the corner the mitre plates fill. */
const DECK_TRIM = hexR(DECK_HALF) / 2
const PLINTH_TRIM = hexR(PLINTH_HALF) / 2

/** Which of the two possible neighbour roads exist at one end of an edge. */
export type EndJoin = { plus: boolean; minus: boolean }
/** `a` is the end at local −X, `b` the end at local +X. */
export type RoadJoins = { a: EndJoin; b: EndJoin }

const LOOSE: EndJoin = { plus: false, minus: false }
/** A standalone road: both ends finish with a kerb return. */
export const FREE_JOINS: RoadJoins = { a: LOOSE, b: LOOSE }

const joinsKey = (joins: RoadJoins) =>
  `${+joins.a.plus}${+joins.a.minus}${+joins.b.plus}${+joins.b.minus}`

/**
 * The angular claim one end makes on its corner, as the two bounding rays.
 *
 * `own` is the direction the road leaves the vertex in. A neighbour on a side
 * pushes the boundary in to the 60° bisector; no neighbour lets the claim run
 * out to that empty 120° slot, and with both slots empty the road takes the
 * whole hexagon and closes itself off with a kerb return.
 */
const claim = (sign: 1 | -1, join: EndJoin) => {
  const own = sign > 0 ? 180 : 0
  const plus = join.plus ? own - 60 * sign : own - 120 * sign
  const minus = join.minus ? own + 60 * sign : own + 120 * sign
  return {
    /** Ray bounding the +Z kerb. */ plus,
    /** Ray bounding the −Z kerb. */ minus,
    // Sector swept by the deck and plinth mitre plates. The +Z bound is the
    // lower angle at the +X end and the upper one at the −X end, because the
    // road points the other way there.
    lo: sign > 0 ? plus : minus,
    hi: sign > 0 ? minus : plus,
    dead: !join.plus && !join.minus,
  }
}

/** Road-local X where the kerb blocks must stop to leave room for the mitre. */
const kerbStop = (sign: 1 | -1, z: number, deg: number) => {
  const inner = rayX(z, deg)
  const outer = rayX((z / Math.abs(z)) * KERB_OUT, deg)
  return sign * LENGTH / 2 + (sign > 0 ? Math.min(inner, outer) : Math.max(inner, outer))
}

/** Mitred end of one kerb rail: the wedge between its square stop and the ray. */
const kerbMitre = (sign: 1 | -1, side: 1 | -1, deg: number): Part => {
  const zIn = side * KERB_IN
  const zOut = side * KERB_OUT
  const stop = kerbStop(sign, zIn, deg) - sign * LENGTH / 2
  return {
    geo: plate([[stop, zIn], [rayX(zIn, deg), zIn], [rayX(zOut, deg), zOut], [stop, zOut]], KERB_TOP - 0.001, KERB_TOP - PLINTH_TOP + 0.01),
    pos: [sign * LENGTH / 2, 0, 0],
    // Plate UVs come out in world units, so the multiplier is the repeat rate.
    // Matching the blocks' 21-per-unit is what keeps the mitre the same stone.
    uv: [21, 21],
    tint: [1.06, 1.04, 1],
  }
}

/** Kerb closing a dead end, following the hexagon faces around the terminus. */
const kerbReturn = (from: number, to: number): Part[] => {
  const parts: Part[] = []
  for (let deg = from; deg < to - 1; deg += 60) {
    parts.push({
      geo: plate([
        hexPoint(KERB_IN, deg), hexPoint(KERB_IN, deg + 60),
        hexPoint(KERB_OUT, deg + 60), hexPoint(KERB_OUT, deg),
      ], KERB_TOP - 0.001, KERB_TOP - PLINTH_TOP + 0.01),
      uv: [21, 21],
      tint: [1.06, 1.04, 1],
    })
  }
  return parts
}

/**
 * The mitre paving itself: the claimed sector laid as a radial fan, because a
 * junction is where real setts turn to face the corner and a single flat plate
 * would read as a lid dropped on the joint.
 */
const fan = (
  apothem: number,
  lo: number,
  hi: number,
  top: number,
  thickness: number,
  repeat: number,
  random: () => number,
  base: [number, number, number],
): Part[] => {
  const parts: Part[] = []
  const rings = [0, 0.46, 1]
  for (let deg = lo; deg < hi - 1; deg += 20) {
    for (let ring = 0; ring < rings.length - 1; ring += 1) {
      const [inner, outer] = [rings[ring], rings[ring + 1]]
      const points: Array<[number, number]> = inner === 0
        ? [[0, 0], hexPoint(apothem, deg, outer), hexPoint(apothem, deg + 20, outer)]
        : [
          hexPoint(apothem, deg, inner), hexPoint(apothem, deg + 20, inner),
          hexPoint(apothem, deg + 20, outer), hexPoint(apothem, deg, outer),
        ]
      // Only enough value spread to keep the corner from going flat. More than
      // this and a three-owner junction turns into a pinwheel.
      const value = 0.96 + random() * 0.09
      parts.push({
        geo: plate(points, top - random() * 0.003, thickness),
        uv: [repeat, repeat],
        tint: [base[0] * value, base[1] * value, base[2] * value],
      })
    }
  }
  return parts
}

/** Everything one end of a road contributes to its corner. */
const endParts = (sign: 1 | -1, join: EndJoin, random: () => number) => {
  const at = claim(sign, join)
  const stone: Part[] = []
  const deck: Part[] = []
  const shift: [number, number, number] = [sign * LENGTH / 2, 0, 0]
  const [lo, hi] = at.dead ? [0, 360] : [at.lo, at.hi]

  // Plinth step and its buried footing, carried around the claimed sector.
  for (const part of fan(PLINTH_HALF, lo, hi, PLINTH_TOP, 0.34, 8, random, [0.94, 0.92, 0.87])) {
    stone.push({ ...part, pos: shift })
  }
  // Deck paving, crowned a whisker above the setts running into it. A junction
  // that dips reads as a pothole; one that lifts reads as a plaza, and sitting
  // clear of the sett tops also keeps the two off the same plane.
  for (const part of fan(DECK_HALF, lo, hi, DECK_TOP - 0.001, 0.09, 21, random, [0.92, 0.91, 0.88])) {
    deck.push({ ...part, pos: shift })
  }
  // Kerb: mitred against each neighbour, or wrapped right round a dead end.
  stone.push(kerbMitre(sign, 1, at.plus), kerbMitre(sign, -1, at.minus))
  if (at.dead) {
    const [from, to] = sign > 0 ? [at.minus, at.plus + 360] : [at.plus, at.minus + 360]
    for (const part of kerbReturn(from, to)) stone.push({ ...part, pos: shift })
  }
  return { stone, deck, at }
}

const build = (joins: RoadJoins): RoadGroups => {
  const stone: Part[] = []
  const deck: Part[] = []
  // Separate streams per course, so a road's setts and plinth stay identical
  // whatever its neighbours do and only the joint itself changes when one lands.
  const plinthRng = makeRng(9173)
  const kerbRng = makeRng(4411)
  const deckRng = makeRng(7727)
  const jointRng = makeRng(3313)

  const ends = { a: endParts(-1, joins.a, jointRng), b: endParts(1, joins.b, jointRng) }
  stone.push(...ends.a.stone, ...ends.b.stone)
  deck.push(...ends.a.deck, ...ends.b.deck)

  // Buried footing. Deep enough that a dip in the tile relief never shows
  // daylight under the road; the mitre plates carry it through the corners.
  const footing = LENGTH - PLINTH_TRIM * 2
  stone.push({ geo: box(footing, 0.3, PLINTH_HALF * 2), pos: [0, -0.152, 0], uv: [8, 2], tint: [0.74, 0.72, 0.68] })

  // Plinth course: the step that lifts the causeway clear of the hex seam and
  // gives it a cross-section you can actually see at the game camera.
  const plinths = 6
  for (let index = 0; index < plinths; index += 1) {
    const x = ((index + 0.5) / plinths - 0.5) * footing
    const value = 0.9 + plinthRng() * 0.24
    stone.push({
      geo: box(footing / plinths + 0.005, PLINTH_TOP + 0.04, PLINTH_HALF * 2 - plinthRng() * 0.008),
      pos: [x, (PLINTH_TOP - 0.04) / 2, (plinthRng() - 0.5) * 0.005],
      rot: [0, (plinthRng() - 0.5) * 0.02, (plinthRng() - 0.5) * 0.02],
      uv: [2, 1],
      tint: [value, value * 0.98, value * 0.93],
    })
  }

  // Kerb rails. Pale set stone, because every boundary wall on this island is
  // dark: a dark kerb here just reads as more border. Each rail runs between
  // its own two mitre stops, so the two sides of a bend are different lengths —
  // the outside of the turn reaches past the vertex, the inside pulls back.
  for (const side of [-1, 1] as const) {
    const z = side * KERB_IN
    const from = kerbStop(-1, z, side > 0 ? ends.a.at.plus : ends.a.at.minus)
    const to = kerbStop(1, z, side > 0 ? ends.b.at.plus : ends.b.at.minus)
    const blocks = Math.max(4, Math.round((to - from) / 0.1))
    for (let index = 0; index < blocks; index += 1) {
      const x = from + ((index + 0.5) / blocks) * (to - from)
      const top = KERB_TOP - kerbRng() * 0.009
      const value = 1.02 + kerbRng() * 0.28
      stone.push({
        geo: box((to - from) / blocks + 0.006, top - PLINTH_TOP + 0.01, KERB_W + kerbRng() * 0.008),
        pos: [x, (top + PLINTH_TOP - 0.01) / 2, side * KERB_Z + (kerbRng() - 0.5) * 0.006],
        rot: [(kerbRng() - 0.5) * 0.04, (kerbRng() - 0.5) * 0.03, (kerbRng() - 0.5) * 0.05],
        uv: [2.2, 1.2],
        tint: [value, value * 0.98, value * 0.94],
      })
    }
  }

  // Deck setts. Four courses across, crowned in the middle, each stone with its
  // own value so the colour band is laid stone and not a painted stripe. The
  // field stops at the corner hexagon and the mitre fan takes it from there.
  const span = LENGTH - DECK_TRIM * 2
  const rows = 13
  const columns = [-1.5, -0.5, 0.5, 1.5]
  for (let row = 0; row < rows; row += 1) {
    const x = ((row + 0.5) / rows - 0.5) * span
    for (const column of columns) {
      const top = DECK_TOP - Math.abs(column) * 0.008 - deckRng() * 0.006
      const value = 0.88 + deckRng() * 0.24
      deck.push({
        geo: box(span / rows - 0.005 + deckRng() * 0.006, top + 0.08, DECK_HALF / 2 - 0.005 + deckRng() * 0.006),
        pos: [x + (deckRng() - 0.5) * 0.004, (top - 0.08) / 2, (column * DECK_HALF) / 2 + (deckRng() - 0.5) * 0.005],
        rot: [(deckRng() - 0.5) * 0.04, (deckRng() - 0.5) * 0.03, (deckRng() - 0.5) * 0.04],
        uv: [1.4, 1.4],
        tint: [value, value * 0.99, value * 0.96],
      })
    }
  }

  return { stone: merge(stone), deck: merge(deck) }
}

const MARK_Z = KERB_Z + 0.028

const buildMark = (): MarkGroups => {
  const post: Part[] = [
    { geo: cyl(0.014, 0.019, 0.28, 10), pos: [0, 0.28 / 2 + 0.1, MARK_Z], uv: [1, 4] },
  ]
  // Socket stone and finial: stone, so they ride along in the plinth group.
  const stone: Part[] = [
    { geo: box(0.052, 0.036, 0.052), pos: [0, 0.104, MARK_Z], uv: [1, 1], tint: [0.82, 0.8, 0.76] },
    { geo: cone(0.021, 0.042, 8), pos: [0, 0.4, MARK_Z], tint: [1.2, 1.16, 1.08] },
  ]
  const cloth: Part[] = [
    { geo: pennant(0.126, 0.074, 0.014), pos: [0.009, 0.312, MARK_Z], rot: [0, 0.18, 0], uv: [1, 1] },
  ]
  return { post: merge(post), cloth: merge(cloth), stone }
}

/**
 * Baked contact shadow. Scene-wide cast shadows are being repaired separately;
 * this is the ground darkening a causeway would have regardless, and it is what
 * stops the coloured deck floating on whatever terrain it crosses. Kept low
 * enough in opacity that it adds to a real shadow rather than doubling it.
 */
const shadowMaterial = (() => {
  let material: THREE.MeshBasicMaterial | null = null
  return () => {
    if (!material) {
      material = new THREE.MeshBasicMaterial({
        color: '#120d08',
        alphaMap: contactShadowTexture(),
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
        toneMapped: false,
      })
    }
    return material
  }
})()

function ContactShadow() {
  return <mesh position={[0, -0.03, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={-1}>
    {/* Wide enough to still sit under a mitred corner or a closed terminus. */}
    <planeGeometry args={[LENGTH * 1.18, PLINTH_HALF * 3.2]} />
    <primitive object={shadowMaterial()} attach="material" />
  </mesh>
}

let markCache: MarkGroups | null = null
const markParts = () => {
  if (!markCache) markCache = buildMark()
  return markCache
}

// Sixteen possible corner configurations, built on first sight and then shared.
// Every road on the board with the same joinery draws the same two buffers.
const cache = new Map<string, RoadGroups>()
const groups = (joins: RoadJoins) => {
  const key = joinsKey(joins)
  const hit = cache.get(key)
  if (hit) return hit
  const built = build(joins)
  cache.set(key, built)
  return built
}

/**
 * `length` is the world length of the edge. Every edge on a regular hex board
 * is exactly 1, so this is normally identity; it is kept so the piece still
 * behaves if the topology ever changes.
 */
export function RoadModel({ color, length = 1, joins = FREE_JOINS }: { color: PlayerColor; length?: number; joins?: RoadJoins }) {
  const parts = groups(joins)
  const mark = markParts()
  return <group scale={[length, 1, 1]}>
    <ContactShadow />
    <mesh geometry={parts.stone} material={paleStoneMaterial()} castShadow receiveShadow />
    <mesh geometry={parts.deck} material={pavingMaterial(PLAYER_ROAD[color])} castShadow receiveShadow />
    <mesh geometry={mark.post} material={timberMaterial()} castShadow />
    <mesh geometry={mark.cloth} material={clothMaterial(PLAYER_BANNER[color])} castShadow />
  </group>
}

const ghostCache = new Map<string, THREE.Material>()

/**
 * The deck of a legal road.
 *
 * Opaque, because a translucent deck let the near-black frame and the mast sort
 * through it as dark voids. Emissive rather than unlit: fully unlit came back
 * as a flat plastic slab with no form at all, and strong self-illumination on a
 * lit material keeps the colour from being muted by a hex wall's shade while
 * still letting the sun model the cross-section.
 */
const ghostDeck = (color: string) => {
  const key = `deck:${color}`
  const hit = ghostCache.get(key)
  if (hit) return hit
  const material = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.32,
    roughness: 0.55,
    metalness: 0,
  })
  ghostCache.set(key, material)
  return material
}

/**
 * The frame of a legal road: near-black where a built road's kerb and plinth
 * are pale limestone. That inversion does two jobs at once — it gives the
 * coloured deck something to sit against on pale sand, and it means a marker is
 * never read as a causeway somebody already paved.
 */
const ghostFrame = () => {
  const hit = ghostCache.get('frame')
  if (hit) return hit
  const material = new THREE.MeshStandardMaterial({ color: BEACON_FRAME, roughness: 0.62, metalness: 0 })
  ghostCache.set('frame', material)
  return material
}

/** Preview of the road you would build, in the same shape as the real thing. */
export function RoadGhost({ deck, length = 1 }: { deck: string; length?: number }) {
  // A preview is a whole road offered on its own, so it shows closed ends; the
  // joint forms when it lands and its neighbours pick it up. The closed ends
  // matter twice over here: they are what keeps a run of adjacent markers
  // reading as separate offers rather than one paved river.
  const parts = groups(FREE_JOINS)
  return <group scale={[length, 1, 1]}>
    <mesh geometry={parts.stone} material={ghostFrame()} castShadow receiveShadow />
    <mesh geometry={parts.deck} material={ghostDeck(deck)} />
  </group>
}
