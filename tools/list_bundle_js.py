"""List and validate the local JavaScript entry files used by the main bundle."""

from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit
import sys


MIN_FILES = 10
REQUIRED_FILES = {"js/nav.js", "js/sidebar.js", "js/community.js"}


class ScriptCollector(HTMLParser):
    def __init__(self):
        super().__init__()
        self.files = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() != "script":
            return
        src = dict(attrs).get("src")
        if not src:
            return
        path = urlsplit(src).path.replace("\\", "/")
        if path.startswith("js/") and path.endswith(".js"):
            self.files.append(path)


def fail(message):
    print(f"::error::{message}", file=sys.stderr)
    raise SystemExit(1)


def main():
    index_path = Path(sys.argv[1] if len(sys.argv) > 1 else "index.html")
    collector = ScriptCollector()
    collector.feed(index_path.read_text(encoding="utf-8"))

    if len(collector.files) < MIN_FILES:
        fail(f"JS 打包清單只抓到 {len(collector.files)} 個檔案，index.html 的 script tag 可能已變更")

    duplicates = sorted({path for path in collector.files if collector.files.count(path) > 1})
    if duplicates:
        fail("JS 打包清單有重複檔案：" + ", ".join(duplicates))

    missing_required = sorted(REQUIRED_FILES.difference(collector.files))
    if missing_required:
        fail("JS 打包清單缺少必要檔案：" + ", ".join(missing_required))

    root = index_path.parent
    missing_files = [path for path in collector.files if not (root / path).is_file()]
    if missing_files:
        fail("JS 打包清單指向不存在的檔案：" + ", ".join(missing_files))

    print("\n".join(collector.files))


if __name__ == "__main__":
    main()
