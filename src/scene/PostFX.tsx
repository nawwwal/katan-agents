import { useFrame, useThree } from '@react-three/fiber'
import { Bloom, EffectComposer, N8AO, SMAA, ToneMapping, Vignette, wrapEffect } from '@react-three/postprocessing'
import { BlendFunction, Effect, EffectAttribute, ToneMappingMode } from 'postprocessing'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { SUN_DIRECTION, HAZE_HIGH, HAZE_LOW } from './Sky'

const atmosphereShader = /* glsl */`
  uniform float exposure;
  uniform vec3 hazeLow;
  uniform vec3 hazeHigh;
  uniform float hazeStart;
  uniform float hazeDensity;
  uniform float hazeMax;

  uniform mat4 invProjection;
  uniform mat4 projection;
  uniform mat4 camToWorld;
  uniform vec3 sunDirection;
  uniform vec3 sunViewDirection;
  uniform vec3 sunShade;
  uniform float sunShadowLength;
  uniform float sunShadowThickness;
  uniform float sunShadowStrength;
  uniform vec3 cloudShade;
  uniform float cloudTime;
  uniform float cloudScale;
  uniform float cloudCover;
  uniform float cloudStrength;
  uniform float cloudHeight;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  // Three octaves is enough for soft overcast shapes. More would give the
  // clouds a crisp fractal edge, which is the tell that turns this from
  // weather into moving blobs.
  float clouds(vec2 p) {
    float sum = valueNoise(p) * 0.55;
    sum += valueNoise(p * 2.13 + 17.3) * 0.3;
    sum += valueNoise(p * 4.41 + 41.7) * 0.15;
    return sum;
  }

  vec3 viewPositionAt(vec2 screenUv, float rawDepth) {
    vec4 clip = vec4(screenUv * 2.0 - 1.0, rawDepth * 2.0 - 1.0, 1.0);
    vec4 view = invProjection * clip;
    return view.xyz / view.w;
  }

  /**
   * Contact shadow, marched through the depth buffer.
   *
   * This began as a stand-in for the scene's cast shadows, which were missing
   * for reasons that turned out to have nothing to do with the shadow map:
   * the scene's environment intensity was set high enough that unshadowed sky
   * outweighed the sun, so a correct shadow simply had nothing left to remove.
   * With that fixed the shadow map does the real work and this is turned down
   * to what it is actually good at.
   *
   * What it is good at is the first fraction of a unit. A 2048 map over a 26
   * unit frustum is a 13mm texel, which is wider than the gap between a tree
   * trunk and the ground under it, so the shadow map softens exactly the
   * contact the eye uses to decide whether an object is resting on a surface
   * or hovering above it. A short march off the depth buffer sees that gap.
   *
   * Only occluders on screen can cast. For a board viewed from above, with the
   * whole island in frame, that costs almost nothing.
   */
  float sunOcclusion(vec3 origin) {
    if (sunShadowStrength <= 0.0) return 0.0;
    // Eight taps. This was sixteen when the march had to reach two and a half
    // units to put the island's shadow on the sea; over the 1.1 units it now
    // covers, sixteen samples are half a texel apart and buy nothing.
    const int STEPS = 8;
    // Interleaved gradient noise rather than a hash. Both break up the fixed
    // step length that would otherwise print concentric banding into the
    // image, but this one distributes its error at pixel frequency, which the
    // eye reads as fine grain instead of the coarse blotches a hash leaves.
    float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    float stepLength = sunShadowLength / float(STEPS);
    float occlusion = 0.0;

    for (int i = 1; i <= STEPS; i++) {
      vec3 samplePoint = origin + sunViewDirection * (stepLength * (float(i) + jitter));
      vec4 clip = projection * vec4(samplePoint, 1.0);
      if (clip.w <= 0.0) break;
      vec2 sampleUv = clip.xy / clip.w * 0.5 + 0.5;
      if (any(lessThan(sampleUv, vec2(0.0))) || any(greaterThan(sampleUv, vec2(1.0)))) break;

      float sceneZ = getViewZ(readDepth(sampleUv));
      // View z is negative going away from the camera, so a larger value means
      // the scene surface sits in front of the ray: something is blocking.
      float gap = sceneZ - samplePoint.z;
      // Ramp in and out rather than testing a hard range. A grazing hit at the
      // silhouette of an occluder contributes partially, which is what gives
      // the shadow a soft edge instead of a stair-stepped one.
      float hit = smoothstep(0.012, 0.07, gap) * (1.0 - smoothstep(sunShadowThickness * 0.65, sunShadowThickness, gap));
      // Contact is firm; the far end of the ray softens, the way a real
      // penumbra widens with distance from the occluder.
      occlusion = max(occlusion, hit * (1.0 - float(i) / float(STEPS) * 0.5));
    }
    return occlusion * sunShadowStrength;
  }

  void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
    // Exposure lives here because it has nowhere else to go. The renderer's
    // own toneMappingExposure is dead the moment an EffectComposer mounts --
    // react-postprocessing sets gl.toneMapping to NoToneMapping -- and
    // postprocessing's ACES path takes no exposure argument. So the frame was
    // running with no exposure control at all, feeding raw scene radiance
    // straight into the curve. This is in HDR and ahead of bloom, which is
    // where exposure belongs: it moves the bloom threshold with the image
    // instead of leaving it stranded at a fixed radiance.
    vec3 color = inputColor.rgb * exposure;

    if (depth > 0.9995) {
      outputColor = vec4(color, inputColor.a);
      return;
    }
    vec3 viewPosition = viewPositionAt(uv, depth);

    float sunShadow = sunOcclusion(viewPosition);
    if (sunShadow > 0.0) color *= mix(vec3(1.0), sunShade, sunShadow);

    if (cloudStrength > 0.0) {
      // Reconstruct the world point this pixel came from, then walk the sun
      // ray from it up to the cloud deck. Sampling at that intersection is
      // what makes the shadow lie along the actual surface: a hilltop and the
      // valley beside it read the same cloud only if they are genuinely under
      // it, and nothing has to be positioned near the ground to work.
      vec3 world = (camToWorld * vec4(viewPosition, 1.0)).xyz;
      vec2 deck = world.xz + sunDirection.xz * ((cloudHeight - world.y) / max(sunDirection.y, 0.1));
      float mask = clouds(deck / cloudScale + vec2(cloudTime, cloudTime * 0.36));
      float shadow = smoothstep(cloudCover, cloudCover + 0.26, mask) * cloudStrength;
      // Cloud shade is a loss of direct sun, not a loss of all light, so the
      // pixel falls towards the colour of open sky rather than towards black.
      color *= mix(vec3(1.0), cloudShade, shadow);
    }

    float viewDistance = -getViewZ(depth);
    float amount = min(hazeMax, 1.0 - exp(-max(viewDistance - hazeStart, 0.0) * hazeDensity));
    vec3 haze = mix(hazeLow, hazeHigh, smoothstep(0.16, 0.94, uv.y));
    outputColor = vec4(mix(color, haze, amount), inputColor.a);
  }
`

