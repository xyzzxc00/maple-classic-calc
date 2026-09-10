"""Stage a bounded game-data refresh without writing the shared gacha archive.

Usage: python tools/refresh_game_data.py <source checkout> <new staging directory>
Review the generated data and new, referenced images before copying them live.
Existing site images (including intentionally blank/manual fixes) are preserved.
"""
import json
import sys
from pathlib import Path

import import_db as db
import import_calc as calc
import import_el_nath as preview


def main():
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    source = Path(sys.argv[1]).resolve()
    stage = Path(sys.argv[2]).resolve()
    if stage.exists():
        raise SystemExit('Use a new staging directory; existing work is never cleared.')
    site = Path(db.ROOT)
    for area in ['data/db', 'data/preview/el-nath']:
        db.WORLD_MAP_GEOMETRY.update({r['key']: r for r in
            json.loads((site / area / 'worldmaps.json').read_text(encoding='utf-8'))})
    stage.mkdir(parents=True)
    # Snapshot the pools once in memory. PREVIEW_MODE disables archive writes;
    # both live and preview output then use this identical immutable pool set.
    db.PREVIEW_MODE = True
    pools = db.load_gacha_pools(str(source))
    db.PREVIEW_MODE = False
    db.load_gacha_pools = lambda src: pools
    db.ROOT = str(stage)
    db.OUT_DATA = str(stage / 'data/db')
    db.OUT_ASSETS = str(stage / 'assets/db')
    original_copy = db.copy_image

    def copy_new(src, rel, dest_dir, dest_name=None):
        if rel:
            target = Path(dest_dir) / (dest_name or Path(rel).name)
            existing = site / target.relative_to(stage)
            if existing.exists():
                return True
        return original_copy(src, rel, dest_dir, dest_name)

    db.copy_image = copy_new
    # Overrides are already protected in the live image set; don't emit copies.
    db.ICON_OVERRIDES = str(stage / 'no-icon-overrides')
    sys.argv = [sys.argv[0], str(source)]
    db.main()
    # Retired/merged upstream rows remain useful for historical possessions and
    # existing links. Retain their last reviewed records, never invent a source.
    for kind in preview.SETS:
        index = stage / 'data/db' / f'{kind}.json'
        rows = json.loads(index.read_text(encoding='utf-8'))
        ids = {str(row['id']) for row in rows}
        old = json.loads((site / 'data/db' / f'{kind}.json').read_text(encoding='utf-8'))
        for row in old:
            if str(row['id']) in ids:
                continue
            rows.append(row)
            relative = Path('data/db') / kind / f"{row['id']}.json"
            (stage / relative).write_bytes((site / relative).read_bytes())
        index.write_text(json.dumps(rows, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    calc.ROOT = str(stage)
    calc.DB_DIR = str(stage / 'data/db')
    calc.SKILL_IMG_DIR = str(stage / 'assets/db/skills')
    calc.ITEM_IMG_DIR = str(stage / 'assets/db/items')
    calc.JOB_IMG_DIR = str(stage / 'assets/db/jobs')
    original_calc_copy = calc.copy_image
    original_portrait = calc.copy_portrait

    def calc_copy(src, rel, dest_dir, copied, missing):
        if rel:
            target = Path(dest_dir) / Path(rel).name
            relative = target.relative_to(stage)
            if (site / relative).exists():
                return relative.as_posix()
        Path(dest_dir).mkdir(parents=True, exist_ok=True)
        return original_calc_copy(src, rel, dest_dir, copied, missing)

    def portrait(src, rel, copied, missing):
        if rel and (site / 'assets/db/jobs' / Path(rel).name).exists():
            return 'assets/db/jobs/' + Path(rel).name
        return original_portrait(src, rel, copied, missing)

    calc.copy_image = calc_copy
    calc.copy_portrait = portrait
    if calc.main():
        raise SystemExit('Calculator import failed')
    preview.ROOT = stage
    preview.OUTPUT = stage / 'data/preview/el-nath'
    preview.main()
    for area in ['data/db', 'data/preview/el-nath']:
        counts = {kind: len(json.loads((stage / area / f'{kind}.json').read_text(encoding='utf-8')))
                  for kind in preview.SETS}
        print(area, counts)
    print('New referenced images:', len(list((stage / 'assets/db').rglob('*.png'))))


if __name__ == '__main__':
    main()
