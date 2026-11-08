#!/usr/bin/env python3
"""Deploy site/ to storied-otter-d8b50e.netlify.app without breaking the AI chat.

How the live site is wired:
  * The new design's files are served from /hg/ (index.html, video, poster, photos,
    and the React admin dashboard in /hg/admin/).
  * The Node.js + Express backend is the Netlify Function "api" (server/dist/api.zip,
    made by build.py), answering at /api/v1/*.
  * _redirects maps the public paths (/, /places/*, /admin, /api/v1/*, ...) onto them.
    Netlify checks _redirects before netlify.toml.
  * Everything else, including the AI chat at /api/chat, falls through to the
    original netlify.toml, which passes requests on to the Lovable app. That file is
    re-used by its fingerprint (ORIGINAL_TOML_SHA), so it never has to be re-uploaded.

Needs a Netlify personal access token for api.netlify.com. In a Claude cloud session
it is injected by the network proxy; elsewhere set NETLIFY_AUTH_TOKEN.

Usage:  python3 build.py && python3 deploy_netlify.py
"""
import hashlib
import json
import os
import subprocess
import sys
import time
from pathlib import Path

SITE_ID = "e3b21b97-4ed3-4e9b-95f7-f1eb7a5917ae"  # storied-otter-d8b50e
ORIGINAL_TOML_SHA = "20dc01d2c098a34c7f7b8a138c8e1f55ce21ff20"  # original pass-through to Lovable
API = "https://api.netlify.com/api/v1"
ROOT = Path(__file__).resolve().parent / "site"
FUNCTION_ZIP = Path(__file__).resolve().parent / "server" / "dist" / "api.zip"

REDIRECTS = """# India's Hidden Gems: the new design's files live in /hg.
# Anything not listed here (including the AI chat at /api/chat) falls through to
# netlify.toml, which passes it on to the Lovable app.
/                /hg/index.html      200!
/index.html      /hg/index.html      200!
/bg-video.mp4    /hg/bg-video.mp4    200!
/poster.jpg      /hg/poster.jpg      200!
/places/*        /hg/places/:splat   200!
/vendor/*        /hg/vendor/:splat   200!
/fonts/*         /hg/fonts/:splat    200!
/admin           /hg/admin/index.html    200!
/admin/          /hg/admin/index.html    200!
/admin/*         /hg/admin/:splat        200!
/api/v1/*        /.netlify/functions/api/:splat  200!
"""


def curl(*args, data=None):
    cmd = ["curl", "-sS", "-m", "300", *args]
    token = os.environ.get("NETLIFY_AUTH_TOKEN")
    if token:
        cmd += ["-H", f"Authorization: Bearer {token}"]
    return subprocess.run(cmd, input=data, capture_output=True, check=True).stdout


def main() -> None:
    blobs = {"/_redirects": REDIRECTS.encode()}
    for path in sorted(ROOT.rglob("*")):
        if path.is_file() and path.name != "_redirects":
            blobs["/hg/" + path.relative_to(ROOT).as_posix()] = path.read_bytes()
    digests = {k: hashlib.sha1(v).hexdigest() for k, v in blobs.items()}
    digests["/netlify.toml"] = ORIGINAL_TOML_SHA
    if not FUNCTION_ZIP.is_file():
        sys.exit("server/dist/api.zip is missing: run python3 build.py first.")
    fn_zip = FUNCTION_ZIP.read_bytes()
    fn_sha = hashlib.sha256(fn_zip).hexdigest()

    body = json.dumps({"files": digests, "functions": {"api": fn_sha}, "title": "India's Hidden Gems"}).encode()
    deploy = json.loads(curl("-X", "POST", f"{API}/sites/{SITE_ID}/deploys",
                             "-H", "Content-Type: application/json", "--data-binary", "@-", data=body))
    if "id" not in deploy:
        sys.exit(f"Deploy was not created: {deploy}")
    required = set(deploy.get("required") or [])
    if ORIGINAL_TOML_SHA in required:
        sys.exit("Netlify no longer has the original netlify.toml; the chat pass-through can't be re-used.")
    print(f"deploy {deploy['id']}: {len(required)} file(s) to upload")
    for name, content in blobs.items():
        if digests[name] in required:
            code = curl("-X", "PUT", f"{API}/deploys/{deploy['id']}/files{name}",
                        "-H", "Content-Type: application/octet-stream", "--data-binary", "@-",
                        "-o", "/dev/null", "-w", "%{http_code}", data=content).decode()
            print(f"  {name}: HTTP {code}")
    if fn_sha in set(deploy.get("required_functions") or []):
        code = curl("-X", "PUT", f"{API}/deploys/{deploy['id']}/functions/api?runtime=js",
                    "-H", "Content-Type: application/octet-stream", "--data-binary", "@-",
                    "-o", "/dev/null", "-w", "%{http_code}", data=fn_zip).decode()
        print(f"  function api ({len(fn_zip):,} bytes): HTTP {code}")

    for _ in range(40):
        state = json.loads(curl(f"{API}/deploys/{deploy['id']}")).get("state")
        if state in ("ready", "error"):
            break
        time.sleep(5)
    print(f"state: {state}")
    if state != "ready":
        sys.exit(1)


if __name__ == "__main__":
    main()
