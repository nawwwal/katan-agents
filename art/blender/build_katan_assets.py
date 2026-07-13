"""Build Katan's textured tabletop asset kit and export a web-ready GLB.

The file is intentionally self-contained: Blender owns geometry, UVs, pivots,
materials, preview rendering, and glTF export. React Three Fiber owns gameplay
placement, interaction, camera motion, and dynamic player colors.
"""

from __future__ import annotations

import math
import random
import subprocess
import tempfile
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[2]
TEXTURE_DIR = ROOT / "art/blender/textures"
SAM_SOURCE_DIR = ROOT / "art/source/sam3d"
GLB_PATH = ROOT / "public/assets/3d/katan-kit.glb"
BLEND_PATH = ROOT / "art/blender/katan-kit.blend"
PREVIEW_PATH = ROOT / "art/blender/katan-kit-preview.png"
RNG = random.Random(74021)


PALETTE = {
    "turf_dark": "#31563A",
    "turf": "#56804A",
    "forest_dark": "#0B331E",
    "forest_mid": "#1B5A2E",
    "forest_light": "#4B7E39",
    "pasture_dark": "#416A39",
    "pasture_mid": "#6F9548",
    "pasture_light": "#A7B96B",
    "grain_dark": "#7B4E18",
    "grain_mid": "#B77C22",
    "grain_light": "#DAB94A",
    "clay_dark": "#6B3022",
    "clay_mid": "#A44B30",
    "clay_light": "#CF7444",
    "ore_dark": "#33434A",
    "ore_mid": "#5D7077",
    "ore_light": "#A4ADAA",
    "desert_dark": "#9B6935",
    "desert_mid": "#C69A54",
    "desert_light": "#E0C382",
    "plaster": "#B6A17B",
    "plaster_light": "#D1C09A",
    "player": "#B83E2E",
    "window": "#2A6670",
    "window_warm": "#F0A14A",
    "robber": "#252B2D",
    "robber_dark": "#0E1112",
    "token": "#E6D09A",
    "token_rim": "#674323",
    "metal": "#66533D",
    "sheep": "#E8E0CC",
    "sheep_dark": "#544A3E",
}


def rgba(value: str) -> tuple[float, float, float, float]:
    value = value.lstrip("#")
    srgb = tuple(int(value[i : i + 2], 16) / 255 for i in (0, 2, 4))
    linear = tuple(channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4 for channel in srgb)
    return linear + (1.0,)


def clean_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in list(bpy.data.collections):
        bpy.data.collections.remove(collection)
    for material in list(bpy.data.materials):
        bpy.data.materials.remove(material)
    for image in list(bpy.data.images):
        bpy.data.images.remove(image)


def make_collection(name: str) -> bpy.types.Collection:
    collection = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(collection)
    return collection


def move_to(obj: bpy.types.Object, collection: bpy.types.Collection) -> None:
    for linked in list(obj.users_collection):
        linked.objects.unlink(obj)
    collection.objects.link(obj)


def load_image(path: Path, non_color: bool) -> bpy.types.Image:
    image = bpy.data.images.load(str(path), check_existing=True)
    image.colorspace_settings.name = "Non-Color" if non_color else "sRGB"
    return image


def make_pbr_material(
    name: str,
    prefix: str,
    roughness_default: float = 0.75,
    use_rough_map: bool = False,
    color_prefix: str | None = None,
) -> bpy.types.Material:
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    material.diffuse_color = (1, 1, 1, 1)
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    principled = nodes.new("ShaderNodeBsdfPrincipled")
    principled.inputs["Roughness"].default_value = roughness_default
    if "Specular IOR Level" in principled.inputs:
        principled.inputs["Specular IOR Level"].default_value = 0.30

    color = nodes.new("ShaderNodeTexImage")
    color.name = f"{prefix} color"
    color.image = load_image(TEXTURE_DIR / f"{color_prefix or prefix}-color.jpg", False)
    links.new(color.outputs["Color"], principled.inputs["Base Color"])

    normal_image = nodes.new("ShaderNodeTexImage")
    normal_image.name = f"{prefix} normal"
    normal_image.image = load_image(TEXTURE_DIR / f"{prefix}-normal.jpg", True)
    normal = nodes.new("ShaderNodeNormalMap")
    normal.inputs["Strength"].default_value = 0.72
    links.new(normal_image.outputs["Color"], normal.inputs["Color"])
    links.new(normal.outputs["Normal"], principled.inputs["Normal"])

    if use_rough_map:
        rough = nodes.new("ShaderNodeTexImage")
        rough.name = f"{prefix} roughness"
        rough.image = load_image(TEXTURE_DIR / f"{prefix}-rough.jpg", True)
        links.new(rough.outputs["Color"], principled.inputs["Roughness"])
    else:
        arm = nodes.new("ShaderNodeTexImage")
        arm.name = f"{prefix} ARM"
        arm.image = load_image(TEXTURE_DIR / f"{prefix}-arm.jpg", True)
        separate = nodes.new("ShaderNodeSeparateColor")
        separate.mode = "RGB"
        links.new(arm.outputs["Color"], separate.inputs["Color"])
        links.new(separate.outputs["Green"], principled.inputs["Roughness"])
        links.new(separate.outputs["Blue"], principled.inputs["Metallic"])

    links.new(principled.outputs["BSDF"], output.inputs["Surface"])
    return material


