/* Geo-Water – Erfassung von Quellwasser-Probenahmen */
(function () {
  'use strict';

  // ---------- Speicher ----------
  const KEY = {
    messungen: 'gw.messungen',
    fassungen: 'gw.fassungen',
    fassQueue: 'gw.fassungenQueue',
    prefs: 'gw.prefs',
    sw: 'gw.stoppuhr'
  };

  function load(key, fallback) {
    try {
      const v = JSON.parse(localStorage.getItem(key));
      return v == null ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }
  function save(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      toast('Speichern fehlgeschlagen – Speicher voll oder blockiert!');
      return false;
    }
  }

  // ältere Datensätze (nur eine Zeit) ins neue Format bringen
  function migrate(m) {
    if (!Array.isArray(m.zeiten)) m.zeiten = m.zeit > 0 ? [m.zeit] : [];
    return m;
  }

  let messungen = load(KEY.messungen, []).map(migrate);
  let fassungen = load(KEY.fassungen, []);
  // Änderungen an Fassungen, die noch an die Datenbank gehen: kürzel -> { op: 'upsert'|'delete', f }
  let fassQueue = load(KEY.fassQueue, {});
  // Fassungen aus der Version ohne Datenbank beim ersten Abgleich hochladen
  if (localStorage.getItem(KEY.fassQueue) == null) {
    fassungen.forEach((f) => { fassQueue[f.kuerzel.toLowerCase()] = { op: 'upsert', f }; });
  }
  const prefs = Object.assign({
    projekt: '', mitarbeiter: '', typ: 'Quelle', volumen: '10',
    radius: 100, anzahl: 3,
    dbUrl: '', dbKey: '', sheetUrl: '', lastSync: 0
  }, load(KEY.prefs, {}));

  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  // ---------- Helfer ----------
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const pad = (n) => String(n).padStart(2, '0');
  function toLocalInput(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function toLocalIso(d) {
    return `${toLocalInput(d)}:${pad(d.getSeconds())}`;
  }
  function fmtDate(d) {
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function fmtNum(n, digits) {
    return n == null || !isFinite(n) ? '' : Number(n).toFixed(digits);
  }
  function fmtDauer(s) {
    if (s < 60) return `${s.toFixed(1)} s`;
    const min = Math.floor(s / 60);
    return `${min}:${(s - min * 60).toFixed(1).padStart(4, '0')} min`;
  }
  function fileStamp() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
  }
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  const round = (n, d) => Math.round(n * 10 ** d) / 10 ** d;
  const mean = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3000);
  }

  // Zahl aus Benutzereingabe: akzeptiert 47,123 / 2'600'000 / 2 600 000
  function parseNum(s) {
    if (s == null) return NaN;
    let t = String(s).trim().replace(/[\s'’]/g, '');
    if (!t) return NaN;
    if (t.includes(',') && !t.includes('.')) t = t.replace(',', '.');
    else t = t.replace(/,/g, '');
    return /^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(t) ? parseFloat(t) : NaN;
  }

  // Schweizer Landeskoordinaten (LV95 / LV03) -> WGS84, Näherungsformel swisstopo (~1 m)
  function swissToWgs(e, n) {
    let y, x;
    if (e > 2000000) { y = (e - 2600000) / 1e6; x = (n - 1200000) / 1e6; }
    else { y = (e - 600000) / 1e6; x = (n - 200000) / 1e6; }
    const lon = 2.6779094 + 4.728982 * y + 0.791484 * y * x + 0.1306 * y * x * x - 0.0436 * y * y * y;
    const lat = 16.9023892 + 3.238272 * x - 0.270978 * y * y - 0.002528 * x * x - 0.0447 * y * y * x - 0.0140 * x * x * x;
    return { lat: lat * 100 / 36, lon: lon * 100 / 36 };
  }

  // Koordinatenpaar erkennen. Rückgabe: null (leer), {lat, lon} oder {error}
  function parseCoords(aStr, bStr) {
    const a = parseNum(aStr), b = parseNum(bStr);
    const emptyA = !String(aStr == null ? '' : aStr).trim(), emptyB = !String(bStr == null ? '' : bStr).trim();
    if (emptyA && emptyB) return null;
    if (isNaN(a) || isNaN(b)) return { error: 'Koordinaten unvollständig oder ungültig' };

    if (Math.abs(a) <= 90 && Math.abs(b) <= 180) {
      // vertauschte Grad-Angaben in der Schweiz erkennen (Breite ~46–48, Länge ~6–11)
      if (a > 5 && a < 11 && b > 45 && b < 48) return { lat: b, lon: a };
      return { lat: a, lon: b };
    }
    const e = Math.max(a, b), n = Math.min(a, b);
    const lv95 = e >= 2400000 && e <= 2900000 && n >= 1000000 && n <= 1350000;
    const lv03 = e >= 400000 && e <= 900000 && n >= 0 && n <= 350000;
    if (lv95 || lv03) return swissToWgs(e, n);
    return { error: 'Koordinaten nicht erkannt (WGS84 oder LV95/LV03 erwartet)' };
  }

  function parseAnzahl(v) {
    const n = Math.round(parseNum(v));
    return n >= 1 ? Math.min(n, 20) : null;
  }

  function distance(lat1, lon1, lat2, lon2) {
    const R = 6371000, rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function fmtDist(m) {
    return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
  }

  function hasCoords(f) {
    return typeof f.lat === 'number' && typeof f.lon === 'number';
  }

  function siteLabel(f) {
    return f.kuerzel === f.name || !f.name ? f.kuerzel : `${f.kuerzel} – ${f.name}`;
  }

  function anzahlFor(f) {
    return (f && f.anzahl) || prefs.anzahl;
  }

  function download(blob, filename) {
    const file = new File([blob], filename, { type: blob.type });
    const touch = window.matchMedia && matchMedia('(pointer: coarse)').matches;
    if (touch && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: filename }).catch((e) => {
        if (e.name !== 'AbortError') saveFile(blob, filename);
      });
      return;
    }
    saveFile(blob, filename);
  }
  function saveFile(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function csvBlob(header, rows) {
    const q = (v) => {
      const s = v == null ? '' : String(v);
      return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [header, ...rows].map((r) => r.map(q).join(';'));
    return new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  }

  // Datenbank-Verbindung per Link übernehmen: index.html#db=<url>&key=<schlüssel>
  (function readConfigFromLink() {
    const p = new URLSearchParams(location.hash.slice(1));
    if (!p.get('db')) return;
    prefs.dbUrl = p.get('db').trim();
    prefs.dbKey = (p.get('key') || '').trim();
    save(KEY.prefs, prefs);
    history.replaceState(null, '', location.pathname + location.search);
    setTimeout(() => toast('Datenbank-Verbindung eingerichtet'), 300);
  })();

  // ---------- Tabs ----------
  $$('.tabs button').forEach((btn) => {
    btn.addEventListener('click', () => showTab(btn.dataset.tab));
  });
  function showTab(name) {
    $$('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    $$('.tab').forEach((t) => t.classList.toggle('active', t.id === 'tab-' + name));
    if (name === 'messungen') renderMessungen();
    if (name === 'fassungen') renderFassungen();
    if (name === 'einstellungen') renderEinstellungen();
    window.scrollTo(0, 0);
  }
  const activeTab = () => ($('.tab.active') || {}).id;

  // =====================================================================
  // ERFASSEN
  // =====================================================================
  const form = $('#form-messung');
  const selFassung = $('#f-fassung');
  const inpSuche = $('#f-fassung-suche');
  const inpFrei = $('#f-fassung-frei');
  const inpDatum = $('#f-datum');
  const inpAnzahl = $('#f-anzahl');

  const state = {
    pos: null,          // {lat, lon, acc}
    zuordnung: '',      // 'GPS automatisch' | 'GPS-Vorschlag' | 'Manuell'
    datumManuell: false
  };

  function setNow() {
    inpDatum.value = toLocalInput(new Date());
    state.datumManuell = false;
  }

  function initForm() {
    $('#f-projekt').value = prefs.projekt;
    $('#f-mitarbeiter').value = prefs.mitarbeiter;
    setRadio('typ', prefs.typ);
    setRadio('volumen', prefs.volumen);
    inpAnzahl.value = prefs.anzahl;
    setNow();
    renderDatalists();
    renderSelect();
  }

  function setRadio(name, value) {
    const r = form.querySelector(`input[name="${name}"][value="${value}"]`);
    if (r) r.checked = true;
  }
  function getRadio(name) {
    const r = form.querySelector(`input[name="${name}"]:checked`);
    return r ? r.value : '';
  }

  function renderDatalists() {
    const projekte = new Set(), leute = new Set();
    messungen.forEach((m) => { if (m.projekt) projekte.add(m.projekt); if (m.mitarbeiter) leute.add(m.mitarbeiter); });
    fassungen.forEach((f) => { if (f.projekt) projekte.add(f.projekt); });
    $('#dl-projekte').innerHTML = [...projekte].sort().map((p) => `<option value="${esc(p)}">`).join('');
    $('#dl-mitarbeiter').innerHTML = [...leute].sort().map((p) => `<option value="${esc(p)}">`).join('');
  }

  inpDatum.addEventListener('input', () => { state.datumManuell = true; });
  $('#btn-jetzt').addEventListener('click', setNow);

  // ---------- Fassungsauswahl ----------
  function sitesSorted() {
    const list = fassungen.map((f) => ({
      f,
      d: state.pos && hasCoords(f) ? distance(state.pos.lat, state.pos.lon, f.lat, f.lon) : null
    }));
    list.sort((a, b) => {
      if (a.d != null && b.d != null) return a.d - b.d;
      if (a.d != null) return -1;
      if (b.d != null) return 1;
      return a.f.kuerzel.localeCompare(b.f.kuerzel, 'de', { numeric: true });
    });
    return list;
  }

  function renderSelect() {
    const current = selFassung.value;
    const q = inpSuche.value.trim().toLowerCase();
    let html = '<option value="">– Fassung wählen –</option>';
    sitesSorted()
      .filter(({ f }) => !q || f.kuerzel.toLowerCase().includes(q) || (f.name || '').toLowerCase().includes(q))
      .forEach(({ f, d }) => {
        const dist = d != null ? ` (${fmtDist(d)})` : '';
        html += `<option value="${esc(f.kuerzel)}">${esc(siteLabel(f) + dist)}</option>`;
      });
    html += '<option value="__frei__">Andere / nicht in Liste …</option>';
    selFassung.innerHTML = html;
    if ([...selFassung.options].some((o) => o.value === current)) selFassung.value = current;
    inpFrei.hidden = selFassung.value !== '__frei__';
  }

  // Werte der gewählten Fassung ins Formular übernehmen
  function applySite(kuerzel) {
    const f = fassungen.find((x) => x.kuerzel === kuerzel);
    if (f) {
      if (f.typ) setRadio('typ', f.typ);
      if (f.projekt && !$('#f-projekt').value.trim()) $('#f-projekt').value = f.projekt;
    }
    if (kuerzel) setAnzahl(anzahlFor(f));
  }

  function chooseSite(kuerzel, zuordnung) {
    inpSuche.value = '';
    renderSelect();
    selFassung.value = kuerzel;
    state.zuordnung = zuordnung;
    inpFrei.hidden = kuerzel !== '__frei__';
    selFassung.classList.remove('invalid');
    applySite(kuerzel);
    $$('#gps-kandidaten .chip').forEach((c) => c.classList.toggle('active', c.dataset.k === kuerzel));
  }

  selFassung.addEventListener('change', () => {
    chooseSite(selFassung.value, selFassung.value ? 'Manuell' : '');
    if (selFassung.value === '__frei__') inpFrei.focus();
  });
  inpSuche.addEventListener('input', () => {
    renderSelect();
    // genau ein Treffer -> direkt auswählen
    const opts = [...selFassung.options].filter((o) => o.value && o.value !== '__frei__');
    if (inpSuche.value.trim() && opts.length === 1) {
      selFassung.value = opts[0].value;
      state.zuordnung = 'Manuell';
      applySite(opts[0].value);
    }
  });

  // ---------- GPS ----------
  const gpsStatus = $('#gps-status');
  const gpsChips = $('#gps-kandidaten');

  function setGpsStatus(text, cls) {
    gpsStatus.textContent = text;
    gpsStatus.className = 'hint' + (cls ? ' ' + cls : '');
  }

  function locate(force) {
    gpsChips.innerHTML = '';
    if (!('geolocation' in navigator)) {
      setGpsStatus('GPS nicht verfügbar – bitte Fassung manuell wählen.', 'warn');
      return;
    }
    setGpsStatus('GPS wird ermittelt …');
    navigator.geolocation.getCurrentPosition(
      (p) => {
        state.pos = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy };
        matchSite(force);
      },
      (err) => {
        state.pos = null;
        renderSelect();
        const why = err.code === 1 ? 'Zugriff verweigert' : err.code === 3 ? 'Zeitüberschreitung' : 'kein Empfang';
        setGpsStatus(`Kein GPS-Standort (${why}) – bitte Fassung manuell wählen.`, 'warn');
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 15000 }
    );
  }

  function matchSite(force) {
    renderSelect();
    const acc = Math.round(state.pos.acc);
    const withCoords = sitesSorted().filter((s) => s.d != null);
    if (!withCoords.length) {
      setGpsStatus(`Standort ±${acc} m. Keine Fassungskoordinaten hinterlegt – bitte manuell wählen.`, 'warn');
      return;
    }
    const tol = Math.max(prefs.radius, state.pos.acc);
    const near = withCoords.filter((s) => s.d <= tol);
    const userChose = state.zuordnung === 'Manuell' && selFassung.value && !force;

    if (near.length === 1) {
      if (!userChose) chooseSite(near[0].f.kuerzel, 'GPS automatisch');
      setGpsStatus(`Erkannt: ${siteLabel(near[0].f)} (${fmtDist(near[0].d)}, GPS ±${acc} m)`, 'ok');
      renderChips(near);
    } else if (near.length > 1) {
      setGpsStatus(`Mehrere Fassungen in der Nähe (GPS ±${acc} m) – bitte antippen:`, 'warn');
      renderChips(near.slice(0, 6));
    } else {
      setGpsStatus(`Keine Fassung im Umkreis von ${Math.round(tol)} m (GPS ±${acc} m). Nächstgelegene:`, 'warn');
      renderChips(withCoords.slice(0, 3));
    }
  }

  function renderChips(list) {
    gpsChips.innerHTML = list.map(({ f, d }) =>
      `<button type="button" class="chip${selFassung.value === f.kuerzel ? ' active' : ''}" data-k="${esc(f.kuerzel)}">` +
      `${esc(f.kuerzel)} · ${fmtDist(d)}</button>`).join('');
  }
  gpsChips.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (chip) chooseSite(chip.dataset.k, 'GPS-Vorschlag');
  });
  $('#btn-gps').addEventListener('click', () => locate(true));

  // ---------- Anzahl Messungen ----------
  function getAnzahl() {
    return parseAnzahl(inpAnzahl.value) || 1;
  }
  function setAnzahl(n) {
    inpAnzahl.value = n;
    swRender();
  }
  $('#anz-minus').addEventListener('click', () => setAnzahl(Math.max(1, getAnzahl() - 1)));
  $('#anz-plus').addEventListener('click', () => setAnzahl(Math.min(20, getAnzahl() + 1)));
  inpAnzahl.addEventListener('change', () => setAnzahl(getAnzahl()));

  // ---------- Stoppuhr (mehrere Einzelmessungen) ----------
  const sw = Object.assign({ running: false, start: 0, zeiten: [] }, load(KEY.sw, {}));
  if (!Array.isArray(sw.zeiten)) sw.zeiten = [];
  const swDisplay = $('#sw-display');
  const swStart = $('#sw-start');
  let swTimer = null, wakeLock = null;

  function swSave() { save(KEY.sw, { running: sw.running, start: sw.start, zeiten: sw.zeiten }); }

  function swRender() {
    const n = getAnzahl(), k = sw.zeiten.length;
    const info = $('#sw-info');
    const s = sw.running ? (Date.now() - sw.start) / 1000 : k ? sw.zeiten[k - 1] : 0;
    swDisplay.textContent = fmtDauer(s);

    info.className = 'sw-info';
    if (sw.running) {
      info.textContent = `Messung ${k + 1} von ${n} läuft …`;
      swStart.textContent = 'Stopp';
    } else if (k < n) {
      info.textContent = `Messung ${k + 1} von ${n}`;
      swStart.textContent = k ? `Start Messung ${k + 1}` : 'Start';
    } else {
      info.textContent = k === n ? `Alle ${n} Messungen erfasst` : `${k} Zeiten erfasst, aber nur ${n} vorgesehen`;
      info.classList.add(k === n ? 'done' : 'warn');
      swStart.textContent = 'Fertig';
    }
    swStart.disabled = !sw.running && k >= n;
    swStart.classList.toggle('running', sw.running);
    $('#btn-zeit-add').disabled = sw.running || k >= n;

    $('#sw-zeiten').innerHTML = sw.zeiten.map((z, i) =>
      `<li><span>${i + 1}.</span> ${z.toFixed(1)} s<button type="button" class="x" data-i="${i}" aria-label="Zeit ${i + 1} löschen">✕</button></li>`
    ).join('');
    $('#sw-reset').hidden = !k;

    const vol = parseFloat(getRadio('volumen'));
    if (k) {
      const m = mean(sw.zeiten), ls = vol / m;
      $('#sw-mittel').innerHTML = (k > 1 ? `Mittelwert ${m.toFixed(2)} s` : `Zeit ${m.toFixed(1)} s`) +
        `<small>Schüttung ≈ ${ls.toFixed(3)} l/s (${(ls * 60).toFixed(1)} l/min)</small>`;
    } else {
      $('#sw-mittel').innerHTML = '';
    }
  }

  async function keepAwake(on) {
    try {
      if (on && 'wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
      else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
    } catch (e) { /* nicht unterstützt */ }
  }
  function swTick(on) {
    clearInterval(swTimer);
    if (on) swTimer = setInterval(swRender, 100);
    keepAwake(on);
  }

  swStart.addEventListener('click', () => {
    if (sw.running) {
      const t = round((Date.now() - sw.start) / 1000, 1);
      sw.running = false;
      if (t > 0) sw.zeiten.push(t);
      swTick(false);
      if (navigator.vibrate) navigator.vibrate(80);
    } else {
      if (sw.zeiten.length >= getAnzahl()) return;
      if (!sw.zeiten.length && !state.datumManuell) setNow();
      sw.start = Date.now();
      sw.running = true;
      swTick(true);
    }
    swSave();
    swRender();
  });

  $('#sw-zeiten').addEventListener('click', (e) => {
    const x = e.target.closest('.x');
    if (!x) return;
    sw.zeiten.splice(Number(x.dataset.i), 1);
    swSave();
    swRender();
  });

  function addManualTime() {
    const inp = $('#f-zeit-manuell');
    const v = parseNum(inp.value);
    if (!(v > 0)) { inp.classList.add('invalid'); return; }
    inp.classList.remove('invalid');
    if (sw.zeiten.length >= getAnzahl()) return;
    sw.zeiten.push(round(v, 1));
    inp.value = '';
    swSave();
    swRender();
  }
  $('#btn-zeit-add').addEventListener('click', addManualTime);
  $('#f-zeit-manuell').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addManualTime(); }
  });

  $('#sw-reset').addEventListener('click', () => {
    if (sw.zeiten.length > 1 && !confirm('Alle erfassten Zeiten löschen?')) return;
    swReset();
  });
  function swReset() {
    sw.running = false;
    sw.zeiten = [];
    swTick(false);
    swSave();
    swRender();
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && sw.running) keepAwake(true);
  });
  $('#seg-volumen').addEventListener('change', swRender);

  // ---------- Speichern ----------
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fehler = [];
    $$('#form-messung .invalid').forEach((el) => el.classList.remove('invalid'));
    const mark = (el, msg) => { el.classList.add('invalid'); fehler.push(msg); };

    const projekt = $('#f-projekt').value.trim();
    const mitarbeiter = $('#f-mitarbeiter').value.trim();
    const datum = inpDatum.value;
    const fassungWert = selFassung.value;
    const frei = inpFrei.value.trim();
    const volumen = parseFloat(getRadio('volumen'));
    const n = getAnzahl(), zeiten = sw.zeiten.slice();

    if (!projekt) mark($('#f-projekt'), 'Projektname fehlt');
    if (!mitarbeiter) mark($('#f-mitarbeiter'), 'Name Probenehmer/in fehlt');
    if (!datum) mark(inpDatum, 'Datum/Uhrzeit fehlt');
    if (!fassungWert) mark(selFassung, 'Probestandort fehlt');
    if (fassungWert === '__frei__' && !frei) mark(inpFrei, 'Name der Fassung fehlt');
    if (sw.running) fehler.push('Stoppuhr läuft noch – bitte zuerst stoppen');
    else if (!zeiten.length) fehler.push('Keine Zeitmessung erfasst');
    else if (zeiten.length !== n) fehler.push(`${zeiten.length} von ${n} Messungen erfasst`);

    const box = $('#form-fehler');
    if (fehler.length) {
      box.textContent = fehler.join(' · ');
      box.hidden = false;
      return;
    }
    box.hidden = true;

    const f = fassungen.find((x) => x.kuerzel === fassungWert);
    const pos = state.pos;
    const mittel = mean(zeiten);
    const rec = {
      id: uid(),
      erfasst: new Date().toISOString(),
      datum,
      typ: getRadio('typ'),
      projekt,
      mitarbeiter,
      fassungKuerzel: f ? f.kuerzel : '',
      fassungName: f ? f.name : frei,
      zuordnung: f ? state.zuordnung || 'Manuell' : 'Freitext',
      volumen,
      zeiten,
      zeit: round(mittel, 2),
      schuettung: round(volumen / mittel, 4),
      gpsLat: pos ? round(pos.lat, 6) : null,
      gpsLon: pos ? round(pos.lon, 6) : null,
      gpsGenauigkeit: pos ? Math.round(pos.acc) : null,
      distanz: pos && f && hasCoords(f) ? Math.round(distance(pos.lat, pos.lon, f.lat, f.lon)) : null,
      bemerkung: $('#f-bemerkung').value.trim(),
      synced: false
    };

    messungen.push(rec);
    if (!save(KEY.messungen, messungen)) { messungen.pop(); return; }

    Object.assign(prefs, { projekt, mitarbeiter, typ: rec.typ, volumen: String(volumen) });
    save(KEY.prefs, prefs);

    // Formular für die nächste Probe vorbereiten
    $('#f-bemerkung').value = '';
    inpFrei.value = '';
    selFassung.value = '';
    state.zuordnung = '';
    swReset();
    setAnzahl(prefs.anzahl);
    setNow();
    renderDatalists();
    updateCount();
    toast(`Gespeichert: ${rec.fassungKuerzel || rec.fassungName}`);
    window.scrollTo(0, 0);
    locate(true);
    sync({ silent: true });
  });

  // =====================================================================
  // MESSUNGEN
  // =====================================================================
  function updateCount() {
    $('#count-badge').textContent = messungen.length ? `(${messungen.length})` : '';
  }

  const pendingCount = () => messungen.filter((m) => !m.synced).length;

  function renderMessungen() {
    renderSyncInfo();
    const ul = $('#liste-messungen');
    const btnDel = $('#btn-alle-loeschen');
    if (!messungen.length) {
      ul.innerHTML = '<li class="empty">Keine Messungen auf diesem Gerät.</li>';
      btnDel.hidden = true;
      return;
    }
    btnDel.hidden = false;
    btnDel.textContent = prefs.dbUrl ? 'Übertragene Messungen vom Gerät entfernen' : 'Alle Messungen löschen';

    const sorted = [...messungen].sort((a, b) => (b.datum + b.erfasst).localeCompare(a.datum + a.erfasst));
    ul.innerHTML = sorted.map((m) => {
      const name = m.fassungKuerzel ? `${m.fassungKuerzel} – ${m.fassungName}` : m.fassungName;
      const sync = !prefs.dbUrl ? '' : m.synced
        ? '<span class="sync">☁︎ übertragen</span>'
        : '<span class="sync pending">⏳ ausstehend</span>';
      const zeiten = m.zeiten.length > 1 ? ` (${m.zeiten.map((z) => z.toFixed(1)).join(' / ')})` : '';
      return `<li>
        <div class="main">
          <div class="title">${esc(name)} ${sync}</div>
          <div class="meta">${esc(fmtDate(new Date(m.datum)))} · ${esc(m.mitarbeiter)} · ${esc(m.projekt)}</div>
          <div class="meta">${m.volumen} l · ${m.zeiten.length}× · Ø ${fmtNum(m.zeit, 2)} s${zeiten} · ${fmtNum(m.schuettung, 3)} l/s</div>
          <div class="meta">${esc(m.typ)} · ${esc(m.zuordnung)}${m.bemerkung ? ' · ' + esc(m.bemerkung) : ''}</div>
        </div>
        <button class="del" data-id="${esc(m.id)}" aria-label="Löschen">✕</button>
      </li>`;
    }).join('');
  }

  $('#liste-messungen').addEventListener('click', (e) => {
    const btn = e.target.closest('.del');
    if (!btn) return;
    const m = messungen.find((x) => x.id === btn.dataset.id);
    const msg = m && m.synced
      ? 'Messung von diesem Gerät entfernen?\n(In der Datenbank bleibt sie erhalten.)'
      : 'Diese Messung löschen?' + (prefs.dbUrl ? '\nSie wurde noch NICHT in die Datenbank übertragen!' : '');
    if (!confirm(msg)) return;
    messungen = messungen.filter((x) => x.id !== btn.dataset.id);
    save(KEY.messungen, messungen);
    renderMessungen();
    updateCount();
    updateSyncBadge();
  });

  $('#btn-alle-loeschen').addEventListener('click', () => {
    if (prefs.dbUrl) {
      const n = messungen.filter((m) => m.synced).length;
      if (!n) return toast('Noch keine Messung übertragen.');
      if (!confirm(`${n} übertragene Messungen von diesem Gerät entfernen?\n(In der Datenbank bleiben sie erhalten.)`)) return;
      messungen = messungen.filter((m) => !m.synced);
    } else {
      if (!confirm(`Alle ${messungen.length} Messungen auf diesem Gerät löschen?\nBitte vorher exportieren!`)) return;
      messungen = [];
    }
    save(KEY.messungen, messungen);
    renderMessungen();
    updateCount();
  });

  // Felder einer Messung in Spaltenreihenfolge (für Excel, CSV und Datenbank)
  function messFields(m, minZeiten) {
    const fields = [
      ['Probe genommen am', new Date(m.datum)],
      ['Fassungsart', m.typ],
      ['Projekt', m.projekt],
      ['Probe genommen von', m.mitarbeiter],
      ['Fassung Kürzel', m.fassungKuerzel],
      ['Fassung Name', m.fassungName],
      ['Zuordnung', m.zuordnung],
      ['Probengrösse [l]', m.volumen],
      ['Anzahl Messungen', m.zeiten.length],
      ['Mittelwert Zeit [s]', m.zeit]
    ];
    const nz = Math.max(minZeiten || 0, m.zeiten.length);
    for (let i = 0; i < nz; i++) fields.push([`Zeit ${i + 1} [s]`, i < m.zeiten.length ? m.zeiten[i] : null]);
    fields.push(
      ['Schüttung [l/s]', m.schuettung],
      ['Schüttung [l/min]', m.schuettung != null ? round(m.schuettung * 60, 2) : null],
      ['GPS Breite', m.gpsLat],
      ['GPS Länge', m.gpsLon],
      ['GPS Genauigkeit [m]', m.gpsGenauigkeit],
      ['Distanz zur Fassung [m]', m.distanz],
      ['Bemerkung', m.bemerkung],
      ['Erfasst am', new Date(m.erfasst)],
      ['ID', m.id]
    );
    return fields;
  }

  function messTable(dateAsText) {
    const sorted = [...messungen].sort((a, b) => a.datum.localeCompare(b.datum));
    const maxZ = Math.max(1, ...sorted.map((m) => m.zeiten.length));
    const header = messFields(sorted[0], maxZ).map(([h]) => h);
    const rows = sorted.map((m) => messFields(m, maxZ).map(([, v]) =>
      v instanceof Date ? (dateAsText ? fmtDate(v) : v) : v));
    return { header, rows };
  }

  const FASS_HEADER = ['Kürzel', 'Name', 'Art', 'Projekt', 'Breite', 'Länge', 'Anzahl Messungen'];
  function fassRows() {
    return fassungen.map((f) => [f.kuerzel, f.name, f.typ, f.projekt,
      hasCoords(f) ? round(f.lat, 6) : null, hasCoords(f) ? round(f.lon, 6) : null, f.anzahl || null]);
  }
  const widths = (header) => header.map((h) => ({ header: h, width: Math.max(11, h.length + 3) }));

  $('#btn-export-xlsx').addEventListener('click', () => {
    if (!messungen.length) return toast('Keine Messungen vorhanden.');
    const t = messTable(false);
    const blob = XLSX.build([
      { name: 'Messungen', columns: widths(t.header), rows: t.rows },
      { name: 'Fassungen', columns: widths(FASS_HEADER), rows: fassRows() }
    ]);
    download(blob, `GeoWater_Messungen_${fileStamp()}.xlsx`);
  });

  $('#btn-export-csv').addEventListener('click', () => {
    if (!messungen.length) return toast('Keine Messungen vorhanden.');
    const t = messTable(true);
    download(csvBlob(t.header, t.rows), `GeoWater_Messungen_${fileStamp()}.csv`);
  });

  // =====================================================================
  // FASSUNGEN
  // =====================================================================
  const formF = $('#form-fassung');
  const lc = (s) => String(s).toLowerCase();

  function upsertLocal(f) {
    const i = fassungen.findIndex((x) => lc(x.kuerzel) === lc(f.kuerzel));
    if (i >= 0) { fassungen[i] = f; return 'update'; }
    fassungen.push(f);
    return 'neu';
  }
  function upsertFassung(f) {
    fassQueue[lc(f.kuerzel)] = { op: 'upsert', f };
    return upsertLocal(f);
  }
  function deleteFassung(kuerzel) {
    fassQueue[lc(kuerzel)] = { op: 'delete', f: { kuerzel } };
    fassungen = fassungen.filter((f) => lc(f.kuerzel) !== lc(kuerzel));
  }

  function sortFassungen() {
    fassungen.sort((a, b) => a.kuerzel.localeCompare(b.kuerzel, 'de', { numeric: true }));
  }

  function afterFassungenChanged(fromServer) {
    sortFassungen();
    save(KEY.fassungen, fassungen);
    save(KEY.fassQueue, fassQueue);
    if (activeTab() === 'tab-fassungen') renderFassungen();
    renderDatalists();
    if (state.pos) matchSite(false); else renderSelect();
    if (!fromServer) { updateSyncBadge(); sync({ silent: true }); }
  }

  function renderFassungen() {
    const ul = $('#liste-fassungen');
    if (!fassungen.length) {
      ul.innerHTML = '<li class="empty">Noch keine Fassungen erfasst.</li>';
      return;
    }
    ul.innerHTML = fassungen.map((f) => `<li>
        <div class="main" data-k="${esc(f.kuerzel)}">
          <div class="title">${esc(siteLabel(f))}${fassQueue[lc(f.kuerzel)] && prefs.dbUrl ? ' <span class="sync pending">⏳</span>' : ''}</div>
          <div class="meta">${esc([f.typ, f.projekt, `${anzahlFor(f)} Messungen${f.anzahl ? '' : ' (Standard)'}`].filter(Boolean).join(' · '))}</div>
          <div class="meta">${hasCoords(f) ? `${f.lat.toFixed(5)}, ${f.lon.toFixed(5)}` : 'keine Koordinaten'}</div>
        </div>
        <button class="del" data-k="${esc(f.kuerzel)}" aria-label="Löschen">✕</button>
      </li>`).join('');
  }

  $('#liste-fassungen').addEventListener('click', (e) => {
    const del = e.target.closest('.del');
    if (del) {
      const wo = prefs.dbUrl ? ' (auch in der geteilten Datenbank)' : '';
      if (!confirm(`Fassung «${del.dataset.k}» löschen${wo}?`)) return;
      deleteFassung(del.dataset.k);
      afterFassungenChanged();
      return;
    }
    // Antippen = zum Bearbeiten ins Formular laden
    const item = e.target.closest('.main');
    const f = item && fassungen.find((x) => x.kuerzel === item.dataset.k);
    if (!f) return;
    $('#s-kuerzel').value = f.kuerzel;
    $('#s-name').value = f.name || '';
    $('#s-typ').value = f.typ || 'Quelle';
    $('#s-anzahl').value = f.anzahl || '';
    $('#s-projekt').value = f.projekt || '';
    $('#s-lat').value = hasCoords(f) ? f.lat.toFixed(6) : '';
    $('#s-lon').value = hasCoords(f) ? f.lon.toFixed(6) : '';
    window.scrollTo(0, 0);
  });

  formF.addEventListener('submit', (e) => {
    e.preventDefault();
    const box = $('#fassung-fehler');
    const kuerzel = $('#s-kuerzel').value.trim();
    const name = $('#s-name').value.trim();
    const c = parseCoords($('#s-lat').value, $('#s-lon').value);
    const anzRaw = $('#s-anzahl').value.trim();
    const anzahl = parseAnzahl(anzRaw);
    const fehler = [];
    if (!kuerzel) fehler.push('Kürzel fehlt');
    if (!name) fehler.push('Name fehlt');
    if (c && c.error) fehler.push(c.error);
    if (anzRaw && !anzahl) fehler.push('Anzahl Messungen ungültig');
    if (fehler.length) {
      box.textContent = fehler.join(' · ');
      box.hidden = false;
      return;
    }
    box.hidden = true;
    const f = { kuerzel, name, typ: $('#s-typ').value, projekt: $('#s-projekt').value.trim() };
    if (c) { f.lat = c.lat; f.lon = c.lon; }
    if (anzahl) f.anzahl = anzahl;
    const res = upsertFassung(f);
    afterFassungenChanged();
    formF.reset();
    toast(res === 'neu' ? `Fassung ${kuerzel} hinzugefügt` : `Fassung ${kuerzel} aktualisiert`);
  });

  $('#btn-s-gps').addEventListener('click', () => {
    if (!('geolocation' in navigator)) return toast('GPS nicht verfügbar');
    toast('GPS wird ermittelt …');
    navigator.geolocation.getCurrentPosition(
      (p) => {
        $('#s-lat').value = p.coords.latitude.toFixed(6);
        $('#s-lon').value = p.coords.longitude.toFixed(6);
        toast(`Standort übernommen (±${Math.round(p.coords.accuracy)} m)`);
      },
      () => toast('Kein GPS-Standort verfügbar'),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  });

  // ---------- Tabellen-Zeilen -> Fassungen (CSV-Import und Datenbank) ----------
  const HEADER_ALIASES = {
    kuerzel: ['kurzel', 'kuerzel', 'kurz', 'code', 'id', 'nr', 'nummer', 'abk', 'abkurzung', 'kurzname'],
    name: ['name', 'bezeichnung', 'fassung', 'fassungsname', 'quelle', 'quellname', 'standort'],
    typ: ['typ', 'art', 'fassungsart', 'fassungstyp', 'type'],
    projekt: ['projekt', 'projektname', 'project'],
    anzahl: ['anzahlmessungen', 'anzmessungen', 'anzahl', 'messungen', 'wiederholungen'],
    a: ['lat', 'latitude', 'breite', 'breitengrad', 'n', 'nord', 'north', 'northing', 'x', 'hochwert'],
    b: ['lon', 'lng', 'long', 'longitude', 'lange', 'langengrad', 'e', 'ost', 'east', 'easting', 'y', 'rechtswert']
  };
  const normHeader = (h) => String(h).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, '').replace(/[^a-z0-9]/g, '');

  function normTyp(s) {
    const t = (s || '').toLowerCase();
    if (t.includes('grund') || t === 'gw' || t.includes('brunnen')) return 'Grundwasserfassung';
    if (t.includes('quel') || t === 'q') return 'Quelle';
    return '';
  }

  function rowsToFassungen(header, rows) {
    const idx = {};
    header.forEach((h, i) => {
      // «Breite / N» -> passt auf «breite» oder «n»
      const parts = [h, ...String(h).split(/[\/|]/)].map(normHeader);
      for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
        if (idx[key] == null && parts.some((n) => aliases.includes(n))) { idx[key] = i; break; }
      }
    });
    if (idx.kuerzel == null && idx.name == null) return { error: 'Spalte «Kürzel» oder «Name» nicht gefunden.' };

    const list = [], fehlerZeilen = [];
    rows.forEach((r, i) => {
      const get = (k) => (idx[k] != null && r[idx[k]] != null ? String(r[idx[k]]).trim() : '');
      const kuerzel = get('kuerzel') || get('name');
      if (!kuerzel) { if (r.some((v) => String(v).trim())) fehlerZeilen.push(i + 2); return; }
      const f = { kuerzel, name: get('name') || kuerzel, typ: normTyp(get('typ')), projekt: get('projekt') };
      const c = parseCoords(get('a'), get('b'));
      if (c && c.error) fehlerZeilen.push(i + 2);
      else if (c) { f.lat = c.lat; f.lon = c.lon; }
      const anz = parseAnzahl(get('anzahl'));
      if (anz) f.anzahl = anz;
      list.push(f);
    });
    return { list, fehlerZeilen };
  }

  // ---------- CSV-Import ----------
  function parseCsv(text) {
    text = text.replace(/^﻿/, '');
    const firstLine = text.split(/\r?\n/, 1)[0];
    const counts = [';', '\t', ','].map((d) => [d, firstLine.split(d).length]);
    const delim = counts.sort((a, b) => b[1] - a[1])[0][0];

    const rows = [];
    let row = [], field = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQ) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
        } else field += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === delim) { row.push(field); field = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field); rows.push(row); row = []; field = '';
      } else field += ch;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    return rows.filter((r) => r.some((v) => v.trim()));
  }

  $('#file-fassungen').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    let text = await file.text();
    // ältere Excel-CSV-Exporte sind oft Windows-1252 statt UTF-8
    if (text.includes('�')) {
      try { text = new TextDecoder('windows-1252').decode(await file.arrayBuffer()); } catch (err) { /* ignorieren */ }
    }
    const rows = parseCsv(text);
    if (rows.length < 2) return toast('Datei enthält keine Daten.');
    const res = rowsToFassungen(rows[0], rows.slice(1));
    if (res.error) return toast(res.error);

    let neu = 0, upd = 0;
    res.list.forEach((f) => { upsertFassung(f) === 'neu' ? neu++ : upd++; });
    afterFassungenChanged();
    let msg = `${neu} neu, ${upd} aktualisiert`;
    const fz = res.fehlerZeilen;
    if (fz.length) msg += ` · Probleme in Zeile ${fz.slice(0, 5).join(', ')}${fz.length > 5 ? ' …' : ''}`;
    toast(msg);
  });

  $('#btn-fassungen-export').addEventListener('click', () => {
    if (!fassungen.length) return toast('Keine Fassungen vorhanden.');
    download(csvBlob(FASS_HEADER, fassRows()), `GeoWater_Fassungen_${fileStamp()}.csv`);
  });

  // =====================================================================
  // GETEILTE DATENBANK (Google-Tabelle über Apps Script)
  // =====================================================================
  let syncing = false, syncAgain = false;

  function messSyncObj(m) {
    const o = {};
    messFields(m).forEach(([k, v]) => { o[k] = v instanceof Date ? toLocalIso(v) : v; });
    return o;
  }

  async function api(body) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    try {
      // text/plain-Body: kein CORS-Preflight, funktioniert mit Apps Script
      const res = await fetch(prefs.dbUrl, {
        method: 'POST',
        body: JSON.stringify(Object.assign({ key: prefs.dbKey }, body)),
        signal: ctrl.signal
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      let data;
      try { data = await res.json(); } catch (e) { throw new Error('ungültige Antwort – URL prüfen'); }
      if (!data.ok) throw new Error(data.error || 'unbekannter Fehler');
      return data;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('Zeitüberschreitung');
      if (e instanceof TypeError) throw new Error('Server nicht erreichbar');
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  async function sync(opts) {
    opts = opts || {};
    if (!prefs.dbUrl) {
      if (!opts.silent) toast('Keine Datenbank eingerichtet (⚙)');
      return false;
    }
    if (syncing) { syncAgain = true; return false; }
    if (!navigator.onLine) {
      updateSyncBadge();
      if (!opts.silent) toast('Offline – wird später übertragen');
      return false;
    }
    syncing = true;
    updateSyncBadge();
    const pend = messungen.filter((m) => !m.synced);
    const ops = Object.values(fassQueue);
    try {
      const data = await api({
        action: 'sync',
        messungen: pend.map((m) => ({ id: m.id, werte: messSyncObj(m) })),
        fassungen: ops
      });

      const ok = new Set(data.ids || []);
      messungen.forEach((m) => { if (ok.has(m.id)) m.synced = true; });
      save(KEY.messungen, messungen);

      // nur gesendete Änderungen entfernen – neue könnten inzwischen dazugekommen sein
      ops.forEach((o) => { const k = lc(o.f.kuerzel); if (fassQueue[k] === o) delete fassQueue[k]; });
      if (data.fassungen) {
        const res = rowsToFassungen(data.fassungen.header || [], data.fassungen.rows || []);
        if (!res.error) {
          fassungen = res.list;
          Object.values(fassQueue).forEach((o) => {
            if (o.op === 'delete') fassungen = fassungen.filter((f) => lc(f.kuerzel) !== lc(o.f.kuerzel));
            else upsertLocal(o.f);
          });
          afterFassungenChanged(true);
        }
      }
      save(KEY.fassQueue, fassQueue);

      if (data.url) prefs.sheetUrl = data.url;
      prefs.lastSync = Date.now();
      save(KEY.prefs, prefs);
      setDbStatus(`Verbunden · zuletzt synchronisiert ${fmtDate(new Date())}`, 'ok');
      if (!opts.silent) toast(pend.length ? `${ok.size} Messungen übertragen` : 'Synchronisiert');
      return true;
    } catch (e) {
      setDbStatus('Synchronisation fehlgeschlagen: ' + e.message, 'warn');
      if (!opts.silent) toast('Synchronisation fehlgeschlagen: ' + e.message);
      return false;
    } finally {
      syncing = false;
      updateSyncBadge();
      if (activeTab() === 'tab-messungen') renderMessungen();
      if (activeTab() === 'tab-einstellungen') renderEinstellungen();
      if (syncAgain) { syncAgain = false; setTimeout(() => sync({ silent: true }), 300); }
    }
  }

  function updateSyncBadge() {
    const b = $('#sync-badge');
    const n = pendingCount();
    b.classList.remove('warn');
    if (!navigator.onLine) {
      b.textContent = n ? `offline · ${n} ausstehend` : 'offline';
      b.hidden = false;
    } else if (!prefs.dbUrl) {
      b.hidden = true;
    } else if (syncing) {
      b.textContent = 'synchronisiere …';
      b.hidden = false;
    } else if (n) {
      b.textContent = `⏳ ${n} ausstehend`;
      b.classList.add('warn');
      b.hidden = false;
    } else {
      b.textContent = '☁︎ synchron';
      b.hidden = false;
    }
  }
  $('#sync-badge').addEventListener('click', () => sync());

  let dbStatus = { text: '', cls: '' };
  function setDbStatus(text, cls) { dbStatus = { text, cls }; }

  function renderSyncInfo() {
    const el = $('#mess-sync');
    if (!prefs.dbUrl) {
      el.textContent = 'Keine geteilte Datenbank eingerichtet (⚙). Daten nur auf diesem Gerät.';
      return;
    }
    const n = pendingCount();
    const last = prefs.lastSync ? ` · zuletzt ${fmtDate(new Date(prefs.lastSync))}` : '';
    el.textContent = n ? `${n} Messung(en) noch nicht in der Datenbank${last}` : `Alle Messungen in der Datenbank${last}`;
  }

  function renderEinstellungen() {
    $('#set-db-url').value = prefs.dbUrl;
    $('#set-db-key').value = prefs.dbKey;
    $('#set-anzahl').value = prefs.anzahl;
    $('#set-radius').value = prefs.radius;
    const st = $('#db-status');
    st.textContent = prefs.dbUrl ? dbStatus.text || (prefs.lastSync ? `Zuletzt synchronisiert ${fmtDate(new Date(prefs.lastSync))}` : '') : '';
    st.className = 'hint' + (dbStatus.cls && prefs.dbUrl ? ' ' + dbStatus.cls : '');
    const link = $('#db-sheet-link');
    link.hidden = !(prefs.dbUrl && prefs.sheetUrl);
    if (prefs.sheetUrl) link.href = prefs.sheetUrl;
    $('#btn-db-link').hidden = !prefs.dbUrl;
    $('#btn-sync').hidden = !prefs.dbUrl;
  }

  $('#btn-db-save').addEventListener('click', async () => {
    const url = $('#set-db-url').value.trim();
    if (url && !/^https:\/\//i.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)/i.test(url)) {
      return toast('Die URL muss mit https:// beginnen.');
    }
    if (url !== prefs.dbUrl) { prefs.sheetUrl = ''; prefs.lastSync = 0; }
    prefs.dbUrl = url;
    prefs.dbKey = $('#set-db-key').value.trim();
    save(KEY.prefs, prefs);
    setDbStatus(url ? 'Verbinde …' : '', '');
    renderEinstellungen();
    updateSyncBadge();
    if (url) await sync();
    else toast('Datenbank-Verbindung entfernt');
  });
  $('#btn-sync').addEventListener('click', () => sync());

  $('#btn-db-link').addEventListener('click', async () => {
    const link = `${location.origin}${location.pathname}#db=${encodeURIComponent(prefs.dbUrl)}&key=${encodeURIComponent(prefs.dbKey)}`;
    const touch = window.matchMedia && matchMedia('(pointer: coarse)').matches;
    try {
      if (touch && navigator.share) await navigator.share({ title: 'Geo-Water', text: 'Geo-Water mit geteilter Datenbank öffnen:', url: link });
      else { await navigator.clipboard.writeText(link); toast('Link kopiert – auf dem anderen Gerät öffnen'); }
    } catch (e) {
      if (e.name !== 'AbortError') prompt('Link kopieren:', link);
    }
  });

  $('#set-anzahl').addEventListener('change', (e) => {
    prefs.anzahl = parseAnzahl(e.target.value) || 3;
    e.target.value = prefs.anzahl;
    save(KEY.prefs, prefs);
    if (!selFassung.value && !sw.zeiten.length) setAnzahl(prefs.anzahl);
  });
  $('#set-radius').addEventListener('change', (e) => {
    const v = parseNum(e.target.value);
    prefs.radius = v >= 10 ? Math.round(v) : 100;
    e.target.value = prefs.radius;
    save(KEY.prefs, prefs);
    if (state.pos) matchSite(false);
  });

  // automatisch synchronisieren: wieder online, App wieder im Vordergrund, alle 2 Minuten bei Rückstand
  window.addEventListener('online', () => { updateSyncBadge(); sync({ silent: true }); });
  window.addEventListener('offline', updateSyncBadge);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') sync({ silent: true });
  });
  setInterval(() => {
    if (pendingCount() || Object.keys(fassQueue).length) sync({ silent: true });
  }, 120000);

  // =====================================================================
  // START
  // =====================================================================
  initForm();
  updateCount();
  swRender();
  if (sw.running) swTick(true);
  updateSyncBadge();
  locate(false);
  sync({ silent: true });

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
