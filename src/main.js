import { FFT, applyHanningWindow } from './fft.js';
// SonicFlow – Frontend Logic (Tauri v2)
const { invoke, convertFileSrc } = window.__TAURI__.core;
const { open } = window.__TAURI__.dialog;
const { open: openPath } = window.__TAURI__.shell;

// ─── State ────────────────────────────────────────────────────────────────────
let libraries   = [];
let allSounds   = [];
let activeLibId = null;
let activeFolderPath = null;  // relative_folder filter
let sortKey     = 'filename';
let sortAsc     = true;
let searchTimer = null;
let currentFile = null;
let audioCtx    = null;
let waveformData = null;
let currentSampleRate = 48000;
let wfMode = 0; // 0=Classic, 1=Histogram, 2=Symmetric X-Ray
let wfZoom = 1;
let wfPan = 0;
let isDraggingWf = false;
let startDragX = 0;
let startDragPan = 0;

// Tabs State
let tabs = [];
let activeTabId = null;

function createTab() {
  const tab = {
    id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
    query: '',
    results: [],
    activeLibId: null,
    activeFolderPath: null,
    filterExt: '',
    filterChannels: '',
    filterSamplerate: '',
    sortKey: 'filename',
    sortAsc: true,
    scrollTop: 0
  };
  tabs.push(tab);
  return tab;
}

function getActiveTab() {
  return tabs.find(t => t.id === activeTabId);
}

// ─── DOM ─────────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const tabList = $('tab-list');
const btnNewTab = $('btn-new-tab');
const libraryList      = $('library-list');
const btnAddLibrary    = $('btn-add-library');
const btnAddLibrary2   = $('btn-add-library-2');
const searchInput      = $('search-input');
const filterLibrary    = $('filter-library');
const filterExt        = $('filter-ext');
const filterChannels   = $('filter-channels');
const filterSamplerate = $('filter-samplerate');
const btnClearFilters  = $('btn-clear-filters');
const resultCount      = $('result-count');
const resultsBody      = $('results-body');
const stateEmpty       = $('state-empty');
const stateNoLibrary   = $('state-no-library');
const statTotalFiles   = $('stat-total-files');
const importOverlay    = $('import-overlay');
const importSubtitle   = $('import-subtitle');
const toast            = $('toast');
const folderTreeSection = $('folder-tree-section');
const folderTreeEl      = $('folder-tree');
const sortBtns         = document.querySelectorAll('.sort-btn');
const tableHeaders     = document.querySelectorAll('th.sortable');

// Player
const playerBar       = $('player-bar');
const audioEl         = $('audio-element');
const playerFilename  = $('player-filename');
const playerMeta      = $('player-meta');
const playerTime      = $('player-time');
const progressFill    = $('player-progress-fill');
const progressThumb   = $('player-progress-thumb');
const progressWrapper = $('player-progress-wrapper');
const btnPlayPause    = $('btn-play-pause');
const iconPlay        = $('icon-play');
const iconPause       = $('icon-pause');
const btnStop         = $('btn-stop');
const volumeSlider    = $('volume-slider');
const audioOutputSelect = $('audio-output-select');
const btnOpenFile     = $('btn-open-file');
const btnXRay         = $('btn-xray');
const waveformCanvas  = $('waveform-canvas');
const waveformPlayhead = $('waveform-playhead');
const waveformContainer = $('waveform-container');
const playerResizer   = $('player-resizer');

// ─── Column Definitions ──────────────────────────────────────────────────────
const COLS = [
  { key: 'play',     width: 44,  resizable: false },
  { key: 'name',     width: 260, resizable: true  },
  { key: 'waveform', width: 160, resizable: true  },
  { key: 'dur',      width: 68,  resizable: true  },
  { key: 'fmt',      width: 60,  resizable: true  },
  { key: 'sr',       width: 62,  resizable: true  },
  { key: 'bd',       width: 48,  resizable: true  },
  { key: 'ch',       width: 52,  resizable: true  },
  { key: 'tags',     width: 200, resizable: true  },
  { key: 'size',     width: 70,  resizable: true  },
  { key: 'drag',     width: 36,  resizable: false },
];

// ─── Init ─────────────────────────────────────────────────────────────────────
async function initAudioDevices() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
  try { await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e) {}
  
  const devices = await navigator.mediaDevices.enumerateDevices();
  const audioOutputs = devices.filter(d => d.kind === 'audiooutput');
  
  if (audioOutputs.length > 0 && audioOutputSelect) {
    audioOutputSelect.innerHTML = '<option value="">System Default</option>';
    audioOutputs.forEach(device => {
      const opt = document.createElement('option');
      opt.value = device.deviceId;
      opt.textContent = device.label || `Device ${device.deviceId.substring(0,5)}...`;
      audioOutputSelect.appendChild(opt);
    });
    
    audioOutputSelect.addEventListener('change', async () => {
      try {
        if (typeof audioEl.setSinkId !== 'undefined') {
          await audioEl.setSinkId(audioOutputSelect.value);
        } else {
          showToast('Audio Routing wird hier nicht unterstützt', 'warning');
        }
      } catch (err) {
        showToast('Fehler beim Ändern des Audioausgangs', 'error');
      }
    });
  }
}

async function init() {
  const initialTab = createTab();
  activeTabId = initialTab.id;
  renderTabs();

  initColumns();
  initAudioDevices();
  await loadLibraries();
  if (libraries.length > 0) await runSearch();
}

function updateTableWidth() {
  const totalW = COLS.reduce((sum, c) => sum + c.width, 0);
  $('results-table').style.width = totalW + 'px';
}

