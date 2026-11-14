# Export screen-space positions of every empty, per frame, to hotspots.json.
#
# Run from Blender's Scripting tab (open this file, press Run Script).
# Writes hotspots.json next to the .blend file. Copy it to
# public/lab/scroll-test/hotspots.json.
#
# Output shape:
#   {
#     "meta":   { "resolution": [w, h], "origin": "top-left", "frames": [0, 7, ...], ... },
#     "frames": {
#       "0": { "EmptyName": { "x": 0.41, "y": 0.63, "visible": true,
#                             "occluded": false, "depth": 12.3 } },
#       "7": { ... }
#     }
#   }
#
#   x, y      0-1 fractions of the render frame, top-left origin
#   visible   inside the frame AND in front of the camera
#   occluded  something is between the camera and the empty (null if not checked)
#   depth     distance in front of the camera, in scene units

import json
import os
import re

import bpy
from bpy_extras.object_utils import world_to_camera_view

# ---- settings ---------------------------------------------------------------

# Which frames to export.
#   ""   -> use the scene's frame range and step (Output properties)
#   path -> folder of rendered images; frame numbers are read from the filenames,
#           so the export matches exactly what was rendered
#           e.g. "/Users/you/Repos/moonwtr/raw/scroll-test"
FRAMES_DIR = ""

# Raycast from the camera to flag empties hidden behind geometry.
CHECK_OCCLUSION = True

# Ray stops this far short of the empty (scene units), so an empty sitting
# right on a surface isn't flagged as hidden by that surface.
OCCLUSION_MARGIN = 0.05

# Only export empties whose name starts with this ("" = all empties).
NAME_PREFIX = ""

OUTPUT_NAME = "hotspots.json"

# -----------------------------------------------------------------------------


def frame_list(scene):
    if FRAMES_DIR:
        folder = bpy.path.abspath(FRAMES_DIR)
        frames = set()
        for fname in os.listdir(folder):
            stem, ext = os.path.splitext(fname)
            if ext.lower() not in {".png", ".webp", ".jpg", ".jpeg", ".exr"}:
                continue
            digits = re.findall(r"\d+", stem)
            if digits:
                frames.add(int(digits[-1]))
        if not frames:
            raise RuntimeError("No numbered image files found in " + folder)
        return sorted(frames)
    return list(range(scene.frame_start, scene.frame_end + 1, scene.frame_step))


def is_occluded(scene, depsgraph, cam, point):
    cam_matrix = cam.matrix_world
    if cam.data.type == "ORTHO":
        # Parallel rays: travel along the camera's view direction.
        direction = -cam_matrix.col[2].xyz.normalized()
        depth = (point - cam_matrix.translation).dot(direction)
        origin = point - direction * depth
        distance = depth
    else:
        origin = cam_matrix.translation
        to_point = point - origin
        distance = to_point.length
        direction = to_point.normalized()

    distance -= OCCLUSION_MARGIN
    if distance <= 0:
        return False
    hit, *_ = scene.ray_cast(depsgraph, origin, direction, distance=distance)
    return bool(hit)


def main():
    if not bpy.data.filepath:
        raise RuntimeError("Save the .blend first - hotspots.json is written next to it.")

    scene = bpy.context.scene
    empties = [
        ob for ob in scene.objects
        if ob.type == "EMPTY" and ob.name.startswith(NAME_PREFIX)
    ]
    if not empties:
        raise RuntimeError("No empties found in scene '%s'." % scene.name)

    frames = frame_list(scene)
    original_frame = scene.frame_current
    out = {}

    try:
        for frame in frames:
            scene.frame_set(frame)
            depsgraph = bpy.context.evaluated_depsgraph_get()
            cam = scene.camera  # re-read each frame: timeline markers can switch cameras
            if cam is None:
                raise RuntimeError("Scene has no active camera at frame %d." % frame)
            cam_eval = cam.evaluated_get(depsgraph)

            entry = {}
            for ob in empties:
                point = ob.evaluated_get(depsgraph).matrix_world.translation.copy()
                # x, y: 0-1 across the render frame with a bottom-left origin; z: depth.
                co = world_to_camera_view(scene, cam_eval, point)
                in_front = co.z > 0.0
                in_frame = 0.0 <= co.x <= 1.0 and 0.0 <= co.y <= 1.0
                visible = in_front and in_frame

                occluded = None
                if CHECK_OCCLUSION:
                    occluded = visible and is_occluded(scene, depsgraph, cam_eval, point)

                entry[ob.name] = {
                    "x": round(co.x, 5),
                    "y": round(1.0 - co.y, 5),  # flip to top-left origin
                    "visible": visible,
                    "occluded": occluded,
                    "depth": round(co.z, 4),
                }
            out[str(frame)] = entry
    finally:
        scene.frame_set(original_frame)

    render = scene.render
    scale = render.resolution_percentage / 100.0
    data = {
        "meta": {
            "blend": os.path.basename(bpy.data.filepath),
            "scene": scene.name,
            "resolution": [int(render.resolution_x * scale), int(render.resolution_y * scale)],
            "origin": "top-left",
            "occlusion_checked": CHECK_OCCLUSION,
            "frames": frames,
            "empties": [ob.name for ob in empties],
        },
        "frames": out,
    }

    path = bpy.path.abspath("//" + OUTPUT_NAME)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=1)

    print("hotspots: %d empties x %d frames -> %s" % (len(empties), len(frames), path))


main()
