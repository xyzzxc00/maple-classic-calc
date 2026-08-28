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
import re
import shutil
import sys

# ---------------------------------------------------------------- 開放範圍設定
# 這裡是整個資料庫「顯示什麼」的唯一開關。拆包檔案一律包含尚未開放的內容
# （四轉技能、Lv.120 任務、還沒開的大陸），照單全收會讓站上列出遊戲裡根本
# 進不去的東西——本站一向標榜數字查證過，這個信譽不能為了資料量犧牲。
#
# 2026-08 現況：這四塊，等級上限 100。鯨魚號那 10 張圖沒有怪，但有 NPC，
# 也是世界地圖的一環。之後開新地區，改這裡再重跑就好。
OPEN_REGIONS = {"楓之島", "維多利亞島", "奇幻村", "鯨魚號"}
LEVEL_CAP = 100

# 官方已修正檸檬說明，目前沒有需要額外覆蓋的道具警告。
ITEM_NOTES = {}

# 同名但數值不同的任務專用怪物要標清楚，否則搜尋「鋼之肥肥」時會同時
# 看到一般版 99 EXP 與肥肥村莊版 296 EXP，使用者無法判斷哪筆才是野外怪。
MONSTER_NAME_OVERRIDES = {
    "9300060": "鋼之肥肥（任務版）",
}

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


def monster_name(monster_id, fallback):
    return MONSTER_NAME_OVERRIDES.get(str(monster_id), fallback or "")


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


def open_quest_ids(quests, map_ids, monster_ids, skill_ids, job_open, field_mob_ids):
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
        # 「要打的怪要在收錄範圍」只對野外怪成立。懸賞／教學這類任務要打的
        # 是事件自己生成的副本怪（9 開頭的 ID，不在任何地圖出沒——螞蟻洞
        # 99/999 隻懸賞、楓之島教學、鯨魚號盲俠都是），照野外標準擋會把
        # 遊戲裡明明可解的任務誤殺掉：只擋「有出沒地圖、但全在未開放地區」的
        if any(
            str(m.get("id")) not in monster_ids
            and str(m.get("id")) in field_mob_ids
            for m in (comp.get("monsters") or [])
        ):
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


