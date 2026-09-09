"""Render the El Nath preview guide from the imported, isolated preview dataset.

Run after tools/import_el_nath.py: py -3 tools/build_el_nath_guide.py
Use --check to validate the committed page without writing it. No network access.

Data audit (2026-09-09): game data 1.14.7. Instructor
identities come from quests 6900/6910/6920/6930/6940, which are FOURTH-job
quests, not third-job procedures. Map geometry absent from the dump stays
unknown. MonsterBook associations do not establish spawn counts or routes.
Association provenance is distinct from drop-rate provenance. Only an explicit
source=tmsv113 on the map/mob or item/drop relation earns the cross-version
label; a tmsv113 entry inside dropRates must never relabel that relation.
Official status was checked through beanfun's public BulletinDetail endpoint:
82595 still states second job / level 100; 82615 only changes maintenance time.
Version/date/counts below always come from the generated preview manifest.
"""

import argparse
from collections import defaultdict
from functools import lru_cache
import hashlib
from html import escape
from html.parser import HTMLParser
import json
from pathlib import Path
import re
from urllib.parse import parse_qs, urlsplit


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "preview" / "el-nath"
OUTPUT = ROOT / "guides" / "third-job-el-nath" / "index.html"
BASE = "https://mapleclassictools.com"
PAGE_URL = BASE + "/guides/third-job-el-nath/"
TITLE = "三轉與冰原雪域資料預覽：職業技能、地圖、怪物與補給"
DESCRIPTION = "新楓之谷經典版三轉與天空之城、冰原雪域、廢礦資料預覽。整理技能逐級資料、怪物屬性與掉落、地圖索引、NPC商店及任務；拆包存在不代表正式開放。"
OFFICIAL_DATE = "2026-09-09"
OFFICIAL_STATUS = "https://maplestoryclassic.beanfun.com/bulletin?Bid=82595"
OFFICIAL_MAINTENANCE = "https://maplestoryclassic.beanfun.com/bulletin?Bid=82615"
THEME_BUTTON = '<button class="theme-toggle" id="themeToggle" type="button">暗色</button>\n'
KINDS = {"monster": "monsters", "map": "maps", "item": "items",
         "npc": "npcs", "quest": "quests", "skill": "skills"}
# Names and IDs are read from the preview; this only maps an audited instructor
# identity to the corresponding original Explorer job family.
INSTRUCTORS = {"冒險家劍士": 2020008, "冒險家法師": 2020009,
               "冒險家弓箭手": 2020010, "冒險家盜賊": 2020011,
               "冒險家海盜": 2020013}
GROUPS = ("天空之城與雲彩公園", "天空之塔", "冰原雪域與雪山", "廢礦與炎魔關聯地圖")
STAT_NAMES = {"incPAD": "物攻", "incMAD": "魔攻", "incSTR": "力量",
              "incDEX": "敏捷", "incINT": "智力", "incLUK": "幸運",
              "incPDD": "物防", "incMDD": "魔防", "incMHP": "HP",
              "incMMP": "MP", "incACC": "命中", "incEVA": "迴避",
              "incSpeed": "移速", "incJump": "跳躍", "tuc": "可衝卷次數"}


def esc(value):
    return escape(str(value), quote=True)


def number(value):
    if value is None:
        return "未提供"
    return f"{value:,}" if isinstance(value, (int, float)) else esc(value)


def load(name):
    return json.loads((DATA / name).read_text(encoding="utf-8"))


@lru_cache(maxsize=None)
def detail(kind, identifier):
    return load(f"{KINDS[kind]}/{identifier}.json")


def link(kind, identifier, label):
    return (f'<a href="../../?preview=el-nath&amp;db={kind}&amp;id={esc(identifier)}">'
            f'{esc(label)}</a>')


def linked_record(kind, record, ids):
    label = record.get("name") or record.get("label") or str(record.get("id", "未提供"))
    identifier = str(record.get("id"))
    return link(kind, identifier, label) if identifier in ids[kind] else esc(label)


def section_link(fragment, label):
    return f'<a href="../../?preview=el-nath#{esc(fragment)}">{esc(label)}</a>'


def table(caption, headers, rows):
    # Focusable overflow wrapper permits horizontal scrolling with the keyboard.
    # The visible caption supplies context when a screen reader enters the table.
    return (f'<div class="expansion-table-wrap" role="region" tabindex="0" aria-label="{esc(caption)}（可左右捲動）">\n'
            f'<table class="expansion-table"><caption>{esc(caption)}</caption>\n'
            '<thead><tr>' + ''.join(f'<th scope="col">{esc(h)}</th>' for h in headers)
            + '</tr></thead>\n<tbody>\n' + '\n'.join(rows) + '\n</tbody></table></div>')


