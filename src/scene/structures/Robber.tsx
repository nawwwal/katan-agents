import * as THREE from 'three'
import { box, cyl, foldedLathe, lean, merge, type Part } from './geometry'
import { basaltMaterial, bronzeMaterial, brassMaterial, voidMaterial } from './materials'
// Plinth stone is the basalt kit lifted to the mid grey of the reference.
import { makeRng } from './textures'

// A hooded figure on a stepped hexagonal plinth.
//
// The previous version revolved one narrow profile and read as a chess pawn
// from the game camera. The reference silhouette is doing three things this
// one now copies: a mantle that flares wider than the head so the shoulders
// register, a hem that sweeps out asymmetrically instead of ringing the base,
// and a hood large enough that its opening is still a hole at board scale.
// The cowl is also pitched back, because a camera looking down at forty-five
// degrees sees the top of a forward-facing hood and nothing else.

const lazy = <T,>(build: () => T) => {
  let value: T | null = null
  return () => {
    if (value === null) value = build()
    return value
  }
}

/** Hexagonal stepped plinth, sized to sit inside a tile without crowding it. */
const plinthGeometry = lazy(() => {
  const random = makeRng(3311)
  const steps: Part[] = []
  const tiers: Array<[number, number, number]> = [
    [0.215, 0.238, 0.042],
    [0.172, 0.19, 0.038],
    [0.134, 0.148, 0.03],
  ]
  let y = 0
  tiers.forEach(([top, bottom, height], index) => {
    steps.push({
      geo: cyl(top, bottom, height, 6),
      pos: [0, y + height / 2, 0],
      rot: [0, index * 0.16, 0],
      uv: [6, 1],
      tint: [0.92 - index * 0.06, 0.9 - index * 0.06, 0.86 - index * 0.05],
    })
    y += height
  })
  // A few loose kerbstones round the bottom tier so the plinth reads as set
  // masonry rather than a turned wedding cake.
  for (let index = 0; index < 7; index += 1) {
    const theta = (index / 7) * Math.PI * 2 + random() * 0.2
    const value = 0.68 + random() * 0.3
    steps.push({
      geo: box(0.058 + random() * 0.02, 0.026, 0.042),
      pos: [Math.cos(theta) * 0.226, 0.013, Math.sin(theta) * 0.226],
      rot: [0, -theta + (random() - 0.5) * 0.2, (random() - 0.5) * 0.1],
      uv: [1.4, 1],
      tint: [value, value * 0.98, value * 0.93],
    })
  }
  return merge(steps)
})

const BASE = 0.11

const figureGeometry = lazy(() => {
  // Skirt: the hem sweeps wide and the profile pinches at the waist, so the
  // silhouette is a wedge rather than a bell.
  const skirt = foldedLathe(
    [
      [0.142, 0.0],
      [0.135, 0.045],
      [0.118, 0.1],
      [0.098, 0.155],
      [0.081, 0.208],
      [0.069, 0.252],
      [0.062, 0.288],
    ],
    36,
    0.34,
    9,
    4242,
  )
  // The hem is pulled out to one side and dropped, which breaks the revolve
  // and gives the figure a direction to be facing.
  const hem = skirt.getAttribute('position') as THREE.BufferAttribute
  for (let index = 0; index < hem.count; index += 1) {
    const y = hem.getY(index)
    const fall = Math.max(0, 1 - y / 0.14)
    hem.setX(index, hem.getX(index) + fall * fall * 0.03)
    hem.setZ(index, hem.getZ(index) * (1 + fall * 0.14))
  }
  hem.needsUpdate = true
  skirt.computeVertexNormals()

  // Mantle: a short shoulder cape, wider than the head, that gives the piece
  // its second silhouette tier.
  const mantle = foldedLathe(
    [
      [0.112, 0.0],
      [0.105, 0.026],
      [0.094, 0.054],
      [0.079, 0.082],
      [0.064, 0.104],
      [0.052, 0.118],
    ],
    32,
    0.22,
    7,
    771,
  )

  const torso = foldedLathe(
    [
      [0.056, 0.0],
      [0.066, 0.02],
      [0.072, 0.046],
      [0.066, 0.07],
      [0.052, 0.09],
      [0.04, 0.104],
    ],
    28,
    0.12,
    6,
    9017,
  )

  // Hood: near half again the width of the old one, tapering to a point that
  // trails backwards, with the opening pitched up towards the camera.
  const hood = lean(foldedLathe(
    [
      [0.052, 0.0],
      [0.062, 0.022],
      [0.064, 0.046],
      [0.055, 0.07],
      [0.036, 0.09],
      [0.014, 0.104],
      [0.0, 0.112],
    ],
    28,
    0.1,
    5,
    9931,
  ), -0.022, 0.112)

  // Rolled brim: a full ring round the opening, which is what turns the void
  // into a hood rather than a dent.
  const brim = new THREE.TorusGeometry(0.047, 0.011, 10, 24)
  const clasp = new THREE.SphereGeometry(0.017, 14, 12)
  clasp.scale(1, 1, 0.5)
  return {
    cloth: merge([
      { geo: skirt, pos: [0, BASE, 0] },
      { geo: torso, pos: [0, BASE + 0.288, 0] },
      { geo: mantle, pos: [0, BASE + 0.276, 0] },
      { geo: hood, pos: [0, BASE + 0.386, -0.01], rot: [-0.2, 0, 0] },
      { geo: brim, pos: [0, BASE + 0.42, 0.036], rot: [-0.44, 0, 0] },
    ]),
    clasp: merge([{ geo: clasp, pos: [0, BASE + 0.344, 0.07] }]),
  }
})

const cowlGeometry = lazy(() => {
  // The dark hollow where a face should be. Deliberately oversized and pitched
  // back with the hood, because at board scale a small void just fills in.
  const cavity = new THREE.SphereGeometry(0.042, 18, 14)
  cavity.scale(0.82, 1.0, 0.72)
  return merge([{ geo: cavity, pos: [0, BASE + 0.408, 0.036], rot: [-0.44, 0, 0] }])
})

/**
 * Drop-in replacement for the old cone robber. `height` is the local Y offset.
 * The figure is turned so the hood opening faces the default camera azimuth.
 */
export function RobberFigure({ height = 0.105 }: { height?: number }) {
  const figure = figureGeometry()
  return <group position={[0, height, 0]}>
    <mesh geometry={plinthGeometry()} material={plinthMaterial()} castShadow receiveShadow />
    <group rotation={[0, Math.PI / 4, 0]}>
      <mesh geometry={figure.cloth} material={bronzeMaterial()} castShadow receiveShadow />
      <mesh geometry={figure.clasp} material={brassMaterial()} castShadow />
      <mesh geometry={cowlGeometry()} material={voidMaterial()} />
    </group>
  </group>
}

const plinthMaterial = lazy(() => {
  const material = basaltMaterial().clone()
  material.color.set('#8f8b81')
  return material
})
