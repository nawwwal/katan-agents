# Katan in-match UI direction

July 26, 2026. Written against the live build at 127.0.0.1:5173, screenshotted at
1920x1200 and 390x844 across `?ui=match|trade|cards|rules|history|summary|introduction`.
This is a visual and material direction. Interaction behaviour is owned by
`art/interaction-audit.md`; where I hit an interaction question I flag it in one line
instead of designing it.

Note on the screenshots I graded: the terrain was mid-retune and rendering as tall
extruded columns. That is a scene bug, not a UI one, and I judged the interface layer
only.

---

## 1. The direction

**The island is the table. Your cards are the only real objects in the interface.
Everything else is a quiet instrument that gets out of the way.**

Two classes, and the whole system falls out of the split.

Class A, objects. Your resource hand, your development hand, the offer you push across
the table. These have card stock, thickness, overlap, rotation and a shadow that lands on
the world. They are the only skeuomorphic thing in the app, and they are allowed to be
beautiful because they are the thing the player actually wants.

Class B, instruments. Turn state, standings, the log, rules, coaching, dice. One dark
material, thin, unornamented, recessive. These exist to be read in a glance and then
ignored.

### Why this and not the alternatives

**Against full boardgame-made-real.** A skeuomorphic interface has to render wood,
leather and parchment at UI scale, four inches from a 3D island rendering wood, stone and
sand off baked 2048px materials with real cast shadows. A CSS wood frame loses that fight
every time. The current trade dialog proves it: the big cream parchment sheet is the least
convincing surface in the frame precisely because it is trying hardest to be a physical
thing. It also fails the brief's own constraint. A cream panel over a bright ocean either
needs heavy borders everywhere or drops below AA. Dark holds against both ocean and forest.

**Against cartographer's or harbourmaster's instruments.** Nothing in Catan gets charted,
surveyed or navigated. The fiction would be borrowed rather than earned, and "brass
fittings and ledgers" is exactly the direction that could describe any fantasy strategy
game. Brass survives here as a one-pixel edge and a small-caps colour, not as a theme.

**Against the pure clean overlay.** This is what the previous pass actually chose, and the
style bible already committed to it: "quiet smoked metal, warm brass, thin player-colour
accents, and restrained blur instead of thick cartoon wood frames." That call was right.
The execution failed for a different reason than the client thinks. It is not that the UI
is too clean. It is that the treatment is uniform: every surface got the same graphite
glass, the same brass hairline, the same `--lift-2`, the same radius, and got parked in a
corner. Four equal boxes in four corners is not a hierarchy, and nothing in it is an
object you want to touch. A clean overlay gives you legibility. It does not give you a wow,
because there is nothing to want.

The wow in Catan is in the hand. It is fanning five cards, and it is the moment someone
slides an offer across the table. The app already has good painted card art and is
currently using it as icons inside 56px tiles with count chips welded to the corner. The
direction is mostly a matter of letting the cards be cards and making everything else stop
competing with them.

One sentence a build agent can check any decision against: **if it is not a card, it should
get quieter.**

---

## 2. Token layer

The token layer is good. It stays. Type scale, families, four radii, the three-part depth
system, motion durations, resource tint chips and the brass ramp all survive unchanged.
Here is what moves.

### Delete

| Token / material | Why |
|---|---|
| `--parchment`, `--parchment-2`, `--ink`, `--ink-2` and the `.game-modal` cream gradient | Two modal materials exist today, graphite for summary and cream for trade/cards/history/rules, chosen arbitrarily per component. One material. Graphite wins because it holds AA over both ocean and forest. |
| Every blue: `#3a83bd`, `#1e5480`, `#2f88b6`, `#1b3a52` | This is a Bootstrap primary. There is no blue in the world palette except the ocean, and the ocean is the one hue the background already owns, so a blue button is the least separable colour available. Primary becomes the existing brass ramp. Selected state becomes a `--brass-hi` ring. |
| `backdrop-filter` on `.modal-backdrop` (blur 7), `.agent-invite-backdrop` (blur 10), `.action-tray`, `.resource-wallet`, `.journey-secondary`, `.production-summary` | Full-screen backdrop filters over a live 3D canvas are explicitly out of budget. Keep blur only on the turn panel and player rail, the two small panels that genuinely sit over moving water. |

### Add

