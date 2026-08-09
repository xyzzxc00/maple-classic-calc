# -*- coding: utf-8 -*-
"""把怪物靜態頁的網址併進 sitemap.xml。

手寫的 sitemap.xml 只列首頁、guides/ 與 privacy/；怪物頁有 68 頁又會隨資料
更新增減，手動維護一定會漏。這支在建置階段把它們接到既有 sitemap 後面，
不動原本那幾條（它們的 lastmod 由 CI 另外戳真實 git 日期）。

lastmod 用「怪物資料檔的 git 最後修改日」而不是建置日：怪物頁佔了 sitemap
的 85%，全部戳今天等於每次部署都謊報「全站今天更新」，即使這次只改了 CSS。
Google 對長期不準的 lastmod 會降低信任——deploy.yml 的註解記過這個教訓，
guides 那批已經改用真實 git 日期，這裡當時漏了。拿不到 git 日期時（淺層
clone、非 git 環境）才退回傳入的建置日。

用法：python tools/build_sitemap_db.py <sitemap路徑> <日期YYYY-MM-DD>
"""
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = "https://mapleclassictools.com"


def git_day(paths):
    """這幾個路徑最後一次被 commit 的日期（YYYY-MM-DD）；拿不到就回 None"""
    try:
        out = subprocess.run(
            ["git", "log", "-1", "--format=%cs", "--"] + paths,
            cwd=ROOT, capture_output=True, text=True, timeout=20,
        )
        day = (out.stdout or "").strip()
        return day if len(day) == 10 else None
    except Exception:
        return None


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

    # 怪物頁的內容完全由 data/db/monsters* 與產生器決定，拿這些檔案的 git
    # 最後修改日當 lastmod 才是誠實的值
    data_day = git_day([
        "data/db/monsters.json",
        "data/db/monsters",
        "tools/build_monster_pages.py",
    ]) or today

    rows = [
        "  <url>\n"
        f"    <loc>{BASE}/db/monster/</loc>\n"
        f"    <lastmod>{data_day}</lastmod>\n"
        "    <changefreq>weekly</changefreq>\n"
        "    <priority>0.7</priority>\n"
        "  </url>"
    ]
    for r in index:
        rows.append(
            "  <url>\n"
            f"    <loc>{BASE}/db/monster/{r['id']}/</loc>\n"
            f"    <lastmod>{data_day}</lastmod>\n"
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
