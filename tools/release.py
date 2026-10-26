"""Trägt Version und Änderungen aus CHANGELOG.md in die zu veröffentlichende App ein.

    python3 tools/release.py _site

Schreibt _site/version.json (wird von der App für die Update-Prüfung gelesen) und ersetzt
die Platzhalter in _site/index.html und _site/sw.js.
"""
import datetime
import json
import os
import re
import sys
from zoneinfo import ZoneInfo

site = sys.argv[1]
text = open("CHANGELOG.md", encoding="utf-8").read()
m = re.search(r"^## (\d+\.\d+\.\d+)[^\n]*\n(.*?)(?=^## |\Z)", text, re.M | re.S)
if not m:
    sys.exit("FEHLER: keine Version («## 1.2.3 – Datum») in CHANGELOG.md gefunden")

version = m.group(1)
aenderungen = [z[2:].strip() for z in m.group(2).splitlines() if z.startswith("- ")]
commit = os.environ.get("GITHUB_SHA", "lokal")[:7]
datum = datetime.datetime.now(ZoneInfo("Europe/Zurich")).strftime("%d.%m.%Y %H:%M")

info = {"version": version, "datum": datum, "build": commit, "aenderungen": aenderungen}
with open(os.path.join(site, "version.json"), "w", encoding="utf-8") as f:
    json.dump(info, f, ensure_ascii=False, indent=2)

ersetzen = {
    "index.html": {"__APP_VERSION__": version, "__APP_BUILD__": f"{datum} · {commit}"},
    "sw.js": {"__APP_CACHE__": f"{version}-{commit}"},
}
for datei, platzhalter in ersetzen.items():
    pfad = os.path.join(site, datei)
    s = open(pfad, encoding="utf-8").read()
    for alt, neu in platzhalter.items():
        if alt not in s:
            sys.exit(f"FEHLER: Platzhalter {alt} fehlt in {datei}")
        s = s.replace(alt, neu)
    open(pfad, "w", encoding="utf-8").write(s)

print(f"Version {version} ({datum} · {commit})")
for a in aenderungen:
    print(f"  - {a}")
