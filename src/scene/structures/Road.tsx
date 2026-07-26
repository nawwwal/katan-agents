import * as THREE from 'three'
import type { PlayerColor } from '../../game/types'
import { PLAYER_BANNER, PLAYER_ROAD } from '../playerColors'
import { box, cone, cyl, merge, pennant, type Part } from './geometry'
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

const build = (): RoadGroups => {
  const random = makeRng(9173)
  const stone: Part[] = []
  const deck: Part[] = []

  // Buried footing. Deep enough that a dip in the tile relief never shows
  // daylight under the road, and full-length so chained roads butt together
  // into one continuous ribbon instead of a dashed line.
  stone.push({ geo: box(LENGTH, 0.3, PLINTH_HALF * 2), pos: [0, -0.152, 0], uv: [8, 2], tint: [0.74, 0.72, 0.68] })

  // Plinth course: the step that lifts the causeway clear of the hex seam and
  // gives it a cross-section you can actually see at the game camera.
  const plinths = 8
  for (let index = 0; index < plinths; index += 1) {
    const x = (index + 0.5) / plinths * LENGTH - LENGTH / 2
    const value = 0.9 + random() * 0.24
    stone.push({
      geo: box(LENGTH / plinths + 0.005, PLINTH_TOP + 0.04, PLINTH_HALF * 2 - random() * 0.008),
      pos: [x, (PLINTH_TOP - 0.04) / 2, (random() - 0.5) * 0.005],
      rot: [0, (random() - 0.5) * 0.02, (random() - 0.5) * 0.02],
      uv: [2, 1],
      tint: [value, value * 0.98, value * 0.93],
    })
  }

  // Kerb rails. Pale set stone, because every boundary wall on this island is
  // dark: a dark kerb here just reads as more border.
  const blocks = 10
  for (let index = 0; index < blocks; index += 1) {
    const x = (index + 0.5) / blocks * LENGTH - LENGTH / 2
    for (const side of [-1, 1]) {
      const top = KERB_TOP - random() * 0.009
      const value = 1.02 + random() * 0.28
      stone.push({
        geo: box(LENGTH / blocks + 0.006, top - PLINTH_TOP + 0.01, KERB_W + random() * 0.008),
        pos: [x, (top + PLINTH_TOP - 0.01) / 2, side * KERB_Z + (random() - 0.5) * 0.006],
        rot: [(random() - 0.5) * 0.04, (random() - 0.5) * 0.03, (random() - 0.5) * 0.05],
        uv: [2.2, 1.2],
        tint: [value, value * 0.98, value * 0.94],
      })
    }
  }

  // Deck setts. Four courses across, crowned in the middle, each stone with its
  // own value so the colour band is laid stone and not a painted stripe.
  const rows = 15
  const columns = [-1.5, -0.5, 0.5, 1.5]
  for (let row = 0; row < rows; row += 1) {
    const x = (row + 0.5) / rows * LENGTH - LENGTH / 2
    for (const column of columns) {
      const top = DECK_TOP - Math.abs(column) * 0.008 - random() * 0.006
      const value = 0.88 + random() * 0.24
      deck.push({
        geo: box(LENGTH / rows - 0.005 + random() * 0.006, top + 0.08, DECK_HALF / 2 - 0.005 + random() * 0.006),
        pos: [x + (random() - 0.5) * 0.004, (top - 0.08) / 2, (column * DECK_HALF) / 2 + (random() - 0.5) * 0.005],
        rot: [(random() - 0.5) * 0.04, (random() - 0.5) * 0.03, (random() - 0.5) * 0.04],
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
    <planeGeometry args={[LENGTH * 1.02, PLINTH_HALF * 3.1]} />
    <primitive object={shadowMaterial()} attach="material" />
  </mesh>
}

let markCache: MarkGroups | null = null
const markParts = () => {
  if (!markCache) markCache = buildMark()
  return markCache
}

let cache: RoadGroups | null = null
const groups = () => {
  if (!cache) cache = build()
  return cache
}

/**
 * `length` is the world length of the edge. Every edge on a regular hex board
 * is exactly 1, so this is normally identity; it is kept so the piece still
 * behaves if the topology ever changes.
 */
export function RoadModel({ color, length = 1 }: { color: PlayerColor; length?: number }) {
  const parts = groups()
  const mark = markParts()
  return <group scale={[length, 1, 1]}>
    <ContactShadow />
    <mesh geometry={parts.stone} material={paleStoneMaterial()} castShadow receiveShadow />
    <mesh geometry={parts.deck} material={pavingMaterial(PLAYER_ROAD[color])} castShadow receiveShadow />
    <mesh geometry={mark.post} material={timberMaterial()} castShadow />
    <mesh geometry={mark.cloth} material={clothMaterial(PLAYER_BANNER[color])} castShadow />
  </group>
}

const ghostCache = new Map<string, THREE.MeshStandardMaterial>()
const ghostMaterial = (color: string, opacity: number, emissive: number) => {
  const key = `${color}:${opacity}:${emissive}`
  const hit = ghostCache.get(key)
  if (hit) return hit
  const material = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: emissive,
    transparent: true,
    opacity,
    depthWrite: false,
    roughness: 0.4,
    metalness: 0.1,
  })
  ghostCache.set(key, material)
  return material
}

/** Preview of the road you would build, in the same shape as the real thing. */
export function RoadGhost({ color, opacity, emissive, length = 1 }: { color: string; opacity: number; emissive: number; length?: number }) {
  const parts = groups()
  const mark = markParts()
  const material = ghostMaterial(color, opacity, emissive)
  return <group scale={[length, 1, 1]}>
    <mesh geometry={parts.stone} material={material} />
    <mesh geometry={parts.deck} material={material} />
    <mesh geometry={mark.post} material={material} />
  </group>
}
