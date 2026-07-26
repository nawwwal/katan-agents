# Dice fairness audit

Empirical audit of the Katan dice, July 27 2026. Written from `src/game/engine.ts`,
`src/game/board.ts`, `server/room-service.ts` and the dice presentation in
`src/scene/motion/diceThrow.ts`, `src/scene/motion/Dice.tsx`, `src/ui/Hud.tsx` and
`src/styles.css`. Every number below came from running the real reducer or from a
sampler proved byte for byte identical to it. The reproducible part lives in
`src/game/diceFairness.check.ts`; run it with `npx tsx src/game/diceFairness.check.ts`.

**Verdict: the dice are sound.** Both random sources pass, at over a million rolls each,
every test that would catch the suspected defects. The one real finding is in the
presentation: the HUD prints the number about a second before the physical dice stop, so
the tumble looks like a formality. Details in section 6.

---

## 1. Which source a real game actually uses

Every real game uses the platform CSPRNG. Nothing in production touches the seeded
fallback.

- `server/room-service.ts:56` defines `secureRandom = () => randomInt(0x1_0000_0000) / 0x1_0000_0000`,
  out of `node:crypto`.
- `playRoomAction` (`room-service.ts:340`) passes it into every single action:
  `applyAction(room.game, action, secureRandom)`. There is no branch that omits it.
- `startRoom` (`room-service.ts:324`) passes the same source into `createGame`, so the
  development deck shuffle is crypto too, and `privateRandomSeed` is `randomBytes(4)`.
- Both front doors land there. The browser goes through `server/realtime-server.ts:180`
  and MCP agents go through `server/hosted-mcp.ts:158`; both call `playRoomAction`.
- There is no local hot-seat mode. `applyAction` is called from `src/App.tsx:49` only
  inside `buildUiPreview`, a dev-only harness behind `import.meta.env.DEV` that feeds its
  own scripted source, and from `BoardLab`/`PiecesLab`, which pass `() => 0.5`.

So the seeded fallback at `engine.ts:622`,
`seededRandom(state.privateRandomSeed ^ ((state.revision + 1) * 0x9e3779b1))`, is reached
only by checks, labs and any future replay. It is still the reducer's documented default,
so it was measured at full size anyway. It passes as well.

## 2. Two dice, summed

Checked first, because it is the difference between a subtle problem and a broken
economy. `engine.ts:623` is `[1 + Math.floor(random() * 6), 1 + Math.floor(random() * 6)]`
and the total is `dice[0] + dice[1]`. There is no `randomInt(2..12)` anywhere.

The check drives all 36 ordered pairs through `applyAction` with a scripted source and
asserts that exactly two draws are consumed, that `lastRoll` is the pair, and that the
`dice` event's `total`, `one` and `two` agree. The measured distribution is triangular,
not flat: P(7) = 0.16662 and P(2) = 0.02766 in the million-roll served sample, against
0.16667 and 0.02778.

One loose end worth naming, unrelated to fairness: `GameAction` carries an optional
`dice?: [number, number]` on `roll-dice` (`types.ts:160`) that `applyAction` ignores
entirely. A client cannot force a roll with it. It is dead weight and reads like a
back door that is not one.

## 3. What was measured

Two sampling frames, both run on both sources with an identical shape so that any harness
artefact shows up in both columns.

**Whole games through the reducer.** 7,560 complete three and four seat matches per source
played with `chooseSimulationAction`, every action through `applyAction`, every `dice`
event recorded with the seat and the revision that produced it. 1,059,169 rolls on the
seeded fallback and 1,062,457 on the served path.

**Bulk sample.** 20,000 games of 100 rolls per source, the revision walking by 2 to 7 the
way a turn walks, 2,000,000 rolls per source. The fallback sampler is the expression from
`engine.ts:622` lifted out, and the check proves it reproduces `applyAction` exactly over
4,000 consecutive revisions before using it. Fixed seeds, so that column is deterministic
and the check cannot flake.

