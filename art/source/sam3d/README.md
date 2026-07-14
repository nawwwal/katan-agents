# SAM 3D source meshes

These are rejected source-study meshes for Katan's settlement and city. They
are not loaded by the browser or imported by the production Blender build.

- The input crops come from Katan's original ImageGen architecture target.
- The GLBs were reconstructed with Meta SAM 3D Objects on July 14, 2026.
- Browser comparison showed that decimation could not remove the dark baked
  lighting, split topology, and scan noise without losing the silhouette.
- The production settlement and city were therefore rebuilt as modular
  Blender-authored stone, plaster, timber, roof, window, and ownership parts.
- The SAM 3D code and checkpoints use the
  [SAM License](https://github.com/facebookresearch/sam-3d-objects/blob/main/LICENSE).

The reproducible Blender build is `art/blender/build_katan_assets.py`; runtime
code consumes only `public/assets/3d/katan-kit.glb`. These files remain only as
evidence for why the single-image reconstruction path was rejected.
