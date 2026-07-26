import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useSyncExternalStore } from 'react'
import * as THREE from 'three'
import { getIslandField, subscribeIslandField } from './ocean/islandField'
import { FIELD_EXTENT, SEA_LEVEL } from './ocean/oceanConfig'
import { createOceanDisc } from './ocean/oceanGeometry'
import { oceanCommonGlsl, oceanNoiseGlsl } from './ocean/waveGlsl'
import { HAZE_LOW, SUN_DIRECTION } from './Sky'

const openOceanField = () => {
  const far = THREE.DataUtils.toHalfFloat(8)
  const data = new Uint16Array([far, far])
  const texture = new THREE.DataTexture(data, 1, 1, THREE.RGFormat, THREE.HalfFloatType)
  texture.needsUpdate = true
  return texture
}

const vertexHead = /* glsl */`
${oceanCommonGlsl}
varying vec2 vOceanXZ;
varying float vOceanCoast;
varying float vOceanShore;
varying float vOceanGain;
varying float vOceanDetail;
vec3 oceanOffset;
vec3 oceanNormalWS;
`

const fragmentHead = /* glsl */`
${oceanCommonGlsl}
${oceanNoiseGlsl}
uniform vec3 uSunDirection;
uniform vec3 uHazeColor;
uniform float uScatter;
uniform vec3 uDeepColor;
uniform vec3 uOceanColor;
uniform vec3 uShelfColor;
uniform vec3 uShallowColor;
uniform vec3 uLagoonColor;
varying vec2 vOceanXZ;
varying float vOceanCoast;
varying float vOceanShore;
varying float vOceanGain;
varying float vOceanDetail;
`

/**
 * Ocean surface.
 *
 * Gerstner spectrum with analytic normals and Jacobian-driven whitecaps, laid
 * over a MeshStandardMaterial so the sky reflection comes from whatever
 * `scene.environment` is, the key light gives the specular track, and fog and
 * tone mapping stay consistent with everything else in the scene.
 */
