# Geo-Water – Probenahme Quellwasser

Einfache Web-App (PWA) für das Handy zur Erfassung von Quellwasser- und Grundwasser-Probenahmen.
Funktioniert **offline** im Feld. Alle Geräte speichern in eine **gemeinsame Google-Tabelle**
(jederzeit als Excel herunterladbar), zusätzlich ist ein Excel-/CSV-Export direkt aus der App möglich.

## Erfasste Daten

| Feld | Erfassung |
|---|---|
| Fassungsart | Quelle / Grundwasserfassung (wird aus der Fassungsliste vorbelegt) |
| Projektname | Freitext mit Vorschlägen, bleibt für die nächste Probe gespeichert |
| Probe genommen von | Name der Mitarbeiterin / des Mitarbeiters, bleibt gespeichert |
| Probe genommen am | Datum + Uhrzeit, automatisch beim Start der ersten Zeitmessung (änderbar) |
| Probestandort | automatisch per GPS über die nächstgelegene Fassung, oder manuell per Name/Kürzel |
| Probengrösse | 5 / 10 / 15 / 20 Liter |
| Anzahl Messungen | pro Fassung festgelegt (Standard einstellbar), vor Ort anpassbar |
| Zeiten | Stoppuhr für jede Einzelmessung (0.1 s), alternativ manuelle Eingabe |

Gespeichert werden **jede Einzelzeit** (`Zeit 1 [s]`, `Zeit 2 [s]`, …) und der **Mittelwert**.
Daraus berechnet die App die **Schüttung** (l/s und l/min = Volumen ÷ mittlere Zeit).
Zusätzlich: GPS-Position und -Genauigkeit, Distanz zur Fassung, Art der Zuordnung
(GPS automatisch / GPS-Vorschlag / Manuell / Freitext) und eine optionale Bemerkung.

## Ablauf im Feld

1. App öffnen → der Standort wird per GPS erkannt, die Anzahl Messungen der Fassung übernommen.
2. **Start** drücken, sobald das Gefäss unter den Zulauf kommt, **Stopp** wenn es voll ist.
3. Für jede weitere Messung erneut **Start/Stopp** («Messung 2 von 3» …). Einzelne Zeiten lassen sich mit ✕ verwerfen.
4. **Messung speichern** – erst möglich, wenn alle vorgesehenen Messungen erfasst sind.

## Standort-Erkennung

- Liegt **genau eine** Fassung innerhalb des Radius (Standard 100 m, mindestens die GPS-Genauigkeit), wird sie automatisch gewählt.
- Liegen **mehrere** in der Nähe, erscheinen sie als Knöpfe zum Antippen.
- **Kein GPS / keine Fassung in der Nähe:** Auswahl über die Liste mit Suchfeld (Name oder Kürzel),
  nicht erfasste Fassungen als Freitext.

GPS funktioniert auch ohne Mobilfunknetz.

## Fassungen (Stammdaten)

Es gibt drei Wege, Fassungen zu erfassen – alle landen in der gemeinsamen Tabelle:

- **In der App** (Reiter *Fassungen*), am einfachsten direkt vor Ort mit «Aktuellen Standort übernehmen».
- **Direkt in der Google-Tabelle**, Blatt «Fassungen». Die Geräte übernehmen Änderungen beim nächsten Abgleich.
- **CSV-Import** in der App, z. B. aus Excel «Speichern unter → CSV». Vorlage: [`beispiel-fassungen.csv`](beispiel-fassungen.csv).

Koordinaten dürfen in **WGS84** (47.3769 / 8.5417) oder **Schweizer Landeskoordinaten LV95/LV03**
(2 683 000 / 1 248 000) angegeben werden. «Anzahl Messungen» leer = Standardwert aus den Einstellungen.

## Geteilte Datenbank einrichten (einmalig, ca. 10 Minuten)

1. In Google Drive eine neue **Google-Tabelle** anlegen, z. B. «Geo-Water Messungen».
2. Menü **Erweiterungen → Apps Script**. Den Inhalt von [`google-apps-script/Code.gs`](google-apps-script/Code.gs)
   hineinkopieren und in der Zeile `const SCHLUESSEL = 'bitte-aendern';` ein eigenes Passwort eintragen. Speichern.
3. **Bereitstellen → Neue Bereitstellung** → Typ **Web-App**:
   - Ausführen als: **Ich**
   - Zugriff: **Jeder**

   → *Bereitstellen*, Zugriff erlauben, die **Web-App-URL** kopieren (endet auf `/exec`).
4. In der App unter **⚙** URL und Schlüssel eintragen → **Speichern & verbinden**.
5. Weitere Geräte: unter ⚙ **Link für weitere Geräte** antippen und den Link (z. B. per Teams/E-Mail)
   an die Kolleginnen und Kollegen schicken. Beim Öffnen ist die Verbindung automatisch eingerichtet.

Die Blätter «Messungen» und «Fassungen» werden automatisch angelegt. Dateien → Herunterladen → *Microsoft Excel*
liefert jederzeit eine .xlsx-Datei. Die Zeitzone der Tabelle (Datei → Einstellungen) und des Skripts
(Apps Script → Projekteinstellungen) sollte «Europe/Zurich» sein.

**Synchronisation:** Neue Messungen werden sofort übertragen, ohne Netz auf dem Gerät gesammelt und automatisch
nachgeliefert (bei Netzempfang, beim Öffnen der App und alle 2 Minuten). Oben rechts zeigt die App den Stand
(«☁︎ synchron», «⏳ 2 ausstehend», «offline»). Doppelte Übertragungen werden über die ID verhindert.

**Sicherheit:** Wer URL *und* Schlüssel kennt, kann Daten eintragen und die Fassungsliste lesen.
Link nur intern weitergeben. Bei Bedarf Schlüssel im Skript ändern und neu bereitstellen.

**Änderungen am Skript** werden erst wirksam mit *Bereitstellen → Bereitstellungen verwalten → Bearbeiten →
Version: Neue Version*. So bleibt die URL gleich.

## App installieren

Die App besteht nur aus statischen Dateien. Für GPS und Offline-Betrieb muss sie über **HTTPS** laufen,
z. B. mit **GitHub Pages**:

1. Repository → *Settings → Pages* → Branch auswählen → Speichern.
2. Die angezeigte Adresse auf dem Handy öffnen (bzw. den «Link für weitere Geräte»).
3. **Zum Startbildschirm hinzufügen** (iPhone: Safari → Teilen; Android: Chrome → Menü → «App installieren»).
4. Beim ersten Start den Standortzugriff erlauben.

Lokal testen: `python3 -m http.server` im Projektordner und `http://localhost:8000` öffnen.

## Dateien

| Datei | Inhalt |
|---|---|
| `index.html` | Oberfläche |
| `app.js` | Logik (Erfassung, GPS, Stoppuhr, Synchronisation, Import/Export) |
| `xlsx.js` | kleiner Excel-Writer ohne externe Bibliotheken |
| `style.css` | Gestaltung (hell/dunkel) |
| `google-apps-script/Code.gs` | Server-Teil für die Google-Tabelle |
| `sw.js`, `manifest.webmanifest`, `icon.svg` | Offline-Betrieb und Installation als App |

Nach Änderungen an den App-Dateien die Versionsnummer `CACHE` in `sw.js` erhöhen, damit die Geräte das Update laden.
