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
閘門），這支管兩個計算工具的專用資料。**這支完全跟著那支的產出走**：
- 技能只收到三轉（MAX_ADVANCEMENT），四轉還沒開
- 裝備、卷軸、道具 BUFF 只留 data/db/items.json 有的
- 隊伍 BUFF 只留 data/db/skills.json 有的
- 裝備的天然浮動範圍只沿用道具詳情已確認的開放取得方式，不把未開放地區
  的怪物掉落或一般 NPC 製作誤算進來
沒開放的東西列出來，使用者點下去在站上也查不到，只會誤導；所以寧可少列。
所以**跑這支之前一定要先跑 import_db.py**（會直接讀它的產出當白名單）。

改版開放四轉時，把 MAX_ADVANCEMENT 加上「四轉」、重跑 import_db.py 與本支，
前端的 ADVANCEMENT_ORDER 與 MAX_CHARACTER_LEVEL（js/attack.js）也要同步改。

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

# 目前開放到三轉。零轉（jobId 0 的共通技能）不帶 advancement 欄位，另外放行
MAX_ADVANCEMENT = {"零轉", "一轉", "二轉", "三轉"}

# stats 裡即使是 0 也要保留的結構欄位（前端拿來篩選與顯示）
STRUCT_STAT_KEYS = {"reqLevel", "reqJob", "tuc", "price"}


def open_reference_sets():
    """讀 import_db.py 產出的道具／技能索引，用來過濾 BUFF 清單。

    計算機列出的 BUFF 如果站上資料庫查不到，使用者點下去只會撲空——
    寧可少列，也不要列出還沒開放的東西"""
    def load_ids(name, key="id"):
        path = os.path.join(DB_DIR, name)
        if not os.path.exists(path):
            return None
        with open(path, encoding="utf-8") as f:
            return {str(row[key]) for row in json.load(f)}

    def load_names(name):
        path = os.path.join(DB_DIR, name)
        if not os.path.exists(path):
            return None
        with open(path, encoding="utf-8") as f:
            return {row["name"] for row in json.load(f)}

    return load_ids("items.json"), load_names("skills.json")


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


def load_open_item_details(open_item_ids):
    """讀 import_db.py 產出的道具詳情，讓卷軸模擬與資料庫使用同一份
    「目前開放來源」判斷。只靠 Morris 的全版本 statRanges，會把未開放地區
    的掉落範圍也帶進目前版本。"""
    detail_dir = os.path.join(DB_DIR, "items")
    out = {}
    for item_id in open_item_ids:
        path = os.path.join(detail_dir, f"{item_id}.json")
        if os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                out[item_id] = json.load(f)
    return out


def main():
    if len(sys.argv) != 2 or not os.path.isdir(sys.argv[1]):
        print(__doc__)
        return 1
    src_root = sys.argv[1]
    os.makedirs(JOB_IMG_DIR, exist_ok=True)

    copied = []
    missing = []
    open_item_ids, open_skill_names = open_reference_sets()
    if open_item_ids is None or open_skill_names is None:
        print("⚠ 找不到 data/db/items.json 或 skills.json，請先跑 tools/import_db.py")
        return 1
    open_item_details = load_open_item_details(open_item_ids)

    # ---------------------------------------------------------- 攻擊力計算
    dmg = load_window_json(os.path.join(src_root, "damage-calculator-data.js"))

    jobs = []
    for job in dmg["jobs"]:
        jobs.append({**job, "image": copy_portrait(src_root, job.get("image"), copied, missing)})

    def skill_image(skill):
        return copy_image(src_root, skill.get("image"), SKILL_IMG_DIR, copied, missing)

    # 四轉技能整批擋掉（尚未開放）；零轉的共通技能沒有 advancement 欄位
    skills = [
        {**s, "image": skill_image(s)}
        for s in dmg["skills"]
        if (s.get("advancement") or "零轉") in MAX_ADVANCEMENT
    ]
    dropped_skills = len(dmg["skills"]) - len(skills)

    spirit = dict(dmg["spiritBlessing"])
    spirit["image"] = skill_image(spirit)

    party_buffs = [
        {**b, "image": skill_image(b)}
        for b in dmg["partySkillBuffs"]
        if b.get("name") in open_skill_names
    ]
    dropped_party = [b["name"] for b in dmg["partySkillBuffs"] if b.get("name") not in open_skill_names]

    item_buffs = [
        {**b, "image": copy_image(src_root, b.get("image"), ITEM_IMG_DIR, copied, missing)}
        for b in dmg["itemBuffs"]
        if str(b.get("id")) in open_item_ids
    ]
    dropped_items = [b["name"] for b in dmg["itemBuffs"] if str(b.get("id")) not in open_item_ids]

    damage_out = {
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
        if str(item["id"]) not in open_item_ids:
            continue
        row = {
            "id": item["id"],
            "name": item["name"],
            "subcategory": item.get("subcategory") or "",
            "image": copy_image(src_root, item.get("image"), ITEM_IMG_DIR, copied, missing),
            "stats": slim_stats(item.get("stats")),
        }
        detail = open_item_details.get(str(item["id"])) or {}
        detail_ranges = detail.get("float") or {}
        if detail_ranges:
            upstream_ranges = item.get("statRanges") or {}
            row_ranges = {}
            for key, bounds in detail_ranges.items():
                upstream = upstream_ranges.get(key) or {}
                base = (detail.get("equip") or {}).get(key)
                if (upstream.get("base") != base
                        or upstream.get("min") != bounds[0]
                        or upstream.get("max") != bounds[1]):
                    raise ValueError(
                        f"裝備 {item['id']} {item['name']} 的 {key} 浮動範圍"
                        "與道具詳情不一致，請先重跑 import_db.py"
                    )
                row_ranges[key] = {"base": base, "min": bounds[0], "max": bounds[1]}
            row["statRanges"] = row_ranges
            row["statRangeSources"] = detail.get("floatFrom") or []
        equipment.append(row)

    scrolls = []
    for item in sim["scrolls"]:
        if str(item["id"]) not in open_item_ids:
            continue
        scrolls.append({
            "id": item["id"],
            "name": item["name"],
            "target": item.get("target") or "",
            "image": copy_image(src_root, item.get("image"), ITEM_IMG_DIR, copied, missing),
            "desc": item.get("desc") or "",
            "successRate": item.get("successRate"),
            "destroyRate": item.get("destroyRate"),
            "effects": item.get("effects") or {},
        })

    scroll_out = {
        "equipment": equipment,
        "scrolls": scrolls,
    }

    for name, payload in (("damage_calc.json", damage_out), ("scroll_sim.json", scroll_out)):
        path = os.path.join(DB_DIR, name)
        with io.open(path, "w", encoding="utf-8", newline="\n") as f:
            json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
        print(f"{name}: {os.path.getsize(path) / 1024:.0f} KB")

    print(f"職業 {len(jobs)}｜技能 {len(skills)}｜隊伍BUFF {len(party_buffs)}｜道具BUFF {len(item_buffs)}")
    print(f"裝備 {len(equipment)}／{len(sim['equipment'])}｜卷軸 {len(scrolls)}／{len(sim['scrolls'])}"
          f"（只留 data/db/items.json 有的）")
    print(f"擋掉：四轉技能 {dropped_skills} 個"
          f"｜未開放隊伍BUFF {dropped_party or '無'}"
          f"｜未開放道具BUFF {dropped_items or '無'}")
    print(f"新複製圖片 {len(copied)} 張")
    if missing:
        print(f"⚠ 來源缺圖 {len(missing)} 張，例：{missing[:5]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
