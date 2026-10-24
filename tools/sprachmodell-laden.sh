#!/usr/bin/env bash
# Lädt die Offline-Spracherkennung (vosk-browser) und das deutsche Sprachmodell nach vosk/.
# Wird beim Veröffentlichen (GitHub Actions) automatisch ausgeführt.
#
#   bash tools/sprachmodell-laden.sh                 # deutsches Modell herunterladen
#   MODEL_ZIP=pfad/modell.zip bash tools/...sh        # lokales Modell-Zip verwenden
set -euo pipefail
cd "$(dirname "$0")/.."

MODEL_ZIP_URL="${MODEL_ZIP_URL:-https://alphacephei.com/vosk/models/vosk-model-small-de-0.15.zip}"
VOSK_VERSION="0.0.8"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p vosk

echo "== Spracherkennung vosk-browser $VOSK_VERSION"
(cd "$TMP" && npm pack --silent "vosk-browser@$VOSK_VERSION" >/dev/null && tar xzf "vosk-browser-$VOSK_VERSION.tgz")
cp "$TMP/package/dist/vosk.js" vosk/vosk.js

echo "== Sprachmodell"
if [ -n "${MODEL_ZIP:-}" ]; then
  cp "$MODEL_ZIP" "$TMP/model.zip"
else
  curl -fsSL --retry 3 -o "$TMP/model.zip" "$MODEL_ZIP_URL"
fi
mkdir "$TMP/m"
unzip -q "$TMP/model.zip" -d "$TMP/m"
MDL="$(find "$TMP/m" -path '*/am/final.mdl' | head -1)"
[ -n "$MDL" ] || { echo "FEHLER: kein Vosk-Modell im Zip gefunden"; exit 1; }
DIR="$(dirname "$(dirname "$MDL")")"

echo "  Modell-Dateien:"
(cd "$DIR" && find . -type f | sort | sed 's/^/    /')

# Die Sprachbefehle müssen im Wortschatz des Modells vorkommen.
# Wortliste: graph/words.txt oder – bei kleinen Modellen – die Symboltabelle im Sprachgraphen (Gr.fst / HCLG.fst).
python3 - "$DIR" <<'PY'
import os, struct, sys
d = sys.argv[1]
words_txt = os.path.join(d, "graph", "words.txt")
if os.path.exists(words_txt):
    with open(words_txt, encoding="utf-8") as f:
        vocab = {line.split()[0] for line in f if line.strip()}
    has = lambda w: w in vocab
    quelle = "graph/words.txt"
else:
    quelle = next((g for g in ("graph/Gr.fst", "graph/HCLG.fst") if os.path.exists(os.path.join(d, g))), None)
    if not quelle:
        sys.exit("FEHLER: weder graph/words.txt noch ein Sprachgraph gefunden")
    data = open(os.path.join(d, quelle), "rb").read()
    # OpenFst speichert Symbole als <int32 Länge><Text>
    has = lambda w: struct.pack("<i", len(w.encode())) + w.encode() in data
print(f"  Wortschatz aus {quelle}:")
for w in ("start", "starten", "stopp", "stop", "stoppen"):
    print(f"    {w}: {'ja' if has(w) else 'nein'}")
ok = has("start") and (has("stopp") or has("stop"))
if not ok and quelle == "graph/words.txt":
    sys.exit("FEHLER: «start» oder «stopp»/«stop» fehlt im Modell")
if not ok:
    print("  Hinweis: Wörter im Graphen nicht gefunden – verbindliche Prüfung folgt mit tools/sprachtest.py")
PY

mkdir -p "$TMP/pack/model"
cp -r "$DIR"/. "$TMP/pack/model/"
tar -C "$TMP/pack" -czf vosk/model-de.tar.gz model
ls -la vosk
