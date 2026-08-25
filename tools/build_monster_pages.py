# -*- coding: utf-8 -*-
"""替每一隻怪物產生一頁靜態頁（db/monster/<id>/index.html）。

為什麼要這個：資料庫是單頁應用，2,400 多筆資料全在同一個網址底下，搜尋
引擎只看得到首頁。玩家搜「火獨眼獸 掉落」的時候我們沒有任何頁面能被收錄。
這支把怪物那 68 筆先做成真正的靜態頁——各自有網址、有標題、有內文、有
結構化資料，能被索引也能被分享。

刻意只做怪物：量最小、搜尋意圖最明確（查掉落、查在哪出沒），先驗證有沒有
成效再決定要不要擴到道具那 1,300 多筆。

頁面本身是伺服器端就渲染好的完整內容，不依賴 JS；載入後右上角有按鈕可以
跳回互動版（有練等試算與命中率試算的那個）。

用法：python tools/build_monster_pages.py [輸出根目錄]
     預設輸出到 repo 根目錄的 db/，由 CI 複製進 dist/
"""
import html
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(ROOT, "data", "db")
BASE = "https://mapleclassictools.com"

EL_NAME = {"fire": "火", "ice": "冰", "lightning": "雷", "poison": "毒", "holy": "聖"}
EL_LABEL = {"normal": "一般", "weak": "弱點", "resist": "抗性", "immune": "免疫"}
STAT_LABELS = [
    ("maxHP", "HP"), ("maxMP", "MP"), ("exp", "經驗值"),
    ("PADamage", "物理攻擊"), ("PDDamage", "物理防禦"),
    ("MADamage", "魔法攻擊"), ("MDDamage", "魔法防禦"),
    ("acc", "命中"), ("eva", "迴避"), ("speed", "移動速度"),
]


def esc(s):
    return html.escape(str(s), quote=True)


def num(n):
    return f"{n:,}" if isinstance(n, (int, float)) else str(n)


