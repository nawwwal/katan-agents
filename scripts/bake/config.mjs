// Everything the bake is allowed to vary lives here. Adding a material means
// adding a painter and one entry in this table; nothing else in the pipeline
// needs to know about it.
//
// `relief` is the peak surface displacement expressed as a fraction of the
// texture's own width. It is the single number that ties the albedo, the normal
// map and the ambient occlusion together — all three read it, so they always
// agree about how deep a crack is.

export const PIPELINE_VERSION = '1.0.0'

/** Hard ceiling on the shipped payload. The client will take download over stutter. */
export const BUDGET_BYTES = 12 * 1024 * 1024

const terrain = (id, relief, opts = {}) => ({
  id,
  group: 'terrain',
  painter: id,
  albedo: 2048,
  normal: 1024,
  arh: 1024,
  relief,
  aoStrength: 1,
  quality: { albedo: 92, normal: 90, arh: 86 },
  runtime: {
    wrap: 'repeat',
    anisotropy: 8,
    normalScale: 1.1,
    roughness: 1,
    metalness: 0,
    aoMapIntensity: 1,
  },
  ...opts,
})

const structure = (id, relief, opts = {}) => ({
  id,
  group: 'structure',
  painter: id,
  albedo: 1024,
  normal: 512,
  arh: 512,
  relief,
  aoStrength: 1,
  quality: { albedo: 92, normal: 90, arh: 86 },
  runtime: {
    wrap: 'repeat',
    anisotropy: 8,
    normalScale: 1,
    roughness: 1,
    metalness: 0.04,
    aoMapIntensity: 1,
  },
  ...opts,
})

export const MATERIALS = [
  // Six biomes. These carry the whole island read, so they get the resolution.
  terrain('lumber', 0.014),
  terrain('wool', 0.011),
  terrain('grain', 0.016),
  // Brick was the client's named failure. It gets the deepest relief and the
  // strongest occlusion so the quarry benches and loose fragments actually cast.
  terrain('brick', 0.020, { aoStrength: 1.15 }),
  terrain('ore', 0.026, { aoStrength: 1.15, runtime: { wrap: 'repeat', anisotropy: 8, normalScale: 1.25, roughness: 1, metalness: 0, aoMapIntensity: 1 } }),
  terrain('desert', 0.013),

  // Piece materials. Smaller on screen, so half the resolution.
  structure('masonry', 0.030, { runtime: { wrap: 'repeat', anisotropy: 8, normalScale: 1.1, roughness: 1, metalness: 0.04, aoMapIntensity: 1 } }),
  structure('plaster', 0.010, { runtime: { wrap: 'repeat', anisotropy: 8, normalScale: 0.75, roughness: 1, metalness: 0.04, aoMapIntensity: 1 } }),
  structure('timber', 0.014),
  structure('plank', 0.020),
  structure('cobble', 0.035, { runtime: { wrap: 'repeat', anisotropy: 8, normalScale: 1.15, roughness: 1, metalness: 0.04, aoMapIntensity: 1 } }),
  structure('gravel', 0.040, { runtime: { wrap: 'repeat', anisotropy: 8, normalScale: 1.3, roughness: 1, metalness: 0.04, aoMapIntensity: 1 } }),
  structure('quay', 0.030, { runtime: { wrap: 'repeat', anisotropy: 8, normalScale: 1.1, roughness: 1, metalness: 0.04, aoMapIntensity: 1 } }),
  structure('roof', 0.045, { runtime: { wrap: 'repeat', anisotropy: 8, normalScale: 1.2, roughness: 1, metalness: 0.04, aoMapIntensity: 1 } }),
  structure('cloth', 0.008, { albedo: 512, normal: 256, arh: 256, aoStrength: 0.8 }),
]