Nothing is measured across a game boundary. The runs test is pooled per game, so a
boundary cannot invent a run.

## 4. Results

### Distribution of the total, real games, 1,059,169 rolls, seeded fallback

| total | observed | expected | obs/exp | z |
|---|---|---|---|---|
| 2 | 29,357 | 29,421.4 | 0.99781 | -0.38 |
| 3 | 58,779 | 58,842.7 | 0.99892 | -0.27 |
| 4 | 88,286 | 88,264.1 | 1.00025 | 0.08 |
| 5 | 117,623 | 117,685.4 | 0.99947 | -0.19 |
| 6 | 146,961 | 147,106.8 | 0.99901 | -0.41 |
| 7 | 176,544 | 176,528.2 | 1.00009 | 0.04 |
| 8 | 147,349 | 147,106.8 | 1.00165 | 0.68 |
| 9 | 118,220 | 117,685.4 | 1.00454 | 1.65 |
| 10 | 88,038 | 88,264.1 | 0.99744 | -0.79 |
| 11 | 58,705 | 58,842.7 | 0.99766 | -0.58 |
| 12 | 29,307 | 29,421.4 | 0.99611 | -0.68 |

chi-square = 4.567 on 10 df, p = 0.9182. Mean 7.00028.

Served path, same frame, 1,062,457 rolls: chi-square = 6.959 on 10 df, p = 0.7293,
mean 7.00186.

Bulk sample: fallback chi-square = 12.592, p = 0.2474; served chi-square = 10.809,
p = 0.3726.

### Each die on its own, and the pair

| test | fallback | served |
|---|---|---|
| die A uniform over 1 to 6 (5 df) | chi2 1.292, p = 0.9358 | chi2 6.129, p = 0.2939 |
| die B uniform over 1 to 6 (5 df) | chi2 6.262, p = 0.2815 | chi2 2.495, p = 0.7773 |
| die A against die B (25 df) | chi2 31.890, p = 0.1612 | chi2 17.791, p = 0.8511 |

Real games, roughly 176,500 appearances per face per die.

### Serial correlation, real games, seeded fallback

The hypothesis was that reseeding from a linearly stepping input makes roll N predict
roll N+1. It does not. Each lag gets two tests: a Pearson correlation on the totals and
an 11x11 contingency table, which sees structure a linear correlation would miss.

| lag | pairs | Pearson r | r p | chi2 (100 df) | chi2 p |
|---|---|---|---|---|---|
| 1 | 1,051,609 | -0.000290 | 0.7662 | 84.89 | 0.8599 |
| 2 | 1,044,049 | -0.000676 | 0.4896 | 92.89 | 0.6800 |
| 3 | 1,036,489 | -0.000761 | 0.4384 | 136.41 | 0.0091 |
| 4 | 1,028,929 | -0.000993 | 0.3139 | 105.17 | 0.3422 |
| 5 | 1,021,369 | -0.000743 | 0.4527 | 97.80 | 0.5437 |
| 6 | 1,013,809 | 0.000255 | 0.7976 | 101.07 | 0.4514 |
| 7 | 1,006,249 | -0.000132 | 0.8944 | 103.07 | 0.3967 |
| 8 | 998,689 | -0.000056 | 0.9556 | 93.29 | 0.6693 |
| 9 | 991,129 | -0.000029 | 0.9773 | 123.78 | 0.0537 |
| 10 | 983,569 | -0.001581 | 0.1168 | 118.96 | 0.0950 |
| 11 | 976,009 | 0.002867 | 0.0046 | 91.07 | 0.7270 |
| 12 | 968,449 | -0.000947 | 0.3513 | 94.12 | 0.6468 |

Every correlation is inside 0.003, which at a million pairs is the noise floor. Two of
those 24 p-values land under 0.05, which is what 24 tests do; the served column's 24 tests
on the same frame produce none under 0.05, and its lowest in the bulk frame is 0.026.
Neither of the two low cells reappeared when the sample was regrown, and the seeded and
served columns are statistically indistinguishable from each other throughout.

