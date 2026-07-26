# Interaction audit

Read-only audit of the Katan play loop, July 26 2026. Written from `src/game/types.ts`,
`src/game/engine.ts`, `src/App.tsx`, the scene and UI layers, and from playing a real
three-seat match on `127.0.0.1:5173` with two seats driven by `chooseSimulationAction`.
Screenshots and states referenced below were captured live, including a real seven, a
real discard, and a real `move-robber` phase.

This document is a build spec. Work down it. Section 6 is the file map for partitioning.

---

## 1. What the game already has

Name these systems in every ticket. Do not build parallel ones.

| System | File | What it gives you |
| --- | --- | --- |
| Beat channel | `src/scene/motion/beats.ts` | `emitBeat({kind, revision, at})`, `emitShake(strength)`, `onBeat`, `onShake`. Kinds: `roll place city robber trade award victory quiet` |
| Camera recipes | `src/scene/CameraRig.tsx` `RECIPES` | Per-beat `distance / polar / azimuth / fov / follow / hold / frequency / ratio / anticipate` |
| Particle kit | `src/scene/motion/Particles.tsx` | `Burst` (dust/debris), `Shockwave`, `Flare`, `Motes`. All seeded from a string id, all take `reducedMotion` |
| Drop physics | `src/scene/motion/placement.ts` | `usePlacementDrop(ref, {id, kind, reducedMotion, onImpact})`, fires `emitShake` on contact |
| Shared clock | `src/scene/motion/timing.ts` | `DICE_FLIGHT/SETTLE/LIFE/BOUNCES`, `PRODUCTION_DELAY = 1.35`, `CONTACT = 0.37` |
| Springs | `src/scene/motion/spring.ts` | `spring`, `stepSpring`, `setSpring`, `impulse`, `seededFrom`, easing curves |
| Halo texture | `src/scene/structures/textures.ts` | `haloTexture()`, `hashString()`, `makeRng()` |
| Sound bank | `src/audio/soundbank.ts` | 38 ids, loaded and mixed on three buses |
| Reduced motion | `src/scene/useReducedMotion.ts` | Boolean hook, already threaded through the scene |

**Eight sounds ship in the bank and are never played by anything:** `ui-hover`,
`ui-click`, `ui-click-soft`, `ui-click-deep`, `ui-open`, `ui-close`, `ui-error`,
`amb-forest`. Grepped: zero references outside `soundbank.ts`. The 2D layer is
completely silent on input. Every button press, dialog open, dialog close, stepper
tick and error toast in `Hud.tsx` and `Dialogs.tsx` makes no sound at all. This is the
cheapest large win in the audit and it touches almost nothing.

### The structural gap

`emitBeat` is only ever called from `ActionEffects.tsx`, from a `useEffect` on
`presentation.revision`. That means **the beat channel only ever says "something
happened", never "something is now possible"**. There is no channel at all for
affordance state. That single absence explains most of what is listed below: when the
game hands you a decision, nothing in the 3D scene changes except a set of low-contrast
markers, and the camera does not move until after you have already committed.

Fix this first. See Principle P1 in section 5.

---

## 2. Inventory of interaction moments

Every point where the player acts or the game reports something. Ranked column is the
position in section 3, or blank if it did not make the cut.

