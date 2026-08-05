"""
patch_html.py — 部署前的 HTML 後製（只動 dist/，原始檔一律不變）

1. index.html：把 js/ 底下一長串個別 script tag 換成打包壓縮後的 bundle.js
2. guides/ 各篇文章＋privacy/：注入主站的外殼（頂欄＋側邊欄），讓這些
   獨立頁看起來就是主站的一個分頁——但網址仍然是各自的 /guides/xxx/、
   /privacy/，靜態頁該有的 SEO（canonical／JSON-LD／sitemap）完全沒動到。

   外殼不是另外手寫一份貼死在每篇文章裡，是「從 dist/index.html 現場擷取
   再改寫」：主站側邊欄之後長出新分頁、改字、隱藏某個子分頁，文章頁下次
   部署就自動跟上，不會變成要兩邊各自維護的孿生 HTML。

   改寫的重點是把「按鈕」換成「連結」：主站的側邊欄按鈕是就地切換分頁
   （不換頁），文章頁沒有那些分頁容器可切，所以改成指回首頁的錨點連結
   （例如 ../../#calc-scroll）。首頁的 nav.js／guides.js／community.js／
   legacySpots.js 本來就看得懂這種 #主分頁-子分頁 錨點，不用寫新邏輯。
"""

import os
import re
import sys

# 預設在 CI 的 dist/ 上動刀；本機想拿別的資料夾試（例如先複製一份到暫存
# 目錄看效果）就設環境變數 DIST_DIR，不用改這支程式
DIST = os.environ.get("DIST_DIR", "dist")

# 側邊欄至少要有這麼多個可點的項目，少於這個數字代表擷取或改寫整批失效了。
# 跟 deploy.yml 那個「JS 打包清單少於 10 個就報錯」同一種保險：這類「沒抓到
# 就默默產出空東西」的 bug 不會有任何錯誤訊息，CI 照樣全綠、網站照樣上線
MIN_SIDEBAR_LINKS = 10


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def write(path, text):
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


def fail(msg):
    print("::error::" + msg)
    sys.exit(1)


# ---------------------------------------------------------------- index.html


def patch_index():
    path = os.path.join(DIST, "index.html")
    html = read(path)
    html = re.sub(r'\s*<script defer src="js/[^"]+"></script>', "", html)
    html = html.replace("</body>", '<script defer src="js/bundle.js"></script>\n</body>')
    write(path, html)
    return html


# ------------------------------------------------- 從 index.html 擷取外殼


def extract(pattern, html, what):
    m = re.search(pattern, html, re.S)
    if not m:
        fail(f"從 index.html 擷取「{what}」失敗，主站的外殼結構可能改過了")
    return m.group(0)


def extract_div(html, opening, what):
    """從 opening 這個開頭標籤起算，數 <div>／</div> 的層數找到真正的結尾。
    不能用非貪婪的正則：那會在第一個 </div> 就收手，碰到有巢狀 div 的區塊
    （頁尾就是兩欄結構）會只擷取到一半，注入後整頁的標籤層數對不起來，而且
    不會有任何錯誤訊息——版面歪掉才會發現"""
    start = html.find(opening)
    if start < 0:
        fail(f"從 index.html 擷取「{what}」失敗，主站的外殼結構可能改過了")
    depth = 0
    for m in re.finditer(r"<div\b|</div>", html[start:]):
        depth += 1 if m.group(0) == "<div" else -1
        if depth == 0:
            return html[start : start + m.end()]
    fail(f"index.html 的「{what}」區塊 <div> 沒有正確收尾")


def extract_shell(index_html):
    """回傳外殼的四個區塊，原封不動的 HTML"""
    return {
        "top": extract_div(index_html, '<div class="top-banner">', "頂欄"),
        "side": extract(r'<aside class="sidebar" id="sidebar">.*?</aside>', index_html, "側邊欄"),
        "backdrop": extract(r'<div class="sidebar-backdrop"[^>]*></div>', index_html, "手機版遮罩"),
        "footer": extract_div(index_html, '<div class="app-main-footer">', "頁尾免責聲明"),
    }


# --------------------------------------------- 把外殼改寫成「文章頁版本」


