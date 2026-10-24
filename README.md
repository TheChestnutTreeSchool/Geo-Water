# Geo-Water – Probenahme Quellwasser

Einfache Web-App (PWA) für das Handy zur Erfassung von Quellwasser- und Grundwasser-Probenahmen.
Funktioniert **offline** im Feld und exportiert die Daten als **Excel-Datei (.xlsx)** oder CSV.

## Erfasste Daten

| Feld | Erfassung |
|---|---|
| Fassungsart | Quelle / Grundwasserfassung (wird aus der Fassungsliste vorbelegt) |
| Projektname | Freitext mit Vorschlägen, bleibt für die nächste Probe gespeichert |
| Probe genommen von | Name der Mitarbeiterin / des Mitarbeiters, bleibt gespeichert |
| Probe genommen am | Datum + Uhrzeit, automatisch beim Start der Stoppuhr (änderbar) |
| Probestandort | automatisch per GPS über die nächstgelegene Fassung, oder manuell per Name/Kürzel |
| Probengrösse | 5 / 10 / 15 / 20 Liter |
| Zeitaufwand | Stoppuhr (Sekunden, 0.1 s), alternativ manuelle Eingabe |

Zusätzlich gespeichert: berechnete **Schüttung** (l/s und l/min = Volumen ÷ Zeit), GPS-Position und -Genauigkeit,
Distanz zur Fassung, Art der Zuordnung (GPS automatisch / GPS-Vorschlag / Manuell / Freitext) und eine optionale Bemerkung.

## Standort-Erkennung

1. Beim Öffnen (und nach jeder gespeicherten Probe) wird der GPS-Standort bestimmt.
2. Liegt **genau eine** Fassung innerhalb des Radius (Standard 100 m, mindestens die GPS-Genauigkeit), wird sie automatisch gewählt.
3. Liegen **mehrere** in der Nähe, erscheinen sie als Knöpfe zum Antippen.
4. **Kein GPS / keine Fassung in der Nähe:** Auswahl über die Liste mit Suchfeld (Name oder Kürzel).
   Nicht erfasste Fassungen können als Freitext eingegeben werden.

GPS funktioniert auch ohne Mobilfunknetz. Die App selbst braucht nach dem ersten Öffnen kein Netz mehr.

## Fassungen (Stammdaten) erfassen

Im Reiter **Fassungen**:

- **CSV importieren** – z. B. aus Excel «Speichern unter → CSV». Erkannte Spalten:
  `Kürzel`, `Name`, `Art`, `Projekt`, `Breite`/`Lat`/`N`, `Länge`/`Lon`/`E`.
  Koordinaten in **WGS84** (47.3769 / 8.5417) oder **Schweizer Landeskoordinaten LV95/LV03**
  (2 683 000 / 1 248 000) werden automatisch erkannt. Vorlage: [`beispiel-fassungen.csv`](beispiel-fassungen.csv).
- **Manuell hinzufügen** – auch direkt vor Ort mit «Aktuellen Standort übernehmen».
- Antippen einer Fassung lädt sie zum Bearbeiten; gleiches Kürzel = wird aktualisiert.

## Daten exportieren

Reiter **Messungen → Excel exportieren**. Die Excel-Datei enthält die Blätter «Messungen» und «Fassungen».
Auf dem Handy öffnet sich das Teilen-Menü (E-Mail, Teams, OneDrive …).

> **Wichtig:** Die Daten liegen nur auf dem jeweiligen Gerät (im Browser-Speicher).
> Regelmässig exportieren und erst danach «Alle Messungen löschen».

## Installation / Betrieb

Die App besteht nur aus statischen Dateien, ein Server oder eine Datenbank ist nicht nötig.
Für GPS und Offline-Betrieb muss sie über **HTTPS** ausgeliefert werden, z. B. mit **GitHub Pages**:

1. Repository → *Settings → Pages* → Branch auswählen → Speichern.
2. Die angezeigte Adresse auf dem Handy öffnen.
3. **Zum Startbildschirm hinzufügen** (iPhone: Safari → Teilen; Android: Chrome → Menü → «App installieren»).
4. Beim ersten Start den Standortzugriff erlauben.

Lokal testen: `python3 -m http.server` im Projektordner und `http://localhost:8000` öffnen.

## Dateien

| Datei | Inhalt |
|---|---|
| `index.html` | Oberfläche |
| `app.js` | Logik (Erfassung, GPS, Stoppuhr, Import/Export) |
| `xlsx.js` | kleiner Excel-Writer ohne externe Bibliotheken |
| `style.css` | Gestaltung (hell/dunkel) |
| `sw.js`, `manifest.webmanifest`, `icon.svg` | Offline-Betrieb und Installation als App |

Nach Änderungen an den Dateien die Versionsnummer `CACHE` in `sw.js` erhöhen, damit die Geräte das Update laden.
