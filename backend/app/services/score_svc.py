"""ABC → PDF score rendering: verovio (ABC→SVG pages) + cairosvg (SVG→PDF).

cairosvg drops verovio's own pgHead/pgFooter text (nested-svg quirk), so the
title is injected as a plain <text> element in the outer svg instead.
"""

import re
from pathlib import Path


def render_abc_pdf(abc: str, out_path: Path, title: str = "") -> int:
    """Render ABC text to PDF (A4, one or more pages). Returns page count."""
    import cairosvg
    import verovio
    from pypdf import PdfWriter

    tk = verovio.toolkit()
    tk.setOptions({
        "pageWidth": 2100,   # A4 portrait, verovio 1/10 mm units
        "pageHeight": 2970,
        "scale": 38,
        "adjustPageHeight": False,
        "footer": "none",
        "header": "none",
        "pageMarginTop": 200,  # room for the title on page 1
    })
    if not tk.loadData(abc):
        raise ValueError("ABC 解析失败")
    pages = max(1, tk.getPageCount())

    def _title_text(svg: str) -> str:
        t = (title or "").strip()
        if not t:
            return svg
        m = re.search(r'<svg width="([\d.]+)px"', svg)
        cx = float(m.group(1)) / 2 if m else 400
        el = (
            f'<text x="{cx}" y="52" font-size="26" '
            f'font-family="Noto Sans CJK SC" text-anchor="middle" fill="#111">'
            f"{t}</text>"
        )
        return re.sub(r"(<svg[^>]*>)", lambda mm: mm.group(1) + el, svg, count=1)

    pdf_pages: list[bytes] = []
    for p in range(1, pages + 1):
        svg = tk.renderToSVG(p)
        if p == 1:
            svg = _title_text(svg)
        pdf_pages.append(cairosvg.svg2pdf(bytestring=svg.encode()))

    out_path.parent.mkdir(parents=True, exist_ok=True)
    if pages == 1:
        out_path.write_bytes(pdf_pages[0])
    else:
        writer = PdfWriter()
        for page in pdf_pages:
            writer.append_bytes(page)
        with open(out_path, "wb") as f:
            writer.write(f)
    return pages
