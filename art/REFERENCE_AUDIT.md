# Visual reference and production audit

## Reference boundary

The production pass studied the official [Clash of Clans game page](https://supercell.com/en/games/clashofclans/) and App Store imagery for mechanics that survive at strategy-camera distance: oversized tier cues, readable silhouettes, warm key versus cool fill, material separation, and disciplined detail scale. No Supercell model, texture, UI, character, logo, or proprietary asset ships with Katan.

Katan's original comparison images live in `art/reference/`. The final world target is `imagegen-premium-world-v2.png`: an original coastal settlement reference generated for this project, with a realistic-stylized island, strong terrain families, grounded architecture, and restrained interface-free composition.

## Vertical-slice decision

The Blender study compared three variants under one camera and light before the production script was finalized:

| Variant | Result | Decision |
| --- | --- | --- |
| A | Tiny cone trees, simple house, generic strip road | Rejected: familiar programmer-art silhouette |
| B | Chunky blob trees and oversized toy forms | Rejected: readable but too plastic and cartoon-like |
| C | Layered fir masses, modular stone/timber architecture, crowned dirt road, restrained ownership markers | Selected: strongest hierarchy and material grammar |

Evidence is retained in `art/blender/studies/premium-vertical-slice-v2.png` and `premium-vertical-slice-selected.png`.

The populated browser pass then exposed a defect that no Blender beauty render could reveal: resource hex surfaces topped out at `Y 0.445`, below the continuous frame turf at `Y 0.460`. The correct materials were shipping but were physically occluded. Raising the terrain contact stack above the frame revealed the six authored surfaces without moving any gameplay X/Z coordinates.

## Iteration findings

| Area | Rejected result | Final response |
| --- | --- | --- |
| Hex fit | Blender six-cylinder rotated another 30°, producing a flat-top mesh against pointy-top gameplay coordinates | Exact pointy-top ground, validated width/depth and fitted at radius `0.997` |
| Forest | 14k triangles of small repeated crowns | Four asymmetric layered fir masses, 4,912 triangles |
| Pasture | Flattened green spheres looked like puddles | Open PBR pasture; silhouette budget spent on sheep |
| Fields | Beveled orange platforms looked like toy furniture | Freestanding muted crop clusters on field soil |
| Desert | Three smooth ovals looked like petals | Open mineral sand with sparse rock and robber silhouette |
| Road | 3,108-triangle narrow barricade with repeated blocks | 332-triangle widened gravel route with low curbs and ownership posts |
| Buildings | Dark SAM scans with noisy topology and baked lighting | Modular Blender-authored plaster, timber, stone, roof, window, and banner parts |
| Water | Photographic CSS ocean plus translucent shader | One opaque procedural Three.js shader with controlled wave scales and no texture soup |
| HUD | Thick faux-wood frames competed with the island | Smoked-metal glass, thin brass edges, compact player-color accents |

## Source-model decision

Meta SAM 3D is useful for fast single-image shape exploration, but it does not replace retopology, material separation, pivots, naming, or screen-space judgment. The earlier settlement and city reconstructions were retained as source evidence only and removed from the production build. Their web-reduced result was darker, noisier, and heavier than the authored modular replacements.

Curated Poly Haven CC0 textures remain the material source. External high-density models were not added because their topology and microdetail did not improve the strategy-camera result enough to justify new attribution, cleanup, draw calls, or payload.

## Blender workflow contract

Run `art/blender/build_katan_assets.py` inside Blender. It:

1. clears and rebuilds named `00_GUIDES`, `10_TERRAIN`, `20_PIECES`, and `30_WORLD` collections;
2. creates shared materials and the six canonical terrain families;
3. builds modular roads, settlements, cities, ports, robber, tokens, and continuous coast;
4. validates node names, pointy-top bounds, and per-family triangle budgets;
5. renders `art/blender/katan-kit-preview.png` and saves `art/blender/katan-kit.blend`;
6. exports glTF 2.0 with quality-88 WebP textures;
7. runs pinned glTF-Transform Meshopt compression into `public/assets/3d/katan-kit.glb`.

React Three Fiber owns canonical placement, hit targets, interaction states, camera, lighting, procedural water, and HUD. Blender owns the authored world geometry and runtime-ready GLB contract.

## Browser evidence

`art/qa/baseline-desktop-initial-placement.png` records the occluded, muddy, mismatched starting point. `final-premium-desktop-populated.png` and `final-premium-mobile.png` record the rebuilt kit in a real three-seat authoritative room after six settlements and roads were placed.

The populated room was verified after reload/reconnect at desktop and mobile sizes. The final mobile snapshot had no console warnings or errors and scored `100` in Lighthouse accessibility and best practices. Engine and realtime state coverage remains enforced by the existing repository tests; this visual pass did not modify game rules or server authority.
