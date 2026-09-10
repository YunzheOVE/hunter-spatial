# Align a real Polycam GLB to the campus skeleton

Use this after a North Building hallway scan exists. The beta repo ships a placeholder `3-scan.glb` already aligned via `campus.json`.

```python
# blender --background --python scripts/blender_align.py -- \
#   assets/glb/campus.glb path/to/polycam.glb assets/glb/floors/N/3-scan.glb

import sys
import bpy

argv = sys.argv[sys.argv.index("--") + 1 :]
campus_path, scan_in, scan_out = argv

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=campus_path)
bpy.ops.import_scene.gltf(filepath=scan_in)

# Hide campus, leave scan selected for manual transform in GUI sessions.
for obj in bpy.data.objects:
    obj.hide_viewport = obj.name.startswith("building-")

# After aligning in the GUI, export:
# bpy.ops.export_scene.gltf(filepath=scan_out, export_format="GLB", use_selection=True)
print("Imported campus + scan. Align the scan to building-N floor 3, then export GLB.")
```

Write leftover translation/rotation into `data/campus.json` → `buildings[N].floors[0].scan`.
