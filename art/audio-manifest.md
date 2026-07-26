# Katan audio manifest

Pre-planned shopping list for ElevenLabs generation. The point of writing it
down first is credit efficiency: generate deliberately once, do not explore.

> **Status: round two, July 26, 2026.** 39 files in `public/assets/audio`,
> 1.31 MB. Regenerate with `python3 scripts/generate-audio.py` (`--dry-run`
> costs nothing, and a rerun re-bills nothing because raw generations are
> cached in `tmp/audio-raw`). Actual spend and every deviation are recorded
> below; round two's results are in their own section at the end.

## Budget

Free tier, 10,000 credits total. **1,998 spent as of July 26, 2026** across two
rounds; see "Round two" at the end for the current figure and the per-item
outcomes. The prompt-intent tables below are the original plan — where round two
rewrote a prompt, the script is the source of truth, not this list.

Measured cost: a 0.5s sound effect billed 5 credits, so **~10 credits per
second of generated audio**, and `duration_seconds` is billed whether or not
you use the whole clip. Verify this holds as you go — check
`/v1/usage/character-stats?breakdown_type=product_type` after each batch, not
`/v1/user/subscription` (sound-effect usage does not appear there).

**Hard cap: 5,000 credits** (6,500 in round one, revised down when round two
budgeted the remaining work). Stop and report if you approach it. The list below
budgets to roughly 1,000 credits for SFX, leaving room for music, which is
priced differently and may not be available on the free tier at all.

## Credit-efficiency rules

1. **Always pass `duration_seconds`.** Omitting it bills a flat auto rate that
   is worse for anything under a second.
2. **Loop the beds.** `loop: true` (v2 model) on ambience means a 10s
   generation covers unlimited playtime. Never generate long ambience.
3. **Derive variations locally, never from the API.** Three dice-settle
   variants come from one source clip via pitch and rate shifts in ffmpeg, at
   zero credits. Same for footstep-style repeats and UI click families. This is
   the single biggest saving available.
4. **No regeneration for taste.** Audition, and only regenerate the specific
   items that genuinely failed. Two attempts maximum per item, then take the
   best and fix it locally.
5. Generate at `mp3_44100_128`, then trim silence and normalise locally.
   Ship whatever is smallest that still sounds right.

## Sound effects

Durations are the generation length, in seconds.

### Dice — the emotional centre of a turn
| id | dur | prompt intent |
|----|-----|---------------|
| `dice-shake` | 1.2 | two wooden dice rattling inside a cupped leather cup |
| `dice-tumble` | 1.5 | dice tumbling and bouncing across a wooden board, coming to rest |
| `dice-settle` | 0.5 | final single click of a die settling on wood |

### Placement
| id | dur | prompt intent |
|----|-----|---------------|
| `place-settlement` | 1.0 | wooden building piece set firmly onto a board, soft thud |
| `place-city` | 1.2 | heavier stone block set down, low weight, small grit |
| `place-road` | 0.8 | cobblestones laid, brief stone-on-stone scrape |

### Economy
| id | dur | prompt intent |
|----|-----|---------------|
| `resource-gain` | 0.8 | soft warm chime with a light material rustle |
| `trade-accept` | 1.0 | small handful of coins exchanged |
| `card-draw` | 0.6 | single card sliding off a deck |
| `dev-card-play` | 1.0 | parchment unfurling with a soft magical chime |

### Robber and tension
| id | dur | prompt intent |
|----|-----|---------------|
| `robber-move` | 1.2 | low ominous cloth-and-stone scrape, dread |
| `robber-steal` | 0.8 | quick snatch, cloth grab |
| `roll-seven` | 1.0 | low tense orchestral hit, brief |

### Achievements
| id | dur | prompt intent |
|----|-----|---------------|
| `longest-road` | 1.5 | short brass horn flourish, medieval |
| `largest-army` | 1.5 | short martial drum and brass flourish |
| `victory` | 4.0 | triumphant orchestral fanfare, seafaring, warm |
| `defeat` | 3.0 | subdued descending orchestral resolve, dignified not comic |

