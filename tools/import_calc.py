# -*- coding: utf-8 -*-
"""把 morris 拆包 repo 的攻擊力計算／卷軸模擬資料匯進本站。

用法：python tools/import_calc.py <morris-clone-dir>

產出：
  data/db/damage_calc.json  攻擊力計算用（職業、技能、精靈祝福、隊伍/道具 BUFF）
  data/db/scroll_sim.json   卷軸模擬用（裝備 2000+ 筆、卷軸 500+ 筆）
  assets/db/skills/         補齊計算機引用到、資料庫匯入沒帶到的技能圖示
  assets/db/items/          補齊裝備/卷軸/藥水圖示
  assets/db/jobs/           職業立繪（原檔 395×400 有 200~300KB，縮到寬 160）

與 tools/import_db.py 的關係：那支管六大資料集（受 OPEN_REGIONS/LEVEL_CAP
閘門），這支管兩個計算工具的專用資料——計算工具是「練到滿的規劃器」，
照 morris 原樣收全部職業與四轉技能，不做開放進度過濾。

瘦身：原始檔各約 1MB，主要肥在 search 欄位（把名稱+說明重複一次）與
大量為 0 的屬性欄。search 拔掉（前端直接搜名稱/說明）、stats 只留非零值
與 reqLevel/reqJob/tuc/price 四個結構欄，兩檔合計能省下約四成。
"""
import io
import json
import os
import re
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_DIR = os.path.join(ROOT, "data", "db")
SKILL_IMG_DIR = os.path.join(ROOT, "assets", "db", "skills")
ITEM_IMG_DIR = os.path.join(ROOT, "assets", "db", "items")
JOB_IMG_DIR = os.path.join(ROOT, "assets", "db", "jobs")

PORTRAIT_WIDTH = 160

# stats 裡即使是 0 也要保留的結構欄位（前端拿來篩選與顯示）
STRUCT_STAT_KEYS = {"reqLevel", "reqJob", "tuc", "price"}


def load_window_json(path):
    """morris 的資料檔是 `window.XXX = {...};` 單行 JS，去頭去尾當 JSON 讀"""
    with open(path, encoding="utf-8") as f:
        text = f.read()
    return json.loads(text[text.index("=") + 1:].strip().rstrip(";"))


def copy_image(src_dir, image_path, dest_dir, copied, missing):
    """把 morris 的 ./assets/... 圖片補進本站資產夾；回傳本站相對路徑或 None"""
    if not image_path:
        return None
    name = os.path.basename(image_path)
    src = os.path.join(src_dir, image_path.lstrip("./").replace("/", os.sep))
    dest = os.path.join(dest_dir, name)
    rel = f"assets/db/{os.path.basename(dest_dir)}/{name}"
    if os.path.exists(dest):
        return rel
    if not os.path.exists(src):
        missing.append(image_path)
        return None
    shutil.copy2(src, dest)
    copied.append(name)
    return rel


def copy_portrait(src_dir, image_path, copied, missing):
    """職業立繪縮到寬 PORTRAIT_WIDTH 再存，畫質對 64px 顯示綽綽有餘"""
    if not image_path:
        return None
    name = os.path.basename(image_path)
    src = os.path.join(src_dir, image_path.lstrip("./").replace("/", os.sep))
    dest = os.path.join(JOB_IMG_DIR, name)
    rel = f"assets/db/jobs/{name}"
    if os.path.exists(dest):
        return rel
    if not os.path.exists(src):
        missing.append(image_path)
        return None
    try:
        from PIL import Image
        im = Image.open(src)
        ratio = PORTRAIT_WIDTH / im.width
        im = im.resize((PORTRAIT_WIDTH, round(im.height * ratio)), Image.LANCZOS)
        im.save(dest, optimize=True)
    except ImportError:
        shutil.copy2(src, dest)
    copied.append(name)
    return rel


