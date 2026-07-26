// Shared ocean GLSL: Gerstner spectrum, analytic normals, Jacobian foam and
// the island distance field lookup. Injected into a MeshStandardMaterial so
// the water gets the scene's IBL, sun specular, shadows, fog and tone mapping
// for free — the Fresnel sky term is whatever `scene.environment` currently is.

export const oceanCommonGlsl = /* glsl */`
uniform float uTime;
uniform sampler2D uField;
uniform float uFieldExtent;
uniform float uChoppy;

const float TAU = 6.28318530718;

// dir.xy, wavelength, amplitude.
//
// The island is only about nine world units across, so a nine-unit swell is
// the size of the whole board: from the game camera it reads as cloud cover,
// not water. The spectrum runs from a three-unit swell down to a fifteen-
// centimetre ripple, which puts the longest wave at a third of the coastline
// and the shortest a couple of screen pixels wide.
const vec4 WAVE_A = vec4( 0.86, 0.51, 3.200, 0.0420);
const vec4 WAVE_B = vec4(-0.42, 0.91, 1.860, 0.0260);
const vec4 WAVE_C = vec4( 0.97,-0.24, 1.070, 0.0148);
const vec4 WAVE_D = vec4(-0.66,-0.75, 0.570, 0.0076);
const vec4 WAVE_E = vec4( 0.31, 0.95, 0.300, 0.0041);
const vec4 WAVE_F = vec4( 0.99, 0.14, 0.155, 0.0022);

// Coast distance in world units. Negative inside the rock silhouette.
// x is the whole wet silhouette, y is the island without the offshore rocks.
// Beyond the baked square we fall back to the distance to that square, which
// is exact enough for the open water where nothing keys off the value.
vec2 coastDistances(vec2 p) {
  vec2 uv = p / (2.0 * uFieldExtent) + 0.5;
  vec2 clamped = clamp(uv, vec2(0.0), vec2(1.0));
  vec2 sampled = texture2D(uField, clamped).rg;
  vec2 outside = max(abs(p) - uFieldExtent, vec2(0.0));
  return sampled + length(outside);
}

float coastDistance(vec2 p) {
  return coastDistances(p).x;
}

struct OceanSurface {
  vec3 offset;   // gerstner displacement
  vec3 normal;
  float foam;    // 0..1 jacobian compression
};

void accumulateWave(
  in vec4 wave, in vec2 p, in float t, in float gain, in float chop,
  inout vec3 offset, inout vec3 grad, inout float ny, inout float jxx, inout float jzz, inout float jxz
) {
  vec2 dir = normalize(wave.xy);
  float len = wave.z;
  float amp = wave.w * gain;
  float k = TAU / len;
  // Deep water dispersion, slowed for a readable board-game cadence.
  float w = sqrt(9.81 * k) * 0.38;
  // Total steepness across the spectrum must stay under 1 or the surface
  // pinches into loops, so each wave gets an equal slice.
  //
  // Scale it by the shoal gain. Without this, q cancels the gain out of the
  // Jacobian entirely, so knee-deep shelf water reported the same surface
  // compression as the open sea and the whole shallow ring turned milky.
  float steep = chop * 0.155 * clamp(gain, 0.0, 1.0);
  float q = amp > 0.00001 ? steep / (k * amp) : 0.0;
  float f = k * dot(dir, p) - w * t;
  float c = cos(f);
  float s = sin(f);
  float wa = k * amp;
  offset.xz += q * amp * dir * c;
  offset.y += amp * s;
  grad.x += dir.x * wa * c;
  grad.z += dir.y * wa * c;
  float qwa = q * wa * s;
  ny -= qwa;
  jxx -= qwa * dir.x * dir.x;
  jzz -= qwa * dir.y * dir.y;
  jxz -= qwa * dir.x * dir.y;
}

OceanSurface oceanSurface(vec2 p, float t, float gain, float chop, float detail) {
  vec3 offset = vec3(0.0);
  vec3 grad = vec3(0.0);
  float ny = 1.0;
  float jxx = 1.0;
  float jzz = 1.0;
  float jxz = 0.0;
  accumulateWave(WAVE_A, p, t, gain, chop, offset, grad, ny, jxx, jzz, jxz);
  accumulateWave(WAVE_B, p, t, gain, chop, offset, grad, ny, jxx, jzz, jxz);
  accumulateWave(WAVE_C, p, t, gain, chop, offset, grad, ny, jxx, jzz, jxz);
  // WAVE_D is half a world unit long, so it starts aliasing well before the
  // ripples do. Fade it on the same curve, just slower.
  accumulateWave(WAVE_D, p, t, gain * mix(0.25, 1.0, sqrt(detail)), chop, offset, grad, ny, jxx, jzz, jxz);
  // Drop the two shortest waves past the distance where they are sub-pixel.
  if (detail > 0.01) {
    accumulateWave(WAVE_E, p, t, gain * detail, chop, offset, grad, ny, jxx, jzz, jxz);
    accumulateWave(WAVE_F, p, t, gain * detail, chop, offset, grad, ny, jxx, jzz, jxz);
  }
  OceanSurface surface;
  surface.offset = offset;
  surface.normal = normalize(vec3(-grad.x, max(ny, 0.08), -grad.z));
  float jacobian = jxx * jzz - jxz * jxz;
  float compression = clamp((0.52 - jacobian) / 0.42, 0.0, 1.0);
  float slope = length(vec2(grad.x, grad.z));
  float steepCrest = smoothstep(0.36, 0.54, slope) * smoothstep(0.02, 0.10, offset.y);
  surface.foam = clamp(max(compression, steepCrest), 0.0, 1.0);
  return surface;
}

// Waves shoal and lose height as the shelf comes up.
float shoalGain(float coast) {
  return mix(0.14, 1.0, smoothstep(-0.2, 3.4, coast));
}
`

export const oceanNoiseGlsl = /* glsl */`
// The obvious two-line sin/fract hash correlates along the p.x == p.y diagonal,
// which showed up as a diagonal smear stretched across the far ocean. This one
// mixes through three components before folding, so the lattice reads clean.
float oceanHash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float oceanNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(oceanHash(i), oceanHash(i + vec2(1.0, 0.0)), f.x),
    mix(oceanHash(i + vec2(0.0, 1.0)), oceanHash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

// Three octaves is the point of diminishing returns here: the ocean shader
// is full screen, and every extra octave costs a full frame budget slice.
float oceanFbm(vec2 p) {
  float value = 0.5 * oceanNoise(p);
  value += 0.25 * oceanNoise(p * 2.03);
  value += 0.125 * oceanNoise(p * 4.11);
  return value;
}

float oceanFbm2(vec2 p) {
  return 0.62 * oceanNoise(p) + 0.31 * oceanNoise(p * 2.07);
}
`