// ─── Column Resize System ─────────────────────────────────────────────────────
function initColumns() {
  const colgroup = $('results-colgroup');
  colgroup.innerHTML = '';
  COLS.forEach(c => {
    const col = document.createElement('col');
    col.style.width = c.width + 'px';
    col.dataset.key = c.key;
    colgroup.appendChild(col);
  });
  updateTableWidth();

  // Wire resize handles
  const ths = document.querySelectorAll('#results-header-row th');
  ths.forEach((th, i) => {
    const resizer = th.querySelector('.col-resizer');
    if (!resizer) return;

    let startX, startW, col;

    resizer.addEventListener('mousedown', e => {
      e.preventDefault();
      e.stopPropagation();
      col = colgroup.children[i];
      startX = e.clientX;
      startW = parseInt(col.style.width);
      resizer.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      function onMove(e) {
        const newW = Math.max(40, startW + (e.clientX - startX));
        col.style.width = newW + 'px';
        COLS[i].width = newW;
        updateTableWidth();
      }
      function onUp() {
        resizer.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    resizer.addEventListener('click', e => { e.stopPropagation(); });

    // Double-click: auto-fit to widest content
    resizer.addEventListener('dblclick', e => {
      e.preventDefault();
      e.stopPropagation();
      const col = colgroup.children[i];
      // Measure all td cells in this column
      const tds = document.querySelectorAll(`#results-body tr td:nth-child(${i + 1})`);
      let maxW = 60;
      // Also measure the header
      const thInner = th.querySelector('.th-inner');
      if (thInner) maxW = Math.max(maxW, thInner.scrollWidth + 28);
      tds.forEach(td => {
        // For waveform cells skip (keep current width)
        if (td.classList.contains('cell-waveform')) return;
        const content = td.firstElementChild || td;
        maxW = Math.max(maxW, content.scrollWidth + 28);
      });
      col.style.width = maxW + 'px';
      COLS[i].width = maxW;
      updateTableWidth();
    });
  });

  // ── Column Drag-to-Reorder ──────────────────────────────────────────────────
  let dragSrcIdx = null;

  ths.forEach((th, i) => {
    // Skip fixed columns (play button col and drag col – no resizer)
    if (!th.querySelector('.col-resizer')) return;

    th.setAttribute('draggable', 'true');

    th.addEventListener('dragstart', e => {
      // Don't start column drag when resizer is being used
      if (e.target.classList.contains('col-resizer')) { e.preventDefault(); return; }
      dragSrcIdx = i;
      th.classList.add('col-dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(i));
    });

    th.addEventListener('dragend', () => {
      th.classList.remove('col-dragging');
      document.querySelectorAll('#results-header-row th').forEach(t => {
        t.classList.remove('col-drag-over-left', 'col-drag-over-right');
      });
      dragSrcIdx = null;
    });

    th.addEventListener('dragover', e => {
      if (dragSrcIdx === null || dragSrcIdx === i) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const rect = th.getBoundingClientRect();
      const midX = rect.left + rect.width / 2;
      th.classList.remove('col-drag-over-left', 'col-drag-over-right');
      if (e.clientX < midX) th.classList.add('col-drag-over-left');
      else th.classList.add('col-drag-over-right');
    });

    th.addEventListener('dragleave', () => {
      th.classList.remove('col-drag-over-left', 'col-drag-over-right');
    });

    th.addEventListener('drop', e => {
      e.preventDefault();
      if (dragSrcIdx === null || dragSrcIdx === i) return;

      const rect = th.getBoundingClientRect();
      const midX = rect.left + rect.width / 2;
      let targetIdx = (e.clientX < midX) ? i : i + 1;
      if (targetIdx > dragSrcIdx) targetIdx--;

      // Reorder COLS array
      const [moved] = COLS.splice(dragSrcIdx, 1);
      COLS.splice(targetIdx, 0, moved);

      // Re-initialize columns with new order
      initColumns();
      renderResults();
    });
  });
}

// ─── Row Waveform System ──────────────────────────────────────────────────────
const rowWaveCache = new Map();   // filepath → Float32Array peaks (min/max pairs)
const rowDecodeQueue = [];
let rowDecodeActive = 0;
const ROW_MAX_CONCURRENT = 3;
let rowObserver = null;

function initRowObserver() {
  if (rowObserver) rowObserver.disconnect();
  rowObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const canvas = entry.target.querySelector('.row-waveform');
      const fp = entry.target.dataset.filepath;
      if (canvas && fp && canvas.dataset.state !== 'done' && canvas.dataset.state !== 'pending') {
        canvas.dataset.state = 'pending';
        enqueueRowWaveform(canvas, fp);
      }
    }
  }, { rootMargin: '200px' });
}

function enqueueRowWaveform(canvas, filepath) {
  if (rowWaveCache.has(filepath)) {
    paintRowWaveform(canvas, rowWaveCache.get(filepath));
    canvas.dataset.state = 'done';
    return;
  }
  rowDecodeQueue.push({ canvas, filepath });
  drainRowQueue();
}

async function drainRowQueue() {
  while (rowDecodeActive < ROW_MAX_CONCURRENT && rowDecodeQueue.length > 0) {
    const item = rowDecodeQueue.shift();
    if (!document.contains(item.canvas)) continue; // row gone
    rowDecodeActive++;
    try {
      const peaks = await decodeRowPeaks(convertFileSrc(item.filepath));
      rowWaveCache.set(item.filepath, peaks);
      if (document.contains(item.canvas)) {
        paintRowWaveform(item.canvas, peaks);
        item.canvas.dataset.state = 'done';
      }
    } catch { item.canvas.dataset.state = 'error'; }
    rowDecodeActive--;
    drainRowQueue();
  }
}

async function decodeRowPeaks(assetUrl) {
  if (!audioCtx) audioCtx = new AudioContext();
  const resp = await fetch(assetUrl);
  const buf  = await resp.arrayBuffer();
  const audio = await audioCtx.decodeAudioData(buf);
  const data  = audio.getChannelData(0);
  const W = 160;  // resolution: 160 samples (matches default col width)
  const step = Math.ceil(data.length / W);
  const peaks = new Float32Array(W * 2);
  for (let x = 0; x < W; x++) {
    let min = 1, max = -1;
    for (let i = 0; i < step; i++) {
      const v = data[x * step + i] || 0;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    peaks[x * 2]     = min;
    peaks[x * 2 + 1] = max;
  }
  return peaks;
}

function paintRowWaveform(canvas, peaks) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.offsetWidth  || 160;
  const H = canvas.offsetHeight || 28;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  const numSamples = peaks.length / 2;
  const grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, '#7c6fff');
  grad.addColorStop(1, '#00d4ff');
  ctx.fillStyle = grad;

  for (let x = 0; x < W; x++) {
    const idx = Math.floor(x / W * numSamples);
    const min = peaks[idx * 2];
    const max = peaks[idx * 2 + 1];
    const y1 = ((1 - max) / 2) * H;
    const y2 = ((1 - min) / 2) * H;
    ctx.fillRect(x, y1, 1, Math.max(1, y2 - y1));
  }
}


