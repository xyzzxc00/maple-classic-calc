"""
import_db.py — 把拆包出來的遊戲資料匯入成本站資料庫要用的檔案。

用法：
    python tools/import_db.py <拆包資料夾>
    （或設環境變數 MS_DB_SOURCE 指向那個資料夾）

拆包資料本身「不放進這個 repo」——它有 153 MB，而且會隨遊戲改版重新產生。
這支腳本負責從那份原始資料裡，只挑出「本服現階段開放、而且畫面上真的會用到」
的部分，產出小而乾淨的檔案給網站載入。

產出：
    data/db/monsters.json          列表用的索引（進站就載，要夠小）
    data/db/monsters/<id>.json     單隻怪的詳情（點開才載）
    assets/db/monsters/<id>.png    怪物圖
    assets/db/items/<id>.png       掉落道具圖

改版後要更新資料，就是「重新拆包 → 改下面的 OPEN_REGIONS／LEVEL_CAP → 重跑」，
不用回頭動任何網站程式碼。
"""

import json
import os
import shutil
import sys

# ---------------------------------------------------------------- 開放範圍設定
# 這裡是整個資料庫「顯示什麼」的唯一開關。拆包檔案一律包含尚未開放的內容
# （四轉技能、Lv.120 任務、還沒開的大陸），照單全收會讓站上列出遊戲裡根本
# 進不去的東西——本站一向標榜數字查證過，這個信譽不能為了資料量犧牲。
#
# 2026-08 現況：世界地圖只有這三塊，等級上限 100。
# 之後開新地區，改這裡再重跑就好。
OPEN_REGIONS = {"楓之島", "維多利亞島", "奇幻村"}
LEVEL_CAP = 100

# 技能：本服只有五大冒險家職業。拆包檔裡還有皇家騎士團、狂狼勇士、龍魔導士、
# 影武者這些後期版本才有的職業群，以及 GM 專用技能，全部不收。四轉技能要
# Lv.120 才學得到，等級上限開放前也不該出現
OPEN_SKILL_GROUPS = {
    "初心者/共通",
    "冒險家劍士",
    "冒險家法師",
    "冒險家弓箭手",
    "冒險家盜賊",
    "冒險家海盜",
}
CLOSED_ADVANCEMENTS = {"四轉"}

# 怪物數值裡「0 代表沒有這個屬性」的欄位，全 0 的裝備數值不用寫進詳情檔
EQUIP_SKIP_ZERO = True

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DATA = os.path.join(ROOT, "data", "db")
OUT_ASSETS = os.path.join(ROOT, "assets", "db")


def fail(msg):
    print("ERROR: " + msg)
    sys.exit(1)


def load(src, name):
    """拆包檔是 `window.MS_XXX_DB = {...};` 的形式，剝掉外殼取 JSON"""
    path = os.path.join(src, name)
    if not os.path.exists(path):
        fail(f"找不到 {path}——來源資料夾給錯了？")
    with open(path, encoding="utf-8") as f:
        return json.loads(f.read().split("=", 1)[1].strip().rstrip(";"))


# ------------------------------------------------------------------ 過濾規則


def open_map_ids(maps):
    """開放地圖：世界地圖區域或所屬街道在白名單內。
    regionName 是世界地圖那一層的名字（維多利亞島），street 是城鎮那一層
    （弓箭手村），兩個都比對是因為有些地圖只有其中一個對得上"""
    return {
        m["id"]
        for m in maps
        if m.get("regionName") in OPEN_REGIONS or m.get("street") in OPEN_REGIONS
    }


def open_quest_ids(quests, map_ids):
    """開放任務：等級門檻沒超過上限，而且起訖 NPC 站在開放地圖上。
    只看等級會漏掉一堆——未開放地區也有 Lv.20 的任務"""
    out = set()
    for q in quests:
        if (q.get("minLevel") or 0) > LEVEL_CAP:
            continue
        npc_maps = []
        for key in ("startNpc", "endNpc"):
            npc = q.get(key) or {}
            npc_maps += [mp.get("id") for mp in (npc.get("maps") or [])]
        if npc_maps and any(i in map_ids for i in npc_maps):
            out.add(str(q["id"]))
    return out


def pick_monsters(monsters, map_ids):
    """開放怪物：等級沒超過上限、名字不是未命名、而且至少出現在一張開放地圖。
    等級不能當主要判準——桃花仙境的穆魯是 Lv.1，地區沒開，等級再低也不該出現"""
    out = []
    for m in monsters:
        if m.get("unnamed") or (m.get("level") or 0) > LEVEL_CAP:
            continue
        if any(mp.get("id") in map_ids for mp in (m.get("maps") or [])):
            out.append(m)
    return sorted(out, key=lambda m: (m.get("level") or 0, m["name"]))