| # | Moment | What happens today | Honest failure | Rank |
| --- | --- | --- | --- | --- |
| 1 | Title, create or join a room | Two buttons, a name field, a 3/4 seat toggle. Cinematic camera orbit behind it | Works. The orbit is the best-feeling thing in the app | |
| 2 | Lobby, waiting for seats | Seat rows change from empty to a name. `Start game` un-disables | Silent. A seat filling is the only reason you are on this screen and it produces no sound, no motion, no highlight | |
| 3 | Introduction screen | One card, one `Enter the island` button | Fine | |
| 4 | Setup: place first settlement | 50 legal vertices, each drawn as a 0.15-radius cobble pad, a 0.009-radius stake, a 12cm cream pennant and a 0.3-radius additive halo at 0.6 opacity | At the default framing (`distance 15.3`, `fov 31`) a pennant is roughly 8 screen pixels of pale cream on an island whose paths, beaches and hex borders are all pale sand. I could not find them without cropping and enlarging the screenshot 1.75x. This is the primary affordance of the game and it is effectively invisible | 1 |
| 5 | Setup: place adjacent road | 3 legal edges as `RoadGhost` at 0.5 opacity, `#ffcf5e` | Same problem, smaller N. The ghost reads as a lighter patch of the sand path underneath it | 1 |
| 6 | Waiting for a rival's setup placement | `TurnPanel` name and phase text change. A `PlayerRail` row gets `.active` | Nothing on the board. You do not see their settlement arrive unless you happen to be looking at that corner. A camera `place` beat does fire, so the board drifts, but there is no explanation for the drift | 11 |
| 7 | Turn handoff to you | The corner panel's `<strong>` changes to your name, `phaseCopy` changes to `Roll dice`, one `PlayerRail` row gains `.active`, the `ActionTray` re-renders with a Roll button | `end-turn` is in the `SILENT` set in `useGameAudio.ts` and maps to the `quiet` beat, whose recipe has `hold: 0`, so `CameraRig` explicitly does nothing. **The single most repeated event in the match produces no sound, no camera move, no particle and no full-frame change.** A text label in the top-left corner changes colour-neutral text | 2 |
| 8 | Roll dice | Best-served moment in the game. Physical dice throw, three-stage audio against `DICE_BOUNCES`, camera pulls wide on the `roll` recipe, `DiceMoment` overlay with a per-player production summary | Two gaps. The Roll button itself makes no click. And the overlay disappears on a fixed 1450ms timer regardless of whether the dice have settled | |
| 9 | Production payout | `TilePulses` heartbeat on producing hexes plus `ResourceFlows` motes travelling tile to settlement, `resource-gain` at `PRODUCTION_DELAY + 0.2`, `useCountPulse` flags changed wallet cards for 560ms | Genuinely good. The one miss: the motes land on the settlement, not on your wallet, so the causal chain stops one step short of the number that actually changed | |
| 10 | Nothing produced | `<small class="production-none">No settlement produced</small>` inside the dice overlay | Acceptable | |
| 11 | Arm a build mode | `BUILD_COMMANDS` buttons toggle `placementMode`. Cost pips dim per resource. A count badge shows legal locations | Pressing `ROAD` changes one button's border and reveals a set of markers you cannot see (see #4). There is no state change anywhere near where you are about to look. `aria-pressed` is set, which is correct, but there is no board-side "armed" state at all | 5 |
| 12 | Place a road or settlement | Click a target, `act()` sets `pendingAction`, a bar appears bottom-center reading "Confirm the glowing corner or choose another" | There is no glowing corner. The pending tint is `#8ef0ff` at scale 1.3 on the same 8-pixel pennant. **The confirm bar names a visual the player cannot locate, and the camera does not move to it.** The bar itself is bottom-center and can sit on top of the target it is describing | 4 |
| 13 | Upgrade a settlement to a city | `Building` grows a `#ffd45b` halo disc when `legalCity`, scales 1.12 on hover, 1.18 on pending. On commit: `usePlacementDrop` with `kind: 'city'`, a heavy `PlacementImpact`, `emitShake(0.16)`, the `city` camera recipe, `place-city` sound | The commit is good. Getting there is not: the only way to discover a city is legal is to press `CITY` in the tray and then find a slightly larger halo on one of your own settlements. Nothing communicates "this settlement, the one you already own, is the thing being replaced". The old settlement does not visibly leave | 6 |
| 14 | Buy a development card | `card-draw` sound, `TransitionMoment` shows a face-down card image and "Mystery card" | Reasonable. It happens in the corner of the HUD, not in the player's hands | |
| 15 | Play a development card | Modal, `Play` button, `dev-card-play` sound, `TransitionMoment` | Knight is the biggest swing in the game and its only feedback is a toast plus whatever the robber does next | 10 |
| 16 | Road Building free roads | Phase `road-building`, road ghosts appear without needing `placementMode`, a `Finish` button | You get two free roads and there is no counter anywhere on the board. `pendingRoads` exists in state and is never shown | 5 |
| 17 | Maritime trade | Harbour column in the trade modal, ratio picker, `trade-accept` sound on commit | Competent form. No connection to the harbour piers you actually own on the board | 10 |
| 18 | Offer a domestic trade | Steppers for give and ask, a partner radio group, a one-line summary, `notify` sound on send | The whole negotiation is a form. Nothing happens on the island | 10 |
| 19 | Respond to a trade | Locked modal, accept / decline / counter | Locked modal makes the board inert, so you cannot look at what you are trading for | 9, 10 |
| 20 | Roll a seven | `roll-seven` at `DICE_SETTLE`, the ambience bed swaps `amb-island` for `amb-tension` and stays there until a non-seven roll | The bed swap is the best idea in the audio system. Nothing visual marks the seven. The board looks identical | 3 |
| 21 | Discard half | Locked modal, five plus/minus steppers, a disabled `Discard n / N` button | Numeric, joyless, and the slowest interaction in the game. There is no "discard my worst" affordance, no click on a wallet card, no drag. The engine already computes a sensible `defaultDiscard` and the UI does not offer it. The board is inert behind the modal so you cannot check what the robber is about to take | 7 |
| 22 | Move the robber | `TerrainTile` draws a `ringGeometry` hex outline in `#ffd66a` at **0.38 opacity** on each of the 18 legal hexes, rising to 0.92 on hover. The robber figure itself gets nothing. A coach panel appears top-left. A `Move robber to suggested hex` button appears in the turn panel | The client is right and it is worse than he said. The 0.38-opacity yellow ring is the same hue and value as the sand hex borders that edge every tile on this island. In a full-resolution capture of a live `move-robber` phase I could not tell which hexes were legal. The robber has no aura, no lift, no highlight, and I could not find it on the board at all. There is no camera move, no dimming of illegal tiles, no drag. The only reliable path is the text button that plays the move for you | 3 |
| 23 | Choose a victim | Locked modal listing adjacent rivals with hand and dev-card counts | The decision is spatial and the UI is a list. The board, which shows exactly which of their settlements touch the hex, is inert behind the backdrop | 8, 9 |
| 24 | Being robbed | `TransitionMoment` with a `RobberIcon` and a ripple, a resource delta row, `robber-steal` sound | The only tell that a specific card left your hand is a `-1` in a corner list. Your wallet card does pulse via `useCountPulse`, which is good, but the two are not visually connected | 8 |
| 25 | Longest Road changes hands | `LongestRoadSweep` runs a light down the whole road network, `longest-road` sound at +0.5s, `award` camera recipe | Well built. Under `prefers-reduced-motion` it returns `null` and there is no static substitute at all | 12 |
| 26 | Largest Army changes hands | `LargestArmyMoment` concussion at the robber hex | Same, and it fires at the robber, which the player cannot find | 12 |
| 27 | End turn | Button click, `end-turn` is silent, `quiet` beat does nothing | See #7 | 2 |
| 28 | Insufficient resources | Build button is `disabled`, cost pips render `.short` instead of `.affordable` | Static and quiet. There is no moment where the game tells you what you are one card away from | 12 |
| 29 | Server rejects an action | `setError` renders `.toast` with `role="alert"`, 14px slide-in | No sound (`ui-error` exists and is unused), no shake, no board-side indication of what was refused. It shares its slot with connection status strings | 12 |
| 30 | Reconnecting | `hudError` shows "Reconnecting to the room…" in the same toast | The board stays fully interactive-looking while `interactive` is false, so targets vanish silently | 12 |
| 31 | Victory / defeat | `VictoryMoment` motes and shockwaves across the winner's holdings, `victory` recipe with a 9s hold, `music-victory`, summary screen | Strong | |

---

## 3. Ranked build list

Ranked by frequency multiplied by current badness, from the viewer's seat in a
three-player match of roughly 60 turns.

| # | Item | Hits per match | Current state | Why here |
| --- | --- | --- | --- | --- |
| 1 | **Legal-target legibility on the board** | Every board action, 30 to 60 | Invisible at rest zoom | Root cause behind 4, 5, 11, 12, 13, 16 and 22. Nothing else in this list works until it is fixed |
| 2 | **Turn handoff** | ~60 | Text label only | Highest frequency event in the game, zero feedback |
| 3 | **The robber on a seven** | ~10, ~3 as actor | Worst single interaction in the game | Client's named complaint, and the ranking supports him |
| 4 | **The pending-then-confirm commit** | Every board action | Confirm bar refers to an invisible target, no camera move | Doubles the cost of every placement and lies about what is on screen |
| 5 | **Build arming and road building** | 15 to 25 | Button state only, no board-side arming, no free-road counter | Client's named item, and the second-most-used verb |
| 6 | **Settlement to city** | 3 to 4 | Good commit, undiscoverable setup | Client's named item. The upgrade never visibly replaces anything |
| 7 | **Discard on seven** | 3 to 6 | Five numeric steppers behind an inert backdrop | Slowest and least pleasant screen in the game |
| 8 | **Choose a victim and the steal** | 3 to 8 | Spatial decision presented as a list | The payoff of the whole robber sequence, and it happens in a dialog |
| 9 | **Locked modals freeze the board** | 10 to 20 | `Modal` sets every sibling `inert` | A one-line-per-call fix that unblocks 7, 8 and 10 |
| 10 | **Trading** | 5 to 15 | Two forms, no island | Client's named item. Currently the least "3D game" part of a 3D game |
| 11 | **Spectating a rival's move** | ~120 | A drifting camera and a toast | Two thirds of the match is watching somebody else |
| 12 | **Rejection, errors, and the silent UI bank** | Constant | Eight unused sounds, one shared toast | Nearly free, and it is what makes an interface feel answered |

---

## 4. Specifications

Each spec gives: trigger, stages, affordance, confirmation, abandonment, reduced motion,
keyboard, touch, and the systems to reuse.

Two conventions apply to all of them.