The bulk sample repeats all 24 lag tests at 2,000,000 rolls with the same result: largest
|r| is 0.00175 and no p among the 24 falls below 0.014.

### Runs, gaps and clustering

| test | fallback | served |
|---|---|---|
| runs above and below 7 | 445,242 against 445,089.3 expected, z = 0.329, p = 0.7420 | 446,669 against 446,582.1, z = 0.187, p = 0.8516 |
| gaps between sevens | 168,985 gaps, mean 4.7095 | 169,469 gaps, mean 4.7192 |

The gap mean is below 5 in both columns by construction, not by bias: a gap only counts
when it fits inside one game, so the long ones are censored equally in both. Compared
against each other, where that censoring cancels, the two gap histograms agree:
chi-square = 35.470 on 30 df, p = 0.2259. Clustering of sevens is exactly as clumpy as a
fair pair of dice, which is clumpier than people expect.

### Bias by revision, seed and seat

| test | fallback | served |
|---|---|---|
| revision parity (10 df) | even mean 7.00091, odd mean 6.99964, chi2 14.724, p = 0.1425 | even mean 7.00085, odd mean 7.00288, chi2 10.434, p = 0.4033 |
| seat homogeneity (30 df) | chi2 32.178, p = 0.3593 | chi2 21.453, p = 0.8732 |

Per seat, real games, seeded fallback: P(7) is 0.16633, 0.16675, 0.16749 and 0.16550 for
seats 0 to 3 across 307,000, 307,000, 307,000 and 137,000 rolls. Seat 3 exists only in the
four-player games, hence the smaller sample.

Per seed: 20,000 games each given a fresh `privateRandomSeed`, chi-square goodness of fit
run per game, then the 20,000 p-values tested for uniformity. No seed family misbehaves.
Worth recording that the first pass of this test flagged p = 2.1e-5 and it was a harness
artefact: at 100 rolls a game the expected count in the `total = 2` cell is 2.8, the
chi-square approximation is poor, and the crypto control failed the same test just as
often (p = 0.0010, 0.0015, 0.0068 across twelve replications). At 1,000 rolls a game,
where the approximation holds, both sources sit at p = 0.82 and p = 0.65. A flag that a
CSPRNG raises too is a flag about the test.

A test for periodicity in the revision, totals grouped by revision mod m for m in
2, 3, 4, 5, 6, 7, 8, 9, 12, 16, 24, 32, 36, 64 over 4,000,000 consecutive revisions, threw
one candidate: m = 32, p = 0.0020. It did not survive. The statistic fell as the sample
grew, 397.5 at 4,000,000 rolls and 367.5 at 16,000,000 against 320 df, where a real bias
would have grown linearly, and twelve fresh seeds gave p between 0.09 and 0.86.

### The sharpest test of the reseeding hypothesis

Eleven outcomes is a coarse instrument. The same question asked of the raw uniforms, at a
resolution the total cannot see, 8,000,000 rolls per row:

| test | rev += 1 | rev += 2 | rev += 3 | crypto control |
|---|---|---|---|---|
| first draw, 1024 bins | 0.1228 | 0.3938 | 0.6152 | 0.5045 |
| second draw, 1024 bins | 0.8805 | 0.7429 | 0.2373 | 0.2153 |
| first against second inside a roll, 64x64 | 0.7308 | 0.4436 | 0.2059 | 0.1875 |
| first draw against the previous first, 64x64 | 0.3464 | 0.5544 | 0.1020 | 0.7889 |
| three consecutive first draws, 32x32x32 | 0.5548 | 0.6782 | 0.9778 | 0.0624 |

p-values. The adversarial case, one seed with the revision stepping by exactly 1, is the
purest form of the suspected defect and it is clean at 32,767 degrees of freedom. Whatever
else is true of mulberry32's finalizer, one round of it over this seed sequence is enough
to hide the arithmetic step from tests with this much power.

