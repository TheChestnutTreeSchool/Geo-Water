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

# Die Sprachbefehle müssen im Wortschatz des Modells vorkommen
WORDS="$DIR/graph/words.txt"
[ -f "$WORDS" ] || { echo "FEHLER: $WORDS fehlt (Modell unterstützt keine Wortliste)"; exit 1; }
for w in start starten stopp stop stoppen; do
  if grep -qP "^$w\s" "$WORDS"; then echo "  Wort im Modell: $w"; fi
done
grep -qP "^start\s" "$WORDS" || { echo "FEHLER: «start» fehlt im Modell"; exit 1; }
grep -qP "^(stopp|stop)\s" "$WORDS" || { echo "FEHLER: «stopp»/«stop» fehlt im Modell"; exit 1; }

mkdir -p "$TMP/pack/model"
cp -r "$DIR"/. "$TMP/pack/model/"
tar -C "$TMP/pack" -czf vosk/model-de.tar.gz model
ls -la vosk