def make_material(name: str, color: str, roughness: float = 0.76, noise: float = 0.0) -> bpy.types.Material:
    material = bpy.data.materials.new(name)
    material.diffuse_color = rgba(color)
    material.use_nodes = True
    principled = material.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = rgba(color)
    principled.inputs["Roughness"].default_value = roughness
    principled.inputs["Metallic"].default_value = 0.0
    if "Specular IOR Level" in principled.inputs:
        principled.inputs["Specular IOR Level"].default_value = 0.30
    if noise:
        nodes = material.node_tree.nodes
        links = material.node_tree.links
        texture = nodes.new("ShaderNodeTexNoise")
        texture.inputs["Scale"].default_value = 8.0
        texture.inputs["Detail"].default_value = 4.0
        texture.inputs["Roughness"].default_value = 0.72
        bump = nodes.new("ShaderNodeBump")
        bump.inputs["Strength"].default_value = noise
        bump.inputs["Distance"].default_value = 0.045
        links.new(texture.outputs["Fac"], bump.inputs["Height"])
        links.new(bump.outputs["Normal"], principled.inputs["Normal"])
    return material


def make_vertex_material(name: str, roughness: float) -> bpy.types.Material:
    material = bpy.data.materials.new(name)
    material.diffuse_color = (1, 1, 1, 1)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    principled = nodes.new("ShaderNodeBsdfPrincipled")
    color = nodes.new("ShaderNodeVertexColor")
    color.layer_name = "Color"
    principled.inputs["Roughness"].default_value = roughness
    if "Specular IOR Level" in principled.inputs:
        principled.inputs["Specular IOR Level"].default_value = 0.30
    links.new(color.outputs["Color"], principled.inputs["Base Color"])
    links.new(principled.outputs["BSDF"], output.inputs["Surface"])
    return material


def apply_bevel(obj: bpy.types.Object, width: float, segments: int = 3) -> None:
    if width <= 0:
        return
    modifier = obj.modifiers.new("Edge relief", "BEVEL")
    modifier.width = width
    modifier.segments = segments
    modifier.limit_method = "ANGLE"
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    obj.select_set(False)


def uv_project(obj: bpy.types.Object) -> None:
    if obj.type != "MESH":
        return
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(58), island_margin=0.02)
    bpy.ops.object.mode_set(mode="OBJECT")
    obj.select_set(False)


def finish_mesh(obj: bpy.types.Object, collection: bpy.types.Collection) -> bpy.types.Object:
    move_to(obj, collection)
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    bpy.context.scene.cursor.location = (0, 0, 0)
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
    obj.select_set(False)
    obj["katan_export"] = True
    obj["unit"] = "meter"
    obj["pivot"] = "gameplay_contact"
    return obj


def import_sam_asset(
    source_path: Path,
    name: str,
    collection: bpy.types.Collection,
    footprint: float,
    height_scale: float,
    decimate_ratio: float = 1.0,
) -> bpy.types.Object:
    """Prepare an image-reconstructed hero mesh for the deterministic kit.

    SAM is only a source-mesh accelerator. Blender still owns cleanup,
    topology reduction, texture sizing, material response, scale, pivot, and
    the final glTF contract.
    """
    existing = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(source_path))
    imported = [obj for obj in bpy.data.objects if obj not in existing and obj.type == "MESH"]
    if not imported:
        raise RuntimeError(f"SAM source contains no mesh: {source_path}")
    obj = imported[0] if len(imported) == 1 else join(imported, name)
    obj.name = name
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    obj.select_set(False)

    coordinates = [vertex.co.copy() for vertex in obj.data.vertices]
    minimum = Vector((min(point.x for point in coordinates), min(point.y for point in coordinates), min(point.z for point in coordinates)))
    maximum = Vector((max(point.x for point in coordinates), max(point.y for point in coordinates), max(point.z for point in coordinates)))
    origin = Vector(((minimum.x + maximum.x) / 2, (minimum.y + maximum.y) / 2, minimum.z))
    base_scale = footprint / max(maximum.x - minimum.x, maximum.y - minimum.y)
    for vertex in obj.data.vertices:
        vertex.co -= origin
        vertex.co.x *= base_scale
        vertex.co.y *= base_scale
        vertex.co.z *= base_scale * height_scale

    if decimate_ratio < 1.0:
        modifier = obj.modifiers.new("Web topology", "DECIMATE")
        modifier.ratio = decimate_ratio
        modifier.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        obj.select_set(False)

    for index, material in enumerate(obj.data.materials):
        material.name = f"SAM_{name}_{index}"
        material.diffuse_color = (1, 1, 1, 1)
        if not material.use_nodes:
            continue
        principled = material.node_tree.nodes.get("Principled BSDF")
        if principled:
            principled.inputs["Base Color"].default_value = (1, 1, 1, 1)
            principled.inputs["Metallic"].default_value = 0.0
            principled.inputs["Roughness"].default_value = 0.78
            if "Specular IOR Level" in principled.inputs:
                principled.inputs["Specular IOR Level"].default_value = 0.28
        for image_node in (node for node in material.node_tree.nodes if node.type == "TEX_IMAGE" and node.image):
            image_node.image.name = f"SAM_{name}_Albedo"
            if tuple(image_node.image.size) != (512, 512):
                image_node.image.scale(512, 512)

    return finish_mesh(obj, collection)


def add_box(name: str, dimensions: tuple[float, float, float], location: tuple[float, float, float], material: bpy.types.Material, bevel: float = 0.025, rotation: tuple[float, float, float] = (0, 0, 0)) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    apply_bevel(obj, bevel)
    obj.data.materials.append(material)
    uv_project(obj)
    return obj


