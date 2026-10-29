"""Render the footer's cloud wordmark in Blender, lit like the sky clouds (render.py).

The owner's wordmark (wordmark-<variant>.svg: one filled path of M/C/Z commands, nonzero fill)
is sampled on a grid. Every interior sample becomes a puff whose radius is its distance to the
outline plus THICKEN, so the union keeps the letters and the hairlines swell enough to survive
as cloud. Puffs -> Mesh to Volume -> gentle displacement; day and night like the sky.

Usage (Blender 5.2):
  Blender -b --factory-startup --python wordmark.py -- --out DIR [--variants wide] [--width 2880] [--samples 128]
"""

import argparse
import ast
import random
import time
import re
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Matrix

sys.path.insert(0, str(Path(__file__).parent))
from render import cloud_material, frame_camera, light, make_volume, reset_scene  # noqa: E402

HERE = Path(__file__).parent
VARIANTS = ('wide',)  # Figma 37:1195; 37:1197 ("tall") lost the comparison and is in git history
# The sky's recipe (render.py) at the sky's scale: a mid-layer cloud is about 12 units wide on
# screen at ~35 px per unit, so is the wordmark at 40 units across the footer. Only the puffs differ.
WIDTH = 40.0  # Blender units across the wordmark
STEP = 2.0  # grid step, SVG units
THICKEN = 3.8  # added to every puff radius, SVG units (owner's pick of the drafts: thick enough for cumulus shading, counters still open)
JITTER = (0.8, 1.4)  # random puff size factor: lumpy, billowy edges
DEPTH = 1.0  # puffs scatter front to back by this share of their radius: real depth for self-shadowing
OCTAVES = (('Billow', 0.9, 0.8), ('Curl', 0.28, 0.3))  # the sky's
DETAIL_MIN = 0.25  # the sky's
VOXEL = 0.035  # the sky's
CURVE_SEGMENTS = 12
TRIM = None  # (low, high): alpha below low vanishes, above high stays, smoothstep between; None = off


def parse_args():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', required=True)
    parser.add_argument('--variants', default=','.join(VARIANTS))
    parser.add_argument('--themes', default='day,night')
    parser.add_argument('--width', type=int, default=2880)
    parser.add_argument('--samples', type=int, default=128)
    parser.add_argument('--trim-only', action='store_true')
    parser.add_argument('--param', action='append', default=[], help='NAME=python-literal, overrides a constant (drafts)')
    return parser.parse_args(argv)


def outline(variant):
    """Polyline rings of the SVG path and the view box height."""
    svg = (HERE / f'wordmark-{variant}.svg').read_text()
    height = float(re.search(r'viewBox="0 0 [\d.]+ ([\d.]+)"', svg).group(1))
    tokens = re.findall(r'[MCZ]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?', re.search(r' d="([^"]+)"', svg).group(1))
    rings, ring, at, command = [], [], 0, None
    while at < len(tokens):
        if tokens[at] in 'MCZ':
            command = tokens[at]
            at += 1
            if command == 'Z':
                rings.append(ring)
                ring = []
            continue
        if command == 'M':
            ring = [tuple(map(float, tokens[at:at + 2]))]
            at += 2
        elif command == 'C':
            p0 = np.array(ring[-1])
            p1, p2, p3 = (np.array(tuple(map(float, tokens[at + i:at + i + 2]))) for i in (0, 2, 4))
            for t in np.linspace(0, 1, CURVE_SEGMENTS + 1)[1:]:
                u = 1 - t
                ring.append(tuple(u ** 3 * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t ** 3 * p3))
            at += 6
    if ring:
        rings.append(ring)
    return rings, height