```css
--card-stock:  linear-gradient(172deg, #2a2118, #16110c);  /* card back / edge body */
--card-edge:   inset 0 1.5px 0 rgba(255,238,206,.5);        /* the lit top edge = thickness */
--lift-card:   0 1px 0 rgba(0,0,0,.6), 0 3px 8px rgba(0,6,10,.5), 0 12px 22px -8px rgba(0,4,8,.55);
--scrim:       radial-gradient(120% 90% at 50% 55%, rgba(2,10,15,.30) 0%, rgba(1,7,11,.74) 100%);
--hairline-run: /* 1px brass gradient sweep, used for any "someone else is acting" state */
```

`--lift-card` is tighter and warmer than `--lift-2`. Cards sit close to the surface. Panels
float above it. That difference is what sells the object/instrument split.

`--scrim` replaces every backdrop blur. A vignette, no filter, no cost.

### Reassign depth by class

Today everything wears `--lift-2`, which is why nothing has rank.

- Instruments: `--lift-1`. Flat, close, quiet.
- Objects (cards, offer stacks): `--lift-card` plus a real cast shadow onto the world.
- Overlays and the summary panel: `--lift-3`.

### Type

Cinzel is right for display and wrong for numerals, and it is currently carrying dice
faces (15px), seat numbers, rank digits, VP totals (14 to 20px) and stepper counts. Cinzel
at 14 to 17px is mush, which is a real part of why the numbers in the player rail read as
texture.

Rule: **Cinzel at 19px and above, for names, titles and the wordmark only. Every numeral in
the app is Inter tabular.** `.tnum` already exists; widen its application and strip
`font-family: var(--display)` from `.dice-face`, `.roll-total`, `.rank`, `.seat-number`,
`.standings-list b`, `.resource-stepper > strong`, `.turn-order li > span`, `.public-stack`.

### Colour

The island owns saturation. The UI accent is brass, full stop. Player colour appears as a
crest fill and a 2px identity bar, never as a panel wash.

Kill the player-colour radial washes. There are seven of them doing the same murky tint:
`.turn-owner`, `.player-row`, `.turn-order li`, `.standings-list li`,
`.history-players article`, `.trade-partners > button`, `.production-summary li`. At 18 to
26 percent `color-mix` over a dark panel they read as a gradient bug rather than identity,
and they are the main reason the player rail looks like a web component. Replace all seven
with one 2px full-height bar at the leading edge, full-strength player colour, which is
both more legible and more accessible than a haze.

Grain stays but drops from `.05` to `.03` on anything under 200px. On a 44px square,
turbulence is noise, not material.

Files: `src/styles.css` only.

---

## 3. Per-surface specifications

### 3.1 HUD frame

Today: four corner slabs plus a floating four-square utility cluster, all the same
material and weight. That is the whole complaint in one sentence.

New structure, three zones:

- **Top left.** Turn state. Who, what phase, dice. One panel, `--lift-1`, fixed footprint.
- **Top right.** Standings rail.
- **Bottom edge, full width.** Your side of the table. One continuous band: hand on the
  left flowing into commands on the right, no gap between them, no separate tray, no
  separate utility cluster. This is the single largest structural change and it is what
  makes the interface read as one object instead of four.

The bottom band is not a panel with a border. It is a soft upward gradient from the bottom
edge, no radius, no outline, with the cards sitting in it. A rounded rectangle floating
above the bottom edge is what makes the current tray read as a web widget.

Files: `src/ui/Hud.tsx` (`Hud`), `src/styles.css`.

### 3.2 Turn panel

- Drop the colour wash. Crest, name, phase line.
- **Merge `ContextCoach` into this panel.** The coach is a fifth box that restates the
  phase with more words. Fold its one line into the phase area. This also deletes the
  `:has()` collision cascade at styles.css lines 285-287, 924-925 and 976-979, five rules
  that exist only to stop two stacked panels from overlapping.
- **Dice as pips, not numerals.** "3 3 6" currently reads as a number soup. Two die faces
  with real pips read instantly, and once you have pips you can delete `.roll-total`
  entirely. Two dice already say the total.
- Fixed footprint at every phase so nothing below it ever moves.