**Optimism budget.** The server is authoritative. Nothing may write game state locally.
Everything specified below is presentation-only and lives in local React state that is
cleared on `game.revision` change, exactly as `pendingAction` is today. When
`submit()` returns and `submitting` is true, hold the last affordance state visibly
frozen rather than clearing it, so a rejected action snaps back to a state the player
recognises rather than to an empty board. Today `interactive` goes false the instant you
submit and every marker on the board blinks out for a round trip. That is the rollback
bug to fix, not a new one to add.

**Determinism.** No `Math.random()` at render. Every seeded value comes from
`seededFrom(id)` or `makeRng(hashString(id))` in `src/scene/structures/textures.ts`,
where `id` is a board id plus the presentation revision.

---

### Item 1. Legal-target legibility

**Problem.** `VertexTargets` and `TerrainTile` render at contrast levels that lose to the
island's own sand-and-cream palette. Measured against a live capture: vertex pennants are
`#ffffff` with `emissive #ffc846` at 0.55, roughly 8 screen pixels at rest framing; robber
hex rings are `#ffd66a` at 0.38 opacity against hex borders that are already warm sand.

**Trigger.** Any time `game.legalActions` contains board actions and `interactive` is true.

**Stages.**

1. *Available.* Every legal target carries a **pulsing ground beacon**, not a static
   marker. One shared `InstancedMesh` per target family, animated from the shared clock:
   radius oscillating `0.26 → 0.34` and opacity `0.35 → 0.72` on a 1.6s cycle with a
   per-target phase offset from `seededFrom(targetId)`, so the set shimmers rather than
   blinking in unison. Colour is the **acting player's colour** from
   `PLAYER_COLORS`, not a generic gold, so "these are yours to take" is stated in the
   same language the pieces use.
2. *Contrast floor.* Add a dark contact-shadow disc underneath each beacon
   (`#0b0f14`, opacity 0.35, radius 1.15x the beacon). A warm additive glow on warm
   terrain has nothing to sit against. The dark disc is what makes it legible, and it
   costs one more instanced mesh.
3. *Vertical mark.* Raise the stake and pennant so the silhouette breaks the terrain
   props. Terrain scatter in `scatter.ts` puts trees and rocks well above the turf line;
   the current 0.24-tall stake loses to them. Take it to at least 0.42 and make the
   pennant the player's colour with a white outline.
4. *Hover / focus.* Scale 1.25, opacity 1.0, contact shadow to 0.5, and `ui-hover` at
   -12dB. Cursor already handled by `useCursor`.
5. *Density relief.* When the count exceeds 20, which happens on both setup placements
   (50 and 39 observed), rank by the same `settlementValue` heuristic already written in
   `src/game/simulationPolicy.ts` and render the top 8 at full strength and the rest at
   0.45. The player still sees all legal options; the board stops looking like a minefield.
   Do not hide any target. This is emphasis, not filtering.

**Affordance.** The beacon plus the contact shadow. No coach text required.

**Confirmation.** Item 4.

**Abandonment.** Beacons clear whenever `legalActions` no longer contains that family.

**Reduced motion.** No pulse. Beacons render at their bright end statically, contact
shadow at 0.5. The density-relief split stays, because it is not motion.

**Keyboard.** See Principle P5.

**Touch.** Below 520px the existing `touchTarget` prop already grows the invisible hit
cylinder. Grow the *visible* beacon by the same 1.55x. Right now the hit area and the
thing the player is aiming at are different sizes, which is worse than either being small.

**Systems.** `haloTexture()`, `PLAYER_COLORS`, `seededFrom`, the shared `scaled()` clock
in `spring.ts`.

**Files.** `src/scene/Pieces.tsx` (`VertexTargets`, `Road`), `src/scene/Island.tsx`
(`TerrainTile`), `src/scene/structures/Road.tsx` (`RoadGhost`).

---

### Item 2. Turn handoff

**Problem.** The most frequent event in the match is a text change in a corner panel.
`end-turn` is deliberately silent and maps to the `quiet` beat, which `CameraRig` treats
as "do nothing".

**Trigger.** `currentActorId(game)` changes.

**Stages, when the turn becomes yours.**

1. *t=0.* A new `turn` beat on the beat channel. Camera recipe: a short lift and settle
   back to resting framing, `{ distance: 1.06, polar: -0.02, azimuth: 0, fov: 0, follow: 0,
   hold: 1.2, frequency: 0.75, ratio: 0.9, anticipate: { distance: 1.12, duration: 0.18,
   kick: 2.2 } }`. It should read as the board turning to face you, not as a cut.
2. *t=0.* `turn-start` sound, which already exists and is already wired for the
   fall-through case. Play it explicitly on the handoff instead of as a default.
3. *t=0 to 0.5.* A sweep of the player's colour across the board floor: one `Shockwave`
   from board centre, `radius 7.4`, `life 0.9`, `thickness 0.015`, in `PLAYER_COLORS[you]`.
   Wide, thin, fast. It frames the whole island for one beat and then is gone.
4. *t=0.1.* The `TurnPanel` crest scales from 0.9 to 1.0 with a colour-matched glow, and
   the `PlayerRail` row slides 6px and holds a left border in the player's colour.
5. *t=0.* `aria-live="polite"` on the turn panel already exists. Make the announced string
   explicit: "Your turn. Roll the dice." Today it announces a fragment.

**When the turn passes to a rival**, do the same at one third the amplitude, in the
rival's colour, with no camera beat and no sound above -18dB. The point is that the
handoff always has a shape; whose turn it is changes the volume, not the existence.

**Affordance.** The Roll button gains a slow breathing outline while `phase === 'pre-roll'`
and it is your turn, and stops the instant you press it.

**Confirmation.** The dice sequence already handles it.

**Abandonment.** Not applicable.

**Reduced motion.** No camera beat, no shockwave. Instead the `PlayerRail` active row and
the `TurnPanel` swap to a solid filled treatment in the player's colour, an instant
change rather than a transition, plus the sound at full level. Sound is not motion and
must not be suppressed here.

**Keyboard.** On handoff, move focus to the turn panel, which already has `tabIndex={-1}`
and an existing `panelRef.current?.focus()` that currently only runs on mount. Run it on
every handoff to you.

**Files.** `src/scene/motion/beats.ts` (add `turn` to `BeatKind`), `src/scene/CameraRig.tsx`
(recipe), `src/scene/ActionEffects.tsx` (emit and render the sweep),
`src/audio/useGameAudio.ts` (remove `end-turn` from `SILENT`, add an explicit handoff
effect keyed on actor id), `src/ui/Hud.tsx` (`TurnPanel`, `PlayerRail`), `src/styles.css`.

---

### Item 3. The robber

The client asked for an aura, a halo, and a drag. He is right about all three. Below is
the case for drag, then the spec.

#### Is drag actually better here?

Yes, and the robber is the only board action in the game where that is true.

Every other placement creates a new piece out of an off-board supply. There is nothing on
screen to grab, so a drag would be a fiction, an invented handle attached to a button.
The robber is different in three ways:

1. **It already exists on the board as a physical object.** Direct manipulation only means
   anything when the thing being manipulated is visible. This is the one case where it is.
