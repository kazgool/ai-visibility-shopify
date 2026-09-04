#!/usr/bin/env python3
"""Export the two merchant-facing PDFs from their Markdown sources.

Sources:  _shopify/docs/DOCUMENTATION-AIO.md, _shopify/docs/TUTORIAL-AIO.md
Outputs:  _shopify/docs/DOCUMENTATION-AIO.pdf, _shopify/docs/TUTORIAL-AIO.pdf

Until 4 September 2026 the PDFs had no source at all: the 3 August exports
were the only copy, and the paste-ready updates written on 22 August were
never applied to them. The Markdown files are the source now; the PDF is
built, never edited.

Requires: python3, pip install markdown weasyprint
Run:      python scripts/build-docs.py

Refuses to build a source that contains an em dash, en dash, curly quote,
ellipsis character or HTML entity, because those are the characters CLAUDE.md
bans from every customer-facing string and a PDF is one.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

try:
    import markdown
    from weasyprint import HTML
except ImportError as exc:  # pragma: no cover
    sys.exit(f"missing dependency: {exc}. Run: pip install markdown weasyprint")

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "_shopify" / "docs"
SOURCES = ["DOCUMENTATION-AIO.md", "TUTORIAL-AIO.md"]

BANNED = re.compile("[–—‘’“”…]|&[a-z#0-9]+;")

CSS = """
@page {
  size: A4;
  margin: 22mm 20mm 24mm 20mm;
  @bottom-left { content: string(footer); font: 8.5pt Helvetica, Arial, sans-serif; color: #666; }
  @bottom-right { content: "Page " counter(page); font: 8.5pt Helvetica, Arial, sans-serif; color: #666; }
}
body { font: 10.5pt/1.5 Helvetica, Arial, sans-serif; color: #1a1a1a; }
h1 { font-size: 22pt; margin: 0 0 4pt; }
.subtitle { font-size: 11pt; color: #444; margin: 0 0 6pt; }
.date { font-size: 9pt; color: #777; margin: 0 0 18pt; }
.footer { string-set: footer content(); display: none; }
h2 { font-size: 15pt; margin: 20pt 0 6pt; page-break-after: avoid; }
h3 { font-size: 12pt; margin: 14pt 0 4pt; page-break-after: avoid; }
p { margin: 0 0 8pt; }
ul, ol { margin: 0 0 8pt 18pt; padding: 0; }
li { margin: 0 0 4pt; }
img { max-width: 100%; height: auto; display: block; margin: 6pt 0 12pt; border: 1px solid #ddd; page-break-inside: avoid; }
table { border-collapse: collapse; width: 100%; margin: 6pt 0 12pt; font-size: 9.5pt; page-break-inside: avoid; }
th, td { border: 1px solid #ccc; padding: 4pt 6pt; text-align: left; vertical-align: top; }
th { background: #f3f3f3; }
code { font: 9.5pt Menlo, Consolas, monospace; }
"""


def split_front_matter(text: str) -> tuple[dict[str, str], str]:
    if not text.startswith("---"):
        return {}, text
    _, block, body = text.split("---", 2)
    meta: dict[str, str] = {}
    for line in block.strip().splitlines():
        key, _, value = line.partition(":")
        meta[key.strip()] = value.strip()
    return meta, body


def build(source: Path) -> Path:
    text = source.read_text(encoding="utf-8")
    hit = BANNED.search(text)
    if hit:
        line = text[: hit.start()].count("\n") + 1
        sys.exit(f"{source.name}:{line}: banned character {hit.group()!r}; plain characters only")

    meta, body = split_front_matter(text)
    html_body = markdown.markdown(body, extensions=["tables"])
    html = f"""<!doctype html><html><head><meta charset="utf-8"><style>{CSS}</style></head><body>
<span class="footer">{meta.get("footer", "")}</span>
<h1>{meta.get("title", source.stem)}</h1>
<p class="subtitle">{meta.get("subtitle", "")}</p>
<p class="date">{meta.get("date", "")}</p>
{html_body}
</body></html>"""

    out = source.with_suffix(".pdf")
    HTML(string=html, base_url=str(source.parent)).write_pdf(str(out))
    return out


def main() -> None:
    built = []
    for name in SOURCES:
        src = DOCS / name
        if not src.exists():
            sys.exit(f"missing source: {src}")
        built.append(build(src))
    for out in built:
        print(f"built {out.relative_to(ROOT)} ({out.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