/**
 * Distance haze plus drifting cloud shadow, both in screen space.
 *
 * Haze is here rather than in `THREE.Fog` because the ocean is a raw
 * ShaderMaterial that never receives fog uniforms. Cloud shadow is here for a
 * different reason: the obvious implementations do not work. A ground-hugging
 * alpha plane sinks into terrain relief, and lifting it clear makes it hover
 * visibly above the treetops. Projecting through the sun direction from depth
 * has neither problem, because there is no geometry to place.
 *
 * It earns its place by making the sunlight read as sunlight. A static lit
 * scene is ambiguous about where the light comes from; a shadow crawling
 * across the island resolves it instantly, and the tiles it has just left look
 * brighter for the comparison.
 *
 * Runs in HDR, before bloom, and leaves the sky dome untouched.
 */
class AtmosphereEffect extends Effect {
  constructor() {
    super('AtmosphereEffect', atmosphereShader, {
      blendFunction: BlendFunction.NORMAL,
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map<string, THREE.Uniform<unknown>>([
        ['exposure', new THREE.Uniform(0.97)],
        ['hazeLow', new THREE.Uniform(HAZE_LOW.clone())],
        ['hazeHigh', new THREE.Uniform(HAZE_HIGH.clone())],
        // The board sits about 16 units from the default camera and the far
        // corners of the ocean are past 40, so haze that only started at 20
        // with a density of 0.026 reached a quarter strength at the frame edge
        // and nothing at all on the island. Starting just behind the near rim
        // and roughly doubling the density puts real distance between the
        // foreground tiles and the far water, which is the atmospheric
        // perspective the frame was missing.
        ['hazeStart', new THREE.Uniform(16)],
        ['hazeDensity', new THREE.Uniform(0.038)],
        ['hazeMax', new THREE.Uniform(0.58)],
        ['invProjection', new THREE.Uniform(new THREE.Matrix4())],
        ['projection', new THREE.Uniform(new THREE.Matrix4())],
        ['camToWorld', new THREE.Uniform(new THREE.Matrix4())],
        ['sunDirection', new THREE.Uniform(SUN_DIRECTION.clone())],
        ['sunViewDirection', new THREE.Uniform(new THREE.Vector3())],
        // Shadow colour, not shadow black. A surface out of the sun is still
        // lit by a huge blue sky, so it desaturates and cools rather than
        // dropping to grey -- the same reasoning as the fill light in
        // `Lighting`, applied to the cast shadow instead of the shaded side.
        ['sunShade', new THREE.Uniform(new THREE.Vector3(0.63, 0.69, 0.79))],
        // Contact range only. The long march that used to reach from a cliff
        // top down to the sea is now the shadow map's job, and the sea catches
        // it on a `ShadowMaterial` plane in `GameScene`.
        ['sunShadowLength', new THREE.Uniform(1.1)],
        // How deep a depth-buffer hit still counts as a real occluder. Too
        // large and distant background geometry shadows the foreground.
        ['sunShadowThickness', new THREE.Uniform(0.62)],
        ['sunShadowStrength', new THREE.Uniform(0.24)],
        // Deep enough to read, cool enough to look like sky taking over from
        // sun. Pure grey here reads as a dirty lens.
        ['cloudShade', new THREE.Uniform(new THREE.Vector3(0.72, 0.78, 0.88))],
        ['cloudTime', new THREE.Uniform(0)],
        // A cloud shape is a couple of tiles across and cover sits just above
        // the noise mean, so at any moment part of the board is shaded and
        // most of it is not. Strength was set by pushing it to 0.95 to confirm
        // the projection tracked the terrain, then backing off until it read
        // as weather instead of as a passing blob.
        ['cloudScale', new THREE.Uniform(26)],
        ['cloudCover', new THREE.Uniform(0.57)],
        ['cloudStrength', new THREE.Uniform(0.3)],
        ['cloudHeight', new THREE.Uniform(26)],
      ]),
    })
  }
}

