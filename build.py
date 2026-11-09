#!/usr/bin/env python3
"""Build everything the live site needs.

1. site/index.html: src/page.html (a body fragment: title, meta and <style> first, then
   markup and scripts) wrapped into a full page with SEO / social meta.
2. site/admin/: the React admin dashboard (admin/, built with Vite).

The backend (server/) needs no build: `npm start` runs it and serves site/.

Usage:  python3 build.py        (needs Node.js 18+ for step 2)
"""
import re
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src" / "page.html"
OUT = ROOT / "site" / "index.html"

TITLE = "India's Hidden Gems · AI Travel Consultant"
DESC = ("An AI travel consultant for India's unexplored places: Himalayan villages, "
        "Konkan coves, North East tribal trails and monsoon escapes.")

FAVICON = (
    "data:image/svg+xml,"
    "%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E"
    "%3Crect width='32' height='32' rx='8' fill='%2307090c'/%3E"
    "%3Cpath d='M5.6 22.4 12.4 12.2l4.1 5.6 3-3.9 6.9 8.5' fill='none' stroke='%23f2f5f7' "
    "stroke-width='2.2' stroke-linejoin='round' stroke-linecap='round'/%3E"
    "%3Ccircle cx='21.6' cy='9.6' r='2.6' fill='%23f5a524'/%3E%3C/svg%3E"
)

FONT_FACES = """<link rel="preload" href="fonts/hanken-grotesk-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<style>
@font-face{font-family:"Hanken Grotesk";font-style:normal;font-weight:100 900;font-display:swap;src:url(fonts/hanken-grotesk-latin-wght-normal.woff2) format("woff2")}
@font-face{font-family:"Newsreader";font-style:italic;font-weight:200 800;font-display:swap;src:url(fonts/newsreader-latin-wght-italic.woff2) format("woff2")}
@font-face{font-family:"IBM Plex Mono";font-style:normal;font-weight:400;font-display:swap;src:url(fonts/ibm-plex-mono-latin-400-normal.woff2) format("woff2")}
@font-face{font-family:"IBM Plex Mono";font-style:normal;font-weight:500;font-display:swap;src:url(fonts/ibm-plex-mono-latin-500-normal.woff2) format("woff2")}
</style>"""

HEAD_EXTRA = f"""<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#f2f6f4">
<meta property="og:type" content="website">
<meta property="og:title" content="{TITLE}">
<meta property="og:description" content="{DESC}">
<meta property="og:image" content="poster.jpg">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{TITLE}">
<meta name="twitter:description" content="{DESC}">
<link rel="icon" href="{FAVICON}">
<link rel="preload" as="image" href="poster.jpg">
<style>:root{{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}}[hidden]{{display:none!important}}</style>
"""


def main() -> None:
    src = SRC.read_text(encoding="utf-8")
    cut = src.index("</style>") + len("</style>")
    head, body = src[:cut], src[cut:]
    head = head.replace("<title>India's Hidden Gems</title>", f"<title>{TITLE}</title>", 1)
    html = (
        "<!doctype html>\n<html lang=\"en\">\n<head>\n"
        + HEAD_EXTRA + head.strip() + "\n</head>\n<body>\n"
        + body.strip() + "\n</body>\n</html>\n"
    )
    # The live site serves its own copies of the libraries (vendor/), so a slow or
    # blocked CDN can never stop the page's script, and with it the AI chat, from running.
    html = re.sub(r'src="https://cdn\.jsdelivr\.net/npm/([^"]+)"', r'src="vendor/\1"', html)
    # The live site serves its own fonts (fonts/, SIL Open Font License) instead of Google Fonts.
    html = re.sub(r'<link rel="preconnect" href="https://fonts\.(googleapis|gstatic)\.com"[^>]*>\n?', '', html)
    html = re.sub(r'<link rel="stylesheet" href="https://fonts\.googleapis\.com/[^"]+">', FONT_FACES, html, count=1)
    # Files from the old Firebase setup are no longer part of the site.
    for old in ("admin.html", "firebase-config.js"):
        (OUT.parent / old).unlink(missing_ok=True)
    for folder in ("vendor", "fonts"):
        shutil.rmtree(OUT.parent / folder, ignore_errors=True)
        shutil.copytree(ROOT / folder, OUT.parent / folder)
    vendor_out = OUT.parent / "vendor"
    missing = [m for m in re.findall(r'src="vendor/([^"]+)"', html) if not (vendor_out / m).is_file()]
    if missing:
        raise SystemExit(f"missing vendor files: {missing}")
    OUT.write_text(html, encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)} ({len(html):,} bytes)")
    build_admin()


def npm(folder: Path, *args: str) -> None:
    if not (folder / "node_modules").is_dir():
        subprocess.run(["npm", "install", "--no-audit", "--no-fund"], cwd=folder, check=True)
    subprocess.run(["npm", *args], cwd=folder, check=True)


def build_admin() -> None:
    """React admin dashboard -> site/admin (served at /admin)."""
    npm(ROOT / "admin", "run", "build", "--silent")
    print("wrote site/admin/ (React admin dashboard)")


if __name__ == "__main__":
    main()
