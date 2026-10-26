# Geo-Water – Hinweise für Claude

- Antworten auf Deutsch (Schweizer Schreibweise, «ss» statt «ß»).

## Neue Version veröffentlichen

1. In `CHANGELOG.md` zuoberst eine neue Version eintragen: `## X.Y.Z – TT.MM.JJJJ` und darunter
   Stichpunkte (`- …`) in einfacher Sprache für die Nutzer. Nummerierung: neue Funktion → Y erhöhen,
   reine Korrektur → Z erhöhen. Diese Punkte zeigt die App nach dem Update an.
2. Commit und Push. Der Workflow «App veröffentlichen» trägt Version, Datum und Commit automatisch
   in die App ein (`tools/release.py`) – die Cache-Version in `sw.js` muss **nicht** mehr von Hand erhöht werden.
3. Warten, bis der Workflow (Build **und** Deploy) erfolgreich war.
   (Git-Tags lassen sich aus der Cloud-Umgebung nicht pushen – nicht nötig, die Version steht in
   `CHANGELOG.md`, in der App und mit Commit in `version.json`.)
4. Dem Nutzer den **Link zur neuen Version** posten:
   `https://thechestnuttreeschool.github.io/Geo-Water/?v=X.Y.Z` – mit Versionsnummer und den Änderungen.
   Der Link aktualisiert die installierte App automatisch auf diese Version.
