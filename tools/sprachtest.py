"""Prüft das Sprachmodell mit der echten Vosk-Bibliothek.

1. Verbindlich: Die Befehlswörter «start» und «stopp»/«stop» sind im Wortschatz und die Wortliste
   (Grammatik) wird vom Modell unterstützt.
2. Zur Information: Erkennung der mit espeak-ng synthetisch gesprochenen Befehle.

    python3 tools/sprachtest.py <modell-ordner>
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import wave

from vosk import KaldiRecognizer, Model, SetLogLevel

GRAMMATIK = ["start", "stopp", "stop", "[unk]"]


def mit_stderr(fn):
    """Führt fn aus und liefert die Meldungen, die Vosk (C++) auf stderr schreibt."""
    sys.stderr.flush()
    tmp = tempfile.TemporaryFile()
    alt = os.dup(2)
    os.dup2(tmp.fileno(), 2)
    try:
        ergebnis = fn()
    finally:
        os.dup2(alt, 2)
        os.close(alt)
    tmp.seek(0)
    return ergebnis, tmp.read().decode(errors="replace")


SetLogLevel(0)
model, log_model = mit_stderr(lambda: Model(sys.argv[1]))
_, log = mit_stderr(lambda: KaldiRecognizer(model, 16000, json.dumps(GRAMMATIK)))
print(log.strip())

if "not supported" in log.lower():
    sys.exit("FEHLER: Das Modell unterstützt keine Wortliste (Grammatik)")
fehlend = set(re.findall(r"missing in vocabulary: '([^']+)'", log))
print("Fehlende Wörter:", ", ".join(sorted(fehlend)) or "keine")
if "start" in fehlend or {"stopp", "stop"} <= fehlend:
    sys.exit("FEHLER: «start» oder «stopp»/«stop» fehlt im Wortschatz")
print("OK: Befehlswörter im Wortschatz")

SetLogLevel(-1)
if not shutil.which("espeak-ng"):
    print("espeak-ng nicht installiert – Sprachprobe übersprungen")
    sys.exit(0)
for wort in ["Start", "Stopp", "Wasser", "gestartet"]:
    subprocess.run(["espeak-ng", "-v", "de", "-s", "140", "-w", "/tmp/wort.wav", wort], check=True)
    with wave.open("/tmp/wort.wav") as w:
        rec = KaldiRecognizer(model, w.getframerate(), json.dumps(GRAMMATIK))
        while True:
            daten = w.readframes(4000)
            if not daten:
                break
            rec.AcceptWaveform(daten)
    print(f"Sprachprobe «{wort}» -> erkannt «{json.loads(rec.FinalResult()).get('text', '')}»")