def row(cells):
    return '<tr>' + ''.join(f'<td>{c}</td>' for c in cells) + '</tr>'


def fold(title, content, subtitle="", identifier=None):
    anchor = f' id="{esc(identifier)}"' if identifier else ""
    sub = f'<span class="expansion-detail-meta">{esc(subtitle)}</span>' if subtitle else ""
    return (f'<details class="expansion-detail"{anchor}><summary>{esc(title)}{sub}</summary>\n'
            f'<div class="expansion-detail-body">{content}</div></details>')


def section_note(text):
    return f'<p class="expansion-source">{esc(text)}</p>' if text else ''


def relation_evidence(record):
    """Retain distinct evidence when the importer merges several references."""
    out = []
    # Schema v1 uses sourceEvidence. Accept the earlier provenance spelling as
    # well, but never infer relation sources from a dropRates array.
    children = (record.get('sourceEvidence') or []) + (record.get('provenance') or [])
    if children:
        entries = [entry for child in children for entry in relation_evidence(child)]
    else:
        entries = [{key: record[key] for key in ('source', 'sourceLabel', 'sourceNote')
                    if record.get(key)}] if record.get('source') or record.get('sourceLabel') else []
    for entry in entries:
        if entry not in out:
            out.append(entry)
    return out


def has_relation_source(record, source):
    return any(evidence.get('source') == source for evidence in relation_evidence(record))


def relation_note(record):
    """Label the individual association, not its monster/item or estimated rate."""
    notes = []
    for evidence in relation_evidence(record):
        source = evidence.get('source')
        label = evidence.get('sourceLabel') or {'tmsv113': 'TMS v113',
                'monsterBook': '怪物圖鑑關聯', 'monsterCard': '怪物圖鑑卡關聯',
                'quest': '任務限定關聯'}.get(source, source)
        note = evidence.get('sourceNote')
        if note and note not in label:
            label += '；' + note
        if source == 'tmsv113':
            label += '；跨版本補充'
        notes.append(f' <span class="expansion-provenance" data-relation-source="{esc(source or "unspecified")}">'
                     f'〔{esc(label)}〕</span>')
    return ''.join(notes)


def map_relation(monster_id, place):
    """Map-side mob rows may hold provenance absent from the reverse lookup.

    Read only the imported preview. Do not reopen the raw checkout, guess a
    source from an ID, or substitute regionSource/dropRates for relation source.
    """
    map_mob = next((m for m in detail('map', place['id']).get('mobs') or []
                    if str(m['id']) == str(monster_id)), {})
    return {'sourceEvidence': relation_evidence(map_mob) + relation_evidence(place)}


def map_group(m):
    # A reading aid, not a traversable route. WorldMap020 includes both Orbis
    # and El Nath; names, region metadata and the tower ID range disambiguate it.
    if m.get("region") == "廢礦":
        return GROUPS[3]
    mid = int(m["id"])
    if m.get("mark") == "GoddessTower" or 200080100 <= mid <= 200082399:
        return GROUPS[1]
    if 200000000 <= mid < 201000000:
        return GROUPS[0]
    return GROUPS[2]


def npc_places(npc, ids):
    return '、'.join(linked_record("map", m, ids) for m in npc.get("maps", [])) or "地點未提供"


