/* ============================================================
   REDOX — frontend application logic
   No framework, no build step on purpose: this ships straight to
   Vercel as static files, and the SAME files run locally off the
   Flask backend (see backend/app.py STATIC_DIR). All requests go
   to relative /api/... paths — vercel.json proxies those to the
   Render backend, so there's no CORS configuration to keep in sync
   between environments.
   ============================================================ */
const API = ''; // relative — see note above

// ──────────────────────────────────────────────────────────────
// Small fetch helpers
// ──────────────────────────────────────────────────────────────
async function getJSON(url) {
  const r = await fetch(API + url);
  if (!r.ok) throw new Error(`GET ${url} → ${r.status}`);
  return r.json();
}

async function postForm(url, formData) {
  const r = await fetch(API + url, { method: 'POST', body: formData });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `POST ${url} → ${r.status}`);
  return body;
}

function el(id) { return document.getElementById(id); }
function qs(sel, root = document) { return root.querySelector(sel); }
function qsa(sel, root = document) { return [...root.querySelectorAll(sel)]; }

// ──────────────────────────────────────────────────────────────
// Tabs
// ──────────────────────────────────────────────────────────────
qsa('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    qsa('.tab').forEach(t => t.classList.remove('is-active'));
    qsa('.panel').forEach(p => p.classList.remove('is-active'));
    tab.classList.add('is-active');
    el(`panel-${tab.dataset.tab}`).classList.add('is-active');
    if (tab.dataset.tab === 'library') loadLibrary();
  });
});

// ──────────────────────────────────────────────────────────────
// Reaction Tray (job queue UI)
// ──────────────────────────────────────────────────────────────
const tray = el('tray');
const trayBody = el('trayBody');
const trayDot = el('trayDot');
const jobsState = new Map(); // job_id -> {kind, status, progress, stage, result, error}

el('trayToggle').addEventListener('click', () => tray.classList.toggle('is-open'));
el('trayClose').addEventListener('click', () => tray.classList.remove('is-open'));

function renderTray() {
  const ids = [...jobsState.keys()].reverse();
  if (ids.length === 0) {
    trayBody.innerHTML = `<p class="tray-empty">No jobs yet. Kick something off from any studio tab — it'll show up here while it renders.</p>`;
    trayDot.classList.remove('is-active');
    return;
  }
  const anyRunning = ids.some(id => ['queued', 'running'].includes(jobsState.get(id).status));
  trayDot.classList.toggle('is-active', anyRunning);

  trayBody.innerHTML = ids.map(id => {
    const j = jobsState.get(id);
    const stateClass = j.status === 'done' ? 'is-done' : j.status === 'error' ? 'is-error' : '';
    let resultHtml = '';
    if (j.status === 'done' && j.result) {
      resultHtml = `<div class="job-result">${resultLinks(j.result)}</div>`;
    } else if (j.status === 'error') {
      resultHtml = `<div class="job-error-text">${escapeHtml(j.error || 'Something went wrong.')}</div>`;
    }
    return `
      <div class="job-card ${stateClass}">
        <div class="job-top">
          <span class="job-kind">${escapeHtml(j.kind.replace('_', ' '))}</span>
          <span class="job-id">${id}</span>
        </div>
        <div class="job-stage">${escapeHtml(j.stage || '')}</div>
        <div class="job-track"><div class="job-fill" style="width:${j.progress || 0}%"></div></div>
        ${resultHtml}
      </div>`;
  }).join('');
}