// Cloud-widths per second, so about a quarter of a world unit. A shape takes
// roughly a minute to cross the board, which is the speed at which the eye
// registers weather rather than animation.
const CLOUD_DRIFT = 0.0075

/**
 * Feeds the atmosphere pass the camera matrices it needs and advances the
 * cloud clock. Under reduced motion the clock simply stops, which leaves the
 * shadows in place rather than removing them -- consistent with how the rest
 * of the scene freezes instead of flattening.
 */
function Atmosphere({ reducedMotion = false }: { reducedMotion?: boolean }) {
  const camera = useThree((three) => three.camera)
  const effect = useMemo(() => new AtmosphereEffect(), [])
  const uniforms = effect.uniforms
  const sunInView = useMemo(() => new THREE.Vector3(), [])

  useEffect(() => () => effect.dispose(), [effect])

  useFrame((_, delta) => {
    (uniforms.get('invProjection')!.value as THREE.Matrix4).copy(camera.projectionMatrixInverse)
    ;(uniforms.get('projection')!.value as THREE.Matrix4).copy(camera.projectionMatrix)
    ;(uniforms.get('camToWorld')!.value as THREE.Matrix4).copy(camera.matrixWorld)
    // The march happens in view space, so the sun has to be rotated into it
    // every frame. This is also the single place where the shadow direction is
    // derived, so it cannot drift away from `SUN_DIRECTION` and disagree with
    // the terrain the way a separately authored value would.
    sunInView.copy(SUN_DIRECTION).transformDirection(camera.matrixWorldInverse)
    ;(uniforms.get('sunViewDirection')!.value as THREE.Vector3).copy(sunInView)
    if (reducedMotion) return
    const clock = uniforms.get('cloudTime')!
    clock.value = ((clock.value as number) + delta * CLOUD_DRIFT) % 1000
  })

  return <primitive object={effect} dispose={null} />
}

