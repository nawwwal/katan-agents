# Blind critic verdict — July 26, 2026

An art director graded our render against the reference in two blind A/B sheets,
labelled only A and B, with the left/right order flipped between sheets and no
information about which panel was which.

**It identified the reference as better in both sheets, in opposite screen
positions, and called the gap "different league entirely" both times.**

- Our render: **3/10**
- Reference: **8/10**

Its closing judgement: *"No. Not for a second, and it would not survive a
storefront screenshot grid next to anything else in the strategy category...
Right now it reads as a WebGL demo of a hex board, not as a game."*

## Regional grades

| Area | Score | Note |
|---|---|---|
| Surf line at the shore | 1 | Worst thing in the frame |
| Roads | 1 | Cannot tell who owns which route — a functional failure |
| Ocean open water | 2 | Reads as one tiling normal map with a visible diagonal repeat |
| Grass and pasture | 2 | Sheep read as popcorn |
| Desert | 2 | Reads as an unfinished hex |
| Buildings | 2 | Primary-colour toy houses, no foundation |
| Harbours | 2 | Lecterns on stilts, detached, with loose geometry beside them |
| Lighting and shadow | 2 | Nothing casts a shadow anywhere |
| Mountain and rock | 3 | One instanced blob stack, repeating silhouette |
| Forest | 3 | One conifer at one scale, evenly scattered |
| Wheat and fields | 3 | Confetti, aliased furrows |
| Exposure and grade | 3 | Clipped whites, oversaturated blue, no depth cue |
| Clay and brick | 4 | Best terrain in the set, still a flat swatch |
| Number tokens | 6 | Legible, but inconsistent contrast and no contact shadow |

## Top 8 defects, most damaging first

1. **The surf ring is an opaque unlit white shape.** Hard-edged uniform-alpha
   polygon around 100% of the coastline. Needs three blended bands — aerated
   foam with an animated noise mask and feathered outer edge, turquoise shallow,
   then depth-graded blue — plus wet-sand darkening and a foam line that varies
   with coast curvature instead of offsetting the silhouette uniformly.
2. **Nothing casts a shadow.** No AO at hex seams, no contact shadow under
   buildings, trees, tokens or piers, no island shadow on the water. This is why
   the whole scene reads as a sticker on a backdrop.
3. **Road ownership is unreadable.** Breaks the game before it breaks the art.
   Needs real cross-section geometry raised off the hex border, saturated
   distinguishable player colour, and a dark outline or contact shadow so the
   colour separates from the terrain edge.
4. **Ocean reads as a single tiling normal map**, repeat visible as diagonal
   streaks. Needs layered wave scales at different rates and rotations, sun
   glint agreeing with the terrain sun, and depth-based absorption near shore.
5. **Mountains are one instanced blob stack.** Identical cones, identical caps,
   repeating silhouette. Needs 3-5 distinct rock forms with angular cliff faces
   and strata, non-uniform scale, and snow deposited by slope angle.
6. **Buildings are primary-coloured toy houses at the wrong scale.** Player
   colour should move off the whole roof onto a banner, flag or trim. Desaturate
   the roofs to plausible material tones, shrink to match tree scale, and sink
   them into a footing so they read as built rather than placed.
7. **Pasture sheep read as popcorn.** Either model them properly with dark head,
   legs and a cast shadow, or remove them and carry the pasture read with fence
   lines and grass variation. Half-resolution sheep are worse than none.
8. **No exposure control or atmospheric depth.** Foam and snow clip to pure
   white, blues oversaturate, near and far graded identically. Needs filmic
   highlight rolloff, a warm/cool split between lit and shade, and distance haze.

## Orchestrator note on defect 4

The ocean is *not* a tiling normal map — it is a six-wave Gerstner spectrum with
analytic normals, and the diagonal repeat was separately diagnosed and fixed. The
critic is describing what the render *looks like*, which is the thing that
matters, but do not follow its prescription literally. Treat "reads as a tiling
normal map" as the symptom to eliminate, not as a description of the cause.

The same caution applies generally: the critic graded pixels, not source. Where
its diagnosis of *cause* conflicts with what you know the code does, trust the
code and fix the appearance.