### UI
| id | dur | prompt intent |
|----|-----|---------------|
| `ui-hover` | 0.3 | very soft wooden tick |
| `ui-click` | 0.4 | firm confirming wooden click |
| `ui-open` | 0.5 | soft parchment and leather panel opening |
| `ui-close` | 0.4 | soft panel closing |
| `ui-error` | 0.5 | dull muted thud, clearly negative, not harsh |
| `turn-start` | 1.0 | warm brief bell, "your turn", inviting |
| `notify` | 0.6 | soft distant wooden knock |

**SFX subtotal:** ~26s of generation ≈ 260 credits, plus a small allowance for
second attempts. Budget 600.

## Ambience — looping beds

| id | dur | loop | prompt intent |
|----|-----|------|---------------|
| `amb-ocean` | 10 | yes | waves washing against rock, mid distance, no gulls |
| `amb-island` | 10 | yes | light coastal wind, distant gulls, faint surf |
| `amb-forest` | 8 | yes | soft wind through pine, sparse birds |

**Subtotal:** 28s ≈ 280 credits.

## Music — superseded, see `art/music.md`

**The music is no longer generated by ElevenLabs and costs no credits.**
`POST /v1/music` returns `402 paid_plan_required` on this free tier, verified at
the endpoint's 3-second minimum. The fallback described below did ship briefly:
two sound-effect-model drones standing in for a score. They are gone.

All three cues are now composed and synthesised in code by
`scripts/compose.py` — numpy and scipy, Karplus-Strong plucked strings, bowed
pads, formant choir, frame drum and a convolution reverb. Read `art/music.md`
for the key, form, motif and how to regenerate. The ids are unchanged, so
`soundbank.ts` and `useGameAudio.ts` needed no edit.

| id | what ships now |
|----|----|
| `music-title` | "The Sail", D dorian, 6/8 at 76bpm, 38.4s seamless loop |
| `music-match` | "Long Water", A aeolian, no metre, 96.5s loop, no periodic element under 1.5s |
| `music-victory` | "Landfall", D dorian into D major, 10.8s, does not loop |

Anything below this line about music generation is historical.

## Delivery

- Files land in `public/assets/audio/` as `<id>.mp3`, plus an `.ogg` fallback
  only if a target browser needs it.
- Keep the whole audio payload under 4MB. Ambience beds and music dominate
  this; trim and re-encode rather than shipping raw output.
- Loudness: normalise SFX to a consistent perceived level so nothing spikes.
  Ambience and music sit well below SFX.

## What was actually spent

Verified against `/v1/usage/character-stats?breakdown_type=product_type`.
The measured rate held exactly: 10 credits per second of `duration_seconds`.

| | credits |
|---|---|
| Already spent before this pass | 5 |
| Generations kept | 832 |
| Failed attempts (see below) | 471 |
| **Total on the account** | **1,308** |
| Remaining of 10,000 | 8,692 |
| Hard cap at the time | 6,500, never approached |

Per item, the kept generations:

| id | s | credits | | id | s | credits |
|---|---|---|---|---|---|---|
| dice-shake | 1.2 | 12 | | victory | 4.0 | 40 |
| dice-tumble | 1.5 | 15 | | defeat | 3.0 | 30 |
| place-settlement | 1.0 | 10 | | ui-hover | 0.5 | 5 |
| place-city | 1.2 | 12 | | ui-open | 0.5 | 5 |
| place-road | 0.8 | 8 | | ui-close | 0.5 | 5 |
| resource-gain | 0.8 | 8 | | turn-start | 1.0 | 10 |
| trade-accept | 1.0 | 10 | | notify | 0.6 | 6 |
| card-draw | 0.6 | 6 | | amb-ocean | 10 | 100 |
| dev-card-play | 1.0 | 10 | | amb-island | 10 | 100 |
| robber-move | 1.2 | 12 | | amb-forest | 8 | 80 |
| robber-steal | 0.8 | 8 | | music-title | 22 | 220 |
| roll-seven | 1.0 | 10 | | music-victory | 8 | 80 |
| longest-road | 1.5 | 15 | | | | |
| largest-army | 1.5 | 15 | | **total** | | **832** |