def subtab_hash(el_id):
    """側邊欄子分頁的 id → 首頁錨點。calcSubExp → calc-exp、
    legacySubJobBuilds → legacy-jobBuilds（大小寫要跟各模組的 key 一致，
    那些 key 是拿去跟 hash 字串直接比對的）"""
    page, _, rest = el_id.partition("Sub")
    if not page or not rest:
        fail(f"側邊欄子分頁 id「{el_id}」不是預期的 <主分頁>Sub<子分頁> 格式")
    return f"{page}-{rest[0].lower()}{rest[1:]}"


def to_static_shell(shell, root):
    """root 是這一頁回到站台根目錄的相對路徑（例如 ../../）"""
    top, side, backdrop, footer = (shell[k] for k in ("top", "side", "backdrop", "footer"))

    # 先把原本相對於根目錄的網址（guides/、privacy/、icon-192.png）補上前綴。
    # 一定要在下面產生 href="{root}#..." 那些新連結「之前」做，否則新連結會
    # 被這條規則再前綴一次
    def reroot(m):
        return f'{m.group(1)}="{root}{m.group(2)}"'

    rel = r'(href|src)="(?!https?:|//|#|mailto:)([^"]+)"'
    side = re.sub(rel, reroot, side)
    top = re.sub(rel, reroot, top)
    footer = re.sub(rel, reroot, footer)

    # 站名（首頁按鈕）→ 回首頁的連結
    side = re.sub(
        r'<button class="sidebar-brand"[^>]*>(.*?)</button>',
        lambda m: f'<a class="sidebar-brand" href="{root}">{m.group(1)}</a>',
        side,
        flags=re.S,
    )

    # 子分頁按鈕 → 指回首頁對應分頁的錨點連結。role="tab"／aria-selected／
    # aria-controls 一律拿掉：文章頁上沒有對應的 tabpanel，留著只會讓輔助
    # 技術讀到一組指向不存在元素的分頁標籤。hidden 要保留（主站暫時隱藏的
    # 子分頁，文章頁也必須跟著隱藏，不能從這裡外洩）
    def subtab_to_link(m):
        el_id, attrs, label = m.group(2), m.group(3), m.group(4)
        hidden = " hidden" if re.search(r"(^|\s)hidden(\s|$|=)", attrs) else ""
        return (
            f'<a class="sidebar-link subtab" href="{root}#{subtab_hash(el_id)}"{hidden}>'
            f"{label}</a>"
        )

    side = re.sub(
        r'<button class="sidebar-link subtab([^"]*)" id="([A-Za-z]+Sub[A-Za-z]+)"([^>]*)>(.*?)</button>',
        subtab_to_link,
        side,
        flags=re.S,
    )

    # 常見問題也是主站的一個分頁（#faq），同樣改成連結
    side = re.sub(
        r'<button class="sidebar-link" id="navFaqLink"[^>]*>(.*?)</button>',
        lambda m: f'<a class="sidebar-link" href="{root}#faq">{m.group(1)}</a>',
        side,
        flags=re.S,
    )

    # 群組標題（計算工具／玩法攻略…）維持按鈕：它本來就只負責展開收合、
    # 不換頁，sidebar.js 在文章頁上照樣接手。但 active／role="tab" 這些
    # 「目前在哪一頁」的狀態要清掉——文章頁不屬於任何一個群組
    side = re.sub(
        r'<button class="nav-group-btn nav-tab[^"]*" id="(\w+)"[^>]*>(.*?)</button>',
        lambda m: f'<button class="nav-group-btn nav-tab" id="{m.group(1)}" type="button">'
        f"{m.group(2)}</button>",
        side,
        flags=re.S,
    )

    top = re.sub(
        r'<button class="top-banner-text"[^>]*>(.*?)</button>',
        lambda m: f'<a class="top-banner-text" href="{root}">{m.group(1)}</a>',
        top,
        flags=re.S,
    )

    # 保險：改寫完之後，外殼裡只該剩下三種按鈕——群組標題、手機版關閉鈕、
    # 頂欄的漢堡鈕。主站哪天在側邊欄加了新按鈕而這支程式沒跟上，那顆按鈕在
    # 文章頁上會變成「點了完全沒反應」的死元件，寧可讓 CI 當場失敗
    leftover = [
        b
        for b in re.findall(r"<button[^>]*>", side + top + footer)
        if "nav-group-btn" not in b and "sidebar-close" not in b and "menu-btn" not in b
    ]
    if leftover:
        fail(
            "側邊欄有沒改寫成連結的按鈕，文章頁上會變成點了沒反應的死元件："
            + " / ".join(leftover)
        )

    links = len(re.findall(r'<a class="sidebar-link', side))
    if links < MIN_SIDEBAR_LINKS:
        fail(f"改寫後的側邊欄只剩 {links} 個連結，改寫規則可能跟主站結構脫節了")

    return {"top": top, "side": side, "backdrop": backdrop, "footer": footer}