States:
- Your turn: crest in your colour, phase line active.
- **Waiting for another player:** same footprint, crest swaps to their colour, phase line
  becomes their action, and `--hairline-run` sweeps along the bottom edge of the panel. No
  spinner glyph. The `.agent-decision-preview` floating panel, which currently appears as
  a sixth box near the top centre and needs three media queries to avoid collisions, is
  deleted and its content lives here.
- Setup suggestion: the existing suggest button stays, inside the fixed footprint.

Files: `src/ui/Hud.tsx` (`TurnPanel`, `ContextCoach`, `AgentDecisionPreview`),
`src/ui/Icons.tsx` (new `DiePips`), `src/styles.css`.

### 3.3 Player rail

Fixed 56px rows. Left: crest with a 2px colour ring. Centre: name over one status line.
Right: **VP as the only large numeral** at 19px Inter tabular, with resource count, dev
count and knights as one compact `--t-label` group beside it. Today all four numbers are
the same size in the same pill shape, which is why the rail reads as texture.

Awards get a reserved 2 x 20px slot that is always present and empty when unearned, so
winning Longest Road never reflows a row.

Active player: the row must not translate -8px. Lateral movement on a live list is a jump,
not a state. Instead the crest ring goes `--brass-hi` and the row moves up one depth step.

Never reorder the rail during a match, even as scores change. A list that re-sorts under
your eyes is unreadable.

Files: `src/ui/Hud.tsx` (`PlayerRail`), `src/styles.css`.

### 3.4 Resource wallet, the hand

This is where the wow lives and it is currently six equal tiles in a tray with count chips.

Spec: it is a **hand of cards**.

- Cards overlap by roughly 40 percent, fan across a shallow arc with +/-2 degrees of
  rotation, and sit slightly below the bottom edge of the viewport so the band reads as
  cards held at the table edge rather than a row of thumbnails.
- **A count of 3 is three overlapping cards**, not a chip that says 3. Up to a threshold
  of four; above that it collapses to a stack with a numeral on the top card only. This
  single change is the difference between a data readout with art on it and a hand.
- Zero of a resource is **no card**, just a thin empty slot with the glyph at 20 percent.
  An empty hand should look empty. Today a "0" chip hides that.
- Delete the `.resource-card small` label. On distinct art with a resource tint, the word
  LUMBER at 9px is redundant. It is already hidden on mobile, which proves it.
- Card art keeps a fixed bottom scrim so any numeral sitting over it holds contrast
  regardless of the art beneath.

Affordability, which replaces cost pips entirely: when a build command is hovered, focused
or selected, the cards it would spend rise out of the fan and the rest recede. You read
cost from your own hand rather than from a row of 12px glyphs.

States:
- Gained: card slides up from off the bottom edge and settles. `--ease-spring`. This is an
  arrival, one of only three places spring is allowed.
- Spent: card lifts and fades upward out of the hand toward the board.
- Insufficient: nothing shakes. The build command is disabled and the missing resource's
  empty slot pulses its outline once. Shake is a punishment; the current
  `resource-spend` translateX wobble should not be reused for failure.
- Waiting for another player: the hand recesses 8px and drops to 80 percent opacity.
  Present, legible, plainly not yours to act with.

Files: `src/ui/Hud.tsx` (`ResourceWallet`, `useCountPulse`), `src/styles.css`.

### 3.5 Action tray and build commands

Seven identical 68x80 buttons is wrong because Roll, Build and End Turn are not the same
class of thing.

- **Build group.** Road, Settle, City, Develop as one group of four on a shared plinth.
- **Trade and Cards** move next to the hand, not next to build. They are both "reach into
  your cards," and grouping them with build is what makes the tray read as an
  undifferentiated toolbar.
- **End Turn** is a single wide control at the far right, visually separated, and it is
  the only brass-filled control on screen at any moment.

There is exactly one primary at a time. Today Roll can be lit coral with a looping glow
while End is lit brass while a build command wears a brass selected ring. Three competing
"do this" signals.

Cost display: replace glyph-per-card pips with a resource tint dot plus a tabular count,
so city reads as `3• 2•` rather than five overlapping 10px glyphs. The previous pass
already admitted the pips read as texture; one glyph per card cannot be fixed by resizing,
only by changing the encoding.

**No legal moves:** the build group does not unmount. All four go disabled with a 0 legal
count and one line under the group saying why. Today the whole `.build-rail` disappears
outside the action phase, which is both a layout shift and a loss of affordance.

