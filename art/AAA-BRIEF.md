# Katan AAA visual brief

Shared contract for every agent doing visual work on this repo. Read this first.

## The target

Match the authored references, at the fidelity bar of a modern AAA title
(Clash of Clans / Age of Empires IV / GTA VI marketing renders):

- `art/reference/imagegen-board-world-target.png` — **the primary target.** Hex
  island, deep ocean, rocky surf, wooden piers, castle, densely detailed tiles.
- `art/reference/imagegen-premium-world-v2.png` — close-up material and lighting bar.
- `art/reference/standalone-assets/asset-contact-sheet.png` — per-piece silhouette bar.
- `art/reference/standalone-assets/*.png` — individual piece references.

## Current baseline gap (2026-07-26)

The live scene is clean but reads as an untextured low-poly prototype:
flat albedo, no visible cast shadows, no ambient occlusion, no post
processing, a flat teal ocean plane, a hard extruded cliff band instead of a
real coastline, blob trees, and DOM-overlay number tokens.

## How to look at your work

The dev server must be running (`npm run dev`, 127.0.0.1:5173).

```
scripts/shot.sh <out.png> [query] [WxH] [settle_seconds]
scripts/shot.sh /tmp/mine.png                      # populated board, 1920x1200
scripts/shot.sh /tmp/empty.png "populate=0"        # bare island
scripts/shot.sh /tmp/big.png "" 2560x1600 10       # higher res, longer settle
```

`?board` renders the island with zero UI chrome. Read the PNG back with the
Read tool and actually look at it. Never claim a visual result you have not
seen in a screenshot.

## Non-negotiables

1. **Never break the game.** `npx tsc -b --noEmit` and `npm test` must pass
   before you report done. Board topology (hex X/Z coordinates, vertex and edge
   IDs) is canonical — do not move it.
2. **Stay inside your file ownership.** Listed in your task. Editing a file
   another agent owns causes lost work. If you need a change outside your
   files, report it instead of making it.
3. **Performance budget:** 60fps at 1920x1200 on Apple Silicon integrated GPU.
   Prefer instancing, baked/procedural textures, and shader work over raw
   geometry count. No asset over 4MB.
4. **Accessibility:** honour `useReducedMotion()`; keep hit targets and colour
   contrast intact.
5. **Determinism:** the same seed must produce the same island. Seed any noise
   or scatter from tile/vertex IDs, never `Math.random()` at render time.

## House style

- Three.js r180, React Three Fiber v9, drei v10, `postprocessing` +
  `@react-three/postprocessing` are installed.
- TypeScript strict. No `any`. Match surrounding code density and naming.
- Golden-hour key light, cool bounce, physically plausible materials.
- Stylised realism: readable game-piece silhouettes, real material response.
  Not photoreal, not cartoon.