def skill_section(manifest, indices, ids):
    skills = [s for s in indices["skill"] if s.get("adv") == "三轉" and s.get("group") in INSTRUCTORS]
    jobs = defaultdict(list)
    for skill in skills:
        jobs[(skill["group"], int(skill["id"]) // 10000, skill["job"])].append(skill)
    cards = []
    for (group, job_id, job), group_skills in sorted(jobs.items(), key=lambda pair: pair[0][1]):
        instructor_id = INSTRUCTORS[group]
        if str(instructor_id) in ids["npc"]:
            instructor = detail("npc", instructor_id)
            npc_html = linked_record("npc", instructor, ids) + ' · ' + npc_places(instructor, ids)
        else:
            npc_html = "教官資料未收錄"
        skill_rows = []
        for skill in sorted(group_skills, key=lambda s: int(s["id"])):
            d = detail("skill", skill["id"])
            levels = d.get("levels") or []
            top = next((level for level in levels if level.get("level") == d.get("maxLevel")), None)
            requirement = d.get("req")
            req_text = (f'{esc(requirement["name"])} Lv.{number(requirement["level"])}'
                        if requirement else "未列前置技能")
            effect = re.sub(r'^\[最高等級：\d+\]\s*', '', d.get('desc') or '').rstrip('#')
            top_text = esc(top.get('desc') or '此等級未提供說明') if top else '未提供滿級說明'
            # The full effect carries conditions absent from the level row, e.g.
            # Holy Symbol's party requirement and Dragon Roar's HP restriction.
            effect_html = f'<p class="expansion-skill-desc">{esc(effect)}</p>' if effect else ''
            skill_rows.append(row([
                link("skill", d["id"], d["name"]) + f'<small class="expansion-code">{esc(d["id"])}</small>',
                number(d.get("maxLevel")), req_text,
                top_text + effect_html,
                link("skill", d["id"], "逐級數值與完整說明"),
            ]))
        body = (f'<p>{esc(group)} · 教官：{npc_html}</p>'
                + table(job + '技能', ["技能", "最高技能等級", "前置技能", "滿級效果與使用限制（來源原文）", "詳情"], skill_rows))
        cards.append(fold(job, body, f'{len(group_skills)} 個技能 · {group}', f'job-{job_id}'))
    intro = ('<p>五大冒險家職業的三轉資料。展開職業查看技能上限、前置技能與滿級說明；'
             '點「逐級數值與完整說明」可在預覽資料庫檢查每一級。這些是拆包參考數值，正式上線後仍可能調整。</p>'
             '<p class="expansion-note">教官身分由來源中的後續轉職任務交叉確認，但本份任務表沒有完整三轉測驗流程。'
             '因此這裡不提供未經確認的技能配點順序、答題題庫、材料數量或進場路線。</p>')
    return intro + section_note("技能最高等級不是角色等級；教官地圖引用不代表已提供座標。") + '\n'.join(cards), len(skills), len(jobs)


def map_section(manifest, maps, monsters, ids):
    associated = defaultdict(list)
    map_ids = {str(m['id']) for m in maps}
    for monster in monsters:
        for m in detail("monster", monster["id"]).get("maps", []):
            if str(m['id']) in map_ids:
                associated[str(m["id"])].append((monster, map_relation(monster['id'], m)))
    groups = defaultdict(list)
    for m in maps:
        groups[map_group(m)].append(m)
    panels = []
    for group in GROUPS:
        rows = []
        for m in sorted(groups[group], key=lambda m: int(m["id"])):
            monster_rows = associated[str(m["id"])]
            mobs = '<ul class="expansion-compact-list">' + ''.join(
                '<li>' + link("monster", mob["id"], mob["name"])
                + f' · Lv.{number(mob.get("level"))} · EXP {number(mob.get("exp"))}'
                + f' · {esc(mob.get("el") or "屬性資料未提供")}' + relation_note(provenance) + '</li>'
                for mob, provenance in sorted(monster_rows, key=lambda x: (x[0].get("level") or 0, int(x[0]["id"])))
            ) + '</ul>' if monster_rows else '尚未提供怪物關聯'
            status = '缺少單張地圖資料；重生點／NPC座標／傳點待確認' if m.get("dataMissing") else '有單張地圖資料；是否開放待確認'
            rows.append(row([link("map", m["id"], m["name"]) + f'<small class="expansion-code">{m["id"]}</small>', mobs, esc(status)]))
        panels.append(fold(group, table(group + '地圖索引', ["地圖", "關聯怪物 · 等級／EXP／屬性／來源", "資料完整度"], rows), f'{len(rows)} 張地圖'))
    intro = ('<p>按天空之城、天空之塔、雪域與廢礦整理。這是閱讀分組，並非已驗證的交通動線。'
             '地圖名稱為原始資料名稱；「未命名」項目保留ID，方便日後核對。</p>'
             '<p class="expansion-note">缺少地圖資料時，以已收錄的出沒關聯反查。'
             '明確標記source=tmsv113的個別關聯會註明「TMS v113／跨版本補充」，不是本次客戶端原始重生資料；'
             '沒有該標記也不代表已驗證為客戶端原始資料。這些關聯無法確認實際重生點、密度或前往方式。'
             '廢礦及炎魔也不代表與三轉同批推出。</p>')
    return intro + section_note('跨版本補充會依個別關聯標示，不代表整張地圖或所有怪物都來自TMS v113。') + '\n'.join(panels)


def monster_section(manifest, monsters, map_ids):
    ordinary = []
    bosses = []
    for mob in sorted(monsters, key=lambda m: (m.get("level") or 0, int(m["id"]))):
        d = detail("monster", mob["id"])
        locations = [link("map", m["id"], m["name"]) + relation_note(map_relation(mob['id'], m))
                     for m in d.get("maps", []) if str(m["id"]) in map_ids]
        cells = [link("monster", mob["id"], mob["name"]), number(mob.get("level")), number(mob.get("hp")),
                 number(mob.get("exp")), esc(mob.get("el") or '未提供'), '、'.join(locations) or '未提供']
        (bosses if d.get("boss") else ordinary).append(row(cells))
    intro = ('<p>以下列出與預覽地區有關聯的全部怪物，包含在原有地區也會出現的怪物。'
             'EXP 為資料中的單隻基礎經驗，不含加倍、組隊或神聖祈禱；屬性弱點與抗性按來源保留。</p>')
    headers = ["怪物／掉落詳情", "Lv.", "HP", "基礎 EXP", "屬性", "預覽地區的出沒關聯"]
    panels = fold('一般怪物', table('一般怪物資料', headers, ordinary), f'{len(ordinary)} 種')
    if bosses:
        panels += fold('Boss與關聯型態', '<p>不同ID可能是階段、手臂或其他版本型態。不能將多筆經驗值相加視為一次討伐收益；亦未確認開放批次。</p>'
                       + table('Boss與關聯型態資料', headers, bosses), f'{len(bosses)} 筆')
    return intro + section_note("出沒關聯旁的TMS v113註記只適用於該筆關聯，不適用於整隻怪物的能力。掉落率及楓幣含外部伺服器推估，本攻略不以它們估算收益。") + panels


def resource_list(kind, records, ids, counts=False):
    if not records:
        return '資料未列出'
    return '<ul class="expansion-compact-list">' + ''.join(
        '<li>' + linked_record(kind, r, ids)
        + (f' × {number(r.get("count"))}' if counts else '')
        + (f'（{esc(r["state"])}）' if r.get("state") else '') + '</li>' for r in records) + '</ul>'


def quest_section(manifest, quests, ids):
    groups = defaultdict(list)
    for q in quests:
        groups[q.get("parent") or q.get("category") or '其他任務'].append(q)
    panels = []
    for group, members in sorted(groups.items()):
        quest_cards = []
        for q in sorted(members, key=lambda q: (q.get("minLevel") or 0, int(q["id"]))):
            start, complete, rewards = q.get("start") or {}, q.get("complete") or {}, q.get("rewards") or {}
            requirements = [row(['接取材料', resource_list('item', start.get('items', []), ids, True)]),
                            row(['前置任務', resource_list('quest', start.get('quests', []), ids)]),
                            row(['完成材料', resource_list('item', complete.get('items', []), ids, True)]),
                            row(['擊敗怪物', resource_list('monster', complete.get('monsters', []), ids, True)]),
                            row(['道具獎勵', resource_list('item', rewards.get('items', []), ids, True)]),
                            row(['技能獎勵', resource_list('skill', rewards.get('skills', []), ids)])]
            numeric_rewards = ' · '.join(f'{label} {number(rewards[key])}' for key, label in [('exp', 'EXP'), ('money', '楓幣'), ('pop', '名聲')] if rewards.get(key)) or '未列數值獎勵'
            requirements.append(row(['其他獎勵', numeric_rewards]))
            jobs = start.get('jobs') or []
            if jobs:
                requirements.append(row(['職業限制（來源代碼）', esc('、'.join(str(j) for j in jobs))]))
            npcs = ' → '.join(linked_record('npc', q[k], ids) if q.get(k) else '未提供' for k in ('startNpc', 'endNpc'))
            level = f'Lv.{number(q.get("minLevel"))}' if q.get('minLevel') is not None else '等級未提供'
            if q.get('maxLevel') is not None:
                level += f'～{number(q["maxLevel"])}'
            late = '<p class="expansion-note">此任務需求超過官方9/3公告的Lv.100上限，只作後續關聯資料，不屬於已開放任務或三轉前置。</p>' if (q.get('minLevel') or 0) > 100 else ''
            text = ''.join(f'<p><strong>{esc(t.get("label", "說明"))}：</strong>{esc(t["text"])}</p>' for t in q.get('texts', []) if t.get('text'))
            quest_cards.append('<article class="expansion-quest"><h3>' + link('quest', q['id'], q['name'])
                               + f'</h3><p>{level} · 接取／繳交：{npcs}</p>{late}'
                               + table(q['name'] + '需求與獎勵', ['項目', '來源資料'], requirements)
                               + fold('任務文字', text or '<p>來源未提供任務文字。</p>') + '</article>')
        panels.append(fold(group, '\n'.join(quest_cards), f'{len(members)} 個任務'))
    intro = ('<p>只收錄本份預覽中實際存在、且與新區域NPC／地圖有關的任務。材料與獎勵點進去可查看道具來源。'
             '資料未列出不等於不需要，也不能據此推定任務完整可解。</p>'
             '<p class="expansion-note">目前來源未提供完整三轉任務、查理中士交換、阿爾法部隊聯絡網、'
             '豪克的魔法材料或亞凱斯特古書任務鏈。這些常見舊版攻略不能直接當作本次更新的任務清單。</p>')
    empty = ('<div class="expansion-note"><h3>任務資料待補</h3><p>目前缺少可確認的三轉／雪域任務明細。'
             '沒有可確認的等級、材料、獎勵或流程可列出；後續取得完整資料後再補入。</p></div>')
    return intro + ('\n'.join(panels) or empty)


def npc_section(manifest, npcs, ids):
    roster = []
    shops = []
    for n in sorted(npcs, key=lambda n: (n.get('name', ''), int(n['id']))):
        roster.append(row([linked_record('npc', n, ids), npc_places(n, ids),
                           f'{len(n.get("shop", []))} 項商品／{len(n.get("crafts", []))} 項製作',
                           resource_list('quest', n.get('quests', []), ids)]))
        if n.get('shop'):
            entries = [row([linked_record('item', item, ids), f'{number(item.get("price"))} {esc(item.get("currency") or "楓幣")}']) for item in n['shop']]
            shops.append(fold(n['name'] + '的商店', '<p>' + npc_places(n, ids) + '</p>'
                              + table(n['name'] + '販售清單', ['商品／道具詳情', '資料售價'], entries), f'{len(entries)} 項商品'))
        if n.get('crafts'):
            crafts = [row([linked_record('item', c, ids), number(c.get('meso')) + ' 楓幣']) for c in n['crafts']]
            shops.append(fold(n['name'] + '的製作', '<p>材料清單請進入各產物詳情查閱；這裡的楓幣僅是來源列出的製作費。</p>'
                              + table(n['name'] + '製作產物', ['產物／材料詳情', '製作費'], crafts), f'{len(crafts)} 項產物'))
    intro = ('<p>NPC地點來自任務、商店或製作引用。未命名地圖和缺少座標會保留原樣；'
             '商店售價及供貨內容仍待正式服核對。沒有列出商店，表示這份資料沒有販售紀錄。</p>')
    return (intro
            + fold('NPC所在地與功能', table('新區域NPC索引', ['NPC', '地點', '補給／製作', '相關任務'], roster), f'{len(roster)} 位NPC')
            + '\n'.join(shops)), len([n for n in npcs if n.get('shop')])


def equipment_section(manifest, indices, ids, monster_ids, npcs):
    vendors = defaultdict(list)
    crafters = defaultdict(list)
    for npc in npcs:
        for item in npc.get('shop', []):
            vendors[str(item['id'])].append(npc)
        for item in npc.get('crafts', []):
            crafters[str(item['id'])].append(npc)
    categories = defaultdict(list)
    for item in indices['item']:
        if item.get('cat') != '裝備' or not 60 <= (item.get('lv') or 0) <= 100:
            continue
        d = detail('item', item['id'])
        drops = [m for m in d.get('drops', []) if str(m['id']) in monster_ids]
        merchants = vendors[str(d['id'])]
        makers = crafters[str(d['id'])]
        if drops or merchants or makers:
            categories[d.get('sub') or '其他裝備'].append((d, drops, merchants, makers))
    panels = []
    selected_count = 0
    tms_drop_count = 0
    for category, equipment in sorted(categories.items()):
        # Deterministic samples, not a ranking or a promise that each can be obtained.
        selected = sorted(equipment, key=lambda entry: ((entry[0].get('equip') or {}).get('reqLevel') or 0, int(entry[0]['id'])))[:3]
        selected_count += len(selected)
        entries = []
        for d, drops, merchants, makers in selected:
            tms_drop_count += sum(has_relation_source(m, 'tmsv113') for m in drops)
            stats = d.get('equip') or {}
            stat_text = '、'.join(f'{label} {number(stats[key])}' for key, label in STAT_NAMES.items() if stats.get(key)) or '詳情頁查閱'
            sources = []
            if drops:
                sources.append('掉落：' + '、'.join(linked_record('monster', m, ids) + relation_note(m) for m in drops))
            if merchants:
                sources.append('販售：' + '、'.join(linked_record('npc', n, ids) for n in merchants))
            if makers:
                sources.append('製作：' + '、'.join(linked_record('npc', n, ids) for n in makers))
            entries.append(row([linked_record('item', d, ids), number(stats.get('reqLevel')), stat_text, '<br>'.join(sources)]))
        panels.append(fold(category, table(category + '取得來源示例', ['裝備／完整能力與材料', '需求Lv.', '基準能力', '預覽地區來源'], entries), f'選列 {len(entries)} 件／{len(equipment)} 件符合條件'))
    intro = ('<p>以下是需求Lv.60～100、且在預覽地區有掉落、販售或製作關聯的裝備。'
             '每個分類依需求等級、道具ID排序取前三件，作為查詢入口，並非強度排行或推薦購物清單。'
             '能力列基準值，完整穿戴條件、天然浮動與材料請看詳情。</p>')
    return intro + section_note('掉落關聯逐筆標示；TMS v113代表跨版本補充，不是本服實測。掉落率的外部來源不會被當成掉落關聯的來源。不列未驗證的機率或價格預測。') + '\n'.join(panels), selected_count, tms_drop_count


def build():
    if not (DATA / 'manifest.json').is_file():
        raise ValueError('Preview manifest is not ready. Run after tools/import_el_nath.py completes.')
    manifest = load('manifest.json')
    if manifest.get('status') != 'preview':
        raise ValueError('This generator requires a preview manifest.')
    if manifest.get('provenanceSchemaVersion') != 1:
        raise ValueError('Wait for the completed provenance schema v1 import before rebuilding the guide.')
    for key in ('gameVersion', 'generatedAt', 'checkedAt', 'regions', 'sets'):
        if not manifest.get(key):
            raise ValueError(f'Manifest is missing {key}')
    indices = {kind: load(f'{plural}.json') for kind, plural in KINDS.items()}
    ids = {kind: {str(r['id']) for r in rows} for kind, rows in indices.items()}
    for kind, plural in KINDS.items():
        if len(indices[kind]) != len(ids[kind]) or len(indices[kind]) != manifest['sets'][plural]['total']:
            raise ValueError(f'Incomplete or duplicate {plural} export; wait for the importer to finish')
    maps = [m for m in indices['map'] if m.get('region') in manifest['regions']]
    map_ids = {str(m['id']) for m in maps}
    monsters = [m for m in indices['monster'] if any(str(place['id']) in map_ids for place in detail('monster', m['id']).get('maps', []))]
    monster_ids = {str(m['id']) for m in monsters}
    npcs = [detail('npc', n['id']) for n in indices['npc']]
    npcs = [n for n in npcs if any(str(m['id']) in map_ids for m in n.get('maps', []))]
    # Shared NPCs such as Maple GM occur in many towns. Their existing quests
    # must not be counted as newly imported El Nath quests.
    quests = [detail('quest', q['id']) for q in indices['quest'] if q.get('preview')]
    skill_html, skill_count, job_count = skill_section(manifest, indices, ids)
    npc_html, shop_count = npc_section(manifest, npcs, ids)
    equip_html, equip_count, tms_equip_relations = equipment_section(manifest, indices, ids, monster_ids, npcs)
    # Count unique associations, not repeated appearances in both guide tables.
    tms_map_relations = {
        (str(monster['id']), str(place['id']))
        for monster in monsters for place in detail('monster', monster['id']).get('maps', [])
        if str(place['id']) in map_ids and has_relation_source(map_relation(monster['id'], place), 'tmsv113')
    }
    sections = [
        ('skills', '三轉職業與技能', skill_html),
        ('maps', '地圖索引與資料完整度', map_section(manifest, maps, monsters, ids)),
        ('monsters', '怪物等級、經驗與屬性', monster_section(manifest, monsters, map_ids)),
        ('quests', '任務與前置資料', quest_section(manifest, quests, ids)),
        ('npcs', 'NPC、商店與製作', npc_html),
        ('equipment', '裝備取得來源示例', equip_html),
    ]
    stats = [(str(job_count), '三轉職業'), (str(skill_count), '三轉技能'),
             (str(len(maps)), '區域地圖'), (str(len(monsters)), '關聯怪物'),
             (str(len(npcs)), '區域NPC'), (str(shop_count), '商店')]
    stat_html = ''.join(f'<div><dt>{esc(label)}</dt><dd>{value}</dd></div>' for value, label in stats)
    nav = ''.join(f'<a href="#{anchor}"><span>{i:02d}</span>{esc(title)}</a>' for i, (anchor, title, _) in enumerate(sections, 1))
    section_html = '\n'.join(f'<section class="expansion-section" id="{anchor}" aria-labelledby="{anchor}-title"><h2 id="{anchor}-title">{esc(title)}</h2>\n{body}</section>' for anchor, title, body in sections)
    generated = manifest['generatedAt']
    date = manifest['checkedAt']
    css_version = hashlib.sha256((OUTPUT.parent / 'guide.css').read_bytes()).hexdigest()[:12]
    schema = {
        '@context': 'https://schema.org', '@type': 'Article', 'headline': TITLE,
        'description': DESCRIPTION, 'url': PAGE_URL, 'mainEntityOfPage': PAGE_URL,
        'inLanguage': 'zh-TW', 'image': BASE + '/og-image.png?v=12',
        'author': {'@type': 'Person', 'name': 'xyzzxc00'},
        'publisher': {'@type': 'Person', 'name': 'xyzzxc00'},
        'datePublished': '2026-09-09', 'dateModified': date,
        'citation': [OFFICIAL_STATUS, OFFICIAL_MAINTENANCE],
    }
    missing = sum(bool(m.get('dataMissing')) for m in maps)
    html = f'''<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>{esc(TITLE)}｜楓錄</title>
<meta name="description" content="{esc(DESCRIPTION)}">
<meta name="theme-color" content="#F6F5F1" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#1C1D19" media="(prefers-color-scheme: dark)">
<link rel="icon" type="image/svg+xml" href="../../favicon.svg">
<link rel="apple-touch-icon" href="../../icon-192.png">
<link rel="canonical" href="{PAGE_URL}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="楓錄">
<meta property="og:locale" content="zh_TW">
<meta property="og:url" content="{PAGE_URL}">
<meta property="og:title" content="{esc(TITLE)}｜楓錄">
<meta property="og:description" content="{esc(DESCRIPTION)}">
<meta property="og:image" content="{BASE}/og-image.png?v=12">
<meta property="og:image:width" content="2400">
<meta property="og:image:height" content="1260">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{esc(TITLE)}｜楓錄">
<meta name="twitter:description" content="{esc(DESCRIPTION)}">
<meta name="twitter:image" content="{BASE}/og-image.png?v=12">
<script type="application/ld+json">
{json.dumps(schema, ensure_ascii=False, indent=2).replace('<', '&lt;')}
</script>
<link rel="stylesheet" href="../../style.css">
<link rel="stylesheet" href="guide.css?v={css_version}">
</head>
<body>
<!-- Same storage key and body class as the shared js/theme.js. -->
<script>
  (function () {{
    var saved = null;
    try {{ saved = localStorage.getItem("maple_classic_theme"); }} catch (_) {{}}
    var isDark = saved ? saved === "dark" : window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    if (isDark) document.body.classList.add("dark");
  }})();
</script>
{THEME_BUTTON}
<!-- Generated by tools/build_el_nath_guide.py; edit the generator, not this file.
     Keep the exact theme button above and closing main tag for patch_html.py. -->
<a class="expansion-skip" href="#guide-content">跳到攻略內容</a>
<main id="guide-content" class="expansion-guide">
<nav class="article-breadcrumb" aria-label="麵包屑"><a href="../../#home">首頁</a> ／ <a href="../">攻略文章</a> ／ 三轉與冰原雪域預覽</nav>
<header class="expansion-hero">
<p class="expansion-eyebrow">版本資料預覽 · 正式開放待公告</p>
<h1>三轉與冰原雪域<br><span>先認識下一段冒險</span></h1>
<p class="expansion-lead">從三轉技能到天空之城、雪域與廢礦，按資料查職業、怪物與補給。展開感興趣的章節，所有詳情連結都會保留預覽模式。</p>
<p class="expansion-meta">資料版本 {esc(manifest['gameVersion'])} · 資料產生 <time datetime="{esc(generated)}">{esc(generated.replace('T', ' '))}</time><br>資料核對 <time datetime="{esc(date)}">{esc(date)}</time></p>
<dl class="expansion-stats">{stat_html}</dl>
</header>
<aside class="expansion-status" aria-labelledby="preview-status-title">
<h2 id="preview-status-title">這份資料不代表已開放</h2>
<p>截至 {OFFICIAL_DATE} 的官方公告查核，<a href="{OFFICIAL_STATUS}">9/3 V001開機公告</a>仍列角色等級上限100、轉職開放至二轉。<a href="{OFFICIAL_MAINTENANCE}">9/4公告</a>將9/10維護調整為00:00～12:00，但沒有確認三轉或雪域的開放日期。</p>
<p>{esc(manifest.get('notice') or '拆包存在不代表已開放。')}</p>
<p>{section_link('db-skills', '開啟三轉技能資料庫')} · {section_link('db-maps', '開啟預覽地圖資料庫')} · <a href="#sources">查看資料限制</a></p>
</aside>
<nav class="expansion-toc" aria-label="攻略章節">{nav}</nav>
{section_html}
<section class="expansion-section" id="sources" aria-labelledby="sources-title">
<h2 id="sources-title">資料範圍與待確認項目</h2>
<ul class="expansion-source-list">
<li>資料版本：<a href="../../data/preview/el-nath/manifest.json">預覽資料摘要</a>；本頁從同一份資料產生，版本為 {esc(manifest['gameVersion'])}。</li>
<li>{len(maps)} 張區域地圖中，{missing} 張缺少單張地圖資料。NPC引用與怪物出沒關聯不能還原實際座標、傳點和重生密度。</li>
<li>任務表目前能對應 {len(quests)} 個相關任務。高等級或其他版本的關聯資料不等於本次擴充內容；三轉考驗流程仍待官方或正式服驗證。</li>
<li>掉落率、楓幣推估與部分商店／製作資料混有其他版本資料；本頁保留可追溯的取得來源，不推算掉寶收益。</li>
<li>來源標記以單筆地圖－怪物、道具－掉落怪物關聯為單位，包含sourceEvidence保留的多筆證據。「TMS v113／跨版本補充」只在該關聯的一筆證據明確標記source=tmsv113時出現，不代表同一關聯的其他證據、同列能力、整張地圖或其他關聯也來自TMS v113。掉落率來源與掉落關聯來源分開判讀；未標記的關聯不自動視為已驗證的客戶端原始資料。</li>
<li>本頁明確標記TMS v113的地圖－怪物關聯有 {len(tms_map_relations)} 筆（地圖與怪物兩節會重複顯示，同一配對只計一次）；裝備取得節選中有 {tms_equip_relations} 筆TMS v113掉落關聯。數量只計本頁所列資料，不代表整份資料庫，也不包含單純掉落率來源的標記。</li>
<li>正式開放範圍、等級上限變更、Boss批次、任務條件和技能調整，以<a href="https://maplestoryclassic.beanfun.com/Main">台版官方最新公告</a>為準。</li>
</ul>
{section_note('客戶端資料版本不是官方的開放範圍承諾。')}
<p>{section_link('db-monsters', '繼續查怪物')} · {section_link('db-items', '繼續查道具')} · {section_link('db-quests', '繼續查任務')} · <a href="#guide-content">回到頁首</a></p>
</section>
</main>
<!-- Shared theme script uses maple_classic_theme; no page-specific theme state. -->
<script defer src="../../js/backToTop.js"></script>
<script defer src="../../js/theme.js"></script>
</body>
</html>
'''
    counts = {'jobs': job_count, 'skills': skill_count, 'maps': len(maps), 'missing_maps': missing,
              'monsters': len(monsters), 'quests': len(quests), 'npcs': len(npcs),
              'shops': shop_count, 'equipment_highlights': equip_count,
              'tmsv113_map_relations': len(tms_map_relations),
              'tmsv113_equipment_drop_relations': tms_equip_relations}
    return html, counts, ids


class PageLinks(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = []
        self.links = []
        self.h1 = 0

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if 'id' in attrs:
            self.ids.append(attrs['id'])
        if tag == 'a' and 'href' in attrs:
            self.links.append(attrs['href'])
        if tag == 'h1':
            self.h1 += 1


def validate(html, ids):
    parser = PageLinks()
    parser.feed(html)
    if parser.h1 != 1 or len(parser.ids) != len(set(parser.ids)):
        raise ValueError('Expected one h1 and unique element IDs')
    if THEME_BUTTON not in html or '</main>' not in html or '<body>' not in html:
        raise ValueError('Guide must retain patch_html.py shell-injection markers')
    for href in parser.links:
        parsed = urlsplit(href)
        if href.startswith('#') and parsed.fragment not in parser.ids:
            raise ValueError(f'Missing section: {href}')
        query = parse_qs(parsed.query)
        if 'db' in query:
            if query.get('preview') != ['el-nath']:
                raise ValueError(f'Link loses preview mode: {href}')
            kind, identifier = query['db'][0], query.get('id', [''])[0]
            if identifier not in ids.get(kind, set()):
                raise ValueError(f'Missing preview record: {href}')
            if not (DATA / KINDS[kind] / f'{identifier}.json').is_file():
                raise ValueError(f'Missing preview detail: {href}')
    for block in re.findall(r'<script type="application/ld\+json">(.*?)</script>', html, re.S):
        json.loads(block)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='validate generation and committed artifact without writing')
    args = parser.parse_args()
    html, counts, ids = build()
    validate(html, ids)
    if args.check:
        if not OUTPUT.is_file() or OUTPUT.read_text(encoding='utf-8') != html:
            raise SystemExit('Guide is stale: run tools/build_el_nath_guide.py')
    else:
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT.write_text(html, encoding='utf-8', newline='\n')
    print(('Validated' if args.check else 'Generated') + ' ' + str(OUTPUT.relative_to(ROOT)))
    print(json.dumps(counts, ensure_ascii=False))


if __name__ == '__main__':
    main()
