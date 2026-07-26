#!/usr/bin/env python3
"""Generate the Katan sound bank with the ElevenLabs sound-effects API.

Credits are the binding constraint (free tier, 10,000 total, never refilled),
so this script is built to spend as little as possible:

  * every generated item passes an explicit ``duration_seconds`` -- the API
    bills on requested duration, and omitting it bills a worse flat rate
  * ambience and the music beds are generated with ``loop: true`` so ten to
    twenty seconds of audio covers unlimited playtime
  * raw generations are cached in ``tmp/audio-raw`` and skipped if present,
    so a rerun never re-bills
  * variations (dice settles, click family) are derived locally with ffmpeg
    from an already-paid-for source clip, at zero credits

Usage
    python3 scripts/generate-audio.py --dry-run          # cost, spends nothing
    python3 scripts/generate-audio.py                    # generate + master
    python3 scripts/generate-audio.py --only dice-shake  # one item
    python3 scripts/generate-audio.py --post-only        # remaster from cache
    python3 scripts/generate-audio.py --usage            # spend so far
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "tmp" / "audio-raw"
OUT_DIR = ROOT / "public" / "assets" / "audio"

API = "https://api.elevenlabs.io/v1/sound-generation"
USAGE_API = "https://api.elevenlabs.io/v1/usage/character-stats"
MODEL = "eleven_text_to_sound_v2"
OUTPUT_FORMAT = "mp3_44100_128"

# Measured empirically: a 0.5s effect billed 5 credits.
CREDITS_PER_SECOND = 10.0
HARD_CAP = 5000  # round two: the client's stated ceiling on the account

# The API refuses anything shorter than this; short UI hits are generated at
# the floor and trimmed locally.
MIN_DURATION = 0.5

# Loudness targets. Beds are matched on integrated LUFS; hits are too short
# for gated loudness so they are matched on loudest-window RMS. Ambience and
# music sit well under the effects so hours of play never fatigue.
LUFS = {"ambience": -30.0, "music": -27.0}
RMS_PEAK = {"sfx": -13.0, "accent": -11.0}

# Nothing ships above this decoded true peak.
TRUE_PEAK_CEILING = -1.5

# Shortest file we will encode. A 70 ms mono clip at 96 kbps came out as an mp3
# that ffmpeg refuses to open at all -- not quiet, not clipped, *undecodable*,
# and only at some gains, which is what makes it so easy to miss. There are too
# few frames for the decoder to sync on after the ID3 and Xing headers. Padding
# the tail with digital silence costs a few hundred bytes and removes the whole
# class of failure; a one-shot with silence on the end plays identically.
MIN_ENCODED = 0.16


@dataclass(frozen=True)
class Item:
    """One paid generation."""

    id: str
    duration: float
    prompt: str
    bus: str = "sfx"
    loop: bool = False
    influence: float = 0.45
    # Post-processing.
    start: float = 0.0              # slice offset into the raw, seconds
    trim_head: bool = True          # strip leading silence so hits feel instant
    keep: float | None = None       # hard length cap after trimming, seconds
    mono: bool = False
    wrap: float = 0.0               # crossfade the tail onto the head, seconds
    bitrate: str = "96k"
    filters: str = ""               # extra ffmpeg -af stage, applied first
    # Foley layers mixed underneath, as (raw id, gain dB, lowpass Hz, delay s).
    # The layer's own attack must already sit at t=0 in its raw.
    layers: tuple[tuple[str, float, int, float], ...] = ()
    ship: bool = True               # False for sources that only feed layers

    @property
    def billed(self) -> float:
        return max(self.duration, MIN_DURATION)

    @property
    def credits(self) -> float:
        return self.billed * CREDITS_PER_SECOND


@dataclass(frozen=True)
class Derived:
    """A free local variation of an already-generated item."""

    id: str
    source: str
    # ffmpeg atempo/asetrate pair. semitones shifts pitch and speed together,
    # tempo then pulls the speed back if you want pitch-only movement.
    start: float = 0.0              # slice offset into the source, seconds
    semitones: float = 0.0
    tempo: float = 1.0
    gain_db: float = 0.0
    bus: str = "sfx"
    keep: float | None = None
    trim_head: bool = True
    mono: bool = False
    wrap: float = 0.0
    filters: str = ""               # extra ffmpeg -af stage, applied first
    bitrate: str = "96k"
    layers: tuple[tuple[str, float, int, float], ...] = ()
    notes: str = ""


ITEMS: tuple[Item, ...] = (
    # -- Dice: the emotional centre of a turn -----------------------------
    Item("dice-shake", 1.2, "two wooden dice rattling inside a cupped leather dice cup, dry close-mic, no room reverb", mono=True),
    Item("dice-tumble", 1.5, "two wooden dice tumbling and bouncing across a thick wooden board and coming to rest, dry, close", mono=True),
    # Round two. The first prompt ("final single click of a die settling",
    # soft/quiet wording) came back 43 dB down. Asking for a *loud* close-miked
    # knock instead produced a clean single transient at 33 ms.
    Item("dice-settle", 0.5,
         "single hardwood die lands and clacks loudly on a solid oak table, sharp bright knock, "
         "close microphone, dry, loud",
         mono=True, influence=0.3, start=0.025, keep=0.30, trim_head=False,
         filters="lowpass=f=14000:poles=2"),
    # Round three. The rigid-body throw schedules the six loudest contacts of a
    # roll at their real contact times, gained and pitched by impact energy.
    # Three sources cannot carry that: at six knocks a roll you hear the same
    # sample twice within 200 ms and the ear reads it as a flam, not a die.
    #
    # These five are *different physical events*, not five pitches of one. The
    # playback layer already varies pitch and gain, so more of that adds
    # nothing; what it cannot synthesise is a different contact. A die dropping
    # its last two millimetres flat onto wood, a corner landing that tips over,
    # and a cube slapping a cardboard board are three different noises with
    # three different spectra, and the scheduler now picks between them by the
    # contact's own energy.
    #
    # Every prompt names a loud, close-miked object. Round one proved that
    # asking for "soft" or "muted" returns 40 dB of nothing; the softness is
    # dialled in afterwards with a lowpass and the bank's per-hit gain.
    # The raw holds two ticks, at 10 ms and 100 ms. The second is the richer of
    # the pair — it carries down to 2 kHz where the first is all top — so the
    # slice starts on it. Taking the file from zero would have shipped a die
    # that lands twice, which is the exact defect round two found in the old
    # derived settles.
    Item("dice-settle-d", 0.5,
         "a small polished bone die flicked hard onto a bare hardwood tabletop, one very bright "
         "sharp tick, close microphone, dry, loud",
         mono=True, influence=0.35, start=0.098, keep=0.14, trim_head=False,
         filters="lowpass=f=16000:poles=2"),
    # Attempt 1 ("dropped flat ... from two centimetres ... no rattle") came
    # back at -63 dBFS. Round one's lesson again, and it is a subtle version of
    # it: no adjective in that prompt says "quiet", but *two centimetres* and
    # *no rattle* both describe a small event, and the model sizes the sound to
    # the event. Attempt 2 describes the same physical contact as a large one.
    # `dice-settle-e`, the flat-face landing, is the one slot the API would not
    # fill. Three attempts, three different failures, all in the raws under
    # `tmp/audio-raw/failed-round3`: -63 dBFS silence, then -42 dBFS of low wash
    # with no transient in it, then a mallet on a workbench that does have an
    # attack but rings on a 2 kHz tone for 450 ms. A die does not ring. Six of
    # those a roll would be a bell, so the slot is derived from the deep knock
    # below instead — see DERIVED. Recorded rather than quietly dropped because
    # "ask for a loud named object" is necessary and, here, not sufficient.
    Item("dice-settle-f", 0.5,
         "a solid oak cube knocked down hard onto a thick wooden tabletop, one deep resonant woody "
         "knock with body, close microphone, dry, loud",
         mono=True, influence=0.4, start=0.050, keep=0.28, trim_head=False,
         filters="lowpass=f=9000:poles=2"),
    Item("dice-settle-g", 0.5,
         "a wooden die lands hard on a thick cardboard game board, one blunt dry papery knock, "
         "close microphone, no reverb, loud",
         mono=True, influence=0.4, start=0.026, keep=0.22, trim_head=False,
         filters="lowpass=f=7000:poles=2,highpass=f=70"),
    # Attempt 1 asked for a corner landing that tips over — a sharp tick then a
    # heavier settle — and came back as one thin mid scuff at -29 dBFS. Two
    # reasons not to retry it: the model does not sequence a two-part event
    # reliably, and the scheduler does not want one, because it already places
    # each contact at its own simulated time. A sample that lands twice would
    # double every knock. Attempt 2 asks for the one contact the family was
    # missing entirely: die on die, which the simulation models and the old
    # three sources had no sound for.
    #
    # Attempt 2 is loud (-6.7 dBFS) and its first crack is clean, but the clip
    # is a seven-impact rattle: strikes at 0, 60, 125, 165, 210, 255 and 330 ms,
    # visible on the spectrogram and invisible in every level number. The second
    # is only 1.6 dB down on the first, so a slice that keeps it ships a die that
    # lands twice. The window takes the first crack alone and is fully faded by
    # 50 ms, where the clip is 25 dB down and the next strike has not started.
    Item("dice-settle-h", 0.5,
         "two hardwood dice smacked together hard in mid air, one loud sharp wooden crack, "
         "close microphone, dry, no reverb",
         mono=True, influence=0.45, start=0.001, keep=0.05, trim_head=False,
         filters="lowpass=f=15000:poles=2"),
    # -- Placement ---------------------------------------------------------
    # The attack in these raws sits 219 ms and 348 ms in, behind low-level room
    # tone that survives the -40 dB silence trim. Slicing to the measured
    # attack foot is the difference between a build that answers the click and
    # one that lags it by a fifth of a second.
    Item("place-settlement", 1.0, "small wooden building piece set firmly down on a wooden board, soft warm thud, single hit",
         mono=True, start=0.213, keep=0.7, trim_head=False,
         layers=(("board-thud", 5.0, 380, 0.004),)),
    Item("place-city", 1.2, "heavy stone block set down on wood, low weighty thud with a little grit, single hit",
         mono=True, start=0.342, keep=0.9, trim_head=False,
         layers=(("board-thud", 10.0, 420, 0.006),)),
    Item("place-road", 0.8, "two small cobblestones laid together, brief stone on stone scrape and set, single hit",
         mono=True, keep=0.6, layers=(("board-thud", 1.0, 340, 0.004),)),
    # -- Economy -----------------------------------------------------------
    Item("resource-gain", 0.8, "soft warm marimba chime with a light rustle of grain and wool, pleasant, short", keep=0.7),
    Item("trade-accept", 1.0, "small handful of coins exchanged between hands, light metallic jingle, short", keep=0.8),
    Item("card-draw", 0.6, "single playing card sliding off the top of a deck, crisp paper slide, very short", mono=True, keep=0.4),
    Item("dev-card-play", 1.0, "parchment scroll unfurling with a soft magical shimmer chime, medieval, short", keep=0.9),
    # -- Robber and tension ------------------------------------------------
    Item("robber-move", 1.2, "low ominous scrape of heavy cloth dragging over stone, dread, dark, no music", keep=1.1),
    Item("robber-steal", 0.8, "loud close-miked snatch, a handful of heavy cloth grabbed and yanked away fast, full volume, single gesture", mono=True, keep=0.6),
    Item("roll-seven", 1.0, "short low tense orchestral hit, dark strings and a soft timpani, single stab", bus="accent", keep=1.0),
    # -- Achievements ------------------------------------------------------
    Item("longest-road", 1.5, "short medieval brass horn flourish, two notes rising, triumphant, dry hall", bus="accent"),
    Item("largest-army", 1.5, "short martial flourish, snare drum roll into a brass hit, medieval, confident", bus="accent"),
    Item("victory", 4.0, "triumphant seafaring orchestral fanfare, warm brass and strings, hopeful resolve, ends cleanly", bus="accent"),
    Item("defeat", 3.0, "subdued descending orchestral resolve, low strings and soft horn, dignified and sombre, not comic", bus="accent"),
    # -- UI ----------------------------------------------------------------
    # The tick lands 150 ms into the raw and there is a second, weaker tap
    # 44 ms after it. Slicing to the first transient keeps the UI from feeling
    # laggy and stops every click sounding like a double click.
    Item("ui-hover", 0.5, "very soft tiny wooden tick, quiet, dry, single, extremely short",
         mono=True, start=0.145, keep=0.05, trim_head=False, bitrate="80k"),
    # Round two. "Firm confirming wooden click" came back 49 dB down; a named
    # object struck hard ("wooden chess piece knocked onto a board") at a much
    # higher prompt_influence gave a real rap with body down to 200 Hz. It is a
    # different piece of wood from the hover tick on purpose -- a commit should
    # weigh more than a hover -- so the whole click family now derives from it.
    Item("ui-click", 0.5,
         "a wooden chess piece knocked down hard onto a hardwood board, one sharp bright rap, "
         "close microphone, dry, no reverb",
         mono=True, influence=0.55, start=0.012, keep=0.13, trim_head=False,
         bitrate="80k", filters="lowpass=f=14000:poles=2"),
    Item("ui-open", 0.5, "soft parchment and leather panel opening, gentle short whoosh", mono=True, keep=0.4, bitrate="80k"),
    Item("ui-close", 0.5, "soft leather panel closing, gentle short muted whoosh",
         mono=True, start=0.022, keep=0.35, trim_head=False, bitrate="80k"),
    # Round two. "Dull muted thud, clearly negative" produced pure sub rumble;
    # a gate bar dropped into a bracket came back hot and bright, so the dull
    # negative character is dialled in locally with a lowpass rather than asked
    # for in the prompt -- asking for quiet is what caused the silence.
    Item("ui-error", 0.5,
         "a heavy oak gate bar dropped into its iron bracket, one blunt low wooden clunk, "
         "loud, close microphone, dry",
         mono=True, influence=0.5, start=0.020, keep=0.34, trim_head=False,
         bitrate="80k", filters="lowpass=f=3200:poles=2,highpass=f=55"),
    Item("turn-start", 1.0, "warm brief brass hand bell, single inviting note, gentle decay", keep=1.0),
    Item("notify", 0.6, "soft distant wooden knock, two taps, quiet and polite", mono=True, keep=0.5, bitrate="80k"),
    # -- Ambience: looping beds -------------------------------------------
    Item("amb-ocean", 10.0, "steady ocean waves washing against rock at mid distance, no gulls, no music, continuous",
         bus="ambience", loop=True, influence=0.6, trim_head=False, wrap=0.6, bitrate="80k"),
    Item("amb-island", 10.0, "light coastal wind over grass with distant gulls and faint surf, continuous, no music",
         bus="ambience", loop=True, influence=0.6, trim_head=False, wrap=0.6, bitrate="80k"),
    Item("amb-forest", 8.0, "soft wind through pine trees with sparse distant birdsong, continuous, no music",
         bus="ambience", loop=True, influence=0.6, trim_head=False, wrap=0.6, bitrate="80k"),
    # Round two: two more board states. The soundscape had one flat "outdoors"
    # for the whole match; a trade screen and a robber on the board should not
    # sound like the same afternoon.
    Item("amb-harbour", 10.0,
         "continuous harbour ambience, wooden dock timbers creaking, rope stretching and knocking, "
         "water lapping against boat hulls, distant rigging, faint gulls, no music",
         bus="ambience", loop=True, influence=0.6, trim_head=False, wrap=0.6, bitrate="80k"),
    Item("amb-tension", 10.0,
         "continuous low tense drone, dark sustained bass swell with distant hollow wind, "
         "uneasy and brooding, no melody, no percussion, no vocals, continuous",
         bus="ambience", loop=True, influence=0.55, trim_head=False, wrap=0.6, bitrate="80k"),
    # Layer source only -- never shipped on its own. Mixed under the placement
    # hits so every piece set on the board shares one table resonance, which is
    # what "these sounds happen in the same room" actually means.
    Item("board-thud", 0.5,
         "loud deep resonant thud on a large hollow wooden table, single low impact, "
         "close microphone, dry",
         influence=0.5, mono=True, trim_head=False, ship=False),
    # -- Music beds --------------------------------------------------------
    # SUPERSEDED. `scripts/compose.py` writes music-title.mp3, music-match.mp3
    # and music-victory.mp3 now -- they are composed and synthesised in code,
    # not generated, and they are a different piece of music from these drones.
    # All three carry `ship=False` so a plain `python3 scripts/generate-audio.py`
    # cannot quietly overwrite the score with the raws still sitting in the
    # cache. The Items stay only because they record what was paid for and why.
    # Read art/music.md before touching any of this.
    Item("music-title", 22.0,
         "slow warm seafaring ambient bed, sustained strings and a soft low drone, distant hand drum pulse, hopeful, "
         "no melody, no vocals, continuous",
         bus="music", loop=True, influence=0.55, trim_head=False, wrap=0.8, bitrate="96k",
         ship=False),
    # Round two. Round one's two attempts came back at -59 and -66 LUFS and the
    # bed shipped as a lowpassed copy of the title drone. A third attempt, built
    # on the *title* prompt's shape (which demonstrably produced a rich bed)
    # rather than the failed "subdued, minimal" wording, and with percussion
    # explicitly ruled out, came back at -18.3 LUFS: its own material, slow
    # swells, no metronome. 24 s so the cycle is the longest in the game.
    Item("music-match", 24.0,
         "slow dark seafaring ambient music bed, deep sustained low strings and a warm cello drone "
         "with slowly shifting harmony, distant wind and faint ocean swell underneath, brooding but calm, "
         "rich and full, no melody, no percussion, no drums, no vocals, continuous",
         bus="music", loop=True, influence=0.5, trim_head=False, wrap=0.8, bitrate="80k",
         ship=False),
    Item("music-victory", 8.0,
         "short triumphant orchestral resolve, warm brass and strings swelling and settling on a major chord, "
         "seafaring, ends cleanly, no loop",
         bus="accent", influence=0.5, trim_head=False, bitrate="96k", ship=False),
)

DERIVED: tuple[Derived, ...] = (
    # Round one cut all three settles out of `dice-tumble`. Spectrograms show
    # why that was wrong: each 200-250 ms slice contains five or six separate
    # impacts, so a "settle" was really a burst of rattling, and the sequence
    # fired two of them 170 ms apart. All three now come off the single clean
    # transient in the paid `dice-settle` -- one die, one landing, three
    # weights of it.
    Derived("dice-settle-b", "dice-settle", start=0.025, semitones=1.8, tempo=1.05, mono=True,
            keep=0.26, trim_head=False, filters="lowpass=f=14000:poles=2",
            notes="brighter, faster die"),
    Derived("dice-settle-c", "dice-settle", start=0.025, semitones=-2.4, tempo=0.96, mono=True,
            keep=0.30, trim_head=False, filters="lowpass=f=14000:poles=2",
            notes="heavier, duller die"),
    # Round three. These two are derivation used the way it should be: filling
    # the gaps *between* paid events, not standing in for them. Both sit between
    # two real sources rather than pretending to be a source of their own.
    #
    # `-e` is the flat-face landing the API refused three times. Taking the deep
    # oak knock up a tone, speeding it slightly and cutting the length in half
    # turns a resonant knock into a flat slap with the same wood in it. It is
    # the one derived member of the family doing a job no paid clip covers, and
    # it is honest about being derived.
    Derived("dice-settle-e", "dice-settle-f", start=0.050, semitones=2.2, tempo=1.12, mono=True,
            keep=0.16, trim_head=False, filters="lowpass=f=10000:poles=2",
            notes="flat-face slap; the generation this replaces failed three times"),
    # `-i` is the light end of the die-on-die crack: the glancing clip two dice
    # give each other in the air rather than the square hit.
    # 1.1x speed, so the source's second strike at 60 ms arrives at 55 ms and
    # the window has to close before it.
    Derived("dice-settle-i", "dice-settle-h", start=0.001, semitones=3.5, tempo=1.1, gain_db=-2.0,
            mono=True, keep=0.044, trim_head=False, filters="lowpass=f=15000:poles=2",
            notes="glancing die-on-die clip"),
    # The click family is one piece of wood, which is why it reads as a single
    # UI. Round one made that the hover tick; round two moves it onto the paid
    # `ui-click` rap, which has real body, and keeps the same principle.
    Derived("ui-click-soft", "ui-click", start=0.012, semitones=2.0, gain_db=-5.0, mono=True,
            keep=0.10, trim_head=False, bitrate="80k",
            filters="lowpass=f=14000:poles=2", notes="secondary / repeat click"),
    Derived("ui-click-deep", "ui-click", start=0.012, semitones=-4.0, tempo=0.97, mono=True,
            keep=0.15, trim_head=False, bitrate="80k",
            filters="lowpass=f=14000:poles=2", notes="primary commit click"),
    Derived("place-road-alt", "place-road", semitones=-1.5, tempo=1.03, mono=True, keep=0.6,
            layers=(("board-thud", 1.0, 340, 0.004),),
            notes="second road so repeats do not machine-gun"),
    # Two more placement bodies so building the same thing twice in a row does
    # not sound like a copy-paste. Free, and they carry the same table layer.
    Derived("place-settlement-alt", "place-settlement", start=0.213, semitones=-1.8, tempo=1.04,
            mono=True, keep=0.7, trim_head=False, layers=(("board-thud", 5.0, 380, 0.004),),
            notes="heavier settlement"),
    Derived("place-city-alt", "place-city", start=0.342, semitones=1.4, tempo=0.97, mono=True,
            keep=0.9, trim_head=False, layers=(("board-thud", 10.0, 420, 0.006),),
            notes="brighter city"),
)


BY_ID = {item.id: item for item in ITEMS}
DERIVED_BY_ID = {d.id: d for d in DERIVED}


# --------------------------------------------------------------------------
# shell helpers


def run(cmd: list[str]) -> None:
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"{cmd[0]} failed:\n{result.stderr[-2000:]}")


def probe_duration(path: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", str(path)],
        capture_output=True, text=True, check=True,
    )
    return float(out.stdout.strip())


def api_key() -> str:
    key = os.environ.get("ELEVENLABS_API_KEY")
    if not key:
        sys.exit("ELEVENLABS_API_KEY is not set. `source ~/.zshrc` first.")
    return key


def curl(url: str, out: Path | None = None, body: dict | None = None) -> bytes:
    """Shell out to curl. The system python has no CA bundle, and curl does."""
    cmd = ["curl", "-sS", "--fail-with-body", "-H", f"xi-api-key: {api_key()}"]
    if body is not None:
        cmd += ["-X", "POST", "-H", "Content-Type: application/json", "-d", json.dumps(body)]
    cmd.append(url)
    if out is not None:
        cmd += ["--output", str(out)]
    result = subprocess.run(cmd, capture_output=True)
    if result.returncode != 0:
        detail = (out.read_bytes()[:500] if out and out.exists() else b"") or result.stderr[:500]
        raise RuntimeError(f"curl failed ({result.returncode}): {detail!r}")
    return result.stdout


def usage(days: int = 7) -> dict[str, float]:
    now = int(time.time() * 1000)
    start = int((time.time() - days * 86400) * 1000)
    url = f"{USAGE_API}?start_unix={start}&end_unix={now}&breakdown_type=product_type"
    payload = json.loads(curl(url))
    return {k: sum(v) for k, v in payload.get("usage", {}).items()}


# --------------------------------------------------------------------------
# generation


def generate(item: Item, force: bool = False) -> Path:
    raw = RAW_DIR / f"{item.id}.mp3"
    if raw.exists() and not force:
        print(f"  skip (cached, 0 credits)  {item.id}")
        return raw
    body = {
        "text": item.prompt,
        "model_id": MODEL,
        "duration_seconds": item.billed,
        "prompt_influence": item.influence,
        "loop": item.loop,
    }
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    pending = raw.with_suffix(".partial")
    try:
        curl(f"{API}?output_format={OUTPUT_FORMAT}", out=pending, body=body)
    except RuntimeError as error:
        pending.unlink(missing_ok=True)
        sys.exit(f"{item.id}: {error}")
    size = pending.stat().st_size
    if size < 2048:
        detail = pending.read_bytes()[:400]
        pending.unlink(missing_ok=True)
        sys.exit(f"{item.id}: suspiciously small response ({size} bytes): {detail!r}")
    pending.replace(raw)
    print(f"  billed {item.credits:6.0f} credits  {item.id}  ({size/1024:.0f} KB)")
    return raw


# --------------------------------------------------------------------------
# local mastering (free)


def measure(path: Path) -> tuple[float, float]:
    """Return (integrated LUFS, RMS-peak dBFS) for an intermediate wav."""
    ebur = subprocess.run(
        ["ffmpeg", "-hide_banner", "-i", str(path), "-af", "ebur128", "-f", "null", "-"],
        capture_output=True, text=True).stderr
    integrated = -70.0
    for line in ebur.splitlines():
        if line.strip().startswith("I:") and "LUFS" in line:
            integrated = float(line.split()[1])
    stats = subprocess.run(
        ["ffmpeg", "-hide_banner", "-i", str(path), "-af",
         "astats=measure_perchannel=none:length=0.02", "-f", "null", "-"],
        capture_output=True, text=True).stderr
    rms_peak = -70.0
    for line in stats.splitlines():
        if "RMS peak dB" in line:
            value = float(line.split()[-1])
            # Very short clips can hand back inf/nan; treat those as silence.
            rms_peak = value if math.isfinite(value) else -70.0
    if not math.isfinite(integrated):
        integrated = -70.0
    return integrated, rms_peak


def true_peak(path: Path) -> float:
    out = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(path), "-af", "ebur128=peak=true",
                          "-f", "null", "-"], capture_output=True, text=True).stderr
    peak = -70.0
    for line in out.splitlines():
        match = re.search(r"Peak:\s*(-?[\d.]+) dBFS", line)
        if match:
            peak = float(match.group(1))
    return peak


def master(src: Path, dst: Path, *, bus: str, trim_head: bool, keep: float | None,
           mono: bool, wrap: float, bitrate: str, semitones: float = 0.0,
           tempo: float = 1.0, gain_db: float = 0.0, start: float = 0.0,
           filters: str = "",
           layers: tuple[tuple[str, float, int, float], ...] = ()) -> None:
    """Trim, pitch/rate shift, loop-wrap, normalise and encode.

    Normalisation is a two-pass *static* gain, not ``loudnorm``. Single-pass
    loudnorm applies time-varying gain, which put a 3-4 dB level jump at the
    loop point of every ambience bed -- the single most audible failure in a
    bed you hear for hours. A measured constant offset keeps the wrap exact.
    """
    chain: list[str] = []
    if filters:
        chain.append(filters)

    if semitones or tempo != 1.0:
        ratio = 2.0 ** (semitones / 12.0)
        chain.append(f"asetrate=44100*{ratio:.6f},aresample=44100")
        # asetrate already changed speed by `ratio`; undo it, then apply tempo.
        remaining = tempo / ratio
        while remaining < 0.5 or remaining > 2.0:
            step = 0.5 if remaining < 0.5 else 2.0
            chain.append(f"atempo={step}")
            remaining /= step
        chain.append(f"atempo={remaining:.6f}")

    if gain_db:
        chain.append(f"volume={gain_db}dB")

    if trim_head:
        # -40dB threshold: kills the dead air and low-level room tone the model
        # likes to prepend
        # without eating the transient itself.
        chain.append("silenceremove=start_periods=1:start_silence=0:start_threshold=-40dB:detection=peak")

    seek = ["-ss", f"{start:.4f}"] if start else []
    stage = dst.with_suffix(".stage.wav")
    if wrap > 0:
        total = probe_duration(src)
        body = total - wrap
        # Wrap the tail onto the head so the file loops on itself: the result
        # both starts and ends at the original t = total - wrap.
        graph = f"[0:a]{','.join(chain)}[p];" if chain else "[0:a]anull[p];"
        graph += (
            f"[p]asplit=2[a][b];"
            f"[a]atrim=0:{body:.4f},asetpts=N/SR/TB[main];"
            f"[b]atrim={body:.4f}:{total:.4f},asetpts=N/SR/TB[tail];"
            f"[tail][main]acrossfade=d={wrap}:c1=qsin:c2=qsin[out]"
        )
        run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *seek, "-i", str(src),
             "-filter_complex", graph, "-map", "[out]", "-c:a", "pcm_f32le", str(stage)])
    else:
        if keep is not None:
            chain.append(f"atrim=0:{keep}")
            fade = min(0.09, max(keep * 0.35, 0.02))
            chain.append(f"afade=t=out:st={max(keep - fade, 0.005):.3f}:d={fade:.3f}")
        if not layers:
            run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *seek, "-i", str(src),
                 "-af", ",".join(chain) if chain else "anull", "-c:a", "pcm_f32le", str(stage)])
        else:
            # Foley layers: the main hit, already sliced so its attack is at
            # t = 0, plus low bodies from other clips mixed underneath. Each
            # layer is faded out inside its own window -- a bare atrim leaves a
            # step discontinuity that reads as a second, wrong transient.
            span = keep if keep is not None else 0.6
            inputs: list[str] = [*seek, "-i", str(src)]
            graph = f"[0:a]{','.join(chain) if chain else 'anull'},aformat=channel_layouts=mono[m];"
            mixed = ["[m]"]
            for index, (layer_id, gain, cutoff, delay) in enumerate(layers, start=1):
                layer_src = RAW_DIR / f"{layer_id}.mp3"
                inputs += ["-i", str(layer_src)]
                # The fade has to land inside the layer's own material. A layer
                # shorter than the window used to hard-cut where its audio ran
                # out, which put a click a fifth of the way into every build.
                usable = min(span, probe_duration(layer_src))
                tail = max(usable - 0.08, 0.02)
                graph += (
                    f"[{index}:a]lowpass=f={cutoff}:poles=2,"
                    f"afade=t=out:st={tail:.3f}:d={min(0.08, usable - tail):.3f},"
                    f"atrim=0:{usable:.3f},volume={gain}dB,"
                    f"adelay={int(delay * 1000)}|{int(delay * 1000)},"
                    f"apad=whole_dur={span:.3f},atrim=0:{span:.3f},"
                    f"aformat=channel_layouts=mono[l{index}];"
                )
                mixed.append(f"[l{index}]")
            graph += (f"{''.join(mixed)}amix=inputs={len(mixed)}:normalize=0:dropout_transition=0,"
                      f"atrim=0:{span:.3f}[out]")
            run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *inputs,
                 "-filter_complex", graph, "-map", "[out]", "-c:a", "pcm_f32le", str(stage)])

    integrated, rms_peak = measure(stage)
    if bus in ("ambience", "music"):
        # Beds are long and stationary, so integrated loudness is meaningful.
        offset = LUFS[bus] - integrated
    else:
        # Hits are too short for gated loudness (ebur128 returns -70). Match
        # them on the loudest windowed RMS instead, which tracks how loud a
        # transient actually feels.
        offset = RMS_PEAK[bus] - rms_peak
    # +-24 dB used to be the clamp, and it silently pinned any hit whose event
    # is short enough that a 20 ms window reads well below its peak: the
    # cardboard knock wanted 27 dB, got 24, and then sat 3 dB under target
    # through every correction pass because the clamp ate the correction too.
    # The peak ceiling in the loop below is the safety that matters, so this
    # only has to be wide enough not to be the binding constraint.
    offset = max(min(offset, 36.0), -36.0)

    pad = "" if probe_duration(stage) >= MIN_ENCODED else f",apad=whole_dur={MIN_ENCODED}"

    def encode(gain: float) -> None:
        run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(stage),
             "-af", f"volume={gain:.2f}dB,alimiter=limit=0.65:level=disabled{pad}",
             "-ac", "1" if mono else "2", "-ar", "44100", "-b:a", bitrate, str(dst)])

    encode(offset)

    # Converge on the target by measuring the *output*, not the stage.
    #
    # Setting the gain from the stage and trusting it is what left the settle
    # family 13.5 dB apart on the very number it was supposed to be matched on.
    # Two things sit between the gain and the file: the limiter, which eats
    # 10 dB from a sharp tick and almost nothing from a rounded knock, and the
    # encoder. Both scale with crest factor, so the error is largest exactly
    # where the family differs most, and a single pass cannot see it.
    #
    # Peak wins over loudness. A hit whose crest is too high to reach the RMS
    # target without breaching the ceiling stays under the ceiling and quiet;
    # that is the honest answer, and the bank's per-sound gain is the place to
    # trim the rest.
    for _ in range(3):
        peak = true_peak(dst)
        integrated_out, rms_out = measure(dst)
        target = LUFS[bus] if bus in ("ambience", "music") else RMS_PEAK[bus]
        measured = integrated_out if bus in ("ambience", "music") else rms_out
        error = target - measured
        headroom = TRUE_PEAK_CEILING - peak
        # Peak wins in both directions. Raising stops at the ceiling, and a
        # file already over it comes down even if that leaves it under the
        # loudness target. The ceiling was previously only checked once,
        # with a 0.2 dB slop, and most of the bank shipped above it.
        step = min(error, headroom)
        if abs(step) < 0.3:
            break
        offset = max(min(offset + step, 36.0), -36.0)
        encode(offset)
    stage.unlink(missing_ok=True)


# --------------------------------------------------------------------------


def cost_table(items: list[Item]) -> float:
    total = 0.0
    print(f"{'id':<18}{'dur':>6}{'loop':>6}{'credits':>9}")
    for item in items:
        total += item.credits
        print(f"{item.id:<18}{item.billed:>6.1f}{'yes' if item.loop else '-':>6}{item.credits:>9.0f}")
    print(f"{'TOTAL':<18}{'':>6}{'':>6}{total:>9.0f}")
    print(f"{len(DERIVED)} derived variations at 0 credits: "
          f"{', '.join(d.id for d in DERIVED)}")
    return total


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="print cost, spend nothing")
    parser.add_argument("--only", action="append", default=[], metavar="ID",
                        help="restrict to these ids (repeatable)")
    parser.add_argument("--force", action="store_true", help="re-bill even if cached")
    parser.add_argument("--post-only", action="store_true", help="remaster from cache, no API calls")
    parser.add_argument("--usage", action="store_true", help="print credits spent and exit")
    args = parser.parse_args()

    if args.usage:
        for product, spent in usage().items():
            print(f"{product}: {spent:.0f} credits")
        return

    if not shutil.which("ffmpeg"):
        sys.exit("ffmpeg is required: brew install ffmpeg")

    selected = [i for i in ITEMS if not args.only or i.id in args.only]
    derived = [d for d in DERIVED if not args.only or d.id in args.only or d.source in args.only]
    if not selected and not derived:
        sys.exit(f"nothing matched {args.only}")

    if args.dry_run:
        total = cost_table(selected)
        if total > HARD_CAP:
            print(f"\nWARNING: {total:.0f} credits exceeds the {HARD_CAP} hard cap.")
        return

    total = sum(i.credits for i in selected)
    if total > HARD_CAP:
        sys.exit(f"refusing: {total:.0f} credits exceeds the {HARD_CAP} hard cap")

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    for item in selected:
        raw = RAW_DIR / f"{item.id}.mp3" if args.post_only else generate(item, force=args.force)
        if not raw.exists():
            sys.exit(f"{item.id}: no cached raw at {raw}")
        if not item.ship:
            print(f"  layer source only, not shipped  {item.id}")
            continue
        master(raw, OUT_DIR / f"{item.id}.mp3", bus=item.bus, trim_head=item.trim_head,
               keep=item.keep, mono=item.mono, wrap=item.wrap, bitrate=item.bitrate,
               start=item.start, filters=item.filters, layers=item.layers)

    for variant in derived:
        raw = RAW_DIR / f"{variant.source}.mp3"
        if not raw.exists():
            print(f"  skip derived {variant.id}: source {variant.source} not generated yet")
            continue
        master(raw, OUT_DIR / f"{variant.id}.mp3", bus=variant.bus,
               trim_head=variant.trim_head, keep=variant.keep, mono=variant.mono,
               wrap=variant.wrap, bitrate=variant.bitrate, semitones=variant.semitones,
               tempo=variant.tempo, gain_db=variant.gain_db, start=variant.start,
               filters=variant.filters, layers=variant.layers)
        print(f"  derived  0 credits  {variant.id}  <- {variant.source}")

    size = sum(p.stat().st_size for p in OUT_DIR.glob("*.mp3"))
    print(f"\npayload: {size/1024/1024:.2f} MB across {len(list(OUT_DIR.glob('*.mp3')))} files")
    try:
        for product, spent in usage().items():
            print(f"{product} spent (7d): {spent:.0f} credits")
    except Exception as error:  # usage is a nicety, not a gate
        print(f"usage check failed: {error}")


if __name__ == "__main__":
    main()