def slim_stats(stats):
    out = {}
    for key, value in (stats or {}).items():
        if key in STRUCT_STAT_KEYS or (isinstance(value, (int, float)) and value):
            out[key] = value
    return out


def main():
    if len(sys.argv) != 2 or not os.path.isdir(sys.argv[1]):
        print(__doc__)
        return 1
    src_root = sys.argv[1]
    os.makedirs(JOB_IMG_DIR, exist_ok=True)

    copied = []
    missing = []

    # ---------------------------------------------------------- 攻擊力計算
    dmg = load_window_json(os.path.join(src_root, "damage-calculator-data.js"))

    jobs = []
    for job in dmg["jobs"]:
        jobs.append({**job, "image": copy_portrait(src_root, job.get("image"), copied, missing)})

    def skill_image(skill):
        return copy_image(src_root, skill.get("image"), SKILL_IMG_DIR, copied, missing)

    skills = [{**s, "image": skill_image(s)} for s in dmg["skills"]]
    spirit = dict(dmg["spiritBlessing"])
    spirit["image"] = skill_image(spirit)
    party_buffs = [{**b, "image": skill_image(b)} for b in dmg["partySkillBuffs"]]
    item_buffs = [
        {**b, "image": copy_image(src_root, b.get("image"), ITEM_IMG_DIR, copied, missing)}
        for b in dmg["itemBuffs"]
    ]

    damage_out = {
        "metadata": {
            "gameVersion": dmg["metadata"].get("gameVersion"),
            "generatedAt": dmg["metadata"].get("generatedAtText") or dmg["metadata"].get("generatedAt"),
        },
        "jobs": jobs,
        "skills": skills,
        "spiritBlessing": spirit,
        "partySkillBuffs": party_buffs,
        "itemBuffs": item_buffs,
    }

    # ------------------------------------------------------------ 卷軸模擬
    sim = load_window_json(os.path.join(src_root, "scroll-simulator-data.js"))

    equipment = []
    for item in sim["equipment"]:
        row = {
            "id": item["id"],
            "name": item["name"],
            "subcategory": item.get("subcategory") or "",
            "image": copy_image(src_root, item.get("image"), ITEM_IMG_DIR, copied, missing),
            "hasSource": bool(item.get("hasSource")),
            "stats": slim_stats(item.get("stats")),
        }
        if item.get("statRanges"):
            row["statRanges"] = item["statRanges"]
        if item.get("statRangeSources"):
            row["statRangeSources"] = item["statRangeSources"]
        equipment.append(row)

    scrolls = []
    for item in sim["scrolls"]:
        scrolls.append({
            "id": item["id"],
            "name": item["name"],
            "target": item.get("target") or "",
            "image": copy_image(src_root, item.get("image"), ITEM_IMG_DIR, copied, missing),
            "hasSource": bool(item.get("hasSource")),
            "desc": item.get("desc") or "",
            "successRate": item.get("successRate"),
            "destroyRate": item.get("destroyRate"),
            "effects": item.get("effects") or {},
        })

    scroll_out = {
        "metadata": damage_out["metadata"],
        "equipment": equipment,
        "scrolls": scrolls,
    }

    for name, payload in (("damage_calc.json", damage_out), ("scroll_sim.json", scroll_out)):
        path = os.path.join(DB_DIR, name)
        with io.open(path, "w", encoding="utf-8", newline="\n") as f:
            json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
        print(f"{name}: {os.path.getsize(path) / 1024:.0f} KB")

    print(f"職業 {len(jobs)}｜技能 {len(skills)}｜隊伍BUFF {len(party_buffs)}｜道具BUFF {len(item_buffs)}")
    print(f"裝備 {len(equipment)}｜卷軸 {len(scrolls)}")
    print(f"新複製圖片 {len(copied)} 張")
    if missing:
        print(f"⚠ 來源缺圖 {len(missing)} 張，例：{missing[:5]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