Failed attempts, all of them the same failure: the model returned a file of
near-silence, 30 to 45 dB below anything usable.

| id | attempts | wasted | outcome |
|---|---|---|---|
| `music-match` | 2 | 440 | raw came back at -59 then -66 LUFS; derived from `music-title` instead |
| `dice-settle` | 2 | 13 | raw RMS peak -47 dBFS; cut out of `dice-tumble` instead |
| `robber-steal` | 1 | 8 | second attempt worked and is what ships |
| `ui-click` | 1 | 5 | raw RMS peak -52 dBFS; cut out of `ui-hover` instead |
| `ui-error` | 1 | 5 | raw RMS peak -42 dBFS; cut out of `place-city` instead |

## Deviations from the plan

- **Music is not from the Music API.** `POST /v1/music` returns
  `402 paid_plan_required` ("Music API is not available for free users") for
  every request, including the 3-second minimum. The probe cost nothing.
  `music-title` and `music-match` are looping ambient beds from the
  sound-effects model, as the fallback in this file describes. `music-title`
  is a slow drone, not a theme, and it is labelled that way on purpose.
- **`music-match` is derived, not generated.** Two 220-credit attempts came
  back as silence. It is now `music-title` with a 1.1 kHz lowpass and the
  level dropped, which is what a match bed should be anyway: the same world,
  pushed into the background.
- **Nine files are derived locally at zero credits**, up from the three the
  plan assumed: `dice-settle`, `dice-settle-b`, `dice-settle-c`, `ui-click`,
  `ui-click-soft`, `ui-click-deep`, `ui-error`, `music-match`,
  `place-road-alt`. Five of those replace failed generations.
- **`duration_seconds` has a 0.5 s floor.** The 0.3 s and 0.4 s UI hits in the
  plan were generated at 0.5 s and trimmed locally, so they cost 5 credits
  each rather than 3 or 4.
- **Normalisation is a measured static gain, not `loudnorm`.** Single-pass
  `loudnorm` applies time-varying gain, which put a 3 to 5 dB level jump at
  the loop point of every bed. Beds are matched on integrated LUFS (-30 for
  ambience, -27 for music); hits are too short for gated loudness, so they are
  matched on loudest-window RMS (-13 dBFS for effects, -11 for accents).
- **Beds loop with a player-side crossfade.** Each file already wraps its own
  tail onto its head, but MP3 carries decoder padding that puts a tick at the
  seam, so `SoundBank.setBeds` overlaps two voices by 0.5 s.

## Verified

- 0 clipped samples across all 35 files; loudest is -1.02 dBFS.
- Spectrograms of each bed looped twice show no level jump or spectral break
  at the seam.
- Every file loads and decodes in Chrome from the dev server; the bank reports
  not-ready before a gesture and ready after one.
- Payload 1.04 MB of the 4 MB budget.

---

# Round two, July 26, 2026

The client lifted the austerity: "I am also fine about generating the failed
audio assets, because we have lots of credits left." New cap **5,000 credits**
on the account, against 1,308 already spent.

## Spend

| | credits |
|---|---|
| On the account before round two | 1,308 |
| Spent in round two | 690 |
| **Total on the account** | **1,998** |
| Remaining of the 5,000 cap | 3,002 |
| Remaining of the 10,000 tier | 8,002 |

Verified against `/v1/usage/character-stats?breakdown_type=product_type`, which
reads `Sound Effects: 1998`. `/v1/user/subscription` still reports zero for
sound effects and is still the wrong endpoint to ask.

| generation | s | credits | kept |
|---|---|---|---|
| `dice-settle` attempt 1 | 0.5 | 5 | yes |
| `ui-click` attempt 1 | 0.5 | 5 | no |
| `ui-click` attempt 2 | 0.5 | 5 | yes |
| `ui-error` attempt 1 | 0.5 | 5 | no |
| `ui-error` attempt 2 | 0.5 | 5 | yes |
| `music-match` attempt 1 | 22 | 220 | no |
| `music-match` attempt 2 | 24 | 240 | yes |
| `amb-harbour` | 10 | 100 | yes |
| `amb-tension` | 10 | 100 | yes |
| `board-thud` (layer source) | 0.5 | 5 | yes |
| **total** | | **690** | 8 of 10 attempts kept |

