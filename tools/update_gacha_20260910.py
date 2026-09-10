"""Read-only verification of the September 10 official gacha probability tables.

Run with the repository's Python runtime. --patch emits an apply_patch-compatible
update for js/gachaData.js; it does not edit files or invoke the database importer.
Without --patch, compare every current simulator name, rate, tier and date with
the live official tables. Shared probability cells are counted exactly once.
"""

import argparse
import json
import re
import subprocess
import sys
from decimal import Decimal
from html.parser import HTMLParser
from pathlib import Path
from urllib.request import urlopen


ROOT = Path(__file__).resolve().parents[1]
EVENT_ORIGIN = "https://maplestoryclassic-event.beanfun.com"
EXPECTED = {
    "shining-comet": (35, Decimal("100.06"), "2026/09/24 07:59"),
    "brilliant-comet": (58, Decimal("100.01"), "2026/09/24 07:59"),
    "royal-salon-hair-m": (12, Decimal("100"), "2026/09/23 23:59"),
    "royal-salon-hair-f": (12, Decimal("100"), "2026/09/23 23:59"),
    "royal-salon-face-m": (12, Decimal("100"), "2026/09/23 23:59"),
    "royal-salon-face-f": (12, Decimal("100"), "2026/09/23 23:59"),
    "gasha-machine": (101, Decimal("99.97"), "2026/10/06 23:59"),
}
SALON_GROUPS = {
    "皇家美髮(男)": ("royal-salon-hair-m", "皇家美容院・皇家美髮(男)"),
    "皇家美髮(女)": ("royal-salon-hair-f", "皇家美容院・皇家美髮(女)"),
    "皇家整形(男)": ("royal-salon-face-m", "皇家美容院・皇家整形(男)"),
    "皇家整形(女)": ("royal-salon-face-f", "皇家美容院・皇家整形(女)"),
}
NOTES = {
    "shining-comet": "本期聯名獎項列於閃亮彗星；璀璨彗星不含本期聯名獎項。未模擬角色性別限制與機率重分配。",
    "brilliant-comet": "不含本期聯名獎項。巧克力套裝、海灘泳裝及夾腳拖的男女版本共用機率，各合併為一個獎項；未模擬角色性別限制與機率重分配。",
    "royal-salon-hair-m": "男、女美髮各自抽取，機率互不合併；獎項名稱沿用官方機率表。",
    "royal-salon-hair-f": "男、女美髮各自抽取，機率互不合併；獎項名稱沿用官方機率表。",
    "royal-salon-face-m": "男、女整形各自抽取，機率互不合併。",
    "royal-salon-face-f": "男、女整形各自抽取，機率互不合併。",
    "gasha-machine": "本期前四項獎勵更新；其餘獎項機率維持不變，名稱依本期官方公告。",
}


class TableRows(HTMLParser):
    """Keep cells and rowspan attributes without executing official page code."""

    def __init__(self):
        super().__init__()
        self.rows = []
        self.row = None
        self.cell = None

    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            self.row = []
        elif tag in ("td", "th") and self.row is not None:
            self.cell = {"attrs": dict(attrs), "text": ""}
        elif tag == "br" and self.cell is not None:
            self.cell["text"] += " "

    def handle_data(self, data):
        if self.cell is not None:
            self.cell["text"] += data

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self.cell is not None:
            self.cell["text"] = re.sub(r"\s+", " ", self.cell["text"]).strip()
            self.row.append(self.cell)
            self.cell = None
        elif tag == "tr" and self.row is not None:
            self.rows.append(self.row)
            self.row = None


def require(condition, message):
    if not condition:
        raise ValueError(message)


def fetch_event(event_id):
    url = f"{EVENT_ORIGIN}/api/EventAd/GetDetail?EventADID={event_id}"
    with urlopen(url, timeout=30) as response:
        require(response.status == 200, f"HTTP error for {url}")
        result = json.load(response)
    require(result.get("code") == 1, f"Official API rejected {url}")
    print(f"verified-live: {url}", file=sys.stderr)
    return result["data"]


def date_text(value):
    return value[:16].replace("-", "/").replace("T", " ")


def make_box(box_id, name, event_id, event):
    return {
        "id": box_id,
        "name": name,
        "period": f'{date_text(event["startDate"])} ～ {date_text(event["endDate"])}',
        "editionId": f"{box_id}-20260910",
        "eventAdId": event_id,
        "sourceUrl": f"{EVENT_ORIGIN}/EventAd/EventAd?eventAdId={event_id}",
        "verifiedAt": "2026-09-10",
        "note": NOTES[box_id],
        "items": [],
    }


