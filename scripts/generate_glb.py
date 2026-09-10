"""Build campus.glb (extruded OSM footprints) and a North Building floor-3 scan placeholder."""

from __future__ import annotations

import json
import math
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CAMPUS_JSON = ROOT / "data" / "campus.json"
CAMPUS_GLB = ROOT / "assets" / "glb" / "campus.glb"
SCAN_GLB = ROOT / "assets" / "glb" / "floors" / "N" / "3-scan.glb"


def hex_color(hex_str: str) -> tuple[float, float, float]:
    h = hex_str.lstrip("#")
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return (r / 255.0, g / 255.0, b / 255.0)


def signed_area(ring: list[tuple[float, float]]) -> float:
    pts = ring[:-1] if ring[0] == ring[-1] else ring
    acc = 0.0
    n = len(pts)
    for i in range(n):
        x1, z1 = pts[i]
        x2, z2 = pts[(i + 1) % n]
        acc += x1 * z2 - x2 * z1
    return acc / 2.0


def triangulate(ring: list[tuple[float, float]]) -> list[int]:
    pts = list(ring[:-1] if ring[0] == ring[-1] else ring)
    n = len(pts)
    if n < 3:
        return []
    ccw = signed_area(pts) > 0
    idx = list(range(n))
    tris: list[int] = []

    def is_ear(i0, i1, i2) -> bool:
        a, b, c = pts[i0], pts[i1], pts[i2]
        cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
        if ccw and cross <= 1e-8:
            return False
        if not ccw and cross >= -1e-8:
            return False
        for i, p in enumerate(pts):
            if i in (i0, i1, i2):
                continue
            if point_in_tri(p, a, b, c):
                return False
        return True

    guard = 0
    while len(idx) > 3 and guard < 10_000:
        guard += 1
        ear_found = False
        m = len(idx)
        for i in range(m):
            i0, i1, i2 = idx[(i - 1) % m], idx[i], idx[(i + 1) % m]
            if is_ear(i0, i1, i2):
                tris.extend([i0, i1, i2] if ccw else [i0, i2, i1])
                idx.pop(i)
                ear_found = True
                break
        if not ear_found:
            break
    if len(idx) == 3:
        i0, i1, i2 = idx
        tris.extend([i0, i1, i2] if ccw else [i0, i2, i1])
    return tris


def point_in_tri(p, a, b, c) -> bool:
    def sign(p1, p2, p3):
        return (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1])

    d1, d2, d3 = sign(p, a, b), sign(p, b, c), sign(p, c, a)
    has_neg = (d1 < 0) or (d2 < 0) or (d3 < 0)
    has_pos = (d1 > 0) or (d2 > 0) or (d3 > 0)
    return not (has_neg and has_pos)


def add_vertex(store, pos, normal) -> int:
    store["positions"].extend(pos)
    store["normals"].extend(normal)
    return store["count"]


def mesh_from_triangles(positions: list[tuple], normals: list[tuple], indices: list[int]) -> dict:
    store = {"positions": [], "normals": [], "count": 0}
    remap = {}
    out_idx = []
    for i in indices:
        key = (round(positions[i][0], 5), round(positions[i][1], 5), round(positions[i][2], 5),
               round(normals[i][0], 4), round(normals[i][1], 4), round(normals[i][2], 4))
        if key not in remap:
            remap[key] = store["count"]
            store["positions"].extend(positions[i])
            store["normals"].extend(normals[i])
            store["count"] += 1
        out_idx.append(remap[key])
    return {
        "positions": store["positions"],
        "normals": store["normals"],
        "indices": out_idx,
        "count": store["count"],
    }


