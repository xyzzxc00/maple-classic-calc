# -*- coding: utf-8 -*-
"""把怪物靜態頁的網址併進 sitemap.xml。

手寫的 sitemap.xml 只列首頁、guides/ 與 privacy/；怪物頁有 68 頁又會隨資料
更新增減，手動維護一定會漏。這支在建置階段把它們接到既有 sitemap 後面，
不動原本那幾條（它們的 lastmod 由 CI 另外戳真實 git 日期）。

用法：python tools/build_sitemap_db.py <sitemap路徑> <日期YYYY-MM-DD>
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = "https://mapleclassictools.com"


def main():
    if len(sys.argv) < 3:
        print("用法：python tools/build_sitemap_db.py <sitemap路徑> <日期>")
        return 1
    path, today = sys.argv[1], sys.argv[2]

    with open(path, encoding="utf-8") as f:
        xml = f.read()
    if "</urlset>" not in xml:
        print("::error::sitemap.xml 找不到 </urlset>，格式可能改過了")
        return 1
    if f"{BASE}/db/monster/" in xml:
        print("sitemap 已經有怪物頁的網址了，跳過")
        return 0

    index = json.load(open(os.path.join(ROOT, "data", "db", "monsters.json"), encoding="utf-8"))
    index = sorted(index, key=lambda r: ((r.get("level") or 0), r["name"]))

    rows = [
        "  <url>\n"
        f"    <loc>{BASE}/db/monster/</loc>\n"
        f"    <lastmod>{today}</lastmod>\n"
        "    <changefreq>weekly</changefreq>\n"
        "    <priority>0.7</priority>\n"
        "  </url>"
    ]
    for r in index:
        rows.append(
            "  <url>\n"
            f"    <loc>{BASE}/db/monster/{r['id']}/</loc>\n"
            f"    <lastmod>{today}</lastmod>\n"
            "    <changefreq>monthly</changefreq>\n"
            "    <priority>0.5</priority>\n"
            "  </url>"
        )

    xml = xml.replace("</urlset>", "\n".join(rows) + "\n</urlset>")
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(xml)
    print(f"sitemap 併入 {len(rows)} 條怪物頁網址")
    return 0


if __name__ == "__main__":
    sys.exit(main())
