#!/usr/bin/env python3
"""Katan's original score, composed and synthesised here.

There is no generative-audio API in this pipeline and no soundfont. Every
sample is computed from a note list by the synths in this file, run through a
convolution reverb built from a synthesised impulse response, and encoded with
ffmpeg.

    python3 scripts/compose.py            # render everything
    python3 scripts/compose.py --only title
    python3 scripts/compose.py --no-encode   # WAV + analysis only

Output: public/assets/audio/music-title.mp3, music-match.mp3, music-victory.mp3
Analysis: art/critique/music-score.png, art/critique/music-spectra.png,
and a plain-text score at art/critique/music-score.txt.

Everything is seeded, so a rerun is byte-identical.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import shutil
import subprocess
import sys
import wave
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from scipy import signal

SR = 44100
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "assets" / "audio"
TMP = ROOT / "tmp" / "music"
CRIT = ROOT / "art" / "critique"

# ---------------------------------------------------------------------------
# Pitch
# ---------------------------------------------------------------------------

_STEPS = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
_NOTE_RE = re.compile(r"^([A-Ga-g])([#b]?)(-?\d)$")


def hz(name: str) -> float:
    """'A4' -> 440.0. Sharps and flats allowed: 'F#3', 'Bb2'."""
    match = _NOTE_RE.match(name)
    if not match:
        raise ValueError(f"bad note name: {name!r}")
    letter, accidental, octave = match.groups()
    semitone = _STEPS[letter.upper()] + {"": 0, "#": 1, "b": -1}[accidental]
    midi = 12 * (int(octave) + 1) + semitone
    return 440.0 * 2.0 ** ((midi - 69) / 12.0)


def midi_of(name: str) -> int:
    match = _NOTE_RE.match(name)
    assert match
    letter, accidental, octave = match.groups()
    return 12 * (int(octave) + 1) + _STEPS[letter.upper()] + {"": 0, "#": 1, "b": -1}[accidental]


# ---------------------------------------------------------------------------
# Small DSP helpers
# ---------------------------------------------------------------------------


def lowpass(x: np.ndarray, cutoff: float, order: int = 4) -> np.ndarray:
    cutoff = min(cutoff, SR * 0.48)
    sos = signal.butter(order, cutoff, btype="low", fs=SR, output="sos")
    return signal.sosfilt(sos, x, axis=0)


def highpass(x: np.ndarray, cutoff: float, order: int = 2) -> np.ndarray:
    sos = signal.butter(order, cutoff, btype="high", fs=SR, output="sos")
    return signal.sosfilt(sos, x, axis=0)


def bandpass(x: np.ndarray, low: float, high: float, order: int = 2) -> np.ndarray:
    high = min(high, SR * 0.48)
    sos = signal.butter(order, [low, high], btype="band", fs=SR, output="sos")
    return signal.sosfilt(sos, x, axis=0)


def resonator(x: np.ndarray, freq: float, q: float) -> np.ndarray:
    """One biquad bandpass, used as a body resonance."""
    w0 = 2 * math.pi * freq / SR
    alpha = math.sin(w0) / (2 * q)
    b = np.array([alpha, 0.0, -alpha])
    a = np.array([1 + alpha, -2 * math.cos(w0), 1 - alpha])
    return signal.lfilter(b / a[0], a / a[0], x, axis=0)


def adsr(n: int, attack: float, decay: float, sustain: float, release: float) -> np.ndarray:
    """Sample-count ADSR. Times in seconds; the sustain fills whatever is left."""
    a = min(int(attack * SR), n)
    d = min(int(decay * SR), n - a)
    r = min(int(release * SR), n - a - d)
    s = n - a - d - r
    parts = [
        np.linspace(0.0, 1.0, a, endpoint=False) ** 1.6 if a else np.empty(0),
        np.linspace(1.0, sustain, d, endpoint=False) if d else np.empty(0),
        np.full(s, sustain) if s > 0 else np.empty(0),
        np.linspace(sustain, 0.0, r) ** 1.8 if r else np.empty(0),
    ]
    env = np.concatenate(parts)
    return env[:n] if env.size >= n else np.pad(env, (0, n - env.size))


def exp_decay(n: int, tau: float, attack: float = 0.002) -> np.ndarray:
    t = np.arange(n) / SR
    env = np.exp(-t / tau)
    a = max(int(attack * SR), 1)
    env[:a] *= np.linspace(0.0, 1.0, a) ** 0.7
    return env


# ---------------------------------------------------------------------------
# Instruments
# ---------------------------------------------------------------------------


def pluck(
    freq: float,
    dur: float,
    rng: np.random.Generator,
    *,
    damping: float = 0.32,
    loop_gain: float = 0.9965,
    brightness: float = 3200.0,
    pick: float = 0.22,
) -> np.ndarray:
    """Karplus-Strong with a fractional delay and a damping tap in the loop.

    Vectorised a delay-line-length at a time: every sample in a block depends
    only on the block before it, so the whole thing is numpy rather than a
    Python sample loop.
    """
    n = max(int(dur * SR), 64)
    delay = SR / freq - damping  # damping FIR adds group delay; take it back
    if delay < 4:
        return np.zeros(n)
    whole = int(math.floor(delay))
    frac = delay - whole

    # Excitation: filtered noise, comb-notched to fake a pick position.
    exc = rng.standard_normal(whole)
    exc = lowpass(exc, brightness, order=2)
    offset = max(int(pick * whole), 1)
    exc[offset:] -= 0.85 * exc[:-offset]
    exc /= np.max(np.abs(exc)) + 1e-9

    # Three-tap loop: fractional interpolation convolved with a damping FIR.
    taps = np.convolve([1.0 - frac, frac], [1.0 - damping, damping]) * loop_gain

    pad = len(taps) + 1
    buf = np.zeros(pad + n + whole + 4)
    buf[pad : pad + whole] = exc
    k = whole
    while k < n:
        end = min(k + whole, n)
        width = end - k
        seg = np.zeros(width)
        for i, tap in enumerate(taps):
            start = pad + k - whole - i
            seg += tap * buf[start : start + width]
        buf[pad + k : pad + end] = seg
        k = end
    out = buf[pad : pad + n]
    # Losing the DC the noise burst leaves behind.
    return highpass(out, max(freq * 0.5, 40.0), order=1)


def _harmonic_stack(
    freq: float,
    n: int,
    weights: np.ndarray,
    *,
    rng: np.random.Generator,
    detune_cents: float,
    voices: int,
    vibrato_hz: float,
    vibrato_depth: float,
    drift_depth: float,
) -> np.ndarray:
    """Additive band-limited stack with per-voice detune and slow pitch drift."""
    t = np.arange(n) / SR
    out = np.zeros(n)
    for v in range(voices):
        cents = detune_cents * (v - (voices - 1) / 2) / max(voices - 1, 1)
        base = freq * 2.0 ** (cents / 1200.0)
        phase0 = rng.uniform(0, 2 * math.pi)
        vib = vibrato_depth * np.sin(2 * math.pi * vibrato_hz * (t + rng.uniform(0, 3)))
        # Slow, per-voice, non-repeating drift: two incommensurate slow sines.
        drift = drift_depth * (
            np.sin(2 * math.pi * rng.uniform(0.07, 0.13) * t + rng.uniform(0, 6))
            + 0.6 * np.sin(2 * math.pi * rng.uniform(0.21, 0.34) * t + rng.uniform(0, 6))
        )
        ratio = 2.0 ** ((vib + drift) / 1200.0)
        inst = base * ratio
        phase = 2 * math.pi * np.cumsum(inst) / SR + phase0
        voice = np.zeros(n)
        for k, w in enumerate(weights, start=1):
            if w <= 1e-4 or base * k > SR * 0.45:
                continue
            voice += w * np.sin(k * phase + rng.uniform(0, 2 * math.pi))
        out += voice
    return out / max(voices, 1)


def bowed(
    freq: float,
    dur: float,
    rng: np.random.Generator,
    *,
    bright: float = 1.0,
    voices: int = 4,
    attack: float = 0.55,
    release: float = 0.9,
) -> np.ndarray:
    """Bowed-string pad: detuned band-limited stacks under a slow filter swell."""
    n = max(int(dur * SR), 256)
    order = np.arange(1, 25)
    dull = 1.0 / order**1.9
    sharp = 1.0 / order**1.05
    sharp[::2] *= 0.72  # a touch of odd-harmonic bite
    dull_sig = _harmonic_stack(
        freq, n, dull, rng=rng, detune_cents=9.0, voices=voices,
        vibrato_hz=4.6, vibrato_depth=5.0, drift_depth=3.5,
    )
    sharp_sig = _harmonic_stack(
        freq, n, sharp, rng=rng, detune_cents=13.0, voices=voices,
        vibrato_hz=5.1, vibrato_depth=6.0, drift_depth=4.0,
    )
    # Bow pressure opens the tone as the note settles, then closes again.
    t = np.linspace(0, 1, n)
    open_env = bright * (1 - np.exp(-t / 0.22)) * np.exp(-t * 0.9)
    open_env = np.clip(open_env, 0, 1)
    sig = dull_sig * (1 - 0.55 * open_env) + sharp_sig * (0.55 * open_env)
    # Bow noise, the thing that separates a pad from an organ.
    noise = bandpass(rng.standard_normal(n), freq * 1.6, min(freq * 7, 9000), order=2)
    sig += 0.05 * noise * (0.4 + 0.6 * open_env)
    env = adsr(n, attack, 0.35, 0.82, release)
    return sig * env * 0.42


def choir(freq: float, dur: float, rng: np.random.Generator, *, vowel: str = "oo") -> np.ndarray:
    """Vowel-ish pad: harmonics weighted by formant bumps, so it reads as voices."""
    n = max(int(dur * SR), 256)
    formants = {"oo": (320.0, 800.0, 2400.0), "ah": (700.0, 1220.0, 2600.0)}[vowel]
    order = np.arange(1, 40)
    partial_hz = order * freq
    weights = np.zeros(order.size)
    for i, (fc, amp, bw) in enumerate(zip(formants, (1.0, 0.5, 0.16), (120.0, 220.0, 500.0))):
        weights += amp * np.exp(-0.5 * ((partial_hz - fc) / bw) ** 2)
    weights *= 1.0 / order**0.35
    weights /= np.max(weights) + 1e-9
    sig = _harmonic_stack(
        freq, n, weights, rng=rng, detune_cents=16.0, voices=5,
        vibrato_hz=4.9, vibrato_depth=7.0, drift_depth=6.0,
    )
    breath = bandpass(rng.standard_normal(n), 900.0, 4200.0, order=2)
    sig = sig + 0.035 * breath
    env = adsr(n, 0.9, 0.5, 0.85, 1.4)
    return sig * env * 0.33


def bell(freq: float, dur: float, rng: np.random.Generator, *, warmth: float = 1.0) -> np.ndarray:
    """Additive bell: inharmonic partials, each with its own decay."""
    n = max(int(dur * SR), 256)
    t = np.arange(n) / SR
    ratios = [0.56, 0.92, 1.00, 1.19, 1.71, 2.00, 2.74, 3.00, 3.76, 4.07]
    amps = [0.55, 0.32, 1.00, 0.45, 0.28, 0.30, 0.14, 0.11, 0.07, 0.05]
    taus = [2.6, 2.1, 2.4, 1.5, 1.0, 0.9, 0.55, 0.45, 0.30, 0.22]
    out = np.zeros(n)
    for ratio, amp, tau in zip(ratios, amps, taus):
        f = freq * ratio
        if f > SR * 0.45:
            continue
        # A little beating between the two halves of each partial.
        beat = rng.uniform(0.25, 0.9)
        env = np.exp(-t / (tau * warmth))
        out += amp * env * (
            np.sin(2 * math.pi * f * t + rng.uniform(0, 6))
            + 0.7 * np.sin(2 * math.pi * (f + beat) * t + rng.uniform(0, 6))
        )
    strike = rng.standard_normal(n) * np.exp(-t / 0.006)
    out += 0.25 * bandpass(strike, freq * 2, min(freq * 9, 11000), order=2)
    a = int(0.0015 * SR)
    out[:a] *= np.linspace(0, 1, a)
    return out * 0.14


def frame_drum(dur: float, rng: np.random.Generator, *, pitch: float = 96.0, tone: float = 0.5) -> np.ndarray:
    """Bodhran-ish: noise burst, a sine that drops, and a slow shell resonance."""
    n = max(int(dur * SR), 256)
    t = np.arange(n) / SR
    # Skin: bandpassed noise, fast.
    skin = rng.standard_normal(n) * np.exp(-t / (0.035 + 0.05 * tone))
    skin = bandpass(skin, 180.0, 1800.0 + 2600.0 * tone, order=2)
    # The drop, which is what makes a drum a drum rather than a click.
    f = pitch * (1.0 + 1.35 * np.exp(-t / 0.028))
    body = np.sin(2 * math.pi * np.cumsum(f) / SR) * np.exp(-t / 0.20)
    # Shell resonance under it all.
    shell = resonator(rng.standard_normal(n) * np.exp(-t / 0.05), pitch * 0.92, 7.0)
    out = 0.5 * skin + 0.85 * body + 0.7 * shell
    a = int(0.0008 * SR)
    out[:a] *= np.linspace(0, 1, a)
    return out * 0.55


def shaker(dur: float, rng: np.random.Generator, *, tone: float = 1.0) -> np.ndarray:
    n = max(int(dur * SR), 128)
    t = np.arange(n) / SR
    x = rng.standard_normal(n) * np.exp(-t / 0.028)
    x = bandpass(x, 3200.0 * tone, 11000.0 * tone, order=2)
    return x * 0.35


def drone(freq: float, dur: float, rng: np.random.Generator, *, cutoff: float = 420.0,
          wrap_fade: float = 0.0) -> np.ndarray:
    """The floor of the mix: sub sine plus a filtered detuned pair.

    `wrap_fade` gives the note a raised-cosine fade at both ends. Those two
    fades are exact complements, so when the tail is folded back onto the head
    by `wrap_loop` the pedal sums to a flat, unbroken tone across the seam.
    Without this the loop point of a drone-led bed always has a dip in it.
    """
    n = max(int(dur * SR), 256)
    t = np.arange(n) / SR
    sub = np.sin(2 * math.pi * freq * t + rng.uniform(0, 6))
    order = np.arange(1, 13)
    stack = _harmonic_stack(
        freq, n, 1.0 / order**1.5, rng=rng, detune_cents=7.0, voices=3,
        vibrato_hz=0.0, vibrato_depth=0.0, drift_depth=2.5,
    )
    sig = 0.35 * sub + 0.8 * lowpass(stack, cutoff, order=2)
    # Nothing below 42 Hz survives a laptop speaker; it only eats headroom and
    # pushes the whole balance into mud.
    sig = highpass(sig, 42.0, order=2)
    if wrap_fade > 0:
        f = min(int(wrap_fade * SR), n // 2)
        env = np.ones(n)
        u = np.linspace(0.0, 1.0, f, endpoint=False)
        env[:f] = 0.5 - 0.5 * np.cos(math.pi * u)
        env[n - f:] = 0.5 + 0.5 * np.cos(math.pi * u)
    else:
        env = adsr(n, 2.0, 1.0, 0.9, 2.4)
    return sig * env * 0.4


# ---------------------------------------------------------------------------
# Reverb
# ---------------------------------------------------------------------------


def impulse_response(rng: np.random.Generator, *, length: float, taus: tuple[float, float, float],
                     predelay: float = 0.022) -> np.ndarray:
    """A hall, made of decaying noise split into three bands with separate decays.

    Independent noise per channel is what gives it width; the high band decays
    fastest, which is what makes it read as air rather than as static.
    """
    n = int(length * SR)
    t = np.arange(n) / SR
    ir = np.zeros((n, 2))
    for ch in range(2):
        noise = rng.standard_normal(n)
        low = lowpass(noise, 400.0, order=2) * np.exp(-t / taus[0])
        mid = bandpass(noise, 400.0, 2600.0, order=2) * np.exp(-t / taus[1])
        high = highpass(noise, 2600.0, order=2) * np.exp(-t / taus[2])
        body = 0.9 * low + 1.0 * mid + 0.55 * high
        # Diffusion builds over the first 40 ms rather than starting flat out.
        body *= 1.0 - np.exp(-t / 0.030)
        ir[:, ch] = body
    # Early reflections: a handful of discrete taps, offset between channels.
    for ch in range(2):
        for _ in range(9):
            delay = int(rng.uniform(0.004, 0.055) * SR)
            ir[delay, ch] += rng.uniform(0.18, 0.42) * rng.choice([-1.0, 1.0])
    pre = int(predelay * SR)
    ir = np.vstack([np.zeros((pre, 2)), ir])
    ir /= np.sqrt(np.sum(ir**2, axis=0)).max()
    return ir


def convolve_stereo(x: np.ndarray, ir: np.ndarray) -> np.ndarray:
    out = np.zeros((x.shape[0] + ir.shape[0] - 1, 2))
    for ch in range(2):
        out[:, ch] = signal.fftconvolve(x[:, ch], ir[:, ch])[: out.shape[0]]
    return out


# ---------------------------------------------------------------------------
# Score model
# ---------------------------------------------------------------------------


@dataclass
class Event:
    t: float           # start, seconds
    dur: float         # nominal duration, seconds
    instrument: str
    pitch: str | None = None
    gain: float = 1.0
    pan: float = 0.0
    track: str = "main"
    extra: dict = field(default_factory=dict)


class Session:
    """A mix bus per instrument family, each with its own reverb send."""

    def __init__(self, length: float, rng: np.random.Generator, *, tail: float = 4.0):
        self.n = int((length + tail) * SR)
        self.rng = rng
        self.buses: dict[str, np.ndarray] = {}

    def bus(self, name: str) -> np.ndarray:
        if name not in self.buses:
            self.buses[name] = np.zeros((self.n, 2))
        return self.buses[name]

    def add(self, name: str, at: float, mono: np.ndarray, gain: float, pan: float) -> None:
        start = int(at * SR)
        if start < 0:
            mono = mono[-start:]
            start = 0
        end = min(start + mono.size, self.n)
        if end <= start:
            return
        seg = mono[: end - start] * gain
        left = math.cos((pan + 1) * math.pi / 4)
        right = math.sin((pan + 1) * math.pi / 4)
        buf = self.bus(name)
        buf[start:end, 0] += seg * left
        buf[start:end, 1] += seg * right


SEND = {  # reverb send per family; plucks live in the room, drones underneath it
    "pluck": 0.34,
    "lead": 0.40,
    "pad": 0.26,
    "choir": 0.38,
    "bell": 0.55,
    "perc": 0.20,
    "drone": 0.10,
}
FAMILY_GAIN = {
    "pluck": 0.62,
    "lead": 0.70,
    "pad": 0.50,
    "choir": 0.42,
    "bell": 0.55,
    "perc": 0.44,
    "drone": 0.40,
}


def render(events: list[Event], length: float, rng: np.random.Generator, *,
           ir: np.ndarray, tail: float = 5.0) -> np.ndarray:
    session = Session(length, rng, tail=tail)
    for ev in events:
        family = ev.instrument
        if family == "pluck" or family == "lead":
            assert ev.pitch
            mono = pluck(
                hz(ev.pitch), ev.dur,
                rng,
                damping=ev.extra.get("damping", 0.30),
                loop_gain=ev.extra.get("loop_gain", 0.9968),
                brightness=ev.extra.get("brightness", 3000.0),
                pick=ev.extra.get("pick", 0.24),
            )
        elif family == "pad":
            assert ev.pitch
            mono = bowed(hz(ev.pitch), ev.dur, rng,
                         bright=ev.extra.get("bright", 1.0),
                         attack=ev.extra.get("attack", 0.55),
                         release=ev.extra.get("release", 0.9))
        elif family == "choir":
            assert ev.pitch
            mono = choir(hz(ev.pitch), ev.dur, rng, vowel=ev.extra.get("vowel", "oo"))
        elif family == "bell":
            assert ev.pitch
            mono = bell(hz(ev.pitch), ev.dur, rng, warmth=ev.extra.get("warmth", 1.0))
        elif family == "drone":
            assert ev.pitch
            mono = drone(hz(ev.pitch), ev.dur, rng, cutoff=ev.extra.get("cutoff", 420.0),
                         wrap_fade=ev.extra.get("wrap_fade", 0.0))
        elif family == "perc":
            if ev.extra.get("kind") == "shaker":
                mono = shaker(ev.dur, rng, tone=ev.extra.get("tone", 1.0))
            else:
                mono = frame_drum(ev.dur, rng, pitch=ev.extra.get("pitch_hz", 96.0),
                                  tone=ev.extra.get("tone", 0.5))
        else:
            raise ValueError(f"unknown instrument {family}")
        session.add(family, ev.t, mono, ev.gain * FAMILY_GAIN[family], ev.pan)

    mix = np.zeros((session.n, 2))
    wet = np.zeros((session.n, 2))
    for name, buf in session.buses.items():
        mix += buf
        wet += buf * SEND[name]
    reverb = convolve_stereo(wet, ir)[: session.n]
    out = mix + 0.85 * reverb

    # A little air. Every source here rolls off hard above 6 kHz, which is
    # honest for gut strings and bowed pads but leaves the whole thing sounding
    # like it is under a blanket. The shelf mostly lifts the reverb's own high
    # band and the pluck excitation noise, which is the part that reads as a
    # room rather than as a synthesiser.
    sos = signal.butter(2, 7000.0, btype="high", fs=SR, output="sos")
    return out + 0.85 * signal.sosfilt(sos, out, axis=0)


BED_CROSSFADE = 0.5  # must match BED_CROSSFADE in src/audio/soundbank.ts


def append_head(audio: np.ndarray, crossfade: float = BED_CROSSFADE) -> np.ndarray:
    """Duplicate the first `crossfade` seconds onto the tail.

    SoundBank retriggers a bed at `duration - BED_CROSSFADE` and crossfades the
    overlap, so those two voices then play the identical samples twice with
    gains that add to one. The seam is not merely smooth, it is arithmetically
    the same audio as an uninterrupted playthrough.
    """
    xf = int(crossfade * SR)
    return np.vstack([audio, audio[:xf]])


def wrap_loop(audio: np.ndarray, length: float) -> np.ndarray:
    """Fold everything past the loop point back onto the head.

    The reverb tail of the last bar then sounds under the first bar, which is
    what makes a sample-accurate loop actually continuous rather than merely
    level-matched.
    """
    n = int(length * SR)
    body = audio[:n].copy()
    over = audio[n:]
    if over.shape[0]:
        take = min(over.shape[0], n)
        body[:take] += over[:take]
    return body


# ---------------------------------------------------------------------------
# The music
# ---------------------------------------------------------------------------
#
# D dorian throughout: D E F G A B C. A aeolian, which the match bed sits in,
# is the same seven notes seen from A, so title fragments transplant into the
# match bed without a single accidental. That relationship is the whole reason
# for the key choice.
#
# THE MOTIF, "the Sail". Eight notes, 6/8, D dorian:
#
#     D4  F4  A4 | G4  B4  A4 | C5  B4  A4  G4 | F4  E4
#
# The rising D-F-A opens it, the B natural in bar 2 is the dorian sixth and is
# what stops it sounding minor-sad, the C5-B4-A4-G4 comes back down, and it
# lands unresolved on E4 so the phrase asks a question. The consequent answers
# it by pushing to D5 and closing on D4.

BEAT = 60.0 / 76.0          # dotted-crotchet pulse at 76 bpm
E8 = BEAT / 3.0             # one quaver in 6/8
BAR = 6 * E8                # 1.579 s


Voices = dict[str, list[tuple[float, float, str]]]


def title_score() -> tuple[list[Event], float, list[str], Voices]:
    rng = np.random.default_rng(20260726)
    ev: list[Event] = []
    log: list[str] = []
    voices: Voices = {}

    def sing(voice: str, t: float, dur: float, pitch: str) -> None:
        voices.setdefault(voice, []).append((t, t + dur, pitch))

    def bar_t(bar: float) -> float:
        return bar * BAR

    def hum(amount: float = 0.011) -> float:
        return float(rng.normal(0.0, amount))

    def vel(base: float, spread: float = 0.10) -> float:
        return float(base * (1.0 + rng.normal(0.0, spread)))

    # --- the tune, as (pitch, quavers) pairs -------------------------------
    antecedent = [("D4", 2), ("F4", 1), ("A4", 3),
                  ("G4", 2), ("B4", 1), ("A4", 3),
                  ("C5", 2), ("B4", 1), ("A4", 2), ("G4", 1),
                  ("F4", 3), ("E4", 3)]
    consequent = [("D4", 2), ("F4", 1), ("A4", 3),
                  ("C5", 2), ("D5", 1), ("C5", 3),
                  ("B4", 2), ("A4", 1), ("G4", 3),
                  ("F4", 4), ("D4", 2)]

    # --- harmony, one chord per bar ---------------------------------------
    # Modal: no leading tone anywhere, and the cadences are G->Dm and F->Dm.
    chords = {
        0: ("Dm", ["D3", "A3", "D4"]),
        1: ("Dm", ["D3", "A3", "F4"]),
        2: ("Am", ["A2", "E3", "A3"]),
        3: ("Dm", ["D3", "A3", "D4"]),
        # A
        4: ("Dm", ["D3", "A3", "D4"]),
        5: ("G",  ["G2", "D3", "G3"]),
        6: ("Am", ["A2", "E3", "C4"]),
        7: ("Dm", ["D3", "A3", "F3"]),
        8: ("Dm", ["D3", "A3", "D4"]),
        9: ("F",  ["F2", "C3", "F3"]),
        10: ("G", ["G2", "D3", "B3"]),
        11: ("Dm", ["D3", "A3", "D4"]),
        # A'
        12: ("Dm", ["D3", "A3", "D4"]),
        13: ("G",  ["G2", "D3", "G3"]),
        14: ("Am", ["A2", "E3", "C4"]),
        15: ("Dm", ["D3", "A3", "F3"]),
        16: ("Dm", ["D3", "A3", "D4"]),
        17: ("F",  ["F2", "C3", "F3"]),
        18: ("G",  ["G2", "D3", "B3"]),
        19: ("Dm", ["D3", "A3", "D4"]),
        # coda / turnaround
        20: ("C",  ["C3", "G3", "E4"]),
        21: ("G",  ["G2", "D3", "B3"]),
        22: ("Dm", ["D3", "A3", "F3"]),
        23: ("Dm", ["D3", "A3", "D4"]),
    }
    bars = 24
    length = bars * BAR

    log.append("KATAN — TITLE THEME  'The Sail'")
    log.append("D dorian · 6/8 · 76 bpm dotted-crotchet · 24 bars · %.2f s loop" % length)
    log.append("")
    log.append("form   | 0-3 intro (harp + drone) | 4-11 A: melody alone, lute |")
    log.append("       | 12-19 A': two choir voices, tenor counter-line, drum |")
    log.append("       | 20-23 coda: C-G-Dm turnaround back into the intro texture")
    log.append("")
    log.append("The bowed strings double the lute an octave down through A'. That is")
    log.append("orchestration, not counterpoint, so they are not registered as a voice")
    log.append("in the check below -- an octave doubling of one line is one line.")
    log.append("")

    # --- pedal: one unbroken D across the whole loop -----------------------
    # A single note with complementary wrap fades, not three stitched ones.
    # The tonic never leaves, which is what lets the harmony lean to G and F
    # and come back without ever sounding like it modulated.
    ev.append(Event(0.0, length + 1.6, "drone", "D2", gain=0.62, track="drone",
                    extra={"wrap_fade": 1.6}))
    ev.append(Event(0.0, length + 1.6, "drone", "D1", gain=0.22, track="drone",
                    extra={"cutoff": 220.0, "wrap_fade": 1.6}))

    # --- harp figure: broken chords, the 6/8 lilt lives here ---------------
    # Pattern per bar in quavers: 1 . 3 4 . 6 -- a limp, not a march. The
    # missing 2 and 5 are what keep it from ticking.
    harp_slots = [0, 2, 3, 5]
    for bar in range(bars):
        _, voicing = chords[bar]
        top = voicing[-1]
        octave_up = top[0] + str(int(top[-1]) + 1)
        shape = [voicing[0], voicing[1], voicing[2], octave_up]
        sing("bass", bar_t(bar), BAR, voicing[0])
        density = 1.0 if bar >= 4 else 0.9
        for i, slot in enumerate(harp_slots):
            t = bar_t(bar) + slot * E8 + hum()
            note = shape[i % len(shape)]
            ev.append(Event(t, 2.4, "pluck", note,
                            gain=vel(0.55 * density) * (1.0 if slot == 0 else 0.78),
                            pan=-0.35 + 0.16 * i, track="harp",
                            extra={"brightness": 2700.0, "damping": 0.34, "loop_gain": 0.9962}))

    # --- melody -------------------------------------------------------------
    def lay_tune(bar0: int, tune: list[tuple[str, int]], *, instrument: str, gain: float,
                 pan: float, track: str, octave: int = 0, extra: dict | None = None,
                 legato: float = 1.35, voice: str | None = None) -> None:
        pos = 0
        for name, quavers in tune:
            if octave:
                name = name[0] + name[1:-1] + str(int(name[-1]) + octave)
            t = bar_t(bar0) + pos * E8 + hum(0.014)
            dur = quavers * E8 * legato
            ev.append(Event(t, dur, instrument, name, gain=vel(gain), pan=pan,
                            track=track, extra=dict(extra or {})))
            if voice:
                # Notated position, not the humanised one: counterpoint is a
                # property of the score, and 14 ms of rubato must not hide a
                # parallel octave from the checker.
                sing(voice, bar_t(bar0) + pos * E8, quavers * E8, name)
            pos += quavers

    # A section: the tune on the lute, alone over harp and drone.
    lay_tune(4, antecedent, instrument="lead", gain=0.95, pan=0.12, track="lute",
             extra={"brightness": 4200.0, "damping": 0.24, "loop_gain": 0.9978, "pick": 0.16},
             voice="melody")
    lay_tune(8, consequent, instrument="lead", gain=0.98, pan=0.12, track="lute",
             extra={"brightness": 4400.0, "damping": 0.23, "loop_gain": 0.9980, "pick": 0.16},
             voice="melody")

    # A': the same tune, doubled an octave down by bowed strings and shadowed
    # by the choir. Same notes, more weight -- that is the whole arrangement
    # arc, and it is why the second time round feels like an arrival.
    lay_tune(12, antecedent, instrument="lead", gain=0.95, pan=0.12, track="lute",
             extra={"brightness": 4300.0, "damping": 0.24, "loop_gain": 0.9978, "pick": 0.16},
             voice="melody")
    lay_tune(16, consequent, instrument="lead", gain=1.00, pan=0.12, track="lute",
             extra={"brightness": 4500.0, "damping": 0.23, "loop_gain": 0.9982, "pick": 0.16},
             voice="melody")
    lay_tune(12, antecedent, instrument="pad", gain=0.52, pan=-0.28, track="strings",
             octave=-1, legato=1.0, extra={"attack": 0.10, "release": 0.35, "bright": 0.9})
    lay_tune(16, consequent, instrument="pad", gain=0.55, pan=-0.28, track="strings",
             octave=-1, legato=1.0, extra={"attack": 0.10, "release": 0.35, "bright": 0.9})

    # Choir under A'. NOT the chord transposed up, which is what an earlier
    # draft did: transposing voicing[1:] up an octave put the choir's top voice
    # on the melody's own pitch at every single downbeat of bars 12-19, and
    # marched it in parallel unison with the tune from bar 13 to 14 and again
    # from 14 to 15. Two voices in parallel unison are one voice.
    #
    # These are written out instead, as two real inner parts. The upper is
    # essentially an A pedal with a neighbour either side, so it moves obliquely
    # while the melody climbs; the lower has its own small contour. No downbeat
    # doubles the melody's pitch class in any octave.
    #   bar    12  13  14  15  16  17  18  19
    #   tune   D4  G4  C5  F4  D4  C5  B4  F4
    #   upper  A3  B3  A3  A3  A3  A3  G3  A3
    #   lower  F3  D3  E3  D3  F3  F3  D3  D3
    # The lower part rests in bars 13, 15 and 19 -- the two phrase ends and one
    # mid-phrase breath. That is a phrasing decision and it is also the thing
    # that keeps it from being dragged into parallel fifths with the bass, which
    # is where G->Am and F->G in this progression want to pull any inner voice
    # that insists on sounding in every bar.
    choir_parts = {
        "upper": ["A3", "B3", "A3", "A3", "A3", "A3", "G3", "A3"],
        "lower": ["F3", None, "E3", None, "F3", "F3", "D3", None],
    }
    for i, (part, notes) in enumerate(choir_parts.items()):
        for k, note in enumerate(notes):
            if note is None:
                continue
            bar = 12 + k
            ev.append(Event(bar_t(bar) - 0.25, BAR + 0.9, "choir", note,
                            gain=0.42 - 0.08 * i, pan=(-0.5 + 0.9 * i), track="choir",
                            extra={"vowel": "oo" if bar < 16 else "ah"}))
            sing(f"choir-{part}", bar_t(bar), BAR, note)

    # Counter-line under A'. The earlier draft was one note per bar, entering on
    # every downbeat with the melody -- same rhythm, same phrasing, so it read as
    # harmony rather than as a second part. This one is a tenor line with its own
    # everything:
    #
    #   rhythm  it enters off the beat nine times out of ten, holds notes two to
    #           six quavers long against the tune's ones and twos, and rests for
    #           the whole second half of bar 15 where the tune is breathing.
    #   contour a stepwise climb F2-G2-B2-C3-D3, a leap of a fifth up to its
    #           apex A3, then a descent F3-D3-A2. One arch, one apex, and the
    #           apex is in bar 16 -- a bar BEFORE the melody's D5 in bar 17.
    #   motion  it holds that A3 through the whole of the melody's climb (oblique
    #           motion, which is what makes a climb audible as a climb) and then
    #           walks down through bars 17-19 while the tune also falls, but by
    #           different intervals, so nothing runs in parallel.
    #
    #   bar/quaver  12.2 13.1 13.3 14.2 15.0 16.2 17.1 17.3 18.3 19.0
    #   note        F2   G2   B2   C3   D3   A3   A3   F3   B2   A2
    #   length (q)  4    2    3    4    3    3    2    3    3    6
    counter = [(12, 2, "F2", 4), (13, 1, "G2", 2), (13, 3, "B2", 3),
               (14, 2, "C3", 4), (15, 0, "D3", 3), (16, 2, "A3", 3),
               (17, 1, "A3", 2), (17, 3, "F3", 3), (18, 3, "B2", 3),
               (19, 0, "A2", 6)]
    for bar, slot, name, quavers in counter:
        t = bar_t(bar) + slot * E8
        ev.append(Event(t + hum(0.02), quavers * E8 * 1.15, "pad", name,
                        gain=0.36, pan=0.42, track="counter",
                        extra={"attack": 0.30, "release": 0.55, "bright": 0.7}))
        sing("counter", t, quavers * E8, name)

    # --- percussion: enters at bar 12, leaves at bar 20 --------------------
    # Never a straight quaver pulse. The pattern is 12 quavers long across two
    # bars, so no drum figure repeats faster than 3.2 s.
    drum_pattern = [(0, 1.0, "low"), (3, 0.55, "high"), (5, 0.4, "high"),
                    (6, 0.8, "low"), (8, 0.45, "high"), (11, 0.6, "high")]
    for pair in range(4):
        base = 12 + pair * 2
        if base >= 20:
            break
        for slot, amp, kind in drum_pattern:
            t = bar_t(base) + slot * E8 + hum(0.016)
            if kind == "low":
                ev.append(Event(t, 0.9, "perc", gain=vel(amp * 0.9, 0.13), pan=-0.1,
                                track="drum", extra={"pitch_hz": 92.0, "tone": 0.35}))
            else:
                ev.append(Event(t, 0.7, "perc", gain=vel(amp * 0.6, 0.16), pan=0.22,
                                track="drum", extra={"pitch_hz": 150.0, "tone": 0.8}))
        # A shaker on the offbeats only, and only every other pair.
        if pair % 2 == 1:
            for slot in (2, 4, 8, 10):
                ev.append(Event(bar_t(base) + slot * E8 + hum(0.02), 0.25, "perc",
                                gain=vel(0.22, 0.2), pan=0.45, track="shaker",
                                extra={"kind": "shaker", "tone": 1.0}))

    # --- bells: three strikes, marking the two big arrivals and the loop ----
    for bar, note, g in ((8, "D5", 0.5), (16, "D5", 0.6), (17, "A5", 0.35), (20, "C5", 0.4)):
        ev.append(Event(bar_t(bar) + hum(0.02), 4.5, "bell", note, gain=g, pan=0.3, track="bell"))

    # --- coda: the motif head, thinning out, handing back to the intro ------
    tag = [("D5", 2), ("C5", 1), ("A4", 3), ("G4", 2), ("F4", 1), ("D4", 3)]
    lay_tune(20, tag, instrument="lead", gain=0.62, pan=0.12, track="lute",
             extra={"brightness": 3400.0, "damping": 0.30, "loop_gain": 0.9968})
    for bar in (22, 23):
        _, voicing = chords[bar]
        for i, note in enumerate(voicing):
            ev.append(Event(bar_t(bar) + i * E8 * 0.8 + hum(0.02), 3.0, "pluck", note,
                            gain=0.42, pan=0.2 - 0.2 * i, track="harp",
                            extra={"brightness": 2400.0}))

    # --- score text ---------------------------------------------------------
    def spell(tune: list[tuple[str, int]]) -> str:
        out, pos = [], 0
        for name, q in tune:
            if pos % 6 == 0 and pos:
                out.append("|")
            out.append(f"{name}/{q}")
            pos += q
        return " ".join(out)

    log.append("motif, antecedent : " + spell(antecedent))
    log.append("motif, consequent : " + spell(consequent))
    log.append("coda tag          : " + spell(tag))
    log.append("")
    log.append("bars 12-19, the four written voices, one column per bar:")
    log.append("  tune        " + "  ".join(
        f"{n:<4}" for n in ("D4", "G4", "C5", "F4", "D4", "C5", "B4", "F4")))
    log.append("  choir upper " + "  ".join(f"{n:<4}" for n in choir_parts["upper"]))
    log.append("  choir lower " + "  ".join(f"{n or '--':<4}" for n in choir_parts["lower"]))
    log.append("  bass        " + "  ".join(f"{chords[b][1][0]:<4}" for b in range(12, 20)))
    log.append("  counter-line, off the beat and on its own rhythm:")
    log.append("    " + "  ".join(f"{b}.{s}:{n}/{q}" for b, s, n, q in counter))
    log.append("")
    log.append("harmony (one per bar):")
    log.append("  " + " ".join(chords[b][0] for b in range(bars)))
    return ev, length, log, voices


def match_score() -> tuple[list[Event], float, list[str], Voices]:
    """The hour-long bed. A aeolian: the same seven notes as the title, heard
    from A instead of D, so motif fragments drop in untransposed.

    No pulse at all. Nothing here repeats on a period under four seconds, and
    the three cyclic layers have lengths 96, 37 and 23 seconds, which share no
    factor, so the surface does not line up with itself inside a loop."""
    rng = np.random.default_rng(19891114)
    ev: list[Event] = []
    log: list[str] = []
    voices: Voices = {}
    length = 96.0

    # Six harmonic areas, 16 s each. Aeolian, and it never actually cadences --
    # it just leans and comes back, which is why it can run for an hour.
    areas = [
        (0.0,  "Am",     ["A1", "A2", "E3", "A3", "C4", "E4"]),
        (16.0, "Fmaj7/A", ["F1", "F2", "C3", "A3", "C4", "F4"]),
        (32.0, "Am7",    ["C2", "C3", "G3", "C4", "E4", "G4"]),
        (48.0, "Gsus/A", ["G1", "G2", "D3", "G3", "C4", "D4"]),
        (64.0, "Dm7/A",  ["D2", "D3", "A3", "C4", "F4", "A4"]),
        # Returns to exactly the opening voicing. The bed has to arrive back
        # where it started before the loop point or the wrap is a chord change.
        (80.0, "Am",     ["A1", "A2", "E3", "A3", "C4", "E4"]),
    ]

    log.append("KATAN — MATCH BED  'Long Water'")
    log.append("A aeolian (the title's collection, read from A) · no metre · 96.00 s loop")
    log.append("")
    log.append("Six 16-second harmonic areas, each a lean rather than a cadence:")
    log.append("  " + "  ".join(f"{t:>5.1f}s {name}" for t, name, _ in areas))
    log.append("")

    # An A pedal for the entire 96 seconds, root and octave, with complementary
    # wrap fades so the loop point is literally continuous. Every area above is
    # voiced to sit over it: F/A, C/A is Am7, Gsus/A, Dm7/A. Nothing needs a
    # bass move, which is exactly why this can run for an hour.
    ev.append(Event(0.0, length + 6.0, "drone", "A1", gain=0.26, track="pedal",
                    extra={"cutoff": 180.0, "wrap_fade": 6.0}))
    ev.append(Event(0.0, length + 6.0, "drone", "A2", gain=0.40, track="pedal",
                    extra={"cutoff": 320.0, "wrap_fade": 6.0}))

    for i, (t0, name, voicing) in enumerate(areas):
        nxt = areas[(i + 1) % len(areas)][0]
        span = (nxt - t0) if nxt > t0 else (length - t0)
        # The area's own bass colour, well under the pedal and heavily
        # overlapped, so a chord change is a lean rather than an edge.
        ev.append(Event(t0 - 3.0, span + 7.0, "drone", voicing[1], gain=0.30, track="drone",
                        extra={"cutoff": 340.0}))
        # The bed has no metre, so its counterpoint is area-to-area rather than
        # note-to-note: three sustained upper voices whose motion between the
        # six harmonic areas is what the check reads.
        for j, note in enumerate(voicing[2:5]):
            voices.setdefault(f"area{j}", []).append((t0, t0 + span, note))
            # Long bowed tones, each entering at its own moment inside the area
            # so the chord assembles rather than arriving.
            offset = 0.6 + 2.3 * j + float(rng.uniform(0, 1.4))
            ev.append(Event(t0 + offset - 2.5, span - offset + 6.5, "pad", note,
                            gain=0.74 - 0.10 * j, pan=(-0.55 + 0.5 * j), track="strings",
                            extra={"attack": 3.2, "release": 4.5, "bright": 1.0}))
        ev.append(Event(t0 + 1.5, span + 5.5, "choir", voicing[3], gain=0.40,
                        pan=0.15, track="choir", extra={"vowel": "oo"}))
        # A top voice around 350-450 Hz. Without it the whole bed sits under
        # 300 Hz and reads as rumble rather than as an ensemble breathing. The
        # 'ah' formant is the brightest thing in the bed and it is carrying the
        # 1-3 kHz band more or less on its own, so it is worth more than the
        # 0.22 an earlier draft gave it.
        ev.append(Event(t0 + 4.0, span + 4.0, "choir", voicing[5], gain=0.34,
                        pan=-0.3, track="choir", extra={"vowel": "ah"}))
        # And the same voice an octave up, very quiet: pure air, no new onsets,
        # so it cannot introduce a pulse. Without it there is literally nothing
        # above 4 kHz and the bed sounds like it is playing through a wall.
        top = voicing[5][0] + voicing[5][1:-1] + str(int(voicing[5][-1]) + 1)
        ev.append(Event(t0 + 6.0, span + 3.0, "choir", top, gain=0.10,
                        pan=0.45, track="choir", extra={"vowel": "ah"}))

    # --- motif fragments, sparse -------------------------------------------
    # Only ever the head (D-F-A) or the tail (C-B-A-G) of the title tune, never
    # the whole thing -- a player should half-recognise it, not sing along.
    head = ["D4", "F4", "A4"]
    tail = ["C5", "B4", "A4", "G4"]
    fragments = [
        (9.4, head, 0.34, -0.25, 1.9),
        (26.1, tail, 0.26, 0.30, 2.2),
        (41.8, head, 0.30, 0.10, 2.6),
        (57.3, ["A4", "G4", "F4"], 0.24, -0.35, 2.1),
        (70.9, tail, 0.28, 0.22, 2.4),
        (86.2, head, 0.22, -0.15, 3.0),
    ]
    for t0, notes, gain, pan, spread in fragments:
        for k, name in enumerate(notes):
            jitter = float(rng.normal(0, 0.05))
            ev.append(Event(t0 + k * spread / len(notes) + jitter, 3.4, "pluck", name,
                            gain=gain * (1.0 - 0.12 * k), pan=pan + 0.05 * k, track="fragment",
                            extra={"brightness": 2600.0, "damping": 0.36, "loop_gain": 0.9958}))
    log.append("Motif fragments (head D-F-A, tail C-B-A-G, never the whole tune):")
    for t0, notes, *_ in fragments:
        log.append(f"  {t0:>5.1f}s  " + " ".join(notes))
    log.append("")

    # --- bells: rare, and never on a grid ----------------------------------
    bell_hits = [(5.2, "A4"), (21.7, "E5"), (35.4, "C5"), (52.9, "G4"),
                 (63.1, "D5"), (77.6, "A4"), (91.3, "E4")]
    for t0, note in bell_hits:
        ev.append(Event(t0, 6.0, "bell", note, gain=0.32, pan=float(rng.uniform(-0.4, 0.4)),
                        track="bell", extra={"warmth": 1.4}))
    log.append("Bells: " + ", ".join(f"{t:.1f}s {n}" for t, n in bell_hits))

    # --- a single soft drum, seven times in 96 s, at irregular spacings -----
    # Gaps of 13.1, 17.6, 11.9, 19.4, 12.7 and 15.2 s. There is no tempo to
    # infer from that, which is the point.
    drum_hits = [7.8, 20.9, 38.5, 50.4, 69.8, 82.5, 93.1]
    for t0 in drum_hits:
        ev.append(Event(t0, 1.4, "perc", gain=0.30, pan=float(rng.uniform(-0.2, 0.2)),
                        track="drum", extra={"pitch_hz": 78.0, "tone": 0.18}))
    log.append("Frame drum: " + ", ".join(f"{t:.1f}" for t in drum_hits) + " s")
    log.append("Smallest gap between any two onsets of the same layer: see analysis.")
    return ev, length, log, voices


def victory_score() -> tuple[list[Event], float, list[str], Voices]:
    """The payoff cue. 10.8 s, one phrase, one cadence, no loop.

    Two things were wrong with the earlier draft and both are fixed here.

    LENGTH. It ran 15.4 s, which is a victory sting that is still going after
    the player has moved on. The spec is 8-12 s. This is 10.8 s: 8.5 s of music
    and 2.3 s of ring, with the last 1.4 s faded.

    CADENCE. It ended G -> D, a plagal 'amen'. Plagal motion is a settling, not
    an arrival -- it has no leading tone and no dissonance to resolve, so it
    confirms a tonic that has already been reached rather than reaching one.
    After an hour of play the cue has to actually land, so this is the full
    apparatus instead:

        G  (IV, the dorian major subdominant -- the predominant)
        D/A  (cadential six-four: the tonic triad over the dominant bass, which
              is the preparation. Its sixth F#3 and fourth D3 above the A are
              both suspensions waiting on the dominant.)
        A7 (V7: F#3 -> E3 resolves the sixth, D3 -> C#3 resolves the fourth,
            and A3 -> G3 adds the seventh. Three suspensions, three resolutions,
            all by step, all downward.)
        D  (I major: C#3 -> D3 as the leading tone, G3 -> F#3 as the seventh,
            and the melody's C#5 -> D5 on top.)

    The bass moves D ... A ... D underneath, so the pedal itself cadences. C# is
    the only note outside D dorian in the whole score and it appears exactly
    once, in the last second, which is musica ficta doing precisely the job it
    was invented for.
    """
    rng = np.random.default_rng(20261225)
    ev: list[Event] = []
    log: list[str] = []
    voices: Voices = {}
    length = 10.8

    def sing(voice: str, t: float, dur: float, pitch: str) -> None:
        voices.setdefault(voice, []).append((t, t + dur, pitch))

    log.append("KATAN — VICTORY  'Landfall'")
    log.append("D dorian into D major · 10.80 s · does not loop")
    log.append("")

    # The tune. One arch: up D-F-A-C, a turn at the top, down through B-A to the
    # phrase's floor of G4 at 6.00 s, then a scalar run G-A-B-C back up into the
    # cadence. The high D5 is held back until the six-four at 7.20 s, so the
    # piece has exactly one climax and it is inside the cadence rather than
    # before it. Note values shorten through the run (0.80, 0.40, 0.30) and then
    # broaden again at the six-four, which is how a phrase pushes and then
    # arrives without changing tempo.
    #
    # The run is also why B4 does not leap straight to D5. An earlier version
    # did, and the accompaniment's tenor moved B2 to D3 underneath it -- the
    # same minor third, two octaves apart, which is a parallel octave arriving
    # on the most important beat in the score.
    tune = [(0.00, "D4", 0.80), (0.80, "F4", 0.40), (1.20, "A4", 1.20),
            (2.40, "C5", 0.80), (3.20, "B4", 0.40), (3.60, "C5", 0.80),
            (4.40, "A4", 0.40), (4.80, "B4", 0.80), (5.60, "A4", 0.40),
            (6.00, "G4", 0.30), (6.30, "A4", 0.30), (6.60, "B4", 0.30),
            (6.90, "C5", 0.30), (7.20, "D5", 0.70), (7.90, "C#5", 0.60),
            (8.50, "D5", 2.30)]
    for t0, name, span in tune:
        ev.append(Event(t0 + float(rng.normal(0, 0.008)), span * 1.7, "lead", name,
                        gain=1.05, pan=0.05, track="lute",
                        extra={"brightness": 5200.0, "damping": 0.20, "loop_gain": 0.9985,
                               "pick": 0.14}))
        ev.append(Event(t0 + float(rng.normal(0, 0.012)), span * 1.35, "pad", name,
                        gain=0.55, pan=-0.2, track="strings",
                        extra={"attack": 0.06, "release": 0.3, "bright": 1.1}))
        sing("melody", t0, span, name)

    # Four parts throughout: bass, then three upper voices that keep their
    # identity from chord to chord, which is the only way a cadence can be said
    # to resolve at all. The C# of the dominant is deliberately absent from the
    # accompaniment and sounded only by the melody -- a leading tone doubled in
    # two octaves resolves in parallel octaves, which is the exact fault this
    # pass exists to remove.
    prog = [(0.00, ["D2", "D3", "F3", "A3"], 2.40, "Dm"),
            (2.40, ["A2", "C3", "F3", "A3"], 2.40, "F/A"),
            (4.80, ["E2", "B2", "E3", "G3"], 1.20, "Em"),
            (6.00, ["G2", "B2", "D3", "G3"], 1.20, "G"),
            (7.20, ["A2", "D3", "F#3", "A3"], 0.70, "D/A"),
            (7.90, ["A2", "E3", "G3", "A3"], 0.60, "A7"),
            (8.50, ["D2", "D3", "F#3", "A3"], 2.30, "D")]
    for t0, voicing, dur, name in prog:
        for i, note in enumerate(voicing):
            hold = dur + (0.9 if t0 < 7.2 else 0.25)
            ev.append(Event(t0 - 0.05, hold, "pad", note, gain=0.42 - 0.04 * i,
                            pan=(-0.5 + 0.22 * i), track="strings",
                            extra={"attack": 0.10, "release": 0.4, "bright": 1.0}))
            ev.append(Event(t0 + i * 0.030, min(3.2, dur + 2.2), "pluck", note, gain=0.5,
                            pan=(0.4 - 0.16 * i), track="harp",
                            extra={"brightness": 3800.0}))
            # The three upper chord tones are the voices the cadence lives in,
            # so they are the ones the counterpoint check reads.
            if i:
                sing(f"chord{i}", t0, dur, note)
        ev.append(Event(t0 - 0.3, dur + 1.2, "choir", voicing[-1], gain=0.36, pan=0.0,
                        track="choir", extra={"vowel": "ah"}))

    # The pedal cadences too: D under the whole phrase, A under the six-four and
    # the dominant, D again at the arrival. A tonic pedal held through the V7
    # would have blunted the one moment the cue exists for.
    for t0, note, dur, gain in ((-0.2, "D1", 7.5, 0.42), (7.15, "A1", 1.45, 0.40),
                                (8.45, "D1", 2.6, 0.46)):
        ev.append(Event(t0, dur, "drone", note, gain=gain, track="drone",
                        extra={"cutoff": 200.0}))
        sing("pedal", max(t0, 0.0), dur, note)

    # Drums tighten into the cadence and stop dead on the arrival.
    hits = [(0.00, 1.0), (1.20, 0.6), (2.40, 0.95), (3.60, 0.6), (4.80, 0.9),
            (6.00, 0.8), (7.20, 0.75), (7.90, 0.8), (8.20, 0.6), (8.35, 0.7),
            (8.50, 1.2)]
    for t0, amp in hits:
        ev.append(Event(t0 + float(rng.normal(0, 0.008)), 1.2, "perc", gain=amp * 0.85,
                        pan=-0.05, track="drum", extra={"pitch_hz": 88.0, "tone": 0.45}))
    for t0 in (0.40, 1.60, 2.80, 4.00, 5.20, 6.40):
        ev.append(Event(t0, 0.3, "perc", gain=0.25, pan=0.4, track="shaker",
                        extra={"kind": "shaker"}))

    for note, g, off in (("D5", 0.85, 0.0), ("A5", 0.55, 0.06), ("F#5", 0.5, 0.12)):
        ev.append(Event(8.50 + off, 5.0, "bell", note, gain=g, pan=0.25, track="bell",
                        extra={"warmth": 1.6}))

    log.append("melody : " + " ".join(n for _, n, _ in tune))
    log.append("harmony: " + " -> ".join(f"{name}@{t:.2f}s" for t, _, _, name in prog))
    log.append("cadence: G (IV) -> D/A (cadential 6-4) -> A7 (V7) -> D (I, Picardy)")
    log.append("         6-4 to 5-3 by step: F#3->E3, D3->C#3, A3->G3; then C#3->D3,")
    log.append("         G3->F#3, and the tune C#5->D5. Bass D ... A ... D.")
    log.append("C# is the only note outside D dorian in the whole score, and it")
    log.append("lasts 0.6 s.")
    return ev, length, log, voices


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------


def write_wav(path: Path, audio: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    data = np.clip(audio, -1.0, 1.0)
    pcm = (data * 32767.0).astype("<i2")
    with wave.open(str(path), "wb") as fh:
        fh.setnchannels(2)
        fh.setsampwidth(2)
        fh.setframerate(SR)
        fh.writeframes(pcm.tobytes())


def measure_loudness(path: Path) -> dict:
    proc = subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostats", "-i", str(path),
         "-af", "loudnorm=print_format=json", "-f", "null", "-"],
        capture_output=True, text=True, check=True,
    )
    blob = proc.stderr[proc.stderr.rindex("{"):]
    return json.loads(blob[: blob.index("}") + 1])


def encode(src: Path, dst: Path, target_lufs: float, bitrate: str) -> None:
    """Two-pass measured loudnorm. Single-pass applies a time-varying gain and
    puts a step at the loop point -- that bug has already shipped here once."""
    m = measure_loudness(src)
    norm = (
        f"loudnorm=I={target_lufs}:TP=-1.5:LRA=9:"
        f"measured_I={m['input_i']}:measured_TP={m['input_tp']}:"
        f"measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:"
        f"offset={m['target_offset']}:linear=true:print_format=summary"
    )
    dst.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(src),
         "-af", norm, "-ar", "44100", "-ac", "2", "-c:a", "libmp3lame",
         "-b:a", bitrate, "-joint_stereo", "1", str(dst)],
        check=True,
    )


# --- tiny PNG writer, via ffmpeg's rawvideo demuxer -------------------------


def write_png(path: Path, rgb: np.ndarray) -> None:
    h, w, _ = rgb.shape
    path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
         "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{w}x{h}", "-i", "-",
         "-frames:v", "1", str(path)],
        input=rgb.astype(np.uint8).tobytes(), check=True,
    )


def viridis(x: np.ndarray) -> np.ndarray:
    """Five-stop approximation, plenty for reading a spectrogram."""
    stops = np.array([[68, 1, 84], [59, 82, 139], [33, 145, 140],
                      [94, 201, 98], [253, 231, 37]], dtype=float)
    pos = np.clip(x, 0, 1) * (len(stops) - 1)
    i = np.clip(pos.astype(int), 0, len(stops) - 2)
    f = (pos - i)[..., None]
    return stops[i] * (1 - f) + stops[i + 1] * f


TRACK_COLOUR = {
    "drone": (70, 80, 120), "harp": (222, 178, 96), "lute": (240, 120, 74),
    "strings": (108, 176, 210), "choir": (176, 140, 214), "counter": (120, 200, 170),
    "drum": (200, 78, 96), "shaker": (150, 150, 150), "bell": (250, 232, 130),
    "fragment": (240, 150, 90), "main": (200, 200, 200),
}


def piano_roll(panels: list[tuple[str, list[Event], float]], path: Path) -> None:
    """One stacked panel per piece: time across, pitch up, one bar per note."""
    width = 1600
    pad = 46
    heights = [420, 320, 260]
    total = sum(heights) + pad * (len(panels) + 1)
    img = np.full((total, width, 3), 22, dtype=np.uint8)
    y0 = pad
    for (title, events, length), height in zip(panels, heights):
        pitched = [e for e in events if e.pitch]
        lo = min(midi_of(e.pitch) for e in pitched) - 2
        hi = max(midi_of(e.pitch) for e in pitched) + 2
        span = max(hi - lo, 1)
        # Backdrop + octave lines.
        img[y0:y0 + height, pad:width - pad] = (30, 32, 38)
        for m in range(lo, hi + 1):
            if m % 12 == 2:  # every D
                yy = y0 + height - int((m - lo) / span * height)
                img[max(yy - 1, y0):yy + 1, pad:width - pad] = (52, 56, 66)
        # Bar / section grid.
        marks = int(length / (BAR * 4)) + 1 if length < 60 else int(length / 8) + 1
        step = (BAR * 4) if length < 60 else 8.0
        for k in range(marks):
            xx = pad + int(k * step / length * (width - 2 * pad))
            if xx < width - pad:
                img[y0:y0 + height, xx:xx + 1] = (60, 64, 74)
        for ev in sorted(pitched, key=lambda e: e.track):
            m = midi_of(ev.pitch)
            x1 = pad + int(max(ev.t, 0) / length * (width - 2 * pad))
            x2 = pad + int(min(ev.t + ev.dur, length) / length * (width - 2 * pad))
            yy = y0 + height - int((m - lo) / span * height)
            colour = np.array(TRACK_COLOUR.get(ev.track, (200, 200, 200)), dtype=float)
            colour = np.clip(colour * (0.45 + 0.55 * min(ev.gain, 1.2)), 0, 255)
            thick = 5 if ev.track in ("lute", "fragment") else 3
            y1, y2 = max(yy - thick, y0), min(yy + thick, y0 + height)
            if x2 > x1:
                img[y1:y2, x1:max(x2, x1 + 2)] = colour.astype(np.uint8)
        # Percussion strip along the bottom.
        for ev in events:
            if ev.pitch:
                continue
            xx = pad + int(ev.t / length * (width - 2 * pad))
            colour = TRACK_COLOUR.get(ev.track, (200, 80, 80))
            img[y0 + height - 12:y0 + height - 2, xx:xx + 3] = colour
        y0 += height + pad
    write_png(path, img)
    # The title text is carried by the text score; the image is read for shape.


def spectrogram_panel(audio: np.ndarray, width: int, height: int) -> np.ndarray:
    mono = audio.mean(axis=1)
    f, t, sxx = signal.spectrogram(mono, fs=SR, nperseg=2048, noverlap=1536)
    db = 10 * np.log10(sxx + 1e-12)
    db = np.clip((db + 105) / 75, 0, 1)
    # Log frequency axis, 40 Hz to 16 kHz.
    edges = np.geomspace(40, 16000, height + 1)
    rows = np.zeros((height, db.shape[1]))
    for i in range(height):
        mask = (f >= edges[i]) & (f < edges[i + 1])
        rows[i] = db[mask].max(axis=0) if mask.any() else np.interp(
            (edges[i] + edges[i + 1]) / 2, f, db.max(axis=1) * 0)
    cols = np.linspace(0, rows.shape[1] - 1, width).astype(int)
    rows = rows[:, cols]
    return viridis(rows[::-1]).astype(np.uint8)


def analysis_image(items: list[tuple[str, np.ndarray]], path: Path) -> None:
    width, height, pad = 1500, 260, 40
    total = len(items) * (height + 90) + pad
    img = np.full((total, width, 3), 18, dtype=np.uint8)
    y = pad
    for _, audio in items:
        panel = spectrogram_panel(audio, width - 2 * pad, height)
        img[y:y + height, pad:width - pad] = panel
        y += height + 10
        # Waveform strip under it.
        mono = audio.mean(axis=1)
        cols = np.array_split(mono, width - 2 * pad)
        peaks = np.array([np.max(np.abs(c)) if c.size else 0 for c in cols])
        strip = 60
        for x, p in enumerate(peaks):
            h = int(min(p, 1.0) * strip / 2)
            mid = y + strip // 2
            img[mid - h:mid + h + 1, pad + x] = (120, 200, 170)
        img[y + strip // 2, pad:width - pad] = np.maximum(
            img[y + strip // 2, pad:width - pad], (60, 70, 80))
        y += strip + 20
    write_png(path, img)


# ---------------------------------------------------------------------------
# Analysis
# ---------------------------------------------------------------------------


PERFECT = {0, 7}  # interval classes that parallel motion is forbidden between


def voice_leading_report(voices: dict[str, list[tuple[float, float, str]]],
                         label: str) -> list[str]:
    """Read the counterpoint back and grade it, rather than asserting it in a comment.

    Builds the sonority at every onset in the piece, then walks every pair of
    voices and flags:

      * parallel unisons, fifths and octaves -- both voices move in the same
        direction and the interval class stays perfect. This is the specific
        failure that turns a counter-line into a thickening of the melody.
      * direct (hidden) fifths and octaves reached by similar motion where the
        UPPER voice leaps. Similar motion into a perfect interval is only
        objectionable when the top voice jumps into it; stepwise arrival is the
        ordinary 'horn fifth' and is not a fault.
      * static pairs, meaning two voices that never move independently.

    Compound intervals are reduced, because a parallel fifteenth is a parallel
    octave with more air in it.
    """
    names = sorted(voices)
    onsets = sorted({round(t, 6) for v in voices.values() for t, _, _ in v})

    def sounding(voice: list[tuple[float, float, str]], t: float) -> int | None:
        for start, end, pitch in voice:
            if start - 1e-6 <= t < end - 1e-6:
                return midi_of(pitch)
        return None

    grid = {n: [sounding(voices[n], t) for t in onsets] for n in names}
    lines = [f"  {label}: counterpoint check, {len(onsets)} sonorities, "
             f"{len(names)} voices ({', '.join(names)})"]
    faults: list[str] = []
    motion_tally = {"contrary": 0, "oblique": 0, "similar": 0}

    for i, a in enumerate(names):
        for b in names[i + 1:]:
            moves = 0
            for k in range(len(onsets) - 1):
                a0, a1, b0, b1 = grid[a][k], grid[a][k + 1], grid[b][k], grid[b][k + 1]
                if None in (a0, a1, b0, b1):
                    continue
                da, db = a1 - a0, b1 - b0
                if da == 0 and db == 0:
                    continue
                moves += 1
                if da == 0 or db == 0:
                    motion_tally["oblique"] += 1
                elif (da > 0) == (db > 0):
                    motion_tally["similar"] += 1
                else:
                    motion_tally["contrary"] += 1
                before, after = abs(a0 - b0), abs(a1 - b1)
                if after % 12 not in PERFECT:
                    continue
                same_dir = da != 0 and db != 0 and (da > 0) == (db > 0)
                if same_dir and before % 12 == after % 12:
                    faults.append(
                        f"    PARALLEL {'octave/unison' if after % 12 == 0 else 'fifth'} "
                        f"{a}+{b} at {onsets[k]:.2f}->{onsets[k + 1]:.2f}s "
                        f"({before} st -> {after} st)")
                elif same_dir:
                    upper = a if a1 > b1 else b
                    leap = abs(da if upper == a else db)
                    if leap > 2:
                        faults.append(
                            f"    direct {'octave' if after % 12 == 0 else 'fifth'} "
                            f"{a}+{b} at {onsets[k + 1]:.2f}s, upper voice leaps {leap} st")
            if moves == 0:
                faults.append(f"    {a}+{b} never move independently")

    total = sum(motion_tally.values()) or 1
    lines.append("    motion between voice pairs: " + ", ".join(
        f"{k} {v} ({v / total * 100:.0f}%)" for k, v in motion_tally.items()))
    if faults:
        lines.extend(faults)
        lines.append(f"    {len(faults)} fault(s)")
    else:
        lines.append("    no parallel or direct fifths/octaves between any pair")
    return lines


def seam_report(audio: np.ndarray, label: str, crossfade: float = 0.5) -> list[str]:
    """Simulate exactly what SoundBank.setBeds does at the wrap and measure it."""
    n = audio.shape[0]
    xf = int(crossfade * SR)
    period = n - xf
    two = np.zeros((period + n, 2))
    # The linear pair SoundBank now uses. Because the file's tail is a copy of
    # its own head, two identical signals meet here and linear gains sum to
    # exactly one. (Before the fix the bank ramped exponentially, which summed
    # to 0.02 at the midpoint -- a 34 dB hole, 0.42 s long, on every wrap.)
    fade_in = np.linspace(0.0, 1.0, xf)[:, None]
    fade_out = np.linspace(1.0, 0.0, xf)[:, None]
    a = audio.copy()
    a[:xf] *= fade_in
    a[period:] *= fade_out
    two[:n] += a
    two[period:period + n] += a
    # Measure 100 ms RMS blocks either side of the seam.
    block = int(0.1 * SR)
    centre = period
    lines = [f"  {label}: 100 ms RMS across the wrap (dBFS)"]
    vals = []
    for k in range(-8, 9):
        s = centre + k * block
        if s < 0 or s + block > two.shape[0]:
            continue
        rms = float(np.sqrt(np.mean(two[s:s + block] ** 2)))
        vals.append(20 * math.log10(rms + 1e-12))
    lines.append("    " + " ".join(f"{v:6.1f}" for v in vals))
    lines.append(f"    spread {max(vals) - min(vals):.2f} dB (musical shape, not a seam artefact --")
    lines.append("     the identity check below is what says whether the seam is clean)")

    # The real test. The tail is a copy of the head and the gains sum to one,
    # so the crossfaded overlap must equal the head sample for sample. Any
    # error here is an actual discontinuity rather than a phrase dynamic.
    overlap = two[period:period + xf]
    ideal = audio[:xf]
    err = float(np.max(np.abs(overlap - ideal)))
    ref = float(np.max(np.abs(audio)))
    lines.append(f"    crossfaded overlap vs the file's own head: max error "
                 f"{20 * math.log10(err / ref + 1e-15):.1f} dB below peak")

    # And a click check: the largest single-sample jump at the wrap, against
    # the largest anywhere in the file.
    seam_slice = two[period - 64:period + xf + 64]
    seam_step = float(np.max(np.abs(np.diff(seam_slice, axis=0))))
    file_step = float(np.max(np.abs(np.diff(audio, axis=0))))
    lines.append(f"    largest sample-to-sample step at the wrap {seam_step:.5f} "
                 f"vs {file_step:.5f} anywhere in the file")
    return lines


def decode(path: Path) -> np.ndarray:
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "2",
         "-ar", str(SR), "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype="<f4").reshape(-1, 2).copy()


def mp3_seam_report(path: Path, label: str, expected: float,
                    crossfade: float = BED_CROSSFADE) -> tuple[list[str], np.ndarray]:
    """Loop the SHIPPED file, not the intermediate WAV.

    Everything upstream can be perfect and still ship a bad loop, because the
    encoder is entitled to add delay and padding at both ends. This decodes the
    mp3, checks it is still sample-exact, concatenates it to itself through the
    same linear crossfade SoundBank uses, and measures the join.
    """
    a = decode(path)
    xf = int(crossfade * SR)
    want = int(round(expected * SR))
    lines = [f"  {label}: shipped mp3 decodes to {a.shape[0]} samples "
             f"({a.shape[0] / SR:.3f} s), expected {want} "
             f"({'gapless' if abs(a.shape[0] - want) <= 1 else 'PADDED — loop will drift'})"]
    period = a.shape[0] - xf
    b = a.copy()
    b[:xf] *= np.linspace(0.0, 1.0, xf)[:, None]
    b[period:] *= np.linspace(1.0, 0.0, xf)[:, None]
    two = np.zeros((period + a.shape[0], 2))
    two[: a.shape[0]] += b
    two[period:] += b
    blk = int(0.05 * SR)
    vals = np.array([20 * math.log10(
        float(np.sqrt(np.mean(two[period + k * blk: period + (k + 1) * blk] ** 2))) + 1e-12)
        for k in range(-40, 40)])
    seam_step = float(np.max(np.abs(np.diff(two[period - 64: period + xf + 64], axis=0))))
    file_step = float(np.max(np.abs(np.diff(a, axis=0))))
    lines.append(f"    across the join: level {vals[:40].mean():.1f} -> {vals[40:].mean():.1f} dBFS, "
                 f"largest 50 ms change {np.max(np.abs(np.diff(vals))):.2f} dB")
    lines.append(f"    largest sample step at the join {seam_step:.5f} vs {file_step:.5f} "
                 f"anywhere in the file "
                 f"({'continuous' if seam_step < file_step else 'A CLICK'})")
    return lines, two[max(period - 3 * SR, 0): period + 3 * SR]


def pulse_report(audio: np.ndarray, label: str, *, floor: float = 1.5,
                 ceiling: float = 8.0) -> list[str]:
    """Hunt for a hidden metronome.

    Autocorrelate the amplitude envelope. A strong peak at a short lag means
    something in the bed is ticking, which is the specific failure that made
    the previous match bed unusable. Anything above about 0.25 at a lag under
    four seconds is worth looking at.
    """
    mono = audio.mean(axis=1)
    # Half-wave-rectified spectral flux: the standard beat-tracker front end.
    # It is near zero for sustained material and spikes on every attack, so
    # unlike a plain amplitude envelope it cannot mistake a slow swell for a
    # pulse. The file is analysed wrapped around itself, because a bed that
    # only ticks across the loop point still ticks.
    doubled = np.concatenate([mono, mono])
    _, _, stft = signal.stft(doubled, fs=SR, nperseg=1024, noverlap=512)
    mag = np.abs(stft)
    rate = SR / 512.0
    flux = np.maximum(np.diff(mag, axis=1), 0).sum(axis=0)
    flux = flux - flux.mean()
    if not np.any(flux):
        return [f"  {label}: no attacks at all, nothing to pulse"]
    ac = signal.correlate(flux, flux, mode="full")[flux.size - 1:]
    ac /= ac[0] + 1e-12
    lags = np.arange(ac.size) / rate
    band = (lags >= 0.2) & (lags <= ceiling)
    vals, band_lags = ac[band], lags[band]
    # Local maxima only. A high value on a smooth slope is not a periodicity.
    peak_idx, _ = signal.find_peaks(vals, prominence=0.005)
    all_peaks = [(float(band_lags[i]), float(vals[i])) for i in peak_idx]
    peaks = sorted(all_peaks, key=lambda p: -p[1])[:6]

    # A single high value proves nothing -- see `--calibrate`, where a drone
    # with literally no onsets in it scores 0.52 at a quarter-second lag. What
    # a metronome actually looks like is a peak at its period AND peaks at the
    # integer multiples of it. So test for the series, not for the value.
    def series_depth(base: float, strength: float) -> int:
        # The multiple has to be near the right lag *and* nearly as strong.
        # Without the strength test the short-lag noise floor is dense enough
        # that some peak always lands close to any multiple you ask for, and
        # control A scores a perfect series on a signal with no onsets in it.
        depth = 0
        for k in range(2, 6):
            want = base * k
            if want > ceiling:
                break
            if any(abs(lag - want) / want < 0.03 and val > 0.6 * strength
                   for lag, val in all_peaks):
                depth += 1
        return depth

    lines = [f"  {label}: spectral-flux autocorrelation, 0.2-{ceiling:.0f} s"]
    lines.append("    lag      r     multiples of it that also peak")
    verdict = 0.0
    verdict_lag = 0.0
    for lag, val in sorted(peaks):
        depth = series_depth(lag, val)
        mark = ""
        if depth >= 2 and lag < floor and val > 0.25:
            mark = "  <-- a metronome at this tempo"
            if val > verdict:
                verdict, verdict_lag = val, lag
        elif depth >= 2 and val > 0.25:
            mark = "  <-- a real, and slow, pulse"
        lines.append(f"    {lag:5.2f} s  {val:+.3f}   {depth}{mark}")
    if verdict:
        lines.append(f"    VERDICT: a pulse at {verdict_lag:.2f} s, which is too fast for a bed")
    else:
        lines.append("    VERDICT: no periodic series under "
                     f"{floor:.1f} s, so nothing in here ticks")
    return lines


def calibrate(rng: np.random.Generator) -> list[str]:
    """Two controls, so the numbers above have a scale.

    A: a sustained drone with zero onsets -- the metric's false-positive floor.
    B: a frame drum every 1.2 seconds -- exactly the defect that made the
       previous match bed unusable, so the detector has to catch it.
    """
    d = drone(110.0, 96.0, rng, cutoff=300.0)
    quiet = np.stack([d, d], axis=1) * 0.5
    out = ["CALIBRATION"]
    out += pulse_report(quiet, "control A, a drone with no onsets at all")
    ticking = np.zeros((int(96 * SR), 2))
    for k in range(80):
        hit = frame_drum(1.0, rng)
        start = int(k * 1.2 * SR)
        ticking[start:start + hit.size, 0] += hit * 0.5
        ticking[start:start + hit.size, 1] += hit * 0.5
    ticking += quiet[: ticking.shape[0]] * 0.6
    out += pulse_report(ticking, "control B, a frame drum every 1.2 s")
    out.append("")
    return out


OCTAVES = [(31, 63), (63, 125), (125, 250), (250, 500), (500, 1000),
           (1000, 2000), (2000, 4000), (4000, 8000), (8000, 16000)]


def balance_report(audio: np.ndarray, label: str) -> list[str]:
    """Octave-band energy, so 'all mud' or 'all fizz' is a number not a hunch."""
    mono = audio.mean(axis=1)
    f, pxx = signal.welch(mono, fs=SR, nperseg=8192)
    total = np.trapezoid(pxx, f)
    lines = [f"  {label}: octave-band share of total energy"]
    cells = []
    for lo, hi in OCTAVES:
        mask = (f >= lo) & (f < hi)
        share = np.trapezoid(pxx[mask], f[mask]) / total * 100 if mask.any() else 0.0
        cells.append(f"{lo:>5}-{hi:<5} {share:5.1f}%")
    lines.append("    " + "  ".join(cells[:5]))
    lines.append("    " + "  ".join(cells[5:]))
    return lines


def level_report(audio: np.ndarray, label: str) -> list[str]:
    peak = float(np.max(np.abs(audio)))
    clipped = int(np.sum(np.abs(audio) >= 0.999))
    rms = float(np.sqrt(np.mean(audio**2)))
    return [f"  {label}: peak {20 * math.log10(peak + 1e-12):.2f} dBFS, "
            f"rms {20 * math.log10(rms + 1e-12):.2f} dBFS, clipped samples {clipped}"]


# ---------------------------------------------------------------------------


SEEDS = {"title": 811001, "match": 811002, "victory": 811003}

PIECES = {
    "title": dict(score=title_score, file="music-title.mp3", lufs=-27.0,
                  bitrate="96k", loop=True, tail=6.0, ir=(2.9, (1.15, 0.78, 0.34))),
    "match": dict(score=match_score, file="music-match.mp3", lufs=-28.5,
                  bitrate="80k", loop=True, tail=8.0, ir=(3.8, (1.7, 1.15, 0.45))),
    "victory": dict(score=victory_score, file="music-victory.mp3", lufs=-22.0,
                    bitrate="128k", loop=False, tail=5.0, ir=(3.2, (1.3, 0.9, 0.4))),
}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", choices=sorted(PIECES), action="append")
    parser.add_argument("--no-encode", action="store_true")
    parser.add_argument("--calibrate", action="store_true",
                        help="print the pulse detector's two control cases and exit")
    args = parser.parse_args()
    names = args.only or list(PIECES)

    if not shutil.which("ffmpeg"):
        print("ffmpeg not found; install it with `brew install ffmpeg`.", file=sys.stderr)
        return 1

    TMP.mkdir(parents=True, exist_ok=True)
    CRIT.mkdir(parents=True, exist_ok=True)

    if args.calibrate:
        print("\n".join(calibrate(np.random.default_rng(4242))))
        return 0

    text: list[str] = ["Katan score, generated by scripts/compose.py.",
                       "Read this as music before trusting anything about the audio.", ""]
    analysis: list[str] = []
    panels: list[tuple[str, list[Event], float]] = []
    spectra: list[tuple[str, np.ndarray]] = []
    seams: list[tuple[str, np.ndarray]] = []

    for name in names:
        cfg = PIECES[name]
        events, length, log, voices = cfg["score"]()
        text.extend(log)
        text.append("")
        text.append("-" * 72)
        text.append("")
        panels.append((name, events, length))

        ir_rng = np.random.default_rng(SEEDS[name])
        ir_len, taus = cfg["ir"]
        ir = impulse_response(ir_rng, length=ir_len, taus=taus)
        audio = render(events, length, np.random.default_rng(SEEDS[name] + 7),
                       ir=ir, tail=cfg["tail"])
        if cfg["loop"]:
            audio = append_head(wrap_loop(audio, length))
        else:
            # A one-shot ends where the score says it ends. Letting the tail
            # run added five seconds of empty reverb to a ten-second cue.
            audio = audio[: int(length * SR)]
            fade = int(1.5 * SR)
            audio[-fade:] *= np.linspace(1, 0, fade)[:, None] ** 1.5

        peak = np.max(np.abs(audio))
        audio = audio / peak * 0.89 if peak > 0 else audio
        wav = TMP / f"{name}.wav"
        write_wav(wav, audio)
        spectra.append((name, audio))

        if voices:
            analysis.extend(voice_leading_report(voices, name))
        analysis.extend(level_report(audio, name))
        analysis.extend(balance_report(audio, name))
        if cfg["loop"]:
            analysis.extend(seam_report(audio, name))
            analysis.extend(pulse_report(audio, name))
        analysis.append("")

        if not args.no_encode:
            dst = OUT / cfg["file"]
            encode(wav, dst, cfg["lufs"], cfg["bitrate"])
            after = measure_loudness(dst)
            size = dst.stat().st_size
            analysis.append(f"  {name}: encoded {dst.name} {size / 1024:.1f} KB, "
                            f"integrated {after['input_i']} LUFS, true peak {after['input_tp']} dBTP")
            shipped = decode(dst)
            analysis.append(f"  {name}: shipped peak "
                            f"{20 * math.log10(float(np.abs(shipped).max()) + 1e-12):.2f} dBFS, "
                            f"clipped samples {int((np.abs(shipped) >= 0.999).sum())}")
            if cfg["loop"]:
                lines, seam = mp3_seam_report(dst, name, length + BED_CROSSFADE)
                analysis.extend(lines)
                seams.append((name, seam))
            analysis.append("")

    piano_roll(panels, CRIT / "music-score.png")
    analysis_image(spectra, CRIT / "music-spectra.png")
    if seams:
        analysis_image(seams, CRIT / "music-seams.png")

    text.append("MEASURED")
    text.extend(analysis)
    (CRIT / "music-score.txt").write_text("\n".join(text) + "\n")
    print("\n".join(analysis))
    total = sum((OUT / PIECES[n]["file"]).stat().st_size for n in PIECES
                if (OUT / PIECES[n]["file"]).exists())
    print(f"music payload: {total / 1024:.1f} KB")
    print(f"score: {CRIT / 'music-score.txt'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