def extrude_building(footprint: list[list[float]], height: float) -> dict:
    ring = [tuple(p) for p in footprint]
    pts = ring[:-1] if ring[0] == ring[-1] else ring
    cap = triangulate(ring)
    positions: list[tuple] = []
    normals: list[tuple] = []
    indices: list[int] = []

    def push_tri(verts_nrms):
        base = len(positions)
        for v, n in verts_nrms:
            positions.append(v)
            normals.append(n)
        indices.extend([base, base + 1, base + 2])

    # Top (+Y)
    for i in range(0, len(cap), 3):
        i0, i1, i2 = cap[i], cap[i + 1], cap[i + 2]
        push_tri(
            [
                ((pts[i0][0], height, pts[i0][1]), (0, 1, 0)),
                ((pts[i1][0], height, pts[i1][1]), (0, 1, 0)),
                ((pts[i2][0], height, pts[i2][1]), (0, 1, 0)),
            ]
        )
    # Bottom (-Y), reversed
    for i in range(0, len(cap), 3):
        i0, i1, i2 = cap[i], cap[i + 1], cap[i + 2]
        push_tri(
            [
                ((pts[i0][0], 0.0, pts[i0][1]), (0, -1, 0)),
                ((pts[i2][0], 0.0, pts[i2][1]), (0, -1, 0)),
                ((pts[i1][0], 0.0, pts[i1][1]), (0, -1, 0)),
            ]
        )
    # Walls
    n = len(pts)
    for i in range(n):
        a = pts[i]
        b = pts[(i + 1) % n]
        dx, dz = b[0] - a[0], b[1] - a[1]
        length = math.hypot(dx, dz) or 1.0
        nx, nz = dz / length, -dx / length
        # Outward depends on winding; flip if pointing inward (toward centroid-ish).
        # For CCW ring, outward is to the right of edge = (dz, -dx) in xz with +Z north.
        if signed_area(pts) > 0:
            nx, nz = dz / length, -dx / length
        else:
            nx, nz = -dz / length, dx / length
        nrm = (nx, 0.0, nz)
        push_tri(
            [
                ((a[0], 0.0, a[1]), nrm),
                ((b[0], 0.0, b[1]), nrm),
                ((b[0], height, b[1]), nrm),
            ]
        )
        push_tri(
            [
                ((a[0], 0.0, a[1]), nrm),
                ((b[0], height, b[1]), nrm),
                ((a[0], height, a[1]), nrm),
            ]
        )
    return mesh_from_triangles(positions, normals, indices)


def hallway_scan(length: float, width: float, height: float, segs: int = 24) -> dict:
    positions: list[tuple] = []
    normals: list[tuple] = []
    indices: list[int] = []

    def noise(i, j, k) -> float:
        return 0.04 * math.sin(i * 1.7 + j * 2.3 + k * 0.9)

    def push_quad(v00, v10, v11, v01, nrm):
        base = len(positions)
        for v in (v00, v10, v11, v01):
            positions.append(v)
            normals.append(nrm)
        indices.extend([base, base + 1, base + 2, base, base + 2, base + 3])

    half_l = length / 2
    half_w = width / 2
    # Floor
    for i in range(segs):
        for j in range(4):
            x0 = -half_l + length * i / segs
            x1 = -half_l + length * (i + 1) / segs
            z0 = -half_w + width * j / 4
            z1 = -half_w + width * (j + 1) / 4
            y00 = noise(i, j, 0)
            y10 = noise(i + 1, j, 0)
            y11 = noise(i + 1, j + 1, 0)
            y01 = noise(i, j + 1, 0)
            push_quad((x0, y00, z0), (x1, y10, z0), (x1, y11, z1), (x0, y01, z1), (0, 1, 0))
    # Ceiling
    for i in range(segs):
        x0 = -half_l + length * i / segs
        x1 = -half_l + length * (i + 1) / segs
        push_quad(
            (x0, height, -half_w),
            (x0, height, half_w),
            (x1, height, half_w),
            (x1, height, -half_w),
            (0, -1, 0),
        )
    # Walls
    for i in range(segs):
        x0 = -half_l + length * i / segs
        x1 = -half_l + length * (i + 1) / segs
        bulge_l = 0.05 * math.sin(i * 0.8)
        bulge_r = 0.05 * math.cos(i * 0.9)
        push_quad(
            (x0, 0, -half_w + bulge_l),
            (x1, 0, -half_w + bulge_l),
            (x1, height, -half_w + bulge_l),
            (x0, height, -half_w + bulge_l),
            (0, 0, -1),
        )
        push_quad(
            (x0, 0, half_w + bulge_r),
            (x0, height, half_w + bulge_r),
            (x1, height, half_w + bulge_r),
            (x1, 0, half_w + bulge_r),
            (0, 0, 1),
        )
    return mesh_from_triangles(positions, normals, indices)


def pad4(b: bytes) -> bytes:
    return b + b" " * ((4 - len(b) % 4) % 4)


def pad4bin(b: bytes) -> bytes:
    return b + b"\x00" * ((4 - len(b) % 4) % 4)