def trim_map(mp, page_ids):
    # link：這張圖有沒有自己的頁面。開放地區裡有些圖三樣東西（怪物、NPC、
    # 跨圖傳送）都沒有，會在 build_map_details 被丟掉，連過去只會是 404
    return {
        "id": mp["id"],
        "street": mp.get("street") or "",
        "name": mp.get("name") or "",
        "region": mp.get("regionName") or "",
        "spawns": mp.get("spawnCount") or 0,
        "link": mp["id"] in page_ids,
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


def build_detail(m, map_ids, quest_ids, item_ids, map_page_ids):
    """單隻怪的詳情。出沒地圖要再過濾一次——有些怪同時住在開放與未開放地區
    （例如蝴蝶精在維多利亞島也在冰原雪域），只能列出進得去的那些"""
    all_drops = m.get("drops") or []
    drops = [trim_drop(d, item_ids) for d in all_drops if d["id"] in item_ids]
    hidden_drops = len(all_drops) - len(drops)
    maps = [
        trim_map(mp, map_page_ids)
        for mp in (m.get("maps") or [])
        if mp.get("id") in map_ids
    ]
    quests = [
        trim_quest(q)
        for q in (m.get("questRequirements") or [])
        if str(q.get("questId")) in quest_ids
    ]
    meso = m.get("mesoDrop") or {}
    el = m.get("elemental") or {}
    stats = m.get("stats") or {}
    # BOSS 的楓幣數字不能直接用：morris 新版雖補上其他版本伺服器資料表，
    # 仍不是本服實際掉落紀錄；玩家實測沼澤巨鱷／巨居蟹／殭屍猴王都不噴錢
    #（2026-08 巴哈回報）。同一份資料裡的跨版本估值也不一致。
    # 召喚後會消失的怪（noDropReason）同理，本來就不該列這欄。
    # 寧可不顯示，也不要掛一個對不上的數字
    boss = bool(stats.get("boss"))
    no_drop = meso.get("noDropReason") or ""
    meso_out = {
        "min": meso.get("totalMin"),
        "max": meso.get("totalMax"),
        "note": meso.get("sourceLabel") or "",
    }
    if boss or no_drop:
        meso_out = {"min": None, "max": None, "note": "", "unverified": True}
    return {
        "id": m["id"],
        "name": monster_name(m["id"], m["name"]),
        "level": m.get("level"),
        "desc": (m.get("description") or "").strip(),
        "stats": stats,
        "boss": boss,
        "elemental": {"summary": el.get("summary") or "", "values": el.get("values") or {}},
        "meso": meso_out,
        "maps": sorted(maps, key=lambda x: -x["spawns"]),
        # 拆包資料只有「會掉什麼」，沒有掉落率——畫面上不能顯示機率。
        # 未命名道具（遊戲資料裡沒名字沒圖的，顯示成「未命名道具 2040824」）
        # 不列出來——讀者看了也不知道那是什麼，只是雜訊；但筆數要另外標，
        # 不然掉落表看起來像被砍過
        "drops": drops,
        "hiddenDrops": hidden_drops,
        "quests": quests,
    }


# 拆包檔的技能表混了一堆玩家看不到的東西，尤其零轉那一段：騎乘技能、道具
# 潛在技能、2009 年的期間限定活動技能。判斷依據都取客觀訊號，不靠猜：
HANGUL = re.compile(r"[가-힣]")
EXPIRY = re.compile(r"有效(時間|期間)[：:]\s*\d{4}")
# 沒有客觀訊號可以判定、但使用者在遊戲裡確認過不存在的技能。它們的說明、圖示、
# 每級資料都跟正常技能一樣（活動技能的殘留），只能逐一列出來
SKILL_BLOCKLIST = {
    1009,  # 竹竿天擊
    1010,  # 金剛不壞
    1011,  # 地火天爆
    1020,  # 法老的憤怒攻擊（效果是清空金字塔，而金字塔在還沒開放的納希沙漠）
}


def skill_noise(s):
    """回傳排除原因；不該排除就回 None"""
    text = (s.get("description") or "") + (s.get("formula") or "")
    if s.get("id") in SKILL_BLOCKLIST:
        return "遊戲內確認不存在（活動技能殘留）"
    if s.get("maxLevel") is None:
        return "沒有等級上限，資料本身不完整"
    if HANGUL.search(text):
        # 說明還是韓文原文＝這個技能沒有被在地化，也就沒有真的上線
        return "說明未在地化（韓文原文）"
    if "[道具潛在技能]" in text:
        return "道具潛在技能，不是角色學得到的技能"
    if EXPIRY.search(text):
        return "帶到期日的期間限定活動技能"
    return None


def pick_skills(skills):
    return [
        s
        for s in skills
        if s.get("jobGroup") in OPEN_SKILL_GROUPS
        and s.get("advancement") not in CLOSED_ADVANCEMENTS
        and not skill_noise(s)
    ]


SKILL_REQ = re.compile(r"所需技能[：:]\s*(.+?)\s*(\d+)\s*等級以上")


def skill_req(desc):
    """從說明文字裡撈前置技能需求（「所需技能：劍技專精5等級以上」）。

    只留文字不做技能連結：說明裡用的是另一套譯名（「劍技專精」對應資料裡
    的「精準之劍」），沒有可靠的對應表，硬猜會連錯。前端只用它顯示需求、
    以及判斷這招要不要縮排成「後續技能」"""
    m = SKILL_REQ.search(desc or "")
    return {"name": m.group(1).strip(), "level": int(m.group(2))} if m else None


def build_skill_detail(s):
    """技能詳情：留說明、公式、每一級的數值。levels 的 description 是遊戲原文
    （每級一句），保留原文比自己組句子安全"""
    desc = (s.get("description") or "").strip()
    return {
        "id": s["id"],
        "name": s["name"],
        "group": s.get("jobGroup") or "",
        "job": s.get("jobName") or "",
        "adv": s.get("advancement") or "",
        "maxLevel": s.get("maxLevel"),
        "desc": desc,
        "req": skill_req(desc),
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
    """前置需求的技能名解析自說明原文，那裡用的是另一套譯名——有些對得上
    本站的技能名（可以連結），有些對不上（例如「劍技專精」其實是「精準之
    劍」）。只在「同職業內剛好唯一命中」時才給 id，其餘留純文字，寧可少連
    也不要連錯"""
    by_job = {}
    for d in details:
        by_job.setdefault((d["job"], d["name"]), []).append(d["id"])
    by_group = {}
    for d in details:
        by_group.setdefault((d["group"], d["name"]), []).append(d["id"])

    out = []
    for d in details:
        req = dict(d["req"]) if d["req"] else None
        if req:
            for table, key in ((by_job, d["job"]), (by_group, d["group"])):
                hits = table.get((key, req["name"]))
                if hits and len(hits) == 1:
                    req["id"] = hits[0]
                    break
                if hits:
                    break  # 多重候選，寧可不連
        out.append({
            "id": d["id"],
            "name": d["name"],
            "group": d["group"],
            "job": d["job"],
            "adv": d["adv"],
            "maxLevel": d["maxLevel"],
            # 職業技能總覽頁要用：說明摘要、消耗/效果欄位名、前置需求
            "desc": strip_head(d["desc"]),
            "labels": list((d["labels"] or {}).values()),
            "req": req,
        })
    return out


def strip_head(desc):
    """技能說明開頭都有「[最高等級：20] 」，卡片上已經另外顯示最高等級了，
    去掉重複；結尾的 # 與跳脫符號也一併清掉"""
    # 兩種寫法都有：「[最高等級：20]」與「[等級上限：20]」
    out = re.sub(r"^\[(?:最高等級|等級上限)\s*[：:]\s*\d+\]\s*", "", desc or "")
    out = re.sub(r"所需技能[：:].*$", "", out)
    return out.replace("\\#", "").replace("#", "").strip()


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
                "name": monster_name(r["id"], r.get("name")),
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

    def gives(reward_block):
        return [r for r in (reward_block.get("items") or [])
                if r.get("action") != "remove"]

    start = q.get("startRequirements") or {}
    comp = q.get("completeRequirements") or {}
    rw = q.get("completeRewards") or {}
    srw = q.get("startRewards") or {}
    nxt = q.get("nextQuest")
    consumed = {r["id"] for r in (rw.get("items") or []) if r.get("action") == "remove"}
    consumed |= {r["id"] for r in (comp.get("items") or [])}
    start_gives = [r for r in gives(srw) if r["id"] not in consumed]
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
            # action=="remove" 是完成時從玩家身上收走的材料（跟完成條件同一批
            # 東西），不是獎勵——列進來會讓「收走三樣、給一樣」的任務看起來
            # 獎勵超多。另一種是跑腿任務：接取時給你一封信、繳交時收走，
            # 這種「接取給、結尾收」的過場道具也不算獎勵。來源資料偶爾還會
            # 把採集物標成 give 塞在獎勵裡（粉紅花籃的「粉紅花×1」、count 0
            # 的信），一律用「同時是完成條件的道具不算獎勵」擋掉
            "items": items([r for r in gives(rw) if r["id"] not in consumed])
                     + items(start_gives),
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


def build_quest_index(details, mark_of):
    """mark_of：地圖 id → 城鎮徽章代碼。任務的「城鎮」取接取 NPC 所站的
    第一張開放地圖；接取 NPC 不在開放地圖就退回繳交 NPC，再不行歸「其他」"""
    out = []
    for d in details:
        mark = "Other"
        for npc in (d["startNpc"], d["endNpc"]):
            maps = (npc or {}).get("maps") or []
            if maps:
                mark = mark_of.get(maps[0]["id"], "Other")
                break
        out.append({
            "id": d["id"],
            "name": d["name"],
            "cat": d["category"],
            "parent": d["parent"],
            "lv": d["minLevel"],
            "npc": (d["startNpc"] or {}).get("name") or "",
            "exp": d["rewards"]["exp"] or 0,
            "mark": mark,
        })
    return out


GACHA_ARCHIVE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "gacha_archive.json")
ICON_OVERRIDES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "icon_overrides")


