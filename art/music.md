# Katan music

Three pieces, all written and synthesised by `scripts/compose.py`. There is no
generative-audio API in this path and no soundfont. Every sample is computed
from a note list by synths in that file, sent through a convolution reverb built
from a synthesised impulse response, and encoded with ffmpeg.

```
python3 scripts/compose.py              # render all three
python3 scripts/compose.py --only title
python3 scripts/compose.py --no-encode  # WAV plus analysis, no mp3
python3 scripts/compose.py --calibrate  # show the pulse detector's controls
```

Everything is seeded. Two consecutive runs produce byte-identical mp3s, PNGs and
score text.

Supersedes the music rows in `art/audio-manifest.md`, which describe an earlier
set of files derived from the ElevenLabs sound-effects model. That model's music
endpoint returns `402 paid_plan_required` on this account, which is why the score
is written in code. The sound effects and ambience beds in that manifest are
unchanged and still current.

## What ships

| id | file | length | integrated | size |
| --- | --- | --- | --- | --- |
| `music-title` | `music-title.mp3` | 38.39 s loop | -27.4 LUFS | 451 KB |
| `music-match` | `music-match.mp3` | 96.50 s loop | -29.0 LUFS | 943 KB |
| `music-victory` | `music-victory.mp3` | 10.80 s one-shot | -22.4 LUFS | 170 KB |

Total 1.5 MB against a 3 MB budget. The ids are unchanged and `useGameAudio.ts`
needs no edit. `soundbank.ts` reads the loop period from `buffer.duration` at
runtime, so lengths are free to move.

Beds sit around -27 to -29 LUFS, well under the -13 dBFS effects. The victory cue
is a fanfare rather than a bed, so it sits at -22.

## The material

D dorian: D E F G A B C. The match bed is A aeolian, which is the same seven
notes read from A, so title fragments drop into the bed without an accidental.
That relationship is the whole reason for the key.

The motif, "the Sail", 6/8:

```
D4 F4 A4 | G4 B4 A4 | C5 B4 A4 G4 | F4 E4
```

The rising D-F-A opens it. The B natural in bar 2 is the dorian sixth and is what
stops it sounding merely minor. It lands unresolved on E4, so the antecedent asks
a question; the consequent answers by pushing to D5 and closing on D4.

### Title, "The Sail"

D dorian, 6/8, 76 bpm dotted crotchet, 24 bars, 37.89 s.

```
0-3    intro, harp and drone
4-11   A,  the tune on the lute, alone
12-19  A', two choir voices, a tenor counter-line, frame drum
20-23  coda, C-G-Dm turnaround back into the intro texture
```

One chord per bar, no leading tone anywhere, cadences are G-Dm and F-Dm. A single
unbroken D2 pedal runs the whole loop with complementary raised-cosine fades at
both ends, so the tonic never leaves and the wrap has no dip in it.

The four written voices in bars 12-19:

```
       bar    12   13   14   15   16   17   18   19
       chord  Dm   G    Am   Dm   Dm   F    G    Dm
tune          D4   G4   C5   F4   D4   C5   B4   F4
choir upper   A3   B3   A3   A3   A3   A3   G3   A3
choir lower   F3   --   E3   --   F3   F3   D3   --
bass          D3   G2   A2   D3   D3   F2   G2   D3

counter  12.2:F2/4  13.1:G2/2  13.3:B2/3  14.2:C3/4  15.0:D3/3
         16.2:A3/3  17.1:A3/2  17.3:F3/3  18.3:B2/3  19.0:A2/6
```

The bowed strings double the lute an octave down through A'. That is
orchestration, not counterpoint: an octave doubling of one line is one line, so
they are not registered as a voice in the check.

### Match, "Long Water"

A aeolian, no metre, 96.00 s.

Six 16-second harmonic areas, each a lean rather than a cadence, all voiced over
one unbroken A pedal so no area needs a bass move:

```
0 s Am    16 s Fmaj7/A    32 s Am7    48 s Gsus/A    64 s Dm7/A    80 s Am
```

