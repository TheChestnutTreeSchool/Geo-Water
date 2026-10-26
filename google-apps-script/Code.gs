/**
 * Geo-Water – geteilte Datenbank in einer Google-Tabelle.
 *
 * Einrichtung (einmalig, siehe README):
 *   1. Neue Google-Tabelle anlegen → Erweiterungen → Apps Script.
 *   2. Diesen Code einfügen und SCHLUESSEL unten ändern.
 *   3. Bereitstellen → Neue Bereitstellung → Web-App,
 *      «Ausführen als: Ich», «Zugriff: Jeder» → URL in der App unter ⚙ eintragen.
 *
 * Die Blätter «Messungen» und «Fassungen» werden automatisch angelegt.
 * Fassungen dürfen direkt in der Tabelle bearbeitet werden – die App übernimmt sie beim nächsten Abgleich.
 */

const SCHLUESSEL = 'bitte-aendern';   // gleicher Zugangsschlüssel wie in der App

const BLATT_MESSUNGEN = 'Messungen';
const BLATT_FASSUNGEN = 'Fassungen';
const FASSUNG_SPALTEN = ['Kürzel', 'Name', 'Projekt', 'Breite', 'Länge', 'Anzahl Messungen', 'Geändert am'];
const DATUM_SPALTEN = ['Probe genommen am', 'Erfasst am', 'Geändert am'];
const DATUM_FORMAT = 'dd.mm.yyyy hh:mm';

// Aufruf im Browser zum Testen: <URL>?key=<SCHLUESSEL>
function doGet(e) {
  return antwort(() => {
    pruefeSchluessel(e.parameter.key);
    return { info: 'Geo-Water Datenbank bereit', fassungen: leseFassungen() };
  });
}

function doPost(e) {
  return antwort(() => {
    const body = JSON.parse(e.postData.contents);
    pruefeSchluessel(body.key);
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      const ids = schreibeMessungen(body.messungen || []);
      aendereFassungen(body.fassungen || []);
      return {
        ids: ids,
        fassungen: leseFassungen(),
        url: SpreadsheetApp.getActiveSpreadsheet().getUrl()
      };
    } finally {
      lock.releaseLock();
    }
  });
}