// ─── Tabs ────────────────────────────────────────────────────────────────────
function renderTabs() {
  if (!tabList) return;
  tabList.innerHTML = '';
  tabs.forEach(tab => {
    const el = document.createElement('div');
    el.className = 'app-tab' + (tab.id === activeTabId ? ' active' : '');
    el.setAttribute('role', 'tab');
    el.setAttribute('aria-selected', tab.id === activeTabId);
    
    // Title is either the query or "Neue Suche"
    let title = tab.query.trim() || 'Neue Suche';
    
    el.innerHTML = `
      <span class="tab-title" title="${escHtml(title)}">${escHtml(title)}</span>
      <button class="btn-close-tab" aria-label="Tab schließen">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1 1l8 8M9 1L1 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      </button>
    `;
    
    el.addEventListener('click', e => {
      if (e.target.closest('.btn-close-tab')) {
        closeTab(tab.id);
      } else if (tab.id !== activeTabId) {
        switchTab(tab.id);
      }
    });
    
    tabList.appendChild(el);
  });
}

function switchTab(id) {
  if (id === activeTabId) return;
  const oldTab = getActiveTab();
  if (oldTab) {
    oldTab.results = allSounds;
    oldTab.activeLibId = activeLibId;
    oldTab.activeFolderPath = activeFolderPath;
    oldTab.sortKey = sortKey;
    oldTab.sortAsc = sortAsc;
    oldTab.query = searchInput.value;
    oldTab.filterExt = filterExt.value;
    oldTab.filterChannels = filterChannels.value;
    oldTab.filterSamplerate = filterSamplerate.value;
    oldTab.scrollTop = $('table-wrapper').scrollTop;
  }
  
  activeTabId = id;
  const newTab = getActiveTab();
  
  allSounds = newTab.results || [];
  activeLibId = newTab.activeLibId;
  activeFolderPath = newTab.activeFolderPath;
  sortKey = newTab.sortKey;
  sortAsc = newTab.sortAsc;
  
  searchInput.value = newTab.query;
  filterLibrary.value = activeLibId || '';
  filterExt.value = newTab.filterExt;
  filterChannels.value = newTab.filterChannels;
  filterSamplerate.value = newTab.filterSamplerate;
  
  sortBtns.forEach(b => { 
    b.classList.toggle('active', b.dataset.sort === sortKey); 
    b.setAttribute('aria-pressed', b.dataset.sort === sortKey); 
  });
  tableHeaders.forEach(th => th.classList.toggle('sort-active', th.dataset.sort === sortKey));

  renderLibraryList();
  if (activeLibId) loadFolderTree(activeLibId);
  else folderTreeSection.setAttribute('hidden','');
  
  renderResults();
  renderTabs();
  
  setTimeout(() => { $('table-wrapper').scrollTop = newTab.scrollTop; }, 0);
}

function addNewTab() {
  const tab = createTab();
  switchTab(tab.id);
  searchInput.focus();
}

function closeTab(id) {
  if (tabs.length <= 1) {
    // If last tab, just clear it
    const tab = tabs[0];
    tab.query = '';
    tab.results = [];
    switchTab(tab.id); // to flush UI
    return;
  }
  const idx = tabs.findIndex(t => t.id === id);
  tabs = tabs.filter(t => t.id !== id);
  if (id === activeTabId) {
    // switch to the left one, or right if it was the first
    const nextIdx = Math.max(0, idx - 1);
    switchTab(tabs[nextIdx].id);
  } else {
    renderTabs();
  }
}

// ─── Libraries ───────────────────────────────────────────────────────────────
async function loadLibraries() {
  try { libraries = await invoke('get_libraries'); }
  catch (e) { showToast('Fehler: ' + e.message, 'error'); libraries = []; }
  renderLibraryList();
  updateFilterLibrarySelect();
  const total = libraries.reduce((s, l) => s + l.file_count, 0);
  statTotalFiles.textContent = total.toLocaleString('de-DE');
  if (libraries.length === 0) {
    stateNoLibrary.removeAttribute('hidden');
    stateEmpty.setAttribute('hidden', '');
    resultsBody.innerHTML = '';
    resultCount.textContent = '–';
    folderTreeSection.setAttribute('hidden','');
  } else {
    stateNoLibrary.setAttribute('hidden', '');
    // Load folder tree for active library
    if (activeLibId) loadFolderTree(activeLibId);
    else folderTreeSection.setAttribute('hidden','');
  }
}