# ------------------------------------------------------------------ 欄位精簡


def trim_equip(stats):
    """裝備數值只留有意義的：全 0 的加成欄位是雜訊，islot/vslot 是內部用的
    裝備欄位代碼，畫面上用不到"""
    if not stats:
        return None
    drop = {"islot", "vslot", "cash"}
    out = {}
    for k, v in stats.items():
        if k in drop:
            continue
        if EQUIP_SKIP_ZERO and v == 0:
            continue
        out[k] = v
    return out or None


def trim_map(mp):
    return {
        "id": mp["id"],
        "street": mp.get("street") or "",
        "name": mp.get("name") or "",
        "region": mp.get("regionName") or "",
        "spawns": mp.get("spawnCount") or 0,
    }


def trim_drop(d):
    out = {
        "id": d["id"],
        "name": d["name"],
        "cat": d.get("category") or "",
        "sub": d.get("subcategory") or "",
    }
    if d.get("sellPrice"):
        out["sell"] = d["sellPrice"]
    equip = trim_equip(d.get("equipStats"))
    if equip:
        out["equip"] = equip
    return out


def trim_quest(q):
    return {
        "id": str(q["questId"]),
        "name": q.get("questName") or "",
        "stage": q.get("stageLabel") or "",
        "count": q.get("count") or 0,
    }


def build_detail(m, map_ids, quest_ids):
    """單隻怪的詳情。出沒地圖要再過濾一次——有些怪同時住在開放與未開放地區
    （例如蝴蝶精在維多利亞島也在冰原雪域），只能列出進得去的那些"""
    maps = [trim_map(mp) for mp in (m.get("maps") or []) if mp.get("id") in map_ids]
    quests = [
        trim_quest(q)
        for q in (m.get("questRequirements") or [])
        if str(q.get("questId")) in quest_ids
    ]
    meso = m.get("mesoDrop") or {}
    el = m.get("elemental") or {}
    return {
        "id": m["id"],
        "name": m["name"],
        "level": m.get("level"),
        "desc": (m.get("description") or "").strip(),
        "stats": m.get("stats") or {},
        "elemental": {"summary": el.get("summary") or "", "values": el.get("values") or {}},
        "meso": {
            "min": meso.get("totalMin"),
            "max": meso.get("totalMax"),
            "note": meso.get("sourceLabel") or "",
        },
        "maps": sorted(maps, key=lambda x: -x["spawns"]),
        # 拆包資料只有「會掉什麼」，沒有掉落率——畫面上不能顯示機率
        "drops": [trim_drop(d) for d in (m.get("drops") or [])],
        "quests": quests,
    }


def pick_skills(skills):
    return [
        s
        for s in skills
        if s.get("jobGroup") in OPEN_SKILL_GROUPS
        and s.get("advancement") not in CLOSED_ADVANCEMENTS
    ]


def build_skill_detail(s):
    """技能詳情：留說明、公式、每一級的數值。levels 的 description 是遊戲原文
    （每級一句），保留原文比自己組句子安全"""
    return {
        "id": s["id"],
        "name": s["name"],
        "group": s.get("jobGroup") or "",
        "job": s.get("jobName") or "",
        "adv": s.get("advancement") or "",
        "maxLevel": s.get("maxLevel"),
        "desc": (s.get("description") or "").strip(),
        "formula": (s.get("formula") or "").strip(),
        "labels": s.get("valueLabels") or {},
        "levels": [
            {
                "level": lv.get("level"),
                "desc": (lv.get("description") or "").strip(),
                "values": lv.get("values") or {},
            }
            for lv in (s.get("levels") or [])
        ],
    }


def build_skill_index(details):
    return [
        {
            "id": d["id"],
            "name": d["name"],
            "group": d["group"],
            "job": d["job"],
            "adv": d["adv"],
            "maxLevel": d["maxLevel"],
        }
        for d in details
    ]


def build_index(details):
    """列表用的索引，欄位越少越好——這是進站就會載的檔案"""
    return [
        {
            "id": d["id"],
            "name": d["name"],
            "level": d["level"],
            "hp": (d["stats"] or {}).get("maxHP"),
            "exp": (d["stats"] or {}).get("exp"),
            "el": d["elemental"]["summary"],
            "maps": len(d["maps"]),
            "drops": len(d["drops"]),
            "regions": sorted({mp["region"] for mp in d["maps"] if mp["region"]}),
        }
        for d in details
    ]


# ------------------------------------------------------------------ 圖片搬運


def copy_image(src_root, rel_path, dest_dir):
    """來源記錄裡的路徑長這樣：./assets/items/1002067.png"""
    if not rel_path:
        return False
    src = os.path.join(src_root, rel_path.lstrip("./").replace("/", os.sep))
    if not os.path.exists(src):
        return False
    os.makedirs(dest_dir, exist_ok=True)
    shutil.copy2(src, os.path.join(dest_dir, os.path.basename(src)))
    return True


