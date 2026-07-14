"""Reproducible Blender study for Katan's premium asset direction.

This is deliberately separate from the production exporter. It compares three
forest/coast/road/settlement treatments under one camera and light rig so the
production script is only changed after a visible selection is made.
"""

from __future__ import annotations

import math
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "art/blender/studies/premium-vertical-slice-v2.png"
SCENE_NAME = "KATAN_PREMIUM_STUDY"


def srgb(value: str) -> tuple[float, float, float, float]:
    value = value.lstrip("#")
    channels = tuple(int(value[index:index + 2], 16) / 255 for index in (0, 2, 4))
    linear = tuple(channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4 for channel in channels)
    return linear + (1.0,)


def material(name: str, color: str, roughness: float, noise_scale: float = 0.0, bump: float = 0.0) -> bpy.types.Material:
    mat = bpy.data.materials.new(f"STUDY_{name}")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    principled = nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = srgb(color)
    principled.inputs["Roughness"].default_value = roughness
    principled.inputs["Metallic"].default_value = 0.0
    if "Specular IOR Level" in principled.inputs:
        principled.inputs["Specular IOR Level"].default_value = 0.26
    if noise_scale and bump:
        noise = nodes.new("ShaderNodeTexNoise")
        noise.inputs["Scale"].default_value = noise_scale
        noise.inputs["Detail"].default_value = 4.0
        noise.inputs["Roughness"].default_value = 0.62
        bump_node = nodes.new("ShaderNodeBump")
        bump_node.inputs["Strength"].default_value = bump
        bump_node.inputs["Distance"].default_value = 0.04
        links.new(noise.outputs["Fac"], bump_node.inputs["Height"])
        links.new(bump_node.outputs["Normal"], principled.inputs["Normal"])
    return mat


def link_object(scene: bpy.types.Scene, obj: bpy.types.Object) -> bpy.types.Object:
    for collection in list(obj.users_collection):
        collection.objects.unlink(obj)
    scene.collection.objects.link(obj)
    return obj


def apply_bevel(obj: bpy.types.Object, width: float, segments: int = 3) -> None:
    modifier = obj.modifiers.new("Broad edge relief", "BEVEL")
    modifier.width = width
    modifier.segments = segments
    modifier.limit_method = "ANGLE"
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    obj.select_set(False)


def box(scene: bpy.types.Scene, name: str, dimensions, location, mat, bevel=0.03, rotation=(0.0, 0.0, 0.0)):
    bpy.ops.mesh.primitive_cube_add(location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        apply_bevel(obj, bevel)
    obj.data.materials.append(mat)
    return link_object(scene, obj)


def cylinder(scene, name, radius, depth, location, mat, vertices=16, bevel=0.015, rotation=0.0):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location, rotation=(0.0, 0.0, rotation))
    obj = bpy.context.object
    obj.name = name
    if bevel:
        apply_bevel(obj, bevel)
    obj.data.materials.append(mat)
    return link_object(scene, obj)


def ico(scene, name, dimensions, location, mat, subdivisions=2, flat=False, rotation=(0.0, 0.0, 0.0)):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivisions, radius=1.0, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    for polygon in obj.data.polygons:
        polygon.use_smooth = not flat
    return link_object(scene, obj)