def page(mon, prev_next):
    mid = mon["id"]
    name = mon["name"]
    lv = mon.get("level")
    st = mon.get("stats") or {}
    regions = sorted({m["region"] for m in mon.get("maps") or [] if m.get("region")})
    maps = mon.get("maps") or []
    drops = mon.get("drops") or []

    # 標題與描述直接寫進「玩家會搜的字」：怪物名＋等級＋掉落＋出沒地圖
    where = "、".join(m["name"] for m in maps[:3])
    title = f"{name}（Lv.{lv}）掉落物與出沒地圖｜新楓之谷經典版資料庫"
    desc_bits = [f"新楓之谷經典版 {name} 是 Lv.{lv} 的怪物"]
    if st.get("maxHP"):
        desc_bits.append(f"HP {num(st['maxHP'])}")
    if st.get("exp"):
        desc_bits.append(f"經驗值 {num(st['exp'])}")
    if where:
        desc_bits.append(f"出沒於{where}")
    if drops:
        desc_bits.append(f"會掉落 {len(drops)} 種道具")
    description = "，".join(desc_bits) + "。"

    stat_rows = "".join(
        f"<div><dt>{esc(label)}</dt><dd>{num(st[k])}</dd></div>"
        for k, label in STAT_LABELS if st.get(k) is not None
    )
    el_vals = (mon.get("elemental") or {}).get("values") or {}
    el_rows = "".join(
        f'<div class="db-el db-el--{esc(el_vals.get(k, "normal"))}">'
        f'<span class="db-el-name">{esc(v)}</span>'
        f'<span class="db-el-value">{esc(EL_LABEL.get(el_vals.get(k, "normal"), "一般"))}</span></div>'
        for k, v in EL_NAME.items()
    )

    meso = mon.get("meso") or {}
    meso_html = ""
    if meso.get("unverified"):
        # BOSS 與召喚後消失的怪：沒有可靠的楓幣資料，講清楚而不是掛數字
        # （理由見 tools/import_db.py，跟站上的動態頁維持一致）
        meso_html = (
            '<section class="db-section"><h2 class="db-section-title">楓幣掉落</h2>'
            '<p class="db-section-note">這隻的楓幣掉落沒有可靠資料。現有數字來自其他版本伺服器'
            '資料表或公式推估，未經本服實測確認；玩家實測多隻 BOSS 不會掉落楓幣，因此這裡不列數字。</p></section>'
        )
    elif meso.get("min") is not None:
        note = f"（{esc(meso['note'])}）" if meso.get("note") else ""
        meso_html = (
            '<section class="db-section"><h2 class="db-section-title">楓幣掉落</h2>'
            f'<p class="db-meso">{num(meso["min"])} ~ {num(meso["max"])}{note}</p></section>'
        )

    map_rows = "".join(
        f'<li>{esc(m["name"])}'
        f'<span class="db-sub-meta"> {esc(" · ".join(x for x in (m.get("region"), m.get("street")) if x))}</span>'
        f'<span class="db-sub-num"> {m["spawns"]} 個重生點</span></li>'
        for m in maps
    ) or "<li>沒有出沒地圖資料</li>"

    drop_rows = "".join(
        f'<li>{esc(d["name"])}'
        + (f'<span class="db-sub-meta"> {esc(d.get("sub") or d.get("cat"))}</span>' if (d.get("sub") or d.get("cat")) else "")
        + (f'<span class="db-sub-num"> 需求 Lv.{d["equip"]["reqLevel"]}</span>'
           if (d.get("equip") or {}).get("reqLevel") else "")
        + "</li>"
        for d in drops
    ) or "<li>沒有掉落資料</li>"

    hidden_note = (
        f'<p class="db-section-note">另有 {mon["hiddenDrops"]} 項在遊戲資料裡沒有名稱與圖示，未列出。</p>'
        if mon.get("hiddenDrops") else ""
    )

    quests = mon.get("quests") or []
    quest_html = ""
    if quests:
        rows = "".join(
            f'<li>{esc(q["name"])}'
            + (f'<span class="db-sub-num"> 需要 {q["count"]} 隻</span>' if q.get("count") else "")
            + "</li>"
            for q in quests
        )
        quest_html = (
            '<section class="db-section"><h2 class="db-section-title">相關任務</h2>'
            f'<ul class="static-list">{rows}</ul></section>'
        )

    prev_link, next_link = prev_next
    nav_bits = []
    if prev_link:
        nav_bits.append(f'<a href="../{prev_link["id"]}/">← {esc(prev_link["name"])}（Lv.{prev_link["level"]}）</a>')
    if next_link:
        nav_bits.append(f'<a href="../{next_link["id"]}/">{esc(next_link["name"])}（Lv.{next_link["level"]}）→</a>')
    sibling_nav = (
        f'<nav class="static-sibling">{"".join(nav_bits)}</nav>' if nav_bits else ""
    )

    # 結構化資料：怪物本身沒有對應的 schema.org 型別，用 Article 包住比較
    # 誠實——這頁的本質是「一篇關於這隻怪的資料整理」；再掛 BreadcrumbList
    # 讓搜尋結果顯示層級
    ld = {
        "@context": "https://schema.org",
        "@type": "Article",
        "headline": title,
        "description": description,
        "inLanguage": "zh-TW",
        "author": {"@type": "Person", "name": "xyzzxc00"},
        "publisher": {"@type": "Organization", "name": "新楓之谷經典版 練等 × 社群工具"},
        "mainEntityOfPage": f"{BASE}/db/monster/{mid}/",
        "about": {
            "@type": "Game",
            "name": "新楓之谷經典版",
        },
    }
    crumbs = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "首頁", "item": f"{BASE}/"},
            {"@type": "ListItem", "position": 2, "name": "怪物資料庫", "item": f"{BASE}/db/monster/"},
            {"@type": "ListItem", "position": 3, "name": name, "item": f"{BASE}/db/monster/{mid}/"},
        ],
    }

    region_line = "、".join(regions) if regions else "—"
    return f"""<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<script async src="https://www.googletagmanager.com/gtag/js?id=G-PC7RFW707Y"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){{dataLayer.push(arguments);}}
  gtag('js', new Date());
  gtag('config', 'G-PC7RFW707Y');
</script>
<title>{esc(title)}</title>
<meta name="description" content="{esc(description)}">
<meta name="theme-color" content="#F6F5F1" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#1C1D19" media="(prefers-color-scheme: dark)">
<link rel="icon" type="image/svg+xml" href="../../../favicon.svg">
<link rel="icon" type="image/png" sizes="192x192" href="../../../icon-192.png">
<link rel="apple-touch-icon" href="../../../icon-192.png">
<meta property="og:type" content="article">
<meta property="og:site_name" content="新楓之谷經典版 練等 × 社群工具">
<meta property="og:locale" content="zh_TW">
<meta property="og:url" content="{BASE}/db/monster/{mid}/">
<meta property="og:image" content="{BASE}/assets/db/monsters/{mid}.png">
<meta property="og:title" content="{esc(title)}">
<meta property="og:description" content="{esc(description)}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="{esc(title)}">
<meta name="twitter:description" content="{esc(description)}">
<meta name="twitter:image" content="{BASE}/assets/db/monsters/{mid}.png">
<link rel="canonical" href="{BASE}/db/monster/{mid}/">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700;900&display=swap" rel="stylesheet">
<link rel="stylesheet" href="../../../style.css">
<script type="application/ld+json">
{json.dumps(ld, ensure_ascii=False, indent=2)}
</script>
<script type="application/ld+json">
{json.dumps(crumbs, ensure_ascii=False, indent=2)}
</script>
</head>
<body>
<script>
  (function () {{
    var saved = localStorage.getItem("maple_classic_theme");
    var isDark = saved
      ? saved === "dark"
      : window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    if (isDark) document.body.classList.add("dark");
  }})();
</script>

<button class="theme-toggle" id="themeToggle" type="button">暗色</button>

<header class="site-header site-header--short">
  <div class="wrap">
    <h1 class="title">{esc(name)}</h1>
    <p class="subtitle">Lv.{lv}　{esc(region_line)}</p>
  </div>
</header>

<main>
<div class="article-wrap">
  <p class="article-breadcrumb"><a href="../../../#home">首頁</a> ／ <a href="../../../#db-monsters">怪物資料庫</a> ／ <a href="../">全部怪物</a> ／ {esc(name)}</p>

  <article class="article-body static-monster">
    <div class="static-hero">
      <img src="../../../assets/db/monsters/{mid}.png" alt="{esc(name)}" width="64" height="64" decoding="async">
      <p>{esc(mon.get("desc") or "")}</p>
    </div>

    <p class="static-cta"><a class="btn btn-primary" href="../../../?db=monster&amp;id={mid}">在資料庫開啟（可用練等試算與命中率試算）→</a></p>

    <section class="db-section">
      <h2 class="db-section-title">數值</h2>
      <dl class="db-stat-grid">{stat_rows}</dl>
    </section>

    <section class="db-section">
      <h2 class="db-section-title">屬性抗性</h2>
      <div class="db-el-row">{el_rows}</div>
    </section>

    {meso_html}

    <section class="db-section">
      <h2 class="db-section-title">出沒地圖<span class="db-sub-num">{len(maps)}</span></h2>
      <ul class="static-list">{map_rows}</ul>
      <p class="db-section-note">上面是遊戲資料檔記錄的重生點數量，不等於實際練功效率。</p>
    </section>

    <section class="db-section">
      <h2 class="db-section-title">掉落物品<span class="db-sub-num">{len(drops)}</span></h2>
      <p class="db-section-note">遊戲資料檔沒有記錄掉落機率，這裡只列出「會掉什麼」。</p>
      <ul class="static-list">{drop_rows}</ul>
      {hidden_note}
    </section>

    {quest_html}

    {sibling_nav}

    <p class="db-section-note">資料整理自遊戲資料檔，只收錄目前已開放的地區與 Lv.100 以下內容。
      想查其他怪物、地圖、道具、任務或技能，到<a href="../../../#db-monsters">資料庫</a>用名稱搜尋。</p>
  </article>
</div>
</main>

<script defer src="../../../js/theme.js"></script>
<script defer src="../../../js/backToTop.js"></script>
</body>
</html>
"""