const gradeShader = /* glsl */`
  uniform float saturation;
  uniform float contrast;
  uniform float shoulder;
  uniform float toe;
  uniform float toeRange;
  uniform vec3 shadowTint;
  uniform vec3 highlightTint;

  /**
   * Shadow toe.
   *
   * A curve that only has a shoulder squeezes from one end and runs the other
   * end into the floor. Once real cast shadows landed, the frame measured 12
   * per cent of its pixels below 20/255 with a first percentile of 0.9, against
   * 0.2 per cent and 28 in the reference board -- black holes where a mountain
   * face or a forest interior should still show material.
   *
   * Film does not do that. Negative stock keeps responding below the point
   * where it stops being efficient, so deep shade lifts off the floor and holds
   * separation instead of clipping to nothing. This lifts the bottom of the
   * range and leaves the midtones where they are, so shade gets lighter without
   * the whole image going flat and milky.
   */
  vec3 liftToe(vec3 color) {
    return color + toe * (1.0 - smoothstep(0.0, toeRange, color));
  }

  /**
   * Highlight rolloff.
   *
   * Everything below the shoulder passes through untouched; everything above is
   * compressed onto an asymptote at 1.0, so no amount of overexposure ever
   * clips flat. This is why sea foam and snow keep their form instead of
   * turning into featureless white holes -- clamping threw that detail away,
   * and the contrast step above was pushing highlights past 1.0 before the
   * clamp even saw them.
   */
  vec3 rolloff(vec3 color) {
    vec3 over = max(color - shoulder, 0.0);
    float headroom = 1.0 - shoulder;
    return min(color, vec3(shoulder)) + over / (1.0 + over / headroom);
  }

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    // The composer still holds linear values here; the sRGB encode happens in
    // the final pass. Grade in display space or the curve crushes the shadows.
    vec3 color = pow(max(inputColor.rgb, 0.0), vec3(1.0 / 2.2));
    float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
    color = mix(vec3(luma), color, saturation);
    color = (color - 0.5) * contrast + 0.5;
    // Warm the sun, cool the shade. The split is what reads as time of day;
    // without it a bright scene just reads as a bright scene.
    color += shadowTint * (1.0 - smoothstep(0.0, 0.58, luma));
    color += highlightTint * smoothstep(0.40, 1.0, luma);
    color = liftToe(max(color, 0.0));
    color = rolloff(color);
    color = pow(clamp(color, 0.0, 1.0), vec3(2.2));
    outputColor = vec4(color, inputColor.a);
  }
`

/**
 * Display-referred grade: richer blues in the water, warmer golds in the sun,
 * a touch of contrast. Runs after tone mapping so the curve stays predictable.
 */
