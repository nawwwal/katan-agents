# SAM 3D source meshes

These are source meshes for Katan's settlement and city hero pieces. They are
not loaded by the browser directly.

- The input crops come from Katan's original ImageGen architecture target.
- The GLBs were reconstructed with Meta SAM 3D Objects on July 14, 2026.
- Blender owns the production cleanup: normalized units and pivots, 50% city
  decimation, 512 px runtime textures, material response, player-color parts,
  stable node names, and final kit export.
- The SAM 3D code and checkpoints use the
  [SAM License](https://github.com/facebookresearch/sam-3d-objects/blob/main/LICENSE).

The reproducible Blender build is `art/blender/build_katan_assets.py`; runtime
code consumes only `public/assets/3d/katan-kit.glb`.