2. **The source matters as much as the destination.** Moving the robber is always taking
   it off somebody, usually off yourself. A click on a destination hex answers "where to"
   and never draws the player's attention to where it is leaving. A drag makes departure
   and arrival one continuous gesture, which is the actual mental model of the move.
3. **It solves discoverability for free.** A hooded figure that lifts and glows under the
   cursor tells you what to do without a coach panel. Today the game needs a text panel
   *and* a "do it for me" button precisely because nothing on the board says anything.

But drag must not be the only path, and this is where the client's request has to be built
larger than he stated it. Specify **one state machine with three entry points**:
pointer-drag, tap-arm-then-tap-target, and keyboard. They share the same armed state, the
same highlight set, the same invalid handling and the same commit. Building drag as a
special case is how you end up with an affordance that works on the designer's laptop and
nowhere else.

#### Spec

**Trigger.** `game.phase === 'move-robber'` and `currentActorId(game) === viewerPlayerId`.
Note this is a *phase entry*, not a presentation event, so it needs the new prompt channel
in Principle P1. Nothing today can fire on it.

**Stage A, the call, t=0 to 0.8.**

- Camera: a new `robber-prompt` recipe that frames the robber's **current** hex, not the
  destination. `{ distance: 0.9, polar: 0.08, azimuth: -0.1, fov: 0, follow: 0.7,
  hold: 2.2, frequency: 0.7, ratio: 0.8 }`. `follow: 0.7` because the player needs to be
  told where the piece is before being asked to move it. This is the fix for "I could not
  find the robber", which is a literal finding from the live capture.
- The robber gains the aura: a `Flare` at the figure's head height,
  `color '#c8442f'`, `size 1.1`, held rather than decaying, plus a ground halo disc using
  `haloTexture()` at radius 0.42 in the same red, pulsing 0.45 to 0.85 on a 1.4s cycle.
- The robber gains a **lift**: `position.y` springs +0.09 and holds, with a slow 4-degree
  yaw sway. It should look like the piece is standing up, not vibrating.
- The tense ambience bed is already up from `roll-seven`. Add one `robber-move` sound at
  -6dB as the aura ignites, so the call has an onset.
- All 18 legal hexes get the Item 1 beacon treatment in **red**, not gold: hex-ring
  `ringGeometry(0.84, 0.99, 6, 1, PI/6)` at `#e0664a`, opacity 0.55, plus a dark contact
  ring beneath at 0.3. The current 0.38-opacity gold is invisible against sand.
- Every hex that is **not** legal, which is only the robber's current hex, gets nothing.
  Do not dim the board. Dimming 1 of 19 tiles is noise.

**Stage B, armed.** Entered by pointerdown on the robber past a 6px slop threshold, by a
tap on the robber, or by pressing Enter on the robber's keyboard handle.

- The robber lifts to +0.35 and tilts 8 degrees, casting a hard contact shadow directly
  beneath its resting point so the player can read where it currently is.
- Legal hex beacons brighten to 0.85 and begin pulsing in unison, 0.9s cycle. Unison here
  is correct: they are one set of answers to one question, unlike Item 1 where the phase
  offset stops fifty markers strobing.
- A small red trail of `Motes`, `count 6`, `spread 0.1`, `rise 0.4`, `life 0.6`, follows
  the figure. Under reduced motion this is omitted entirely.
- The hovered or nearest legal hex is the **candidate**: its beacon goes to 1.0 and a
  ring of the acting player's colour appears around each rival building on that hex,
  previewing who you would be able to steal from. That preview is the single most useful
  thing you can add to this interaction and it costs one instanced ring.
- Camera: nothing. Do not move the camera while the player's hand is on the piece.
  `CameraRig` already yields entirely while `userUntil` is in the future; extend the same
  courtesy by setting `userUntil.current = Infinity` for the duration of the drag.

**Stage C, drop.**

- Valid drop: `usePlacementDrop` is the wrong tool here since the robber does not fall
  from height. Instead spring the figure to the target over 260ms with a small arc
  (`y` peaking at +0.22), then `emitShake(0.1)` on contact, then the existing
  `RobberMoment` shroud, shockwave and ink burst from `ActionEffects.tsx`.
  `robber-move` plays at full level on contact, not on submit.
- The move is submitted on drop. **Do not route the robber through `pendingAction`.**
  The drag *is* the confirmation. The two-step confirm bar on top of a drag is the exact
  interaction the client called unintuitive. See Item 4 for the general rule.
- Optimistic: hold the figure at the dropped position with the aura still lit and the
  beacons cleared while `submitting` is true. If the server rejects, spring it back to
  the origin over 220ms, play `ui-error`, and re-light the beacons. This is the rollback
  path and it must exist because the drag has already visually committed.

**Invalid drop.** Releasing over the current hex, over water, over the HUD, or over any
non-hex geometry returns the figure to origin over 220ms with `ui-error` at -10dB and a
single 0.15-amplitude horizontal shake. No modal, no toast. The board already said no
by not lighting up.

**Abandonment.** Escape, or a pointer release outside the canvas, returns to Stage A with
the aura still lit. The player is still in `move-robber`; the engine gives them no other
legal action, so there is nowhere to abandon *to*. The aura must not extinguish until the
phase ends. Today the coach panel is the only persistent signal and it lives in a corner.

**Reduced motion.** This is the case that needs the most care, because the motion agent
verified `prefers-reduced-motion` freezes these systems completely.

- Drag itself **stays enabled**. A drag is a user-driven position, not an animation.
  Suppressing it would be a functional regression dressed as an accessibility feature.
- No lift, no sway, no arc, no trail, no camera move, no shockwave, no ink burst.
- The aura becomes a static high-contrast ring: a solid `#e0664a` annulus at 0.9 opacity
  around the robber's plinth with a 2px dark outline, plus a static red hex outline at
  0.9 on every legal hex.
- Armed state is a colour change, not a lift: the robber's cloth material tints 20 percent
  toward the aura red.
- The drop is an instant position swap. `robber-move` still plays, attenuated by the
  bank's existing `REDUCED_MOTION_TRIM`.
- **Fix the existing leak while you are here.** `Shockwave`, `TilePulses` and the
  `RobberMoment` shroud all take a `reducedMotion` branch that sets `visible = true` at a
  fixed opacity and then never hides. Under reduced motion the board accumulates
  permanent static rings that only clear when the component unmounts on the next
  presentation. They should render once and fade out on a timer-free basis, or not render
  at all.

**Keyboard.** Two paths, both required.

- The robber figure gets a focusable proxy in the existing `.board-targets` group,
  labelled "Robber, currently on ore 8 at the north-west. Press Enter to pick up." Enter
  arms it. Once armed, the 18 target buttons in the same group are re-labelled
  "Move robber to forest 5 at the east" and Enter on one commits directly, no confirm bar.
- Arrow keys cycle the armed candidate and the 3D highlight follows focus, per Principle
  P5. This is what turns the sr-only list from a screen-reader accommodation into a real
  keyboard control scheme.