function renderLibraryList() {
  libraryList.innerHTML = '';
  libraries.forEach(lib => {
    const li = document.createElement('li');
    li.className = 'library-item' + (activeLibId === lib.id ? ' active' : '');
    li.setAttribute('role', 'button');
    li.setAttribute('tabindex', '0');
    li.dataset.id = lib.id;
    li.innerHTML = `
      <span class="lib-icon">📁</span>
      <div class="lib-info">
        <div class="lib-name" title="${escHtml(lib.path)}">${escHtml(lib.name)}</div>
        <div class="lib-count">${lib.file_count.toLocaleString('de-DE')} Dateien</div>
      </div>
      <div class="lib-actions">
        <button class="lib-action-btn" data-action="refresh" title="Neu scannen">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M11 6.5A4.5 4.5 0 112 6.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M11 3.5V6.5H8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <button class="lib-action-btn danger" data-action="delete" title="Entfernen">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M2 3h9M5 3V2h3v1M4 3l.5 7h4L9 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>`;
    li.addEventListener('click', e => {
      if (e.target.closest('.lib-action-btn')) return;
      const newId = activeLibId === lib.id ? null : lib.id;
      activeLibId = newId;
      activeFolderPath = null; // reset folder filter on library switch
      filterLibrary.value = activeLibId ?? '';
      renderLibraryList();
      if (activeLibId) loadFolderTree(activeLibId);
      else folderTreeSection.setAttribute('hidden','');
      runSearch();
    });
    li.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); li.click(); } });
    li.querySelector('[data-action="refresh"]').addEventListener('click', e => { e.stopPropagation(); refreshLibrary(lib.id); });
    li.querySelector('[data-action="delete"]').addEventListener('click', e => { e.stopPropagation(); removeLibrary(lib.id, lib.name); });
    libraryList.appendChild(li);
  });
}

function updateFilterLibrarySelect() {
  filterLibrary.innerHTML = '<option value="">Alle Bibliotheken</option>';
  libraries.forEach(lib => {
    const opt = document.createElement('option');
    opt.value = lib.id; opt.textContent = lib.name;
    filterLibrary.appendChild(opt);
  });
}

// ─── Import ──────────────────────────────────────────────────────────────────
async function importLibrary() {
  let selectedPath;
  try { selectedPath = await open({ directory: true, multiple: false, title: 'Ordner auswählen' }); }
  catch (e) { showToast('Dialog-Fehler', 'error'); return; }
  if (!selectedPath) return;
  importOverlay.removeAttribute('hidden');
  importSubtitle.textContent = `Scanne: ${selectedPath}`;
  try {
    const result = await invoke('import_library', { path: selectedPath });
    showToast(`✓ ${result.imported.toLocaleString('de-DE')} Dateien importiert`, 'success');
    initAudioDevices();
  await loadLibraries();
    activeLibId = result.library.id;
    filterLibrary.value = activeLibId;
    renderLibraryList();
    await runSearch();
  } catch (e) {
    showToast('Import fehlgeschlagen: ' + (e.message || e), 'error');
  } finally {
    importOverlay.setAttribute('hidden', '');
  }
}

async function refreshLibrary(id) {
  importOverlay.removeAttribute('hidden');
  importSubtitle.textContent = 'Bibliothek wird neu gescannt …';
  try {
    const r = await invoke('refresh_library', { libraryId: id });
    showToast(`✓ ${r.imported.toLocaleString('de-DE')} Dateien aktualisiert`, 'success');
    initAudioDevices();
  await loadLibraries(); await runSearch();
  } catch (e) { showToast('Fehler: ' + (e.message || e), 'error'); }
  finally { importOverlay.setAttribute('hidden', ''); }
}

async function removeLibrary(id, name) {
  if (!confirm(`Bibliothek „${name}" entfernen?\n\nDateien werden nicht gelöscht.`)) return;
  try {
    await invoke('remove_library', { libraryId: id });
    if (activeLibId === id) activeLibId = null;
    initAudioDevices();
  await loadLibraries(); await runSearch();
    showToast(`Bibliothek „${name}" entfernt`, 'info');
  } catch (e) { showToast('Fehler: ' + e.message, 'error'); }
}

// ─── Search ──────────────────────────────────────────────────────────────────
function scheduleSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 200);
}

async function runSearch() {
  if (libraries.length === 0) return;
  const query = searchInput.value.trim();
  const filters = {
    library_id: filterLibrary.value ? parseInt(filterLibrary.value) : null,
    folder: activeFolderPath !== null ? activeFolderPath : undefined,
    extension:  filterExt.value || null,
    min_duration: null, max_duration: null,
    samplerate: filterSamplerate.value ? parseInt(filterSamplerate.value) : null,
    channels:   filterChannels.value  ? parseInt(filterChannels.value)   : null,
  };
  try { allSounds = await invoke('search_sounds', { query, filters }); }
  catch (e) { showToast('Suchfehler: ' + e, 'error'); allSounds = []; }
  
  const tab = getActiveTab();
  if (tab) tab.query = query;
  renderTabs();
  
  renderResults();
}

// ─── Results ─────────────────────────────────────────────────────────────────
function renderResults() {
  const sorted = [...allSounds].sort((a, b) => {
    let va = a[sortKey] ?? '', vb = b[sortKey] ?? '';
    if (typeof va === 'string') { va = va.toLowerCase(); vb = vb.toLowerCase(); }
    return va < vb ? (sortAsc ? -1 : 1) : va > vb ? (sortAsc ? 1 : -1) : 0;
  });
  resultsBody.innerHTML = '';
  stateEmpty.setAttribute('hidden', '');
  stateNoLibrary.setAttribute('hidden', '');
  if (sorted.length === 0) { stateEmpty.removeAttribute('hidden'); resultCount.textContent = 'Keine Ergebnisse'; return; }
  resultCount.textContent = sorted.length.toLocaleString('de-DE') + ' Ergebnis' + (sorted.length === 1 ? '' : 'se');
  const frag = document.createDocumentFragment();
  sorted.forEach(s => frag.appendChild(buildRow(s)));
  resultsBody.appendChild(frag);
  // Set up intersection observer for waveform lazy loading
  initRowObserver();
  resultsBody.querySelectorAll('tr').forEach(tr => rowObserver.observe(tr));
}

