#!/usr/bin/env python3
"""Author strict img2threejs specs from Katan's approved reference images."""

from __future__ import annotations

import copy
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
ASSETS = ROOT / "art/procedural/standalone-assets"


def load(path: Path) -> dict:
    return json.loads(path.read_text())


def save(path: Path, value: dict) -> None:
    path.write_text(json.dumps(value, indent=2) + "\n")


def attachment(parent: str, socket: str, start: list[float], end: list[float], contact: str = "embedded") -> dict:
    return {
        "parentId": parent,
        "parentSocket": socket,
        "localStart": start,
        "localEnd": end,
        "baseRadius": 0.08,
        "endRadius": 0.04,
        "embedDepth": 0.025,
        "overlap": 0.025,
        "contactType": contact,
        "gapTolerance": 0.006,
        "evidenceRefs": ["full-object"],
    }


def component(template: dict, *, id: str, name: str, level: str, primitive: str, parent: str | None,
              material: str, position: list[float], scale: list[float], features: list[dict] | None = None,
              child_attachment: dict | None = None, importance: float = 0.8) -> dict:
    item = copy.deepcopy(template)
    item.update({
        "id": id,
        "name": name,
        "level": level,
        "primitive": primitive,
        "parent": parent,
        "material": material,
        "materialLayers": [material],
        "importance": importance,
        "confidence": 0.9,
        "attachment": child_attachment,
        "fidelityTier": "reference",
    })
    item["transform"] = {"position": position, "rotation": [0, 0, 0], "scale": scale}
    item["dimensions"] = {
        "width": scale[0], "height": scale[1], "depth": scale[2], "units": "world", "confidence": 0.9
    }
    item["geometryDescriptor"] = {
        "topologyIntent": "procedural real-time mesh with silhouette-preserving geometry",
        "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.025, "segments": 3},
        "deformationStack": ["deterministic asymmetry", "object-scale taper"],
        "uvStrategy": "stable generated object-space projection",
        "normalStrategy": "weighted vertex normals plus independent normal texture",
    }
    item["localFeatures"] = features or []
    item["surfaceDetail"] = {
        "macroRoughness": 0.34,
        "microRoughness": 0.18,
        "bumpAmplitude": 0.035,
        "normalPattern": "independent deterministic multi-band noise",
        "displacementPattern": "silhouette geometry only",
        "occlusionPattern": "contact and cavity biased",
        "edgeWearPattern": "subtle exposed bevel crests",
        "notes": "Macro, meso, and micro bands remain independent from albedo.",
    }
    item["evidenceRefs"] = ["full-object"]
    item["actionProfile"]["pivot"]["mode"] = "base" if parent else "center"
    item["actionProfile"]["collider"] = {
        "type": "box" if primitive in {"box", "hex-prism"} else "cylinder",
        "offset": [0, scale[1] / 2, 0],
        "scale": scale,
        "isTrigger": False,
        "notes": "Gameplay collision stays on canonical board targets; this proxy is semantic runtime metadata.",
    }
    item["actionProfile"]["destruction"]["fractureGroup"] = id
    return item


def material(template: dict, *, id: str, name: str, colors: list[str], roughness: float,
             overrides: list[dict]) -> dict:
    item = copy.deepcopy(template)
    item.update({"id": id, "name": name, "baseColor": colors[0], "color": colors[0], "textureResolution": 1024})
    item["albedo"] = {"dominant": colors[0], "secondary": colors[1:], "samplingNotes": "Sampled from the reference's visible material zones."}
    item["colorVariation"] = {"palette": colors, "pattern": "deterministic object-space mottling", "amplitude": 0.13, "heightCorrelation": 0.22}
    item["roughness"] = {"base": roughness, "variation": 0.14, "map": f"{id}-roughness-independent", "localResponse": "rougher cavities, slightly smoother exposed bevels"}
    item["normal"] = {"pattern": f"{id}-height-derived-normal", "strength": 0.42, "scale": 28, "space": "tangent"}
    item["ambientOcclusion"] = {"map": f"{id}-ao-independent", "cavityStrength": 0.28, "contactShadowBias": 0.38, "notes": "Independent cavity and contact field."}
    item["localOverrides"] = overrides
    item["dirt"] = {"amount": 0.16, "cavityBias": 0.72, "color": "#22241d"}
    item["wear"] = {"edgeWear": 0.08, "scratches": [], "chips": []}
    item["notes"] = "Reference-derived colors with separate procedural albedo, roughness, normal, and AO channels."
    return item


