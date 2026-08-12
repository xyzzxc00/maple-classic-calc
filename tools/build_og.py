# -*- coding: utf-8 -*-
"""OG 預覽圖產生器：左側橄欖綠側欄（呼應改版後 UI）＋右側四大功能群卡片。
色票直接抄 style.css 的 :root，字型用站上同一套 Noto Sans TC（可變字重）。

用法：python tools/build_og.py（直接覆蓋 og-image.png）

**改完圖一定要把全站的 `og-image.png?v=` 版本號 +1**，不然分享出去的卡片
會是 CDN 快取裡的舊圖。範圍：index.html、guides/*/index.html、404.html、
privacy/index.html。

圖上的文案受兩條硬規則約束：不得出現「Artale」、不得承諾「持續更新」。
純文字 grep 抓不到圖片裡的字，改圖時要自己看一眼。"""
from PIL import Image, ImageDraw, ImageFont

W, H = 2400, 1260
BG = "#F6F5F1"; SURFACE = "#FFFFFF"; TINT = "#EFEDE4"
INK = "#292A24"; SOFT = "#626358"; BORDER = "#E3E1D7"
ACCENT = "#5C6640"; ACCENT_TINT = "#ECEEE1"; ACCENT_BORDER = "#7C8262"

import os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONT = os.path.join(ROOT, "assets", "NotoSansTC-VF.ttf")

def font(size, weight):
    f = ImageFont.truetype(FONT, size)
    f.set_variation_by_axes([weight])
    return f

img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)

# ---------------- 左側側欄 ----------------
SIDEBAR_W = 760
d.rectangle([0, 0, SIDEBAR_W, H], fill=ACCENT)

# 白葉 logo：icon-512 是白葉壓在橄欖底上，抓亮像素當遮罩重畫
icon = Image.open(r"C:/Users/xornv/OneDrive/桌面/maple-classic/maple-classic-calc/icon-512.png").convert("RGB")
mask = icon.point(lambda *_: 0).convert("L")
px = icon.load(); mk = mask.load()
for y in range(icon.height):
    for x in range(icon.width):
        r, g, b = px[x, y]
        if r > 200 and g > 200 and b > 200:
            mk[x, y] = 255
LEAF = 220
leaf_mask = mask.resize((LEAF, LEAF), Image.LANCZOS)
leaf = Image.new("RGB", (LEAF, LEAF), "#FFFFFF")
img.paste(leaf, (96, 150), leaf_mask)

# 品牌名：icon 旁邊掛「楓錄」，跟站上側邊欄 logo 同一種排法（icon + 站名並排）
d.text((340, 190), "楓錄", font=font(120, 900), fill="#FFFFFF")

# 站名：兩行式，撐滿側欄寬度不外溢
d.text((96, 440), "新楓之谷", font=font(150, 900), fill="#FFFFFF")
d.text((96, 620), "經典版", font=font(150, 900), fill="#FFFFFF")
d.text((100, 828), "練等 × 資料庫 × 社群工具", font=font(52, 500), fill="#E4E7D6")

# 非官方標示（貼近站上頂欄的誠實標語，取代過期的開服日期）
pill_f = font(36, 500)
pt = "玩家自製的非官方工具站"
pw = d.textlength(pt, font=pill_f)
d.rounded_rectangle([100, 936, 100 + pw + 64, 936 + 84], radius=42,
                    outline="#9AA37E", width=3)
d.text((132, 956), pt, font=pill_f, fill="#E4E7D6")

# 網域
d.text((100, 1110), "mapleclassictools.com", font=font(50, 600), fill="#C9CFB4")

# ---------------- 右側功能群卡片 ----------------
groups = [
    ("計算工具", ["練等計算", "攻擊力計算", "命中計算", "卷軸強化", "轉蛋模擬"], None),
    ("資料庫", ["怪物", "地圖", "世界", "道具", "NPC", "任務", "技能"], "2,500+ 筆"),
    ("玩法攻略", ["任務攻略", "職業攻略", "組隊任務", "BOSS攻略"], None),
    ("社群資料", ["練功地點回報", "推薦練功地點"], None),
]

GX = SIDEBAR_W + 96
GW = W - GX - 96
CARD_H = 240
GAP = 36
top = (H - (CARD_H * 4 + GAP * 3)) // 2

label_f = font(52, 700)
badge_f = font(38, 600)
chip_f = font(46, 500)

for i, (label, chips, badge) in enumerate(groups):
    cy = top + i * (CARD_H + GAP)
    d.rounded_rectangle([GX, cy, GX + GW, cy + CARD_H], radius=28,
                        fill=SURFACE, outline=BORDER, width=3)
    d.text((GX + 52, cy + 34), label, font=label_f, fill=INK)
    if badge:
        bw = d.textlength(badge, font=badge_f)
        lx = GX + 52 + d.textlength(label, font=label_f) + 32
        d.rounded_rectangle([lx, cy + 40, lx + bw + 48, cy + 40 + 62], radius=31,
                            fill=ACCENT_TINT)
        d.text((lx + 24, cy + 48), badge, font=badge_f, fill=ACCENT)
    # 晶片列
    x = GX + 52
    chy = cy + 130
    for c in chips:
        cw = d.textlength(c, font=chip_f)
        d.rounded_rectangle([x, chy, x + cw + 64, chy + 78], radius=39,
                            fill=TINT)
        d.text((x + 32, chy + 12), c, font=chip_f, fill=INK)
        x += cw + 64 + 24

import os
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "og-image.png")
img.save(OUT, optimize=True)
print(f"已產生 {OUT}（{os.path.getsize(OUT) // 1024} KB）")
print("記得把 index.html／guides／404／privacy 的 og-image.png?v= 版本號一起 +1")
print("done", img.size)