def add_cylinder(name: str, radius: float, depth: float, location: tuple[float, float, float], material: bpy.types.Material, vertices: int = 16, scale: tuple[float, float, float] = (1, 1, 1), rotation: float = 0.0, bevel: float = 0.015, smooth: bool = True) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location, rotation=(0, 0, rotation))
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    apply_bevel(obj, bevel)
    obj.data.materials.append(material)
    uv_project(obj)
    if smooth:
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
    return obj


def add_cone(name: str, radius1: float, radius2: float, depth: float, location: tuple[float, float, float], material: bpy.types.Material, vertices: int = 12, rotation: float = 0.0, bevel: float = 0.018) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius1, radius2=radius2, depth=depth, location=location, rotation=(0, 0, rotation))
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(material)
    apply_bevel(obj, bevel)
    uv_project(obj)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def add_ico(
    name: str,
    dimensions: tuple[float, float, float],
    location: tuple[float, float, float],
    material: bpy.types.Material,
    phase: float = 0.0,
    subdivisions: int = 2,
    smooth: bool = True,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivisions, radius=1, location=location)
    obj = bpy.context.object
    obj.name = name
    for vertex in obj.data.vertices:
        direction = vertex.co.normalized()
        vertex.co *= 1 + 0.10 * math.sin(direction.x * 7.1 + direction.y * 5.3 + direction.z * 8.7 + phase)
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.rotation_euler = (0.035 * math.sin(phase), phase * 0.13, 0.045 * math.cos(phase))
    obj.data.materials.append(material)
    uv_project(obj)
    for polygon in obj.data.polygons:
        polygon.use_smooth = smooth
    return obj


def add_uv_sphere(name: str, dimensions: tuple[float, float, float], location: tuple[float, float, float], material: bpy.types.Material, rotation: float = 0.0) -> bpy.types.Object:
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, location=location, rotation=(0, 0, rotation))
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material)
    uv_project(obj)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def add_gable(name: str, width: float, depth: float, height: float, location: tuple[float, float, float], material: bpy.types.Material, bevel: float = 0.025) -> bpy.types.Object:
    x = width / 2
    y = depth / 2
    vertices = [(-x, -y, 0), (x, -y, 0), (-x, y, 0), (x, y, 0), (0, -y, height), (0, y, height)]
    faces = [(0, 1, 3, 2), (0, 4, 1), (2, 3, 5), (0, 2, 5, 4), (1, 4, 5, 3)]
    mesh = bpy.data.meshes.new(f"{name}Mesh")
    mesh.from_pydata(vertices, [], faces)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = location
    obj.data.materials.append(material)
    apply_bevel(obj, bevel)
    uv_project(obj)
    return obj


