# -*- coding: utf-8 -*-
"""資料庫完整性健檢：索引與詳情檔對得起來嗎？圖片都在嗎？跨資料集的連結
指得到東西嗎？

每次跑完 tools/import_db.py 都該跑這支，CI 也會跑。它防的是那種「畫面看起來
正常、其實資料少了或連結壞了」的錯——例如索引列了某隻怪但詳情檔沒產出、
或任務標了 link=true 卻指向沒被收錄的道具（點下去就是 404）。

用法：python tools/check_data.py
有問題時 exit 1。
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(ROOT, "data", "db")
ASSETS = os.path.join(ROOT, "assets", "db")

# 資料集 → (詳情資料夾, 圖片資料夾或 None)
SETS = {
    "monsters": ("monsters", "monsters"),
    "maps": ("maps", "maps"),
    "items": ("items", "items"),
    "npcs": ("npcs", None),
    "quests": ("quests", None),
    "skills": ("skills", "skills"),
}


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def main():
    if not os.path.isdir(DB):
        print(f"找不到資料庫目錄：{DB}")
        return 1

    problems = []
    ids = {}

    for name, (folder, img_dir) in SETS.items():
        idx = load(os.path.join(DB, f"{name}.json"))
        ids[name] = {str(r["id"]) for r in idx}
        files = {f[:-5] for f in os.listdir(os.path.join(DB, folder)) if f.endswith(".json")}

        idx_kb = os.path.getsize(os.path.join(DB, f"{name}.json")) / 1024
        detail_kb = sum(
            os.path.getsize(os.path.join(DB, folder, f))
            for f in os.listdir(os.path.join(DB, folder))
        ) / 1024
        print(f"{name:9} 索引 {len(idx):5} 筆 / 詳情 {len(files):5} 檔   "
              f"索引 {idx_kb:6.1f} KB  詳情 {detail_kb:7.1f} KB")

        missing = ids[name] - files
        orphan = files - ids[name]
        if missing:
            problems.append(f"{name}：索引有但詳情檔不存在 {len(missing)} 筆，例：{sorted(missing)[:3]}")
        if orphan:
            problems.append(f"{name}：詳情檔多出來（索引沒收）{len(orphan)} 筆，例：{sorted(orphan)[:3]}")

        if img_dir:
            have = {f.rsplit(".", 1)[0] for f in os.listdir(os.path.join(ASSETS, img_dir))}
            no_img = ids[name] - have
            # 地圖本來就有一部分沒有小地圖圖檔（詳情帶 hasMini 標記，畫面會顯示
            # 「這張地圖沒有小地圖資料」），不算問題
            if no_img and name != "maps":
                problems.append(f"{name}：{len(no_img)} 筆缺圖片，例：{sorted(no_img)[:3]}")

    print()

    # 跨資料集連結：標了 link=true 就一定要指得到，不然使用者點下去是死路
    def walk(folder, extract):
        bad = []
        d = os.path.join(DB, folder)
        for fn in sorted(os.listdir(d)):
            doc = load(os.path.join(d, fn))
            for target, tid in extract(doc):
                if str(tid) not in ids[target]:
                    bad.append((fn, target, tid))
        return bad

    def quest_links(doc):
        for m in doc["complete"]["monsters"]:
            if m.get("link"):
                yield "monsters", m["id"]
        for group in ("start", "complete"):
            for i in doc[group].get("items", []):
                if i.get("link"):
                    yield "items", i["id"]
        for i in doc["rewards"]["items"]:
            if i.get("link"):
                yield "items", i["id"]
        for s in doc["rewards"]["skills"]:
            if s.get("link"):
                yield "skills", s["id"]
        rows = doc["start"]["quests"] + doc["deps"] + ([doc["next"]] if doc["next"] else [])
        for q in rows:
            if q.get("link"):
                yield "quests", q["id"]

    def monster_links(doc):
        for d in doc["drops"]:
            if d.get("link"):
                yield "items", d["id"]
        for mp in doc.get("maps", []):
            if mp.get("link"):
                yield "maps", mp["id"]

    def map_links(doc):
        for m in doc["mobs"]:
            if m.get("link"):
                yield "monsters", m["id"]
        for p in doc["portals"]:
            if p.get("link"):
                yield "maps", p["id"]

    def item_links(doc):
        for d in doc["drops"]:
            yield "monsters", d["id"]
        for q in doc["quests"]:
            yield "quests", q["id"]

    for folder, fn, label in (
        ("quests", quest_links, "任務→其他"),
        ("monsters", monster_links, "怪物→道具/地圖"),
        ("maps", map_links, "地圖→怪物/地圖"),
        ("items", item_links, "道具→怪物/任務"),
    ):
        bad = walk(folder, fn)
        print(f"{label:16} {'OK' if not bad else f'⚠ {len(bad)} 個連結指向不存在的資料'}")
        if bad:
            problems.append(f"{label}：{bad[:5]}")

    # 任務獎勵不該混進「完成時被收走的材料」——踩過這個坑，畫面上會看起來
    # 獎勵超多（見 tools/import_db.py 的 gives()）
    over = []
    for fn in sorted(os.listdir(os.path.join(DB, "quests"))):
        doc = load(os.path.join(DB, "quests", fn))
        req = {i["id"] for i in doc["complete"]["items"]}
        dup = [i["name"] for i in doc["rewards"]["items"] if i["id"] in req]
        if dup:
            over.append((doc["name"], dup))
    print(f"{'任務獎勵去重':16} {'OK' if not over else f'⚠ {len(over)} 筆把完成材料當成獎勵'}")
    if over:
        problems.append(f"任務獎勵混入完成材料：{over[:5]}")

    print()
    data_mb = sum(
        os.path.getsize(os.path.join(dp, f))
        for dp, _, fs in os.walk(DB) for f in fs
    ) / 1024 / 1024
    asset_files = [os.path.join(dp, f) for dp, _, fs in os.walk(ASSETS) for f in fs]
    asset_mb = sum(os.path.getsize(f) for f in asset_files) / 1024 / 1024
    print(f"data/db   {data_mb:.1f} MB")
    print(f"assets/db {asset_mb:.1f} MB（{len(asset_files)} 檔）")

    print()
    if problems:
        print("問題：")
        for p in problems:
            print("  ⚠", p)
        return 1
    print("問題：無")
    return 0


if __name__ == "__main__":
    sys.exit(main())
