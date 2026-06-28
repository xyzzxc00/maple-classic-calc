import re

html = open('dist/index.html', encoding='utf-8').read()
html = re.sub(r'\s*<script src="js/[^"]+"></script>', '', html)
html = html.replace('</body>', '<script src="js/bundle.js"></script>\n</body>')
open('dist/index.html', 'w', encoding='utf-8').write(html)