# ------------------------------------------------------- 注入到獨立頁面

THEME_TOGGLE = '<button class="theme-toggle" id="themeToggle" type="button">暗色</button>\n'


def inject_shell(html, parts, root):
    if 'http-equiv="refresh"' in html:
        return None  # 舊網址的轉址 stub，沒有版面可言，跳過
    if THEME_TOGGLE not in html or "</main>" not in html:
        fail("這一頁的結構跟預期不同（找不到主題切換鈕或 </main>），沒辦法安全注入外殼")

    html = html.replace("<body>", '<body class="has-sidebar">', 1)
    html = html.replace(
        THEME_TOGGLE,
        THEME_TOGGLE + f'\n{parts["top"]}\n\n<div class="app-shell">\n{parts["side"]}\n'
        f'{parts["backdrop"]}\n\n<div class="app-main">\n',
        1,
    )
    # 原本的 <header class="site-header"> 跟 <main> 都落在 .app-main 裡面；
    # 免責聲明頁尾跟主站一樣接在 </main> 後面、還在 .app-main 內（.app-main
    # 的 min-height:100vh 加上 main 的 flex:1 會把它推到畫面最底），最後才是
    # 收尾的兩個 </div>
    html = html.replace("</main>", f'</main>\n\n{parts["footer"]}\n\n</div>\n</div>', 1)
    # 側邊欄的展開收合與手機版抽屜都靠 sidebar.js；它讀不到主站的分頁容器
    # 時每一段都會自己跳過（見 sidebar.js 各處的 null 檢查），可以原封不動共用
    html = html.replace(
        "</body>", f'<script defer src="{root}js/sidebar.js"></script>\n</body>', 1
    )

    for needle, what in (
        ('<body class="has-sidebar">', "body 的 has-sidebar class"),
        ('<div class="app-shell">', "app-shell 外框"),
        ('<div class="app-main">', "app-main 內容區"),
        ('<div class="app-main-footer">', "頁尾免責聲明"),
        ("js/sidebar.js", "sidebar.js"),
    ):
        if needle not in html:
            fail(f"注入外殼後找不到{what}，注入失敗")
    return html


def shell_pages():
    """所有要注入外殼的獨立頁面 → (檔案路徑, 回到根目錄的相對路徑)"""
    for folder in ("guides", "privacy"):
        for dirpath, _, filenames in os.walk(os.path.join(DIST, folder)):
            for name in sorted(filenames):
                if not name.endswith(".html"):
                    continue
                path = os.path.join(dirpath, name)
                depth = os.path.relpath(path, DIST).replace("\\", "/").count("/")
                yield path, "../" * depth


def main():
    index_html = patch_index()
    shell = extract_shell(index_html)

    patched = 0
    for path, root in shell_pages():
        html = inject_shell(read(path), to_static_shell(shell, root), root)
        if html is None:
            continue
        write(path, html)
        patched += 1

    # 目前是 guides 列表頁 + 8 篇文章 + privacy，共 10 頁；文章只會愈來愈多，
    # 所以只在「明顯太少」時報錯，抓的是整批比對失效那種災難
    if patched < 5:
        fail(f"只有 {patched} 頁注入了側邊欄外殼，檔案結構可能改過了")
    print(f"Injected app shell into {patched} standalone pages")


if __name__ == "__main__":
    main()