function antwort(fn) {
  let out;
  try {
    out = Object.assign({ ok: true }, fn());
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function pruefeSchluessel(key) {
  if (SCHLUESSEL && key !== SCHLUESSEL) throw new Error('Falscher Zugangsschlüssel');
}

// ---------- Blätter und Spalten ----------

function blatt(name, kopf) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0 && kopf) {
    sh.getRange(1, 1, 1, kopf.length).setValues([kopf]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function kopfzeile(sh) {
  const n = sh.getLastColumn();
  return n ? sh.getRange(1, 1, 1, n).getValues()[0].map(String) : [];
}

// Fehlende Spalten ergänzen – neue Spalte direkt nach ihrem Vorgänger (z. B. «Zeit 4» nach «Zeit 3»)
function stelleSpaltenSicher(sh, kopf, keys) {
  keys.forEach((k, i) => {
    if (kopf.indexOf(k) >= 0) return;
    let pos = kopf.length;
    for (let j = i - 1; j >= 0; j--) {
      const p = kopf.indexOf(keys[j]);
      if (p >= 0) { pos = p + 1; break; }
    }
    if (pos < kopf.length) sh.insertColumnBefore(pos + 1);
    else if (pos + 1 > sh.getMaxColumns()) sh.insertColumnAfter(sh.getMaxColumns());
    sh.getRange(1, pos + 1).setValue(k).setFontWeight('bold');
    kopf.splice(pos, 0, k);
  });
  if (sh.getFrozenRows() === 0) sh.setFrozenRows(1);
  return kopf;
}

function formatiereDatumsspalten(sh, kopf) {
  if (sh.getLastRow() < 2) return;
  kopf.forEach((k, i) => {
    if (DATUM_SPALTEN.indexOf(k) >= 0) {
      sh.getRange(2, i + 1, sh.getLastRow() - 1, 1).setNumberFormat(DATUM_FORMAT);
    }
  });
}

// "2026-10-24T14:05:00" (Ortszeit) -> Date
function zuDatum(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(v));
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) : v;
}

function zellwert(k, v) {
  if (v === null || v === undefined) return '';
  if (DATUM_SPALTEN.indexOf(k) >= 0 && typeof v === 'string') return zuDatum(v);
  return v;
}

// ---------- Messungen ----------

function schreibeMessungen(liste) {
  if (!liste.length) return [];
  const sh = blatt(BLATT_MESSUNGEN);
  const kopf = kopfzeile(sh);
  liste.forEach((m) => stelleSpaltenSicher(sh, kopf, Object.keys(m.werte || {})));

  // bereits vorhandene IDs nicht doppelt eintragen (z. B. nach Verbindungsabbruch)
  const vorhanden = {};
  const iId = kopf.indexOf('ID');
  if (iId >= 0 && sh.getLastRow() > 1) {
    sh.getRange(2, iId + 1, sh.getLastRow() - 1, 1).getValues().forEach((r) => { vorhanden[String(r[0])] = true; });
  }

  const ids = [];
  liste.forEach((m) => {
    ids.push(m.id);
    if (vorhanden[m.id]) return;
    vorhanden[m.id] = true;
    sh.appendRow(kopf.map((k) => zellwert(k, m.werte[k])));
  });
  formatiereDatumsspalten(sh, kopf);
  return ids;
}

// ---------- Fassungen ----------

function aendereFassungen(ops) {
  if (!ops.length) return;
  const sh = blatt(BLATT_FASSUNGEN, FASSUNG_SPALTEN);
  const kopf = stelleSpaltenSicher(sh, kopfzeile(sh), FASSUNG_SPALTEN);
  const iK = kopf.indexOf('Kürzel');

  ops.forEach((o) => {
    const f = o.f || {};
    const k = String(f.kuerzel || '').trim();
    if (!k) return;

    let zeile = -1;
    if (sh.getLastRow() > 1) {
      const werte = sh.getRange(2, iK + 1, sh.getLastRow() - 1, 1).getValues();
      for (let i = 0; i < werte.length; i++) {
        if (String(werte[i][0]).trim().toLowerCase() === k.toLowerCase()) { zeile = i + 2; break; }
      }
    }

    if (o.op === 'delete') {
      if (zeile > 0) sh.deleteRow(zeile);
      return;
    }

    const neu = {
      'Kürzel': k,
      'Name': f.name || '',
      'Projekt': f.projekt || '',
      'Breite': typeof f.lat === 'number' ? Math.round(f.lat * 1e6) / 1e6 : '',
      'Länge': typeof f.lon === 'number' ? Math.round(f.lon * 1e6) / 1e6 : '',
      'Anzahl Messungen': f.anzahl || '',
      'Geändert am': new Date()
    };
    if (zeile > 0) {
      // zusätzliche, von Hand angelegte Spalten unverändert lassen
      const alt = sh.getRange(zeile, 1, 1, kopf.length).getValues()[0];
      const row = kopf.map((h, i) => (h in neu ? neu[h] : alt[i]));
      sh.getRange(zeile, 1, 1, kopf.length).setValues([row]);
    } else {
      sh.appendRow(kopf.map((h) => (h in neu ? neu[h] : '')));
    }
  });
  formatiereDatumsspalten(sh, kopf);
}

function leseFassungen() {
  const sh = blatt(BLATT_FASSUNGEN, FASSUNG_SPALTEN);
  const werte = sh.getDataRange().getValues();
  return {
    header: werte[0] || [],
    rows: werte.slice(1).map((r) => r.map((v) => (v instanceof Date ? '' : v)))
  };
}