def prism(scene, name, points, bottom, top, mat, bevel=0.025):
    count = len(points)
    vertices = [(x, y, bottom) for x, y in points] + [(x, y, top) for x, y in points]
    faces = [tuple(range(count - 1, -1, -1)), tuple(range(count, count * 2))]
    faces.extend((index, (index + 1) % count, (index + 1) % count + count, index + count) for index in range(count))
    mesh = bpy.data.meshes.new(f"{name}Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    if bevel:
        apply_bevel(obj, bevel)
    return obj


def pointy_hex(radius=1.0):
    return [(math.cos(math.radians(30 + side * 60)) * radius, math.sin(math.radians(30 + side * 60)) * radius) for side in range(6)]


def ribbon(scene, name, center_x, points, width, height, mat, bevel=0.025):
    vertices = []
    for index, point in enumerate(points):
        before = Vector(points[max(0, index - 1)])
        after = Vector(points[min(len(points) - 1, index + 1)])
        tangent = (after - before).normalized()
        normal = Vector((-tangent.y, tangent.x))
        vertices.extend([
            (center_x + point[0] + normal.x * width / 2, point[1] + normal.y * width / 2, height),
            (center_x + point[0] - normal.x * width / 2, point[1] - normal.y * width / 2, height),
        ])
    faces = []
    for index in range(len(points) - 1):
        a = index * 2
        faces.append((a, a + 2, a + 3, a + 1))
    mesh = bpy.data.meshes.new(f"{name}Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    solid = obj.modifiers.new("Road crown", "SOLIDIFY")
    solid.thickness = 0.035
    bevel_mod = obj.modifiers.new("Worn edge", "BEVEL")
    bevel_mod.width = bevel
    bevel_mod.segments = 3
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier=solid.name)
    bpy.ops.object.modifier_apply(modifier=bevel_mod.name)
    obj.select_set(False)
    return obj


def gable_roof(scene, name, center, width, depth, ridge_height, mat, overhang=0.055):
    cx, cy, base = center
    half_w = width / 2 + overhang
    half_d = depth / 2 + overhang
    vertices = [
        (cx - half_w, cy - half_d, base), (cx + half_w, cy - half_d, base),
        (cx - half_w, cy + half_d, base), (cx + half_w, cy + half_d, base),
        (cx, cy - half_d, base + ridge_height), (cx, cy + half_d, base + ridge_height),
    ]
    faces = [(0, 4, 5, 2), (1, 3, 5, 4), (0, 1, 4), (2, 5, 3)]
    mesh = bpy.data.meshes.new(f"{name}Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    solid = obj.modifiers.new("Roof thickness", "SOLIDIFY")
    solid.thickness = 0.035
    bevel_mod = obj.modifiers.new("Rounded roof edge", "BEVEL")
    bevel_mod.width = 0.018
    bevel_mod.segments = 3
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier=solid.name)
    bpy.ops.object.modifier_apply(modifier=bevel_mod.name)
    obj.select_set(False)
    return obj


def pine_current(scene, x, y, scale, trunk, foliage):
    cylinder(scene, "A_Trunk", 0.035 * scale, 0.38 * scale, (x, y, 0.42), trunk, 10, 0.004)
    for level in range(3):
        bpy.ops.mesh.primitive_cone_add(vertices=12, radius1=(0.23 - level * 0.045) * scale, radius2=0.02, depth=0.22 * scale, location=(x, y, 0.49 + level * 0.13 * scale))
        obj = bpy.context.object
        obj.data.materials.append(foliage)
        link_object(scene, obj)


def pine_chunky(scene, x, y, scale, trunk, dark, light):
    cylinder(scene, "B_Trunk", 0.045 * scale, 0.46 * scale, (x, y, 0.45), trunk, 12, 0.006)
    for level, (z, radius) in enumerate(((0.43, 0.25), (0.55, 0.22), (0.67, 0.17), (0.78, 0.11))):
        ico(scene, f"B_Crown{level}", (radius * 1.8 * scale, radius * 1.25 * scale, radius * 0.72 * scale), (x, y, z * scale + 0.10), dark if level < 2 else light, 2, False, (0.0, level * 0.37, level * 0.21))


def pine_authored(scene, x, y, scale, trunk, dark, mid, sun):
    cylinder(scene, "C_Trunk", 0.05 * scale, 0.58 * scale, (x, y, 0.47), trunk, 14, 0.007)
    for level, (z, radius) in enumerate(((0.43, 0.30), (0.53, 0.28), (0.64, 0.24), (0.74, 0.19), (0.83, 0.13))):
        count = 4 if level < 3 else 3
        for branch in range(count):
            angle = branch / count * math.tau + level * 0.58
            offset = radius * 0.26 * scale
            ico(
                scene,
                f"C_Branch{level}_{branch}",
                (radius * 1.55 * scale, radius * 0.62 * scale, radius * 0.34 * scale),
                (x + math.cos(angle) * offset, y + math.sin(angle) * offset, z * scale + 0.10),
                (dark, mid, sun)[min(2, level // 2)],
                2,
                False,
                (math.radians(6), math.radians(-8), angle),
            )
    ico(scene, "C_Top", (0.14 * scale, 0.13 * scale, 0.26 * scale), (x, y, 0.96 * scale), sun, 2)


def settlement(scene, variant, center_x, mats):
    if variant == "A":
        box(scene, "A_House", (0.42, 0.34, 0.34), (center_x + 0.30, 0.30, 0.47), mats["plaster"], 0.012)
        gable_roof(scene, "A_Roof", (center_x + 0.30, 0.30, 0.66), 0.47, 0.38, 0.18, mats["roof"])
        box(scene, "A_Door", (0.08, 0.025, 0.16), (center_x + 0.30, 0.116, 0.42), mats["wood"], 0.004)
        return
    footprint = 0.48 if variant == "B" else 0.52
    box(scene, f"{variant}_StoneBase", (footprint, 0.39, 0.15), (center_x + 0.29, 0.29, 0.32), mats["stone"], 0.025)
    box(scene, f"{variant}_Plaster", (footprint * 0.92, 0.35, 0.32), (center_x + 0.29, 0.29, 0.53), mats["plaster"], 0.026)
    gable_roof(scene, f"{variant}_Roof", (center_x + 0.29, 0.29, 0.71), footprint * 1.02, 0.42, 0.22 if variant == "C" else 0.19, mats["roof"])
    box(scene, f"{variant}_Door", (0.09, 0.026, 0.18), (center_x + 0.29, 0.104, 0.48), mats["wood"], 0.006)
    for offset in (-0.15, 0.15):
        box(scene, f"{variant}_Beam{offset}", (0.035, 0.028, 0.29), (center_x + 0.29 + offset, 0.105, 0.57), mats["wood"], 0.004)
    box(scene, f"{variant}_BeamTop", (0.42, 0.028, 0.035), (center_x + 0.29, 0.105, 0.64), mats["wood"], 0.004)
    box(scene, f"{variant}_OwnerBanner", (0.035, 0.025, 0.23), (center_x + 0.56, 0.31, 0.57), mats["owner"], 0.006)
    if variant == "C":
        cylinder(scene, "C_Chimney", 0.045, 0.30, (center_x + 0.44, 0.39, 0.78), mats["stone"], 8, 0.007)
        for side in (-1, 1):
            box(scene, f"C_Window{side}", (0.065, 0.018, 0.075), (center_x + 0.29 + side * 0.12, 0.103, 0.57), mats["window"], 0.006)


def build_variant(scene, variant, center_x, mats):
    # Correct canonical pointy-top footprint: sqrt(3) wide and 2 units deep.
    prism(scene, f"{variant}_Cliff", [(center_x + x * 1.04, y * 1.04) for x, y in pointy_hex()], -0.12, 0.18, mats["cliff"], 0.045)
    prism(scene, f"{variant}_Beach", [(center_x + x * 1.015, y * 1.015) for x, y in pointy_hex()], 0.14, 0.23, mats["sand"], 0.028)
    prism(scene, f"{variant}_Ground", [(center_x + x * 0.995, y * 0.995) for x, y in pointy_hex()], 0.20, 0.29, mats["ground"], 0.022)
    ribbon(scene, f"{variant}_Road", center_x, [(-0.76, -0.30), (-0.30, -0.18), (0.14, -0.06), (0.70, 0.11)], 0.18 if variant == "C" else 0.22, 0.305, mats["road"], 0.02)
    if variant == "C":
        ribbon(scene, "C_OwnerEdge", center_x, [(-0.67, -0.35), (-0.28, -0.23), (0.13, -0.11), (0.61, 0.03)], 0.025, 0.345, mats["owner"], 0.006)
        for index, (x, y, size) in enumerate(((-0.72, 0.35, 0.13), (-0.48, -0.57, 0.10), (0.62, -0.37, 0.12))):
            ico(scene, f"C_Rock{index}", (size * 1.35, size, size * 0.92), (center_x + x, y, 0.34), mats["stone"], 1, True, (0.1, index * 0.5, index))
    positions = [(-0.55, 0.36, 0.72), (-0.23, 0.55, 0.82), (0.08, 0.62, 0.68), (-0.63, -0.28, 0.58), (0.52, -0.44, 0.62)]
    if variant == "A":
        for x, y, scale in positions + [(0.52, 0.56, 0.54), (-0.18, -0.62, 0.52)]:
            pine_current(scene, center_x + x, y, scale, mats["trunk"], mats["foliage_mid"])
    elif variant == "B":
        for x, y, scale in positions[:5]:
            pine_chunky(scene, center_x + x, y, scale, mats["trunk"], mats["foliage_dark"], mats["foliage_sun"])
    else:
        for x, y, scale in positions[:4]:
            pine_authored(scene, center_x + x, y, scale, mats["trunk"], mats["foliage_dark"], mats["foliage_mid"], mats["foliage_sun"])
    settlement(scene, variant, center_x, mats)


def look_at(obj: bpy.types.Object, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def main():
    previous = bpy.data.scenes.get(SCENE_NAME)
    if previous:
        bpy.data.scenes.remove(previous)
    scene = bpy.data.scenes.new(SCENE_NAME)
    bpy.context.window.scene = scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1800
    scene.render.resolution_y = 820
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(OUTPUT)
    scene.render.film_transparent = False
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.look = "AgX - Medium High Contrast"

    world = bpy.data.worlds.new("STUDY_World")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = srgb("#0C2933")
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.20
    scene.world = world

    mats = {
        "cliff": material("Cliff", "#52565B", 0.79, 5.0, 0.20),
        "sand": material("Sand", "#BDA269", 0.83, 12.0, 0.10),
        "ground": material("ForestGround", "#3E5738", 0.86, 9.0, 0.16),
        "road": material("Road", "#8B7355", 0.90, 16.0, 0.14),
        "stone": material("Stone", "#787A75", 0.82, 6.0, 0.18),
        "trunk": material("Timber", "#4A2B1E", 0.86, 7.0, 0.14),
        "wood": material("DarkTimber", "#392118", 0.84, 9.0, 0.12),
        "plaster": material("Plaster", "#C8B691", 0.76, 11.0, 0.07),
        "roof": material("Terracotta", "#8C3F28", 0.72, 13.0, 0.12),
        "owner": material("OwnerCoral", "#C9402E", 0.60),
        "window": material("WindowWarm", "#F2B35C", 0.38),
        "foliage_dark": material("PineShadow", "#133B26", 0.84, 5.0, 0.10),
        "foliage_mid": material("PineMid", "#245E34", 0.82, 6.0, 0.10),
        "foliage_sun": material("PineSun", "#4F7A3B", 0.80, 6.0, 0.08),
    }

    # Deep ocean under all variants; broad geometry avoids a staged pedestal feel.
    ocean = box(scene, "STUDY_Ocean", (12.5, 5.8, 0.18), (0.0, 0.0, -0.32), material("Ocean", "#07576A", 0.24, 2.4, 0.12), 0.05)
    ocean.data.materials[0].node_tree.nodes["Principled BSDF"].inputs["Metallic"].default_value = 0.08

    for variant, center_x in (("A", -3.15), ("B", 0.0), ("C", 3.15)):
        build_variant(scene, variant, center_x, mats)

    bpy.ops.object.light_add(type="SUN", location=(-6.0, -7.0, 10.0))
    sun = link_object(scene, bpy.context.object)
    sun.data.energy = 2.2
    sun.data.angle = math.radians(5.5)
    sun.data.color = srgb("#FFD2A0")[:3]
    sun.rotation_euler = (math.radians(28), math.radians(-24), math.radians(-34))

    bpy.ops.object.light_add(type="AREA", location=(-4.5, -5.5, 7.5))
    key = link_object(scene, bpy.context.object)
    key.data.energy = 820
    key.data.color = srgb("#FFD9B0")[:3]
    key.data.shape = "DISK"
    key.data.size = 5.5
    look_at(key, (0.0, 0.0, 0.25))

    bpy.ops.object.light_add(type="AREA", location=(5.0, 4.0, 5.0))
    fill = link_object(scene, bpy.context.object)
    fill.data.energy = 410
    fill.data.color = srgb("#77BFD6")[:3]
    fill.data.size = 7.0
    look_at(fill, (0.0, 0.0, 0.35))

    bpy.ops.object.camera_add(location=(8.9, -10.6, 7.2))
    camera = link_object(scene, bpy.context.object)
    camera.data.lens = 61
    look_at(camera, (0.0, 0.0, 0.35))
    scene.camera = camera

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.render.render(write_still=True)
    print(f"STUDY_RENDER {OUTPUT}")


if __name__ == "__main__":
    main()
