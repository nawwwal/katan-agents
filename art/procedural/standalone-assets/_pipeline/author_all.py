#!/usr/bin/env python3
"""Initialize img2threejs intake/spec folders for Katan reference assets."""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


COMPLEXITY = {
    "02-terrain-pasture": "complex",
    "03-terrain-fields": "complex",
    "04-terrain-hills": "complex",
    "05-terrain-mountains": "complex",
    "06-terrain-desert": "complex",
    "07-coast-module": "complex",
    "08-road": "simple",
    "09-settlement": "moderate",
    "10-city": "moderate",
    "11-port": "moderate",
    "12-robber": "moderate",
    "13-board-frame": "complex",
    "14-number-token": "simple",
    "15-dice": "simple",
    "16-water-surface": "simple",
}


def run(*args: object) -> None:
    subprocess.run([str(arg) for arg in args], check=True)


def author(asset_id: str, repo: Path, forge: Path) -> None:
    reference = repo / "art/reference/standalone-assets" / f"{asset_id}.png"
    output = repo / "art/procedural/standalone-assets" / asset_id
    intake = output / "intake"
    spec = output / "spec"
    assessment = spec / "assessment.json"
    sculpt_spec = spec / "object-sculpt-spec.json"
    if not reference.exists():
        raise FileNotFoundError(reference)

    intake.mkdir(parents=True, exist_ok=True)
    spec.mkdir(parents=True, exist_ok=True)
    probe = run_capture(sys.executable, forge / "stage1_intake/probe_image.py", reference)
    (intake / "probe.txt").write_text(probe)

    if not assessment.exists():
        run(
            sys.executable,
            forge / "stage2_spec/new_pre_spec_assessment.py",
            asset_id.replace("-", " ").title(),
            "--image",
            reference,
            "--complexity",
            COMPLEXITY[asset_id],
            "--out",
            assessment,
        )

    if COMPLEXITY[asset_id] != "simple" and not (intake / "detail-inventory.json").exists():
        run(
            sys.executable,
            forge / "stage1_intake/build_detail_inventory.py",
            reference,
            "--mode",
            "grid-3x3",
            "--out-dir",
            intake / "crops",
            "--out",
            intake / "detail-inventory.json",
        )

    if not sculpt_spec.exists():
        run(
            sys.executable,
            forge / "stage2_spec/new_sculpt_spec.py",
            asset_id.replace("-", " ").title(),
            "--image",
            reference,
            "--assessment",
            assessment,
            "--out",
            sculpt_spec,
        )

    print(asset_id)


def run_capture(*args: object) -> str:
    return subprocess.run(
        [str(arg) for arg in args], check=True, capture_output=True, text=True
    ).stdout


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("assets", nargs="*", choices=sorted(COMPLEXITY))
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[4]
    forge = Path.home() / ".agents/skills/img2threejs/forge"
    for asset_id in args.assets or COMPLEXITY:
        author(asset_id, repo, forge)


if __name__ == "__main__":
    main()