## Why round one produced silence, and what fixed it

Every round-one failure asked the model for a *quiet* sound: "very soft tiny
wooden tick", "dull muted thud", "final single click of a die settling",
"subdued low bed, minimal melody". The model obeyed. It rendered the adjective,
not the event, and handed back files 35 to 50 dB below anything usable.

The fix is to describe a loud, close-miked, named physical event and dial the
character in locally afterwards. `ui-error` is the clearest case: asking for a
dull negative thud gave pure sub-bass rumble with no impact in it, while asking
for "a heavy oak gate bar dropped into its iron bracket, loud" came back hot and
bright at -5.5 dBFS RMS peak, and a 3.2 kHz lowpass in ffmpeg makes it dull and
negative for free. **Ask the API for the event. Ask ffmpeg for the mood.**

## Per item: regenerated or kept as derived

| id | verdict | why |
|---|---|---|
| `dice-settle` | **regenerated** | Decisive. The derived version was a 300 ms slice of `dice-tumble` that contains *five separate impacts* — it was a burst of rattling, not a settle, and the roll sequence fired two of them 170 ms apart. The new generation is one clean transient at 33 ms with a smooth decay. |
| `dice-settle-b`, `-c` | **re-derived from the new settle** | Same defect: six and five impacts respectively. They now come off the single clean transient, pitch- and rate-shifted. One die, one landing, three weights of it. |
| `ui-click` | **regenerated** | The derived click was the hover tick pitched down 4 semitones and cut to 65 ms: a flat midrange band with no attack shape and nothing below 1 kHz. The new rap has a real attack and body down to 200 Hz. |
| `ui-click-soft`, `-deep` | **re-derived from the new click** | Round one's argument — that the click family reads as one UI because it is one piece of wood — is correct and is kept. The family just moved onto a better piece of wood. It is deliberately *not* the same wood as `ui-hover`: a commit should weigh more than a hover. |
| `ui-error` | **regenerated** | The derived version was `place-city` pitched down, which is to say the build sound played wrong. An error should not be a building. |
| `music-match` | **regenerated** | The biggest win. It was a lowpassed copy of `music-title` — the same 22 seconds a player already heard on the title screen, for the whole match. It is now its own 24 s bed: slow swells, no melody, no percussion, and a longer cycle than anything else in the game. |

Attempt 1 of `music-match` (220 credits, not kept) is worth recording. It came
back audible at -32.7 LUFS, so it was not a failure in the round-one sense, but
its spectrogram showed a hand-drum transient every 1.2 seconds, dead regular.
A metronome under an hour of play is worse than a dull drone. Attempt 2 dropped
the percussion from the prompt explicitly and rebuilt the wording around the
*title* prompt's shape, which had demonstrably produced a rich bed.

## Added beyond the failures

| id | credits | why it earns a place |
|---|---|---|
| `amb-harbour` | 100 | The lobby now sits at the dock instead of on the same open water as the match. Dock timbers, rope, hulls, faint gulls. |
| `amb-tension` | 100 | A board state, not an event. While the robber is loose it replaces `amb-island`, so the board stops sounding like the same calm afternoon whatever is happening on it. |
| `board-thud` | 5 | Layer source, never shipped on its own. Mixed under all three placement hits so every piece set on the board shares one table resonance. This is what "these sounds happen in the same room" actually means, and it is the layered-foley gap round one named. |
| `place-settlement-alt`, `place-city-alt` | 0 | Derived. Building the same thing twice in a row no longer replays one sample. `placementSound()` picks by coordinate, not `Math.random()`, so a given hex always sounds the same. |

## Two bugs found and fixed in already-shipping assets

Neither was a round-two generation; both were in files round one had passed.

