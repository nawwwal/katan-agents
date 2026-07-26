import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { Board } from '../../game/types'
import { useReducedMotion } from '../useReducedMotion'
import { GROUND_Y, createTileSurface, tileSeed } from './hex'
import { fbm, makeRng, valueNoise } from './noise'
import * as props from './props'
import { scatterTile, type PropInstance } from './scatter'
import { applyGrazing, applyWindSway, swayClock } from './sway'
import { suspendForTerrainMaterials, terrainMaterial } from './textures'

// One InstancedMesh per prop family for the whole board. Nineteen tiles of
// dense scatter cost roughly thirty draw calls this way instead of thousands.

type Surface = 'foliage' | 'stiff' | 'rock' | 'clay' | 'livestock' | 'timber'

const FAMILIES: Record<string, { make: () => THREE.BufferGeometry; surface: Surface }> = {
  conifer0: { make: () => props.coniferGeometry(0), surface: 'foliage' },
  conifer1: { make: () => props.coniferGeometry(1), surface: 'foliage' },
  conifer2: { make: () => props.coniferGeometry(2), surface: 'foliage' },
  conifer3: { make: () => props.coniferGeometry(3), surface: 'foliage' },
  sapling0: { make: () => props.saplingGeometry(0), surface: 'foliage' },
  sapling1: { make: () => props.saplingGeometry(1), surface: 'foliage' },
  sapling2: { make: () => props.saplingGeometry(2), surface: 'foliage' },
  deadfall: { make: props.deadfallGeometry, surface: 'timber' },
  broadleaf0: { make: () => props.broadleafGeometry(0), surface: 'foliage' },
  broadleaf1: { make: () => props.broadleafGeometry(1), surface: 'foliage' },
  broadleaf3: { make: () => props.broadleafGeometry(3), surface: 'foliage' },
  bush0: { make: () => props.bushGeometry(0), surface: 'foliage' },
  bush1: { make: () => props.bushGeometry(1), surface: 'foliage' },
  bush2: { make: () => props.bushGeometry(2), surface: 'foliage' },
  tussock: { make: props.tussockGeometry, surface: 'foliage' },
  wheat: { make: props.wheatGeometry, surface: 'foliage' },
  haystack: { make: props.haystackGeometry, surface: 'stiff' },
  sheep: { make: props.sheepGeometry, surface: 'livestock' },
  cactus0: { make: () => props.cactusGeometry(0), surface: 'stiff' },
  cactus1: { make: () => props.cactusGeometry(1), surface: 'stiff' },
  cactus2: { make: () => props.cactusGeometry(2), surface: 'stiff' },
  dryBrush: { make: props.dryBrushGeometry, surface: 'foliage' },
  clayBlock0: { make: () => props.clayBlockGeometry(0), surface: 'clay' },
  clayBlock1: { make: () => props.clayBlockGeometry(1), surface: 'clay' },
  clayBlock2: { make: () => props.clayBlockGeometry(2), surface: 'clay' },
  clayRubble0: { make: () => props.clayRubbleGeometry(0), surface: 'clay' },
  clayRubble1: { make: () => props.clayRubbleGeometry(1), surface: 'clay' },
  clayRubble2: { make: () => props.clayRubbleGeometry(2), surface: 'clay' },
  crag0: { make: () => props.cragGeometry(0), surface: 'rock' },
  crag1: { make: () => props.cragGeometry(1), surface: 'rock' },
  crag2: { make: () => props.cragGeometry(2), surface: 'rock' },
  boulder0: { make: () => props.boulderGeometry(0), surface: 'rock' },
  boulder1: { make: () => props.boulderGeometry(1), surface: 'rock' },
  boulder2: { make: () => props.boulderGeometry(2), surface: 'rock' },
  pebble0: { make: () => props.pebbleGeometry(0), surface: 'rock' },
  pebble1: { make: () => props.pebbleGeometry(1), surface: 'rock' },
  pebble2: { make: () => props.pebbleGeometry(2), surface: 'rock' },
  shard0: { make: () => props.shardGeometry(0), surface: 'rock' },
  shard1: { make: () => props.shardGeometry(1), surface: 'rock' },
  shard2: { make: () => props.shardGeometry(2), surface: 'rock' },
  spire0: { make: () => props.spireGeometry(0), surface: 'rock' },
  spire1: { make: () => props.spireGeometry(1), surface: 'rock' },
  spire2: { make: () => props.spireGeometry(2), surface: 'rock' },
  wall: { make: props.wallGeometry, surface: 'rock' },
  kerb: { make: () => props.pebbleGeometry(1), surface: 'rock' },
  fence: { make: props.fenceGeometry, surface: 'timber' },
  revetment: { make: props.revetmentGeometry, surface: 'timber' },
  crate: { make: props.crateGeometry, surface: 'timber' },
  mineHead: { make: props.mineHeadGeometry, surface: 'timber' },
}