- The existing `Move robber to suggested hex` button in `TurnPanel` stays. It is a
  reasonable escape hatch. It should stop being the only usable path.

**Touch, and the pan conflict.** This is the real engineering question.

- Attach `onPointerDown` to the robber mesh and call `event.stopPropagation()` plus
  `event.target.setPointerCapture(event.pointerId)`. `MapControls` listens on the canvas,
  so a captured pointer that started on the robber never reaches it.
- Additionally set `controls.enabled = false` for the duration. Get the controls instance
  with `useThree((state) => state.controls)`; `CameraRig` already renders `MapControls`
  with `makeDefault`, so it is available. Restore on pointerup, including on
  `pointercancel`, which iOS fires on a system gesture.
- The 6px slop threshold means a tap on the robber is a tap, which enters the same armed
  state and lets the player then tap a hex. On a phone, tap-tap will be the dominant path
  and drag will be the delightful one. Both must work.
- Below 520px, grow the robber's invisible hit sphere to 1.8x the figure and grow the hex
  target rings with it, using the same `touchTarget` prop the rest of the scene uses.
  At 390px wide the whole island is about 330px across and a hex is roughly 55px, which is
  workable for tap targets and marginal for precise drags. That is another reason
  tap-tap has to be first-class.

**Files.** `src/scene/structures/Robber.tsx`, `src/scene/Island.tsx`,
`src/scene/motion/prompts.ts` (new, see P1), `src/scene/CameraRig.tsx`,
`src/scene/ActionEffects.tsx`, `src/App.tsx`, `src/ui/Hud.tsx`, `src/audio/useGameAudio.ts`.

---

### Item 4. The pending-then-confirm commit

**Problem.** `App.tsx` routes all six `boardActionTypes` through `pendingAction`, so every
board action is two steps. The confirm bar's copy says "Confirm the glowing corner or
choose another" while the corner in question is 8 pixels of pale cream, and the camera
never moves to it. Live-captured: I clicked a target, read the bar, and could not find
what it was describing.

**The rule to adopt.** *Confirm only what cannot be undone by a second click.*

- `move-robber`: no confirm. The drag is the commitment. Committed on drop.
- `build-city`: no confirm. You are clicking a specific settlement you own; the target
  is unambiguous and the cost is shown on the button that armed the mode.
- `place-settlement`, `place-road` in setup: **keep confirm**. These are the two highest
  consequence decisions in the match and they are irreversible.
- `build-settlement`, `build-road`: no confirm, but require the mode to be armed first,
  which it already is via `placementMode`. Arming is the confirmation step.

That removes the bar from roughly three quarters of board actions.

**Where it survives, fix it.**

1. On `pendingAction` being set, emit a `place` beat with the target's board coordinates,
   which `CameraRig` already knows how to follow at `follow: 0.56`. **The camera must
   travel to the thing the bar is asking about, before the bar renders.** Delay the bar's
   entrance by 220ms so the framing lands first.
2. The pending target renders at 2x the resting beacon scale with a rotating outer ring in
   the acting player's colour, and every other beacon drops to 0.2. Right now the pending
   target is barely distinguishable from its neighbours.
3. Reposition the bar so it never occludes the pending point. If the target's projected
   screen position is in the lower third, put the bar top-center. This is a projection
   check, not a heuristic; `camera.project()` on the target vector gives it.
4. Sound: `ui-click-soft` when the target is picked, `ui-click-deep` on confirm,
   `ui-close` on cancel. All three exist and are unused.
5. Copy: replace "Confirm the glowing corner" with the actual place name, which
   `describeBoardAction` in `App.tsx` already computes. "Found a settlement beside ore 10
   and grain 11?" is a sentence the player can verify.

**Abandonment.** Cancel returns to the armed state with all beacons restored, not to
nothing. Today `onCancelAction` clears `pendingAction` but the effect on
`[game?.phase, viewerMustAct]` may also have cleared `placementMode`, so a cancel can
disarm the build mode you were in. Preserve `placementMode` across cancel.

**Reduced motion.** No camera travel and no rotating ring. Instead the pending target gets
a solid colour swap plus a static 2px outline, and the confirm bar renders immediately
with no entrance transition. The occlusion check still applies.

**Keyboard.** Already reasonable: `autoFocus` on Confirm, and an unmount effect that
returns focus. The bug is that it returns focus to `.board-targets button` (the first
one) rather than the target the player was on. Store the target id and restore focus to
the matching button.

**Files.** `src/App.tsx` (`boardActionTypes`, `act`, `confirmPendingAction`),
`src/ui/Hud.tsx` (`ActionPreview`, `actionPreviewCopy`), `src/scene/Pieces.tsx`,
`src/scene/GameScene.tsx`, `src/styles.css`.

---

### Item 5. Build arming and road building

**Trigger.** A `BUILD_COMMANDS` button is pressed, or `phase === 'road-building'`.

**Stages.**

1. *Arm.* `ui-click` at -6dB. The pressed button fills with the player's colour rather
   than gaining a border. Every other build button drops to 0.5 opacity. The tray reads
   as a mode switch, which is what it is.
2. *Board response, t=0 to 0.35.* The legal targets for that family do not just appear;
   they **arrive**, staggered by distance from board centre, 12ms apart, each scaling
   0 to 1 with a small overshoot. Fifty markers appearing on one frame is a pop; fifty
   markers arriving over 400ms is the board answering you. Reuse the phase-offset pattern
   already in `LongestRoadSweep`.
3. *Cost preview.* On hover of an armed build button, the exact wallet cards that will be
   spent lift 4px and gain the player's colour outline in `ResourceWallet`. There is a
   `CostPips` component today that dims what you cannot afford; this is the same
   information pointed at the cards themselves.
4. *Disarm.* Pressing the same button again, pressing Escape, or committing a placement
   all clear the mode. Targets leave in reverse stagger. `ui-close` at -10dB.

**Road building specifically.** `state.pendingRoads` is tracked by the engine and shown
nowhere. Render two chips beside the `Finish` button, filled then unfilled, and dim one
as each free road lands. Each free road placement plays `place-road` alternating with
`place-road-alt`, which `placementSound()` already does by revision parity.

**Confirmation.** Per Item 4: build placements commit on click because arming was the
confirmation.

**Abandonment.** Escape disarms. Leaving the phase disarms. Neither should clear an
in-flight `submitting` state.

**Reduced motion.** No stagger, no overshoot, no lift on the wallet cards. Targets appear
at full strength instantly, the wallet cards get a static outline, and the button fill is
an instant swap.

**Keyboard.** Arming already works via the tray buttons. Once armed, focus should move
into `.board-targets` automatically so Tab does not have to walk the whole HUD first.

**Touch.** The tray is already a 44px-min control row. No change.

**Files.** `src/ui/Hud.tsx` (`ActionTray`, `ResourceWallet`, `CostPips`),
`src/scene/Pieces.tsx`, `src/scene/GameScene.tsx`, `src/audio/useGameAudio.ts`,
`src/styles.css`.

---

### Item 6. Settlement to city

