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


def open_quest_ids(quests, map_ids, monster_ids, skill_ids, job_open):
    """開放任務。只看等級跟「有一端 NPC 在開放地圖」遠遠不夠——四轉技能任務的
    NPC 就站在維多利亞島跟奇幻村，等級需求還是空的，照樣會被放進來（實際看到
    270 萬經驗的四轉任務混在列表裡）。四道關卡：

    1. 等級門檻沒超過上限
    2. 起訖 NPC「都」要在開放地圖上（只要一端在，會混進一堆內容在未開放地區的）
    3. 限定職業的任務，指定職業本服至少要有一個開放（四轉專屬的就擋在這裡）
    4. 要打的怪、獎勵的技能都要在收錄範圍內——做不完或給不了的任務不該列出
    """
    out = set()
    for q in quests:
        if (q.get("minLevel") or 0) > LEVEL_CAP:
            continue
        npcs = {
            key: [mp.get("id") for mp in ((q.get(key) or {}).get("maps") or [])]
            for key in ("startNpc", "endNpc")
        }
        if not (npcs["startNpc"] or npcs["endNpc"]):
            continue
        if any(ids and not any(i in map_ids for i in ids) for ids in npcs.values()):
            continue

        jobs = (q.get("startRequirements") or {}).get("jobs") or []
        if jobs and not any(job_open.get(j, False) for j in jobs):
            continue

        comp = q.get("completeRequirements") or {}
        if any(str(m.get("id")) not in monster_ids for m in (comp.get("monsters") or [])):
            continue
        rewards = ((q.get("completeRewards") or {}).get("skills") or []) + (
            (q.get("startRewards") or {}).get("skills") or []
        )
        if any(r.get("id") not in skill_ids for r in rewards):
            continue
        out.add(str(q["id"]))
    return out


def open_job_codes(skills_db):
    """職業代碼 → 本服是否已開放。直接用技能資料自己的職業表推導，不要自己
    寫「代碼尾數 2 就是四轉」這種規則——那是猜的，而且新職業一加就會錯"""
    return {
        j["id"]: (j.get("jobGroup") in OPEN_SKILL_GROUPS
                  and j.get("advancement") not in CLOSED_ADVANCEMENTS)
        for j in ((skills_db.get("filters") or {}).get("skillJobs") or [])
    }


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


