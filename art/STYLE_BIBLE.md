# Katan visual system

## Visual promise

Katan is a sunlit coastal strategy diorama: believable light and material response, simplified authored forms, restrained color, and an island that reads immediately at the gameplay camera. The world should feel crafted and expensive without copying another game's models, textures, interface, or branding.

Resource identity is carried by the whole tile before the number token is read:

| Resource | Primary silhouette | Dominant material |
| --- | --- | --- |
| Lumber | Four asymmetric tiered fir masses with visible trunks | Deep pine and forest floor |
| Wool | Open rolling pasture with three broad sheep | Moss grass and warm cream |
| Grain | Three freestanding crop clusters | Ochre soil and muted gold |
| Brick | Molded clay banks, quarry cuts, and loose fragments | Weathered terracotta |
| Ore | Three faceted crags, scree, and pale caps | Cool slate stone |
| Desert | Open sand with sparse stones and the robber silhouette | Warm mineral sand |

Player colors are ownership cues, not building materials. Coral `#D8563B`, blue `#287BD2`, amber `#E3A525`, and ivory `#EEE6CD` appear on compact road markers and building banners. Settlement and city remain readable from footprint, roofline, height, and tower count without color.

## Modeling contract

- One Blender unit equals one gameplay world unit. Blender is Z-up; glTF exports Y-up for Three.js.
- Terrain ground radius is `0.997`. The pointy-top footprint is about `1.727 × 1.994`, matching the canonical radius-`1` board without changing centers, vertices, edges, hit targets, or rules.
- The board frame is one continuous cliff, beach, and turf stack around the exact 19-hex outline.
- Forms use broad highlight-catching bevels, generally `0.012–0.085` units. Detail that disappears below roughly two screen pixels is deleted.
- Origins sit on useful contact planes: tiles at bottom center, roads at path center, and buildings at foundation center.
- Exported parts use stable PascalCase names. React Three Fiber groups those parts into logical terrain, road, settlement, city, port, token, and robber assets.
- Settlement and city are modular Blender-authored architecture. Earlier SAM 3D reconstruction meshes were rejected because their baked dark albedo, split topology, and scan noise looked worse after web reduction than a clean authored kit.

## Materials and texture density

- Terrain roughness stays mostly between `0.65–0.82`; bark reaches `0.88`, roof sits near `0.50`, and ownership paint is kept slightly cleaner.
- Ground, coast, stone, road, wood, roof, and bark reuse compact PBR map families. Every shipped texture is capped at `512×512`, which is proportional to the board's maximum screen size.
- Resource albedos are deterministic color grades of recorded Poly Haven CC0 sources. Normal and ARM maps remain shared where their physical surface is the same.
- Runtime export uses Blender-native WebP at quality `88`, then glTF-Transform `4.4.1` Meshopt compression. KTX2 is intentionally omitted because the current loader has no KTX2 transcoder and the measured payload is already within budget.
- Materials are backface culled. Player-tinted materials are the only runtime clones; source geometry and all other materials are reused.

## Lighting, water, and camera

- Warm key: `#FFD39D` from `[-8, 12, 5]`, intensity `2.35`.
- Cool fill: `#84C9DC` from `[6, 7, -5]`, intensity `0.44`.
- Hemisphere fill and a low RoomEnvironment intensity of `0.18` preserve shadow detail. ACES tone mapping uses exposure `1.12`.
- Desktop camera: `[7.7, 10.3, 9.8]`, `31°` vertical FOV. Narrow portrait camera: `[13.2, 16.4, 16.0]`, `43°` FOV so the whole island remains operable above the touch controls.
- The ocean is an opaque procedural water shader with three wave scales, analytic normals, Fresnel fill, restrained sun glint, and noise breakup. It does not use a photographic background. Motion freezes under reduced motion.
- The coast uses cliff, beach, turf, embedded rocks, shallow-water tint, and broken foam. Shore effects never alter board topology.

## Interface and interaction hierarchy

- The island owns the saturated color. In-match controls use quiet smoked metal, warm brass, thin player-color accents, and restrained blur instead of thick cartoon wood frames.
- Legal corner placement combines a raised gold peg and pale ring; hover adds lift and scale. Pending selection turns cyan and requires explicit confirm or cancel.
- Legal roads use a raised gold route. Built roads use a widened gravel crown, stone curbs, and small player-color markers.
- Current turn always combines crest, player name, and instruction. Mobile uses a three-column player strip with names and public counts, so identity is never reduced to color alone.
- Disabled actions retain disabled semantics and lowered contrast. Keyboard focus keeps a three-pixel visible outline. Reduced motion removes transitions and scene movement.

## Measured web budget

The production kit currently contains `36` stable runtime nodes and `30,664` source triangles. The Meshopt/WebP GLB is `2,203,764` bytes.

A populated three-player browser snapshot measured through temporary WebGL instrumentation:

| Surface | Draw calls | Submitted triangles | Mean frame | p95 frame |
| --- | ---: | ---: | ---: | ---: |
| Desktop `1280×720`, DPR 1, shadows | `293` | `299,720` | `9.73 ms` | `16.70 ms` |
| Mobile `390×844`, DPR 2, no shadow pass | `148` | `178,700` | `9.70 ms` | `17.00 ms` |

Those counts include repeated board assets and the desktop shadow pass, unlike source-kit triangle totals. The mobile snapshot scored `100` for Lighthouse accessibility and `100` for best practices. LODs are not shipped because the measured scene remains within the target frame budget; add them only after a slower-device trace identifies geometry as the bottleneck.