- **`place-settlement` fired 227 ms late and `place-city` 94 ms late.** The
  attack in those raws sits 219 ms and 348 ms in, behind low-level room tone
  that survives the -40 dB silence trim, so `silenceremove` left it in place.
  You clicked to build and the thud arrived a fifth of a second later. Both are
  now sliced to the measured attack foot: 9.4 ms and 11.6 ms. `ui-close` had a
  milder case of the same thing, 46.5 ms, also fixed.
- **The settle family was a rattle, not a settle** — five or six impacts per
  variant. Covered above.

A third, introduced and then fixed inside round two: the first cut of the foley
layer hard-cut where `board-thud` ran out, which put a click a fifth of the way
into every build. The fade now lands inside the layer's own material and the
layer is padded to the window.

## Verified, instrumentally

I cannot hear. Everything below is measured or read off a rendered image, and
`afplay` was not used as evidence for anything.

- **0 clipped samples across all 39 files.** Loudest sample peak is -0.5 dBFS
  (`dice-settle`), and no file exceeds -0.2.
- **No dead air before any transient.** Every one-shot's first sample at 25 % of
  its own peak lands under 50 ms; the slowest is `robber-move` at 41 ms, which
  is a gradual scrape and correct.
- **Loudness consistent.** Beds within 1.3 dB of their integrated targets
  (-30 LUFS ambience, -27.5 music). Hits matched on loudest-window RMS.
- **Loops are seamless under the crossfade the bank actually uses.** Rendering
  each bed against itself with the bank's 0.5 s equal-power overlap and
  measuring 100 ms RMS blocks across the seam gives a spread of 0.1 to 0.5 dB,
  and the seam spectrograms show no vertical line and no spectral break. A
  *naive* end-to-end concat does show a click on every bed — that is the MP3
  decoder padding, and hiding it is exactly why `SoundBank.setBeds` overlaps
  two voices.
- **Spectrograms inspected as images** for all four regenerations, both new
  beds, all three settle variants, all three placements and their alts. That
  inspection is what caught the five-impact settle and the layer click; neither
  showed up in any level measurement.
- **39 ids in `soundbank.ts`, 39 files, no orphan either way**, and every file
  decodes cleanly under ffmpeg.
- `npx tsc -b --noEmit` is clean and `npm test` passes.
- **Payload 1.31 MB of the 4 MB budget**, up from 1.04 MB.

## Still true, still blocked

`POST /v1/music` still returns `402 paid_plan_required`. Round one verified it
at the 3-second minimum and it was not retried. Both music beds remain looping
output from the sound-effects model, which is why the honest name for them is
"bed" and not "theme".

## Sound id changes

Four ids added: `amb-harbour`, `amb-tension`, `place-settlement-alt`,
`place-city-alt`. No ids removed. `placementSound()` is a new export in
`soundbank.ts`. The wiring proposal at
`scratchpad/useGameAudio.proposed.ts` has been updated to match — it moves the
lobby to `amb-harbour`, swaps `amb-island` for `amb-tension` while the robber is
loose, and routes all three build sounds through `placementSound()`.

## Honest score: 7/10

Up from round one's 5. What earned it: the match bed is now its own piece of
material instead of a recycled title screen, the two worst latency bugs in the
game are gone, the dice actually settle instead of rattling, placements share a
table, and the board has more than one emotional state.

What still holds it back, and the caveat has to be stated plainly: **there is no
music in this game.** Both "music" beds are sound-effect-model drones, because
the Music API is paid-only on this tier. `music-match` is a good drone and it
will not irritate over an hour, but a drone is not a score — there is no theme,
no motif, nothing a player could hum, and nothing that develops as a match does.
The victory fanfare is the only cue with any melodic shape and it is four
seconds long. Beyond that: still no real reverb send, so the table resonance is
a baked layer rather than a space the sounds sit in; still no positional audio
tied to where a piece actually is on the board, only a fixed pan on the dice;
and the trade and card sounds are single samples that will wear thin. Getting
past 7 needs a paid music plan, not more credits on this one.