def trim_drop(d, item_ids):
    out = {
        "id": d["id"],
        "name": d["name"],
        "cat": d.get("category") or "",
        "sub": d.get("subcategory") or "",
        # 未命名道具不會進道具資料集（沒名字沒圖，列出來只是雜訊），但牠們
        # 確實在掉落表裡，所以照列、只是不做成連結，掉落筆數才不會失真
        "link": d["id"] in item_ids,
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


def build_detail(m, map_ids, quest_ids, item_ids):
    """單隻怪的詳情。出沒地圖要再過濾一次——有些怪同時住在開放與未開放地區
    （例如蝴蝶精在維多利亞島也在冰原雪域），只能列出進得去的那些"""
    all_drops = m.get("drops") or []
    drops = [trim_drop(d, item_ids) for d in all_drops if d["id"] in item_ids]
    hidden_drops = len(all_drops) - len(drops)
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
        # 拆包資料只有「會掉什麼」，沒有掉落率——畫面上不能顯示機率。
        # 未命名道具（遊戲資料裡沒名字沒圖的，顯示成「未命名道具 2040824」）
        # 不列出來——讀者看了也不知道那是什麼，只是雜訊；但筆數要另外標，
        # 不然掉落表看起來像被砍過
        "drops": drops,
        "hiddenDrops": hidden_drops,
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


def build_quest_detail(q, map_ids, monster_ids, skill_ids, quest_ids, item_ids):
    """任務詳情。NPC 的所在地圖只留開放的那些；提到的怪物與技能若本站也收錄了，
    就帶上 id 讓畫面可以互連"""

    def npc(n):
        if not n:
            return None
        maps = [
            {"id": m.get("id"), "label": m.get("label") or m.get("name") or ""}
            for m in (n.get("maps") or [])
            if m.get("id") in map_ids
        ]
        return {"id": n.get("id"), "name": n.get("name") or "", "maps": maps}

    def items(rows):
        return [
            {
                "id": r["id"],
                "name": r.get("name") or "",
                "count": r.get("count") or 0,
                "link": r["id"] in item_ids,
            }
            for r in (rows or [])
        ]

    def monsters(rows):
        return [
            {
                "id": str(r["id"]),
                "name": r.get("name") or "",
                "count": r.get("count") or 0,
                # 本站有收錄這隻怪才給連結，不然點了會 404
                "link": str(r["id"]) in monster_ids,
            }
            for r in (rows or [])
        ]

    def skills(rows):
        return [
            {"id": r["id"], "name": skill_ids.get(r["id"], ""), "link": r["id"] in skill_ids}
            for r in (rows or [])
        ]

    def quests(rows):
        return [
            {
                "id": str(r["id"]),
                "name": r.get("name") or "",
                "state": r.get("stateLabel") or "",
                "link": str(r["id"]) in quest_ids,
            }
            for r in (rows or [])
        ]

    start = q.get("startRequirements") or {}
    comp = q.get("completeRequirements") or {}
    rw = q.get("completeRewards") or {}
    srw = q.get("startRewards") or {}
    nxt = q.get("nextQuest")
    return {
        "id": str(q["id"]),
        "name": q.get("name") or "",
        "category": q.get("category") or "",
        "parent": q.get("parent") or "",
        "minLevel": q.get("minLevel"),
        "maxLevel": q.get("maxLevel"),
        "startNpc": npc(q.get("startNpc")),
        "endNpc": npc(q.get("endNpc")),
        "start": {
            "level": start.get("minLevel"),
            "jobs": start.get("jobs") or [],
            "items": items(start.get("items")),
            "quests": quests(start.get("quests")),
        },
        "complete": {
            "items": items(comp.get("items")),
            "monsters": monsters(comp.get("monsters")),
        },
        "rewards": {
            "exp": (rw.get("exp") or 0) + (srw.get("exp") or 0),
            "money": (rw.get("money") or 0) + (srw.get("money") or 0),
            "pop": (rw.get("pop") or 0) + (srw.get("pop") or 0),
            "items": items(rw.get("items")) + items(srw.get("items")),
            "skills": skills(rw.get("skills")) + skills(srw.get("skills")),
        },
        "texts": [
            {"label": t.get("label") or "", "text": (t.get("text") or "").strip()}
            for t in (q.get("texts") or [])
            if (t.get("text") or "").strip()
        ],
        "next": {"id": str(nxt["id"]), "name": nxt.get("name") or "",
                 "link": str(nxt["id"]) in quest_ids} if nxt else None,
        "deps": quests(q.get("dependentQuests")),
    }


def build_quest_index(details):
    return [
        {
            "id": d["id"],
            "name": d["name"],
            "cat": d["category"],
            "parent": d["parent"],
            "lv": d["minLevel"],
            "npc": (d["startNpc"] or {}).get("name") or "",
            "exp": d["rewards"]["exp"] or 0,
        }
        for d in details
    ]


def build_item_details(items, kept_monster_ids, map_ids, quest_ids):
    """道具：只收「在開放範圍內拿得到」的——被收錄的怪掉的、開放地圖的商店賣的、
    或收錄任務給的／要的。拿不到的東西列出來只會讓人白找"""
    out = []
    for it in items:
        # 未命名道具：遊戲資料裡沒有名字也沒有圖示（顯示成「未命名道具
        # 4004000」），多半是內部用或未啟用的東西，列出來只是雜訊＋破圖
        if it.get("unnamed"):
            continue
        src = it.get("sources") or {}
        drops = [d for d in (src.get("monsterDrops") or [])
                 if str(d.get("monsterId")) in kept_monster_ids]
        shops = [
            s
            for s in (src.get("shops") or [])
            if any(m.get("id") in map_ids for m in ((s.get("npc") or {}).get("maps") or []))
        ]
        q_rewards = [q for q in (src.get("questRewards") or [])
                     if str(q.get("questId")) in quest_ids]
        q_reqs = [q for q in (src.get("questRequirements") or [])
                  if str(q.get("questId")) in quest_ids]
        # 製作：只留製作 NPC 站在開放地圖上的配方。拆包檔裡 1757 個配方有
        # 八成集中在納希沙漠、路德斯湖那些還沒開的地方，列出來等於叫人去
        # 進不去的城鎮找 NPC
        def craft_open(c):
            return any(
                m.get("id") in map_ids
                for n in (c.get("npcs") or [])
                for m in (n.get("maps") or [])
            )

        def craft_row(c):
            npc = (c.get("npcs") or [{}])[0]
            return {
                "npc": npc.get("name") or "",
                "maps": [
                    m.get("label") or m.get("name") or ""
                    for m in (npc.get("maps") or [])
                    if m.get("id") in map_ids
                ],
                "meso": c.get("meso") or 0,
                "materials": [
                    {"id": mt["id"], "name": mt.get("name") or "",
                     "count": mt.get("count") or 1}
                    for mt in (c.get("materials") or [])
                ],
                "out": {
                    "id": (c.get("primaryOutput") or {}).get("id"),
                    "name": (c.get("primaryOutput") or {}).get("name") or "",
                    "count": (c.get("primaryOutput") or {}).get("count") or 1,
                },
            }

        crafts = [craft_row(c) for c in (src.get("crafts") or []) if craft_open(c)]
        # 這個道具被拿去做什麼（同一個產出只留一筆）
        used_in = {}
        for c in (src.get("craftRequirements") or []):
            if not craft_open(c):
                continue
            prod = c.get("primaryOutput") or {}
            if prod.get("id") and not prod.get("unnamed"):
                used_in[prod["id"]] = {"id": prod["id"], "name": prod.get("name") or ""}

        if not (drops or shops or q_rewards or q_reqs or crafts):
            continue

        equip = it.get("equipStats") or {}
        out.append({
            "id": it["id"],
            "name": it.get("name") or "",
            "desc": (it.get("desc") or "").strip(),
            "cat": it.get("category") or "",
            "sub": it.get("subcategory") or "",
            "sell": it.get("sellPrice") or 0,
            "equip": {k: v for k, v in equip.items()
                      if k not in ("islot", "vslot", "cash") and v},
            "drops": [
                {"id": str(d["monsterId"]), "name": d.get("monsterName") or "",
                 "level": d.get("level")}
                for d in drops
            ],
            "shops": [
                {
                    "npc": (s.get("npc") or {}).get("name") or s.get("merchantName") or "",
                    "price": s.get("price") or 0,
                    "currency": s.get("currency") or "楓幣",
                    "maps": [
                        m.get("label") or m.get("name") or ""
                        for m in ((s.get("npc") or {}).get("maps") or [])
                        if m.get("id") in map_ids
                    ],
                }
                for s in shops
            ],
            "quests": [
                {"id": str(q["questId"]), "name": q.get("questName") or "",
                 "kind": kind, "count": q.get("count") or 0}
                for kind, rows in (("獎勵", q_rewards), ("需求", q_reqs))
                for q in rows
            ],
            "crafts": crafts,
            "usedIn": sorted(used_in.values(), key=lambda x: x["name"]),
        })
    out.sort(key=lambda d: (d["cat"], d["sub"], d["name"]))
    return out


def build_item_index(details):
    return [
        {
            "id": d["id"],
            "name": d["name"],
            "cat": d["cat"],
            "sub": d["sub"],
            "lv": (d["equip"] or {}).get("reqLevel") or 0,
            "sell": d["sell"],
            "from": len(d["drops"]) + len(d["shops"]) + len(d["quests"]) + len(d["crafts"]),
        }
        for d in details
    ]


def build_map_details(maps, map_ids, monster_ids):
    """地圖：小地圖上的標記位置用百分比存，畫面才能隨寬度縮放。
    換算方式是 (座標 + center) / 世界範圍——驗證過所有重生點都會落在圖內；
    miniMap.width/height 記的是世界範圍不是圖檔尺寸，直接拿來當像素會全部歪掉"""
    out = []
    for m in maps:
        if m["id"] not in map_ids:
            continue
        mm = m.get("miniMap") or {}
        has_mini = bool(mm.get("width") and mm.get("height") and m.get("miniMapImage"))

        def pct(v, center, span):
            return round((v + center) / span * 100, 3) if span else None

        spawns = []
        mobs = {}
        for s in m.get("monsterSpawns") or []:
            mid = str(s.get("monsterId"))
            if mid not in mobs:
                mobs[mid] = {
                    "id": mid,
                    "name": s.get("name") or "",
                    "level": s.get("level"),
                    "count": 0,
                    "link": mid in monster_ids,
                }
            mobs[mid]["count"] += 1
            if has_mini and s.get("x") is not None and s.get("y") is not None:
                spawns.append({
                    "id": mid,
                    "x": pct(s["x"], mm["centerX"], mm["width"]),
                    "y": pct(s["y"], mm["centerY"], mm["height"]),
                })

        npcs = [
            {
                "name": n.get("name") or "",
                "x": pct(n["x"], mm["centerX"], mm["width"]) if has_mini else None,
                "y": pct(n["y"], mm["centerY"], mm["height"]) if has_mini else None,
            }
            for n in (m.get("npcSpawns") or [])
            if n.get("x") is not None
        ]

        portals = []
        for p in m.get("portals") or []:
            tid = p.get("targetMapId")
            if not tid or p.get("sameMap"):
                continue  # 同圖內的傳送點對讀者沒有意義，只留跨地圖的
            # targetMapName 有時已經是「區域 / 地圖」的完整格式，再前綴一次
            # 街道名會變成「迷霧森林 / 迷霧森林 / 螞蟻洞Ⅱ」
            t_name = p.get("targetMapName") or ""
            t_street = p.get("targetMapStreet") or ""
            portals.append({
                "id": tid,
                "name": (t_name if (not t_street or t_street in t_name)
                         else f"{t_street} / {t_name}") or f"地圖 {tid}",
                "region": p.get("targetRegionName") or "",
                "link": tid in map_ids,
                "x": pct(p["x"], mm["centerX"], mm["width"]) if has_mini and p.get("x") is not None else None,
                "y": pct(p["y"], mm["centerY"], mm["height"]) if has_mini and p.get("y") is not None else None,
            })
        # 同一張目標地圖可能有好幾個入口，列表只留一筆
        seen = set()
        portals = [p for p in portals if not (p["id"] in seen or seen.add(p["id"]))]

        # 沒有怪物、沒有 NPC、也沒有跨地圖傳送點的地圖，畫面上什麼都給不出來。
        # 這些多半是遊戲內部的隱藏圖（「未命名地圖 910320011」）或測試用的圖
        # （真的有一張就叫「測試」），列出來只是把列表灌水
        if not (mobs or npcs or portals):
            continue

        out.append({
            "id": m["id"],
            "name": m.get("name") or "",
            "street": m.get("street") or "",
            "region": m.get("regionName") or "",
            "hasMini": has_mini,
            "spawns": spawns,
            "mobs": sorted(mobs.values(), key=lambda x: -x["count"]),
            "npcs": npcs,
            "portals": portals,
        })
    out.sort(key=lambda d: (d["region"], d["street"], d["name"]))
    return out


def build_map_index(details):
    return [
        {
            "id": d["id"],
            "name": d["name"],
            "street": d["street"],
            "region": d["region"],
            "mobs": len(d["mobs"]),
            "spawns": sum(x["count"] for x in d["mobs"]),
            "npcs": len(d["npcs"]),
            "portals": len(d["portals"]),
        }
        for d in details
    ]


def build_npc_details(maps, quests, items, map_ids, quest_ids, item_ids):
    """NPC：任務跟商店都掛在 NPC 身上，做了它「這個任務去找誰、他站在哪張圖、
    他賣什麼」才串得起來。只收站在開放地圖上、而且有名字的"""
    npcs = {}
    for m in maps:
        if m["id"] not in map_ids:
            continue
        for n in m.get("npcSpawns") or []:
            if n.get("unnamed") or not n.get("name"):
                continue
            e = npcs.setdefault(
                n["npcId"],
                {"id": n["npcId"], "name": n["name"], "maps": [], "quests": [], "shop": []},
            )
            label = " / ".join(x for x in (m.get("street"), m.get("name")) if x)
            if not any(x["id"] == m["id"] for x in e["maps"]):
                e["maps"].append({
                    "id": m["id"],
                    "label": label or m.get("name") or "",
                    "region": m.get("regionName") or "",
                })

    for q in quests:
        if str(q["id"]) not in quest_ids:
            continue
        for key, role in (("startNpc", "接取"), ("endNpc", "繳交")):
            n = q.get(key) or {}
            e = npcs.get(n.get("id"))
            if not e:
                continue
            row = {"id": str(q["id"]), "name": q.get("name") or "", "role": role}
            if not any(x["id"] == row["id"] and x["role"] == role for x in e["quests"]):
                e["quests"].append(row)

    for it in items:
        if it.get("unnamed") or it["id"] not in item_ids:
            continue
        for s in (it.get("sources") or {}).get("shops") or []:
            npc = s.get("npc") or {}
            e = npcs.get(npc.get("id"))
            if not e or not any(m.get("id") in map_ids for m in (npc.get("maps") or [])):
                continue
            if not any(x["id"] == it["id"] for x in e["shop"]):
                e["shop"].append({
                    "id": it["id"],
                    "name": it.get("name") or "",
                    "price": s.get("price") or 0,
                    "currency": s.get("currency") or "楓幣",
                })

    # 製作 NPC（像易德、辛德）身上沒有商店也沒有任務，但他們能做東西——
    # 不列出來的話那些 NPC 的頁面會是空的，看起來像資料缺漏
    for it in items:
        if it.get("unnamed") or it["id"] not in item_ids:
            continue
        for c in (it.get("sources") or {}).get("crafts") or []:
            for n in c.get("npcs") or []:
                e = npcs.get(n.get("id"))
                if not e or not any(m.get("id") in map_ids for m in (n.get("maps") or [])):
                    continue
                prod = c.get("primaryOutput") or {}
                if not prod.get("id") or prod.get("unnamed"):
                    continue
                e.setdefault("crafts", [])
                if not any(x["id"] == prod["id"] for x in e["crafts"]):
                    e["crafts"].append({
                        "id": prod["id"],
                        "name": prod.get("name") or "",
                        "meso": c.get("meso") or 0,
                    })

    out = list(npcs.values())
    for e in out:
        e.setdefault("crafts", [])
        e["shop"].sort(key=lambda x: x["price"])
        e["quests"].sort(key=lambda x: x["name"])
        e["crafts"].sort(key=lambda x: x["meso"])
    out.sort(key=lambda e: ((e["maps"][0]["region"] if e["maps"] else ""), e["name"]))
    return out


def build_npc_index(details):
    return [
        {
            "id": d["id"],
            "name": d["name"],
            "region": d["maps"][0]["region"] if d["maps"] else "",
            "where": d["maps"][0]["label"] if d["maps"] else "",
            "quests": len(d["quests"]),
            "shop": len(d["shop"]) + len(d["crafts"]),
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
    kept = pick_monsters(monsters_db["monsters"], map_ids)
    if not kept:
        fail("過濾之後一隻怪都不剩，OPEN_REGIONS 是不是打錯了？")

    monster_ids = {str(m["id"]) for m in kept}
    kept_skills = pick_skills(skills_db["skills"])
    skill_ids = {s["id"] for s in kept_skills}
    quest_ids = open_quest_ids(
        quests_db["quests"], map_ids, monster_ids, skill_ids,
        open_job_codes(skills_db),
    )

    # 道具要先算：怪物與任務詳情裡的道具要不要做成連結，取決於那筆道具有沒有
    # 被收錄（未命名道具會被濾掉）。反過來，道具的收錄條件只看怪物／任務／
    # 地圖的成員資格，不需要它們的詳情，所以先算道具不會有循環相依
    items_db = load(src, "items-data.js")
    item_details = build_item_details(items_db["items"], monster_ids, map_ids, quest_ids)
    item_ids = {d["id"] for d in item_details}

    details = [build_detail(m, map_ids, quest_ids, item_ids) for m in kept]

    # 產出
    shutil.rmtree(OUT_DATA, ignore_errors=True)
    os.makedirs(os.path.join(OUT_DATA, "monsters"), exist_ok=True)
    with open(os.path.join(OUT_DATA, "monsters.json"), "w", encoding="utf-8") as f:
        json.dump(build_index(details), f, ensure_ascii=False, separators=(",", ":"))
    for d in details:
        with open(os.path.join(OUT_DATA, "monsters", f"{d['id']}.json"), "w",
                  encoding="utf-8") as f:
            json.dump(d, f, ensure_ascii=False, separators=(",", ":"))

    # 技能（清單在最前面就算好了，任務過濾要用）
    skill_details = [build_skill_detail(s) for s in kept_skills]
    os.makedirs(os.path.join(OUT_DATA, "skills"), exist_ok=True)
    with open(os.path.join(OUT_DATA, "skills.json"), "w", encoding="utf-8") as f:
        json.dump(build_skill_index(skill_details), f, ensure_ascii=False,
                  separators=(",", ":"))
    for d in skill_details:
        with open(os.path.join(OUT_DATA, "skills", f"{d['id']}.json"), "w",
                  encoding="utf-8") as f:
            json.dump(d, f, ensure_ascii=False, separators=(",", ":"))

    # 任務
    skill_names = {s["id"]: s["name"] for s in kept_skills}
    kept_quests = [q for q in quests_db["quests"] if str(q["id"]) in quest_ids]
    quest_details = [
        build_quest_detail(q, map_ids, monster_ids, skill_names, quest_ids, item_ids)
        for q in kept_quests
    ]
    quest_details.sort(key=lambda d: (d["category"], d["minLevel"] or 0, d["name"]))
    os.makedirs(os.path.join(OUT_DATA, "quests"), exist_ok=True)
    with open(os.path.join(OUT_DATA, "quests.json"), "w", encoding="utf-8") as f:
        json.dump(build_quest_index(quest_details), f, ensure_ascii=False, separators=(",", ":"))
    for d in quest_details:
        with open(os.path.join(OUT_DATA, "quests", f"{d['id']}.json"), "w",
                  encoding="utf-8") as f:
            json.dump(d, f, ensure_ascii=False, separators=(",", ":"))

    # NPC
    npc_details = build_npc_details(
        maps_db["maps"], quests_db["quests"], items_db["items"], map_ids, quest_ids, item_ids
    )
    os.makedirs(os.path.join(OUT_DATA, "npcs"), exist_ok=True)
    with open(os.path.join(OUT_DATA, "npcs.json"), "w", encoding="utf-8") as f:
        json.dump(build_npc_index(npc_details), f, ensure_ascii=False, separators=(",", ":"))
    for d in npc_details:
        with open(os.path.join(OUT_DATA, "npcs", f"{d['id']}.json"), "w",
                  encoding="utf-8") as f:
            json.dump(d, f, ensure_ascii=False, separators=(",", ":"))
    # 地圖上的 NPC 記錄沒有圖片路徑，圖只出現在任務與商店那邊的 NPC 物件裡
    npc_ids = {d["id"] for d in npc_details}
    npc_img_paths = {}
    for q in quests_db["quests"]:
        for key in ("startNpc", "endNpc"):
            n = q.get(key) or {}
            if n.get("id") in npc_ids and n.get("image"):
                npc_img_paths[n["id"]] = n["image"]
    for it in items_db["items"]:
        for s in (it.get("sources") or {}).get("shops") or []:
            n = s.get("npc") or {}
            if n.get("id") in npc_ids and n.get("image"):
                npc_img_paths.setdefault(n["id"], n["image"])

    # 地圖
    map_details = build_map_details(maps_db["maps"], map_ids, monster_ids)
    os.makedirs(os.path.join(OUT_DATA, "maps"), exist_ok=True)
    with open(os.path.join(OUT_DATA, "maps.json"), "w", encoding="utf-8") as f:
        json.dump(build_map_index(map_details), f, ensure_ascii=False, separators=(",", ":"))
    for d in map_details:
        with open(os.path.join(OUT_DATA, "maps", f"{d['id']}.json"), "w",
                  encoding="utf-8") as f:
            json.dump(d, f, ensure_ascii=False, separators=(",", ":"))
    map_img_paths = {
        m["id"]: m["miniMapImage"]
        for m in maps_db["maps"]
        if m["id"] in map_ids and m.get("miniMapImage")
    }

    # 道具（清單在最前面就算好了，這裡只負責寫檔）
    os.makedirs(os.path.join(OUT_DATA, "items"), exist_ok=True)
    with open(os.path.join(OUT_DATA, "items.json"), "w", encoding="utf-8") as f:
        json.dump(build_item_index(item_details), f, ensure_ascii=False, separators=(",", ":"))
    for d in item_details:
        with open(os.path.join(OUT_DATA, "items", f"{d['id']}.json"), "w",
                  encoding="utf-8") as f:
            json.dump(d, f, ensure_ascii=False, separators=(",", ":"))
    item_img_paths = {
        i["id"]: i["image"]
        for i in items_db["items"]
        if i.get("image") and i["id"] in item_ids
    }

    # 圖片：怪物本體 + 牠們會掉的道具 + 技能圖示
    shutil.rmtree(OUT_ASSETS, ignore_errors=True)
    mon_imgs = sum(copy_image(src, m.get("image"), os.path.join(OUT_ASSETS, "monsters"))
                   for m in kept)
    item_paths = dict(item_img_paths)
    for m in kept:
        for d in m.get("drops") or []:
            if d.get("image"):
                item_paths[d["id"]] = d["image"]
    item_imgs = sum(copy_image(src, p, os.path.join(OUT_ASSETS, "items"))
                    for p in item_paths.values())
    skill_imgs = sum(copy_image(src, s.get("image"), os.path.join(OUT_ASSETS, "skills"))
                     for s in kept_skills)
    map_imgs = sum(copy_image(src, p, os.path.join(OUT_ASSETS, "maps"))
                   for p in map_img_paths.values())
    npc_imgs = sum(copy_image(src, p, os.path.join(OUT_ASSETS, "npcs"))
                   for p in npc_img_paths.values())

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
    npc_kb = dirsize(os.path.join(OUT_DATA, "npcs")) / 1024
    print(f"NPC        {len(npc_details)} 個"
          f"（索引 {os.path.getsize(os.path.join(OUT_DATA, 'npcs.json')) / 1024:.0f} KB、"
          f"詳情 {npc_kb:.0f} KB、"
          f"有任務或商店 {sum(1 for d in npc_details if d['quests'] or d['shop'])} 個）")
    map_kb = dirsize(os.path.join(OUT_DATA, "maps")) / 1024
    print(f"地圖       {len(map_details)} 張"
          f"（索引 {os.path.getsize(os.path.join(OUT_DATA, 'maps.json')) / 1024:.0f} KB、"
          f"詳情 {map_kb:.0f} KB、有小地圖 {sum(1 for d in map_details if d['hasMini'])} 張）")
    item_kb = dirsize(os.path.join(OUT_DATA, "items")) / 1024
    print(f"道具       {len(item_details)} 個"
          f"（索引 {os.path.getsize(os.path.join(OUT_DATA, 'items.json')) / 1024:.0f} KB、"
          f"詳情 {item_kb:.0f} KB）")
    quest_kb = dirsize(os.path.join(OUT_DATA, "quests")) / 1024
    print(f"任務       {len(quest_details)} 個"
          f"（索引 {os.path.getsize(os.path.join(OUT_DATA, 'quests.json')) / 1024:.0f} KB、"
          f"詳情 {quest_kb:.0f} KB）")
    skill_kb = dirsize(os.path.join(OUT_DATA, "skills")) / 1024
    print(f"技能       {len(kept_skills)} 個"
          f"（索引 {os.path.getsize(os.path.join(OUT_DATA, 'skills.json')) / 1024:.0f} KB、"
          f"詳情 {skill_kb:.0f} KB）")
    print(f"圖片       怪物 {mon_imgs}、道具 {item_imgs}、技能 {skill_imgs}、"
          f"小地圖 {map_imgs}、NPC {npc_imgs} 張，"
          f"共 {dirsize(OUT_ASSETS) / 1024 / 1024:.1f} MB")
    missing = len(kept) - mon_imgs
    if missing:
        print(f"  ⚠ 有 {missing} 隻怪找不到圖片")


if __name__ == "__main__":
    main()
