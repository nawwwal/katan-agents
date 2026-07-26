# Offline asset bake

Every terrain and piece texture in Katan is now painted once, offline, and
committed as WebP. Nothing is generated at page load.

```
npm run bake                    # rebuild anything whose inputs changed
npm run bake -- --force         # rebuild everything
npm run bake -- --only brick,ore
npm run bake -- --scale 0.25    # preview bake at quarter resolution, for iterating
npm run bake -- --sheet         # redraw the contact sheet from what is on disk
npm run bake:sheet              # same, standalone
```

Output goes to `public/assets/baked/`, the contract goes to
`public/assets/baked/manifest.json`, and a visual proof sheet goes to
`art/critique/bake-sheet.png`.

## Why this exists

The client's note was: "I can see polygons everywhere", "the quality is not that
sharp", "it is very heavy to render", and "ideally I wanted to load all the
assets one time, so it should not lag while I am playing."

`src/scene/terrain/textures.ts` generated six biomes of 512² albedo, normal and
roughness in JavaScript on every page load, about 580 ms of main-thread work for
maps that were too soft to survive being stretched across a hex. The island is
static, so all of it can be painted ahead of time — and painting it ahead of time
makes it sharper and cheaper at the same time. That is not a trade.

## What is in the box

| | count | albedo | normal | AO/rough/height | payload |
| --- | --- | --- | --- | --- | --- |
| terrain biomes | 6 | 2048² | 1024² | 1024² | 7.0 MB |
| piece materials | 8 | 1024² | 512² | 512² | 2.9 MB |
| cloth | 1 | 512² | 256² | 256² | 0.1 MB |

45 files, 10.05 MB, against a 12 MB ceiling. Full bake from scratch is about
115 s on 14 workers; a no-op bake is instant.

Terrain: `lumber wool grain brick ore desert`.
Pieces: `masonry plaster timber plank cobble gravel quay roof cloth`.

## What the runtime has to do

Fetch `manifest.json` once. It contains a flat `preload` array of every file, so
one request tells the loader the whole download list. Then, per material:

```ts
const manifest = await fetch('/assets/baked/manifest.json').then((r) => r.json())
const entry = manifest.materials.brick

const load = (texture, srgb) => {
  const t = loader.load(manifest.basePath + texture.file)
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
  t.wrapS = THREE.RepeatWrapping
  t.wrapT = THREE.RepeatWrapping
  t.anisotropy = entry.runtime.anisotropy
  t.generateMipmaps = true
  t.minFilter = THREE.LinearMipmapLinearFilter
  return t
}

const arh = load(entry.textures.arhMap, false)
arh.channel = 0                                   // read AO from uv, not uv1

const material = new THREE.MeshStandardMaterial({
  map: load(entry.textures.map, true),
  normalMap: load(entry.textures.normalMap, false),
  aoMap: arh,
  roughnessMap: arh,                              // same texture object
  roughness: entry.runtime.roughness,
  metalness: entry.runtime.metalness,
  vertexColors: true,
})
material.normalScale.setScalar(entry.runtime.normalScale)
material.aoMapIntensity = entry.runtime.aoMapIntensity
```

Five rules, all of them also stated in `manifest.contract`:

1. **Albedo is sRGB. Normal and ARH are not.** Getting this wrong washes out the
   normals and crushes the roughness.
2. **The ARH map is one texture bound twice** — to `aoMap` and `roughnessMap`.
   R is occlusion, G is roughness, B is the height field. Set `texture.channel = 0`
   or three.js will look for a `uv1` attribute that the hex geometry does not have.
3. **Do not bind ARH as `metalnessMap`.** B is height, not metalness. Metalness
   stays at the scalar in `runtime.metalness`.
4. **Repeat wrapping on S and T.** Every map is exactly seamless (see below), and
   terrain UVs run -0.28..1.28, so clamping would smear the hex rim.
5. **Terrain occlusion is already in the texture.** Turn SSAO off for terrain and
   stop shadow-mapping the tile surfaces. Leaving both on double-darkens the
   creases and spends the frame budget twice on the same effect.

`entry.hash` changes whenever the pixels change, so it is a safe cache-busting
query parameter if you want one.

## What is baked and what is not

**Baked**

- Albedo, at 4× the old resolution, with detail authored as structure rather than
  as summed noise.
- Tangent-space normals, Sobel-derived from the same height field the albedo is
  painted against, computed at full resolution and averaged down as vectors so
  the mean slope survives the downsample.
- Roughness.
- Ambient occlusion: a 12-direction, 10-step horizon sweep over the height field.
  This is the exact version of what SSAO approximates every frame.
- Height, in the spare blue channel, free.
- Seamlessness. Every generator in `noise.mjs` wraps its lattice by the frequency,
  so the maps tile exactly. The runtime generators did not, which put a hard
  discontinuity across every hex.

**Not baked, and why**

- *A directional (sun) term.* `hex.ts` rotates each tile's UVs by a per-tile angle
  so nineteen hexes do not show the same texture orientation. Anything
  directional baked into texture space would therefore point somewhere different
  on every tile. Occlusion is rotation invariant; a key light is not. If the
  per-tile UV rotation is ever dropped, a golden-hour key becomes bakeable and
  is worth doing.
- *An island lightmap.* This is the biggest remaining win and it is blocked on
  two things, neither of them in this pipeline. Terrain type is assigned randomly
  per game, so the tile surfaces are not the same island twice. But the island
  *body* — the cliff, beach and turf ring in `IslandBody.tsx` — is genuinely
  static and identical every match. Give it a second UV set and it can carry a
  real baked lightmap.
