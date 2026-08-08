# -*- coding: utf-8 -*-
"""CSS 語法健檢：註解有沒有正確開關、大括號平不平衡。

起因是踩過一次坑：漏打 `/*` 開頭的註解，會讓後面整條規則被 CSS 解析器
默默吃掉——瀏覽器不報錯、畫面只是「樣式沒生效」，找起來非常花時間。
大括號同理，少一個 `}` 會讓後續規則全部失效。

用法：python tools/check_css.py [css檔路徑]
有問題時 exit 1，可以直接掛在 CI 上擋部署。
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT = os.path.join(ROOT, "style.css")


def check(path):
    with open(path, encoding="utf-8") as f:
        css = f.read()

    problems = []

    # 第一輪：註解的開關配對
    i = 0
    line = 1
    in_comment = False
    start_line = None
    while i < len(css):
        if css[i] == "\n":
            line += 1
            i += 1
            continue
        if not in_comment and css.startswith("/*", i):
            in_comment = True
            start_line = line
            i += 2
            continue
        if in_comment and css.startswith("*/", i):
            in_comment = False
            i += 2
            continue
        if not in_comment and css.startswith("*/", i):
            problems.append(f"第 {line} 行：多出一個 */（前面沒有對應的 /*）")
            i += 2
            continue
        i += 1
    if in_comment:
        problems.append(f"第 {start_line} 行開始的註解沒有關閉")

    # 第二輪：大括號平衡（註解裡的括號不算）
    depth = 0
    line = 1
    in_comment = False
    for i, ch in enumerate(css):
        if ch == "\n":
            line += 1
        if not in_comment and css.startswith("/*", i):
            in_comment = True
        elif in_comment and css.startswith("*/", i):
            in_comment = False
        elif not in_comment:
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth < 0:
                    problems.append(f"第 {line} 行：多出一個 }}")
                    depth = 0
    if depth:
        problems.append(f"還有 {depth} 個 {{ 沒關閉")

    return problems


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT
    if not os.path.exists(path):
        print(f"找不到檔案：{path}")
        return 1
    problems = check(path)
    name = os.path.relpath(path, ROOT)
    if problems:
        print(f"CSS 問題（{name}）：")
        for p in problems:
            print("  ⚠", p)
        return 1
    print(f"CSS 註解與大括號都平衡（{name}）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
