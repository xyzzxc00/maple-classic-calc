"""Build an isolated, reproducible third-job / El Nath preview from a data dump.

Usage: python tools/import_el_nath.py <source checkout>
Never changes data/db, live calculator pools, or existing images. Unknown map
geometry remains unknown; NPC references are not fabricated spawn coordinates.
"""
import json
import os
import sys
from pathlib import Path

import import_db as db

REGIONS = {"冰原雪域", "廢礦"}
ROOT = Path(db.ROOT)
OUTPUT = ROOT / "data" / "preview" / "el-nath"
SETS = ("monsters", "maps", "items", "npcs", "quests", "skills")


def write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def main():
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    source = Path(sys.argv[1]).resolve()
    original_load = db.load
    raw = {n: original_load(str(source), n) for n in
           ("data.js", "maps-data.js", "worldmaps-data.js", "quests-data.js", "items-data.js", "skills-data.js")}
    db.PREVIEW_MODE = True
    live_map_ids = {m["id"] for m in json.loads((ROOT / "data/db/maps.json").read_text(encoding="utf-8"))}
    maps = [m for m in raw["maps-data.js"]["maps"]
            if m["id"] in live_map_ids or m.get("regionName") in REGIONS]
    raw["maps-data.js"]["maps"] = maps
    by_id = {m["id"]: m for m in maps}
    source_map_ids = set(by_id)

    def ensure_map(m, region=None):
        mid = m.get("id", m.get("mapId"))
        area = region or m.get("regionName")
        if not mid or area not in REGIONS:
            return None
        mid = int(mid)  # world nodes use strings; map/NPC references use integers.
        if mid not in by_id:
            by_id[mid] = {
                "id": mid, "name": m.get("name") or m.get("label") or f"地圖 {mid}（名稱待確認）",
                "street": m.get("street") or "", "regionName": area,
                "markKey": m.get("markKey") or ("ElNathDungeon" if area == "廢礦" else "Other"),
                "monsterSpawns": [], "npcSpawns": [], "portals": [],
                "mapDataMissing": True,
                **db.preview_provenance(m),
            }
            maps.append(by_id[mid])
        return by_id[mid]

    # The world map carries named town nodes absent from individual map files.
    for region in raw["worldmaps-data.js"]["worldMaps"]["regions"]:
        if region["name"] not in REGIONS:
            continue
        for node in region.get("nodes") or []:
            if not node.get("unnamed"):
                ensure_map(node, region["name"])

    def add_npc(n, reference):
        if not n or not n.get("id") or not n.get("name") or n.get("unnamed"):
            return
        for ref in n.get("maps") or []:
            m = ensure_map(ref)
            if not m:
                continue
            existing = next((p for p in m["npcSpawns"] if p.get("npcId") == n["id"]), None)
            evidence = {**db.preview_provenance(ref), **reference, "referenceOnly": True}
            if existing is None:
                m["npcSpawns"].append({"npcId": n["id"], "name": n["name"], **evidence})
            elif existing.get("referenceOnly"):
                db.merge_preview_provenance(existing, evidence)

    for q in raw["quests-data.js"]["quests"]:
        for key in ("startNpc", "endNpc"):
            add_npc(q.get(key), {"referenceFile": "quests-data.js", "referenceKind": key,
                                 "referenceId": q["id"]})
    for item in raw["items-data.js"]["items"]:
        sources = item.get("sources") or {}
        for shop in sources.get("shops") or []:
            add_npc(shop.get("npc"), {"referenceFile": "items-data.js", "referenceKind": "shop",
                                      "referenceId": item["id"]})
        for craft in sources.get("crafts") or []:
            for npc in craft.get("npcs") or []:
                add_npc(npc, {"referenceFile": "items-data.js", "referenceKind": "craft",
                              "referenceId": item["id"]})

    # MonsterBook's reverse map list omits source/sourceLabel. Join only the
    # exact map + monster pair from map spawn evidence; coordinates stay unknown.
    map_evidence = {}
    for m in maps:
        for spawn in m.get("monsterSpawns") or []:
            map_evidence.setdefault((m["id"], str(spawn.get("monsterId"))), []).append(spawn)
    for monster in raw["data.js"]["monsters"]:
        for ref in monster.get("maps") or []:
            for evidence in map_evidence.get((ref["id"], str(monster["id"])), []):
                db.merge_preview_provenance(ref, evidence)

    db.OPEN_REGIONS = db.OPEN_REGIONS | REGIONS
    db.OUT_DATA = str(OUTPUT)
    db.load = lambda src, name: raw[name] if name in raw else original_load(src, name)
    db.main()

    summary = {}
    for kind in SETS:
        index_path = OUTPUT / f"{kind}.json"
        rows = json.loads(index_path.read_text(encoding="utf-8"))
        live_rows = json.loads((ROOT / "data" / "db" / f"{kind}.json").read_text(encoding="utf-8"))
        live_ids = {str(r["id"]) for r in live_rows}
        have_ids = {str(r["id"]) for r in rows}
        # An upstream removal must not break existing cross-links in this union.
        # An intentionally excluded quest-only item is not an upstream removal:
        # copying its old detail back would resurrect the filtered relationship.
        for row in live_rows:
            if kind == "items" and str(row["id"]) in db.PREVIEW_EXCLUDED_QUEST_ITEMS:
                continue
            if str(row["id"]) not in have_ids:
                rows.append(dict(row))
                old_detail = ROOT / "data" / "db" / kind / f"{row['id']}.json"
                (OUTPUT / kind / old_detail.name).write_bytes(old_detail.read_bytes())
        added = []
        relevant = []
        available_ids = {str(r["id"]) for r in rows}
        for row in rows:
            rid = str(row["id"])
            is_new = rid not in live_ids
            # Three-job skills already existed as reference; keep them clearly labelled.
            row["preview"] = is_new or (kind == "skills" and row.get("adv") == "三轉")
            if is_new:
                added.append(rid)
            if row["preview"]:
                relevant.append(rid)
            detail_path = OUTPUT / kind / f"{rid}.json"
            detail = json.loads(detail_path.read_text(encoding="utf-8"))
            detail["preview"] = row["preview"]
            if kind == "items":
                for craft in detail.get("crafts", []):
                    for material in craft.get("materials", []):
                        material["link"] = str(material["id"]) in available_ids
                    if craft.get("out"):
                        craft["out"]["link"] = str(craft["out"].get("id")) in available_ids
                for output in detail.get("usedIn", []):
                    output["link"] = str(output["id"]) in available_ids
            if kind == "maps" and detail.get("dataMissing"):
                # Reference lists can identify an NPC, never its on-map coordinates.
                detail["npcs"] = [{"name": n["name"], "x": None, "y": None,
                                   **db.preview_provenance(n)}
                                  for n in by_id[int(rid)].get("npcSpawns", []) if n.get("name")]
            write(detail_path, detail)
        write(index_path, rows)
        summary[kind] = {"total": len(rows), "added": added, "preview": relevant}

    shops = json.loads((OUTPUT / "shops.json").read_text(encoding="utf-8"))
    live_shop_ids = {s["id"] for s in json.loads((ROOT / "data" / "db" / "shops.json").read_text(encoding="utf-8"))}
    for shop in shops:
        shop["preview"] = shop["id"] not in live_shop_ids
    write(OUTPUT / "shops.json", shops)
    metadata = raw["maps-data.js"].get("metadata") or {}
    manifest = {
        "title": "三轉與冰原雪域預覽", "status": "preview", "checkedAt": "2026-09-10",
        "gameVersion": metadata.get("gameVersion"),
        "provenanceSchemaVersion": 1,
        "excludedQuestItems": sorted(db.PREVIEW_EXCLUDED_QUEST_ITEMS),
        "generatedAt": metadata.get("generatedAt"), "regions": sorted(REGIONS), "sets": summary,
        "missingMapData": sorted(str(m["id"]) for m in maps if m.get("regionName") in REGIONS and m.get("mapDataMissing")),
        "referenceOnlyMaps": sorted(str(mid) for mid in set(by_id) - source_map_ids),
        "notice": "拆包存在不代表已開放；地圖幾何、實際重生點、通行條件與正式服獎勵待確認。廢礦／殘暴炎魔僅為關聯資料，不代表同批推出。",
    }
    write(OUTPUT / "manifest.json", manifest)
    print("Preview additions:", {k: len(v["added"]) for k, v in summary.items()})
    print("Missing map geometry:", len(manifest["missingMapData"]))


if __name__ == "__main__":
    main()
