"""Independent exported-byte verification. No imports from application code."""
import io
import json
import math
from pathlib import Path, PurePosixPath
import sys
import uuid
import zipfile

from PIL import Image


def check(condition, message):
    if not condition:
        raise ValueError(message)


def read_zip(data):
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        infos = archive.infolist()
        check(len(infos) <= 64, "Too many archive entries")
        check(sum(i.file_size for i in infos) <= 64 * 1024 * 1024, "Archive expands too large")
        files = {}
        for entry in infos:
            name = entry.filename
            check(not name.startswith('/') and '\\' not in name and ':' not in name and all(p not in ('', '.', '..') for p in name.split('/')), f"Unsafe archive path: {name}")
            check(not PurePosixPath(name).is_absolute(), "Absolute archive path")
            check((entry.external_attr >> 16) & 0o170000 != 0o120000, "Symlink in archive")
            check(name not in files and entry.file_size <= 16 * 1024 * 1024, "Duplicate/oversized entry")
            files[name] = archive.read(entry)  # zipfile validates the CRC
        return files


def one_json(files, prefix, suffix):
    matches = [name for name in files if name.startswith(prefix) and name.endswith(suffix)]
    check(len(matches) == 1, f"Expected one {prefix}*{suffix}")
    return json.loads(files[matches[0]])


def verify_addon(filename):
    outer = read_zip(filename.read_bytes())
    check(len(outer) == 2 and all(n.endswith('.mcpack') for n in outer), "Expected two nested packs")
    packs = [read_zip(data) for data in outer.values()]
    by_type = {json.loads(p['manifest.json'])['modules'][0]['type']: p for p in packs}
    check(set(by_type) == {'data', 'resources'}, "Missing behavior/resource pack")
    bp, rp = by_type['data'], by_type['resources']
    bm, rm = json.loads(bp['manifest.json']), json.loads(rp['manifest.json'])
    ids = []
    for manifest in [bm, rm]:
        check(manifest['format_version'] == 2, "Wrong manifest format")
        check(len(manifest['header']['min_engine_version']) == 3, "Missing engine version")
        for value in [manifest['header'], *manifest['modules']]:
            ids.append(str(uuid.UUID(value['uuid'])))
            check(len(value['version']) == 3 and all(isinstance(n, int) and n >= 0 for n in value['version']), "Invalid pack version")
    check(len(ids) == len(set(ids)) == 4, "UUIDs must be distinct")
    check({'uuid': rm['header']['uuid'], 'version': rm['header']['version']} in bm['dependencies'], "Broken dependency")
    entity = one_json(bp, 'entities/', '.json')['minecraft:entity']
    client = one_json(rp, 'entity/', '.json')['minecraft:client_entity']['description']
    identifier = entity['description']['identifier']
    check(identifier == client['identifier'] and not identifier.startswith('minecraft:'), "Identifier mismatch")
    check(entity['description']['is_spawnable'] and entity['description']['is_summonable'], "Entity not spawnable")
    geo = one_json(rp, 'models/entity/', '.geo.json')['minecraft:geometry'][0]
    desc = geo['description']
    check(desc['identifier'] == client['geometry']['default'], "Geometry reference mismatch")
    texture = client['textures']['default'] + '.png'
    with Image.open(io.BytesIO(rp[texture])) as image:
        image.load()
        check(image.size == (desc['texture_width'], desc['texture_height']), "Texture dimensions mismatch")
    controllers = one_json(rp, 'render_controllers/', '.json')['render_controllers']
    check(all(c in controllers for c in client['render_controllers']), "Render controller missing")
    bones = {b['name']: b for b in geo['bones']}
    check(len(bones) == len(geo['bones']) <= 128, "Duplicate or excessive bones")
    cubes = []
    for bone in bones.values():
        chain, current = set(), bone
        while current.get('parent'):
            parent = current['parent']
            check(parent in bones and parent not in chain, "Missing/cyclic bone parent")
            chain.add(parent)
            current = bones[parent]
        for cube in bone.get('cubes', []):
            cubes.append(cube)
            check(all(math.isfinite(v) and abs(v) <= 512 for v in cube['origin']), "Cube origin out of bounds")
            check(all(math.isfinite(v) and 0 <= v <= 256 for v in cube['size']), "Cube size out of bounds")
            for face in cube['uv'].values():
                for start, size, limit in zip(face['uv'], face['uv_size'], (desc['texture_width'], desc['texture_height'])):
                    check(0 <= min(start, start + size) <= max(start, start + size) <= limit, "UV outside texture")
    check(0 < len(cubes) <= 512, "Cube count out of bounds")
    expected = filename.with_suffix('.expected.json')
    if expected.exists():
        check(json.loads(expected.read_text()) == {'identifier': identifier, 'cubeCount': len(cubes)}, "Edited model differs from expected")
    print(f"PASS {filename.name}: linked packs, CRCs, UUIDs, entity, geometry, texture, UVs, hierarchy; {len(cubes)} cubes")


def verify_skin(filename):
    with Image.open(filename) as image:
        image.load()
        check(image.format == 'PNG' and image.size == (64, 64) and image.mode == 'RGBA', "Invalid skin dimensions/format")
        expected = filename.with_suffix('.expected.rgba')
        if expected.exists():
            check(image.tobytes() == expected.read_bytes(), "Skin pixels changed during export")
    print(f"PASS {filename.name}: 64x64 RGBA PNG; exact exported pixels")


if __name__ == '__main__':
    target = Path(sys.argv[1])
    try:
        if target.is_file():
            verify_addon(target) if target.suffix == '.mcaddon' else verify_skin(target)
        else:
            for style in ('classic', 'slim'):
                verify_skin(target / f'{style}.png')
            addons = sorted(target.glob('*.mcaddon'))
            check(len(addons) >= 3, "Expected all three edited entity fixtures")
            for addon in addons:
                verify_addon(addon)
    except Exception as error:
        print(f"FAIL: {error}", file=sys.stderr)
        sys.exit(1)