def forest() -> None:
    asset = ASSETS / "01-terrain-forest"
    spec_path = asset / "spec/object-sculpt-spec.json"
    spec = load(spec_path)
    root_template = spec["componentTree"][0]
    material_template = spec["materials"][0]

    spec["suitability"] = "pass"
    spec["scores"] = {
        "object_isolation": 3,
        "silhouette_readability": 3,
        "depth_inference": 3,
        "primitive_decomposition": 3,
        "material_procedurality": 3,
        "occlusion_risk": 2,
        "interaction_fit": 3,
    }
    assessment = spec["preSpecAssessment"]
    assessment["objectClass"] = {
        "primaryType": "terrain tile",
        "primaryDomain": "object",
        "formLanguage": ["botanical-like", "organic", "sculptural"],
        "structureKind": ["layered shell", "repeated modules", "branching hierarchy"],
        "motionPotential": ["static prop", "whole-object transform", "subtle foliage sway"],
        "materialFamilies": ["soil", "moss", "bark", "needles", "stone"],
        "notes": "Exact pointy-top hex slab carrying four asymmetric conifer masses around a readable central clearing.",
    }
    assessment["complexity"]["scores"] = {
        "silhouetteComplexity": 3, "componentCount": 3, "hierarchyDepth": 2, "repetitionDensity": 3,
        "materialLayerCount": 3, "localDetailDensity": 3, "occlusionRisk": 2, "actionReadinessNeed": 1,
    }
    assessment["complexity"]["estimatedCounts"] = {
        "macroComponents": 3, "mesoComponents": 8, "microFeatureGroups": 5, "materialLayers": 4,
        "repetitionSystems": 3,
    }
    assessment["unknownsToResolveBeforeImplementation"] = []
    spec["risks"] = [
        "Back-side branch placement is inferred from the single elevated three-quarter view.",
        "Needle microstructure is represented as clustered tier geometry, not individual needles.",
    ]

    spec["qualityContract"]["definitionOfDone"] = [
        "Pointy-top six-edge slab matches the reference proportions and remains perfectly tileable.",
        "Four irregular conifer masses frame a central clearing; tree height, density, and negative space match the reference before materials.",
        "Trunks visibly contact the ground, foliage tiers overlap without floating, and rocks/moss stay inside the clean hex border.",
        "Soil, needles, bark, moss, and stone retain independent albedo, roughness, normal, and AO response under neutral and grazing light.",
    ]
    spec["qualityTargets"].update({
        "targetFidelity": 0.85,
        "mustMatch": ["exact pointy-top hex silhouette", "four asymmetric forest masses", "central clearing", "layered conifer tiers", "soil-moss-rock material separation"],
        "reviewViewpoints": ["reference-three-quarter", "top", "front-grazing", "close-up-material"],
    })
    spec["referenceCamera"] = {
        "solved": True,
        "fovDegrees": 28,
        "aspect": 1.0,
        "orientation": {"yaw": -38, "pitch": -42, "roll": 0},
        "positionHint": [3.2, 3.4, 4.6],
        "note": "Orthographic-like elevated three-quarter match; camera keeps all six edges visible.",
    }
    spec["silhouette"] = {
        "boundingShape": "regular pointy-top hex slab, width 1.732 and depth 2.0, with four uneven conifer peaks",
        "aspectRatios": [1.0, 0.866, 0.48],
        "symmetry": "hex slab exact; botanical masses deliberately asymmetric",
        "dominantCurves": ["tiered conical canopies", "low moss mounds", "rounded stone clusters"],
        "negativeSpaces": ["central clearing", "gaps between four forest masses", "visible trunk gaps below lower branches"],
        "landmarks": ["tall northwest fir", "twin northeast mass", "dense southeast group", "low southwest group"],
    }
    spec["viewEvidence"][0].update({
        "observations": [
            "six unobstructed equal hex edges and a dark soil sidewall",
            "four asymmetric conifer masses around an open central dirt clearing",
            "visible brown trunks, layered needle tiers, moss patches, and large gray stones",
            "warm upper-left key, cool neutral fill, soft contact shadow",
        ],
        "confidence": 0.94,
    })

    ground_features = [
        {"id": "hex-edge-bevel", "type": "bevel", "placement": "all six exposed slab edges", "size": 0.025, "orientation": "perimeter", "geometryEffect": "three-segment chamfer", "materialEffect": "lighter worn crest", "confidence": 0.97},
        {"id": "soil-strata", "type": "ridge", "placement": "sidewall", "size": 0.018, "orientation": "horizontal broken bands", "geometryEffect": "shallow ridges", "materialEffect": "dark cavity contrast", "confidence": 0.9},
        {"id": "clearing-wear", "type": "stain", "placement": "central clearing", "size": 0.42, "orientation": "irregular", "geometryEffect": "none", "materialEffect": "warmer, smoother compacted soil", "confidence": 0.92},
    ]
    canopy_features = [
        {"id": "needle-tier-ridges", "type": "ridge", "placement": "canopy tier rims", "size": 0.035, "orientation": "radial downward", "geometryEffect": "overlapping serrated tier silhouettes", "materialEffect": "sunlit olive tips", "confidence": 0.88},
        {"id": "canopy-sun-fade", "type": "stain", "placement": "upper-left branch tips", "size": 0.18, "orientation": "key-light facing", "geometryEffect": "none", "materialEffect": "olive-gold faded tips", "confidence": 0.86},
    ]
    rock_features = [
        {"id": "rock-chips", "type": "chip", "placement": "exposed rock crests", "size": 0.04, "orientation": "irregular", "geometryEffect": "faceted notches", "materialEffect": "pale mineral faces", "confidence": 0.84},
        {"id": "rock-moss-stain", "type": "stain", "placement": "rock bases and upper damp faces", "size": 0.12, "orientation": "cavity biased", "geometryEffect": "none", "materialEffect": "green moss darkening", "confidence": 0.88},
    ]

    components = [
        component(root_template, id="root", name="Forest tile root", level="macro", primitive="box", parent=None, material="soil", position=[0, 0, 0], scale=[1.732, 0.72, 2.0], importance=1.0),
        component(root_template, id="ground-slab", name="Pointy-top hex ground slab", level="macro", primitive="extrude", parent="root", material="soil", position=[0, 0.07, 0], scale=[1.0, 0.14, 1.0], features=ground_features, child_attachment=attachment("root", "origin", [0, 0, 0], [0, 0.14, 0], "overlap"), importance=1.0),
        component(root_template, id="forest-mass", name="Four-mass forest composition", level="macro", primitive="instanced-cluster", parent="root", material="needles", position=[0, 0.14, 0], scale=[0.9, 1.15, 0.9], child_attachment=attachment("root", "ground-top", [0, 0.14, 0], [0, 1.2, 0]), importance=1.0),
        component(root_template, id="cluster-nw", name="Tall northwest conifer mass", level="meso", primitive="instanced-cluster", parent="forest-mass", material="needles", position=[-0.38, 0.14, -0.28], scale=[0.36, 1.05, 0.36], features=canopy_features, child_attachment=attachment("forest-mass", "nw-root", [-0.38, 0.14, -0.28], [-0.38, 1.12, -0.28]), importance=0.95),
        component(root_template, id="cluster-ne", name="Northeast conifer mass", level="meso", primitive="instanced-cluster", parent="forest-mass", material="needles", position=[0.42, 0.14, -0.20], scale=[0.34, 0.92, 0.34], features=canopy_features, child_attachment=attachment("forest-mass", "ne-root", [0.42, 0.14, -0.20], [0.42, 0.98, -0.20]), importance=0.92),
        component(root_template, id="cluster-se", name="Dense southeast conifer mass", level="meso", primitive="instanced-cluster", parent="forest-mass", material="needles", position=[0.40, 0.14, 0.38], scale=[0.38, 0.84, 0.38], features=canopy_features, child_attachment=attachment("forest-mass", "se-root", [0.40, 0.14, 0.38], [0.40, 0.9, 0.38]), importance=0.92),
        component(root_template, id="cluster-sw", name="Low southwest conifer mass", level="meso", primitive="instanced-cluster", parent="forest-mass", material="needles", position=[-0.42, 0.14, 0.35], scale=[0.36, 0.72, 0.36], features=canopy_features, child_attachment=attachment("forest-mass", "sw-root", [-0.42, 0.14, 0.35], [-0.42, 0.78, 0.35]), importance=0.9),
        component(root_template, id="trunk-system", name="Visible trunk system", level="meso", primitive="instanced-cluster", parent="forest-mass", material="bark", position=[0, 0.14, 0], scale=[0.08, 0.65, 0.08], child_attachment=attachment("forest-mass", "tree-roots", [0, 0.14, 0], [0, 0.8, 0]), importance=0.86),
        component(root_template, id="central-clearing", name="Open central clearing", level="meso", primitive="cylinder", parent="ground-slab", material="soil", position=[0, 0.145, 0.04], scale=[0.5, 0.01, 0.58], child_attachment=attachment("ground-slab", "top", [0, 0.14, 0.04], [0, 0.15, 0.04], "surface-contact"), importance=0.86),
        component(root_template, id="rock-system", name="Grounded stone clusters", level="meso", primitive="instanced-cluster", parent="ground-slab", material="stone", position=[0, 0.14, 0], scale=[0.18, 0.13, 0.16], features=rock_features, child_attachment=attachment("ground-slab", "top", [0, 0.14, 0], [0, 0.26, 0], "embedded"), importance=0.82),
        component(root_template, id="moss-system", name="Moss and groundcover patches", level="meso", primitive="instanced-cluster", parent="ground-slab", material="moss", position=[0, 0.145, 0], scale=[0.2, 0.025, 0.16], child_attachment=attachment("ground-slab", "top", [0, 0.14, 0], [0, 0.17, 0], "surface-contact"), importance=0.75),
        component(root_template, id="canopy-tiers", name="Overlapping needle tiers", level="micro", primitive="instanced-cluster", parent="forest-mass", material="needles", position=[0, 0.3, 0], scale=[0.18, 0.22, 0.18], features=canopy_features, child_attachment=attachment("forest-mass", "branch-spines", [0, 0.28, 0], [0, 1.1, 0], "overlap")),
        component(root_template, id="root-flares", name="Trunk root flares", level="micro", primitive="cone", parent="trunk-system", material="bark", position=[0, 0.14, 0], scale=[0.1, 0.12, 0.1], child_attachment=attachment("trunk-system", "base", [0, 0.14, 0], [0, 0.26, 0], "embedded")),
        component(root_template, id="soil-pebbles", name="Sparse clearing pebbles", level="micro", primitive="instanced-cluster", parent="ground-slab", material="stone", position=[0, 0.15, 0], scale=[0.035, 0.02, 0.03], child_attachment=attachment("ground-slab", "top", [0, 0.14, 0], [0, 0.17, 0], "embedded")),
        component(root_template, id="moss-cushions", name="Low moss cushions", level="micro", primitive="instanced-cluster", parent="moss-system", material="moss", position=[0, 0.15, 0], scale=[0.1, 0.018, 0.08], child_attachment=attachment("moss-system", "surface", [0, 0.15, 0], [0, 0.17, 0], "surface-contact")),
        component(root_template, id="stone-chips", name="Faceted rock chips", level="micro", primitive="instanced-cluster", parent="rock-system", material="stone", position=[0, 0.18, 0], scale=[0.04, 0.04, 0.04], features=rock_features, child_attachment=attachment("rock-system", "faces", [0, 0.18, 0], [0, 0.22, 0], "surface-contact")),
    ]
    spec["componentTree"] = components

    spec["materials"] = [
        material(material_template, id="soil", name="Forest soil and slab", colors=["#413a22", "#665b32", "#847344"], roughness=0.84, overrides=[
            {"id": "clearing-compaction", "region": "central clearing", "baseColor": "#675b35", "roughness": 0.7, "dirtAmount": 0.08, "evidenceRefs": ["full-object"]},
            {"id": "soil-side-strata", "region": "hex sidewall", "baseColor": "#302719", "roughness": 0.9, "cavityBias": 0.82, "evidenceRefs": ["full-object"]},
        ]),
        material(material_template, id="needles", name="Evergreen needle tiers", colors=["#153c24", "#2a5630", "#6f7735"], roughness=0.74, overrides=[
            {"id": "sunlit-needle-tips", "region": "upper-left branch tips", "baseColor": "#7f7a36", "roughness": 0.66, "fadedMask": 0.22, "evidenceRefs": ["full-object"]},
            {"id": "canopy-cavity", "region": "inner overlapping tiers", "baseColor": "#0b2618", "roughness": 0.84, "cavityBias": 0.9, "evidenceRefs": ["full-object"]},
        ]),
        material(material_template, id="bark", name="Dark conifer bark", colors=["#3a2b1d", "#5a4128", "#211a13"], roughness=0.88, overrides=[
            {"id": "bark-root-darkening", "region": "trunk bases", "baseColor": "#211912", "roughness": 0.93, "dirtAmount": 0.3, "cavityBias": 0.9, "evidenceRefs": ["full-object"]},
        ]),
        material(material_template, id="stone", name="Mossy mineral stone", colors=["#777767", "#a29b7d", "#4d5146"], roughness=0.8, overrides=[
            {"id": "rock-moss", "region": "rock bases and damp upper faces", "baseColor": "#59623a", "roughness": 0.86, "dirtAmount": 0.18, "cavityBias": 0.78, "evidenceRefs": ["full-object"]},
            {"id": "rock-fresh-chip", "region": "exposed faceted crests", "baseColor": "#b1aa8d", "roughness": 0.72, "evidenceRefs": ["full-object"]},
        ]),
        material(material_template, id="moss", name="Moss and low groundcover", colors=["#4d6331", "#78804a", "#283d24"], roughness=0.9, overrides=[
            {"id": "moss-sun-fade", "region": "upper-left patch crests", "baseColor": "#8a8447", "roughness": 0.86, "fadedMask": 0.18, "evidenceRefs": ["full-object"]},
        ]),
    ]
    spec["repetitionSystems"] = [
        {"id": "tree-instances", "name": "Asymmetric conifer distribution", "componentRefs": ["cluster-nw", "cluster-ne", "cluster-se", "cluster-sw"], "count": 16, "distribution": "four weighted clusters with deterministic scale and yaw jitter", "seed": 74021},
        {"id": "canopy-tier-instances", "name": "Layered needle tier system", "componentRefs": ["canopy-tiers"], "count": 58, "distribution": "3-5 overlapping tiers per trunk, denser at lower crown", "seed": 74022},
        {"id": "ground-detail-instances", "name": "Rocks, pebbles, and moss patches", "componentRefs": ["rock-system", "soil-pebbles", "moss-system"], "count": 42, "distribution": "edge-biased groups preserving the central clearing", "seed": 74023},
    ]
    spec["featureReviewTargets"] = [
        {"id": "tileable-hex-silhouette", "name": "Exact pointy-top hex slab and clean border", "tier": "critical", "passIds": ["blockout", "form-refinement"], "minimumScore": 0.88, "mustPass": True, "componentRefs": ["ground-slab"], "evidenceRefs": ["full-object"]},
        {"id": "forest-mass-composition", "name": "Four asymmetric conifer masses and central clearing", "tier": "critical", "passIds": ["blockout", "structural-pass", "form-refinement"], "minimumScore": 0.82, "mustPass": True, "componentRefs": ["forest-mass", "central-clearing"], "evidenceRefs": ["full-object"]},
        {"id": "conifer-tier-system", "name": "Layered conifer canopy silhouettes with visible trunks", "tier": "critical", "passIds": ["structural-pass", "form-refinement"], "minimumScore": 0.8, "mustPass": True, "componentRefs": ["canopy-tiers", "trunk-system"], "evidenceRefs": ["full-object"]},
        {"id": "forest-material-system", "name": "Soil, needles, bark, moss, and stone surface separation", "tier": "critical", "passIds": ["material-pass", "surface-pass", "lighting-pass"], "minimumScore": 0.78, "mustPass": True, "componentRefs": ["ground-slab", "forest-mass", "rock-system", "moss-system"], "evidenceRefs": ["full-object"]},
    ]
    spec["lightingFromPhoto"] = [
        {"type": "key light", "direction": [-0.58, 0.78, 0.24], "color": "#ffd8a6", "intensity": 2.6, "shadowSoftness": 0.32},
        {"type": "fill light", "direction": [0.55, 0.45, -0.6], "color": "#b9d6dc", "intensity": 0.48},
        {"type": "environment rim", "color": "#dfe8e9", "intensity": 0.22, "note": "cool top-right silhouette separation"},
        {"type": "render intent", "exposure": 1.1, "toneMapping": "ACES Filmic", "background": "#ebe7e1", "contactShadow": "soft neutral ground shadow directly beneath slab"},
    ]
    spec["performanceBudget"] = {"qualityPriority": "reference-fidelity", "targetTriangles": 18000, "maxDrawCalls": 18, "textureSize": 1024, "fpsTarget": 60, "optimizationPolicy": "instance repeated tiers and ground detail; preserve the four-mass silhouette"}

    details = [
        ("d01", "bevel", "bright three-segment chamfer around all six tile edges", "object", "geometry", "ground-slab/hex-edge-bevel", 0.97),
        ("d02", "ridge", "broken horizontal soil strata on visible sidewall", "meso", "geometry", "ground-slab/soil-strata", 0.9),
        ("d03", "stain", "warmer compacted central clearing", "macro", "albedo roughness", "soil/clearing-compaction", 0.92),
        ("d04", "ridge", "overlapping serrated needle tier rims", "meso", "geometry normal", "canopy-tiers/needle-tier-ridges", 0.9),
        ("d05", "stain", "olive-gold sun-faded branch tips", "meso", "albedo roughness", "needles/sunlit-needle-tips", 0.86),
        ("d06", "stain", "dark cavity response between overlapping tiers", "meso", "albedo ao", "needles/canopy-cavity", 0.9),
        ("d07", "stain", "damp darkening around visible trunk roots", "meso", "albedo roughness", "bark/bark-root-darkening", 0.86),
        ("d08", "chip", "pale faceted chips on rock crests", "micro", "geometry albedo", "rock-system/rock-chips", 0.84),
        ("d09", "stain", "moss accumulation at rock bases", "micro", "albedo roughness", "stone/rock-moss", 0.88),
        ("d10", "stain", "sun-faded moss cushion crests", "micro", "albedo roughness", "moss/moss-sun-fade", 0.8),
    ]
    assessment["detailInventory"] = {
        "scanMethod": "grid-3x3",
        "targetMinDetails": 10,
        "details": [
            {
                "id": id, "kind": kind, "description": description,
                "region": {"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0, "units": "normalized"},
                "scale": scale, "affects": affects,
                "mapsTo": {"type": "component.localFeatures" if "/" in maps_to and maps_to.split("/")[0] in {c["id"] for c in components} else "material.localOverrides", "ref": maps_to},
                "evidenceRef": "full-object", "confidence": confidence,
            }
            for id, kind, description, scale, affects, maps_to, confidence in details
        ],
    }
    inventory_path = asset / "intake/detail-inventory.json"
    inventory = load(inventory_path)
    inventory["detailInventory"] = assessment["detailInventory"]
    save(inventory_path, inventory)
    save(spec_path, spec)


if __name__ == "__main__":
    forest()