def load_gacha_pools(src):
    """轉蛋收錄清單：合併「來源目前掛的池子」與 repo 裡的歷史檔。

    政策（2026-08-22 與站長確認）：資料庫只收拿得到的，官方轉蛋池出現過的
    道具算拿得到——活動下檔後玩家背包裡的還在，資料庫要答得出「這是什麼」，
    所以出現過就永久收錄。來源檔 gacha-simulator-data.js 是 morris 抓官方
    beanfun 活動 API 產的，只含「進行中」的活動；歷史靠 tools/
    gacha_archive.json（進版控）累積，活動結束後重匯道具才不會消失。

    只收 kind == "standardGachapon"（遊戲內道具的轉蛋機）。彗星兌換（現金
    時裝）與皇家美容院（髮型臉型，不是背包道具）站長決定不收；未來要收
    再放寬這個過濾。
    """
    archive = {"pools": []}
    if os.path.exists(GACHA_ARCHIVE):
        with open(GACHA_ARCHIVE, encoding="utf-8") as f:
            archive = json.load(f)
    by_id = {p["id"]: p for p in archive.get("pools") or []}
    if os.path.exists(os.path.join(src, "gacha-simulator-data.js")):
        data = load(src, "gacha-simulator-data.js")
        for p in data.get("pools") or []:
            if p.get("kind") != "standardGachapon":
                continue
            items = sorted({x["itemId"] for x in (p.get("prizes") or []) if x.get("itemId")})
            if not items:
                continue
            by_id[p["id"]] = {
                "id": p["id"],
                "name": p.get("name") or "轉蛋機",
                "period": p.get("period") or "",
                "items": items,
            }
    else:
        print("  ⚠ 來源沒有 gacha-simulator-data.js，轉蛋收錄沿用歷史檔")
    pools = sorted(by_id.values(), key=lambda p: (p.get("period") or "", p["id"]))
    with open(GACHA_ARCHIVE, "w", encoding="utf-8") as f:
        json.dump({"pools": pools}, f, ensure_ascii=False, indent=1)
        f.write("\n")
    return pools


