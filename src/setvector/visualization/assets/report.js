/* SetVector track report: renders the embedded model and optional audio without network access. */
(() => {
  "use strict";

  const root = document.documentElement;
  const $ = (id) => document.getElementById(id);
  const model = JSON.parse($("sv-model").textContent);
  const clamp = (value, low, high) => Math.min(Math.max(value, low), high);
  const mmss = (seconds) => {
    const whole = Math.max(0, Math.floor(seconds));
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
  };
  // One decimal place avoids duplicate labels when close-up ticks land under a second apart.
  const mmssPrecise = (seconds) => {
    const rounded = Math.round(Math.max(0, seconds) * 10) / 10;
    const minutes = Math.floor(rounded / 60);
    const secs = rounded - minutes * 60;
    return `${minutes}:${secs.toFixed(1).padStart(4, "0")}`;
  };

  function decodeBase64(text) {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  // Arrays are little-endian, which matches the platforms browsers run on.
  const times = Array.from(new Float64Array(decodeBase64(model.timestamps).buffer));
  const values = {};
  for (const item of model.series) {
    const raw = new Float32Array(decodeBase64(item.values).buffer);
    values[item.name] = Array.from(raw, (v) => (Number.isNaN(v) ? null : v));
  }
  const lastTime = times.length ? times[times.length - 1] : 0;
  const duration = Math.max(model.duration_seconds, lastTime, 0.001);
  const hasTempo = model.tempo_bpm != null;
  const barLines = model.downbeats.length ? new Set(model.downbeats) : null;

  const LANES = [
    { key: "rms", label: "Level", hint: "How loud", color: "--level", unit: "RMS",
      tip: "Signal strength from moment to moment (RMS amplitude). Not a LUFS loudness measurement.",
      format: (v) => v.toFixed(2) },
    { key: "bass_power_ratio", label: "Bass", hint: "Low-end weight", color: "--bass", unit: "of power",
      tip: "Share of the sound's power at or below 250 Hz: kick and bassline weight.",
      format: (v) => `${Math.round(v * 100)}%` },
    { key: "spectral_centroid", label: "Brightness", hint: "Dark to bright", color: "--bright", unit: "kHz",
      tip: "Where the center of the frequency content sits (spectral centroid). Higher means brighter, such as hats and vocals.",
      format: (v) => (v / 1000).toFixed(1) },
    { key: "onset_strength", label: "Hits", hint: "Drums and attacks", color: "--hits", unit: "of peak",
      tip: "How sharply the sound changes: drums, plucks, and stabs. 100% is this track's strongest hit.",
      format: (v) => `${Math.round(v * 100)}%` },
  ];
  const ZOOMS = hasTempo
    ? [8, 16, 32, 64].map((bars) => ({ label: `${bars} bars`, seconds: (bars * 240) / model.tempo_bpm }))
    : [10, 20, 40, 80].map((seconds) => ({ label: `${seconds} s`, seconds }));

  const state = { position: 0, playing: false, hoverIndex: null, windowStart: 0, zoom: 1, follow: true };
  const windowLength = () => Math.min(ZOOMS[state.zoom].seconds, duration);

  function indexAt(time) {
    if (!times.length) return -1;
    let low = 0;
    let high = times.length - 1;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (times[middle] < time) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  let palette = {};
  function readPalette() {
    const style = getComputedStyle(root);
    const read = (name) => style.getPropertyValue(name).trim();
    palette = {
      text: read("--text"), muted: read("--muted"), faint: read("--faint"), line: read("--line"),
      panel2: read("--panel-2"), font: read("--font"), lanes: LANES.map((lane) => read(lane.color)),
    };
  }

  function withAlpha(hex, alpha) {
    const match = /^#([0-9a-f]{6})$/i.exec(hex);
    if (!match) return hex;
    const n = parseInt(match[1], 16);
    return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }

  // ---- static content ----
  function infoIcon(tip) {
    const icon = element("span", "info", "i");
    icon.dataset.tip = tip;
    icon.title = tip;
    icon.tabIndex = 0;
    return icon;
  }

  function statCard(label, value, unit, hint, tip, meter, color) {
    const card = element("div", "stat");
    const key = element("div", "k", label);
    if (tip) key.append(infoIcon(tip));
    const main = element("div", "v", value);
    if (unit) main.append(element("small", null, unit));
    card.append(key, main, element("div", "hint", hint));
    if (meter != null) {
      const bar = element("div", "meter");
      const fill = element("div");
      fill.style.width = `${clamp(meter, 0, 1) * 100}%`;
      fill.style.background = `var(${color})`;
      bar.append(fill);
      card.append(bar);
    }
    return card;
  }

  function renderStatic() {
    $("title").textContent = model.title;
    $("artist").textContent = model.artist || "";
    $("artist").hidden = !model.artist;
    const beatText = model.beats.length ? `${model.beats.length.toLocaleString()} beats detected` : "No beats detected";
    $("meta").textContent = `${model.format_line} · ${mmss(duration)} · ${beatText}`;
    $("duration").textContent = mmss(duration);

    const s = model.summary;
    $("stats").replaceChildren(
      statCard("Tempo", hasTempo ? String(Math.round(model.tempo_bpm)) : "—", hasTempo ? "BPM" : null,
        hasTempo ? "Estimated" : "Not detected", "Estimated from the beat pattern. Check it against your DJ software."),
      statCard("Length", mmss(duration), null,
        s.bar_estimate != null ? `≈ ${s.bar_estimate} bars at this tempo` : "Bars need a tempo estimate"),
      statCard("Bass", s.bass_band || "—", null,
        s.bass_median != null ? `${Math.round(s.bass_median * 100)}% of power below 250 Hz (median)` : "No signal",
        s.bass_tip, s.bass_median, "--bass"),
      statCard("Brightness", s.brightness_band || "—", null,
        s.centroid_median != null ? `Centered around ${(s.centroid_median / 1000).toFixed(1)} kHz (median)` : "No signal",
        s.brightness_tip, s.centroid_median != null ? s.centroid_median / 8000 : null, "--bright"),
    );

    if (model.warnings.length) {
      $("warnings").hidden = false;
      $("warning-list").replaceChildren(...model.warnings.map((text) => element("li", null, text)));
    }
    $("facts").replaceChildren(...model.facts.map(([label, value]) => {
      const item = element("div");
      item.append(element("span", null, label), element("div", null, value));
      return item;
    }));

    $("lanes").replaceChildren(...LANES.map((lane, index) => {
      const row = element("div", "lane");
      const label = element("div", "label");
      const name = element("div", "name");
      const swatch = element("i", "swatch");
      swatch.style.background = `var(${lane.color})`;
      name.append(swatch, document.createTextNode(lane.label), infoIcon(lane.tip));
      label.append(name, element("div", "desc", lane.hint));
      const plot = element("div", "plot");
      plot.id = `lane-plot-${index}`;
      const value = element("div", "val");
      value.id = `lane-value-${index}`;
      row.append(label, plot, value);
      return row;
    }));
  }

  function renderZoom() {
    $("zoom").replaceChildren(...ZOOMS.map((zoom, index) => {
      const button = element("button", index === state.zoom ? "on" : "", zoom.label);
      button.type = "button";
      button.addEventListener("click", () => {
        state.zoom = index;
        placeWindow(state.position);
        renderZoom();
        render();
      });
      return button;
    }));
  }

  // ---- audio ----
  // Decoding is deferred past first paint so a large embedded MP3 never delays it; the
  // base64 text is dropped from the DOM once decoded to release the string.
  const audioNode = $("sv-audio");
  const hasAudioSource = audioNode.textContent.length > 0;
  let audio = null;
  let rafId = null;

  function noAudio() {
    audio = null;
    $("play").hidden = true;
    $("play").disabled = false;
    $("seek-hint").textContent = "No audio embedded. Click the track to move the close-up.";
  }

  if (hasAudioSource) {
    $("play").disabled = true;
  } else {
    noAudio();
  }

  function placeWindow(anchor) {
    const length = windowLength();
    state.windowStart = clamp(anchor - length * 0.35, 0, Math.max(duration - length, 0));
  }

  function seek(time, moveWindow = true) {
    state.position = clamp(time, 0, duration);
    if (audio) audio.currentTime = state.position;
    if (moveWindow) placeWindow(state.position);
    render();
  }

  function togglePlay() {
    if (!audio) return;
    if (audio.paused) {
      if (audio.ended || state.position >= duration - 0.05) {
        state.position = 0;
        audio.currentTime = 0;
      }
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  }

  function startTick() {
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(tick);
  }

  function tick() {
    if (!state.playing) { rafId = null; return; }
    state.position = clamp(audio.currentTime, 0, duration);
    if (state.follow) placeWindow(state.position);
    render();
    rafId = requestAnimationFrame(tick);
  }

  function syncPositionFromAudio() {
    state.position = clamp(audio.currentTime, 0, duration);
  }

  function decodeAudio() {
    const audioText = audioNode.textContent.trim();
    audioNode.textContent = "";
    let bytes;
    try {
      bytes = decodeBase64(audioText);
    } catch {
      noAudio();
      render();
      return;
    }
    const blob = new Blob([bytes], { type: audioNode.dataset.mime || "audio/mpeg" });
    audio = new Audio(URL.createObjectURL(blob));
    audio.preload = "auto";
    audio.addEventListener("play", () => { state.playing = true; startTick(); render(); });
    audio.addEventListener("pause", () => { state.playing = false; syncPositionFromAudio(); render(); });
    audio.addEventListener("ended", () => { state.playing = false; syncPositionFromAudio(); render(); });
    $("play").disabled = false;
    render();
  }

  function afterFirstPaint(fn) {
    requestAnimationFrame(() => setTimeout(fn, 0));
  }

  if (hasAudioSource) afterFirstPaint(decodeAudio);

  // ---- overview ----
  const overview = $("overview");
  const BASS_STOPS = [[111, 140, 255], [183, 124, 255], [255, 122, 168], [255, 180, 84]];
  let overviewBins = null;

  function computeBins(count) {
    const peaks = new Float32Array(count);
    const bassSum = new Float64Array(count);
    const bassCount = new Uint32Array(count);
    const level = values.rms || [];
    const bass = values.bass_power_ratio || [];
    for (let i = 0; i < times.length; i += 1) {
      const bin = Math.min(count - 1, Math.floor((times[i] / duration) * count));
      if (level[i] != null && level[i] > peaks[bin]) peaks[bin] = level[i];
      if (bass[i] != null) { bassSum[bin] += bass[i]; bassCount[bin] += 1; }
    }
    let top = 0;
    for (const peak of peaks) top = Math.max(top, peak);
    return { count, peaks, top, bass: Array.from(bassSum, (sum, i) => (bassCount[i] ? sum / bassCount[i] : null)) };
  }

  function bassColor(ratio) {
    if (ratio == null) return palette.faint;
    const x = clamp(ratio, 0, 1) * (BASS_STOPS.length - 1);
    const i = Math.min(Math.floor(x), BASS_STOPS.length - 2);
    const f = x - i;
    const rgb = BASS_STOPS[i].map((c, j) => Math.round(c + (BASS_STOPS[i + 1][j] - c) * f));
    return `rgb(${rgb.join(",")})`;
  }

  function drawOverview() {
    const ratio = window.devicePixelRatio || 1;
    const width = overview.clientWidth;
    const height = overview.clientHeight;
    if (!width || !height) return;
    if (overview.width !== Math.round(width * ratio) || overview.height !== Math.round(height * ratio)) {
      overview.width = Math.round(width * ratio);
      overview.height = Math.round(height * ratio);
    }
    const barWidth = 3;
    const gap = 1;
    const count = Math.max(1, Math.floor(width / (barWidth + gap)));
    if (!overviewBins || overviewBins.count !== count) overviewBins = computeBins(count);
    const ctx = overview.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = palette.panel2;
    ctx.fillRect(0, 0, width, height);
    const middle = height / 2;
    const played = audio ? (state.position / duration) * width : width;
    const { peaks, bass, top } = overviewBins;
    for (let i = 0; i < count; i += 1) {
      const x = i * (barWidth + gap);
      const half = top > 0 ? Math.max(1, (peaks[i] / top) * (middle - 4)) : 1;
      ctx.globalAlpha = x + barWidth <= played ? 1 : 0.42;
      ctx.fillStyle = bassColor(bass[i]);
      ctx.fillRect(x, middle - half, barWidth, half * 2);
    }
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = palette.text;
    ctx.lineWidth = 1.5;
    const start = (state.windowStart / duration) * width;
    const end = ((state.windowStart + windowLength()) / duration) * width;
    ctx.strokeRect(start + 0.75, 1.5, Math.max(end - start - 1.5, 2), height - 3);
    ctx.globalAlpha = 1;
    ctx.fillStyle = palette.text;
    ctx.fillRect((state.position / duration) * width - 1, 0, 2, height);
  }

  function scrubTo(event) {
    const box = overview.getBoundingClientRect();
    seek(((event.clientX - box.left) / box.width) * duration);
  }
  overview.addEventListener("pointerdown", (event) => { overview.setPointerCapture(event.pointerId); scrubTo(event); });
  overview.addEventListener("pointermove", (event) => { if (overview.hasPointerCapture(event.pointerId)) scrubTo(event); });

  // ---- close-up lanes ----
  const plots = [];

  function laneRange(key) {
    if (key === "bass_power_ratio" || key === "onset_strength") return [0, 1];
    let top = 0;
    for (const v of values[key]) if (v != null && v > top) top = v;
    return [0, top > 0 ? top * 1.08 : 1];
  }

  function drawBeats(u) {
    if (!model.beats.length) return;
    const { ctx } = u;
    const { left, top, width, height } = u.bbox;
    const min = u.scales.x.min;
    const max = u.scales.x.max;
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.clip();
    ctx.strokeStyle = palette.muted;
    model.beats.forEach((beat, index) => {
      if (beat < min || beat > max) return;
      const bar = barLines ? barLines.has(beat) : index % 4 === 0;
      ctx.globalAlpha = bar ? 0.5 : 0.2;
      ctx.lineWidth = (bar ? 1.4 : 1) * uPlot.pxRatio;
      const x = Math.round(u.valToPos(beat, "x", true)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, top + height);
      ctx.stroke();
    });
    ctx.restore();
  }

  function drawPlayhead(u) {
    if (state.position < u.scales.x.min || state.position > u.scales.x.max) return;
    const { ctx } = u;
    const x = u.valToPos(state.position, "x", true);
    ctx.save();
    ctx.fillStyle = palette.text;
    ctx.fillRect(x - uPlot.pxRatio, u.bbox.top, 2 * uPlot.pxRatio, u.bbox.height);
    ctx.restore();
  }

  function onCursor(u) {
    const hovering = u.cursor.left != null && u.cursor.left >= 0 && u.cursor.idx != null;
    state.hoverIndex = hovering ? u.cursor.idx : null;
    renderReadouts();
    renderWindowLabel();
  }

  function buildPlots() {
    readPalette();
    for (const plot of plots) plot.destroy();
    plots.length = 0;
    const range = [state.windowStart, state.windowStart + windowLength()];
    LANES.forEach((lane, index) => {
      const host = $(`lane-plot-${index}`);
      const color = palette.lanes[index];
      const withAxis = index === LANES.length - 1;
      const plot = new uPlot({
        width: Math.max(host.clientWidth, 50),
        height: withAxis ? 94 : 66,
        padding: [8, 16, 8, 16],
        legend: { show: false },
        select: { show: false },
        cursor: {
          sync: { key: "setvector-report" },
          drag: { x: false, y: false, setScale: false },
          points: { show: false },
          y: false,
        },
        scales: {
          x: { time: false, auto: false, range },
          y: { auto: false, range: laneRange(lane.key) },
        },
        axes: [
          {
            show: withAxis, stroke: palette.faint, font: `11px ${palette.font}`, size: 28, gap: 4,
            grid: { show: false }, ticks: { show: false },
            values: (u, splits) => {
              const format = u.scales.x.max - u.scales.x.min < 20 ? mmssPrecise : mmss;
              return splits.map(format);
            },
          },
          { show: false },
        ],
        series: [
          {},
          {
            stroke: color,
            width: 1.6,
            points: { show: false },
            fill: (u) => {
              const gradient = u.ctx.createLinearGradient(0, u.bbox.top, 0, u.bbox.top + u.bbox.height);
              gradient.addColorStop(0, withAlpha(color, 0.34));
              gradient.addColorStop(1, withAlpha(color, 0.02));
              return gradient;
            },
          },
        ],
        hooks: { draw: [drawBeats, drawPlayhead], setCursor: [onCursor] },
      }, [times, values[lane.key]], host);
      plot.over.addEventListener("click", (event) => seek(plot.posToVal(event.offsetX, "x"), false));
      plots.push(plot);
    });
  }

  function renderReadouts() {
    const index = state.hoverIndex != null ? state.hoverIndex : indexAt(state.position);
    LANES.forEach((lane, i) => {
      const value = index >= 0 ? values[lane.key][index] : null;
      $(`lane-value-${i}`).replaceChildren(
        document.createTextNode(value == null ? "—" : lane.format(value)),
        element("small", null, value == null ? "no signal" : lane.unit),
      );
    });
  }

  function renderWindowLabel() {
    const start = state.windowStart;
    const end = start + windowLength();
    const zoom = ZOOMS[state.zoom].label;
    const scale = hasTempo ? `${zoom} at ${Math.round(model.tempo_bpm)} BPM` : zoom;
    const at = state.hoverIndex != null ? `values at ${mmss(times[state.hoverIndex])}` : "values at the playhead";
    $("window-label").textContent = `${mmss(start)} – ${mmss(end)} · ${scale} · ${at}`;
  }

  function render() {
    $("position").textContent = mmss(state.position);
    $("icon-play").hidden = state.playing;
    $("icon-pause").hidden = !state.playing;
    $("play").setAttribute("aria-label", state.playing ? "Pause" : "Play");
    drawOverview();
    const min = state.windowStart;
    const max = min + windowLength();
    for (const plot of plots) {
      if (plot.scales.x.min !== min || plot.scales.x.max !== max) plot.setScale("x", { min, max });
      else plot.redraw(false, false);
    }
    renderWindowLabel();
    renderReadouts();
  }

  // ---- theme ----
  const THEME_KEY = "setvector-report-theme";
  function storedTheme() {
    try { return localStorage.getItem(THEME_KEY) || "auto"; } catch { return "auto"; }
  }
  function applyTheme(choice, save) {
    if (choice === "auto") delete root.dataset.theme;
    else root.dataset.theme = choice;
    if (save) {
      try { localStorage.setItem(THEME_KEY, choice); } catch { /* storage unavailable */ }
    }
    $("theme").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.theme === choice));
    buildPlots();
    render();
  }

  // ---- wiring ----
  renderStatic();
  renderZoom();
  placeWindow(0);
  $("play").addEventListener("click", togglePlay);
  $("follow").addEventListener("change", (event) => {
    state.follow = event.target.checked;
    if (state.follow) placeWindow(state.position);
    render();
  });
  $("theme").querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => applyTheme(button.dataset.theme, true));
  });
  document.addEventListener("keydown", (event) => {
    if (event.code !== "Space" || !audio || event.repeat) return;
    if (event.target.closest && event.target.closest("button, input, select, textarea, summary")) return;
    event.preventDefault();
    togglePlay();
  });
  window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
    if (!root.dataset.theme) { buildPlots(); render(); }
  });
  let resizeTimer = null;
  new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      plots.forEach((plot, i) => plot.setSize({ width: Math.max($(`lane-plot-${i}`).clientWidth, 50), height: plot.height }));
      overviewBins = null;
      render();
    }, 60);
  }).observe($("report"));
  applyTheme(storedTheme(), false);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { buildPlots(); render(); });
})();