function resultLinks(result) {
  const links = [];
  if (result.filename) links.push(outputLink(result.filename));
  if (result.filenames) result.filenames.forEach(f => links.push(outputLink(f)));
  if (result.extra_outputs) Object.values(result.extra_outputs).forEach(f => links.push(outputLink(f)));
  if (links.length === 0 && result.count !== undefined) links.push(`<span>${result.count} file(s) ready</span>`);
  return links.join('');
}
function outputLink(filename) {
  return `<a class="btn btn-ghost" href="${API}/api/outputs/${encodeURIComponent(filename)}" target="_blank" rel="noopener">⬇ ${escapeHtml(filename)}</a>`;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function trackJob(jobId, kind) {
  jobsState.set(jobId, { kind, status: 'queued', progress: 0, stage: 'Queued…' });
  tray.classList.add('is-open');
  renderTray();
  pollJob(jobId);
}

async function pollJob(jobId) {
  try {
    const j = await getJSON(`/api/jobs/${jobId}`);
    jobsState.set(jobId, j);
    renderTray();
    if (j.status === 'done' || j.status === 'error') {
      if (j.status === 'done') loadLibrary();
      return;
    }
  } catch (e) {
    jobsState.set(jobId, { kind: jobsState.get(jobId)?.kind || 'job', status: 'error', error: String(e) });
    renderTray();
    return;
  }
  setTimeout(() => pollJob(jobId), 1500);
}

// ──────────────────────────────────────────────────────────────
// Voice catalog (shared across Voice Studio / Merge / Generator)
// ──────────────────────────────────────────────────────────────
let CATALOG = null;

async function loadCatalog() {
  CATALOG = await getJSON('/api/voices');
  populateLangSelect(el('v-lang'));
  populateAgeChips();
  syncVoicesForLang(el('v-lang').value, el('v-voice'));
  syncStylesForVoice(el('v-voice').value, el('v-style'));

  populateVoiceFlat(el('m-voice'));
  populateVoiceFlat(el('g-voice'));
}

function populateLangSelect(select) {
  select.innerHTML = Object.keys(CATALOG.voices).map(l => `<option value="${l}">${l}</option>`).join('');
}

function syncVoicesForLang(lang, select) {
  const voices = CATALOG.voices[lang] || {};
  select.innerHTML = Object.entries(voices).map(([label, id]) => `<option value="${id}">${label}</option>`).join('');
}

function syncStylesForVoice(voiceId, select) {
  const styles = CATALOG.voice_styles[voiceId] || [];
  const opts = ['<option value="">— none —</option>']
    .concat(styles.map(s => `<option value="${s}">${CATALOG.mood_labels[s] || s}</option>`));
  select.innerHTML = opts.join('');
}

function populateVoiceFlat(select) {
  const groups = Object.entries(CATALOG.voices).map(([lang, voices]) => {
    const opts = Object.entries(voices).map(([label, id]) => `<option value="${id}">${label}</option>`).join('');
    return `<optgroup label="${lang}">${opts}</optgroup>`;
  });
  select.innerHTML = groups.join('');
}

function populateAgeChips() {
  const wrap = el('v-age-chips');
  wrap.innerHTML = Object.entries(CATALOG.age_presets).map(([key, p]) =>
    `<label class="chip"><input type="radio" name="age" value="${key}" ${key === 'adult' ? 'checked' : ''}> ${p.label}</label>`
  ).join('');
  wrap.addEventListener('change', (e) => {
    const preset = CATALOG.age_presets[e.target.value];
    if (!preset) return;
    el('v-rate').value = parseInt(preset.rate);
    el('v-pitch').value = parseInt(preset.pitch);
    updateSliderLabels();
  });
}

el('v-lang').addEventListener('change', e => syncVoicesForLang(e.target.value, el('v-voice')));
el('v-voice').addEventListener('change', e => syncStylesForVoice(e.target.value, el('v-style')));

function updateSliderLabels() {
  const rate = parseInt(el('v-rate').value);
  const pitch = parseInt(el('v-pitch').value);
  el('v-rate-val').textContent = `${rate >= 0 ? '+' : ''}${rate}%`;
  el('v-pitch-val').textContent = `${pitch >= 0 ? '+' : ''}${pitch}Hz`;
  el('v-styledegree-val').textContent = parseFloat(el('v-styledegree').value).toFixed(1);
}
['v-rate', 'v-pitch', 'v-styledegree'].forEach(id => el(id).addEventListener('input', updateSliderLabels));

// ──────────────────────────────────────────────────────────────
// Voice Studio — preview
// ──────────────────────────────────────────────────────────────
el('v-preview-btn').addEventListener('click', async () => {
  const btn = el('v-preview-btn');
  btn.disabled = true;
  btn.textContent = '… generating';
  try {
    const fd = new FormData();
    fd.append('voice', el('v-voice').value);
    fd.append('lang', el('v-lang').value);
    fd.append('style', el('v-style').value);
    fd.append('style_degree', el('v-styledegree').value);
    fd.append('rate', el('v-rate-val').textContent);
    fd.append('pitch', el('v-pitch-val').textContent);
    const r = await fetch(`${API}/api/preview-voice`, { method: 'POST', body: fd });
    if (!r.ok) throw new Error('Preview failed');
    const blob = await r.blob();
    const audio = el('v-preview-audio');
    audio.src = URL.createObjectURL(blob);
    audio.classList.remove('hidden');
    audio.play();
  } catch (e) {
    alert('Preview failed: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '▶ Preview voice';
  }
});

// ──────────────────────────────────────────────────────────────
// Batch Voice Generator
// ──────────────────────────────────────────────────────────────
el('b-generate-btn').addEventListener('click', async () => {
  const lines = el('b-lines').value;
  if (!lines.trim()) return alert('Add at least one line.');
  const fd = new FormData();
  fd.append('lines', lines);
  fd.append('voice', el('v-voice').value);
  fd.append('rate', el('v-rate-val').textContent);
  fd.append('pitch', el('v-pitch-val').textContent);
  fd.append('style', el('v-style').value);
  fd.append('style_degree', el('v-styledegree').value);
  try {
    const { job_id } = await postForm('/api/batch-voice', fd);
    trackJob(job_id, 'batch voice');
  } catch (e) {
    alert('Could not start batch job: ' + e.message);
  }
});

// ──────────────────────────────────────────────────────────────
// Merge Studio
// ──────────────────────────────────────────────────────────────
el('m-audiosource').addEventListener('change', e => {
  el('m-script-wrap').classList.toggle('hidden', e.target.value !== 'script');
  el('m-audio-upload-wrap').classList.toggle('hidden', e.target.value !== 'upload');
});

el('mergeForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const videos = el('m-videos').files;
  if (!videos.length) return alert('Add at least one video clip.');

  const fd = new FormData();
  [...videos].forEach(f => fd.append('videos', f));
  fd.append('aspect_ratio', el('m-aspect').value);
  fd.append('transition', el('m-transition').value);
  fd.append('audio_source', el('m-audiosource').value);
  fd.append('trim_audio', el('m-trim').checked ? 'true' : 'false');
  fd.append('script_text', el('m-script').value);
  fd.append('voice', el('m-voice').value);
  fd.append('watermark_text', el('m-watermark').value);
  fd.append('export_aspects', qsa('.m-export:checked').map(c => c.value).join(','));
  if (el('m-audiofile').files[0]) fd.append('audio_file', el('m-audiofile').files[0]);
  if (el('m-bgmusic').files[0]) fd.append('bg_music_file', el('m-bgmusic').files[0]);

  try {
    const { job_id } = await postForm('/api/merge', fd);
    trackJob(job_id, 'merge');
  } catch (err) {
    alert('Could not start merge job: ' + err.message);
  }
});

// ──────────────────────────────────────────────────────────────
// Clip Studio
// ──────────────────────────────────────────────────────────────
el('c-mode').addEventListener('change', e => {
  el('c-interval-wrap').classList.toggle('hidden', e.target.value !== 'auto');
  el('c-timestamps-wrap').classList.toggle('hidden', e.target.value !== 'timestamps');
});
el('c-speed').addEventListener('input', () => { el('c-speed-val').textContent = parseFloat(el('c-speed').value).toFixed(2) + '×'; });
el('c-pitch').addEventListener('input', () => { el('c-pitch-val').textContent = parseFloat(el('c-pitch').value).toFixed(1) + ' semitones'; });

el('clipForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const file = el('c-video').files[0];
  if (!file) return alert('Upload a video to clip.');

  const fd = new FormData();
  fd.append('video', file);
  fd.append('mode', el('c-mode').value);
  fd.append('interval', el('c-interval').value);
  fd.append('timestamps', el('c-timestamps').value);
  fd.append('aspect_ratio', el('c-aspect').value);
  fd.append('mirror', el('c-mirror').checked ? 'true' : 'false');
  fd.append('zoom', el('c-zoom').checked ? 'true' : 'false');
  fd.append('speed', el('c-speed').value);
  fd.append('pitch_shift', el('c-pitch').value);
  fd.append('watermark_text', el('c-watermark').value);

  try {
    const { job_id } = await postForm('/api/autoclip', fd);
    trackJob(job_id, 'clip studio');
  } catch (err) {
    alert('Could not start clip job: ' + err.message);
  }
});