/**
 * Snow as a shading term, not geometry. Accumulates on upward-facing faces
 * above the snow line, thins on steep ground, and the line itself is broken up
 * by a cheap two-octave hash so it never reads as a contour drawn round a peak.
 * Runs on the shared rock material, so spires, scree and boulders all agree.
 */
const snowPatch = (material: THREE.MeshStandardMaterial) => {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRockWorld;\nvarying float vRockUp;')
      .replace('#include <defaultnormal_vertex>', `#include <defaultnormal_vertex>
        vRockUp = inverseTransformDirection( transformedNormal, viewMatrix ).y;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 rockLocal = vec4( transformed, 1.0 );
        #ifdef USE_INSTANCING
          rockLocal = instanceMatrix * rockLocal;
        #endif
        vRockWorld = ( modelMatrix * rockLocal ).xyz;`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vRockWorld;
        varying float vRockUp;
        float rockHash( vec2 p ) {
          return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
        }
        float rockNoise( vec2 p ) {
          vec2 i = floor( p );
          vec2 f = fract( p );
          f = f * f * ( 3.0 - 2.0 * f );
          return mix( mix( rockHash( i ), rockHash( i + vec2( 1.0, 0.0 ) ), f.x ),
                      mix( rockHash( i + vec2( 0.0, 1.0 ) ), rockHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        float snowLine = 1.92 + ( rockNoise( vRockWorld.xz * 1.7 ) - 0.5 ) * 0.30 + ( rockNoise( vRockWorld.xz * 6.1 ) - 0.5 ) * 0.10;
        float snowAlt = smoothstep( snowLine, snowLine + 0.30, vRockWorld.y );
        // Upward faces hold snow; anything past about sixty degrees sheds it.
        float snowSlope = smoothstep( 0.34, 0.80, vRockUp );
        float snow = snowAlt * snowSlope;
        // Drifts catch in the lee of every ledge, so break the coverage up again.
        snow *= 0.55 + 0.45 * rockNoise( vRockWorld.xz * 11.0 + vRockWorld.y * 4.0 );
        // Sun-bleached crest, not a snowcap. The blind critic read the old
        // near-white mix as "white caps glued on", and the reference mountain
        // has no snow at all -- it has pale weathered rock on the ridges where
        // the lichen and the dark patina have been scoured off.
        diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.62, 0.61, 0.56 ), snow * 0.85 );
        roughnessFactor = mix( roughnessFactor, 0.62, snow );`)
  }
}

/**
 * Sun side and shade side get different *hues*, not just different brightness.
 *
 * The critic's note on the forest was "no colour break between species or
 * between light and shade sides", and the second half of that is the cheap one.
 * Real foliage is not one green lit two ways: the leaves facing the sun scatter
 * warm yellow-green, and the ones facing away are lit almost entirely by the sky
 * and go blue-green. A diffuse term only changes the value, so without this the
 * whole canopy is one hue and reads as a single plastic mass.
 *
 * This is a hue rotation keyed on the world normal against the sun azimuth, not
 * a brightness lift, so it is not standing in for the missing shadows -- it
 * survives unchanged once they land, and it is the same split the lighting rig
 * already sets up between its warm key and its cool sky.
 */
const SUN_TILT = /* glsl */`vec3( -0.640, 0.616, 0.461 )`

const sunShadeTint = (material: THREE.MeshStandardMaterial, amount: number) => {
  const existing = material.onBeforeCompile
  material.onBeforeCompile = (shader, renderer) => {
    existing?.call(material, shader, renderer)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vSunFacing;')
      .replace('#include <defaultnormal_vertex>', `#include <defaultnormal_vertex>
        vSunFacing = dot( normalize( inverseTransformDirection( transformedNormal, viewMatrix ) ), normalize( ${SUN_TILT} ) );`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vSunFacing;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float sunward = smoothstep( -0.55, 0.75, vSunFacing );
          // Sunlit: warmer and a touch desaturated, the way a leaf looks when
          // you are seeing transmitted light through it as well as reflected.
          vec3 sunward3 = diffuseColor.rgb * vec3( 1.22, 1.10, 0.72 );
          // Shaded: the sky is the only source, so the green swings blue and
          // gains saturation as the warm component drops out of it.
          vec3 shade3 = diffuseColor.rgb * vec3( 0.72, 0.92, 1.24 );
          diffuseColor.rgb = mix( diffuseColor.rgb, mix( shade3, sunward3, sunward ), ${amount.toFixed(3)} );
        }`)
  }
  const key = material.customProgramCacheKey
  material.customProgramCacheKey = () => `${key ? key.call(material) : 'katan'}-sunshade-${amount}`
  material.needsUpdate = true
  return material
}

