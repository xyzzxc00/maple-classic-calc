# -*- coding: utf-8 -*-
"""SEO 文案把關：擋掉「畫面看起來正常、其實對搜尋引擎有害」的錯。

這支防的是三類人工維護遲早會破的東西：

1. **FAQ 的 JSON-LD 與可見 HTML 逐字一致** — Google 對 FAQPage 的硬性要求，
   對不上整組 rich result 會消失，而且不會通知你。兩邊是分開手寫的，改一
   邊忘了改另一邊是遲早的事。

2. **資料筆數對得上實際資料檔** — 怪物 68／道具 1,373 這種數字散在 Dataset
   JSON-LD、FAQ、llms.txt 至少四五處手寫。2026-08-09 的稽核就抓到 Dataset
   寫 1,372、其他地方寫 1,373；還有「2,000+ 件裝備」實際只有 969 的誇大。

3. **文案硬規則** — 全站不得出現「Artale」；不得承諾「持續更新」。
   後者要注意：描述「正服是持續更新的版本」或「巴哈某篇文章持續更新中」
   是在講別人，不算違規，所以只擋「本站」語境下的承諾。

4. **sitemap 列的網址不能帶 noindex** — 兩邊在對 Google 講相反的話。
   2026-08-10 收過一次 Search Console 提醒，來源是隱私政策頁。

用法：python tools/check_seo_copy.py
有問題時 exit 1。

**注意：圖片裡的文字這支抓不到**（og-image.png 曾經整整一個月印著
「資料持續更新中」）。改圖時要自己看一眼，見 tools/build_og.py 的說明。
"""
import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(ROOT, "data", "db")


def read(rel):
    with io.open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return f.read()


def strip_tags(s):
    return re.sub(r"<[^>]+>", "", s).strip()


def check_faq(problems):
    html = read("index.html")
    faq = None
    for block in re.findall(r'<script type="application/ld\+json">(.*?)</script>', html, re.S):
        try:
            data = json.loads(block)
        except json.JSONDecodeError as e:
            problems.append(f"JSON-LD 解析失敗：{e}")
            continue
        if data.get("@type") == "FAQPage":
            faq = data
    if not faq:
        problems.append("index.html 找不到 FAQPage 結構化資料")
        return

    visible = re.findall(
        r'<details class="faq-item">\s*<summary>(.*?)</summary>\s*<p>(.*?)</p>', html, re.S
    )
    ld = faq.get("mainEntity") or []
    if len(ld) != len(visible):
        problems.append(f"FAQ 題數不符：JSON-LD {len(ld)} 題、可見 HTML {len(visible)} 題")
        return

    for i, (q, (vq, va)) in enumerate(zip(ld, visible), 1):
        name = (q.get("name") or "").strip()
        text = ((q.get("acceptedAnswer") or {}).get("text") or "").strip()
        if strip_tags(vq) != name:
            problems.append(f"FAQ 第 {i} 題的「問題」文字與 JSON-LD 不一致：{strip_tags(vq)[:30]}")
        if strip_tags(va) != text:
            problems.append(f"FAQ 第 {i} 題的「答案」文字與 JSON-LD 不一致：{name[:30]}")
    print(f"FAQ    {len(ld)} 題，JSON-LD 與可見 HTML 逐字比對完成")


def check_guides_faq(problems):
    """guides 頁的 FAQPage JSON-LD 也要跟可見文字逐字一致。

    index.html 的 FAQ 是 <details class="faq-item"> 結構、上面 check_faq 管；
    guides 頁是 article-faq-q/a 結構，且答案文字可能夾在更長的內文段落裡，
    所以這裡放寬成「LD 的問題與答案文字（去空白後）必須逐字出現在頁面的
    可見文字裡」——Google 的要求本來就是「使用者在頁面上看得到這些字」，
    不要求一模一樣的排版。2026-08-15 的稽核抓到 6 頁只有 JSON-LD、頁面上
    完全沒有可見的 FAQ 區塊，這種會整組 rich result 無聲消失。
    """
    import html as htmllib

    pages = []
    guides_dir = os.path.join(ROOT, "guides")
    for d in sorted(os.listdir(guides_dir)):
        p = os.path.join(guides_dir, d, "index.html")
        if os.path.isdir(os.path.join(guides_dir, d)) and os.path.exists(p):
            pages.append(os.path.relpath(p, ROOT).replace("\\", "/"))

    checked = 0
    for rel in pages:
        raw = read(rel)
        faq = None
        for block in re.findall(r'<script type="application/ld\+json">(.*?)</script>', raw, re.S):
            try:
                data = json.loads(block)
            except json.JSONDecodeError as e:
                problems.append(f"{rel} JSON-LD 解析失敗：{e}")
                continue
            if data.get("@type") == "FAQPage":
                faq = data
        if not faq:
            continue
        checked += 1
        visible = re.sub(r"<script.*?</script>", "", raw, flags=re.S)
        visible = re.sub(r"<style.*?</style>", "", visible, flags=re.S)
        visible = re.sub(r"<[^>]+>", "", visible)
        visible = re.sub(r"\s+", "", htmllib.unescape(visible))
        for q in faq.get("mainEntity") or []:
            name = (q.get("name") or "").strip()
            text = ((q.get("acceptedAnswer") or {}).get("text") or "").strip()
            if re.sub(r"\s+", "", htmllib.unescape(name)) not in visible:
                problems.append(f"{rel} FAQ 問題不在可見文字裡：{name[:40]}")
            if re.sub(r"\s+", "", htmllib.unescape(text)) not in visible:
                problems.append(f"{rel} FAQ 答案不在可見文字裡：{name[:40]}")
    print(f"FAQ    guides {checked} 頁的 FAQPage 與可見文字比對完成")