## 5. What this means for the complaint

The client is pattern-matching noise, which is the normal thing for a human to do with
dice. A fair pair produces long droughts and long clumps. In the million-roll seeded
sample the table went 20 or more rolls without a seven 3,827 times, worst drought 64, and
five rolls of 8 or more landed back to back once every 138 rolls, which across a table is
about once a game. The served sample gives 3,790, 69 and once every 138. None of that is a
defect and none of it can be tuned away without making the dice unfair.

Nothing needs to change in `engine.ts` or `board.ts`. The reseeding scheme was the right
thing to suspect and it does not fail; it also does not matter in production, because the
served path never uses it.

## 6. The presentation does telegraph, and that is the real finding

If a player says the rolls feel decided in advance, the interface is telling them so.

**The number is on screen roughly a second before the dice stop.** `DiceMoment` in
`src/ui/Hud.tsx:326` mounts on the same state update that starts the throw, and its
`dice-moment` keyframe in `src/styles.css:496` reaches full opacity at 18% of 1450ms, so
about 260ms. It shows both pips, the total in a large numeral, and the production summary
underneath. The physical dice are still tumbling: measured over 14,400 planned throws the
flight lasts 1.278s on average, inside the `DICE_SETTLE_RANGE` of 0.93s to 1.33s in
`src/scene/motion/timing.ts`. So for about one full second the answer is legible on the
HUD while the dice pretend to decide it. Resource motes already wait for
`PRODUCTION_DELAY` at 1.66s, which is after the dice land; the HUD panel is the piece that
does not wait.

The fix is a delay, not a redesign: hold the `DiceMoment` mount, or at least the total and
the production summary, until `diceThrowPlan(roll, revision).duration`. The plan is
already memoised and already read by both `Dice.tsx` and `useGameAudio`, so the exact
landing time is available without a new constant. Keep the panel immediate under
`reducedMotion`, where `Die` puts the die on the table showing its number from the first
frame and there is nothing to wait for.

**The throw itself is clean.** Measured over 14,400 plans covering all 36 ordered pairs
across 400 revisions:

- No trajectory reuse. The seed is `dice-${revision}-${roll[0]}-${roll[1]}` (`diceThrow.ts:570`)
  and the revision is unique per action, so 7,200 of 7,200 sampled throws had distinct
  launches. The same number never arrives the same way twice.
- No relationship between the flight and the value. Mean flight length by total ranges
  from 1.2756s to 1.2829s, one-way F(10, 14389) = 1.462, and lock-in behaviour is flat
  across faces: mean 0.4130, 0.4147, 0.4117, 0.4130, 0.4121, 0.4135 for faces 1 to 6.
  Nothing about how the dice move hints at what they will say.
- The dice are readable once they stop bouncing, which is honest. The visible top face
  matches the final value for 80% of dice at 50% of the flight, 97% at 60% and 100% at
  70%. That is a die coming to rest, not a tell.

The one soft spot in the throw is the teeter. `diceThrow.ts` deliberately rocks the die up
onto a contact edge before dropping it flat, and by construction it always drops back onto
the same face. A real die balanced on an edge can fall either way. Nobody will consciously
notice, but the one moment in the animation that looks like it could still change the
outcome never does. Not worth fixing before the HUD timing.

## 7. Reproducing this

- `npx tsx src/game/diceFairness.check.ts`. Roughly 6 seconds. Verifies the sum, proves
  the sampler equals `applyAction` over 4,000 revisions, runs the full battery on
  2,000,000 rolls per source, then plays 16 complete games through the reducer. The
  seeded column is deterministic; the served column is a live CSPRNG and gets a looser
  bound so it cannot flake.
- The million-roll whole-game runs, the 8,000,000-roll raw equidistribution sweep and the
  presentation measurements are one-off analyses, not part of the check. The check is the
  regression net; this document is the evidence.
