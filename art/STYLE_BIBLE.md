# Katan visual system

## Visual promise

Katan is a sunlit handcrafted archipelago: a fitted tabletop island with believable material response, oversized readable terrain forms, and warm coastal architecture. The target is polished stylized realism at the game camera, not toy plastic, miniature clutter, or copied art from another game.

Terrain must identify itself before the number token is read:

| Resource | Primary silhouette | Dominant color family |
| --- | --- | --- |
| Lumber | Tall tiered fir masses with visible trunks | Deep pine green |
| Wool | Low pasture rises and three broad sheep | Moss and cream |
| Grain | Dense upright sheaves on raised beds | Ochre and sunlit gold |
| Brick | Molded clay cuts and angular fragments | Burnt sienna |
| Ore | Three faceted crags, loose stone, pale caps | Cool slate grey |
| Desert | Low crossing dunes and sparse stone | Warm sand |

Player colors stay saturated but cover only ownership cues: road inlays, settlement or city plinths, and banners. Coral is `#D8563B`, blue `#287BD2`, amber `#E3A525`, and ivory `#EEE6CD`. Architecture, rooflines, height, and tower count distinguish building tiers without relying on color.

## Modeling contract

- One Blender unit equals one gameplay world unit. Blender is Z-up; glTF exports Y-up for Three.js.
- Terrain ground radius is `0.997`, so the canonical radius-`1` game layout remains fitted after beveling. Gameplay hex centers, vertices, edges, hit targets, and rules never move for art.
- The board frame is one continuous cliff, beach, and turf stack around the exact 19-hex outline.
- Forms use broad highlight-catching bevels, generally `0.014–0.085` units. Bevels too small to read at gameplay distance are removed.
- Origins sit at the contact point: tile and frame at bottom center, road at path center, and buildings at foundation center.
- Exported parts have stable PascalCase names. The runtime groups those parts into logical assets such as `TerrainMountains`, `Road`, `Settlement`, and `City`.
- City and settlement source meshes come from isolated SAM 3D reconstructions of Katan's own ImageGen target. Blender normalizes scale, pivot, material response, and texture size; the city is decimated to 50 percent after a four-variant visual study.

## Materials and texture density

- Terrain roughness stays mostly in the `0.70–0.80` range; readable bark reaches `0.88`. Metalness stays at zero except where an imported map explicitly carries a value.
- Ground, coast, stone, road, wood, roof, and bark use shared PBR map families. Every shipped texture is capped at `512×512`.
- The kit embeds 24 textures: compact color, normal, and ARM maps plus the two SAM albedos. Procedural noise is used only where it survives export or helps the Blender preview.
- Runtime export uses Blender-native WebP at quality `88`. KTX2 is intentionally omitted because the current loader has no KTX2 transcoder configured and the measured scene does not need the added pipeline.
- Poly Haven sources are CC0 and recorded in `art/source/polyhaven/README.md`. Runtime consumes only the curated maps embedded in the GLB.

## Lighting, water, and camera

- Warm key: `#FFD08E` from `[-8, 12, 5]`, intensity `1.75`.
- Cool fill: `#78C9DF` from `[6, 7, -5]`, intensity `0.32`.
- A low-intensity RoomEnvironment (`0.34`), hemisphere fill, ACES tone mapping, and one contact-shadow pass keep roofs and terrain grounded without plastic shine.
- The base camera is `[8.4, 12.8, 10.5]` at 32 degrees. Portrait screens widen to 42 degrees and pull back; shadows are disabled at `520px` and below.
- The ocean image supplies high-frequency surface detail. A transparent shader adds broad displacement, Fresnel fill, restrained glints, and anti-aliased wave crests. Motion stops under reduced motion.

## Interaction hierarchy

- Legal corner placement uses a raised gold peg plus a pale ring; hover adds lift and scale.
- Pending selection turns cyan and grows, then requires explicit confirm or cancel.
- Legal roads use a gold raised bar; built roads read as gravel beds with stone curbs and player-color inlays.
- Current turn always combines crest, name, and instruction. Mobile converts the player rail to one horizontal row so it does not cover the island.
- Disabled actions use opacity and disabled semantics, not color alone. Keyboard focus retains a three-pixel visible outline.

## Measured web budget

The final source kit contains 28 named meshes, 28 primitives, and 61,972 triangles before runtime repetition. Its uncompressed Blender GLB is 6,408,156 bytes.

The reproducible export finishes with Meshopt geometry compression and WebP textures:

- final GLB: `2,627,128` bytes raw and `2,269,084` bytes at gzip level 9;
- 59 percent smaller than the uncompressed Blender GLB;
- local asset load: `18.6 ms` in the final browser smoke test;
- desktop `1280×720` at DPR 2: 120 fps display limit, `8.33 ms` mean frame, `9.2 ms` p95;
- mobile `390×720` at DPR 2: 120 fps display limit, `8.33 ms` mean frame, `9.2 ms` p95;
- zero browser console errors after final reload and room reconnect.

No LOD layer ships because the integrated board already holds the display refresh limit on the measured Apple M5 Pro. Add one only after a slower-device measurement proves that geometry, rather than fill or UI, is the bottleneck.
