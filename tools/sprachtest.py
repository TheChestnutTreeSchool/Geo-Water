"""Prüft, ob das Sprachmodell die Befehle «Start» und «Stopp» erkennt (synthetische Stimme, espeak-ng).

    python3 tools/sprachtest.py <modell-ordner>
"""
import json
import subprocess
import sys
import wave

from vosk import KaldiRecognizer, Model, SetLogLevel

SetLogLevel(-1)
model = Model(sys.argv[1])
grammatik = json.dumps(["start", "stopp", "stop", "[unk]"])
fehler = 0

for wort, erwartet in [("Start", "start"), ("Stopp", "stop"), ("Stop", "stop"), ("Wasser", None)]:
    subprocess.run(["espeak-ng", "-v", "de", "-s", "140", "-w", "/tmp/wort.wav", wort], check=True)
    with wave.open("/tmp/wort.wav") as w:
        rec = KaldiRecognizer(model, w.getframerate(), grammatik)
        while True:
            daten = w.readframes(4000)
            if not daten:
                break
            rec.AcceptWaveform(daten)
    text = json.loads(rec.FinalResult()).get("text", "")
    erkannt = "stop" if text in ("stopp", "stop") else ("start" if text == "start" else None)
    ok = erkannt == erwartet
    fehler += not ok
    print(f"{'OK ' if ok else 'FEHLER'} gesprochen «{wort}» -> erkannt «{text}»")

sys.exit(1 if fehler else 0)