class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', gradeShader, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, THREE.Uniform<unknown>>([
        // The ocean already leaves the water shader deeply saturated and the
        // blue channel was the first thing to run out of headroom, so this
        // barely lifts. Colour separation in the frame now comes from the
        // warm/cool split below and from distance haze, not from a global
        // saturation push that only makes the sea louder.
        ['saturation', new THREE.Uniform(1.03)],
        // Down from 1.12. Contrast around a 0.5 pivot pushes both ends outward,
        // which is the last thing an image with real cast shadows needs.
        ['contrast', new THREE.Uniform(1.02)],
        // Foam and snow live just above this; keeping it below the clip point is
        // the whole reason they hold texture.
        ['shoulder', new THREE.Uniform(0.66)],
        ['toe', new THREE.Uniform(0.075)],
        ['toeRange', new THREE.Uniform(0.34)],
        ['shadowTint', new THREE.Uniform(new THREE.Vector3(-0.014, 0.004, 0.042))],
        ['highlightTint', new THREE.Uniform(new THREE.Vector3(0.042, 0.018, -0.028))],
      ]),
    })
  }
}

const Grade = wrapEffect(GradeEffect)

/**
 * Order matters: ambient occlusion on raw depth, then haze and bloom in HDR,
 * then tone mapping, grade, vignette and finally antialiasing.
 *
 * Antialiasing is SMAA. An earlier pass used FXAA, which is a blur filter by
 * construction -- it finds an edge and smears across it -- so number tokens
 * went mushy and the whole frame read as soft. SMAA matches edges against a
 * pattern table and reconstructs them, and leaves interior detail alone.
 *
 * MSAA on the composer target was measured against this and dropped. At
 * 1920x1200 four samples cost a reproducible 16-17ms per frame, a third of the
 * budget, and A/B crops of a number token and a tree line were indis-
 * tinguishable from SMAA alone. This scene is flat-shaded low-poly with hard
 * high-contrast silhouettes, which is exactly the case SMAA handles well. The
 * pixels are better spent on resolution, which `GameScene` now takes.
 *
 * There is deliberately no depth of field. Bokeh cost about eight frames a
 * second here and a tilt-shift blur smeared the far tiles, so the frame keeps
 * its edge falloff from the vignette instead. Mobile and reduced motion also
 * drop the bloom.
 */
export function PostFX({ mobile = false, reducedMotion = false }: { mobile?: boolean; reducedMotion?: boolean }) {
  const light = mobile || reducedMotion

  return <EffectComposer multisampling={0} frameBufferType={THREE.HalfFloatType} enableNormalPass={false}>
    <N8AO
      aoRadius={light ? 0.3 : 0.38}
      distanceFalloff={1.15}
      // Third pass at the same crease.
      //
      // The terrain's baked ARH textures already carry horizon-sweep occlusion
      // in the red channel, bound as an aoMap, and the shadow map now darkens
      // the same creases a second time. Screen-space AO on top was a third,
      // and 1.35 of it was only ever there to fake the shadows that were
      // missing. Stacked, tile seams and pit floors went to mud.
      //
      // What is left is the part the other two cannot do: the very short range
      // contact between two separate objects, a barrel against a wall, a tree
      // against a slope, where neither a baked map nor a 13mm shadow texel has
      // any information.
      intensity={light ? 0.24 : 0.32}
      quality="performance"
      halfRes
      denoiseRadius={light ? 6 : 10}
      color="#123a4e"
    />
    <Atmosphere reducedMotion={reducedMotion} />
    {light ? <></> : <Bloom mipmapBlur luminanceThreshold={0.68} luminanceSmoothing={0.22} intensity={0.5} radius={0.78} />}
    <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    <Grade />
    {/* Halved. Half a stop of corner falloff is a frame; a full one was a
        third source of darkness on an image that already had two too many. */}
    <Vignette offset={0.34} darkness={0.26} eskil={false} />
    <SMAA />
  </EffectComposer>
}
