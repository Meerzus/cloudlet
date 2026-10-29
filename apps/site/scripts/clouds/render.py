"""Render the landing's cloud layers in Blender (LANDING §3, option C).

Each shape is built once from seeded puffs -> Mesh to Volume -> Volume Displace,
then rendered twice with transparent film: day (sun) and night (moonlight). The
same silhouette in both themes lets the theme switch crossfade cleanly.

Usage (Blender 5.2):
  Blender -b --factory-startup --python render.py -- --out DIR [--shapes 1,2] [--width 2000] [--samples 128]
"""

import argparse
import math
import random
import sys
from pathlib import Path

import bpy
from mathutils import Vector

# name, seed, puff count, half width, height, depth, radius range, profile
SHAPES = {
    1: ('bank', 11, 22, 5.0, 1.3, 1.2, (0.7, 1.4), 'flat'),
    3: ('wisps', 37, 16, 4.5, 0.7, 0.8, (0.35, 0.75), 'scatter'),
    4: ('streak', 41, 40, 6.0, 0.5, 0.8, (0.5, 0.9), 'flat'),
    5: ('round', 53, 16, 2.6, 2.0, 1.3, (0.7, 1.3), 'dome'),
    6: ('broad', 67, 24, 4.2, 2.2, 1.5, (0.8, 1.6), 'dome'),
}

THEMES = {
    # sun direction (from), sun strength, sun colour, world colour, world strength, exposure
    'day': ((-0.6, -0.5, 0.9), 6.0, (1.0, 0.97, 0.93), (0.5, 0.66, 0.95), 1.3, 0.9),
    'night': ((0.7, 0.35, 0.8), 2.2, (0.7, 0.79, 1.0), (0.05, 0.08, 0.2), 0.7, -0.4),
}


def parse_args():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', required=True)
    parser.add_argument('--shapes', default=','.join(str(key) for key in SHAPES))
    parser.add_argument('--themes', default='day,night')
    parser.add_argument('--width', type=int, default=2000)
    parser.add_argument('--samples', type=int, default=128)
    return parser.parse_args(argv)


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'
    prefs.get_devices()
    for device in prefs.devices:
        device.use = True
    scene.cycles.device = 'GPU'
    scene.cycles.use_denoising = True
    scene.cycles.volume_bounces = 12
    scene.cycles.transparent_max_bounces = 16
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.image_settings.color_depth = '16'
    try:
        scene.view_settings.view_transform = 'AgX'
    except TypeError:
        pass
    return scene


def puffs_for(shape):
    _, seed, count, half_w, height, depth, (r_min, r_max), profile = shape
    rng = random.Random(seed)
    puffs = []
    for index in range(count):
        x = rng.uniform(-half_w, half_w)
        edge = abs(x) / half_w
        if profile == 'dome':
            top = height * max(0.15, 1 - edge ** 2)
        elif profile == 'scatter':
            # Three loose clusters with gaps between them.
            x = rng.choice((-0.66, 0.0, 0.62)) * half_w + rng.gauss(0, half_w * 0.12)
            top = height
        else:
            top = height * (0.55 + 0.45 * (1 - edge))
        z = rng.uniform(0, top)
        y = rng.uniform(-depth, depth) * 0.6
        radius = rng.uniform(r_min, r_max) * (1 - 0.35 * edge)
        if index < count // 4:  # a row of base puffs keeps the underside full
            z = rng.uniform(0, 0.25 * height)
        puffs.append((Vector((x, y, z)), radius))
    return puffs


def build_cloud(shape):
    mesh_parts = []
    for center, radius in puffs_for(shape):
        radius *= 1.15
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=radius, location=center)
        mesh_parts.append(bpy.context.active_object)
    bpy.ops.object.select_all(action='DESELECT')
    for part in mesh_parts:
        part.select_set(True)
    bpy.context.view_layer.objects.active = mesh_parts[0]
    bpy.ops.object.join()
    source = bpy.context.active_object
    make_volume(source, (('Billow', 0.9, 0.8), ('Curl', 0.28, 0.3)), cloud_material())
    return source


def make_volume(source, octaves, material, voxel_size=0.035):
    """Hides the mesh `source` and adds a cloud volume made from it, displaced by `octaves` of
    (name, noise scale, strength)."""
    source.hide_render = True
    source.hide_viewport = True

    volume = bpy.data.objects.new('Cloud', bpy.data.volumes.new('Cloud'))
    bpy.context.scene.collection.objects.link(volume)
    to_volume = volume.modifiers.new('MeshToVolume', 'MESH_TO_VOLUME')
    to_volume.object = source
    to_volume.resolution_mode = 'VOXEL_SIZE'
    to_volume.voxel_size = voxel_size
    to_volume.interior_band_width = 0.2
    to_volume.density = 1.0

    # Octaves of displacement, e.g. broad billows, then fine cauliflower edges.
    for name, scale, strength in octaves:
        texture = bpy.data.textures.new(name, 'CLOUDS')
        texture.noise_scale = scale
        texture.noise_depth = 4
        texture.noise_basis = 'BLENDER_ORIGINAL'
        displace = volume.modifiers.new(name, 'VOLUME_DISPLACE')
        displace.texture = texture
        displace.strength = strength
        displace.texture_mid_level = (0.5, 0.5, 0.5)
        displace.texture_map_mode = 'GLOBAL'

    volume.data.materials.append(material)
    return volume


