import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { makeRng } from './noise'
import { TOKEN_LIFT } from './hex'

/**
 * A drystone cairn under every number token.
 *
 * Raising the disc is the only way to guarantee it against a camera that can
 * orbit, but a disc hanging in mid-air over a tile is worse than a hidden one:
 * it reads as a bug. So the lift is built. Each token stands on a low waymarker
 * cairn -- rough courses of local stone, a dressed capstone, spill at the foot
 * -- which is exactly the object a surveyor would leave at the middle of a claim
 * and is the same language as the kerbs already running along the hex edges.
 *
 * The height is one number, `TOKEN_LIFT`, and the terrain's sight cone is
 * derived from it. That is deliberate: one contract, and the landscape bends
 * around the token rather than nineteen tiles each negotiating their own lift.
 *
 * Merged to a single vertex-coloured geometry so a tile costs one draw call for
 * the whole cairn instead of one per course.
 */

const CAP = TOKEN_LIFT
// The same warm limestone as the kerbs running along the hex edges, so the
// cairn reads as part of the island's built layer rather than as a fourth kind
// of rock. A cool grey here made nineteen dark drums on a warm board.
const STONE = ['#c0b393', '#ab9e80', '#cabe9f', '#9b8f74']
const CAP_STONE = '#d3c8a9'

const scratch = new THREE.Color()

const paint = (geometry: THREE.BufferGeometry, hex: string) => {
  scratch.set(hex).convertSRGBToLinear()
  const count = geometry.getAttribute('position').count
  const colors = new Float32Array(count * 3)
  for (let i = 0; i < count; i += 1) {
    colors[i * 3] = scratch.r
    colors[i * 3 + 1] = scratch.g
    colors[i * 3 + 2] = scratch.b
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geometry
}

type Part = { g: THREE.BufferGeometry; c: string; x?: number; y?: number; z?: number; ry?: number; rz?: number; sy?: number }

const merge = (parts: Part[]) => {
  const prepared = parts.map(({ g, c, x = 0, y = 0, z = 0, ry = 0, rz = 0, sy = 1 }) => {
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, rz)),
      new THREE.Vector3(1, sy, 1),
    )
    const flat = g.applyMatrix4(matrix)
    return paint(flat.index ? flat.toNonIndexed() : flat, c)
  })
  const geometry = mergeGeometries(prepared, false)
  if (!geometry) throw new Error('token plinth merge failed')
  for (const part of prepared) part.dispose()
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

const buildPlinth = (variant: number) => {
  const rng = makeRng(6421 + variant * 197)
  const parts: Part[] = []
  // Four courses, each a nine-sided drum turned off the one below so the joints
  // stagger the way a dry-laid stack does. Nine sides is enough to read as
  // stone at board distance and cheap enough to sit on all nineteen tiles.
  // Narrower than the token disc at the top, so the disc overhangs its capstone
  // and reads as *set on* the cairn. The first attempt was wider than the token
  // at every course and the pair read as one barrel with a lid.
  const courses: Array<[number, number, number]> = [
    [0.300, 0.255, 0.090],
    [0.250, 0.220, 0.080],
    [0.215, 0.196, 0.075],
  ]
  let y = 0
  for (let i = 0; i < courses.length; i += 1) {
    const [bottom, top, height] = courses[i]
    parts.push({
      g: new THREE.CylinderGeometry(top, bottom, height, 9, 1),
      c: STONE[(i + variant) % STONE.length],
      y: y + height * 0.5,
      ry: rng() * 3.14,
      rz: (rng() - 0.5) * 0.02,
    })
    // A course of chinking stones sits proud of every joint, which is what
    // stops the stack reading as a turned bollard.
    const chips = 3 + Math.floor(rng() * 2)
    for (let k = 0; k < chips; k += 1) {
      const a = rng() * Math.PI * 2
      parts.push({
        g: new THREE.IcosahedronGeometry(0.028 + rng() * 0.016, 0),
        c: STONE[(i + k + 1) % STONE.length],
        x: Math.cos(a) * (top + 0.006),
        y: y + height * (0.3 + rng() * 0.5),
        z: Math.sin(a) * (top + 0.006),
        ry: rng() * 3.14,
        sy: 0.65,
      })
    }
    y += height
  }
  // Dressed capstone: a cut slab with a chamfer, so the top of the cairn is
  // obviously worked and obviously meant to carry something.
  parts.push({ g: new THREE.CylinderGeometry(0.235, 0.205, 0.016, 18, 1), c: CAP_STONE, y: y + 0.008 })
  parts.push({ g: new THREE.CylinderGeometry(0.222, 0.235, 0.012, 18, 1), c: CAP_STONE, y: y + 0.022 })
  // Spill and packing round the foot: a cairn that meets the ground on a clean
  // circle looks dropped in, and this is where the eye reads "built".
  for (let k = 0; k < 8; k += 1) {
    const a = (k / 8) * Math.PI * 2 + rng() * 0.6
    const r = 0.315 + rng() * 0.075
    parts.push({
      g: new THREE.IcosahedronGeometry(0.028 + rng() * 0.03, 0),
      c: STONE[k % STONE.length],
      x: Math.cos(a) * r,
      y: 0.01 + rng() * 0.012,
      z: Math.sin(a) * r,
      ry: rng() * 3.14,
      sy: 0.6,
    })
  }
  const geometry = merge(parts)
  // The stack is authored 0..y; scale it so the capstone lands exactly on the
  // lift the sight cone was derived from.
  geometry.scale(1, CAP / (y + 0.028), 1)
  return geometry
}

const VARIANTS = 3
let cache: THREE.BufferGeometry[] | null = null
const plinthGeometry = (variant: number) => {
  if (!cache) cache = Array.from({ length: VARIANTS }, (_, i) => buildPlinth(i))
  return cache[variant % VARIANTS]
}

let material: THREE.MeshStandardMaterial | null = null
const plinthMaterial = () => (material ??= new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.9,
  metalness: 0,
  dithering: true,
}))

export function TokenPlinth({ variant }: { variant: number }) {
  return <mesh geometry={plinthGeometry(variant)} material={plinthMaterial()} castShadow receiveShadow />
}