function buildRow(sound) {
  const tr = document.createElement('tr');
  tr.dataset.filepath = sound.filepath;
  tr.setAttribute('draggable', 'true');
  if (currentFile === sound.filepath) tr.classList.add('playing');

  const pills = [];
  if (sound.tag_title)   pills.push(`<span class="tag-pill title" title="${escHtml(sound.tag_title)}">${escHtml(truncate(sound.tag_title,20))}</span>`);
  if (sound.tag_genre)   pills.push(`<span class="tag-pill genre" title="${escHtml(sound.tag_genre)}">${escHtml(truncate(sound.tag_genre,16))}</span>`);
  if (sound.tag_artist)  pills.push(`<span class="tag-pill artist" title="${escHtml(sound.tag_artist)}">${escHtml(truncate(sound.tag_artist,16))}</span>`);
  if (sound.tag_comment) pills.push(`<span class="tag-pill comment" title="${escHtml(sound.tag_comment)}">${escHtml(truncate(sound.tag_comment,24))}</span>`);

  const isPlaying = currentFile === sound.filepath;
  tr.innerHTML = `
    <td class="col-play">
      <button class="btn-row-play${isPlaying?' playing':''}" title="Vorschau" aria-label="Vorschau: ${escHtml(sound.filename)}">
        ${isPlaying
          ? `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="1" y="1" width="3.5" height="10" rx="1" fill="currentColor"/><rect x="7.5" y="1" width="3.5" height="10" rx="1" fill="currentColor"/></svg>`
          : `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 1.5l9 4.5-9 4.5V1.5z" fill="currentColor"/></svg>`}
      </button>
    </td>
    <td class="col-name cell-name" title="${escHtml(sound.filepath)}">${escHtml(sound.filename)}</td>
    <td class="col-waveform cell-waveform"><canvas class="row-waveform" height="28" aria-hidden="true"></canvas></td>
    <td class="col-dur cell-mono">${formatDuration(sound.duration)}</td>
    <td class="col-fmt"><span class="cell-ext">${escHtml(sound.extension)}</span></td>
    <td class="col-sr cell-mono">${formatSamplerate(sound.samplerate)}</td>
    <td class="col-bd cell-mono">${sound.bitdepth ?? '–'}</td>
    <td class="col-ch cell-mono">${formatChannels(sound.channels)}</td>
    <td class="col-tags"><div class="cell-tags">${pills.slice(0,3).join('')}</div></td>
    <td class="col-size cell-mono">${formatSize(sound.filesize)}</td>
    <td class="col-drag">
      <div class="btn-drag-handle" title="In NLE ziehen" aria-label="Datei in NLE ziehen">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <circle cx="4" cy="3" r="1.2" fill="currentColor"/><circle cx="10" cy="3" r="1.2" fill="currentColor"/>
          <circle cx="4" cy="7" r="1.2" fill="currentColor"/><circle cx="10" cy="7" r="1.2" fill="currentColor"/>
          <circle cx="4" cy="11" r="1.2" fill="currentColor"/><circle cx="10" cy="11" r="1.2" fill="currentColor"/>
        </svg>
      </div>
    </td>`;

  tr.querySelector('.btn-row-play').addEventListener('click', e => { e.stopPropagation(); togglePlay(sound); });
  tr.addEventListener('click', e => { if (!e.target.closest('.btn-drag-handle') && !e.target.closest('.row-waveform')) togglePlay(sound); });
  tr.querySelector('.row-waveform').addEventListener('click', e => e.stopPropagation());

  // ── Native Drag & Drop to NLEs ──
  tr.addEventListener('dragstart', e => {
    e.preventDefault(); // Let Tauri handle the native OS drag operation
    
    // We must mimic the exact payload of the official JS plugin wrapper
    const { Channel } = window.__TAURI__.core;
    const onEventChannel = new Channel();
    
    invoke('plugin:drag|start_drag', {
      item: [sound.filepath],
      image: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
      options: { mode: 'copy' },
      onEvent: onEventChannel
    }).catch(err => {
      console.error(err);
      showToast('Drag Fehler: ' + String(err), 'error');
    });
  });

  return tr;
}

// ─── Folder Tree ──────────────────────────────────────────────────────────────
async function loadFolderTree(libraryId) {
  folderTreeEl.innerHTML = '';
  if (!libraryId) { folderTreeSection.setAttribute('hidden',''); return; }
  try {
    const nodes = await invoke('get_folders', { libraryId });
    if (!nodes || nodes.length === 0) { folderTreeSection.setAttribute('hidden',''); return; }
    folderTreeSection.removeAttribute('hidden');
    nodes.forEach(node => folderTreeEl.appendChild(buildFolderNode(node, libraryId)));
  } catch { folderTreeSection.setAttribute('hidden',''); }
}

function buildFolderNode(node, libraryId) {
  const li = document.createElement('li');
  li.className = 'folder-item';
  const hasChildren = node.children && node.children.length > 0;
  const isActive = activeFolderPath === node.full_path;

  const row = document.createElement('div');
  row.className = 'folder-row' + (isActive ? ' active' : '');
  row.setAttribute('role', 'treeitem');
  row.innerHTML = `
    <span class="folder-toggle${hasChildren ? '' : ' empty'}">
      ${hasChildren ? `<svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M2 1l4 3-4 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>` : ''}
    </span>
    <span class="folder-icon">${hasChildren ? '📂' : '📄'}</span>
    <span class="folder-name" title="${escHtml(node.full_path)}">${escHtml(node.name)}</span>
    <span class="folder-count">${node.file_count > 0 ? node.file_count.toLocaleString('de-DE') : ''}</span>
  `;

  let childrenEl = null;
  if (hasChildren) {
    childrenEl = document.createElement('ul');
    childrenEl.className = 'folder-children';
    childrenEl.setAttribute('hidden','');
    childrenEl.setAttribute('role','group');
    node.children.forEach(child => childrenEl.appendChild(buildFolderNode(child, libraryId)));

    const toggle = row.querySelector('.folder-toggle');
    toggle.addEventListener('click', e => {
      e.stopPropagation();
      const open = !childrenEl.hasAttribute('hidden');
      if (open) { childrenEl.setAttribute('hidden',''); toggle.classList.remove('open'); }
      else      { childrenEl.removeAttribute('hidden');  toggle.classList.add('open'); }
    });
    li.appendChild(row);
    li.appendChild(childrenEl);
  } else {
    li.appendChild(row);
  }

  row.addEventListener('click', e => {
    if (e.target.closest('.folder-toggle') && hasChildren) return;
    activeFolderPath = activeFolderPath === node.full_path ? null : node.full_path;
    if (hasChildren && childrenEl && activeFolderPath === node.full_path) {
      childrenEl.removeAttribute('hidden');
      row.querySelector('.folder-toggle')?.classList.add('open');
    }
    loadFolderTree(libraryId); // re-render to update active state
    runSearch();
  });

  return li;
}

// ─── Sorting ─────────────────────────────────────────────────────────────────
function setSort(key) {
  sortAsc = sortKey === key ? !sortAsc : true;
  sortKey = key;
  sortBtns.forEach(b => { b.classList.toggle('active', b.dataset.sort === key); b.setAttribute('aria-pressed', b.dataset.sort === key); });
  tableHeaders.forEach(th => th.classList.toggle('sort-active', th.dataset.sort === key));
  renderResults();
}

// ─── Audio Player ────────────────────────────────────────────────────────────
function togglePlay(sound) {
  if (currentFile === sound.filepath && !audioEl.paused) { audioEl.pause(); return; }
  playSound(sound);
}

function playSound(sound) {
  currentFile = sound.filepath;
  // Use Tauri's asset:// protocol – file:// is blocked by the WebView CSP
  const assetUrl = convertFileSrc(sound.filepath);
  audioEl.src = assetUrl;
  audioEl.load();
  audioEl.play().catch(err => showToast('Wiedergabe nicht möglich: ' + err.message, 'error'));

  playerFilename.textContent = sound.filename;
  playerMeta.textContent = [
    sound.extension?.toUpperCase(),
    sound.samplerate ? (sound.samplerate/1000).toFixed(1)+' kHz' : null,
    sound.bitdepth   ? sound.bitdepth+'-bit' : null,
    formatChannels(sound.channels),
    formatSize(sound.filesize),
  ].filter(Boolean).join(' · ');
  playerBar.removeAttribute('hidden');
  btnOpenFile.dataset.filepath = sound.filepath;

  drawWaveform(assetUrl);
  renderResults();
}

// ─── Waveform ────────────────────────────────────────────────────────────────
async function drawWaveform(uri) {
  const ctx = waveformCanvas.getContext('2d');
  const W = waveformCanvas.offsetWidth || 400;
  const H = waveformCanvas.offsetHeight || 48;
  const dpr = window.devicePixelRatio || 1;
  waveformCanvas.width  = W * dpr;
  waveformCanvas.height = H * dpr;
  ctx.scale(dpr, dpr);

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(124,111,255,0.2)';
  ctx.fillRect(0, H/2 - 1, W, 2);

  try {
    if (!audioCtx) audioCtx = new AudioContext();
    const resp = await fetch(uri);
    const arrayBuf = await resp.arrayBuffer();
    const audioBuf = await audioCtx.decodeAudioData(arrayBuf);
    waveformData = audioBuf.getChannelData(0);
    currentSampleRate = audioBuf.sampleRate;
    wfZoom = 1;
    wfPan = 0;
    renderWaveform();
  } catch {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(0, H/2-1, W, 2);
  }
}

function renderWaveform() {
  if (!waveformData) return;
  const ctx = waveformCanvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const W = waveformCanvas.offsetWidth || 400;
  const H = waveformCanvas.offsetHeight || 48;
  waveformCanvas.width  = W * dpr;
  waveformCanvas.height = H * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  const data = waveformData;
  const totalSamples = data.length;
  const visibleSamples = Math.floor(totalSamples / wfZoom);
  const startSample = Math.floor(wfPan * (totalSamples - visibleSamples));
  const step = Math.max(1, Math.floor(visibleSamples / W));

  const grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, '#7c6fff');
  grad.addColorStop(1, '#00d4ff');

  let fftSize = 1024;
  let fft = (wfMode > 0) ? new FFT(fftSize) : null;
  let fftInput = (wfMode > 0) ? new Float32Array(fftSize) : null;
  
  let bassBin = 0, midBin = 0;
  if (wfMode > 0) {
    const binSize = currentSampleRate / fftSize;
    bassBin = Math.floor(250 / binSize);
    midBin = Math.floor(4000 / binSize);
  }

  for (let x = 0; x < W; x++) {
    let min = 1, max = -1;
    const sampleIdx = startSample + (x * step);
    for (let i = 0; i < step && (sampleIdx + i) < totalSamples; i++) {
      const v = data[sampleIdx + i] || 0;
      if (v < min) min = v;
      if (v > max) max = v;
    }

    let r=0, g=0, b=0;
    if (wfMode > 0) {
      const centerIdx = sampleIdx + Math.floor(step / 2);
      const windowStart = centerIdx - (fftSize / 2);
      for (let i = 0; i < fftSize; i++) {
        let idx = windowStart + i;
        if (idx < 0) idx = 0;
        if (idx >= totalSamples) idx = totalSamples - 1;
        fftInput[i] = data[idx];
      }
      
      applyHanningWindow(fftInput);
      const mags = fft.forward(fftInput);
      
      let energyBass = 0, energyMids = 0, energyHighs = 0;
      for (let i = 0; i < mags.length; i++) {
        if (i <= bassBin) energyBass += mags[i];
        else if (i <= midBin) energyMids += mags[i];
        else energyHighs += mags[i];
      }
      
      energyBass *= 2.0; 
      energyMids *= 1.5;
      energyHighs *= 6.0; 

      const sum = energyBass + energyMids + energyHighs + 0.0001;
      r = Math.min(255, Math.floor((energyBass / sum) * 255 * 1.5));
      g = Math.min(255, Math.floor((energyMids / sum) * 255 * 1.5));
      b = Math.min(255, Math.floor((energyHighs / sum) * 255 * 1.5));
    }
    
    if (wfMode === 0) {
      // A: Classic Symmetric
      ctx.fillStyle = grad;
      const y1 = ((1 - max) / 2) * H;
      const y2 = ((1 - min) / 2) * H;
      ctx.fillRect(x, y1, 1, Math.max(1, y2 - y1));
    } else if (wfMode === 1) {
      // B: Spectral Histogram (Bottom to Top)
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      const amplitude = Math.max(Math.abs(min), Math.abs(max));
      const hBar = amplitude * H;
      ctx.fillRect(x, H - hBar, 1, Math.max(1, hBar));
    } else if (wfMode === 2) {
      // A+B: Spectral Symmetric
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      const y1 = ((1 - max) / 2) * H;
      const y2 = ((1 - min) / 2) * H;
      ctx.fillRect(x, y1, 1, Math.max(1, y2 - y1));
    }
  }

  // Removed buggy reflection rendering completely!

  updatePlayhead();
}

function updatePlayhead() {
  if (!audioEl.duration) return;
  const globalPct = audioEl.currentTime / audioEl.duration;
  progressFill.style.width = (globalPct * 100) + '%';
  progressThumb.style.left = (globalPct * 100) + '%';
  progressWrapper.setAttribute('aria-valuenow', Math.round(globalPct * 100));
  playerTime.textContent = `${fmtSec(audioEl.currentTime)} / ${fmtSec(audioEl.duration)}`;

  const visibleStartPct = wfPan * (1 - (1/wfZoom));
  const visibleEndPct = visibleStartPct + (1/wfZoom);

  if (globalPct >= visibleStartPct && globalPct <= visibleEndPct) {
    const localPct = (globalPct - visibleStartPct) * wfZoom;
    waveformPlayhead.style.left = (localPct * 100) + '%';
    waveformPlayhead.style.display = 'block';
  } else {
    waveformPlayhead.style.display = 'none';
  }
}

// ─── Player Events ───────────────────────────────────────────────────────────
audioEl.addEventListener('timeupdate', updatePlayhead);
audioEl.addEventListener('play',  () => { iconPlay.setAttribute('hidden',''); iconPause.removeAttribute('hidden'); renderResults(); });
audioEl.addEventListener('pause', () => { iconPlay.removeAttribute('hidden'); iconPause.setAttribute('hidden',''); renderResults(); });
audioEl.addEventListener('ended', () => {
  iconPlay.removeAttribute('hidden'); iconPause.setAttribute('hidden','');
  progressFill.style.width = '0%'; progressThumb.style.left = '0%'; waveformPlayhead.style.left = '0%';
  playerTime.textContent = `0:00 / ${fmtSec(audioEl.duration)}`; renderResults();
});

btnPlayPause.addEventListener('click', () => { if (audioEl.paused) audioEl.play(); else audioEl.pause(); });
btnStop.addEventListener('click', () => {
  audioEl.pause(); audioEl.currentTime = 0; currentFile = null;
  playerBar.setAttribute('hidden',''); renderResults();
});
volumeSlider.addEventListener('input', e => { audioEl.volume = e.target.value; });
btnOpenFile.addEventListener('click', async () => {
  const fp = btnOpenFile.dataset.filepath;
  if (!fp) return;
  try { await invoke('open_in_finder', { path: fp }); } catch (e) { console.error(e); showToast('Finder konnte nicht geöffnet werden', 'error'); }
});


btnXRay.addEventListener('click', () => {
  wfMode = (wfMode + 1) % 3;
  btnXRay.classList.toggle('active', wfMode > 0);
  
  if (wfMode === 0) showToast('A: Classic Waveform', 'info');
  else if (wfMode === 1) showToast('B: Spectral Histogram', 'info');
  else if (wfMode === 2) showToast('A+B: Spectral Symmetric', 'info');
  
  renderWaveform();
});



progressWrapper.addEventListener('click', e => {
  if (!audioEl.duration) return;
  const rect = $('player-progress-track').getBoundingClientRect();
  audioEl.currentTime = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * audioEl.duration;
});

waveformContainer.addEventListener('mousedown', e => {
  if (!audioEl.duration) return;
  const rect = waveformContainer.getBoundingClientRect();
  const clickLocalPct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  const visibleStartPct = wfPan * (1 - (1/wfZoom));
  const globalPct = visibleStartPct + (clickLocalPct / wfZoom);
  audioEl.currentTime = globalPct * audioEl.duration;
  
  isDraggingWf = true;
  startDragX = e.clientX;
  startDragPan = wfPan;
});

window.addEventListener('mousemove', e => {
  if (!isDraggingWf || !waveformData) return;
  const rect = waveformContainer.getBoundingClientRect();
  const deltaX = e.clientX - startDragX;
  const deltaPct = deltaX / rect.width;
  
  let newPan = startDragPan - (deltaPct / wfZoom);
  newPan = Math.max(0, Math.min(1, newPan));
  if (newPan !== wfPan) {
    wfPan = newPan;
    renderWaveform();
  }
});

window.addEventListener('mouseup', () => {
  isDraggingWf = false;
});

waveformContainer.addEventListener('wheel', e => {
  e.preventDefault();
  if (!waveformData) return;
  
  const zoomFactor = 1.15;
  const oldZoom = wfZoom;
  
  if (e.deltaY < 0) wfZoom *= zoomFactor;
  else wfZoom /= zoomFactor;
  
  wfZoom = Math.max(1, Math.min(100, wfZoom));
  
  if (oldZoom !== wfZoom) {
    const rect = waveformContainer.getBoundingClientRect();
    const mouseLocalPct = (e.clientX - rect.left) / rect.width;
    const oldVisibleStart = wfPan * (1 - (1/oldZoom));
    const mouseGlobalPct = oldVisibleStart + (mouseLocalPct / oldZoom);
    
    if (wfZoom > 1) {
      wfPan = (mouseGlobalPct - (mouseLocalPct / wfZoom)) / (1 - (1/wfZoom));
      wfPan = Math.max(0, Math.min(1, wfPan));
    } else {
      wfPan = 0;
    }
    renderWaveform();
  }
}, { passive: false });


// ─── Player Resizer ────────────────────────────────────────────────────────
let isResizingPlayer = false;
let startPlayerY = 0;
let startPlayerH = 0;

if (playerResizer) {
  playerResizer.addEventListener('mousedown', e => {
    isResizingPlayer = true;
    startPlayerY = e.clientY;
    startPlayerH = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--player-h')) || 88;
    document.body.style.cursor = 'row-resize';
    playerResizer.classList.add('dragging');
  });

  window.addEventListener('mousemove', e => {
    if (!isResizingPlayer) return;
    const dy = startPlayerY - e.clientY; // drag up = increase height
    let newH = startPlayerH + dy;
    newH = Math.max(70, Math.min(800, newH));
    document.documentElement.style.setProperty('--player-h', newH + 'px');
    if (waveformData) renderWaveform();
  });

  window.addEventListener('mouseup', () => {
    if (isResizingPlayer) {
      isResizingPlayer = false;
      document.body.style.cursor = '';
      playerResizer.classList.remove('dragging');
    }
  });
}

// ─── Keyboard Shortcuts ──────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); searchInput.focus(); searchInput.select(); }
  if ((e.metaKey || e.ctrlKey) && e.key === 't') { e.preventDefault(); addNewTab(); }
  if ((e.metaKey || e.ctrlKey) && e.key === 'w') { e.preventDefault(); closeTab(activeTabId); }
    if (e.key.toLowerCase() === 'x' && document.activeElement.tagName !== 'INPUT' && currentFile) {
    e.preventDefault();
    btnXRay.click();
  }
if (e.key === ' ' && document.activeElement.tagName !== 'INPUT') {
    e.preventDefault();
    if (!audioEl.paused) audioEl.pause(); else if (currentFile) audioEl.play();
  }
});

// ─── Event Listeners ────────────────────────────────────────────────────────
if (btnNewTab) btnNewTab.addEventListener('click', addNewTab);
btnAddLibrary.addEventListener('click',  importLibrary);
btnAddLibrary2.addEventListener('click', importLibrary);
searchInput.addEventListener('input', scheduleSearch);
filterLibrary.addEventListener('change', () => {
  activeLibId = filterLibrary.value ? parseInt(filterLibrary.value) : null;
  activeFolderPath = null;
  renderLibraryList();
  if (activeLibId) loadFolderTree(activeLibId);
  else folderTreeSection.setAttribute('hidden','');
  runSearch();
});
filterExt.addEventListener('change',        runSearch);
filterChannels.addEventListener('change',   runSearch);
filterSamplerate.addEventListener('change', runSearch);
btnClearFilters.addEventListener('click', () => {
  filterExt.value = ''; filterChannels.value = ''; filterSamplerate.value = ''; filterLibrary.value = '';
  activeLibId = null; activeFolderPath = null;
  renderLibraryList();
  folderTreeSection.setAttribute('hidden','');
  runSearch();
});
sortBtns.forEach(b => b.addEventListener('click', () => setSort(b.dataset.sort)));
tableHeaders.forEach(th => th.addEventListener('click', () => setSort(th.dataset.sort)));

// ─── Helpers ─────────────────────────────────────────────────────────────────
function formatDuration(s) { if (s==null) return '–'; const sec=Math.round(s); return `${Math.floor(sec/60)}:${(sec%60).toString().padStart(2,'0')}`; }
function fmtSec(s) { if (!s||isNaN(s)) return '0:00'; const sec=Math.floor(s); return `${Math.floor(sec/60)}:${(sec%60).toString().padStart(2,'0')}`; }
function formatSamplerate(sr) { return sr ? (sr/1000).toFixed(sr%1000===0?0:1) : '–'; }
function formatChannels(ch) { if (!ch) return '–'; return ch===1?'Mono':ch===2?'Stereo':ch+' ch'; }
function formatSize(b) { if (!b) return '–'; return b<1048576 ? (b/1024).toFixed(1)+' KB' : (b/1048576).toFixed(1)+' MB'; }
function escHtml(s) { return s ? String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : ''; }
function truncate(s,n) { return s && s.length>n ? s.slice(0,n)+'…' : (s||''); }

let toastTimer;
function showToast(msg, type='info') {
  toast.textContent = msg; toast.className = `toast-${type}`;
  toast.removeAttribute('hidden'); clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.setAttribute('hidden',''), 4000);
}

init();
