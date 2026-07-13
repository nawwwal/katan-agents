# Visual reference and production audit

## Reference boundary

The rendering mechanics were studied from the official [Clash of Clans game page](https://supercell.com/en/games/clashofclans/) and [App Store listing](https://apps.apple.com/us/app/clash-of-clans/id529479190): broad silhouettes, generous bevels, warm key versus cool fill, dark contact occlusion, and a small number of oversized tier cues. No Supercell model, texture, UI, logo, character, or proprietary asset ships with Katan.

Katan's original target images are committed in `art/reference/`:

- `imagegen-board-world-target.png` establishes the island composition and light hierarchy;
- `imagegen-asset-sheet-target.png` establishes terrain, road, and building materials;
- `imagegen-architecture-road-target.png` supplies isolated settlement, city, and road direction.

They were generated with the built-in ImageGen mode and used as comparison targets, not runtime billboards.

## Iteration findings

| Study | Rejected result | Selected response |
| --- | --- | --- |
| Terrain vertical slice | Flat prisms and tiny scattered props | Fitted beveled ground plus one dominant resource silhouette |
| Forest | Photogrammetry cards and thin saplings disappeared at game distance | Authored branch-mass firs with three value bands and clear trunks |
| Fields | Thin stalks vanished; rail-like rows looked like fences | Dense sheaves on broad beds with no tiny bevel tax |
| Mountains | Rounded icospheres read as soft blobs | Faceted grey crags with pale caps and loose ore stones |
| SAM composite sheet | The whole sheet reconstructed as one shallow relief | Separate settlement and city crops reconstructed independently |
| SAM city density | Full mesh was heavier than the screen-space result justified | 50 percent decimation, selected from four rendered variants |
| Compression | Meshopt initially inflated parts because quantization transforms were discarded | Runtime now preserves each glTF node matrix; final render is visually identical |
| Mobile HUD | Vertical player rail covered the board | One horizontal player strip, compact turn banner, stacked touch controls |

The evidence retained after pruning is `vertical-slice-iterations.png`, `tree-form-iterations.png`, and `sam3d-city-decimation-study.png` in `art/blender/studies/`.

## Source-model decisions

SAM 3D is used only as a source-mesh accelerator. It produced a useful cottage and guildhall silhouette from Katan's own generated reference, but Blender still owns web suitability: scale, pivot, orientation, decimation, texture cap, roughness, ownership parts, stable naming, preview, and export.

Poly Haven boulder and wooden-pier models were inspected as form references. Their density and realistic micro-detail did not match the board budget, so neither model ships. The final ports, crags, roads, terrain props, number tokens, and robber are authored by the Blender build script. Curated Poly Haven CC0 textures remain as the material source.

## Blender workflow contract

Run `art/blender/build_katan_assets.py` inside Blender. The script:

1. clears and rebuilds named `00_GUIDES`, `10_TERRAIN`, `20_PIECES`, and `30_WORLD` collections;
2. creates shared materials and the six terrain families;
3. imports and normalizes the two SAM source GLBs;
4. renders `art/blender/katan-kit-preview.png`;
5. saves `art/blender/katan-kit.blend`;
6. exports a temporary glTF 2.0 GLB with quality-88 WebP textures;
7. runs pinned glTF-Transform `4.4.1` Meshopt compression into `public/assets/3d/katan-kit.glb`.

The runtime loader preserves node transforms introduced by quantization, reuses source geometry and materials, and clones only player-tinted materials. React Three Fiber continues to own canonical board placement, hit targets, hover and placement feedback, camera, lighting, water motion, and HUD.

## Browser QA

The final browser match used three authenticated human seats from room creation through revision 1,253 and an 11-point victory. It exercised initial placement, normal turns, dice results, roads and settlements, development cards, eight discards, 46 robber moves and steals, ten domestic trade offers and responses, 243 maritime trades, reconnect after reload, and active-turn controls on desktop and mobile. The host then started a fresh authoritative rematch and all three seats restored into the new initial-placement state.

Final evidence is in `art/qa/`, including the populated desktop board, initial placement, dice, robber, victory, rematch, and a `390×720` active-turn mobile capture. Agent waiting and disabled-turn behavior remains covered by the earlier mixed human/agent browser run plus the MCP and agent-runner checks.