Files: `src/ui/Hud.tsx` (`ActionTray`, `CostPips`, `BUILD_COMMANDS`), `src/styles.css`.

### 3.6 Trade, the centrepiece

Today it is a two-column form with ten +/- steppers, all showing 0. It hides the board, it
hides your own hand, and it puts the harbour, which is a bank transaction, at equal weight
with player trade, which is the social heart of the game. On mobile it is worse: the
harbour and a five-row bank rate table fill the first screen and player trade is below the
fold.

**Trading does not happen in a dialog. It happens on the table.**

- The board dims under `--scrim`. No blur. The island stays visible, because who you are
  trading with is partly a question of what is on the board.
- The lower two thirds becomes the trade table. Your hand fans up from the bottom edge,
  the same hand from the HUD, continuous, not a second copy of it.
- **You compose an offer by moving cards from your hand into a slot on the table in front
  of you.** Real cards, face up, stacked and countable.
- **The other side of the table is empty slots, not cards.** You are asking for cards you
  cannot see, so the ask side is silhouetted outlines you fill by tapping resource glyphs.

That asymmetry is the entire design. Your side is real face-up card stock; their side is a
request. It teaches the game's core information asymmetry visually, in a way no form can,
and it is specific to Catan rather than to fantasy games in general.

- Partner selection is not a radio group. It is the other players' crests seated around
  the far edge of the table. Picking one aims the offer at them.
- **The harbour is not a peer of player trade.** It is a rate card pinned to the edge of
  the table, small and always visible, showing your best rate per resource. Two clicks
  from anywhere, not half the screen.

States, which are most of the work:

| State | Treatment |
|---|---|
| Composing, nothing staged | Ask slots visible as empty outlines. Primary present and disabled. Do not swap the button's own label to "Choose what to trade"; a control that renames itself is a moving target. |
| Insufficient resources | Cannot arise. You cannot drag a card you do not hold, because it is not in the hand. This deletes the "4 owned" caption under every stepper. |
| Sent, waiting | The offer stack slides across the table toward the partner and turns to face them. Partner crest carries `--hairline-run`. Copy: "Atlas is considering." No spinner. |
| Declined | The stack slides back to your side and the partner's crest dims with a struck rule. Copy: "Atlas declined." **The table stays open with the offer intact** so it can be retargeted at the other player in one click. Today a declined offer is simply gone. |
| Accepted | The two stacks pass through each other, land, and the wallet plays its gain arrival. |
| Counter received | The partner's stack arrives on your side of the table, face up. Same object, mirrored. Not a separate `counter-offer` fieldset with its own ten steppers, which is what exists now. |
| Nothing tradeable | Empty hand shows the empty-slot row, and the table says so in one line. No disabled form. |

For the interaction audit, one line: drag-to-offer needs a click and keyboard equivalent,
and "retarget a declined offer" is a behaviour change rather than a visual one.

Files: `src/ui/Dialogs.tsx` (`TradeDialog`, `TradeResponseDialog`, `TradeBundle`,
`ResourcePicker`, `TradeSummary`, `VisualTradeBundle`, `HarborRates`), `src/styles.css`
(replace `.trade-columns` through `.counter-offer`).

### 3.7 Development cards

Stop showing the five card **types**. `CardsDialog` currently renders all five with the
unowned ones as grey ghosts, which turns your hand into a product catalogue.

- Show only the cards you hold, fanned, same physics as the resource hand.
- Victory Point cards sit face down at the end of the fan with a card back. That is the
  fiction and it costs nothing.
- Play affordance: the card lifts out of the fan on hover or focus and one control appears
  under the fan. Not a blue button stamped across the artwork, which is what happens now
  and is the single worst thing done to genuinely good art anywhere in this app.
- "What cards exist" belongs in Rules, if anywhere.
- Empty hand: the empty-slot row plus one line. No ghost grid.

Files: `src/ui/Dialogs.tsx` (`CardsDialog`), `src/styles.css` (`.card-list`).

### 3.8 History

Delete the Controllers column. It duplicates the player rail, which is permanently on
screen four inches away.

One column: a chronological log with a hairline rule at each turn boundary, revision
numerals in a fixed 32px gutter, tabular. Events that reference a player get a 2px colour
bar at the leading edge instead of a pill. No boxes around individual rows; a stack of
rounded cream boxes is what makes the current log look like a settings page.

