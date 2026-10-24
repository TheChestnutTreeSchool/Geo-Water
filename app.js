/* Geo-Water – Erfassung von Quellwasser-Probenahmen */
(function () {
  'use strict';

  // ---------- Speicher ----------
  const KEY = { messungen: 'gw.messungen', fassungen: 'gw.fassungen', prefs: 'gw.prefs', sw: 'gw.stoppuhr' };

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

  let messungen = load(KEY.messungen, []);
  let fassungen = load(KEY.fassungen, []);
  const prefs = Object.assign({ projekt: '', mitarbeiter: '', typ: 'Quelle', volumen: '10', radius: 100 }, load(KEY.prefs, {}));

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
  function fmtDate(d) {
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function fmtNum(n, digits) {
    return n == null || !isFinite(n) ? '' : Number(n).toFixed(digits);
  }
  function fileStamp() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
  }
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

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
    const emptyA = !String(aStr || '').trim(), emptyB = !String(bStr || '').trim();
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

  // ---------- Tabs ----------
  $$('.tabs button').forEach((btn) => {
    btn.addEventListener('click', () => showTab(btn.dataset.tab));
  });
  function showTab(name) {
    $$('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    $$('.tab').forEach((t) => t.classList.toggle('active', t.id === 'tab-' + name));
    if (name === 'messungen') renderMessungen();
    if (name === 'fassungen') renderFassungen();
    window.scrollTo(0, 0);
  }

  // ---------- Online-Status ----------
  function updateOnline() { $('#offline-badge').hidden = navigator.onLine; }
  window.addEventListener('online', updateOnline);
  window.addEventListener('offline', updateOnline);
  updateOnline();

  // =====================================================================
  // ERFASSEN
  // =====================================================================
  const form = $('#form-messung');
  const selFassung = $('#f-fassung');
  const inpSuche = $('#f-fassung-suche');
  const inpFrei = $('#f-fassung-frei');
  const inpDatum = $('#f-datum');
  const inpZeit = $('#f-zeit');

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

  function chooseSite(kuerzel, zuordnung) {
    inpSuche.value = '';
    renderSelect();
    selFassung.value = kuerzel;
    state.zuordnung = zuordnung;
    inpFrei.hidden = kuerzel !== '__frei__';
    selFassung.classList.remove('invalid');
    const f = fassungen.find((x) => x.kuerzel === kuerzel);
    if (f) {
      if (f.typ) setRadio('typ', f.typ);
      if (f.projekt && !$('#f-projekt').value.trim()) $('#f-projekt').value = f.projekt;
    }
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
      const f = fassungen.find((x) => x.kuerzel === opts[0].value);
      if (f && f.typ) setRadio('typ', f.typ);
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

  // ---------- Stoppuhr ----------
  const sw = Object.assign({ running: false, start: 0, elapsed: 0 }, load(KEY.sw, {}));
  const swDisplay = $('#sw-display');
  const swStart = $('#sw-start');
  let swTimer = null, wakeLock = null;

  function swMs() {
    return sw.elapsed + (sw.running ? Date.now() - sw.start : 0);
  }
  function swRender() {
    const s = swMs() / 1000;
    const min = Math.floor(s / 60);
    swDisplay.textContent = s >= 60 ? `${min}:${(s - min * 60).toFixed(1).padStart(4, '0')} min` : `${s.toFixed(1)} s`;
    swStart.textContent = sw.running ? 'Stopp' : sw.elapsed > 0 ? 'Weiter' : 'Start';
    swStart.classList.toggle('running', sw.running);
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
      sw.elapsed += Date.now() - sw.start;
      sw.running = false;
      inpZeit.value = (sw.elapsed / 1000).toFixed(1);
      swTick(false);
    } else {
      if (sw.elapsed === 0 && !state.datumManuell) setNow();
      sw.start = Date.now();
      sw.running = true;
      swTick(true);
    }
    save(KEY.sw, sw);
    swRender();
    updateSchuettung();
  });
  $('#sw-reset').addEventListener('click', swReset);
  function swReset() {
    sw.running = false;
    sw.elapsed = 0;
    inpZeit.value = '';
    swTick(false);
    save(KEY.sw, sw);
    swRender();
    updateSchuettung();
  }
  inpZeit.addEventListener('input', () => {
    if (sw.running) return;
    const v = parseNum(inpZeit.value);
    sw.elapsed = isNaN(v) ? 0 : Math.round(v * 1000);
    save(KEY.sw, sw);
    swRender();
    updateSchuettung();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && sw.running) keepAwake(true);
  });

  function updateSchuettung() {
    const vol = parseFloat(getRadio('volumen'));
    const sek = parseNum(inpZeit.value);
    const el = $('#schuettung');
    if (vol > 0 && sek > 0) {
      const ls = vol / sek;
      el.textContent = `Schüttung ≈ ${ls.toFixed(3)} l/s (${(ls * 60).toFixed(1)} l/min)`;
    } else {
      el.textContent = '';
    }
  }
  $('#seg-volumen').addEventListener('change', updateSchuettung);

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
    const zeit = parseNum(inpZeit.value);

    if (!projekt) mark($('#f-projekt'), 'Projektname fehlt');
    if (!mitarbeiter) mark($('#f-mitarbeiter'), 'Name Probenehmer/in fehlt');
    if (!datum) mark(inpDatum, 'Datum/Uhrzeit fehlt');
    if (!fassungWert) mark(selFassung, 'Probestandort fehlt');
    if (fassungWert === '__frei__' && !frei) mark(inpFrei, 'Name der Fassung fehlt');
    if (sw.running) fehler.push('Stoppuhr läuft noch – bitte zuerst stoppen');
    else if (!(zeit > 0)) mark(inpZeit, 'Zeitaufwand fehlt');

    const box = $('#form-fehler');
    if (fehler.length) {
      box.textContent = fehler.join(' · ');
      box.hidden = false;
      return;
    }
    box.hidden = true;

    const f = fassungen.find((x) => x.kuerzel === fassungWert);
    const pos = state.pos;
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
      zeit: Math.round(zeit * 10) / 10,
      schuettung: Math.round((volumen / zeit) * 10000) / 10000,
      gpsLat: pos ? Math.round(pos.lat * 1e6) / 1e6 : null,
      gpsLon: pos ? Math.round(pos.lon * 1e6) / 1e6 : null,
      gpsGenauigkeit: pos ? Math.round(pos.acc) : null,
      distanz: pos && f && hasCoords(f) ? Math.round(distance(pos.lat, pos.lon, f.lat, f.lon)) : null,
      bemerkung: $('#f-bemerkung').value.trim()
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
    setNow();
    renderDatalists();
    updateCount();
    toast(`Gespeichert: ${rec.fassungKuerzel || rec.fassungName}`);
    window.scrollTo(0, 0);
    locate(true);
  });

  // =====================================================================
  // MESSUNGEN
  // =====================================================================
  function updateCount() {
    $('#count-badge').textContent = messungen.length ? `(${messungen.length})` : '';
  }

  function renderMessungen() {
    const ul = $('#liste-messungen');
    if (!messungen.length) {
      ul.innerHTML = '<li class="empty">Noch keine Messungen erfasst.</li>';
      $('#btn-alle-loeschen').hidden = true;
      return;
    }
    $('#btn-alle-loeschen').hidden = false;
    const sorted = [...messungen].sort((a, b) => (b.datum + b.erfasst).localeCompare(a.datum + a.erfasst));
    ul.innerHTML = sorted.map((m) => {
      const name = m.fassungKuerzel ? `${m.fassungKuerzel} – ${m.fassungName}` : m.fassungName;
      return `<li>
        <div class="main">
          <div class="title">${esc(name)}</div>
          <div class="meta">${esc(fmtDate(new Date(m.datum)))} · ${esc(m.mitarbeiter)} · ${esc(m.projekt)}</div>
          <div class="meta">${m.volumen} l in ${fmtNum(m.zeit, 1)} s · ${fmtNum(m.schuettung, 3)} l/s · ${esc(m.typ)} · ${esc(m.zuordnung)}</div>
          ${m.bemerkung ? `<div class="meta">${esc(m.bemerkung)}</div>` : ''}
        </div>
        <button class="del" data-id="${esc(m.id)}" aria-label="Löschen">✕</button>
      </li>`;
    }).join('');
  }

  $('#liste-messungen').addEventListener('click', (e) => {
    const btn = e.target.closest('.del');
    if (!btn) return;
    if (!confirm('Diese Messung löschen?')) return;
    messungen = messungen.filter((m) => m.id !== btn.dataset.id);
    save(KEY.messungen, messungen);
    renderMessungen();
    updateCount();
  });

  $('#btn-alle-loeschen').addEventListener('click', () => {
    if (!confirm(`Alle ${messungen.length} Messungen auf diesem Gerät löschen?\nBitte vorher exportieren!`)) return;
    messungen = [];
    save(KEY.messungen, messungen);
    renderMessungen();
    updateCount();
  });

  const MESS_COLS = [
    { header: 'Probe genommen am', width: 19 },
    { header: 'Fassungsart', width: 19 },
    { header: 'Projekt', width: 20 },
    { header: 'Probe genommen von', width: 20 },
    { header: 'Fassung Kürzel', width: 14 },
    { header: 'Fassung Name', width: 24 },
    { header: 'Zuordnung', width: 16 },
    { header: 'Probengrösse [l]', width: 15 },
    { header: 'Zeitaufwand [s]', width: 15 },
    { header: 'Schüttung [l/s]', width: 15 },
    { header: 'Schüttung [l/min]', width: 16 },
    { header: 'GPS Breite', width: 12 },
    { header: 'GPS Länge', width: 12 },
    { header: 'GPS Genauigkeit [m]', width: 18 },
    { header: 'Distanz zur Fassung [m]', width: 21 },
    { header: 'Bemerkung', width: 30 },
    { header: 'Erfasst am', width: 19 },
    { header: 'ID', width: 14 }
  ];

  function messRows(dateAsText) {
    const sorted = [...messungen].sort((a, b) => a.datum.localeCompare(b.datum));
    return sorted.map((m) => {
      const d = new Date(m.datum), erf = new Date(m.erfasst);
      return [
        dateAsText ? fmtDate(d) : d,
        m.typ, m.projekt, m.mitarbeiter, m.fassungKuerzel, m.fassungName, m.zuordnung,
        m.volumen, m.zeit, m.schuettung,
        m.schuettung != null ? Math.round(m.schuettung * 60 * 100) / 100 : null,
        m.gpsLat, m.gpsLon, m.gpsGenauigkeit, m.distanz, m.bemerkung,
        dateAsText ? fmtDate(erf) : erf,
        m.id
      ];
    });
  }

  const FASS_COLS = [
    { header: 'Kürzel', width: 14 }, { header: 'Name', width: 26 }, { header: 'Art', width: 19 },
    { header: 'Projekt', width: 20 }, { header: 'Breite (WGS84)', width: 15 }, { header: 'Länge (WGS84)', width: 15 }
  ];
  function fassRows() {
    return fassungen.map((f) => [f.kuerzel, f.name, f.typ, f.projekt,
      hasCoords(f) ? Math.round(f.lat * 1e6) / 1e6 : null, hasCoords(f) ? Math.round(f.lon * 1e6) / 1e6 : null]);
  }

  $('#btn-export-xlsx').addEventListener('click', () => {
    if (!messungen.length) return toast('Keine Messungen vorhanden.');
    const blob = XLSX.build([
      { name: 'Messungen', columns: MESS_COLS, rows: messRows(false) },
      { name: 'Fassungen', columns: FASS_COLS, rows: fassRows() }
    ]);
    download(blob, `GeoWater_Messungen_${fileStamp()}.xlsx`);
  });

  $('#btn-export-csv').addEventListener('click', () => {
    if (!messungen.length) return toast('Keine Messungen vorhanden.');
    download(csvBlob(MESS_COLS.map((c) => c.header), messRows(true)), `GeoWater_Messungen_${fileStamp()}.csv`);
  });

  // =====================================================================
  // FASSUNGEN
  // =====================================================================
  const formF = $('#form-fassung');

  function upsertFassung(f) {
    const i = fassungen.findIndex((x) => x.kuerzel.toLowerCase() === f.kuerzel.toLowerCase());
    if (i >= 0) { fassungen[i] = f; return 'update'; }
    fassungen.push(f);
    return 'neu';
  }

  function afterFassungenChanged() {
    fassungen.sort((a, b) => a.kuerzel.localeCompare(b.kuerzel, 'de', { numeric: true }));
    save(KEY.fassungen, fassungen);
    renderFassungen();
    renderDatalists();
    renderSelect();
    if (state.pos) matchSite(false);
  }

  function renderFassungen() {
    $('#set-radius').value = prefs.radius;
    const ul = $('#liste-fassungen');
    if (!fassungen.length) {
      ul.innerHTML = '<li class="empty">Noch keine Fassungen erfasst.</li>';
      return;
    }
    ul.innerHTML = fassungen.map((f) => `<li>
        <div class="main" data-k="${esc(f.kuerzel)}">
          <div class="title">${esc(siteLabel(f))}</div>
          <div class="meta">${esc([f.typ, f.projekt].filter(Boolean).join(' · ') || '–')}</div>
          <div class="meta">${hasCoords(f) ? `${f.lat.toFixed(5)}, ${f.lon.toFixed(5)}` : 'keine Koordinaten'}</div>
        </div>
        <button class="del" data-k="${esc(f.kuerzel)}" aria-label="Löschen">✕</button>
      </li>`).join('');
  }

  $('#liste-fassungen').addEventListener('click', (e) => {
    const del = e.target.closest('.del');
    if (del) {
      if (!confirm(`Fassung «${del.dataset.k}» löschen?`)) return;
      fassungen = fassungen.filter((f) => f.kuerzel !== del.dataset.k);
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
    const fehler = [];
    if (!kuerzel) fehler.push('Kürzel fehlt');
    if (!name) fehler.push('Name fehlt');
    if (c && c.error) fehler.push(c.error);
    if (fehler.length) {
      box.textContent = fehler.join(' · ');
      box.hidden = false;
      return;
    }
    box.hidden = true;
    const f = { kuerzel, name, typ: $('#s-typ').value, projekt: $('#s-projekt').value.trim() };
    if (c) { f.lat = c.lat; f.lon = c.lon; }
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

  $('#set-radius').addEventListener('change', (e) => {
    const v = parseNum(e.target.value);
    prefs.radius = v >= 10 ? Math.round(v) : 100;
    e.target.value = prefs.radius;
    save(KEY.prefs, prefs);
    if (state.pos) matchSite(false);
  });

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

  const HEADER_ALIASES = {
    kuerzel: ['kurzel', 'kuerzel', 'kurz', 'code', 'id', 'nr', 'nummer', 'abk', 'abkurzung', 'kurzname'],
    name: ['name', 'bezeichnung', 'fassung', 'fassungsname', 'quelle', 'quellname', 'standort'],
    typ: ['typ', 'art', 'fassungsart', 'fassungstyp', 'type'],
    projekt: ['projekt', 'projektname', 'project'],
    a: ['lat', 'latitude', 'breite', 'breitengrad', 'n', 'nord', 'north', 'northing', 'x', 'hochwert'],
    b: ['lon', 'lng', 'long', 'longitude', 'lange', 'langengrad', 'e', 'ost', 'east', 'easting', 'y', 'rechtswert']
  };
  const normHeader = (h) => h.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\(.*?\)|\[.*?\]/g, '').replace(/[^a-z0-9]/g, '');

  function normTyp(s) {
    const t = (s || '').toLowerCase();
    if (t.includes('grund') || t === 'gw' || t.includes('brunnen')) return 'Grundwasserfassung';
    if (t.includes('quel') || t === 'q') return 'Quelle';
    return '';
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

    const idx = {};
    rows[0].forEach((h, i) => {
      // «Breite / N» -> passt auf «breite» oder «n»
      const parts = [h, ...h.split(/[\/|]/)].map(normHeader);
      for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
        if (idx[key] == null && parts.some((n) => aliases.includes(n))) { idx[key] = i; break; }
      }
    });
    if (idx.kuerzel == null && idx.name == null) {
      return toast('Spalte «Kürzel» oder «Name» nicht gefunden.');
    }

    let neu = 0, upd = 0;
    const fehlerZeilen = [];
    rows.slice(1).forEach((r, i) => {
      const get = (k) => (idx[k] != null ? (r[idx[k]] || '').trim() : '');
      const kuerzel = get('kuerzel') || get('name');
      if (!kuerzel) { fehlerZeilen.push(i + 2); return; }
      const f = { kuerzel, name: get('name') || kuerzel, typ: normTyp(get('typ')), projekt: get('projekt') };
      const c = parseCoords(get('a'), get('b'));
      if (c && c.error) fehlerZeilen.push(i + 2);
      else if (c) { f.lat = c.lat; f.lon = c.lon; }
      upsertFassung(f) === 'neu' ? neu++ : upd++;
    });
    afterFassungenChanged();
    let msg = `${neu} neu, ${upd} aktualisiert`;
    if (fehlerZeilen.length) msg += ` · Probleme in Zeile ${fehlerZeilen.slice(0, 5).join(', ')}${fehlerZeilen.length > 5 ? ' …' : ''}`;
    toast(msg);
  });

  $('#btn-fassungen-export').addEventListener('click', () => {
    if (!fassungen.length) return toast('Keine Fassungen vorhanden.');
    download(csvBlob(['Kürzel', 'Name', 'Art', 'Projekt', 'Breite', 'Länge'], fassRows()), `GeoWater_Fassungen_${fileStamp()}.csv`);
  });

  // =====================================================================
  // START
  // =====================================================================
  initForm();
  updateCount();
  inpZeit.value = sw.elapsed > 0 && !sw.running ? (sw.elapsed / 1000).toFixed(1) : '';
  swRender();
  if (sw.running) swTick(true);
  updateSchuettung();
  locate(false);

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