def check_counts(problems):
    """文案裡寫的筆數要對得上實際資料檔"""
    def count(name):
        with io.open(os.path.join(DB, name), encoding="utf-8") as f:
            return len(json.load(f))

    actual = {
        "怪物": count("monsters.json"),
        "地圖": count("maps.json"),
        "道具": count("items.json"),
        "NPC": count("npcs.json"),
        "任務": count("quests.json"),
        "技能": count("skills.json"),
    }
    with io.open(os.path.join(DB, "scroll_sim.json"), encoding="utf-8") as f:
        sim = json.load(f)
    actual["裝備"] = len(sim["equipment"])
    actual["卷軸"] = len(sim["scrolls"])

    corpus = {"index.html": read("index.html"), "llms.txt": read("llms.txt")}
    # 「道具 1,373 件」「怪物 68 種」這類寫法：抓出文案宣稱的數字來比對
    units = {"怪物": "種", "地圖": "張", "道具": "件", "NPC": "位", "任務": "個",
             "技能": "個", "裝備": "件", "卷軸": "種"}
    for label, n in actual.items():
        unit = units[label]
        pattern = re.compile(re.escape(label) + r"\s*([0-9][0-9,]*)\s*\+?\s*" + unit)
        for fname, text in corpus.items():
            for m in pattern.finditer(text):
                claimed = int(m.group(1).replace(",", ""))
                if claimed != n:
                    problems.append(
                        f"{fname} 寫「{label} {m.group(1)} {unit}」，實際資料是 {n:,} 筆"
                    )
    print("筆數   " + "、".join(f"{k} {v:,}" for k, v in actual.items()))


def check_copy_rules(problems):
    """文案硬規則：不得出現 Artale、不得承諾本站持續更新"""
    targets = ["index.html", "llms.txt", "robots.txt", "manifest.webmanifest"]
    for root, dirs, files in os.walk(os.path.join(ROOT, "guides")):
        dirs[:] = [d for d in dirs if d not in (".git", "node_modules")]
        for f in files:
            if f.endswith(".html"):
                targets.append(os.path.relpath(os.path.join(root, f), ROOT))

    # 「持續更新」在講別人（正服、第三方文章）時不算違規，只擋本站語境
    ours = re.compile(r"(本站|這個?站|資料)[^。；\n]{0,12}(持續|不斷|每日|每週)更新")
    for rel in targets:
        text = read(rel.replace("\\", "/"))
        if re.search(r"artale", text, re.I):
            problems.append(f"{rel} 出現「Artale」（全站文案硬規則：不得出現）")
        m = ours.search(text)
        if m:
            problems.append(f"{rel} 出現本站的更新承諾「{m.group(0)}」（硬規則：不承諾持續更新）")
    print(f"文案   檢查 {len(targets)} 個檔案的 Artale 與更新承諾")


def check_sitemap_indexable(problems):
    """sitemap 列出來的網址，頁面不能帶 noindex。

    這兩件事互相矛盾：sitemap 是在跟 Google 說「請收錄」，noindex 是在說
    「別收錄」。不會被懲罰，但 Search Console 會永久掛著一則「遭到 noindex
    標記排除」——2026-08-10 就收到過一次，來源是隱私政策頁。真正的代價是
    看習慣之後，哪天真的有頁面被誤設 noindex 也會一起被忽略。

    只檢查 sitemap.xml 裡手寫的那些；怪物靜態頁是 build_monster_pages.py
    產的、共用同一份外殼，不會單獨帶 noindex。
    """
    sitemap = read("sitemap.xml")
    locs = re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", sitemap)
    checked = 0
    for url in locs:
        path = re.sub(r"^https?://[^/]+/", "", url)
        rel = (path + "index.html") if path.endswith("/") or path == "" else path
        full = os.path.join(ROOT, rel.replace("/", os.sep))
        if not os.path.exists(full):
            # 建置時才產生的頁面（怪物靜態頁）在原始碼裡本來就不存在，跳過
            continue
        checked += 1
        if re.search(r'<meta[^>]+name=["\']robots["\'][^>]*noindex', read(rel), re.I):
            problems.append(
                f"{url} 在 sitemap 裡，但 {rel} 帶著 noindex"
                "（兩者矛盾：要嘛從 sitemap 拿掉，要嘛拿掉 noindex）"
            )
    print(f"索引   sitemap {len(locs)} 條，比對 {checked} 個原始碼頁面的 noindex")


def main():
    problems = []
    check_faq(problems)
    check_guides_faq(problems)
    check_counts(problems)
    check_copy_rules(problems)
    check_sitemap_indexable(problems)
    print()
    if problems:
        for p in problems:
            print("::error::" + p)
        print(f"問題：{len(problems)} 項")
        return 1
    print("問題：無")
    return 0


if __name__ == "__main__":
    sys.exit(main())