def cloud_material(flat_base=True, detail_min=0.25):
    """Cumulus volume: density broken up by noise (never below `detail_min`), with a soft flat
    underside near the object's z = 0 unless `flat_base` is off."""
    material = bpy.data.materials.new('CloudVolume')
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    nodes.clear()
    output = nodes.new('ShaderNodeOutputMaterial')
    volume = nodes.new('ShaderNodeVolumePrincipled')
    volume.inputs['Color'].default_value = (1, 1, 1, 1)
    volume.inputs['Anisotropy'].default_value = 0.35
    links.new(volume.outputs['Volume'], output.inputs['Volume'])

    density = nodes.new('ShaderNodeAttribute')
    density.attribute_name = 'density'
    coords = nodes.new('ShaderNodeTexCoord')

    detail = nodes.new('ShaderNodeTexNoise')
    detail.inputs['Scale'].default_value = 1.6
    detail.inputs['Detail'].default_value = 6
    links.new(coords.outputs['Object'], detail.inputs['Vector'])
    detail_range = nodes.new('ShaderNodeMapRange')
    detail_range.inputs['From Min'].default_value = 0.35
    detail_range.inputs['From Max'].default_value = 0.7
    detail_range.inputs['To Min'].default_value = detail_min
    detail_range.inputs['To Max'].default_value = 1.2
    links.new(detail.outputs['Fac'], detail_range.inputs['Value'])

    multiply = nodes.new('ShaderNodeMath')
    multiply.operation = 'MULTIPLY'
    links.new(density.outputs['Fac'], multiply.inputs[0])
    links.new(detail_range.outputs['Result'], multiply.inputs[1])
    shaped = multiply
    if flat_base:
        # Flat, soft underside typical of cumulus.
        separate = nodes.new('ShaderNodeSeparateXYZ')
        links.new(coords.outputs['Object'], separate.inputs['Vector'])
        base = nodes.new('ShaderNodeMapRange')
        base.interpolation_type = 'SMOOTHSTEP'
        base.inputs['From Min'].default_value = -0.25
        base.inputs['From Max'].default_value = 0.35
        links.new(separate.outputs['Z'], base.inputs['Value'])
        shaped = nodes.new('ShaderNodeMath')
        shaped.operation = 'MULTIPLY'
        links.new(multiply.outputs['Value'], shaped.inputs[0])
        links.new(base.outputs['Result'], shaped.inputs[1])
    scale = nodes.new('ShaderNodeMath')
    scale.operation = 'MULTIPLY'
    scale.inputs[1].default_value = 10.0
    links.new(shaped.outputs['Value'], scale.inputs[0])
    links.new(scale.outputs['Value'], volume.inputs['Density'])
    return material


def frame_camera(scene, source, width, margin=0.9):
    corners = [source.matrix_world @ Vector(corner) for corner in source.bound_box]
    min_x, max_x = min(c.x for c in corners), max(c.x for c in corners)
    min_z, max_z = min(c.z for c in corners), max(c.z for c in corners)
    span_x, span_z = max_x - min_x + 2 * margin, max_z - min_z + 2 * margin
    camera = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))
    scene.collection.objects.link(camera)
    camera.data.type = 'ORTHO'
    camera.data.ortho_scale = max(span_x, span_z)
    camera.location = ((min_x + max_x) / 2, -30, (min_z + max_z) / 2)
    camera.rotation_euler = (math.radians(90), 0, 0)
    scene.camera = camera
    scene.render.resolution_x = width
    scene.render.resolution_y = max(2, round(width * span_z / span_x / 2) * 2)
    if span_z > span_x:
        scene.render.resolution_y, scene.render.resolution_x = width, max(2, round(width * span_x / span_z / 2) * 2)


def light(scene, theme):
    direction, strength, colour, world_colour, world_strength, exposure = THEMES[theme]
    for obj in [o for o in scene.objects if o.type == 'LIGHT']:
        bpy.data.objects.remove(obj)
    sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
    scene.collection.objects.link(sun)
    sun.data.energy = strength
    sun.data.color = colour
    sun.data.angle = math.radians(2)
    sun.rotation_euler = Vector(direction).to_track_quat('Z', 'Y').to_euler()
    world = scene.world or bpy.data.worlds.new('World')
    scene.world = world
    world.use_nodes = True
    background = world.node_tree.nodes.get('Background') or world.node_tree.nodes.new('ShaderNodeBackground')
    background.inputs['Color'].default_value = (*world_colour, 1)
    background.inputs['Strength'].default_value = world_strength
    output = world.node_tree.nodes.get('World Output') or world.node_tree.nodes.new('ShaderNodeOutputWorld')
    world.node_tree.links.new(background.outputs['Background'], output.inputs['Surface'])
    scene.view_settings.exposure = exposure


def main():
    args = parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    for key in [int(k) for k in args.shapes.split(',')]:
        scene = reset_scene()
        scene.cycles.samples = args.samples
        source = build_cloud(SHAPES[key])
        frame_camera(scene, source, args.width)
        for theme in args.themes.split(','):
            light(scene, theme)
            scene.render.filepath = str(out / f'cloud-{key}-{theme}.png')
            bpy.ops.render.render(write_still=True)
            print('RENDERED', scene.render.filepath, scene.render.resolution_x, scene.render.resolution_y, flush=True)


if __name__ == '__main__':
    main()