**Problem.** The commit is one of the best moments in the game and nothing leads you to
it. The upgrade also never visibly replaces anything, which is the whole point of the move.

**Trigger.** `placementMode === 'city'`.

**Stages.**

1. *Arm.* Only your own settlements light. Each gets the Item 1 beacon plus a vertical
   column of light rising 0.6 units, tinted in your colour. Three or four columns on a
   board of nineteen hexes is unmistakable, and it is the one build mode where the small
   candidate set makes a big affordance affordable.
2. *Hover.* A ghosted `CityModel` fades in at 0.35 opacity **over** the settlement, at the
   final city yaw and scale. The player sees the trade before making it. This is the
   single change that makes the upgrade legible.
3. *Commit.* The settlement scales down and sinks 0.25 units over 180ms while the city's
   `usePlacementDrop` anticipation is already running, so the two overlap. The existing
   heavy `PlacementImpact`, `emitShake(0.16)` and `city` camera recipe all stay.
   `place-city` at `CONTACT`, unchanged.
4. *Score.* The `PlayerRail` victory-point number ticks by one with a 200ms count-up and
   a colour flash. Today it changes silently.

**Abandonment.** Disarm clears the columns and the ghost.

**Reduced motion.** No columns, no ghost fade, no sink. The hover state instead swaps the
settlement mesh for the city mesh at 0.5 opacity as a static preview, and the commit is
an instant swap. The score ticks instantly.

**Keyboard.** City targets are already in `.board-targets`. Their labels should say
"Upgrade your settlement beside ore 10 to a city", not "build city beside ore 10".

**Files.** `src/scene/Pieces.tsx` (`Building`), `src/scene/structures/Buildings.tsx`,
`src/ui/Hud.tsx` (`PlayerRail`), `src/scene/motion/placement.ts`.

---

### Item 7. Discard on seven

**Problem.** Five numeric steppers behind a locked backdrop, with a disabled button that
reads `Discard 0 / 4`. It is the slowest screen in the game and it is the one that fires
when the player is already being punished.

**Trigger.** `phase === 'discard'` and you are in `discardQueue`.

**Redesign.** Discard is a selection from your own hand, and your hand is already drawn
as six cards along the bottom of the screen in `ResourceWallet`. Use them.

**Stages.**

1. The wallet lifts to the vertical centre and expands so each held card is a separate
   token rather than a stack with a count. Ten cards, ten tokens.
2. Clicking or tapping a token flips it face-down and slides it into a discard tray. A
   counter reads `4 of 4`. Clicking a discarded token returns it. `ui-click-soft` on
   select, `ui-click` on return.
3. A `Discard my worst` button, wired to the engine's existing `defaultDiscard` output,
   which is already what `legalActionsForPlayer` returns for this phase. One click, done.
   This is a rules-legal shortcut the engine already computes and the UI already ignores.
4. Commit: the four tokens fly off the bottom of the frame, `card-draw` reversed or a new
   discard sound, and the wallet returns to its resting position with the new counts.
5. The board is **not** covered. See Item 9. During discard the player should be able to
   look at which of their tiles the robber threatens.

**Abandonment.** None. The phase is mandatory. But the selection must survive a
`game.revision` bump caused by another player's discard, which today it does not:
`useEffect(() => setChosen(emptyResources()), [game.revision])` in `DiscardDialog` wipes
the player's in-progress selection every time anyone else in the queue discards. That is
a live bug and it is why the discard state in my capture kept resetting to zero. Key the
reset on `discardRemaining[humanId]` instead.

**Reduced motion.** No lift, no flight, no flip. Tokens get a static struck-through
treatment and a border colour change. The commit is instant.

**Keyboard.** Tokens are buttons in a `role="group"`. Arrow keys move between them,
Space toggles, Enter on the primary commits.

**Touch.** Tokens are already at least 56px in the current wallet layout at 390px. Fine.

**Files.** `src/ui/Dialogs.tsx` (`DiscardDialog`, `TradeBundle`), `src/ui/Hud.tsx`
(`ResourceWallet`), `src/styles.css`, `src/audio/useGameAudio.ts`.

---

### Item 8. Choose a victim and the steal

**Problem.** A spatial decision presented as a list, behind a backdrop that makes the
board inert, so you cannot see which of their buildings touch the hex.

**Trigger.** `phase === 'choose-victim'`.

**Stages.**

1. Camera holds the `robber` framing from the move. It already follows the hex.
2. Each candidate rival's building on that hex gets its kerb ring pulsing in the rival's
   colour, a vertical light column, and a floating crest above it showing their name and
   hand count. `Footing` already renders a `kerbRingMaterial` in the owner's colour; drive
   its emissive.
3. Clicking the building or the crest steals. No confirm bar.
4. The existing `ChoiceDialog` list stays, but as a **non-locked** card anchored
   bottom-center rather than a full-backdrop modal, so both paths are live at once.
5. On commit: a mote trail runs from the victim's building to your wallet, arriving on the
   specific resource card that changed, which then fires the existing `useCountPulse`
   `gained` state. `robber-steal` at +0.12s, unchanged. **The card that arrives is the one
   the player wanted to know about**, and today the trail stops at the settlement.
6. For the victim: the same trail runs *out* of their wallet card, and their card fires
   the `spent` pulse. Currently the only signal is a `-1` in a toast list.

**Abandonment.** None; the phase is mandatory.

**Reduced motion.** No columns, no pulse, no trail. Rival buildings get a static bright
outline in their colour; the wallet card change is instant with a 400ms static highlight
that then clears.

**Keyboard.** The dialog's buttons already work. Add the same arrow-key cycling with 3D
highlight-follows-focus as everywhere else.

**Files.** `src/ui/Dialogs.tsx` (`ChoiceDialog`), `src/scene/Pieces.tsx` (`Footing`,
`Building`), `src/scene/ActionEffects.tsx`, `src/ui/Hud.tsx` (`ResourceWallet`).

---

### Item 9. Locked modals freeze the board

**Problem.** `Modal` in `src/ui/Dialogs.tsx` sets `element.inert = true` on every sibling
of the backdrop. Those siblings include the canvas wrapper and the entire HUD. So during
`discard`, `choose-victim`, `year-of-plenty`, `monopoly`, `trade-response` and `game-over`
the board cannot be panned, zoomed, hovered or read. Every one of those decisions is
about the board.

**Fix.** Split the two concerns the `locked` flag currently conflates.

- `locked` should mean "you cannot dismiss this", which is correct and should stay.
- Inerting siblings should become a separate `blocking` prop, true only for `game-over`.
- For the five in-play phases, render the dialog as a bottom-anchored card with no
  backdrop, no sibling inerting, and `role="dialog"` without `aria-modal`. Keep the focus
  trap on Tab so keyboard users are not stranded, but leave the canvas hoverable and
  pannable.
- Position the card so it never covers the board region the decision is about. For
  `choose-victim` that is the robber hex; project it and flip the card to the opposite
  half of the screen.

**Reduced motion.** No entrance transition. Card appears.

**Files.** `src/ui/Dialogs.tsx` (`Modal` and all six call sites), `src/styles.css`.

---