def main():
    out_root = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "db", "monster")
    index = json.load(open(os.path.join(DB, "monsters.json"), encoding="utf-8"))
    # 依等級排序，讓上一隻／下一隻的導覽是有意義的順序（等級相近的怪）
    index = sorted(index, key=lambda r: ((r.get("level") or 0), r["name"]))

    os.makedirs(out_root, exist_ok=True)
    written = 0
    for i, row in enumerate(index):
        mid = str(row["id"])
        with open(os.path.join(DB, "monsters", f"{mid}.json"), encoding="utf-8") as f:
            mon = json.load(f)
        prev_row = index[i - 1] if i > 0 else None
        next_row = index[i + 1] if i + 1 < len(index) else None
        folder = os.path.join(out_root, mid)
        os.makedirs(folder, exist_ok=True)
        with open(os.path.join(folder, "index.html"), "w", encoding="utf-8", newline="\n") as f:
            f.write(page(mon, (prev_row, next_row)))
        written += 1

    # 列表頁：讓 68 頁彼此連得到，也給搜尋引擎一個爬得完的入口
    items = "".join(
        f'<li><a href="{r["id"]}/">{esc(r["name"])}</a>'
        f'<span class="db-sub-meta"> Lv.{r.get("level")}</span>'
        f'<span class="db-sub-num"> {r.get("drops", 0)} 種掉落</span></li>'
        for r in index
    )
    listing = f"""<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<script async src="https://www.googletagmanager.com/gtag/js?id=G-PC7RFW707Y"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){{dataLayer.push(arguments);}}
  gtag('js', new Date());
  gtag('config', 'G-PC7RFW707Y');
</script>
<title>怪物資料庫｜新楓之谷經典版 {len(index)} 種怪物數值與掉落物</title>
<meta name="description" content="新楓之谷經典版目前已開放地區的 {len(index)} 種怪物一覽：等級、HP、經驗值、掉落物與出沒地圖，點進去看單隻怪的完整資料。">
<meta name="theme-color" content="#F6F5F1" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#1C1D19" media="(prefers-color-scheme: dark)">
<link rel="icon" type="image/svg+xml" href="../../favicon.svg">
<link rel="icon" type="image/png" sizes="192x192" href="../../icon-192.png">
<link rel="apple-touch-icon" href="../../icon-192.png">
<meta property="og:type" content="website">
<meta property="og:site_name" content="新楓之谷經典版 練等 × 社群工具">
<meta property="og:locale" content="zh_TW">
<meta property="og:url" content="{BASE}/db/monster/">
<meta property="og:image" content="{BASE}/og-image.png">
<meta property="og:title" content="怪物資料庫｜新楓之谷經典版 {len(index)} 種怪物數值與掉落物">
<meta property="og:description" content="{len(index)} 種怪物的等級、HP、經驗值、掉落物與出沒地圖。">
<meta name="twitter:card" content="summary_large_image">
<link rel="canonical" href="{BASE}/db/monster/">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700;900&display=swap" rel="stylesheet">
<link rel="stylesheet" href="../../style.css">
</head>
<body>
<script>
  (function () {{
    var saved = localStorage.getItem("maple_classic_theme");
    var isDark = saved
      ? saved === "dark"
      : window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    if (isDark) document.body.classList.add("dark");
  }})();
</script>

<button class="theme-toggle" id="themeToggle" type="button">暗色</button>

<header class="site-header site-header--short">
  <div class="wrap">
    <h1 class="title">怪物資料庫</h1>
    <p class="subtitle">目前已開放地區的 {len(index)} 種怪物，依等級排序</p>
  </div>
</header>

<main>
<div class="article-wrap">
  <p class="article-breadcrumb"><a href="../../#home">首頁</a> ／ 怪物資料庫</p>
  <article class="article-body">
    <p>每一隻怪的數值、屬性抗性、楓幣與道具掉落、出沒地圖與重生點數量。想用搜尋、篩選或練等／命中率試算，到<a href="../../#db-monsters">互動版資料庫</a>。</p>
    <ul class="static-list static-list--links">{items}</ul>
  </article>
</div>
</main>

<script defer src="../../js/theme.js"></script>
<script defer src="../../js/backToTop.js"></script>
</body>
</html>
"""
    with open(os.path.join(out_root, "index.html"), "w", encoding="utf-8", newline="\n") as f:
        f.write(listing)

    print(f"產生 {written} 頁怪物靜態頁 + 1 頁列表 → {os.path.relpath(out_root, ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
