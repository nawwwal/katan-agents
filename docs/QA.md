# QA

Three tiers, cheapest first. **Try tier 1 before tier 2, and tier 2 before tier 3.**
A question answered in the wrong tier costs between ten and a thousand times what it
should. A full QA pass used to run 250k tokens because it was a human-shaped playthrough
reading full-resolution screenshots; almost none of what it checked needed either.

```bash
npm run qa            # tiers 1 and 2, one table, about 35 seconds
npm run qa -- --tier1 # rules only, no browser
npm run qa -- --tier2 # browser only
npm run qa:visual     # tier 3, one contact sheet
```

## Tier 1 — free, in memory, no browser

**Every rules or state question.** The engine is a pure reducer, so a thousand matches
cost a second. If the answer is derivable from `GameState`, it is answered here and it is
never answered in a browser.

| Check | Question |
|---|---|
| `check:board` | Board generation, adjacency constraints, harbours |
| `check:engine` | Setup deals two settlements and two roads, first roll produces |
| `check:rules` | Supply shortage, development timing, road interruption, maritime rates |
| `check:integrity` | Redaction: no seed, no opponent hand, no private stream |
| `check:simulation` | 24 complete matches, resource conservation, piece limits |
| `check:qa-rules` | Turn flow, four trades in one turn, discard-on-seven, robber and victim, determinism and replay, whole-match bookkeeping |
| `check:qa-assets` | Every sound id, card image and baked texture resolves to a real file |
| `check:dice-fairness` | The dice are fair |
| `check:budget` | Bytes per agent decision |

All of it runs in `npm test`.

Things tier 1 already settles, so nobody has to open a browser for them: whether a turn
can hold several trades, what a seven takes from a fifteen-card hand, who the robber may
rob, whether a seed replays byte for byte, whether the harbour rates are right, whether
a manifest reference is on disk.

## Tier 2 — cheap, one browser boot, assertions not artifacts

**Every "does the interface actually do the thing" question.** One headless boot, a
battery of assertions that each return a boolean and a number, and one compact table at
the end. No screenshots. No JSON dumps. On failure, only enough to locate the fault.

It exists because of one bug. Clicking a board vertex to place a settlement silently did
nothing: the `InstancedMesh` bounding sphere was computed in an effect, from matrices the
first frame had not written yet, so every pointer ray missed every target. Catching that
needed one scripted pointer event at a legal vertex and an assertion that the action
fired. It did not need a match and it did not need a single image.

What it covers:

- **Board affordances.** A real `PointerEvent` at the projected screen position of a
  legal vertex, edge and city, then Confirm, then the room service is asked whether the
  revision actually moved. Anything less proves the click was received, not that it
  worked.
- **Hit-testability.** Every legal marker is raycast at its own centre through the same
  raycaster the event system uses, and the hit region is measured outward and compared
  with what the marker draws. The rule is one-sided on purpose: the hit volume must track
  the drawn mark **upward**, never downward. A staged corner that grows to 1.7× while its
  cylinder stays at 1× is the quiet version of the dead click; a de-emphasised corner at
  0.58× is still fully legal and must keep its full hit area.
- **Trade.** The client's "it glitches out after I do one trade" is one line: complete a
  deal, let the table auto-close, reopen it, and `.trade-table[data-state]` has to read
  `composing`. Plus a directed offer reaching the viewer as a response panel, and the
  harbour rail naming the real reason it is shut.
- **Console and network.** Errors, WebGL and three.js warnings, non-2xx resources.
- **Loading.** What the preloader actually fetched inside its own window, whether it
  finished before the scene became interactive, and whether anything heavy arrived after.
- **Layout and accessibility** at 1920×1200 and 390×844: cumulative layout shift,
  horizontal overflow, interactive targets under the minimum edge, unlabelled controls,
  contrast failures.
- **The environment itself.** `agent-browser set device` changes the viewport and the
  user agent and nothing else, so a "mobile" run reports a mouse, hover affordances and
  all. The harness turns on real touch over CDP and then asserts the page agrees. A
  harness that lies about its environment is worse than no harness.

Notes for anyone extending it:

- The fixture (`scripts/qa/harness.ts`) runs its own room service and its own Vite server
  on private ports. The shared room service on 8787 is rate limited per client address,
  and another agent's reconnecting browser can exhaust the socket budget for everyone.
- States are reached by driving the room service's own functions with
  `simulationPolicy`, not by clicking. Parking a room at the state a check needs costs
  milliseconds; clicking there costs a browser minute.
- The scene is read through fiber's `_roots` map, which carries
  `internal.interaction` — the exact list the event system raycasts. `__katanScene` is
  the fallback.
- Test ownership by walking the parent chain. Handlers sit on groups and are answered by
  hits on child meshes, so an identity check produces false misses.
- Drive a gesture from a single `eval` dispatching synthetic `PointerEvent`s. Separate
  `agent-browser mouse` calls time out and `batch` hangs with a button held down.

## Tier 3 — expensive, aesthetic judgement only

**Only "does this look right."** Never "does this work." If a screenshot is being used to
find out whether something functions, the check belongs in tier 2 and will be cheaper and
more reliable there.

```bash
npm run dev &                      # tier 3 needs a dev server
npm run qa:visual                  # every state, one sheet
npm run qa:visual -- trade robber  # just those
```

One contact sheet at half resolution covering title, match, setup, the trade states,
robber, victim, cards, rules, history and summary, captioned, in one file. An agent reads
one image instead of twenty. Each panel is pinned by `?ui=<stage>`, the dev-only harness
in `App.tsx`, so no match has to be played to reach any of them. When a state needs a
close look, `scripts/shot.sh <out.png> "<query>"` still takes the full-resolution single
shot, and `scripts/blind-compare.py` still builds a blind A/B against a reference.

## Adding a check

Ask which tier the question belongs to before writing anything.

- Derivable from `GameState`? Tier 1. Add it to `src/game/qa.check.ts`.
- About a file on disk? Tier 1. Add it to `scripts/qa/assets.check.ts`.
- About what the interface does with an input? Tier 2. Add a mode to
  `scripts/qa/page.ts` and a line to `scripts/qa/browser.ts`.
- About how something looks? Tier 3, and only after the other two have nothing to say.

Prefer a cheap deterministic assertion on a number that matters over an expensive
observation. `check:budget` holding bytes-per-decision under 4,000 caught two separate
payload regressions in an hour; no amount of looking at the screen would have.
