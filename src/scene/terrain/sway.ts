import * as THREE from 'three'

/**
 * Vertex-shader motion for the instanced world.
 *
 * The client's note was "the sheep are very static", and he was right about
 * more than the sheep: nothing on the island moved. There are several thousand
 * scatter instances on a populated board, so the only affordable answer is to
 * animate them in the vertex shader off a single shared clock uniform, with the
 * per-instance phase derived from where the instance already is. That costs one
 * uniform update per frame for the whole board and no CPU work per instance.
 *
 * Two behaviours, one clock:
 *
 * - `applyWindSway` displaces vertices by their height above the instance
 *   origin, squared, so crowns move and trunks stay planted. A low-frequency
 *   gust travels across the island and a faster flutter rides on top of it, so
 *   neighbouring trees agree about the weather without moving in lockstep.
 * - `applyGrazing` is the sheep: a slow head dip, a chew, an idle body sway and
 *   an occasional shuffle forward.
 *
 * Everything is seeded from the instance matrix, never `Math.random()`, so the
 * same board animates the same way every load.
 */

/** One clock for the whole board. Frozen at zero under reduced motion. */
export const swayClock = { value: 0 }

const COMMON = /* glsl */`
uniform float uSwayTime;

float swayHash( vec2 p ) {
  return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453123 );
}
`

/**
 * `project_vertex` is the hook rather than `begin_vertex` because the offset
 * has to be applied *after* the instance matrix: every scatter instance carries
 * a random Y rotation, and displacing before it would send each tree a
 * different way in a wind that is supposed to be one wind. The scatter meshes
 * hang off an untransformed group, so model space here is world space.
 */
const projectWith = (offset: string) => /* glsl */`
vec4 swayLocal = vec4( transformed, 1.0 );
vec3 swayBase = vec3( 0.0 );
#ifdef USE_INSTANCING
  swayLocal = instanceMatrix * swayLocal;
  swayBase = vec3( instanceMatrix[ 3 ][ 0 ], instanceMatrix[ 3 ][ 1 ], instanceMatrix[ 3 ][ 2 ] );
#endif
swayLocal.xyz += ${offset};
vec4 mvPosition = modelViewMatrix * swayLocal;
gl_Position = projectionMatrix * mvPosition;
`

const WIND = /* glsl */`
vec3 windOffset( vec3 base, vec3 world, float amplitude ) {
  float h = max( world.y - base.y, 0.0 );
  if ( h <= 0.0 ) return vec3( 0.0 );
  float phase = swayHash( floor( base.xz * 97.0 ) ) * 6.2831853;
  // The gust is a travelling wave, so a squall crosses the island rather than
  // every tile breathing in unison.
  float travel = dot( base.xz, vec2( 0.72, 0.69 ) );
  float gust = sin( uSwayTime * 0.41 - travel * 0.6 ) * 0.62
             + sin( uSwayTime * 0.23 - travel * 0.29 + 1.7 ) * 0.38;
  float flutter = sin( uSwayTime * 2.4 + phase ) * 0.6 + sin( uSwayTime * 3.9 + phase * 2.3 ) * 0.4;
  // Height squared: the base of a trunk is rooted, the tip carries all of it.
  float lever = h * h * amplitude;
  vec2 downwind = vec2( 0.82, 0.573 );
  vec2 lateral = vec2( -downwind.y, downwind.x );
  float along = gust * 0.72 + flutter * 0.28 * ( 0.55 + 0.45 * gust );
  float across = flutter * 0.22;
  return vec3( downwind.x * along + lateral.x * across, 0.0, downwind.y * along + lateral.y * across ) * lever;
}
`

const GRAZE = /* glsl */`
vec3 grazeOffset( vec3 base, vec3 local ) {
  float t = uSwayTime + swayHash( floor( base.xz * 97.0 ) ) * 40.0;
  // The head is the +x end of the merged sheep geometry.
  float head = smoothstep( 0.05, 0.11, local.x );
  float graze = sin( t * 0.58 ) * 0.5 + 0.5;
  float chew = sin( t * 6.1 ) * 0.5 + 0.5;
  vec3 offset = vec3( 0.0 );
  offset.y -= head * ( graze * 0.030 + chew * 0.004 );
  offset.x += head * graze * 0.014;
  // A shuffle forward every twenty seconds or so, eased in and out.
  float k = fract( t * 0.048 );
  float shuffle = smoothstep( 0.88, 0.94, k ) * ( 1.0 - smoothstep( 0.94, 1.0, k ) );
  offset.x += shuffle * 0.055;
  // Idle weight-shift, strongest at the back where the fleece is highest.
  offset.z += max( local.y, 0.0 ) * sin( t * 1.05 ) * 0.10;
  return offset;
}
`

type Compiled = { uniforms: { [name: string]: THREE.IUniform } }

const inject = (
  material: THREE.MeshStandardMaterial,
  helpers: string,
  offset: string,
  wrap: (chunk: string) => string = (chunk) => chunk,
) => {
  const existing = material.onBeforeCompile
  material.onBeforeCompile = (shader: Compiled & { vertexShader: string; fragmentShader: string }, renderer) => {
    existing?.call(material, shader as never, renderer)
    shader.uniforms.uSwayTime = swayClock
    shader.vertexShader = wrap(
      shader.vertexShader
        .replace('#include <common>', `#include <common>\n${COMMON}${helpers}`)
        .replace('#include <project_vertex>', projectWith(offset)),
    )
  }
  // A material that compiles differently needs its own program key, or three
  // hands it the cached program from an identical-looking material.
  material.customProgramCacheKey = () => `katan-sway-${offset}`
  material.needsUpdate = true
  return material
}

/** Wind for anything rooted: trees, bushes, crops, tussocks, dry brush. */
export const applyWindSway = (material: THREE.MeshStandardMaterial, amplitude: number) =>
  inject(material, WIND, `windOffset( swayBase, swayLocal.xyz, ${amplitude.toFixed(3)} )`)

/**
 * Sheep. The offset is authored in the geometry's own space -- the head is +x
 * before the instance's random turn -- so it is rotated by the instance matrix
 * on the way out rather than being applied in world space.
 */
export const applyGrazing = (material: THREE.MeshStandardMaterial) =>
  inject(
    material,
    GRAZE,
    'swayRotated',
    (chunk) => chunk.replace(
      'vec4 swayLocal = vec4( transformed, 1.0 );',
      `vec4 swayLocal = vec4( transformed, 1.0 );
       vec3 swayRotated = vec3( 0.0 );`,
    ).replace(
      'swayLocal.xyz += swayRotated;',
      `#ifdef USE_INSTANCING
         swayRotated = mat3( instanceMatrix ) * grazeOffset( swayBase, transformed );
       #endif
       swayLocal.xyz += swayRotated;`,
    ),
  )