- *Macro landform shading.* `tileRelief` displaces the tile mesh per tile seed.
  That relief is not knowable at bake time and stays a runtime lighting problem.

## Atlasing and compression, honestly

**No UV atlas.** Every material here tiles with `RepeatWrapping`, and a UV rect
inside an atlas cannot wrap — you get neighbouring slots bleeding across the seam
at every mip level. The alternative, baking each biome as a unique unwrapped hex
and packing six into one texture, does buy a single draw call, but it needs
2048² per slot to match the texel density that tiling gets for free, which is a
6144×4096 atlas and roughly 100 MB of VRAM per map. That is a worse trade than
the draw calls are worth on a phone.

What the pipeline does instead is **channel packing**: AO, roughness and height
share one texture, so a terrain material binds three textures rather than four
and the runtime drops SSAO entirely. The manifest still carries `atlas` and
`uvRect` on every texture entry, so if a future change makes atlasing correct
(non-tiling unwraps, for instance) it is a manifest change and not a contract
change.

**No KTX2.** `toktx` and `basisu` are not installable through Homebrew or npm on
this machine, and more to the point the runtime has no KTX2 transcoder wired up —
`art/STYLE_BIBLE.md` records that decision already. WebP is the fallback and the
payload lands comfortably inside budget. KTX2 remains the right answer for VRAM
(it would cut roughly 4-6×, which matters more than the download does); doing it
means adding `KTX2Loader` plus the Basis transcoder to the runtime and swapping
the encoder in `worker.mjs`. The manifest carries a `format` field per texture so
that swap does not break the loader.

## Adding a material

1. Write a painter in `terrain.mjs` or `structures.mjs`:

   ```js
   export const myMaterial = (u, v, out) => {
     // u, v in [0, 1). Write linear-light rgb, height h in 0..1, roughness in 0..1.
     out.r = ...; out.g = ...; out.b = ...
     out.h = ...
     out.rough = ...
   }
   ```

   Export it from `TERRAIN_PAINTERS` / `STRUCTURE_PAINTERS`.

2. Add one line to `MATERIALS` in `config.mjs`:

   ```js
   structure('myMaterial', 0.02)
   ```

3. `npm run bake`. The manifest, the payload total and the contact sheet all pick
   it up automatically.

Rules the painters have to follow:

- **Frequencies must be integers**, and `fbm` uses lacunarity 2. That is what
  keeps the output tileable. Use the helpers in `noise.mjs` rather than raw
  trigonometry, and if you need a sine, use an integer cycle count.
- **`relief` in the config is the one number that ties everything together.** It
  is the peak displacement as a fraction of the texture's own width, and the
  albedo, the normal map and the occlusion sweep all read it, so they cannot
  disagree about how deep a crack is.
- **Author structure, not noise.** Three octaves of fbm average to flat grey the
  moment mipmapping touches them, which is precisely the "not sharp" the client
  saw. Brick fragments are rounded boxes with contact shadows; dune ripples have
  an asymmetric crest; wheat sits on the furrow ridge and soil sits in the
  trough. Use `stroke()` for anything that should read as a hard-edged mark —
  grass blades, needles, straws — because raw value noise is C2 continuous and
  reads as an airbrushed smear at 1:1.
- **Do not paint the landform.** `tileRelief` in `hex.ts` already terraces the
  brick tile and builds the ore massif. An early version of the brick painter
  quantised its own bench contours on top of that and came out looking like
  marbled paper. The texture is the material; the mesh is the shape.
- **Nothing stateful.** No `Math.random`, no clock, no mutable module state that
  survives a texel. The bake has to be reproducible.

## Determinism

Every generator is a pure function of coordinates and a seed. Two full bakes from
the same source produce byte-identical files — verified by hashing the whole
output directory across two `--force` runs.

Skip-if-unchanged is keyed on `sha256(pixel sources + the material's config
entry)`, recorded as `hash` on each manifest entry. Editing one painter rebakes
one material; editing `noise.mjs` rebakes all of them; editing the orchestrator
or the contact sheet rebakes nothing, because neither affects a pixel.

## Verifying a change

`npm run bake` writes `art/critique/bake-sheet.png`: one row per material, with
columns for albedo, the albedo tiled 2×2, the normal map, occlusion, roughness,
and a preview relit under the golden-hour key from `STYLE_BIBLE.md`.

**Look at it.** Two specific things:

- The *albedo x4* column is the seam test. Any discontinuity down the middle of
  that cell means a generator escaped the wrapping rules.
- The *lit preview* column is the material test. It is the only column that shows
  what the normal map and the occlusion actually do to the colour.

Then crop a map at 1:1 and look again. A texture that reads well as a 208 px
thumbnail and turns to mush at full size is the exact failure this pipeline
exists to fix, and the thumbnail will not tell you.

## Layout

```
scripts/bake/
  index.mjs          orchestrator: hashing, worker pool, manifest, budget check
  worker.mjs         one material per worker: rasterise, derive, encode, write
  config.mjs         the material table — resolutions, relief, quality, runtime hints
  render.mjs         supersampled rasteriser, Sobel normals, horizon-sweep occlusion
  noise.mjs          tileable value/fbm/ridged/Worley noise, SDF helpers
  palette.mjs        sRGB <-> linear, colour mixing
  terrain.mjs        the six biome painters
  structures.mjs     the nine piece painters
  contact-sheet.mjs  the proof sheet

public/assets/baked/
  manifest.json
  terrain/{lumber,wool,grain,brick,ore,desert}-{albedo,normal,arh}.webp
  structure/{masonry,plaster,timber,plank,cobble,gravel,quay,roof,cloth}-{albedo,normal,arh}.webp
```