export function Water({ reducedMotion = false }: { reducedMotion?: boolean }) {
  const field = useSyncExternalStore(subscribeIslandField, getIslandField, getIslandField)
  const geometry = useMemo(() => createOceanDisc(168, 208), [])
  const fallback = useMemo(openOceanField, [])
  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uField: { value: fallback as THREE.Texture },
    uFieldExtent: { value: FIELD_EXTENT },
    uChoppy: { value: 1.0 },
    uSunDirection: { value: SUN_DIRECTION.clone() },
    uHazeColor: { value: HAZE_LOW.clone() },
    uScatter: { value: 0.62 },
    // Linear-space body colours read off the reference: deep navy through
    // shelf blue to a turquoise lagoon right against the rock.
    uDeepColor: { value: new THREE.Color(0.0035, 0.0470, 0.1420) },
    uOceanColor: { value: new THREE.Color(0.0055, 0.0880, 0.2320) },
    uShelfColor: { value: new THREE.Color(0.0080, 0.1620, 0.3150) },
    uShallowColor: { value: new THREE.Color(0.0140, 0.2350, 0.2900) },
    uLagoonColor: { value: new THREE.Color(0.0480, 0.3450, 0.3750) },
  }), [fallback])

  const material = useMemo(() => {
    const created = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.08,
      metalness: 0.0,
      envMapIntensity: 0.30,
      fog: false,
      dithering: true,
    })
    created.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms)
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${vertexHead}`)
        .replace('#include <beginnormal_vertex>', /* glsl */`
          vec2 oceanBase = position.xz;
          vec2 oceanDist = coastDistances(oceanBase);
          vOceanCoast = oceanDist.x;
          vOceanShore = oceanDist.y;
          vOceanGain = shoalGain(vOceanCoast);
          vOceanDetail = 1.0 - smoothstep(38.0, 120.0, distance(cameraPosition, vec3(oceanBase.x, 0.0, oceanBase.y)));
          OceanSurface oceanSurf = oceanSurface(oceanBase, uTime, vOceanGain, uChoppy, vOceanDetail);
          oceanOffset = oceanSurf.offset;
          oceanNormalWS = oceanSurf.normal;
          vOceanXZ = oceanBase + oceanOffset.xz;
          vec3 objectNormal = oceanNormalWS;
        `)
        .replace('#include <begin_vertex>', /* glsl */`
          vec3 transformed = position + oceanOffset;
        `)
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${fragmentHead}`)
        .replace('#include <normal_fragment_maps>', /* glsl */`
          normal = normalize((viewMatrix * vec4(oceanN, 0.0)).xyz);
        `)
        .replace('#include <color_fragment>', /* glsl */`
          OceanSurface oceanSurf = oceanSurface(vOceanXZ, uTime, vOceanGain, uChoppy, vOceanDetail);
          // Two gradient octaves: the swell-scale chop and the glitter-scale
          // ripple. Each is three noise taps, and together they are the single
          // most expensive thing in this shader, so they fade out separately.
          // The glitter octave has a twelve-centimetre wavelength and is under
          // a pixel wide past about twenty-five units, which is most of the
          // frame — gating it there pays for the rest of the pass.
          vec3 detail = vec3(0.0);
          if (vOceanDetail > 0.01) {
            vec2 rippleP = vOceanXZ * 3.4 + vec2(uTime * 0.09, -uTime * 0.07);
            float rippleE = 0.07;
            float r0 = oceanNoise(rippleP);
            float rx = oceanNoise(rippleP + vec2(rippleE, 0.0));
            float rz = oceanNoise(rippleP + vec2(0.0, rippleE));
            detail = vec3(-(rx - r0), 0.0, -(rz - r0)) * (0.24 / rippleE);
            if (vOceanDetail > 0.55) {
              vec2 fineP = vOceanXZ * 12.5 + vec2(-uTime * 0.21, uTime * 0.26);
              float f0 = oceanNoise(fineP);
              float fx = oceanNoise(fineP + vec2(0.06, 0.0));
              float fz = oceanNoise(fineP + vec2(0.0, 0.06));
              detail += vec3(-(fx - f0), 0.0, -(fz - f0)) * (0.075 / 0.06)
                * smoothstep(0.55, 0.80, vOceanDetail);
            }
            detail *= vOceanDetail;
          }
          vec3 oceanN = normalize(oceanSurf.normal + detail * vOceanGain);

          float coast = vOceanCoast;
          // Break the depth bands with noise: a clean radial ramp instantly
          // reads as a distance field painted on the sea. Keep the wobble
          // small and fairly fine or the shelf edge turns into soft lobes.
          float coastN = coast + (oceanNoise(vOceanXZ * 1.35) - 0.5) * 0.55;
          float shoreT = smoothstep(-0.05, 0.35, coast);
          vec3 waterColor = mix(uLagoonColor, uShallowColor, shoreT);
          waterColor = mix(waterColor, uShelfColor, smoothstep(0.30, 0.95, coastN));
          waterColor = mix(waterColor, uOceanColor, smoothstep(0.85, 2.00, coastN));
          waterColor = mix(waterColor, uDeepColor, smoothstep(1.90, 4.20, coastN));

          // Tonal variation so the open water is never a flat wash. At the old
          // 13-unit cell size this was the same scale as the visible far field,
          // which posterised it into soft steps; keep the cells small.
          float swell = oceanNoise(vOceanXZ * 0.42 + vec2(uTime * 0.020, -uTime * 0.014));
          waterColor *= 0.86 + swell * 0.26;

          // Crests scatter more light back than troughs, and faces tilted
          // toward the sun are lighter than faces tilted away. Without this the
          // wave normals only drive the specular and the sea reads as a sheet.
          float crestT = clamp(oceanSurf.offset.y / (0.10 * max(vOceanGain, 0.2)), -1.0, 1.0);
          vec2 sunFlat = normalize(uSunDirection.xz);
          float facing = dot(normalize(vec2(oceanN.x, oceanN.z) + vec2(1e-5)), sunFlat)
            * clamp(length(vec2(oceanN.x, oceanN.z)) * 3.4, 0.0, 1.0);
          waterColor *= max(0.36, 0.82 + 0.26 * crestT + 0.30 * facing);

          // Whitecaps. Open ocean in the reference is overwhelmingly navy with
          // a few small crisp tears of white, so all three gates are tight: the
          // very top of a crest, only where the surface is genuinely pinching,
          // and cut into fine flecks rather than broad clouds. Deep water past
          // the shelf gets none at all.
          float breakup = smoothstep(0.58, 0.78, oceanFbm(vOceanXZ * 9.0 + vec2(-uTime * 0.17, uTime * 0.12)));
          float crestTop = smoothstep(0.76, 1.0, oceanSurf.offset.y / max(0.058 * vOceanGain, 0.006));
          float caps = crestTop * smoothstep(0.44, 0.78, oceanSurf.foam) * breakup;
          caps *= 1.0 - smoothstep(4.0, 16.0, coast);

          // Surf: swell lines that march in and blow out white on the rock.
          // Only the shore band pays for this; open water skips it entirely.
          float surf = 0.0;
          float caustic = 0.0;
          if (coast < 1.1) {
            float depth = max(coast, 0.0);
            float shore = max(vOceanShore, 0.0);
            float grain = oceanNoise(vOceanXZ * 1.15);
            // Fine isotropic tearing. An earlier pass sheared this along the
            // coast tangent for streaked backwash; around a small round rock
            // the tangent rotates through a full turn and the result was a
            // dandelion of radial spokes. World-space noise has no such axis.
            float tear = oceanFbm(vOceanXZ * 13.0 + vec2(uTime * 0.20, -uTime * 0.15));
            // How far the white water reaches varies along the coast: some
            // bays are packed with it, some headlands are nearly clear.
            float reach = smoothstep(0.26, 0.68, oceanFbm2(vOceanXZ * 0.62 + vec2(uTime * 0.03, 0.0)));
            float surge = 0.5 + 0.5 * sin(uTime * 0.52 + grain * 3.4);

            // Wash. This decays one way, out from the rock — an earlier version
            // used a symmetric band around the zero isocontour, which drew the
            // waterline as a hard ribbon of icing standing off every rock.
            // Pushing it through the tear field gives it a ragged outer edge.
            // The island wash is wide. From the game camera the cliff top leans
            // out over roughly the first third of a unit of water, so a band
            // that only hugged the true waterline was hidden on every near
            // shore and the surf read as a ring floating offshore.
            float span = 0.13 + reach * 0.52 + surge * 0.08;
            float core = 1.0 - smoothstep(0.0, span, shore);
            // Solid against the rock, ragged only across the outer half. Letting
            // the tear field cut the whole band punched blue holes through it and
            // the surf broke up into detached rings floating offshore.
            float wash = smoothstep(0.16, 0.54, core * (0.62 + tear * 0.70));
            wash *= (0.44 + reach * 0.56) * (1.0 - smoothstep(0.60, 1.20, shore));

            // Offshore rocks get a tight collar off the same field instead: a
            // metre of white water around a twenty-centimetre rock is a blob.
            float collar = 1.0 - smoothstep(0.0, 0.075 + reach * 0.075, depth);
            collar = smoothstep(0.18, 0.58, collar * (0.60 + tear * 0.72));

            // Swell lines breaking further out: thin, hard-edged, and bent out
            // of parallel by the tear field so they never read as rings.
            float phase = shore * 11.0 - uTime * 1.25 + grain * 2.6 + tear * 3.2;
            float breakers = smoothstep(0.82, 0.99, sin(phase))
              * (1.0 - smoothstep(0.20, 0.95, shore)) * (0.35 + reach * 0.90);

            // Cap below 1 so the water body always shows through the aeration.
            surf = clamp(max(wash, collar * 0.92) + breakers * 0.70, 0.0, 0.88);
            // Mottle the interior. Cutting it with the tear mask instead would
            // punch holes; modulating intensity keeps the sheet whole.
            surf *= 0.80 + tear * 0.34;
            float causN = oceanFbm2(vOceanXZ * 3.4 + vec2(uTime * 0.055, -uTime * 0.042));
            caustic = pow(1.0 - abs(causN - 0.5) * 2.0, 5.0) * (1.0 - smoothstep(0.12, 0.70, coast));
          }

          float foam = clamp(max(caps * 0.60, surf), 0.0, 1.0);
          // Aerated water, not paper. Pure white albedo under this key light
          // clipped the surf into a flat blown sheet with no internal form.
          vec3 foamColor = vec3(0.68, 0.745, 0.775);
          // Real water albedo is a couple of percent: everything you see is
          // scattering and reflection, both carried on the emissive channel.
          diffuseColor.rgb = mix(waterColor * 0.16, foamColor, foam);
          #ifdef USE_COLOR
            diffuseColor.rgb *= vColor;
          #endif
        `)
        .replace('#include <roughnessmap_fragment>', /* glsl */`
          float roughnessFactor = mix(0.055, 0.88, foam);
        `)
        .replace('#include <opaque_fragment>', /* glsl */`
          // PostFX owns aerial perspective up to its cap; past that the ocean
          // still has to reach the sky dome or the horizon reads as a seam.
          float oceanViewDist = length(cameraPosition - vWorldPosition_ocean);
          float haze = smoothstep(70.0, 380.0, oceanViewDist);
          vec3 oceanOut = mix(outgoingLight, uHazeColor, haze);
          // The far field is a very long, very shallow gradient over dark blue,
          // which is exactly where an 8-bit sRGB write posterises. The material
          // dither runs after tone mapping and is too small to help down here,
          // so add a linear-space quantum sized for these values.
          float grid = fract(dot(gl_FragCoord.xy, vec2(0.7548776662, 0.5698402909)));
          oceanOut += (grid - 0.5) * 0.0026;
          gl_FragColor = vec4(oceanOut, diffuseColor.a);
        `)
        .replace('#include <emissivemap_fragment>', /* glsl */`
          vec3 oceanView = normalize(cameraPosition - vWorldPosition_ocean);

          // Subsurface: light transmitting through the back of a crest.
          float crest = clamp((oceanSurf.offset.y + 0.02) / 0.13, 0.0, 1.0);
          float through = pow(clamp(dot(oceanView, -uSunDirection) * 0.5 + 0.5, 0.0, 1.0), 3.0);
          vec3 sss = vec3(0.10, 0.62, 0.52) * crest * through * 0.38;

          // Sparkle: sub-pixel glint the smooth GGX lobe cannot resolve.
          vec3 sparkle = vec3(0.0);
          if (vOceanDetail > 0.01) {
            vec3 halfDir = normalize(uSunDirection + oceanView);
            float spec = pow(max(dot(oceanN, halfDir), 0.0), 220.0);
            float sparkleMask = smoothstep(0.52, 0.95, oceanNoise(vOceanXZ * 9.0 + vec2(uTime * 0.35, -uTime * 0.28)));
            sparkle = vec3(1.0, 0.88, 0.70) * spec * (0.10 + sparkleMask * 0.95) * vOceanDetail;
          }

          // Caustics on the shelf (mask computed with the surf band above).
          vec3 caustics = vec3(0.34, 0.62, 0.72) * caustic * 0.085;

          // Water is a scattering volume, not a lambertian surface: carry the
          // body colour directly so the sea keeps its hue under any key light.
          // Fresnel toward the sky: low at nadir, near total at grazing, and
          // swinging hard across wave faces. This is most of the surface
          // structure the eye reads on open water.
          float fresnel = 0.022 + 0.978 * pow(1.0 - clamp(dot(oceanN, oceanView), 0.0, 1.0), 5.0);
          vec3 skyTint = mix(uHazeColor, vec3(0.14, 0.38, 0.82), 0.62);
          vec3 reflectionGlow = skyTint * fresnel * 0.44;

          totalEmissiveRadiance += (waterColor * uScatter * (1.0 - fresnel * 0.55) + reflectionGlow) * (1.0 - foam)
            + (sss + sparkle + caustics) * (1.0 - foam * 0.7)
            + vec3(0.64, 0.70, 0.74) * foam * 0.13;
        `)
      // The standard shader only defines vWorldPosition under some feature
      // combinations, so carry our own copy.
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPosition_ocean;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldPosition_ocean = (modelMatrix * vec4(transformed, 1.0)).xyz;')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPosition_ocean;')
    }
    return created
  }, [uniforms])

  useEffect(() => () => { material.dispose(); geometry.dispose(); fallback.dispose() }, [material, geometry, fallback])

  useEffect(() => {
    uniforms.uField.value = field ? field.texture : fallback
    uniforms.uFieldExtent.value = field ? field.extent : FIELD_EXTENT
  }, [field, fallback, uniforms])

  useFrame(({ clock }) => {
    if (!reducedMotion) uniforms.uTime.value = clock.elapsedTime
  })

  return <mesh
    name="ocean"
    geometry={geometry}
    material={material}
    position={[0, SEA_LEVEL, 0]}
    receiveShadow
    renderOrder={1}
  />
}
