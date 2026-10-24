/*
 * Sprachsteuerung «START» / «STOP» – läuft komplett offline auf dem Gerät
 * (Vosk / Kaldi als WebAssembly, deutsches Sprachmodell, nur die Befehlswörter als Wortliste).
 *
 *   Sprache.start({ onCommand, onHint, onIgnored, onStatus, onLevel })
 *   Sprache.stop()
 *
 * onCommand(art, zeit)   art = 'start' | 'stop', zeit = Zeitpunkt (Date.now()-Skala), an dem das
 *                        Wort zu klingen begann. Gemeldet wird erst nach dem Wort (ca. 1 s später),
 *                        damit geprüft werden kann, dass es einzeln gesprochen wurde.
 * onHint(art)            Befehlswort gehört, Prüfung läuft noch
 * onIgnored(art, grund)  Befehlswort gehört, aber verworfen (z. B. Teil eines Satzes)
 */
(function (global) {
  'use strict';

  const LIB_URL = 'vosk/vosk.js';
  const MODEL_URL = 'vosk/model-de.tar.gz';
  const CACHE = 'geo-water-sprache';
  // Wörter, die das Modell nicht kennt, werden von Vosk ignoriert; [unk] fängt alles andere ab
  const GRAMMAR = ['start', 'stopp', 'stop', '[unk]'];
  const KIND = { start: 'start', stopp: 'stop', stop: 'stop' };
  // Schutz vor Fehlauslösung: Befehl muss einzeln (mit kurzer Pause zu anderen Wörtern) und
  // ausreichend sicher erkannt sein. «Star», «stoppen», «gestartet» … hängen an anderen Lauten.
  const MIN_PAUSE = 0.25;   // Sekunden
  const MIN_CONF = 0.5;

  let model = null, loading = null;
  let ctx = null, stream = null, source = null, node = null, recognizer = null;
  let active = false, handlers = {};
  let samples = 0, t0 = Infinity, lastChunk = 0, watchdog = null, restarting = false;
  let hinted = 0;   // in der laufenden Äusserung bereits angekündigte Befehlswörter

  const status = (state, text) => handlers.onStatus && handlers.onStatus(state, text);

  // ---------- Dateien einmalig laden und dauerhaft speichern ----------
  async function cachedBlob(url, onProgress) {
    let cache = null;
    try { cache = await caches.open(CACHE); } catch (e) { /* Cache nicht verfügbar */ }
    const hit = cache && await cache.match(url);
    if (hit) return hit.blob();

    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Download fehlgeschlagen (HTTP ${res.status})`);
    const total = Number(res.headers.get('content-length')) || 0;
    const reader = res.body.getReader();
    const parts = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      got += value.length;
      if (onProgress) onProgress(got, total);
    }
    const blob = new Blob(parts);
    if (cache) await cache.put(url, new Response(blob));
    return blob;
  }

  async function isDownloaded() {
    try {
      const cache = await caches.open(CACHE);
      return !!(await cache.match(LIB_URL)) && !!(await cache.match(MODEL_URL));
    } catch (e) {
      return false;
    }
  }

  function mb(n) { return (n / 1048576).toFixed(0); }

  function loadModel() {
    if (model) return Promise.resolve(model);
    if (loading) return loading;
    loading = (async () => {
      if (!global.Vosk) {
        const lib = await cachedBlob(LIB_URL, (g, t) =>
          status('laden', `Spracherkennung wird geladen … ${t ? Math.round(g / t * 100) + ' %' : mb(g) + ' MB'}`));
        await new Promise((ok, fail) => {
          const s = document.createElement('script');
          s.src = URL.createObjectURL(new Blob([lib], { type: 'text/javascript' }));
          s.onload = ok;
          s.onerror = () => fail(new Error('Spracherkennung konnte nicht gestartet werden'));
          document.head.appendChild(s);
        });
      }
      const archive = await cachedBlob(MODEL_URL, (g, t) =>
        status('laden', `Sprachmodell wird geladen … ${t ? Math.round(g / t * 100) + ' %' : mb(g) + ' MB'}`));
      status('laden', 'Sprachmodell wird vorbereitet …');
      const url = URL.createObjectURL(archive);
      const m = new global.Vosk.Model(url, -1);
      await new Promise((ok, fail) => {
        const timer = setTimeout(() => fail(new Error('Sprachmodell lädt nicht (Zeitüberschreitung)')), 90000);
        m.on('load', (msg) => { clearTimeout(timer); msg.result ? ok() : fail(new Error('Sprachmodell defekt')); });
        m.on('error', (msg) => { clearTimeout(timer); fail(new Error(msg.error || 'Sprachmodell-Fehler')); });
      });
      URL.revokeObjectURL(url);
      model = m;
      return m;
    })();
    loading.catch(() => { loading = null; });
    return loading;
  }

  // ---------- Erkennung ----------
  const words = (text) => String(text || '').trim().split(/\s+/).filter((w) => KIND[w]);

  function onPartial(msg) {
    const ws = words(msg.result && msg.result.partial);
    if (ws.length > hinted) {
      hinted = ws.length;
      if (handlers.onHint) handlers.onHint(KIND[ws[ws.length - 1]]);
    }
  }

  function onResult(msg) {
    hinted = 0;
    if (handlers.onDebug) handlers.onDebug(msg.result);
    const list = (msg.result && msg.result.result) || [];
    list.forEach((w, i) => {
      const art = KIND[w.word];
      if (!art) return;
      const prev = list[i - 1], next = list[i + 1];
      const einzeln = (!prev || w.start - prev.end >= MIN_PAUSE) && (!next || next.start - w.end >= MIN_PAUSE);
      if (!einzeln) { if (handlers.onIgnored) handlers.onIgnored(art, 'nicht einzeln gesprochen'); return; }
      if (w.conf < MIN_CONF) { if (handlers.onIgnored) handlers.onIgnored(art, 'undeutlich'); return; }
      // Wortbeginn auf die Gerätezeit umrechnen -> Verzögerung der Erkennung spielt keine Rolle
      if (handlers.onCommand) handlers.onCommand(art, t0 + w.start * 1000);
    });
  }

  async function startAudio() {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      video: false
    });
    stream.getAudioTracks().forEach((t) => { t.onended = () => restart('Mikrofon getrennt'); });

    ctx = new (global.AudioContext || global.webkitAudioContext)();
    if (ctx.state === 'suspended') {
      try { await ctx.resume(); } catch (e) { /* braucht Antippen */ }
    }

    recognizer = new model.KaldiRecognizer(ctx.sampleRate, JSON.stringify(GRAMMAR));
    recognizer.setWords(true);
    recognizer.on('partialresult', onPartial);
    recognizer.on('result', onResult);
    recognizer.on('error', (msg) => status('fehler', 'Spracherkennung: ' + (msg.error || 'Fehler')));

    samples = 0;
    t0 = Infinity;
    hinted = 0;
    lastChunk = Date.now();
    source = ctx.createMediaStreamSource(stream);
    node = ctx.createScriptProcessor(4096, 1, 1);
    node.onaudioprocess = (e) => {
      const buf = e.inputBuffer;
      samples += buf.length;
      const now = Date.now();
      lastChunk = now;
      // Zeitpunkt des ersten Samples schätzen (kleinster Wert = geringste Verarbeitungsverzögerung)
      t0 = Math.min(t0, now - (samples / buf.sampleRate) * 1000);
      if (handlers.onLevel) {
        const d = buf.getChannelData(0);
        let sum = 0;
        for (let i = 0; i < d.length; i += 4) sum += d[i] * d[i];
        handlers.onLevel(Math.min(1, Math.sqrt(sum / (d.length / 4)) * 6));
      }
      try { recognizer.acceptWaveform(buf); } catch (err) { /* einzelner Block verloren */ }
    };
    source.connect(node);
    node.connect(ctx.destination);   // nötig, damit der Prozessor läuft (gibt Stille aus)
  }

  function stopAudio() {
    try { if (node) { node.onaudioprocess = null; node.disconnect(); } } catch (e) { /* egal */ }
    try { if (source) source.disconnect(); } catch (e) { /* egal */ }
    try { if (recognizer) recognizer.remove(); } catch (e) { /* egal */ }
    try { if (stream) stream.getTracks().forEach((t) => { t.onended = null; t.stop(); }); } catch (e) { /* egal */ }
    try { if (ctx) ctx.close(); } catch (e) { /* egal */ }
    node = source = recognizer = stream = ctx = null;
  }

  async function restart(grund) {
    if (!active || restarting) return;
    restarting = true;
    status('laden', `Mikrofon wird neu verbunden (${grund}) …`);
    stopAudio();
    try {
      await startAudio();
      listening();
    } catch (e) {
      status('fehler', 'Mikrofon nicht verfügbar: ' + e.message);
    } finally {
      restarting = false;
    }
  }

  function listening() {
    if (ctx && ctx.state !== 'running') status('tippen', 'Zum Aktivieren der Sprachsteuerung einmal tippen');
    else status('aktiv', 'Hört zu – sage «START» oder «STOP»');
  }

  // Ein Antippen irgendwo reicht, falls der Browser den Audio-Start blockiert hat
  document.addEventListener('pointerdown', () => {
    if (active && ctx && ctx.state !== 'running') ctx.resume().then(listening).catch(() => {});
  }, true);

  async function start(h) {
    handlers = h || handlers;
    if (active) return;
    active = true;
    try {
      if (!global.isSecureContext || !navigator.mediaDevices) throw new Error('Mikrofon nur über https:// verfügbar');
      await loadModel();
      if (!active) return;
      await startAudio();
      if (!active) { stopAudio(); return; }
      listening();
      clearInterval(watchdog);
      // Überwachung: kommen keine Audiodaten mehr an, Mikrofon neu verbinden
      watchdog = setInterval(() => {
        if (!active || restarting || !ctx) return;
        if (ctx.state === 'suspended' && document.visibilityState === 'visible') ctx.resume().then(listening).catch(() => {});
        else if (ctx.state === 'running' && Date.now() - lastChunk > 3000) restart('keine Audiodaten');
      }, 1000);
    } catch (e) {
      active = false;
      stopAudio();
      const msg = e && e.name === 'NotAllowedError' ? 'Mikrofon-Zugriff verweigert' : (e && e.message) || 'unbekannter Fehler';
      status('fehler', 'Sprachsteuerung nicht verfügbar: ' + msg);
      throw e;
    }
  }

  function stop() {
    active = false;
    clearInterval(watchdog);
    stopAudio();
    status('aus', '');
  }

  document.addEventListener('visibilitychange', () => {
    if (active && document.visibilityState === 'visible' && ctx && ctx.state !== 'running') {
      ctx.resume().then(listening).catch(() => listening());
    }
  });

  global.Sprache = {
    start,
    stop,
    isActive: () => active,
    isDownloaded,
    // Modell vorab laden (z. B. im WLAN), Fortschritt über onStatus
    download: (onStatus) => {
      if (!active && onStatus) handlers = Object.assign({}, handlers, { onStatus });
      return loadModel().then(() => true);
    }
  };
})(window);