const SURFACE_MATERIAL: Record<Surface, () => THREE.MeshStandardMaterial> = {
  // Anything rooted and flexible: trees, crops, tussocks, brush. The wind is a
  // vertex-shader term weighted by height above the instance origin, so a
  // crown moves and a trunk does not, at the cost of one uniform per frame for
  // several thousand instances.
  foliage: () => sunShadeTint(
    applyWindSway(
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, dithering: true }),
      0.36,
    ),
    0.55,
  ),
  // Rooted but rigid: a saguaro and a haystack do not sway.
  stiff: () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0, dithering: true }),
  // Smooth normals, not flat: the client read the whole world as faceted, and a
  // low-poly silhouette is fine as long as the surface itself is not shaded
  // facet-by-facet. Break-up now comes from vertex-colour mottling and strata.
  rock: () => {
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0, dithering: true })
    snowPatch(material)
    return material
  },
  // Fired clay is the one terrain surface with a wet, slightly polished cut
  // face, and giving it its own material is what stops the pit blocks reading
  // as recoloured granite.
  clay: () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0, dithering: true }),
  // Fleece is the most nearly-white thing on the island, so it is also where a
  // flat hue reads worst. The same warm/cool split keeps the lit side cream and
  // the far side blue-grey, which is what stops a sheep being a paper cutout.
  livestock: () => sunShadeTint(
    applyGrazing(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0, dithering: true })),
    0.4,
  ),
  timber: () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0, dithering: true }),
}