Empty state: "Nothing has happened yet." No card, no frame.

Files: `src/ui/Dialogs.tsx` (`HistoryDialog`), `src/styles.css` (`.history-*`).

### 3.9 Summary

Closest to right already. The dark panel over the pulled-back island is the one place the
UI and the world currently look like the same object, which is worth noticing: it works
because the panel is dark, unornamented, and the island is doing the emotional work.

- Keep the material and composition.
- Standings get the 2px colour bar, dropping the wash.
- The crest landing keeps `--ease-spring`. It is the correct place for it.
- **Delete the confetti.** Eighteen CSS rectangles falling on an infinite loop reads as a
  loading state made of squares. The camera pull-back and the score music carry this
  moment. If something must fall, a handful of large soft shapes at low opacity, drifting
  once and stopping, not looping.

Files: `src/ui/Journey.tsx`, `src/styles.css` (`.summary-*`, `.celebration`).

### 3.10 Mobile, 390x844

Today it is a compressed desktop, and specifically it is three stacked chrome bands at the
bottom (utility row, wallet, tray) plus two at the top, leaving the island a letterbox in
the middle. That is the honest diagnosis: the bottom 40 percent of a phone screen is UI.

Designed layout:

- **Top:** one 56px bar. Active crest, name, phase, dice. Players collapse to three crests
  showing VP only, tappable to expand into the full rail as a temporary sheet.
- **Middle:** everything from 56px down to the hand belongs to the island.
- **Bottom:** the hand fans from the bottom edge on a much tighter arc, four cards visible,
  swipe along to reach the rest. Commands become one row of five 44px marks sitting
  directly under the hand. No separate utility row. No separate tray.
- **Rule: never more than two stacked chrome bands.** Today there are three plus a floating
  utility cluster.
- **Trade on mobile:** full-height sheet, Players tab first and default, Harbour behind a
  second tab. Today the priority is exactly inverted.

Files: `src/styles.css` (the `max-width: 820px` and `max-width: 520px` blocks, which should
shrink substantially rather than grow), `src/ui/Hud.tsx`.

---

## 4. Motion

`--ease-spring` is reserved for arrival and celebration. Three places, and no more:

1. A card arriving in the hand.
2. An accepted offer landing.
3. The victory crest landing.

Everything else is `--ease-out`. The design hook that flags bounce easing outside these
cases is correct and should stay strict.

**Animates:** card transform and rotation, hand lift on hover and focus, offer stack travel
across the table, the one-time staggered panel arrival at match start, dice, the waiting
hairline, wallet gain and spend.

**Does not animate:** panel size, panel opacity on state change (a panel that cross-fades
between states reads as a rendering bug), numerals (no count-up tickers; tabular numerals
snap), player rail order, and the colour of anything. Colour transitions on state are the
cheapest-looking thing in web UI and there is no reason for them here.

**Never:** bounce on hover, scale on a panel, anything full-screen, and any loop longer
than three seconds except the ocean. Delete the `roll-breathe` glow on the Roll button;
a pulse that runs three times is neither a hint nor a state, and a looping glow on a
primary reads as anxiety.

**Performance.** Transform and opacity only. No animated `filter`. The offer stack travels
as one element with one transform, not as N cards each animating. Cap the rendered hand at
eight card nodes and collapse beyond that.

**Reduced motion.** The global override in styles.css is correct and stays. One addition
the build must respect: **the fan geometry is layout, not motion.** The resting rotations
and offsets must be static CSS transforms present at first paint, not JS-applied after
mount. That is what makes reduced motion and zero layout shift both hold, and it is the
single easiest thing to get wrong here.

---

## 5. What to delete

The wow comes from removal. In order of value.

1. **The parchment modal material** and every cream surface. One overlay material.
2. **All blue.** `#3a83bd`, `#1e5480`, `#2f88b6`, `#1b3a52`.
3. **The four-square utility cluster.** Four anonymous 44px slabs in the middle of the play
   area is the worst-value 200px in the frame. Sound becomes one mark at the top of the
   player rail. Rules becomes a link in the turn panel. History moves to a mark in the turn
   panel. Exit lives behind Escape plus a small mark, not a slab competing with build
   commands.