def build_item_details(items, kept_monster_ids, map_ids, quest_ids, gacha_of=None):
    """道具：只收「在開放範圍內拿得到」的——被收錄的怪掉的、開放地圖的商店賣的、
    收錄任務給的／要的，或官方轉蛋池出現過的。拿不到的東西列出來只會讓人白找"""
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

        def is_catalyst_craft(c):
            # Morris 的「可使用催化劑合成」不是指所有 NPC 製作；只有配方
            # requirements 裡明確標成「催化材料」的強化合成才會讓成品能力
            # 浮動。一般冶煉／換色／NPC 製作仍是基準值。
            return any(
                req.get("role") == "催化材料"
                for req in (c.get("requirements") or [])
            )

        def craft_row(c):
            npc = (c.get("npcs") or [{}])[0]
            row = {
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
            if is_catalyst_craft(c):
                row["catalyst"] = True
            return row

        open_crafts = [c for c in (src.get("crafts") or []) if craft_open(c)]
        crafts = [craft_row(c) for c in open_crafts]
        gacha = (gacha_of or {}).get(it["id"]) or []
        # 這個道具被拿去做什麼（同一個產出只留一筆）
        used_in = {}
        for c in (src.get("craftRequirements") or []):
            if not craft_open(c):
                continue
            prod = c.get("primaryOutput") or {}
            if prod.get("id") and not prod.get("unnamed"):
                used_in[prod["id"]] = {"id": prod["id"], "name": prod.get("name") or ""}

        if not (drops or shops or q_rewards or q_reqs or crafts or gacha):
            continue

        equip = it.get("equipStats") or {}

        # 裝備數值浮動：Morris 依遊戲基準能力與可浮動來源整理出的
        # equipStatRanges／equipStatRangeSources。範圍不能只看「這件裝備有沒有
        # 製作配方」：一般 NPC 製作是固定基準值，只有怪物掉落或明確帶
        # 「催化材料」的強化合成才浮動，而且來源還必須位於本站已開放範圍。
        #
        # 2026-08-07~12 教訓：先前這裡是用「反推公式」（Δ = ceil(基準/10)，
        # 武器封頂 ±5）——反推來源是參考網站當時*顯示出來*的範圍，不是原始
        # 資料。事後比對 morris 拆包本身的 equipStatRanges 才發現公式錯了：
        # 武器物攻/魔攻真正的封頂是 ±7、且係數多 +1（Δ = min(ceil(基準/10)+1,
        # 7)），全站 90 件武器、180 個欄位當時全部算錯。直接讀原始欄位可以
        # 徹底避免這種「反推公式錯了都不知道」的風險，以後拆包只要更新，
        # 這裡自動跟著對，不用再猜規律。
        raw_rng = it.get("equipStatRanges") or {}
        raw_range_sources = set(it.get("equipStatRangeSources") or [])
        float_from = []
        if drops and "怪物掉落" in raw_range_sources:
            float_from.append("怪物掉落")
        if (any(is_catalyst_craft(c) for c in open_crafts)
                and "可使用催化劑合成" in raw_range_sources):
            float_from.append("使用催化劑合成")
        float_rng = {}
        if equip and float_from:
            for k, v in raw_rng.items():
                mn, mx = v.get("min"), v.get("max")
                if isinstance(mn, (int, float)) and isinstance(mx, (int, float)):
                    float_rng[k] = [int(mn), int(mx)]

        out.append({
            "id": it["id"],
            "name": it.get("name") or "",
            "desc": (it.get("desc") or "").strip(),
            "note": ITEM_NOTES.get(it["id"], ""),
            "cat": it.get("category") or "",
            "sub": it.get("subcategory") or "",
            "sell": it.get("sellPrice") or 0,
            "equip": {k: v for k, v in equip.items()
                      if k not in ("islot", "vslot", "cash") and v},
            "float": float_rng,
            "floatFrom": float_from if float_rng else [],
            "drops": [
                {"id": str(d["monsterId"]),
                 "name": monster_name(d["monsterId"], d.get("monsterName")),
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
        # 轉蛋來源只有一小部分道具有，不塞空欄位進其他一千多個檔
        if gacha:
            out[-1]["gacha"] = gacha
    out.sort(key=lambda d: (d["cat"], d["sub"], d["name"]))
    return out


def build_item_index(details):
    # job 是職業限制的 bitmask（1 劍士／2 法師／4 弓箭手／8 盜賊／16 海盜，
    # 0 或缺欄位＝全職業可穿）。放進索引才能在列表直接篩職業，不用逐筆抓詳情
    return [
        {
            "id": d["id"],
            "name": d["name"],
            "cat": d["cat"],
            "sub": d["sub"],
            "lv": (d["equip"] or {}).get("reqLevel") or 0,
            "job": (d["equip"] or {}).get("reqJob") or 0,
            "sell": d["sell"],
            "from": len(d["drops"]) + len(d["shops"]) + len(d["quests"]) + len(d["crafts"])
                    + len(d.get("gacha") or []),
        }
        for d in details
    ]


def pair_same_portals(entries, mm):
    """同圖傳送的配對編號。entries 是 [(輸出的 portal dict, 來源 portal), …]。

    來源的 sameMapTarget 記著這顆傳過去的落點座標，雙向一對會互指。配好
    組別（`group` 同號＝互通、`two`＝雙向）前端才畫得出「哪個通哪個」——
    村莊常一次好幾組長一樣的傳送點，沒編號分不出來（玩家回饋）。單向的
    （例如弓箭手村跳上樹屋的 up00）另帶 `tx`/`ty` 落點百分比，前端畫虛線
    落點。沒有 sameMapTarget 的照舊不標號。組號照 x 座標由左到右。"""

    def pct(v, center, span):
        return round((v + center) / span * 100, 3) if span else None

    entries = sorted(entries, key=lambda t: (t[1].get("x") or 0, t[1].get("y") or 0))
    used = set()
    group = 0
    for i, (out, p) in enumerate(entries):
        if i in used:
            continue
        t = p.get("sameMapTarget") or {}
        if t.get("x") is None:
            continue
        group += 1
        partner = None
        for j, (out2, q) in enumerate(entries):
            if j == i or j in used:
                continue
            qt = q.get("sameMapTarget") or {}
            if (q.get("x"), q.get("y")) == (t.get("x"), t.get("y")) and \
               (qt.get("x"), qt.get("y")) == (p.get("x"), p.get("y")):
                partner = j
                break
        out["group"] = group
        used.add(i)
        if partner is not None:
            out["two"] = True
            entries[partner][0]["group"] = group
            entries[partner][0]["two"] = True
            used.add(partner)
        else:
            out["two"] = False
            out["tx"] = pct(t["x"], mm["centerX"], mm["width"])
            out["ty"] = pct(t["y"], mm["centerY"], mm["height"])


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
                    "name": monster_name(mid, s.get("name")),
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
            # 沒有名字的 NPC（隱藏觸發器之類，顯示成「NPC 9050009」）是雜訊
            if n.get("x") is not None and not n.get("unnamed") and n.get("name")
        ]

        # 傳送點分兩種：跨地圖（通往別張圖）與同地圖（同一張圖裡的上下樓梯、
        # 傳送台）。同地圖的對「這張圖長怎樣」還是有意義，畫在圖上但用不同
        # 顏色，跟跨地圖的分開
        portals = []
        seen = set()
        same_entries = []
        for p in m.get("portals") or []:
            tid = p.get("targetMapId")
            same = bool(p.get("sameMap"))
            if not tid and not same:
                continue
            # targetMapName 有時已經是「區域 / 地圖」的完整格式，再前綴一次
            # 街道名會變成「迷霧森林 / 迷霧森林 / 螞蟻洞Ⅱ」
            t_name = p.get("targetMapName") or ""
            t_street = p.get("targetMapStreet") or ""
            key = ("same", p.get("x"), p.get("y")) if same else ("to", tid)
            # 跨地圖：同一張目標圖有好幾個入口只留一筆；同地圖：按座標去重
            if key in seen:
                continue
            seen.add(key)
            portals.append({
                "id": tid,
                "same": same,
                "name": (t_name if (not t_street or t_street in t_name)
                         else f"{t_street} / {t_name}") or (f"地圖 {tid}" if tid else "同圖傳送"),
                "region": p.get("targetRegionName") or "",
                "link": bool(tid) and tid in map_ids and not same,
                "x": pct(p["x"], mm["centerX"], mm["width"]) if has_mini and p.get("x") is not None else None,
                "y": pct(p["y"], mm["centerY"], mm["height"]) if has_mini and p.get("y") is not None else None,
            })
            if same and has_mini and p.get("x") is not None:
                same_entries.append((portals[-1], p))
        if same_entries:
            pair_same_portals(same_entries, mm)

        # 沒有怪物、沒有 NPC、也沒有跨地圖傳送點的地圖，畫面上什麼都給不出來。
        # 這些多半是遊戲內部的隱藏圖（「未命名地圖 910320011」）或測試用的圖
        # （真的有一張就叫「測試」），列出來只是把列表灌水
        if not (mobs or npcs or portals):
            continue

        # 零星的徽章代碼（"2"、空值）併進 Other，前端顯示成「其他」
        mark = m.get("markKey") or ""
        if not mark or mark in ("2",):
            mark = "Other"

        out.append({
            "id": m["id"],
            "name": m.get("name") or "",
            "street": m.get("street") or "",
            "region": m.get("regionName") or "",
            "mark": mark,
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
            # markKey 是每張圖攜帶的城鎮徽章代碼（Henesys、Perion…），拿來做
            # 「依城鎮分組」的瀏覽視圖——street 欄位太粗（維多利亞島 138 張的
            # street 都叫「維多利亞」），只有徽章分得出弓箭手村跟勇士之村
            "mark": d["mark"],
            "mobs": len(d["mobs"]),
            "spawns": sum(x["count"] for x in d["mobs"]),
            "npcs": len(d["npcs"]),
            "portals": sum(1 for p in d["portals"] if not p["same"]),
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


def build_world_maps(worldmaps_db, map_page_ids):
    """世界地圖：四塊區域各一張手繪大圖，圖上的節點連到單張地圖的頁面。

    來源資料的節點座標已經是百分比，跟小地圖同一套定位方式。
    「子地圖」（worldSubMap，像地鐵一號線的 16 個分層）在世界地圖上跟主圖
    疊在同一個點，全部畫出來只會擠成一團，不畫——反正點進主圖後靠傳送點
    就能一路走。碰到子地圖的連線也一起略過，跨區的連線由 proxy 節點代替
    （畫成「前往◯◯」的按鈕，點了切到那塊區域）"""
    order = {"楓之島": 0, "維多利亞島": 1, "奇幻村": 2, "鯨魚號": 3}
    out = []
    for r in worldmaps_db["worldMaps"]["regions"]:
        if r["name"] not in order:
            continue
        nodes = []
        for n in r.get("nodes") or []:
            if n.get("unnamed") or n.get("worldSubMap"):
                continue
            nodes.append({
                "id": str(n["mapId"]),
                "name": n.get("name") or "",
                "street": n.get("street") or "",
                "x": n["x"],
                "y": n["y"],
                "link": n["mapId"] in map_page_ids,
            })
        kept_ids = {n["id"] for n in nodes}
        edges = [
            [e["from"], e["to"]]
            for e in (r.get("edges") or [])
            if not e.get("cross") and e["from"] in kept_ids and e["to"] in kept_ids
        ]
        out.append({
            "key": r["key"],
            "name": r["name"],
            "w": r.get("imageWidth"),
            "h": r.get("imageHeight"),
            "nodes": nodes,
            "edges": edges,
            "proxies": [
                {
                    "region": p["targetRegionKey"],
                    "name": p.get("targetRegionName") or "",
                    "x": p["x"],
                    "y": p["y"],
                }
                for p in (r.get("proxyNodes") or [])
            ],
        })
    out.sort(key=lambda r: order[r["name"]])
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
            "img": d["img"],
        }
        for d in details
    ]


def build_index(details):
    """列表用的索引。怪物列表是表格式（可依欄位排序、依屬性弱點篩選），
    主要戰鬥數值都要進索引；整包仍只有十幾 KB"""
    out = []
    for d in details:
        st = d["stats"] or {}
        vals = (d["elemental"] or {}).get("values") or {}
        out.append({
            "id": d["id"],
            "name": d["name"],
            "level": d["level"],
            "hp": st.get("maxHP"),
            "mp": st.get("maxMP"),
            "exp": st.get("exp"),
            "pad": st.get("PADamage"),
            "mad": st.get("MADamage"),
            "pdd": st.get("PDDamage"),
            "mdd": st.get("MDDamage"),
            "acc": st.get("acc"),
            # 迴避同時給獨立版命中計算機用——選了怪要立即算，不能等詳情檔
            "eva": st.get("eva"),
            "undead": 1 if st.get("undead") else 0,
            # BOSS 旗標給列表的快速篩選用（詳情也有一份，那邊決定楓幣怎麼呈現）
            "boss": 1 if d.get("boss") else 0,
            "el": d["elemental"]["summary"],
            # 弱點元素清單（fire/ice/lightning/poison/holy），給快速篩選用
            "weak": sorted(k for k, v in vals.items() if v == "weak"),
            "maps": len(d["maps"]),
            "drops": len(d["drops"]),
            "regions": sorted({mp["region"] for mp in d["maps"] if mp["region"]}),
        })
    return out


# ------------------------------------------------------------------ 圖片搬運


def copy_image(src_root, rel_path, dest_dir, dest_name=None):
    """來源記錄裡的路徑長這樣：./assets/items/1002067.png

    dest_name 沒給的話用來源檔名——這對絕大多數東西沒差，因為來源檔名本來
    就跟自己的 ID 一樣。但活動/副本生成的怪物變體（例如月妙獎勵地圖的鋼豬，
    ID 是 9300060）會共用基礎怪物的美術檔（圖檔名是 4230103.png），檔名跟
    自己的 ID 對不上；前端固定用 assets/db/monsters/<id>.png 找圖，用來源
    檔名存的話這種怪物就會顯示破圖。呼叫端知道「這張圖是給誰用的」，所以
    monsters 這條路徑會明確帶 dest_name=f"{id}.png"。
    """
    if not rel_path:
        return False
    src = os.path.join(src_root, rel_path.lstrip("./").replace("/", os.sep))
    if not os.path.exists(src):
        return False
    os.makedirs(dest_dir, exist_ok=True)
    shutil.copy2(src, os.path.join(dest_dir, dest_name or os.path.basename(src)))
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
    field_mob_ids = {str(m["id"]) for m in monsters_db["monsters"] if m.get("maps")}
    quest_ids = open_quest_ids(
        quests_db["quests"], map_ids, monster_ids, skill_ids,
        open_job_codes(skills_db), field_mob_ids,
    )

    # 道具要先算：怪物與任務詳情裡的道具要不要做成連結，取決於那筆道具有沒有
    # 被收錄（未命名道具會被濾掉）。反過來，道具的收錄條件只看怪物／任務／
    # 地圖的成員資格，不需要它們的詳情，所以先算道具不會有循環相依
    items_db = load(src, "items-data.js")
    # 官方轉蛋池出現過的道具視為「拿得到」，納入收錄（詳見 load_gacha_pools）
    gacha_pools = load_gacha_pools(src)
    gacha_of = {}
    for p in gacha_pools:
        for iid in p["items"]:
            gacha_of.setdefault(iid, []).append({"pool": p["name"], "period": p["period"]})
    item_details = build_item_details(items_db["items"], monster_ids, map_ids, quest_ids, gacha_of)
    item_ids = {d["id"] for d in item_details}

    # 地圖詳情要先算：怪物的出沒地圖能不能點進去，取決於那張圖最後有沒有
    # 留下頁面。地圖只吃 map_ids 與 monster_ids，不需要怪物詳情，不會循環
    map_details = build_map_details(maps_db["maps"], map_ids, monster_ids)
    map_page_ids = {d["id"] for d in map_details}

    details = [build_detail(m, map_ids, quest_ids, item_ids, map_page_ids) for m in kept]

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
        mark_of = {m["id"]: (m.get("markKey") if m.get("markKey") not in (None, "", "2") else "Other")
                   for m in maps_db["maps"]}
        json.dump(build_quest_index(quest_details, mark_of), f,
                  ensure_ascii=False, separators=(",", ":"))
    for d in quest_details:
        with open(os.path.join(OUT_DATA, "quests", f"{d['id']}.json"), "w",
                  encoding="utf-8") as f:
            json.dump(d, f, ensure_ascii=False, separators=(",", ":"))

    # NPC
    npc_details = build_npc_details(
        maps_db["maps"], quests_db["quests"], items_db["items"], map_ids, quest_ids, item_ids
    )
    # NPC 頭像：任務與商店來源物件帶的路徑優先，沒帶的退一步直接找
    # assets/npcs/<id>.png——來源資料常常沒把圖掛在物件上、檔案卻存在
    # （1012002 就是這樣漏掉的）。約半數 NPC 拆包裡真的沒有頭像，把有無
    # 寫進 `img` 旗標讓前端畫文字頭像佔位，不要留一個看起來像壞掉的空框
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
    for nid in npc_ids:
        if nid not in npc_img_paths and \
           os.path.exists(os.path.join(src, "assets", "npcs", f"{nid}.png")):
            npc_img_paths[nid] = f"./assets/npcs/{nid}.png"
    for d in npc_details:
        d["img"] = d["id"] in npc_img_paths
    os.makedirs(os.path.join(OUT_DATA, "npcs"), exist_ok=True)
    with open(os.path.join(OUT_DATA, "npcs.json"), "w", encoding="utf-8") as f:
        json.dump(build_npc_index(npc_details), f, ensure_ascii=False, separators=(",", ":"))
    for d in npc_details:
        with open(os.path.join(OUT_DATA, "npcs", f"{d['id']}.json"), "w",
                  encoding="utf-8") as f:
            json.dump(d, f, ensure_ascii=False, separators=(",", ":"))

    # 商店總覽頁：把有賣東西（含製作）的 NPC 彙整成一個檔，依地區排。
    # 這頁是「全部商店在賣什麼」的瀏覽入口，跟單一 NPC 頁互補
    shops = [
        {
            "id": d["id"],
            "name": d["name"],
            "region": d["maps"][0]["region"] if d["maps"] else "",
            "where": d["maps"][0]["label"] if d["maps"] else "",
            "img": d["img"],
            "items": d["shop"],
            "crafts": d["crafts"],
        }
        for d in npc_details
        if d["shop"] or d["crafts"]
    ]
    shops.sort(key=lambda s: (s["region"], s["where"], s["name"]))
    with open(os.path.join(OUT_DATA, "shops.json"), "w", encoding="utf-8") as f:
        json.dump(shops, f, ensure_ascii=False, separators=(",", ":"))

    # 地圖（詳情在最前面就算好了，怪物的出沒地圖連結要用）
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

    # 城鎮徽章圖路徑（依城鎮分組的瀏覽視圖用）；實際搬運在下面圖片區段，
    # 要排在 OUT_ASSETS 的 rmtree 之後
    mark_img_paths = {}
    for m in maps_db["maps"]:
        if m["id"] in map_ids and m.get("markKey") and m.get("markImage"):
            mark_img_paths.setdefault(m["markKey"], m["markImage"])

    # 世界地圖
    worldmaps_db = load(src, "worldmaps-data.js")
    world_regions = build_world_maps(worldmaps_db, map_page_ids)
    with open(os.path.join(OUT_DATA, "worldmaps.json"), "w", encoding="utf-8") as f:
        json.dump(world_regions, f, ensure_ascii=False, separators=(",", ":"))
    world_img_paths = {
        r["key"]: r.get("image")
        for r in worldmaps_db["worldMaps"]["regions"]
        if r.get("image") and any(w["key"] == r["key"] for w in world_regions)
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
    mon_imgs = sum(copy_image(src, m.get("image"), os.path.join(OUT_ASSETS, "monsters"),
                              f"{m['id']}.png")
                   for m in kept)
    item_paths = dict(item_img_paths)
    for m in kept:
        for d in m.get("drops") or []:
            if d.get("image"):
                item_paths[d["id"]] = d["image"]
    # 資料物件沒帶圖片路徑、但來源其實有同名檔的：直接補。兩個來源——
    # 收錄道具本身，以及任務詳情的條件/獎勵晶片（那些道具不一定被收錄，
    # 但前端會嘗試載圖；來源沒檔的前端會把 <img> 拿掉、顯示純文字晶片）
    quest_item_refs = set()
    for qd in quest_details:
        for i in ((qd.get("start") or {}).get("items") or []) \
               + ((qd.get("complete") or {}).get("items") or []) \
               + ((qd.get("rewards") or {}).get("items") or []):
            if i.get("id"):
                quest_item_refs.add(i["id"])
    for iid in set(item_ids) | quest_item_refs:
        if iid not in item_paths and \
           os.path.exists(os.path.join(src, "assets", "items", f"{iid}.png")):
            item_paths[iid] = f"./assets/items/{iid}.png"
    item_imgs = sum(copy_image(src, p, os.path.join(OUT_ASSETS, "items"))
                    for p in item_paths.values())
    skill_imgs = sum(copy_image(src, s.get("image"), os.path.join(OUT_ASSETS, "skills"))
                     for s in kept_skills)
    map_imgs = sum(copy_image(src, p, os.path.join(OUT_ASSETS, "maps"))
                   for p in map_img_paths.values())
    sum(copy_image(src, p, os.path.join(OUT_ASSETS, "marks"))
        for k, p in mark_img_paths.items() if k != "2")
    npc_imgs = sum(copy_image(src, p, os.path.join(OUT_ASSETS, "npcs"))
                   for p in npc_img_paths.values())
    world_imgs = sum(copy_image(src, p, os.path.join(OUT_ASSETS, "worldmaps"))
                     for p in world_img_paths.values())

    # 圖示人工校正：morris 拆包有少數圖檔「檔名對、內容錯」（例如玫瑰椅
    # 拿到紅沙發圖、蘑菇友情椅子拿到玫瑰椅的王座圖），他自己網站也一樣錯，
    # 上游修不了。確認過的正確圖（來源 maplestory.io，WZ 直出）放在
    # tools/icon_overrides/<類別>/<id>.png，最後蓋回去——一定要排在所有
    # 複製之後，重跑匯入修正才不會消失
    n_over = 0
    if os.path.isdir(ICON_OVERRIDES):
        for kind in os.listdir(ICON_OVERRIDES):
            kdir = os.path.join(ICON_OVERRIDES, kind)
            if not os.path.isdir(kdir):
                continue
            os.makedirs(os.path.join(OUT_ASSETS, kind), exist_ok=True)
            for fn in os.listdir(kdir):
                if fn.endswith(".png"):
                    shutil.copy2(os.path.join(kdir, fn), os.path.join(OUT_ASSETS, kind, fn))
                    n_over += 1
    if n_over:
        print(f"圖示校正   覆蓋 {n_over} 張（tools/icon_overrides/，morris 原圖錯位的人工修正）")

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
    print(f"世界地圖   {len(world_regions)} 塊區域"
          f"（{os.path.getsize(os.path.join(OUT_DATA, 'worldmaps.json')) / 1024:.0f} KB、"
          f"節點 {sum(len(r['nodes']) for r in world_regions)}、"
          f"連線 {sum(len(r['edges']) for r in world_regions)}）")
    print(f"圖片       怪物 {mon_imgs}、道具 {item_imgs}、技能 {skill_imgs}、"
          f"小地圖 {map_imgs}、NPC {npc_imgs}、世界地圖 {world_imgs} 張，"
          f"共 {dirsize(OUT_ASSETS) / 1024 / 1024:.1f} MB")
    missing = len(kept) - mon_imgs
    if missing:
        print(f"  ⚠ 有 {missing} 隻怪找不到圖片")


if __name__ == "__main__":
    main()