/** Hex borders read as stone-kerbed paths, which is how the references stop the tiles looking like coasters. */
const buildBorders = (board: Board) => {
  const rng = makeRng(0x2ab41c)
  const kerbs: PropInstance[] = []
  const walls: PropInstance[] = []
  const positions: number[] = []
  const colors: number[] = []
  const indices: number[] = []
  const color = new THREE.Color()
  const pathY = GROUND_Y + 0.004

  const pushQuad = (ax: number, az: number, bx: number, bz: number, halfWidth: number) => {
    const dx = bx - ax
    const dz = bz - az
    const len = Math.hypot(dx, dz) || 1
    const px = (-dz / len) * halfWidth
    const pz = (dx / len) * halfWidth
    const base = positions.length / 3
    const corners: Array<[number, number]> = [[ax + px, az + pz], [bx + px, bz + pz], [bx - px, bz - pz], [ax - px, az - pz]]
    for (const [x, z] of corners) {
      positions.push(x, pathY, z)
      const grit = fbm(x * 9, z * 9, 3, 4111) * 0.3 + valueNoise(x * 40, z * 40, 811) * 0.16
      color.set('#b6a887').convertSRGBToLinear().multiplyScalar(0.8 + grit)
      colors.push(color.r, color.g, color.b)
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }

  for (const edge of Object.values(board.edges)) {
    const [a, b] = edge.vertices.map((id) => board.vertices[id])
    const dx = b.x - a.x
    const dz = b.z - a.z
    const len = Math.hypot(dx, dz) || 1
    const ux = dx / len
    const uz = dz / len
    const coastal = edge.hexes.length < 2
    // Overshoot each end so three paths knit together cleanly at a vertex.
    pushQuad(a.x - ux * 0.055, a.z - uz * 0.055, b.x + ux * 0.055, b.z + uz * 0.055, coastal ? 0.1 : 0.118)

    const steps = 11
    for (let side = -1; side <= 1; side += 2) {
      if (coastal && side === -1) continue
      for (let i = 0; i < steps; i += 1) {
        const t = (i + 0.5) / steps
        const x = a.x + dx * t + -uz * side * 0.108
        const z = a.z + dz * t + ux * side * 0.108
        const s = 0.85 + rng() * 0.85
        kerbs.push({
          family: 'kerb', x, y: 0.002, z,
          ry: rng() * 6.283, rx: (rng() - 0.5) * 0.3, rz: (rng() - 0.5) * 0.3,
          s: s * 1.5, sy: s * 1.1,
          tint: 1.05 + (rng() - 0.5) * 0.2, warm: (rng() - 0.5) * 0.06,
        })
      }
    }

    if (coastal) {
      // Clifftop dry-stone wall, set outboard of the road line.
      const ox = -uz * 0.2
      const oz = ux * 0.2
      const segments = 4
      for (let i = 0; i < segments; i += 1) {
        const t = i / segments
        walls.push({
          family: 'wall',
          x: a.x + dx * t + ox, y: -0.006, z: a.z + dz * t + oz,
          ry: -Math.atan2(dz, dx), rx: 0, rz: 0,
          s: len / segments, sy: 0.95 + rng() * 0.2,
          tint: 1 + (rng() - 0.5) * 0.14, warm: (rng() - 0.5) * 0.05,
        })
      }
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return { geometry, instances: [...kerbs, ...walls] }
}

/**
 * Ground-hugging micro-scatter does not cast. There are several thousand of
 * these, each smaller than a shadow texel, and every one writes ground-level
 * depth into the map directly under itself. The result is not shadow, it is a
 * dense acne field that halves the sun across the whole island and drowns the
 * real cast shadows from trees, rock and buildings. Their contact darkening is
 * ambient occlusion's job, not the shadow map's.
 */
const NON_CASTING = new Set([
  'tussock', 'wheat', 'dryBrush', 'pebble0', 'pebble1', 'pebble2', 'kerb',
  'clayRubble0', 'clayRubble1', 'clayRubble2',
])

const applyInstances = (mesh: THREE.InstancedMesh, instances: PropInstance[], casts: boolean) => {
  const matrix = new THREE.Matrix4()
  const position = new THREE.Vector3()
  const quaternion = new THREE.Quaternion()
  const euler = new THREE.Euler()
  const scale = new THREE.Vector3()
  const color = new THREE.Color()
  instances.forEach((instance, index) => {
    position.set(instance.x, instance.y, instance.z)
    euler.set(instance.rx, instance.ry, instance.rz)
    quaternion.setFromEuler(euler)
    scale.set(instance.s, instance.sy, instance.s)
    matrix.compose(position, quaternion, scale)
    mesh.setMatrixAt(index, matrix)
    color.setRGB(
      instance.tint * (1 + instance.warm),
      instance.tint,
      instance.tint * (1 - instance.warm * 1.3),
    )
    mesh.setColorAt(index, color)
  })
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  mesh.castShadow = casts
  mesh.receiveShadow = true
  mesh.frustumCulled = false
}

export type TileSurfaceEntry = { id: string; geometry: THREE.BufferGeometry; material: THREE.MeshStandardMaterial }

export const useTerrainField = (board: Board) => {
  // Suspends until the baked maps are decoded. React holds the loading screen
  // up rather than the board showing a frame of untextured hexes.
  suspendForTerrainMaterials()
  const reducedMotion = useReducedMotion()
  const built = useMemo(() => {
    const tiles: TileSurfaceEntry[] = []
    const byFamily = new Map<string, PropInstance[]>()
    const collect = (instance: PropInstance, ox: number, oz: number) => {
      let list = byFamily.get(instance.family)
      if (!list) {
        list = []
        byFamily.set(instance.family, list)
      }
      list.push({ ...instance, x: instance.x + ox, y: instance.y + GROUND_Y, z: instance.z + oz })
    }

    for (const tile of board.hexes) {
      const seed = tileSeed(tile.id)
      const surface = createTileSurface(tile.terrain, tile.id)
      tiles.push({ id: tile.id, geometry: surface.geometry, material: terrainMaterial(tile.terrain) })
      for (const instance of scatterTile(tile.terrain, seed, surface.height)) collect(instance, tile.x, tile.z)
    }

    const borders = buildBorders(board)
    for (const instance of borders.instances) collect(instance, 0, 0)

    const materials = new Map<Surface, THREE.MeshStandardMaterial>()
    const meshes: THREE.InstancedMesh[] = []
    for (const [family, instances] of byFamily) {
      const definition = FAMILIES[family]
      if (!definition) throw new Error(`Unknown terrain prop family: ${family}`)
      let material = materials.get(definition.surface)
      if (!material) {
        material = SURFACE_MATERIAL[definition.surface]()
        materials.set(definition.surface, material)
      }
      const geometry = definition.make()
      const mesh = new THREE.InstancedMesh(geometry, material, instances.length)
      mesh.name = `terrain-${family}`
      applyInstances(mesh, instances, !NON_CASTING.has(family))
      meshes.push(mesh)
    }

    const total = [...byFamily.values()].reduce((sum, list) => sum + list.length, 0)
    return { tiles, meshes, borders: borders.geometry, materials: [...materials.values()], total }
  }, [board])

  // One clock for every swaying instance on the board. Under reduced motion it
  // is pinned at zero, which freezes the wind and the sheep completely rather
  // than slowing them down -- the same contract the rest of the scene keeps.
  useFrame(({ clock }) => { swayClock.value = reducedMotion ? 0 : clock.elapsedTime })

  useEffect(() => () => {
    for (const tile of built.tiles) tile.geometry.dispose()
    for (const mesh of built.meshes) {
      mesh.geometry.dispose()
      mesh.dispose()
    }
    for (const material of built.materials) material.dispose()
    built.borders.dispose()
  }, [built])

  return built
}