// ──────────────────────────────────────────────────────────────
// AI Video Generator
// ──────────────────────────────────────────────────────────────
el('genForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const script = el('g-script').value.trim();
  if (!script) return alert('Write a script first.');

  const fd = new FormData();
  fd.append('script_text', script);
  fd.append('theme', el('g-theme').value);
  fd.append('aspect_ratio', el('g-aspect').value);
  fd.append('voice', el('g-voice').value);
  fd.append('caption_mode', el('g-captions').value);
  fd.append('watermark_text', el('g-watermark').value);
  fd.append('export_aspects', qsa('.g-export:checked').map(c => c.value).join(','));
  if (el('g-bgmusic').files[0]) fd.append('bg_music_file', el('g-bgmusic').files[0]);

  try {
    const { job_id } = await postForm('/api/generate-video', fd);
    trackJob(job_id, 'ai generator');
  } catch (err) {
    alert('Could not start generation job: ' + err.message);
  }
});

// ──────────────────────────────────────────────────────────────
// Library
// ──────────────────────────────────────────────────────────────
async function loadLibrary() {
  const grid = el('lib-grid');
  grid.innerHTML = '<p class="lib-empty">Loading…</p>';
  try {
    const files = await getJSON('/api/outputs');
    if (!files.length) {
      grid.innerHTML = '<p class="lib-empty">Nothing rendered yet — outputs from any studio will show up here.</p>';
      return;
    }
    grid.innerHTML = files.map(f => `
      <div class="output-card">
        <div class="name">${escapeHtml(f.filename)}</div>
        <div class="meta">${f.size}${f.duration ? ' · ' + f.duration : ''}</div>
        <div class="actions">
          <a class="btn btn-ghost" href="${API}/api/outputs/${encodeURIComponent(f.filename)}" target="_blank" rel="noopener">⬇ Download</a>
          <button class="btn btn-danger-ghost" data-del="${escapeHtml(f.filename)}">Delete</button>
        </div>
      </div>`).join('');
    qsa('[data-del]', grid).forEach(btn => btn.addEventListener('click', async () => {
      await fetch(`${API}/api/outputs/${encodeURIComponent(btn.dataset.del)}`, { method: 'DELETE' });
      loadLibrary();
    }));
  } catch (e) {
    grid.innerHTML = `<p class="lib-empty">Couldn't load the library: ${escapeHtml(e.message)}</p>`;
  }
}
el('lib-refresh').addEventListener('click', loadLibrary);
el('lib-clear').addEventListener('click', async () => {
  if (!confirm('Delete every rendered file? This cannot be undone.')) return;
  await fetch(`${API}/api/clear-library`, { method: 'POST' });
  loadLibrary();
});

// ──────────────────────────────────────────────────────────────
// Boot
// ──────────────────────────────────────────────────────────────
updateSliderLabels();
loadCatalog().catch(e => console.error('Failed to load voice catalog:', e));