### Item 10. Trading

**Problem.** Trading is the most social action in the game and it happens entirely inside
two HTML forms. Nothing occurs on the island. The `trade` camera recipe exists, is well
designed (a considered three-quarter, "the table-talk angle"), and only ever fires *after*
a trade resolves.

**Spec, in order of value per unit of work.**

1. **Fire the `trade` recipe when the trade dialog opens**, not after it closes. The
   camera settling into the table-talk angle while you compose an offer is most of the
   feeling, and the recipe is already written. This needs the prompt channel from P1.
2. **Harbour trades acknowledge the harbour.** `maritime-trade` carries a ratio; the
   player owns specific harbours rendered as piers in `Harbor.tsx`. On selecting a 2:1 or
   3:1 rate, light the pier that grants it and run the goods along it on commit. That is
   the difference between a currency exchange and a port.
3. **Offers land on the recipient's crest.** When you send an offer, a token flies from
   your wallet to the target player's `PlayerRail` row, which then holds a pulsing border
   until they answer. Today `notify` plays and nothing moves.
4. **Response arrives the same way.** Accept runs both bundles across the board between
   the two players' nearest settlements. Decline drops the token. `trade-accept` already
   exists for the first case; the second needs `ui-close`.
5. **Counteroffers** currently sit at the bottom of a locked modal below the accept and
   decline buttons and are easy to miss entirely. Promote counter to a peer of accept and
   decline, three buttons in a row.

**Reduced motion.** No camera recipe, no flying tokens. The recipient's rail row gets a
static border and a text status. The pier lights statically.

**Keyboard.** The trade forms are already well built: labelled steppers, a radio group for
partner, a live summary with an `aria-label` that reads the whole offer. Leave them alone.

**Files.** `src/ui/Dialogs.tsx` (`TradeDialog`, `TradeResponseDialog`),
`src/scene/structures/Harbor.tsx`, `src/scene/ActionEffects.tsx`,
`src/scene/motion/prompts.ts`, `src/ui/Hud.tsx` (`PlayerRail`).

---

### Item 11. Spectating a rival's move

**Problem.** Roughly two thirds of a three-player match is spent watching. The current
feedback is a camera that drifts toward a point for reasons the player does not know, plus
a 1800ms toast in the bottom centre. `AgentDecisionPreview` shows a spinner and
"Choosing a move", which is honest but tells you nothing about what is coming.

**Spec.**

1. **Attribute the camera move.** Before the camera travels to a rival's action, show a
   200ms lower-third strip in the rival's colour reading their name and the verb, then
   travel. An unexplained camera move is disorienting; a captioned one is a cut in a film.
2. **Colour the effect.** `ActionMoment` already picks `actorColor` from the event's
   `playerId`. Make sure every effect actually uses it: the placement shockwave does, but
   the dust, chips and flare are hard-coded warm neutrals. A rival's road going down
   should be visibly theirs.
3. **Announce it.** `TransitionMoment` has `role="status"` but its content is a heading
   plus a message plus award changes, which a screen reader reads as a fragment stream.
   Give it one composed sentence.
4. **Waiting for an agent** should be ambient, not a spinner. While `thinkingPlayerId` is
   set, put a slow breathing glow on that player's rail row and a faint colour wash on
   their holdings on the board. It answers "who am I waiting for" spatially.
5. **Rival sevens.** When a rival rolls a seven and you are not discarding, you currently
   get nothing except the ambience swap. You should get the robber's aura lighting on
   *their* screen and, on yours, the threatened tiles you own briefly outlined in your
   colour so you know what you are about to lose.

**Reduced motion.** No lower third animation, no breathing glow, no wash. Static caption,
static rail-row fill.

**Files.** `src/scene/ActionEffects.tsx`, `src/ui/Hud.tsx` (`TransitionMoment`,
`AgentDecisionPreview`, `PlayerRail`), `src/scene/CameraRig.tsx`.

---

### Item 12. Rejection, errors and the silent UI bank

**Problem.** Eight sounds ship and none of them play. The 2D layer is entirely silent on
input. A server rejection renders as a 14px slide-in toast that shares its slot with
connection status strings, has no sound, and gives no board-side indication of what was
refused.

**Spec.**

1. **Wire the bank.** A small `useUiSound()` hook in `src/audio/`, consumed by `Hud.tsx`
   and `Dialogs.tsx`:
   - `ui-hover` at -18dB on pointerenter of any tray or utility button, rate-limited to
     one per 120ms so a sweep across the tray is a brush, not a burst.
   - `ui-click` on any primary button, `ui-click-soft` on secondary and steppers,
     `ui-click-deep` on commit-class buttons (Confirm, Roll, End, Accept).
   - `ui-open` and `ui-close` on every dialog mount and unmount.
   - `ui-error` on the error toast and on every invalid drop.
2. **Say no in place.** A rejected action should shake the control that caused it, or the
   board target that was refused, and light it red for 400ms. The toast becomes the
   explanation, not the only signal.
3. **Separate the channels.** Connection state is not an error. Give reconnection its own
   persistent status pill with a colour, not the alert toast. Today
   `hudError` folds `error` and `connectionState` into one string.
4. **Explain disappearing affordances.** When `interactive` goes false because
   `submitting` is true or the socket is reconnecting, hold the beacons visible at 0.4
   with a "sending" treatment rather than removing them. Right now the board silently
   empties and the player assumes their click failed.
5. **Insufficient resources.** A disabled build button that is one card short should say
   so on hover: "One more brick." `CostPips` already knows which resource is short.
6. **`amb-forest` is loaded and never used.** Either bed it under `play` alongside
   `amb-island`, or delete it from the manifest. It is currently paid for and unheard.

**Reduced motion.** All of the above is sound and static state, so it survives unchanged.
The bank already applies `REDUCED_MOTION_TRIM` to `startle` sounds.

**Files.** `src/audio/useGameAudio.ts`, a new `src/audio/useUiSound.ts`, `src/ui/Hud.tsx`,
`src/ui/Dialogs.tsx`, `src/ui/Journey.tsx`, `src/styles.css`.

---

## 5. Cross-cutting principles

These are the rules the game's interactions should follow. Right now the answer to each
of these questions is different in different places, which is the real reason the client
said the robber felt unintuitive: there is no grammar to learn.

**P1. There are two channels, not one. Build the second.**

`beats.ts` reports the past. Add `src/scene/motion/prompts.ts` with the same one-way
listener pattern for the present:

```
type Prompt = {
  kind: 'place' | 'robber' | 'discard' | 'victim' | 'trade' | 'roll' | 'none'
  /** Board point the decision is about, when there is one. */
  at?: [number, number]
  /** Board ids the player can act on, for highlight-follows-focus. */
  targets?: string[]
  /** The phase revision that produced it, so listeners dedupe. */
  revision: number
}
```

Emitted from `App.tsx` on `(game.phase, currentActorId, placementMode)` change. Consumed
by `CameraRig` for framing, by a new `AffordanceEffects` sibling to `ActionEffects` for
the in-world highlights, and by `useGameAudio` for onset sounds. Without this, no
affordance in this document can fire at the moment it becomes true, and every fix
degenerates into another HUD panel.