The last area returns to the opening voicing exactly, so the wrap is not a chord
change. Motif fragments appear six times in 96 s, only ever the head (D-F-A) or
the tail (C-B-A-G), never the whole tune. Seven bells and seven frame-drum
strokes, all at irregular spacings.

### Victory, "Landfall"

D dorian into D major, 10.80 s, does not loop.

```
melody  D4 F4 A4 C5 B4 C5 A4 | B4 A4 G4 A4 B4 C5 | D5 C#5 | D5
chords  Dm  F/A  Em  G  D/A  A7  D
```

One arch up to C5, a fall to the phrase floor of G4, then a scalar run G-A-B-C
into the cadence. The high D5 is held back until the six-four, so the piece has
exactly one climax and it is inside the cadence rather than before it. Note
values shorten through the run and broaden again at the arrival.

The cadence is IV, cadential six-four, V7, I:

```
G      the dorian major subdominant, the predominant
D/A    tonic triad over the dominant bass; its sixth F#3 and fourth D3 are
       suspensions waiting on the dominant
A7     F#3 to E3 resolves the sixth, A3 to G3 adds the seventh, and the melody
       C#5 resolves the fourth
D      C#5 to D5 as the leading tone, G3 to F#3 as the seventh
```

The pedal cadences too: D under the phrase, A under the six-four and the
dominant, D again at the arrival. C# is the only note outside D dorian in the
whole score and it lasts 0.6 s.

## How it is checked

Nobody involved can hear these files, so every claim is a measurement. All of it
lands in `art/critique/music-score.txt` and three images, regenerated on every
run.

**Counterpoint.** `voice_leading_report` builds the sonority at every onset and
walks every pair of written voices, reducing compound intervals. It flags
parallel unisons, fifths and octaves; direct fifths and octaves reached by
similar motion where the upper voice leaps; and any pair that never moves
independently. It reads notated positions, not humanised ones, so 14 ms of rubato
cannot hide a parallel octave. All three pieces currently report no faults.

Two defects it caught, both now fixed:

- The choir was the bar's chord transposed up an octave. That put its top voice
  on the melody's own pitch at every downbeat of bars 12-19 and marched it in
  parallel unison with the tune from bar 13 to 14 and again from 14 to 15. It is
  now two written inner parts.
- The counter-line was one note per bar, entering on every downbeat with the
  melody, so it read as harmony rather than as a second part. It is now a tenor
  line with its own rhythm, contour and apex.

**Loops.** Two checks. `seam_report` works on the pre-encode audio: the file's
tail is a copy of its own head and `SoundBank` crossfades with linear gains that
sum to one, so the overlap must equal the head sample for sample. Measured error
is around -299 dB below peak, which is float noise. `mp3_seam_report` then does
it again on the shipped mp3, because an encoder is entitled to add delay and
padding: it confirms the decode is gapless and that the largest sample step at
the join is smaller than the largest step anywhere in the file. The 3 dB level
difference across the title's join is the coda handing back to the thinner intro,
which is written that way.

**Metronome.** `pulse_report` autocorrelates half-wave-rectified spectral flux,
analysed wrapped around itself. A single strong value proves nothing, so it tests
for a peak at a period *and* peaks at integer multiples of it. `--calibrate`
prints two controls: a drone with no onsets at all, and a frame drum every 1.2 s,
which is the exact defect that made an earlier match bed unusable. Nothing in the
current three has a periodic series under 1.5 s.

**Balance.** Octave-band energy share, so "mud" or "fizz" is a number.

The match bed measures dark: 41% of its energy in 125-250 Hz and 0.1% above
4 kHz. That is deliberate rather than neglected. `amb-ocean` plays underneath it
for the whole match and carries 67% of its energy between 500 Hz and 4 kHz, so
the two are complementary, and the region the bed leaves empty is also where the
dice, clicks and UI effects live.

## Images to look at

- `art/critique/music-score.png` — piano roll, one panel per piece, coloured by
  track.
- `art/critique/music-spectra.png` — spectrogram and waveform per piece.
- `art/critique/music-seams.png` — each loop concatenated to itself through the
  real crossfade, centred on the join.