def main():
    src = (sys.argv[1] if len(sys.argv) > 1 else os.environ.get("MS_DB_SOURCE", "")).strip()
    if not src or not os.path.isdir(src):
        fail("請指定拆包資料夾：python tools/import_db.py <資料夾>")

    monsters_db = load(src, "data.js")
    maps_db = load(src, "maps-data.js")
    quests_db = load(src, "quests-data.js")
    skills_db = load(src, "skills-data.js")

    map_ids = open_map_ids(maps_db["maps"])
    quest_ids = open_quest_ids(quests_db["quests"], map_ids)
    kept = pick_monsters(monsters_db["monsters"], map_ids)
    if not kept:
        fail("過濾之後一隻怪都不剩，OPEN_REGIONS 是不是打錯了？")

    details = [build_detail(m, map_ids, quest_ids) for m in kept]

    # 產出
    shutil.rmtree(OUT_DATA, ignore_errors=True)
    os.makedirs(os.path.join(OUT_DATA, "monsters"), exist_ok=True)
    with open(os.path.join(OUT_DATA, "monsters.json"), "w", encoding="utf-8") as f:
        json.dump(build_index(details), f, ensure_ascii=False, separators=(",", ":"))
    for d in details:
        with open(os.path.join(OUT_DATA, "monsters", f"{d['id']}.json"), "w",
                  encoding="utf-8") as f:
            json.dump(d, f, ensure_ascii=False, separators=(",", ":"))

    # 技能
    kept_skills = pick_skills(skills_db["skills"])
    skill_details = [build_skill_detail(s) for s in kept_skills]
    os.makedirs(os.path.join(OUT_DATA, "skills"), exist_ok=True)
    with open(os.path.join(OUT_DATA, "skills.json"), "w", encoding="utf-8") as f:
        json.dump(build_skill_index(skill_details), f, ensure_ascii=False,
                  separators=(",", ":"))
    for d in skill_details:
        with open(os.path.join(OUT_DATA, "skills", f"{d['id']}.json"), "w",
                  encoding="utf-8") as f:
            json.dump(d, f, ensure_ascii=False, separators=(",", ":"))

    # 圖片：怪物本體 + 牠們會掉的道具 + 技能圖示
    shutil.rmtree(OUT_ASSETS, ignore_errors=True)
    mon_imgs = sum(copy_image(src, m.get("image"), os.path.join(OUT_ASSETS, "monsters"))
                   for m in kept)
    item_paths = {}
    for m in kept:
        for d in m.get("drops") or []:
            if d.get("image"):
                item_paths[d["id"]] = d["image"]
    item_imgs = sum(copy_image(src, p, os.path.join(OUT_ASSETS, "items"))
                    for p in item_paths.values())
    skill_imgs = sum(copy_image(src, s.get("image"), os.path.join(OUT_ASSETS, "skills"))
                     for s in kept_skills)

    # 報告
    def dirsize(path):
        return sum(os.path.getsize(os.path.join(dp, f))
                   for dp, _, fs in os.walk(path) for f in fs)

    index_kb = os.path.getsize(os.path.join(OUT_DATA, "monsters.json")) / 1024
    detail_kb = dirsize(os.path.join(OUT_DATA, "monsters")) / 1024
    print(f"開放範圍   {'、'.join(sorted(OPEN_REGIONS))}　Lv.{LEVEL_CAP} 以下")
    print(f"怪物       {len(kept)} 隻（Lv.{kept[0].get('level')}~{kept[-1].get('level')}）")
    print(f"  索引檔   {index_kb:.0f} KB")
    print(f"  詳情檔   {detail_kb:.0f} KB（平均 {detail_kb / len(kept):.1f} KB）")
    print(f"  掉落     {sum(len(d['drops']) for d in details)} 筆，{len(item_paths)} 種道具")
    print(f"  相關任務 {sum(len(d['quests']) for d in details)} 筆")
    skill_kb = dirsize(os.path.join(OUT_DATA, "skills")) / 1024
    print(f"技能       {len(kept_skills)} 個"
          f"（索引 {os.path.getsize(os.path.join(OUT_DATA, 'skills.json')) / 1024:.0f} KB、"
          f"詳情 {skill_kb:.0f} KB）")
    print(f"圖片       怪物 {mon_imgs} 張、道具 {item_imgs} 張、技能 {skill_imgs} 張，"
          f"共 {dirsize(OUT_ASSETS) / 1024 / 1024:.1f} MB")
    missing = len(kept) - mon_imgs
    if missing:
        print(f"  ⚠ 有 {missing} 隻怪找不到圖片")


if __name__ == "__main__":
    main()