**P2. "You can act" is stated in the world, in your colour, with a dark contact shadow.**

Not with a text label, not only in the corner panel. Every actionable thing on the board
carries a beacon in the acting player's colour with a dark disc beneath it. The dark disc
is not decoration: this island is warm sand and warm gold everywhere, and an additive
glow with nothing to sit against disappears. That is the mechanical reason the current
markers fail.

**P3. Preview shows the result, not a label describing it.**

A ghosted city over the settlement. A red ring on the rival buildings you could steal
from. The wallet cards that are about to be spent, lifting. The player should be able to
see the future state at 0.35 opacity before committing, and never have to read a sentence
that names a thing they cannot find. The current confirm bar violates this literally.

**P4. Confirm only what cannot be undone by a second click.**

Setup placements: confirm. Everything else: arm, then commit on click, or drag and commit
on drop. Where a confirm survives, the camera must arrive at the subject before the bar
does, and the bar must never occlude it.

**P5. Every board interaction has the same three entry points, sharing one state machine.**

Pointer, touch, keyboard. Not three implementations. Concretely, for keyboard: the
existing `.board-targets` sr-only list is a good screen-reader accommodation and a poor
keyboard control scheme. Fifty buttons in a flat list described as "option 30 of 50" with
no spatial model. Upgrade it: one roving-tabindex group, arrow keys move the selection,
and **the 3D highlight follows focus** exactly as it follows hover. That single change
makes the board keyboard-operable rather than merely keyboard-reachable, and it is what
makes a drag-first robber acceptable.

**P6. Reduced motion removes motion, never capability and never sound.**

Drag still works. Selection still works. Sound still plays, attenuated by the bank's
existing trim. What goes away is travel, springs, particles, camera moves and pulses,
each replaced by a static high-contrast state, not by nothing. And fix the current leak:
`Shockwave`, `TilePulses` and the robber shroud currently render *permanently* under
reduced motion instead of not rendering, so the board accumulates frozen rings.

**P7. Optimistic feedback is a held state, not a written one.**

Never mutate game state locally. While `submitting` is true, freeze the last affordance
state at reduced strength instead of clearing it, so a rejection snaps back to something
the player recognises. Today `interactive` flips false on submit and every marker vanishes
for a round trip, which reads as a failure even when the action succeeds.

**P8. Spectating is a first-class state.**

Two thirds of the match. Every rival action gets attribution before the camera moves,
colour in the effect, and one composed sentence in the live region. Waiting is ambient,
not a spinner.

**P9. Every input makes a sound. Every sound has a reason.**

The bank is already built and already mixed on three buses. Hover, click, open, close,
error. The only reason the interface feels unanswered is that nobody called `play`.

---

## 6. File map for partitioning

Grouped so agents do not collide. Files listed under more than one group are the
coordination points and are flagged.

**Group A: the prompt channel and camera (build first, everything depends on it)**
- `src/scene/motion/prompts.ts` (new)
- `src/scene/motion/beats.ts` (add `turn` to `BeatKind`)
- `src/scene/CameraRig.tsx` (`RECIPES`: add `turn`, `robber-prompt`; consume prompts)
- `src/App.tsx` (emit prompts on phase / actor / placementMode change) — **shared with C**
- Items: P1, 2, 3, 4, 10

**Group B: board affordances in 3D**
- `src/scene/Pieces.tsx` (`VertexTargets`, `Road`, `Building`, `Footing`)
- `src/scene/Island.tsx` (`TerrainTile` robber rings)
- `src/scene/structures/Road.tsx` (`RoadGhost`)
- `src/scene/structures/Buildings.tsx` (city ghost preview)
- `src/scene/structures/Robber.tsx` (aura, lift, drag handle)
- `src/scene/GameScene.tsx` (wiring, `touchTarget`, controls enable/disable)
- Items: 1, 3, 5, 6, 8

**Group C: commit flow and HUD state**
- `src/App.tsx` (`boardActionTypes`, `act`, `confirmPendingAction`, `describeBoardAction`,
  the `.board-targets` group) — **shared with A**
- `src/ui/Hud.tsx` (`ActionPreview`, `ActionTray`, `TurnPanel`, `PlayerRail`,
  `ResourceWallet`, `TransitionMoment`, `AgentDecisionPreview`)
- `src/styles.css`
- Items: 2, 4, 5, 11, 12

**Group D: dialogs**
- `src/ui/Dialogs.tsx` (`Modal` `locked`/`blocking` split, `DiscardDialog`,
  `ChoiceDialog`, `TradeDialog`, `TradeResponseDialog`)
- `src/styles.css` — **shared with C**
- Items: 7, 8, 9, 10

**Group E: effects and particles**
- `src/scene/ActionEffects.tsx` (new `AffordanceEffects` sibling, actor colour on all
  emitters, turn sweep, steal trail to the wallet)
- `src/scene/motion/Particles.tsx` (reduced-motion leak in `Shockwave`)
- `src/scene/motion/placement.ts` (robber arc variant)
- Items: 2, 3, 8, 11, P6

**Group F: audio**
- `src/audio/useUiSound.ts` (new)
- `src/audio/useGameAudio.ts` (remove `end-turn` from `SILENT`, explicit handoff sound,
  onset sounds from prompts)
- Call sites in `src/ui/Hud.tsx`, `src/ui/Dialogs.tsx`, `src/ui/Journey.tsx` —
  **shared with C and D**
- Items: 2, 12, P9

**Group G: engine-adjacent, no gameplay change**
- `src/game/types.ts`: `roll-dice` carries an optional `dice` field that `applyAction`
  ignores entirely. It is dead surface on the public action type and on the MCP schema.
  Either honour it behind a dev flag or remove it.
- `src/game/simulationPolicy.ts`: `settlementValue` is the right heuristic for Item 1's
  density relief. Export it for the UI rather than duplicating it.

---

## 7. Live bugs found while auditing

Not interaction design, but they will bite whoever builds the above.

1. **`DiscardDialog` wipes in-progress selections.**
   `useEffect(() => setChosen(emptyResources()), [game.revision])` resets the player's
   staged discard whenever *any* other player in the queue discards. Observed live: my
   selection reset from 1 to 0 twice during a four-card discard. Key on
   `game.discardRemaining[humanId]`.
2. **Reduced motion leaves permanent artifacts.** `Shockwave`, `TilePulses` and the
   `RobberMoment` shroud all set `visible = true` at a fixed opacity in their
   `reducedMotion` branch and never clear.
3. **`interactive` goes false while `submitting`,** so every board affordance disappears
   for the duration of the round trip. Reads as a failed click.
4. **Cancelling a pending action can disarm the build mode.** The effect on
   `[game?.phase, viewerMustAct]` clears `placementMode` on some paths.
5. **`ActionPreview` returns focus to the first board target,** not the one the player was
   on, so keyboard users lose their place on every cancel and every commit.
6. **`hudError` merges errors and connection state** into one `role="alert"` toast, so a
   normal reconnect is announced as an alert.