def add_crag(
    name: str,
    width: float,
    depth: float,
    height: float,
    location: tuple[float, float, float],
    material: bpy.types.Material,
    phase: float,
    sides: int = 7,
) -> bpy.types.Object:
    """Create a tapered, flat-shaded rock with an authored mountain profile."""
    vertices: list[tuple[float, float, float]] = []
    ring_specs = [
        (0.0, 0.56, 0.50, 0.00, 0.00),
        (0.42, 0.42, 0.36, 0.04, -0.02),
        (0.74, 0.24, 0.21, -0.03, 0.025),
    ]
    for ring, (z_factor, x_radius, y_radius, offset_x, offset_y) in enumerate(ring_specs):
        for side in range(sides):
            angle = side / sides * math.tau + phase * 0.19 + ring * 0.11
            jag = 1.0 + 0.12 * math.sin(side * 3.7 + ring * 2.1 + phase)
            vertices.append((
                (math.cos(angle) * x_radius * jag + offset_x) * width,
                (math.sin(angle) * y_radius * jag + offset_y) * depth,
                z_factor * height,
            ))
    apex = len(vertices)
    vertices.append((width * 0.035 * math.sin(phase), depth * 0.025 * math.cos(phase * 1.7), height))
    faces: list[tuple[int, ...]] = [tuple(range(sides - 1, -1, -1))]
    for ring in range(len(ring_specs) - 1):
        start = ring * sides
        next_start = (ring + 1) * sides
        for side in range(sides):
            following = (side + 1) % sides
            faces.append((start + side, start + following, next_start + following, next_start + side))
    top_start = (len(ring_specs) - 1) * sides
    for side in range(sides):
        faces.append((top_start + side, top_start + (side + 1) % sides, apex))
    mesh = bpy.data.meshes.new(f"{name}Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(material)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = location
    uv_project(obj)
    for polygon in obj.data.polygons:
        polygon.use_smooth = False
    return obj


def join(objects: list[bpy.types.Object], name: str) -> bpy.types.Object:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    joined = bpy.context.object
    joined.name = name
    bpy.context.scene.cursor.location = (0, 0, 0)
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
    return joined


def bake_vertex_colors(obj: bpy.types.Object, material: bpy.types.Material) -> None:
    mesh = obj.data
    color_layer = mesh.color_attributes.get("Color") or mesh.color_attributes.new(name="Color", type="BYTE_COLOR", domain="CORNER")
    slot_colors = [tuple(slot.diffuse_color) for slot in mesh.materials]
    for polygon in mesh.polygons:
        color = slot_colors[polygon.material_index]
        for loop_index in polygon.loop_indices:
            color_layer.data[loop_index].color = color
        polygon.material_index = 0
    mesh.materials.clear()
    mesh.materials.append(material)


def merge_colored(objects: list[bpy.types.Object], name: str, material: bpy.types.Material, collection: bpy.types.Collection) -> bpy.types.Object:
    obj = join(objects, name)
    bake_vertex_colors(obj, material)
    return finish_mesh(obj, collection)


def merge_same(objects: list[bpy.types.Object], name: str, collection: bpy.types.Collection) -> bpy.types.Object:
    source_material = objects[0].data.materials[0]
    obj = join(objects, name)
    obj.data.materials.clear()
    obj.data.materials.append(source_material)
    for polygon in obj.data.polygons:
        polygon.material_index = 0
    return finish_mesh(obj, collection)


def coastal_outline(scale: float) -> list[tuple[float, float]]:
    sqrt3 = math.sqrt(3)
    counts: dict[tuple[int, int], tuple[float, float, int]] = {}
    coordinates = []
    for q in range(-2, 3):
        for r in range(max(-2, -q - 2), min(2, -q + 2) + 1):
            coordinates.append((q, r))
    for q, r in coordinates:
        x = sqrt3 * (q + r / 2)
        game_z = 1.5 * r
        for corner in range(6):
            angle = math.radians(60 * corner + 30)
            px = x + math.cos(angle)
            py = -(game_z + math.sin(angle))
            key = (round(px * 1000), round(py * 1000))
            previous = counts.get(key)
            counts[key] = (px, py, 1 if previous is None else previous[2] + 1)
    points = [(x * scale, y * scale) for x, y, count in counts.values() if count < 3]
    return sorted(points, key=lambda point: math.atan2(point[1], point[0]))


def polygon_prism(name: str, points: list[tuple[float, float]], bottom: float, top: float, material: bpy.types.Material, bevel: float) -> bpy.types.Object:
    count = len(points)
    vertices = [(x, y, bottom) for x, y in points] + [(x, y, top) for x, y in points]
    faces = [tuple(range(count - 1, -1, -1)), tuple(range(count, count * 2))]
    faces.extend((i, (i + 1) % count, (i + 1) % count + count, i + count) for i in range(count))
    mesh = bpy.data.meshes.new(f"{name}Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(material)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    apply_bevel(obj, bevel)
    uv_project(obj)
    return obj


def hex_ground(name: str, material: bpy.types.Material, collection: bpy.types.Collection) -> bpy.types.Object:
    # 0.997 is the canonical fitted footprint. Bevel remains inside the boundary.
    ground = add_cylinder(name, 0.997, 0.16, (0, 0, 0.08), material, vertices=6, rotation=math.radians(30), bevel=0.014, smooth=False)
    return finish_mesh(ground, collection)


def build_board_frame(materials, collection) -> list[bpy.types.Object]:
    objects = [
        finish_mesh(polygon_prism("BoardFrameCliff", coastal_outline(1.065), -0.08, 0.33, materials["rock"], 0.04), collection),
        finish_mesh(polygon_prism("BoardFrameBeach", coastal_outline(1.035), 0.28, 0.41, materials["sand"], 0.035), collection),
        finish_mesh(polygon_prism("BoardFrameTurf", coastal_outline(1.012), 0.36, 0.46, materials["grass"], 0.026), collection),
    ]
    rocks = []
    # Keep the shoreline rocks embedded in the beach/cliff transition. The
    # earlier outward ring read as detached pebbles floating beside the board.
    for index, (x, y) in enumerate(coastal_outline(1.046)):
        if index % 3:
            continue
        direction = Vector((x, y)).normalized()
        scale = 0.12 + (index % 4) * 0.012
        rocks.append(add_ico(
            f"CoastRock{index}",
            (scale * 1.35, scale, scale * (1.08 + (index % 3) * 0.10)),
            (x - direction.x * 0.018, y - direction.y * 0.018, 0.36 + (index % 2) * 0.012),
            materials["rock"],
            index * 1.73,
            subdivisions=1,
            smooth=False,
        ))
    objects.append(merge_same(rocks, "BoardFrameRocks", collection))
    return objects


def add_tiered_tree(parts: list[bpy.types.Object], materials, x: float, y: float, scale: float, seed: int) -> None:
    parts.append(add_cone(f"TreeTrunk{seed}", 0.040 * scale, 0.018 * scale, 0.58 * scale, (x, y, 0.16 + 0.29 * scale), materials["bark_solid"], 12, bevel=0.005))
    colors = [materials["forest_dark"], materials["forest_mid"], materials["forest_light"]]
    for level in range(6):
        z = 0.27 + level * 0.085 * scale
        radius = (0.26 - level * 0.030) * scale
        count = 4 if level < 4 else 3
        for branch in range(count):
            angle = branch / count * math.tau + level * 0.67 + seed * 0.31
            offset = radius * 0.42
            crown = add_ico(
                f"TreeCrown{seed}_{level}_{branch}",
                (radius * 1.55, radius * 0.56, (0.060 + (5 - level) * 0.006) * scale),
                (x + math.cos(angle) * offset, y + math.sin(angle) * offset, z),
                colors[(level + branch + seed) % 3],
                seed * 2.3 + level * 1.7 + branch,
                subdivisions=2,
            )
            crown.rotation_euler = (math.radians(4), math.radians(10), angle)
            parts.append(crown)
    parts.append(add_ico(f"TreeCrownTop{seed}", (0.16 * scale, 0.14 * scale, 0.25 * scale), (x, y, 0.31 + 0.54 * scale), materials["forest_light"], seed * 3.8, subdivisions=2))


def build_forest(materials, collection) -> list[bpy.types.Object]:
    ground = hex_ground("TerrainForestGround", materials["forest"], collection)
    parts: list[bpy.types.Object] = []
    for index, (x, y, scale) in enumerate([
        (-0.58, -0.27, 0.62), (-0.25, -0.54, 0.56), (0.26, -0.52, 0.64),
        (0.58, -0.20, 0.57), (0.51, 0.32, 0.66), (0.06, 0.59, 0.61), (-0.50, 0.33, 0.64),
    ]):
        add_tiered_tree(parts, materials, x, y, scale, index)
    details = merge_colored(parts, "TerrainForestDetails", materials["terrain_vertex"], collection)
    return [ground, details]


def build_pasture(materials, collection) -> list[bpy.types.Object]:
    ground = hex_ground("TerrainPastureGround", materials["pasture_ground"], collection)
    parts = [
        add_uv_sphere("PastureRiseA", (0.82, 0.56, 0.12), (-0.40, -0.28, 0.16), materials["pasture_dark"], -0.2),
        add_uv_sphere("PastureRiseB", (0.76, 0.52, 0.11), (0.44, -0.22, 0.16), materials["pasture_mid"], 0.25),
        add_uv_sphere("PastureRiseC", (0.68, 0.46, 0.10), (0.15, 0.48, 0.16), materials["pasture_light"], -0.1),
    ]

    def sheep(index: int, x: float, y: float, scale: float, facing: float) -> None:
        forward = Vector((math.cos(facing), math.sin(facing)))
        parts.append(add_ico(
            f"SheepBody{index}",
            (0.30 * scale, 0.20 * scale, 0.22 * scale),
            (x, y, 0.26 + 0.05 * scale),
            materials["sheep"],
            1.4 + index,
            subdivisions=2,
        ))
        head_x = x + forward.x * 0.18 * scale
        head_y = y + forward.y * 0.18 * scale
        parts.append(add_ico(
            f"SheepHead{index}",
            (0.12 * scale, 0.11 * scale, 0.14 * scale),
            (head_x, head_y, 0.30 + 0.05 * scale),
            materials["sheep_dark"],
            2.1 + index,
        ))
        side = Vector((-forward.y, forward.x))
        for leg_index, (along, across) in enumerate(((-0.07, -0.055), (-0.07, 0.055), (0.07, -0.055), (0.07, 0.055))):
            leg_x = x + forward.x * along * scale + side.x * across * scale
            leg_y = y + forward.y * along * scale + side.y * across * scale
            parts.append(add_cylinder(
                f"SheepLeg{index}_{leg_index}",
                0.014 * scale,
                0.12 * scale,
                (leg_x, leg_y, 0.21),
                materials["sheep_dark"],
                7,
                bevel=0.002,
            ))

    sheep(0, -0.48, 0.34, 0.90, 0.15)
    sheep(1, 0.52, 0.20, 0.76, 2.7)
    sheep(2, 0.04, -0.48, 0.70, 1.8)
    return [ground, merge_colored(parts, "TerrainPastureDetails", materials["terrain_vertex"], collection)]


def build_fields(materials, collection) -> list[bpy.types.Object]:
    ground = hex_ground("TerrainFieldsGround", materials["field_ground"], collection)
    parts: list[bpy.types.Object] = []
    patches = [(-0.44, -0.28, -0.10), (0.43, -0.24, 0.11), (0.22, 0.47, -0.08), (-0.45, 0.35, 0.09)]
    for patch, (x, y, angle) in enumerate(patches):
        # A low golden canopy carries the resource color while dense, varied
        # stalks provide the readable harvest silhouette. The rejected passes
        # used isolated pins and then oversized cones; this middle density is
        # still inexpensive after joining but reads as a crop instead of a toy.
        parts.append(add_box(f"FieldBed{patch}", (0.64, 0.32, 0.075), (x, y, 0.195), materials["grain_dark"], 0.065, (0, 0, angle)))
        for stalk in range(18):
            along = ((stalk % 6) - 2.5) * 0.085 + 0.012 * math.sin(stalk * 2.3 + patch)
            across = ((stalk // 6) - 1) * 0.085 + 0.010 * math.cos(stalk * 1.9 + patch)
            stalk_x = x + math.cos(angle) * along - math.sin(angle) * across
            stalk_y = y + math.sin(angle) * along + math.cos(angle) * across
            height = 0.16 + (stalk % 4) * 0.018
            parts.append(add_cylinder(
                f"WheatStem{patch}_{stalk}",
                0.0085,
                height,
                (stalk_x, stalk_y, 0.23 + height / 2),
                materials["grain_mid"],
                5,
                bevel=0,
                smooth=False,
            ))
            parts.append(add_cone(
                f"WheatHead{patch}_{stalk}",
                0.026,
                0.010,
                0.082,
                (stalk_x, stalk_y, 0.23 + height + 0.028),
                materials["grain_light"],
                7,
                bevel=0,
            ))

    bale = add_cylinder("HayBale", 0.105, 0.25, (-0.07, 0.04, 0.29), materials["grain_light"], 18, bevel=0.012, smooth=True)
    bale.rotation_euler = (0, math.pi / 2, -0.18)
    bpy.context.view_layer.objects.active = bale
    bale.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    bale.select_set(False)
    parts.append(bale)
    return [ground, merge_colored(parts, "TerrainFieldsDetails", materials["terrain_vertex"], collection)]


def build_hills(materials, collection) -> list[bpy.types.Object]:
    ground = hex_ground("TerrainHillsGround", materials["hill_ground"], collection)
    parts: list[bpy.types.Object] = []
    banks = [(-0.46, -0.20, 0.52, -0.18), (0.46, -0.22, 0.48, 0.22), (0.08, 0.48, 0.45, -0.06)]
    for index, (x, y, size, angle) in enumerate(banks):
        parts.append(add_ico(
            f"ClayBank{index}",
            (size, size * 0.76, 0.32 + (index % 2) * 0.07),
            (x, y, 0.27 + (index % 2) * 0.025),
            materials["clay_mid" if index != 1 else "clay_light"],
            index * 2.4,
            subdivisions=2,
            smooth=False,
        ))
        for terrace in range(2):
            parts.append(add_box(
                f"QuarryTerrace{index}_{terrace}",
                (size * (0.58 - terrace * 0.10), size * 0.27, 0.075),
                (x + math.cos(angle) * 0.02, y + (terrace - 0.5) * 0.10, 0.25 + terrace * 0.09),
                materials["clay_dark"],
                0.025,
                (0, 0, angle),
            ))
    for stone, (x, y, scale) in enumerate([(-0.68, 0.28, 0.15), (-0.33, 0.52, 0.11), (0.65, 0.24, 0.13), (0.25, -0.57, 0.12)]):
        parts.append(add_ico(
            f"ClayScree{stone}",
            (scale * 1.3, scale, scale * 0.88),
            (x, y, 0.18 + scale * 0.44),
            materials["clay_light" if stone % 2 else "clay_dark"],
            stone * 1.9,
            subdivisions=1,
            smooth=False,
        ))
    return [ground, merge_colored(parts, "TerrainHillsDetails", materials["terrain_vertex"], collection)]


def build_mountains(materials, collection) -> list[bpy.types.Object]:
    ground = hex_ground("TerrainMountainsGround", materials["mountain_ground"], collection)
    rocks: list[bpy.types.Object] = []
    caps: list[bpy.types.Object] = []
    peaks = [(-0.36, -0.17, 0.62, 0.68), (0.34, -0.16, 0.76, 0.72), (0.00, 0.38, 0.66, 0.66)]
    for index, (x, y, height, width) in enumerate(peaks):
        rocks.append(add_crag(
            f"MountainPeak{index}",
            width,
            width * 0.84,
            height,
            (x, y, 0.16),
            materials["mountain_rock"],
            index * 3.1,
        ))
        for spur in range(2):
            angle = index * 1.7 + spur * math.tau / 2.3
            spur_width = width * (0.45 + spur * 0.07)
            spur_height = height * (0.42 + spur * 0.08)
            rocks.append(add_crag(
                f"MountainSpur{index}_{spur}",
                spur_width,
                spur_width * 0.72,
                spur_height,
                (x + math.cos(angle) * width * 0.37, y + math.sin(angle) * width * 0.32, 0.16),
                materials["mountain_rock"],
                index * 4.2 + spur,
            ))
        caps.append(add_ico(
            f"MountainCap{index}",
            (width * 0.30, width * 0.26, height * 0.15),
            (x - width * 0.035, y + width * 0.02, 0.16 + height * 0.88),
            materials["ore_light"],
            index * 4.2,
            subdivisions=1,
            smooth=False,
        ))
    for scree, (x, y, scale) in enumerate([(-0.72, 0.16, 0.11), (0.68, 0.22, 0.13), (-0.18, -0.66, 0.10), (0.48, 0.54, 0.09)]):
        rocks.append(add_ico(
            f"MountainScree{scree}",
            (scale * 1.2, scale, scale * 0.9),
            (x, y, 0.17 + scale * 0.42),
            materials["mountain_rock"],
            scree * 2.2,
            subdivisions=1,
            smooth=False,
        ))
    return [
        ground,
        merge_same(rocks, "TerrainMountainsRocks", collection),
        merge_colored(caps, "TerrainMountainsDetails", materials["terrain_vertex"], collection),
    ]


def build_desert(materials, collection) -> list[bpy.types.Object]:
    ground = hex_ground("TerrainDesertGround", materials["desert_ground"], collection)
    parts = [
        add_uv_sphere("DuneA", (0.72, 0.34, 0.18), (-0.40, -0.20, 0.17), materials["desert_mid"], 0.42),
        add_uv_sphere("DuneB", (0.64, 0.31, 0.16), (0.42, -0.22, 0.17), materials["desert_light"], -0.50),
        add_uv_sphere("DuneC", (0.58, 0.29, 0.14), (0.12, 0.46, 0.17), materials["desert_mid"], 0.22),
        add_ico("DesertStoneA", (0.18, 0.13, 0.12), (-0.60, 0.33, 0.22), materials["desert_dark"], 1.2, 1, False),
        add_ico("DesertStoneB", (0.13, 0.10, 0.09), (0.57, 0.34, 0.21), materials["ore_mid"], 2.8, 1, False),
    ]
    return [ground, merge_colored(parts, "TerrainDesertDetails", materials["terrain_vertex"], collection)]


def build_road(materials, collection) -> list[bpy.types.Object]:
    surface_parts = [add_box("RoadGravel", (0.92, 0.29, 0.06), (0, 0, 0.03), materials["gravel"], 0.085)]
    for index, x in enumerate((-0.34, -0.17, 0, 0.17, 0.34)):
        surface_parts.append(add_ico(f"RoadGravelLump{index}", (0.15, 0.22, 0.045), (x, (index % 2 - 0.5) * 0.03, 0.06), materials["gravel"], index * 1.8, 1))
    surface = merge_same(surface_parts, "RoadSurface", collection)
    stones = []
    for side in (-1, 1):
        for index in range(6):
            x = -0.39 + index * 0.156
            stones.append(add_box(
                f"RoadCurb{side}_{index}",
                (0.135, 0.075, 0.055),
                (x, side * (0.15 + (index % 2) * 0.006), 0.068 + (index % 3) * 0.003),
                materials["stone"],
                0.014,
                (0, 0, (index - 2.5) * 0.012 * side),
            ))
    stone_mesh = merge_same(stones, "RoadStones", collection)
    player = finish_mesh(join([
        add_box(f"RoadInlay{index}", (0.16, 0.055, 0.024), (x, 0, 0.083), materials["player"], 0.010)
        for index, x in enumerate((-0.30, 0, 0.30))
    ], "RoadPlayer"), collection)
    return [surface, stone_mesh, player]


def build_settlement(materials, collection) -> list[bpy.types.Object]:
    base = import_sam_asset(
        SAM_SOURCE_DIR / "settlement-source.glb",
        "SettlementBase",
        collection,
        footprint=0.70,
        height_scale=1.0,
    )
    player = finish_mesh(join([
        add_cylinder("SettlementOwnershipPlinth", 0.39, 0.035, (0, 0, 0.017), materials["player"], 8, bevel=0.010),
        add_box("SettlementBanner", (0.055, 0.024, 0.22), (-0.22, -0.31, 0.36), materials["player"], 0.008),
    ], "SettlementPlayer"), collection)
    return [base, player]


def build_city(materials, collection) -> list[bpy.types.Object]:
    base = import_sam_asset(
        SAM_SOURCE_DIR / "city-source.glb",
        "CityBase",
        collection,
        footprint=0.92,
        height_scale=1.55,
        decimate_ratio=0.50,
    )
    player = finish_mesh(join([
        add_cylinder("CityOwnershipPlinth", 0.51, 0.04, (0, 0, 0.02), materials["player"], 10, bevel=0.012),
        add_box("CityBannerTower", (0.065, 0.026, 0.30), (-0.31, -0.42, 0.47), materials["player"], 0.009),
        add_box("CityBannerHall", (0.065, 0.026, 0.24), (0.20, -0.43, 0.40), materials["player"], 0.009),
    ], "CityPlayer"), collection)
    return [base, player]


def build_port(materials, collection) -> list[bpy.types.Object]:
    parts = [add_box(f"PortPlank{index}", (0.72, 0.10, 0.075), (0, y, 0.055), materials["wood"], 0.018) for index, y in enumerate((-0.12, 0, 0.12))]
    for x in (-0.28, 0.28):
        for y in (-0.17, 0.17):
            parts.append(add_cylinder("PortPost", 0.028, 0.30, (x, y, 0.04), materials["wood"], 10, bevel=0.005))
    return [merge_same(parts, "Port", collection)]


def build_robber(materials, collection) -> list[bpy.types.Object]:
    parts = [
        add_cylinder("RobberBase", 0.22, 0.07, (0, 0, 0.035), materials["robber_dark"], 16, bevel=0.018),
        add_cone("RobberBody", 0.17, 0.10, 0.38, (0, 0, 0.24), materials["robber"], 14, bevel=0.024),
        add_ico("RobberHead", (0.23, 0.22, 0.23), (0, 0, 0.50), materials["robber"], 1.8),
        add_cone("RobberHood", 0.18, 0.03, 0.20, (0, 0, 0.61), materials["robber_dark"], 14, bevel=0.018),
    ]
    return [merge_colored(parts, "Robber", materials["world_vertex"], collection)]


def build_number_token(materials, collection) -> list[bpy.types.Object]:
    return [
        finish_mesh(add_cylinder("NumberToken", 0.165, 0.07, (0, 0, 0.035), materials["token"], 32, bevel=0.015), collection),
        finish_mesh(add_cylinder("NumberTokenRim", 0.148, 0.014, (0, 0, 0.078), materials["token_rim"], 32, bevel=0.007), collection),
    ]


def arrange_preview(objects: list[bpy.types.Object]) -> None:
    groups = {
        "TerrainForest": (-1.73, 0.0, 0.43),
        "TerrainPasture": (0.0, 0.0, 0.43),
        "TerrainFields": (1.73, 0.0, 0.43),
        "TerrainHills": (-0.87, -1.5, 0.43),
        "TerrainMountains": (0.87, -1.5, 0.43),
        "TerrainDesert": (0.0, 1.5, 0.43),
        "Road": (-1.08, 1.98, 0.47),
        "Settlement": (0.78, 2.10, 0.45),
        "City": (1.73, 1.52, 0.45),
        "Port": (-1.84, 1.78, 0.34),
        "Robber": (0.45, 1.48, 0.66),
        "NumberToken": (0, 0, 1.06),
    }
    for obj in objects:
        if obj.name.startswith("BoardFrame"):
            obj.location = (0, 0, 0)
            continue
        match = next((prefix for prefix in groups if obj.name.startswith(prefix)), None)
        obj.location = groups.get(match, (0, 0, 0))


def point_camera(camera: bpy.types.Object, target: tuple[float, float, float]) -> None:
    camera.rotation_euler = (Vector(target) - camera.location).to_track_quat("-Z", "Y").to_euler()


def render_preview(guides: bpy.types.Collection) -> None:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1400
    scene.render.resolution_y = 960
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(PREVIEW_PATH)
    scene.view_settings.look = "AgX - Medium High Contrast"
    world = scene.world or bpy.data.worlds.new("World")
    scene.world = world
    world.use_nodes = True
    nodes = world.node_tree.nodes
    links = world.node_tree.links
    nodes.clear()
    background = nodes.new("ShaderNodeBackground")
    background.inputs["Color"].default_value = rgba("#143840")
    background.inputs["Strength"].default_value = 0.22
    output = nodes.new("ShaderNodeOutputWorld")
    links.new(background.outputs["Background"], output.inputs["Surface"])

    bpy.ops.object.light_add(type="SUN", location=(-6, -6, 10))
    sun = bpy.context.object
    sun.name = "GUIDE_Sun"
    sun.data.energy = 1.8
    sun.data.angle = math.radians(7)
    sun.data.color = rgba("#FFD0A0")[:3]
    sun.rotation_euler = (math.radians(28), math.radians(-22), math.radians(-30))
    move_to(sun, guides)

    bpy.ops.object.light_add(type="AREA", location=(-5.5, -4.5, 8.0))
    key = bpy.context.object
    key.name = "GUIDE_WarmKey"
    key.data.energy = 720
    key.data.color = rgba("#FFD7A8")[:3]
    key.data.shape = "DISK"
    key.data.size = 5.2
    point_camera(key, (0, 0, 0.5))
    move_to(key, guides)

    bpy.ops.object.light_add(type="AREA", location=(5.0, 3.0, 4.5))
    fill = bpy.context.object
    fill.name = "GUIDE_CoolFill"
    fill.data.energy = 330
    fill.data.color = rgba("#76B9CF")[:3]
    fill.data.size = 6.5
    point_camera(fill, (0, 0, 0.6))
    move_to(fill, guides)

    bpy.ops.object.camera_add(location=(8.2, -9.4, 7.5))
    camera = bpy.context.object
    camera.name = "GUIDE_GameCamera"
    camera.data.lens = 60
    point_camera(camera, (0, 0, 0.46))
    scene.camera = camera
    move_to(camera, guides)
    PREVIEW_PATH.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.render.render(write_still=True)


def export_glb(objects: list[bpy.types.Object]) -> None:
    GLB_PATH.parent.mkdir(parents=True, exist_ok=True)
    saved = {obj.name: obj.matrix_world.copy() for obj in objects}
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.location = (0, 0, 0)
        obj.rotation_euler = (0, 0, 0)
        obj.scale = (1, 1, 1)
        obj.select_set(True)
    try:
        with tempfile.TemporaryDirectory(prefix="katan-assets-") as temp_dir:
            raw_path = Path(temp_dir) / "katan-kit-uncompressed.glb"
            bpy.ops.export_scene.gltf(
                filepath=str(raw_path),
                export_format="GLB",
                use_selection=True,
                export_cameras=False,
                export_lights=False,
                export_animations=False,
                export_yup=True,
                export_image_format="WEBP",
                export_image_quality=88,
            )
            subprocess.run(
                [
                    "npx",
                    "--yes",
                    "@gltf-transform/cli@4.4.1",
                    "meshopt",
                    str(raw_path),
                    str(GLB_PATH),
                    "--level",
                    "high",
                ],
                cwd=ROOT,
                check=True,
            )
    finally:
        for obj in objects:
            obj.matrix_world = saved[obj.name]
            obj.select_set(False)


def main() -> None:
    clean_scene()
    guides = make_collection("00_GUIDES")
    terrain = make_collection("10_TERRAIN")
    pieces = make_collection("20_PIECES")
    world = make_collection("30_WORLD")

    materials = {
        "forest": make_pbr_material("PBR_ForestFloor", "forest"),
        "grass": make_pbr_material("PBR_GrassRock", "grass"),
        "rock": make_pbr_material("PBR_CliffRock", "rock"),
        "sand": make_pbr_material("PBR_CoastSand", "sand"),
        "gravel": make_pbr_material("PBR_SandyGravel", "gravel"),
        "stone": make_pbr_material("PBR_CastleStone", "stone"),
        "wood": make_pbr_material("PBR_FineWood", "wood"),
        "roof": make_pbr_material("PBR_ClayRoof", "roof"),
        "bark": make_pbr_material("PBR_PineBark", "bark", use_rough_map=True),
        "pasture_ground": make_pbr_material("PBR_PastureGround", "grass"),
        "field_ground": make_pbr_material("PBR_FieldEarth", "forest"),
        "hill_ground": make_pbr_material("PBR_ClayGround", "gravel"),
        "mountain_ground": make_pbr_material("PBR_MountainGround", "rock", color_prefix="mountain"),
        "desert_ground": make_pbr_material("PBR_DesertGround", "sand"),
        "mountain_rock": make_pbr_material("PBR_MountainRock", "rock", color_prefix="mountain"),
    }
    materials.update({key: make_material(f"Mat_{key}", color, 0.74, 0.12 if key in {"forest_dark", "forest_mid", "forest_light", "plaster", "plaster_light"} else 0.0) for key, color in PALETTE.items()})
    materials["bark_solid"] = make_material("Mat_BarkReadable", "#3A2317", 0.88, 0.18)
    materials["terrain_vertex"] = make_vertex_material("Mat_TerrainVertex", 0.72)
    materials["world_vertex"] = make_vertex_material("Mat_WorldVertex", 0.70)

    objects: list[bpy.types.Object] = []
    objects.extend(build_board_frame(materials, world))
    objects.extend(build_forest(materials, terrain))
    objects.extend(build_pasture(materials, terrain))
    objects.extend(build_fields(materials, terrain))
    objects.extend(build_hills(materials, terrain))
    objects.extend(build_mountains(materials, terrain))
    objects.extend(build_desert(materials, terrain))
    objects.extend(build_road(materials, pieces))
    objects.extend(build_settlement(materials, pieces))
    objects.extend(build_city(materials, pieces))
    objects.extend(build_port(materials, world))
    objects.extend(build_robber(materials, world))
    objects.extend(build_number_token(materials, world))

    arrange_preview(objects)
    render_preview(guides)
    export_glb(objects)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH))
    print(f"Katan PBR asset build complete: {GLB_PATH} ({GLB_PATH.stat().st_size} bytes, {len(objects)} nodes)")


if __name__ == "__main__":
    main()
