# Merchant-facing documents

Source of truth for the two PDFs downloaded from the public support page.
Edit the Markdown, run `python scripts/build-docs.py`, upload the PDFs.

| Source | Output | Pages |
|---|---|---|
| DOCUMENTATION-AIO.md | DOCUMENTATION-AIO.pdf | 6 |
| TUTORIAL-AIO.md | TUTORIAL-AIO.pdf | 9 |

Rebuilt 4 September 2026 from the 3 August exports plus everything shipped
since. The SEO workspace is deliberately absent: it is behind the operator
key, billed separately, and these files are public.

Screenshots in `img/` are from the 3 August build. Two were removed because
they contradicted the text and need retaking on the current app:
the Plans screen on first open (it now shows the free plan) and Diagnostics
(it now names eight crawlers and lists real requests). The Report screen has
no screenshot yet.

Requires `pip install markdown weasyprint`. The build refuses any source
containing an em dash, en dash, curly quote, ellipsis character or HTML
entity.