4. **`ContextCoach` as a separate panel**, and with it the five `:has()` top-offset rules
   that exist only to keep it from colliding with the turn panel.
5. **`AgentDecisionPreview` as a separate panel**, and its three media-query positions.
6. **The seven player-colour radial washes.** Replaced by one 2px bar.
7. **Cost pips as glyph rows.**
8. **The `.roll-total` pill.** Two dice with pips already say the total.
9. **The Controllers column in History.**
10. **The ghost cards in the development hand.**
11. **`.resource-card small` labels.**
12. **Confetti.**
13. **`roll-breathe`.**
14. **Six `backdrop-filter` declarations**, listed in section 2.

Net effect: roughly six floating boxes become three zones, two modal materials become one,
and two accent colours become one.

---

## 6. Accessibility, and how this direction holds it

Non-negotiable and already verified once. Nothing here should cost a point of it.

- **Contrast.** Everything moves onto the dark panel family that was already verified. Brass
  `#d8b168` on `--slate-800` is about 7:1. The brass primary uses `#2a1a06` ink at about
  9:1. Card art carries a fixed bottom scrim so numerals over art clear 4.5:1 regardless of
  what the art is doing. No text is ever set directly on the 3D canvas except the wordmark,
  which already has its own scrim.
- **The 44px question, which the fan makes real.** Overlapping cards mean a covered card's
  visible strip can be narrower than 44px. Solution: each card's hit target is a full-height
  44px-wide invisible box anchored to its visible strip, and hover or focus raises the card
  so the full face is exposed before any click is required. The top card of any stack is
  always full size. This is the only place the direction creates a target-size problem and
  it is solved geometrically rather than by shrinking the fan.
- **Labels.** Every card is a button, `aria-label="Lumber, 3 held"`. The hand is a
  `role="group"`. Ask slots read "Asking for lumber, 2". The offer state is announced
  through one `aria-live="polite"` region on the trade table, not per element.
- **Tab order.** The bottom band becomes one tab stop with roving tabindex and arrow-key
  navigation inside it. That is an improvement on today's thirteen sequential stops through
  the wallet and tray.
- **Focus.** Existing `:focus-visible` brass ring stays. On a raised card the ring must
  follow the raised position, so it belongs on the card element and not on a wrapper.
- **Zero layout shift.** Fixed footprints on the turn panel, rail rows and the bottom band.
  Reserved slots for awards and the waiting hairline. Nothing in the bottom band mounts or
  unmounts; commands disable rather than disappear. Cards move on transform only.
- **Reduced motion.** Covered in section 4. Static fan geometry.

---

## 7. Build partitioning

`src/styles.css` is touched by every branch, so **the token and deletion pass in section 2
must land first, alone**, or the branches will conflict on it. Worth considering splitting
the file into tokens/primitives plus per-surface blocks as part of that first pass; if not,
serialize the CSS work.

| Branch | Files |
|---|---|
| 0. Tokens, materials, deletions (blocking) | `src/styles.css` |
| 1. Bottom band structure | `src/ui/Hud.tsx` (`Hud`, utility controls), `src/styles.css` |
| 2. Hand / wallet | `src/ui/Hud.tsx` (`ResourceWallet`, `useCountPulse`), `src/styles.css` |
| 3. Action tray and cost display | `src/ui/Hud.tsx` (`ActionTray`, `CostPips`), `src/styles.css` |
| 4. Turn panel, coach merge, agent state, dice pips | `src/ui/Hud.tsx`, `src/ui/Icons.tsx`, `src/styles.css` |
| 5. Player rail | `src/ui/Hud.tsx` (`PlayerRail`), `src/styles.css` |
| 6. Trade table | `src/ui/Dialogs.tsx`, `src/styles.css` |
| 7. Development hand | `src/ui/Dialogs.tsx` (`CardsDialog`), `src/styles.css` |
| 8. History | `src/ui/Dialogs.tsx` (`HistoryDialog`), `src/styles.css` |
| 9. Summary | `src/ui/Journey.tsx`, `src/styles.css` |
| 10. Mobile layout | `src/styles.css` media blocks, `src/ui/Hud.tsx` |

`src/ui/gameVisuals.ts` needs one addition at most, a card-back asset path for the
face-down victory point card.

Branch 2 is the one that produces the wow. If only one thing ships, ship the hand.