def interior(rings, height):
    """Grid samples inside the glyphs (nonzero winding) with their distance to the outline."""
    xs = np.concatenate([np.array(r)[:, 0] for r in rings])
    ys = np.concatenate([np.array(r)[:, 1] for r in rings])
    gx, gy = np.meshgrid(np.arange(xs.min(), xs.max(), STEP), np.arange(ys.min(), ys.max(), STEP))
    px, py = gx.ravel(), gy.ravel()
    winding = np.zeros(px.shape, dtype=np.int32)
    distance = np.full(px.shape, np.inf)
    for ring in rings:
        points = np.array(ring + [ring[0]])
        for (ax, ay), (bx, by) in zip(points[:-1], points[1:]):
            up = (ay <= py) & (by > py)
            down = (ay > py) & (by <= py)
            cross = (bx - ax) * (py - ay) - (px - ax) * (by - ay)
            winding += (up & (cross > 0)).astype(np.int32) - (down & (cross < 0)).astype(np.int32)
            dx, dy = bx - ax, by - ay
            length = dx * dx + dy * dy or 1e-12
            t = np.clip(((px - ax) * dx + (py - ay) * dy) / length, 0, 1)
            distance = np.minimum(distance, np.hypot(px - ax - t * dx, py - ay - t * dy))
    inside = winding != 0
    return px[inside], height - py[inside], distance[inside]


def build_wordmark(variant):
    rings, height = outline(variant)
    x, z, distance = interior(rings, height)
    scale = WIDTH / (x.max() - x.min())
    rng = random.Random(7)
    bm = bmesh.new()
    for px, pz, d in zip(x, z, distance):
        radius = (d + THICKEN) * scale * rng.uniform(*JITTER)
        y = rng.uniform(-DEPTH, DEPTH) * radius
        centre = Matrix.Translation(((px - x.min()) * scale - WIDTH / 2, y, pz * scale))
        bmesh.ops.create_icosphere(bm, subdivisions=2, radius=radius, matrix=centre)
    mesh = bpy.data.meshes.new(f'Wordmark-{variant}')
    bm.to_mesh(mesh)
    bm.free()
    source = bpy.data.objects.new(mesh.name, mesh)
    bpy.context.scene.collection.objects.link(source)
    make_volume(source, OCTAVES, cloud_material(flat_base=False, detail_min=DETAIL_MIN), voxel_size=VOXEL)
    print('PUFFS', variant, len(x), flush=True)
    return source


def trim(raw, out):
    """Writes `raw` to `out` with alpha remapped through TRIM, colour unchanged."""
    image = bpy.data.images.load(str(raw))
    pixels = np.empty(len(image.pixels), dtype=np.float32)
    image.pixels.foreach_get(pixels)
    pixels = pixels.reshape(-1, 4)
    alpha = pixels[:, 3]
    t = np.clip((alpha - TRIM[0]) / (TRIM[1] - TRIM[0]), 0, 1)
    trimmed = t * t * (3 - 2 * t)
    # Float buffers hold premultiplied colour: unpremultiply, then premultiply by the new alpha.
    pixels[:, :3] *= (trimmed / np.maximum(alpha, 1e-6))[:, None]
    pixels[:, 3] = trimmed
    image.pixels.foreach_set(pixels.ravel())
    image.filepath_raw = str(out)
    image.save()
    bpy.data.images.remove(image)
    print('TRIMMED', out, flush=True)


def main():
    args = parse_args()
    for override in args.param:
        name, value = override.split('=', 1)
        if name not in globals() or not name.isupper():
            raise SystemExit(f'Unknown constant {name}')
        globals()[name] = ast.literal_eval(value)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    if args.trim_only:
        for raw in sorted(out.glob('wordmark-*.raw.png')):
            trim(raw, raw.with_name(raw.name.replace('.raw.png', '.png')))
        return
    for variant in args.variants.split(','):
        start = time.time()
        scene = reset_scene()
        scene.cycles.samples = args.samples
        source = build_wordmark(variant)
        frame_camera(scene, source, args.width, margin=0.35)
        print('BUILT', variant, round(time.time() - start), 's', flush=True)
        for theme in args.themes.split(','):
            light(scene, theme)
            final = out / f'wordmark-{variant}-{theme}.png'
            raw = final.with_name(final.name.replace('.png', '.raw.png')) if TRIM else final
            scene.render.filepath = str(raw)
            bpy.ops.render.render(write_still=True)
            if TRIM:
                trim(raw, final)
            print('RENDERED', scene.render.filepath, scene.render.resolution_x, scene.render.resolution_y, round(time.time() - start), 's', flush=True)


if __name__ == '__main__':
    main()