def parse_event(event_id, data):
    require(len(data["event"]) == 1, f"Unexpected event header: {event_id}")
    event = data["event"][0]
    require(event["startDate"] == "2026-09-10T09:00:00", "This verifier is for the September 10 edition only")
    parser = TableRows()
    for topic in data["topics"]:
        parser.feed(topic["topicContent"])
    boxes = {}
    current = None
    shared_remaining = 0
    if event_id == 18945:
        current = make_box("shining-comet", "閃亮彗星", event_id, event)
        boxes[current["id"]] = current
    elif event_id == 19046:
        current = make_box("gasha-machine", "轉蛋機", event_id, event)
        boxes[current["id"]] = current
    for cells in parser.rows:
        values = [cell["text"] for cell in cells]
        if event_id == 18938 and values:
            group = re.sub(r"\s+", "", values[0])
            if group in SALON_GROUPS:
                box_id, name = SALON_GROUPS[group]
                require(box_id not in boxes, f"Duplicate salon group {group}")
                current = make_box(box_id, name, event_id, event)
                boxes[box_id] = current
                values = values[1:]
        if event_id == 18945 and values == ["璀璨彗星"]:
            require(shared_remaining == 0, "Unfinished shared probability")
            current = make_box("brilliant-comet", "璀璨彗星", event_id, event)
            boxes[current["id"]] = current
            continue
        if shared_remaining:
            require(len(values) == 2 and values[0] == current["items"][-1]["rarity"], "Unexpected shared probability row")
            current["items"][-1]["name"] += "／" + values[1]
            shared_remaining -= 1
            continue
        if not values or not re.fullmatch(r"\d+(?:\.\d+)?%", values[-1]):
            continue
        require(current is not None, "Missing pool group")
        weight = float(Decimal(values[-1][:-1]))
        if event_id == 18945:
            require(len(values) == 3 and values[0] in "SABC", f"Invalid comet row: {values}")
            item = {"name": values[1], "rarity": values[0], "weight": weight}
            shared_remaining = int(cells[-1]["attrs"].get("rowspan", "1")) - 1
        else:
            require(len(values) == 2, f"Invalid prize row: {values}")
            item = {"name": values[0], "weight": weight}
        current["items"].append(item)
    require(shared_remaining == 0, "Unfinished shared probability")
    return boxes


def official_boxes():
    boxes = {}
    for event_id in (18945, 18938, 19046):
        boxes.update(parse_event(event_id, fetch_event(event_id)))
    require(set(boxes) == set(EXPECTED), "Unexpected pool list")
    for box_id, (count, total, end) in EXPECTED.items():
        box = boxes[box_id]
        require(len(box["items"]) == count, f"Prize count changed: {box_id}")
        require(sum(Decimal(str(x["weight"])) for x in box["items"]) == total, f"Rate total changed: {box_id}")
        require(box["period"].endswith(end), f"End date changed: {box_id}")
    return [boxes[box_id] for box_id in EXPECTED]


def render_data(boxes):
    lines = [
        "/**",
        " * gachaData.js — 轉蛋模擬的道具池資料（2026-09-10）",
        " * 機率、名稱與時間逐列核對官方 Beanfun 機率商品說明。",
        " * S/A/B/C 沿用官方分級；機率顯示原值，抽取時依總權重換算。",
        " * 官方取小數兩位，總和可能略偏離 100%，不能另造機率補足。",
        " * 璀璨三組男女道具共用一個機率欄，合併名稱並只計一次權重；",
        " * 皇家美髮／整形仍依性別拆成四池。未模擬性別限制與重分配。",
        " * 機率表起始時間為 09:00；實際開機時間依維護公告與遊戲為準。",
        " * 碎片兌換與到期未納入模擬。圖示未逐項確認，維持不顯示。",
        " * id 保留 UI 相容性；editionId 識別期別。歷史道具收錄由",
        " * tools/gacha_archive.json 管理，勿用重複的 eventAdId 覆蓋舊期。",
        " */",
        "const GACHA_BOXES = [",
    ]
    for box in boxes:
        lines.append("  {")
        for key, value in box.items():
            if key != "items":
                lines.append(f"    {key}: {json.dumps(value, ensure_ascii=False)},")
        lines.append("    items: [")
        for item in box["items"]:
            fields = [f'name: {json.dumps(item["name"], ensure_ascii=False)}']
            if "rarity" in item:
                fields.append(f'rarity: "{item["rarity"]}"')
            fields.append(f'weight: {item["weight"]:.2f}')
            lines.append("      { " + ", ".join(fields) + " },")
        lines.extend(["    ],", "  },"])
    lines.extend([
        "];", "", "window.MapleGachaBoxes = GACHA_BOXES;", "",
    ])
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--patch", action="store_true", help="Print the reviewed data update as an apply_patch patch")
    args = parser.parse_args()
    boxes = official_boxes()
    if args.patch:
        old = (ROOT / "js/gachaData.js").read_text(encoding="utf-8")
        new = render_data(boxes)
        print("*** Begin Patch\n*** Update File: maple-classic-calc/js/gachaData.js\n@@")
        for line in old.splitlines():
            print("-" + line)
        for line in new.splitlines():
            print("+" + line)
        print("*** End Patch")
        return
    node_code = "const fs=require('fs'),vm=require('vm'),c={window:{}};vm.runInNewContext(fs.readFileSync('js/gachaData.js','utf8'),c);console.log(JSON.stringify(c.window.MapleGachaBoxes));"
    local = json.loads(subprocess.check_output(["node", "-e", node_code], cwd=ROOT, encoding="utf-8"))
    require(local == boxes, "Local simulator differs from the live official tables; inspect --patch")
    for box in boxes:
        total = sum(Decimal(str(x["weight"])) for x in box["items"])
        print(f'verified-live: {box["id"]}: {len(box["items"])} prizes, {total:.2f}%, {box["period"]}')
    print("Every simulator prize, rate, tier and period matches the live official tables.")


if __name__ == "__main__":
    main()