def write_glb(path: Path, meshes: list[dict]) -> None:
    """meshes: [{name, positions, normals, indices, color}]"""
    bin_parts = []
    accessors = []
    buffer_views = []
    gltf_meshes = []
    nodes = []
    materials = []
    offset = 0

    def add_f32(data: list[float], count: int, comps: int, kind: str) -> int:
        nonlocal offset
        raw = struct.pack("<" + "f" * len(data), *data)
        raw = pad4bin(raw)
        buffer_views.append({"buffer": 0, "byteOffset": offset, "byteLength": len(raw), "target": 34962})
        mins = [min(data[i::comps]) for i in range(comps)]
        maxs = [max(data[i::comps]) for i in range(comps)]
        accessors.append(
            {
                "bufferView": len(buffer_views) - 1,
                "componentType": 5126,
                "count": count,
                "type": kind,
                "min": mins,
                "max": maxs,
            }
        )
        bin_parts.append(raw)
        offset += len(raw)
        return len(accessors) - 1

    def add_u16(data: list[int], count: int) -> int:
        nonlocal offset
        raw = struct.pack("<" + "H" * len(data), *data)
        raw = pad4bin(raw)
        buffer_views.append({"buffer": 0, "byteOffset": offset, "byteLength": len(raw), "target": 34963})
        accessors.append(
            {
                "bufferView": len(buffer_views) - 1,
                "componentType": 5123,
                "count": count,
                "type": "SCALAR",
            }
        )
        bin_parts.append(raw)
        offset += len(raw)
        return len(accessors) - 1

    for mesh in meshes:
        pos_acc = add_f32(mesh["positions"], mesh["count"], 3, "VEC3")
        nrm_acc = add_f32(mesh["normals"], mesh["count"], 3, "VEC3")
        idx_acc = add_u16(mesh["indices"], len(mesh["indices"]))
        r, g, b = mesh["color"]
        materials.append(
            {
                "name": mesh["name"] + "-mat",
                "pbrMetallicRoughness": {
                    "baseColorFactor": [r, g, b, 1.0],
                    "metallicFactor": 0.0,
                    "roughnessFactor": 0.9,
                },
            }
        )
        gltf_meshes.append(
            {
                "name": mesh["name"],
                "primitives": [
                    {
                        "attributes": {"POSITION": pos_acc, "NORMAL": nrm_acc},
                        "indices": idx_acc,
                        "material": len(materials) - 1,
                    }
                ],
            }
        )
        nodes.append({"name": mesh["name"], "mesh": len(gltf_meshes) - 1})

    blob = b"".join(bin_parts)
    gltf = {
        "asset": {"version": "2.0", "generator": "hunter-spatial/generate_glb.py"},
        "scene": 0,
        "scenes": [{"nodes": list(range(len(nodes)))}],
        "nodes": nodes,
        "meshes": gltf_meshes,
        "materials": materials,
        "accessors": accessors,
        "bufferViews": buffer_views,
        "buffers": [{"byteLength": len(blob)}],
    }
    json_bytes = pad4(json.dumps(gltf, separators=(",", ":")).encode("utf-8"))
    blob = pad4bin(blob)
    total = 12 + 8 + len(json_bytes) + 8 + len(blob)
    header = struct.pack("<4sII", b"glTF", 2, total)
    json_chunk = struct.pack("<I4s", len(json_bytes), b"JSON") + json_bytes
    bin_chunk = struct.pack("<I4s", len(blob), b"BIN\x00") + blob
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(header + json_chunk + bin_chunk)
    print(f"Wrote {path} ({path.stat().st_size} bytes)")


def main() -> None:
    campus = json.loads(CAMPUS_JSON.read_text(encoding="utf-8"))
    meshes = []
    for b in campus["buildings"]:
        height = b["floorCount"] * b["floorHeight"]
        geom = extrude_building(b["footprint"], height)
        geom["name"] = f"building-{b['id']}"
        geom["color"] = hex_color(b["color"])
        meshes.append(geom)
    write_glb(CAMPUS_GLB, meshes)

    north = next(b for b in campus["buildings"] if b["id"] == "N")
    ring = [tuple(p) for p in north["footprint"]]
    xs = [p[0] for p in ring]
    zs = [p[1] for p in ring]
    length = max(max(xs) - min(xs), max(zs) - min(zs)) * 0.72
    scan = hallway_scan(length=length, width=4.2, height=3.2)
    scan["name"] = "scan-N-3"
    scan["color"] = hex_color("#c9b89a")
    write_glb(SCAN_GLB, [scan])


if __name__ == "__main__":
    main()
