import { FFT, applyHanningWindow } from './fft.js';
import { UCS_CAT_IDS, UCS_CAT_ID_MAP } from './ucs_data.js';
// SonicFlow – Frontend Logic (Tauri v2)
const { invoke, convertFileSrc } = window.__TAURI__.core;
const { open } = window.__TAURI__.dialog;
const { open: openPath } = window.__TAURI__.shell;
const { WebviewWindow } = window.__TAURI__.webviewWindow;

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
let gainNode    = null;       // GainNode for volume leveling
let waveformData = null;      // raw Float32Array (forward)
let reversedData = null;      // reversed copy of waveformData
let isReversed  = false;      // reverse playback state
let currentAssetUrl = null;   // original asset:// URL of the loaded file
let reverseBlobUrl  = null;   // blob: URL created for reversed WAV
let currentSampleRate = 48000;
let wfMode = 0; // 0=Classic, 1=Histogram, 2=Symmetric X-Ray
let wfZoom = 1;
let wfPan = 0;
let isDraggingWf = false;
let startDragX = 0;
let startDragPan = 0;

let isShuffle = false;
let isDockMode = false;
let isSpectrogram = false;
let collections = [];
let activeCollectionId = null;
let freesoundMode = false;

// Tabs State
let tabs = [];
let activeTabId = null;
let sessionApiKey = null; // Memory-only storage for the current session

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
    filterBitdepth: '',
    filterUcsCat: '',
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
const gainSlider      = $('gain-slider');
const gainValueLabel  = $('gain-value');
const audioOutputSelect = $('audio-output-select');
const btnOpenFile     = $('btn-open-file');
const btnXray         = $('btn-xray');
const btnReverse      = $('btn-reverse');
const waveformCanvas  = $('waveform-canvas');
const waveformPlayhead = $('waveform-playhead');
const waveformContainer = $('waveform-container');
const playerResizer   = $('player-resizer');
const filterBitdepth  = $('filter-bitdepth');
const filterUcsCat    = $('filter-ucs-cat');

const btnShuffle      = $('btn-shuffle');
const btnDockMode     = $('btn-dock-mode');
const btnAddCollection = $('btn-add-collection');
const collectionsList  = $('collections-list');
const btnFreesoundSearch = $('btn-freesound-search');
const contextMenu      = $('context-menu');
const contextMenuList  = $('context-menu-list');
const btnExitDock     = $('btn-exit-dock');
const newCollectionContainer = $('new-collection-container');
const inputNewCollection     = $('input-new-collection');

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
  { key: 'ucs',      width: 88,  resizable: true  },
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
  initExtraListeners();
  await loadLibraries();
  await loadCollections();
  if (libraries.length > 0) await runSearch();
}

function initExtraListeners() {
  btnShuffle?.addEventListener('click', () => {
    isShuffle = !isShuffle;
    btnShuffle.classList.toggle('active', isShuffle);
    runSearch();
  });

  btnDockMode?.addEventListener('click', async () => {
    isDockMode = !isDockMode;
    document.body.classList.toggle('docked', isDockMode);
    await invoke('toggle_dock_mode', { enabled: isDockMode });
  });



  btnAddCollection?.addEventListener('click', () => {
    newCollectionContainer.removeAttribute('hidden');
    inputNewCollection.focus();
  });

  inputNewCollection?.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      const name = inputNewCollection.value.trim();
      if (name) {
        try {
          await invoke('create_collection', { name });
          inputNewCollection.value = '';
          newCollectionContainer.setAttribute('hidden', '');
          await loadCollections();
          showToast(`Sammlung „${name}“ erstellt`, 'success');
        } catch (err) { showToast('Fehler: ' + err, 'error'); }
      }
    } else if (e.key === 'Escape') {
      newCollectionContainer.setAttribute('hidden', '');
    }
  });

  inputNewCollection?.addEventListener('blur', () => {
    if (!inputNewCollection.value.trim()) {
      newCollectionContainer.setAttribute('hidden', '');
    }
  });

  btnFreesoundSearch?.addEventListener('click', () => {
    freesoundMode = !freesoundMode;
    btnFreesoundSearch.classList.toggle('active', freesoundMode);
    searchInput.placeholder = freesoundMode ? 'Freesound.org durchsuchen …' : 'Suche nach Dateiname, Tags, Keywords …';
    if (freesoundMode) {
      allSounds = [];
      renderResults();
    } else {
      runSearch();
    }
  });

  btnExitDock?.addEventListener('click', () => {
    isDockMode = false;
    document.body.classList.remove('docked');
    invoke('toggle_dock_mode', { enabled: false });
  });

  const btnShowHelp = $('btn-show-help');
  btnShowHelp?.addEventListener('click', () => {
    invoke('show_help');
  });

  // Settings Logic
  const btnSettings = $('btn-settings');
  const settingsOverlay = $('settings-overlay');
  const btnCloseSettings = $('btn-close-settings');
  const btnSaveSettings = $('btn-save-settings');
  const inputFreesoundKey = $('input-freesound-key');
  const btnFreesoundInfo = $('btn-freesound-info');
  const freesoundInstructions = $('freesound-instructions');
  const checkSessionOnly = $('check-session-only');
  const inputDownloadPath = $('input-download-path');
  const btnChooseDownloadPath = $('btn-choose-download-path');

  btnSettings?.addEventListener('click', () => {
    const savedKey = localStorage.getItem('freesound_api_key');
    if (savedKey) {
      inputFreesoundKey.value = savedKey;
      checkSessionOnly.checked = false;
    } else {
      inputFreesoundKey.value = sessionApiKey || '';
      checkSessionOnly.checked = !!sessionApiKey;
    }
    
    // Load download path
    inputDownloadPath.value = localStorage.getItem('freesound_download_path') || '';
    
    settingsOverlay.removeAttribute('hidden');
  });

  btnChooseDownloadPath?.addEventListener('click', async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: 'Download-Ordner wählen'
    });
    if (selected) {
      inputDownloadPath.value = selected;
    }
  });

  btnFreesoundInfo?.addEventListener('click', () => {
    freesoundInstructions.toggleAttribute('hidden');
  });

  btnCloseSettings?.addEventListener('click', () => {
    settingsOverlay.setAttribute('hidden', '');
    freesoundInstructions.setAttribute('hidden', '');
  });

  btnSaveSettings?.addEventListener('click', () => {
    const key = inputFreesoundKey.value.trim();
    if (checkSessionOnly.checked) {
      sessionApiKey = key;
      localStorage.removeItem('freesound_api_key');
    } else {
      localStorage.setItem('freesound_api_key', key);
      sessionApiKey = null;
    }

    // Save download path
    localStorage.setItem('freesound_download_path', inputDownloadPath.value);

    settingsOverlay.setAttribute('hidden', '');
    showToast('Einstellungen gespeichert', 'success');
  });

  settingsOverlay?.addEventListener('click', (e) => {
    if (e.target === settingsOverlay) {
      settingsOverlay.setAttribute('hidden', '');
      freesoundInstructions.setAttribute('hidden', '');
    }
  });
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
    oldTab.filterBitdepth = filterBitdepth.value;
    oldTab.filterUcsCat = filterUcsCat.value;
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
  filterBitdepth.value = newTab.filterBitdepth || '';
  filterUcsCat.value   = newTab.filterUcsCat   || '';
  
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
// ─── Collections ────────────────────────────────────────────────────────────
async function loadCollections() {
  try { 
    collections = await invoke('get_collections'); 
    console.log('Collections loaded:', collections);
  } catch (e) { 
    console.error('Failed to load collections:', e);
    collections = []; 
  }
  renderCollections();
}

function renderCollections() {
  if (!collectionsList) return;
  collectionsList.innerHTML = '';
  collections.forEach(c => {
    const li = document.createElement('li');
    li.className = 'collection-item' + (activeCollectionId === c.id ? ' active' : '');
    li.innerHTML = `
      <span class="collection-icon">📁</span>
      <span class="collection-name">${escHtml(c.name)}</span>
      <span class="collection-count">${c.count}</span>
      <button class="lib-action-btn danger btn-delete-col" title="Sammlung löschen">
        <svg width="12" height="12" viewBox="0 0 13 13"><path d="M2 3h9M5 3V2h3v1M4 3l.5 7h4L9 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      </button>
    `;
    li.addEventListener('click', e => {
      if (e.target.closest('.btn-delete-col')) return;
      activeCollectionId = (activeCollectionId === c.id) ? null : c.id;
      activeLibId = null; // deactivate lib filter when collection is active
      activeFolderPath = null;
      renderCollections();
      renderLibraryList();
      runSearch();
    });
    li.querySelector('.btn-delete-col').addEventListener('click', async e => {
      e.stopPropagation();
      if (!confirm(`Sammlung „${c.name}“ löschen?`)) return;
      try {
        await invoke('delete_collection', { id: c.id });
        if (activeCollectionId === c.id) activeCollectionId = null;
        loadCollections();
      } catch (e) { showToast('Fehler: ' + e, 'error'); }
    });
    collectionsList.appendChild(li);
  });
}
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
      activeFolderPath = null;
      activeCollectionId = null; // Reset collection filter when a library is selected
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
  console.log('importLibrary called');
  let selectedPath;
  try {
    if (!open) {
      console.error('Tauri Dialog Plugin "open" is not available');
      showToast('Fehler: Dialog-Modul nicht gefunden', 'error');
      return;
    }
    selectedPath = await open({ directory: true, multiple: false, title: 'Ordner auswählen' }); 
  }
  catch (e) { 
    console.error('Dialog selection error:', e);
    showToast('Dialog-Fehler: ' + e, 'error'); 
    return; 
  }
  
  if (!selectedPath) {
    console.log('User cancelled folder selection');
    return;
  }
  
  console.log('Selected path:', selectedPath);
  importOverlay?.removeAttribute('hidden');
  if (importSubtitle) importSubtitle.textContent = `Scanne: ${selectedPath}`;
  
  try {
    const result = await invoke('import_library', { path: selectedPath });
    showToast(`✓ ${result.imported.toLocaleString('de-DE')} Dateien importiert`, 'success');
    initAudioDevices();
    await loadLibraries();
    activeLibId = result.library.id;
    if (filterLibrary) filterLibrary.value = activeLibId;
    renderLibraryList();
    await runSearch();
  } catch (e) {
    console.error('Import error:', e);
    showToast('Import fehlgeschlagen: ' + (e.message || e), 'error');
  } finally {
    importOverlay?.setAttribute('hidden', '');
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
    bitdepth:   filterBitdepth.value   ? parseInt(filterBitdepth.value)   : null,
    channels:   filterChannels.value   ? parseInt(filterChannels.value)   : null,
    ucs_cat_id: filterUcsCat.value || null,
    shuffle:    isShuffle,
  };
  try { 
    if (freesoundMode) {
      if (!query.trim()) {
        allSounds = [];
      } else {
        const apiKey = localStorage.getItem('freesound_api_key') || sessionApiKey;
        const results = await invoke('search_freesound', { query, apiKey });
        // Preserve the original URL for redownloads
        results.forEach(s => s.originalUrl = s.filepath);
        allSounds = results;
      }
    } else if (activeCollectionId) {
      allSounds = await invoke('get_collection_sounds', { collectionId: activeCollectionId });
    } else {
      allSounds = await invoke('search_sounds', { query, filters }); 
    }
  } catch (e) { 
    showToast('Suchfehler: ' + e, 'error'); 
    allSounds = []; 
  }
  
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
  const path = sound.filepath || '';
  tr.dataset.filepath = path;
  tr.setAttribute('draggable', 'true');
  if (currentFile === path) tr.classList.add('playing');

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
    <td class="col-ucs">${buildUcsPill(sound)}</td>
    <td class="col-size cell-mono">${formatSize(sound.filesize)}</td>
    <td class="col-drag">
      <div style="display: flex; gap: 4px; align-items: center;">
        ${(sound.filepath.startsWith('http') || sound.originalUrl) ? `
          <button class="btn-download" title="Download für Drag & Drop" aria-label="Download">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
          </button>
        ` : ''}
        <div class="btn-drag-handle" title="In NLE ziehen" aria-label="Datei in NLE ziehen">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="4" cy="3" r="1.2" fill="currentColor"/><circle cx="10" cy="3" r="1.2" fill="currentColor"/>
            <circle cx="4" cy="7" r="1.2" fill="currentColor"/><circle cx="10" cy="7" r="1.2" fill="currentColor"/>
            <circle cx="4" cy="11" r="1.2" fill="currentColor"/><circle cx="10" cy="11" r="1.2" fill="currentColor"/>
          </svg>
        </div>
      </div>
    </td>`;

  tr.querySelector('.btn-row-play').addEventListener('click', e => { e.stopPropagation(); togglePlay(sound); });
  tr.addEventListener('click', e => { 
    if (!e.target.closest('.btn-drag-handle') && !e.target.closest('.row-waveform') && !e.target.closest('.ucs-pill-btn')) {
      togglePlay(sound); 
    }
  });
  tr.querySelector('.row-waveform').addEventListener('click', e => e.stopPropagation());

  // ── UCS inline tagging ──
  const ucsPillBtn = tr.querySelector('.ucs-pill-btn');
  if (ucsPillBtn) {
    ucsPillBtn.addEventListener('click', e => {
      e.stopPropagation();
      openUcsTagDialog(sound, ucsPillBtn);
    });
  }

  // ── Native Drag & Drop ──
  tr.addEventListener('dragstart', async e => {
    if (sound.filepath.startsWith('http')) {
      e.preventDefault();
      showToast('Sound muss erst heruntergeladen werden!', 'warning');
      return;
    }
    e.preventDefault();
    const { Channel } = window.__TAURI__.core;
    const onEventChannel = new Channel();
    invoke('plugin:drag|start_drag', {
      item: [sound.filepath],
      image: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
      options: { mode: 'copy' },
      onEvent: onEventChannel
    }).catch(err => showToast('Drag Fehler: ' + err, 'error'));
  });

  // ── Download Handler ──
  const btnDownload = tr.querySelector('.btn-download');
  if (btnDownload) {
    btnDownload.addEventListener('click', async (e) => {
      e.stopPropagation();
      btnDownload.classList.add('loading');
      const targetUrl = sound.originalUrl || sound.filepath;
      try {
        const targetDir = localStorage.getItem('freesound_download_path') || null;
        const localPath = await invoke('download_sound', { 
          url: targetUrl, 
          filename: sound.filename,
          targetDir
        });
        sound.filepath = localPath; // Update object in memory
        tr.dataset.filepath = localPath;
        
        // Show success icon briefly, then return to normal or keep it green
        btnDownload.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
        btnDownload.classList.remove('loading');
        btnDownload.classList.add('success');
        btnDownload.title = "Erneut herunterladen";
        
        showToast('Download erfolgreich!', 'success');

        // Optional: After 3 seconds, reset the icon but keep it green to show it's local
        setTimeout(() => {
          btnDownload.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>';
        }, 3000);
      } catch (err) {
        btnDownload.classList.remove('loading');
        showToast('Download Fehler: ' + err, 'error');
      }
    });
  }

  // ── Context Menu ──
  tr.addEventListener('contextmenu', e => {
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, [
      { label: 'Im Finder anzeigen', icon: '📂', action: () => invoke('open_in_finder', { path: sound.filepath }) },
      { label: 'In Standard-App öffnen', icon: '🚀', action: () => invoke('open_with_app', { path: sound.filepath, app: null }) },
      { separator: true },
      { label: 'Zu Sammlung hinzufügen...', icon: '➕', action: () => openAddToCollectionMenu(e.clientX, e.clientY, sound) },
      { separator: true },
      { label: 'Metadaten bearbeiten (UCS)', icon: '🏷️', action: () => openUcsTagDialog(sound, tr.querySelector('.ucs-pill-btn')) }
    ]);
  });

  return tr;
}

function showContextMenu(x, y, items) {
  contextMenuList.innerHTML = '';
  items.forEach(item => {
    if (item.separator) {
      const sep = document.createElement('div');
      sep.className = 'context-menu-separator';
      contextMenuList.appendChild(sep);
      return;
    }
    const li = document.createElement('li');
    li.className = 'context-menu-item';
    li.innerHTML = `<span class="context-icon">${item.icon || ''}</span> <span class="context-label">${item.label}</span>`;
    li.addEventListener('click', async e => {
      e.stopPropagation();
      const preventHide = await item.action(li);
      if (preventHide !== true) hideContextMenu();
    });
    contextMenuList.appendChild(li);
  });

  contextMenu.style.left = `${x}px`;
  contextMenu.style.top = `${y}px`;
  contextMenu.removeAttribute('hidden');

  const onOutsideClick = (e) => {
    if (!contextMenu.contains(e.target)) {
      hideContextMenu();
      document.removeEventListener('mousedown', onOutsideClick);
    }
  };
  setTimeout(() => document.addEventListener('mousedown', onOutsideClick), 10);
}

function hideContextMenu() {
  contextMenu.setAttribute('hidden', '');
}

async function openAddToCollectionMenu(x, y, sound) {
  const items = collections.map(c => ({
    label: c.name,
    icon: '📁',
    action: async () => {
      try {
        await invoke('add_to_collection', { collectionId: c.id, soundId: sound.id });
        showToast(`Zu „${c.name}“ hinzugefügt`, 'success');
        loadCollections();
      } catch (e) { showToast('Fehler: ' + e, 'error'); }
    }
  }));
  
  if (items.length === 0) {
    items.push({ label: 'Keine Sammlungen vorhanden', icon: '⚠️', action: () => {} });
  }
  
  showContextMenu(x, y, [
    { label: 'Zurück', icon: '⬅️', action: () => { 
        // Re-open main context menu
        showContextMenu(x, y, [
          { label: 'Im Finder anzeigen', icon: '📂', action: () => invoke('open_in_finder', { path: sound.filepath }) },
          { label: 'In Standard-App öffnen', icon: '🚀', action: () => invoke('open_with_app', { path: sound.filepath, app: null }) },
          { separator: true },
          { label: 'Zu Sammlung hinzufügen...', icon: '➕', action: () => openAddToCollectionMenu(x, y, sound) },
          { separator: true },
          { label: 'Metadaten bearbeiten (UCS)', icon: '🏷️', action: () => openUcsTagDialog(sound, null) }
        ]);
        return true; // prevent hide
    } },
    { separator: true },
    { label: 'Neue Sammlung...', icon: '✨', action: (li) => {
        // Replace LI content with an input field
        li.innerHTML = `
          <input type="text" id="ctx-new-coll-input" placeholder="Name..." 
            style="width: 100%; background: var(--bg-hover); border: 1px solid var(--accent-violet); color: white; padding: 4px 8px; border-radius: 4px; outline: none; font-size: 12px;" />
        `;
        const input = li.querySelector('input');
        input.focus();
        
        input.addEventListener('keydown', async (e) => {
          if (e.key === 'Enter') {
            const name = input.value.trim();
            if (name) {
              try {
                await invoke('create_collection', { name });
                const all = await invoke('get_collections');
                const created = all.find(c => c.name === name);
                if (created) {
                  await invoke('add_to_collection', { collectionId: created.id, soundId: sound.id });
                  showToast(`Sammlung „${name}“ erstellt`, 'success');
                  loadCollections();
                  hideContextMenu();
                }
              } catch (err) { showToast('Fehler: ' + err, 'error'); }
            }
          } else if (e.key === 'Escape') {
            openAddToCollectionMenu(x, y, sound);
          }
        });
        
        input.addEventListener('click', e => e.stopPropagation());
        
        return true; // prevent immediate hide
    } },
    { separator: true },
    ...items
  ]);
  return true; // prevent hide
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

function ensureAudioContext() {
  if (!audioCtx) audioCtx = new AudioContext();
}

function getGainDb(sliderVal) {
  // slider 0–2 linear → dB; 1.0 = 0 dB
  if (sliderVal <= 0) return '-∞';
  return (20 * Math.log10(sliderVal)).toFixed(1) + ' dB';
}

function playSound(sound) {
  currentFile = sound.filepath;
  // Use Tauri's asset:// protocol – file:// is blocked by the WebView CSP
  const assetUrl = sound.filepath.startsWith('http') ? sound.filepath : convertFileSrc(sound.filepath);
  currentAssetUrl = assetUrl;

  // Clean up any leftover reverse blob from a previous file
  if (reverseBlobUrl) { URL.revokeObjectURL(reverseBlobUrl); reverseBlobUrl = null; }

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
  btnOpenFile.dataset.filepath = sound.filepath;

  // Reset reverse state when a new file is loaded
  isReversed = false;
  btnReverse.classList.remove('active');
  reversedData = null;

  drawWaveform(assetUrl);
  renderResults();
}

function getMagmaColor(v) {
  // v: 0.0 to 1.0 (Magma-like colormap)
  const c = [
    [0, 0, 4],       // 0.0 (Dark blue/black)
    [30, 10, 60],    // 0.2
    [100, 20, 100],  // 0.4
    [220, 40, 60],   // 0.6
    [255, 180, 20],  // 0.8
    [255, 255, 180]  // 1.0 (Light yellow/white)
  ];
  const stops = [0, 0.2, 0.4, 0.6, 0.8, 1.0];
  if (v <= 0) return `rgb(${c[0][0]},${c[0][1]},${c[0][2]})`;
  if (v >= 1) return `rgb(${c[5][0]},${c[5][1]},${c[5][2]})`;
  for (let i = 0; i < stops.length - 1; i++) {
    if (v >= stops[i] && v <= stops[i+1]) {
      const t = (v - stops[i]) / (stops[i+1] - stops[i]);
      const r = Math.floor(c[i][0] + (c[i+1][0] - c[i][0]) * t);
      const g = Math.floor(c[i][1] + (c[i+1][1] - c[i][1]) * t);
      const b = Math.floor(c[i][2] + (c[i+1][2] - c[i][2]) * t);
      return `rgb(${r},${g},${b})`;
    }
  }
  return 'rgb(0,0,0)';
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
    ensureAudioContext();
    const resp = await fetch(uri);
    const arrayBuf = await resp.arrayBuffer();
    const audioBuf = await audioCtx.decodeAudioData(arrayBuf);
    // Store forward channel data
    waveformData = audioBuf.getChannelData(0);
    // Pre-compute reversed copy
    reversedData = new Float32Array(waveformData).reverse();
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
  
  // Use client dimensions for logical units
  const wLogical = waveformCanvas.clientWidth || 400;
  const hLogical = waveformCanvas.clientHeight || 80;
  
  // Set physical buffer size
  waveformCanvas.width  = Math.round(wLogical * dpr);
  waveformCanvas.height = Math.round(hLogical * dpr);
  
  // Clean start
  ctx.setTransform(1, 0, 0, 1, 0, 0); 
  ctx.clearRect(0, 0, waveformCanvas.width, waveformCanvas.height);
  
  // We work in physical pixels for 100% precision
  const W = waveformCanvas.width;
  const H = waveformCanvas.height;
  const midY = H / 2;
  const drawPadding = 10 * dpr; // 10px padding top/bottom
  const drawH = H - (drawPadding * 2);

  const data = isReversed && reversedData ? reversedData : waveformData;
  const totalSamples = data.length;
  const visibleSamples = Math.floor(totalSamples / wfZoom);
  const startSample = Math.floor(wfPan * (totalSamples - visibleSamples));
  const step = Math.max(1, visibleSamples / W);

  // Gradient for Mode 0
  const grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, '#7c6fff');
  grad.addColorStop(1, '#00d4ff');

  // FFT Setup for X-Ray
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
    const sampleIdx = Math.floor(startSample + (x * step));
    let min = 0, max = 0;
    
    // Peak finding for this pixel column
    for (let i = 0; i < Math.max(1, step); i++) {
      const val = data[sampleIdx + i] || 0;
      if (val < min) min = val;
      if (val > max) max = val;
    }

    const amp = Math.max(Math.abs(min), Math.abs(max));
    let r=0, g=0, b=0;

    if (wfMode > 0 && fft) {
      const windowStart = sampleIdx - (fftSize / 2);
      for (let i = 0; i < fftSize; i++) {
        let idx = windowStart + i;
        fftInput[i] = (idx >= 0 && idx < totalSamples) ? data[idx] : 0;
      }
      applyHanningWindow(fftInput);
      const mags = fft.forward(fftInput);
      let eB=0, eM=0, eH=0;
      for (let i=0; i<mags.length; i++){
        if (i <= bassBin) eB += mags[i];
        else if (i <= midBin) eM += mags[i];
        else eH += mags[i];
      }
      const sum = eB + eM + eH + 0.0001;
      r = Math.min(255, (eB/sum) * 255 * 1.5);
      g = Math.min(255, (eM/sum) * 255 * 1.5);
      b = Math.min(255, (eH/sum) * 255 * 1.5);
    }

    if (wfMode === 0) {
      ctx.fillStyle = grad;
      const h = amp * drawH;
      ctx.fillRect(x, midY - (h/2), 1, Math.max(1, h));
    } else if (wfMode === 1) {
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      const h = amp * drawH;
      ctx.fillRect(x, midY - (h/2), 1, Math.max(1, h));
    } else {
      // Histogram
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      const h = amp * drawH;
      ctx.fillRect(x, drawPadding + drawH - h, 1, Math.max(1, h));
    }
  }

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
  audioEl.pause(); 
  audioEl.currentTime = 0; 
  updatePlayhead(0);
});
volumeSlider.addEventListener('input', e => { audioEl.volume = e.target.value; });
btnOpenFile.addEventListener('click', async () => {
  const fp = btnOpenFile.dataset.filepath;
  if (!fp) return;
  try { await invoke('open_in_finder', { path: fp }); } catch (e) { console.error(e); showToast('Finder konnte nicht geöffnet werden', 'error'); }
});


btnXray.addEventListener('click', () => {
  wfMode = (wfMode + 1) % 3; // 0: Classic, 1: X-Ray Symmetric, 2: X-Ray Histogram
  btnXray.classList.toggle('active', wfMode > 0);
  renderWaveform();
});

// ─── Gain Slider ─────────────────────────────────────────────────────────────
function updateGainLabel(val) {
  gainValueLabel.textContent = getGainDb(parseFloat(val));
}

gainSlider.addEventListener('input', e => {
  const val = parseFloat(e.target.value);
  audioEl.volume = Math.min(1, val);  // <audio> volume caps at 1
  // For gain > 1 we rely on a WebAudio GainNode if available
  if (gainNode) gainNode.gain.value = val;
  updateGainLabel(val);
});

// Initialise label on page load
updateGainLabel(gainSlider.value);

// ─── Reverse Playback ─────────────────────────────────────────────────────────
btnReverse.addEventListener('click', () => {
  if (!currentFile) return;
  isReversed = !isReversed;
  btnReverse.classList.toggle('active', isReversed);
  showToast(isReversed ? '◀ Reverse aktiv' : '▶ Normale Wiedergabe', 'info');
  applyReversePlayback();
  renderWaveform();
});

// Encodes an AudioBuffer as a 16-bit stereo/mono WAV Blob (all channels).
function audioBufferToWavBlob(buffer) {
  const numCh = buffer.numberOfChannels;
  const sr    = buffer.sampleRate;
  const len   = buffer.length;
  const dataLen = len * numCh * 2; // 16-bit samples
  const wav   = new ArrayBuffer(44 + dataLen);
  const v     = new DataView(wav);
  const str   = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };

  str(0, 'RIFF');  v.setUint32(4, 36 + dataLen, true);
  str(8, 'WAVE');  str(12, 'fmt ');
  v.setUint32(16, 16, true);           // chunk size
  v.setUint16(20, 1,  true);           // PCM
  v.setUint16(22, numCh, true);
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * numCh * 2, true); // byte rate
  v.setUint16(32, numCh * 2, true);    // block align
  v.setUint16(34, 16, true);           // bit depth
  str(36, 'data'); v.setUint32(40, dataLen, true);

  let off = 44;
  for (let i = 0; i < len; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      const s = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
      v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      off += 2;
    }
  }
  return new Blob([wav], { type: 'audio/wav' });
}

async function applyReversePlayback() {
  if (!currentFile || !currentAssetUrl) return;

  const wasPlaying  = !audioEl.paused;
  const positionPct = audioEl.duration ? audioEl.currentTime / audioEl.duration : 0;

  // Pause immediately so the old src stops producing sound
  audioEl.pause();

  try {
    if (isReversed) {
      // ── Decode original → build reversed AudioBuffer → WAV blob ──
      ensureAudioContext();
      const resp = await fetch(currentAssetUrl);
      const arrayBuf = await resp.arrayBuffer();
      const origBuf  = await audioCtx.decodeAudioData(arrayBuf);

      const numCh = origBuf.numberOfChannels;
      const len   = origBuf.length;
      const revBuf = audioCtx.createBuffer(numCh, len, origBuf.sampleRate);
      for (let ch = 0; ch < numCh; ch++) {
        const fwd = origBuf.getChannelData(ch);
        const rev = revBuf.getChannelData(ch);
        for (let i = 0; i < len; i++) rev[i] = fwd[len - 1 - i];
      }

      if (reverseBlobUrl) { URL.revokeObjectURL(reverseBlobUrl); }
      reverseBlobUrl = URL.createObjectURL(audioBufferToWavBlob(revBuf));

      const targetPct = 1 - positionPct; // mirrored seek position
      audioEl.src = reverseBlobUrl;
      audioEl.load();
      audioEl.addEventListener('loadedmetadata', () => {
        audioEl.currentTime = targetPct * audioEl.duration;
        if (wasPlaying) audioEl.play().catch(() => {});
      }, { once: true });

    } else {
      // ── Switch back to original file ──
      const targetPct = 1 - positionPct;
      if (reverseBlobUrl) { URL.revokeObjectURL(reverseBlobUrl); reverseBlobUrl = null; }

      audioEl.src = currentAssetUrl;
      audioEl.load();
      audioEl.addEventListener('loadedmetadata', () => {
        audioEl.currentTime = targetPct * audioEl.duration;
        if (wasPlaying) audioEl.play().catch(() => {});
      }, { once: true });
    }

  } catch (err) {
    showToast('Reverse-Fehler: ' + err.message, 'error');
    isReversed = false;
    btnReverse.classList.remove('active');
    // Restore original playback
    audioEl.src = currentAssetUrl;
    audioEl.load();
    if (wasPlaying) audioEl.play().catch(() => {});
  }
}



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
    newH = Math.max(140, Math.min(800, newH));
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
    btnXray.click();
  }
  if (e.key.toLowerCase() === 'r' && document.activeElement.tagName !== 'INPUT' && currentFile) {
    e.preventDefault();
    btnReverse.click();
  }
  if (e.key === ' ' && document.activeElement.tagName !== 'INPUT') {
    e.preventDefault();
    if (!audioEl.paused) audioEl.pause(); else if (currentFile) audioEl.play();
  }
});

// ─── Event Listeners ────────────────────────────────────────────────────────
if (btnNewTab) btnNewTab.addEventListener('click', addNewTab);
btnAddLibrary?.addEventListener('click',  importLibrary);
btnAddLibrary2?.addEventListener('click', importLibrary);
if (searchInput) searchInput.addEventListener('input', scheduleSearch);
filterLibrary?.addEventListener('change', () => {
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
filterBitdepth.addEventListener('change',   runSearch);
filterUcsCat.addEventListener('change',     runSearch);
btnClearFilters.addEventListener('click', () => {
  filterExt.value = ''; filterChannels.value = ''; filterSamplerate.value = '';
  filterBitdepth.value = ''; filterUcsCat.value = ''; filterLibrary.value = '';
  activeLibId = null; activeFolderPath = null; activeCollectionId = null;
  renderLibraryList();
  renderCollections();
  folderTreeSection.setAttribute('hidden','');
  runSearch();
});
sortBtns.forEach(b => b.addEventListener('click', () => setSort(b.dataset.sort)));
tableHeaders.forEach(th => th.addEventListener('click', () => setSort(th.dataset.sort)));

// ─── Helpers ─────────────────────────────────────────────────────────────────
// Populate UCS CatID dropdown on startup
(function populateUcsDropdown() {
  UCS_CAT_IDS.forEach(({ id, label }) => {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = `${id} – ${label}`;
    filterUcsCat.appendChild(opt);
  });
})();

/** Returns an HTML string for the UCS pill in a result row. */
function buildUcsPill(sound) {
  const catId = sound.ucs_user_category || sound.ucs_cat_id || null;
  if (!catId) {
    return `<button class="ucs-pill-btn ucs-pill-empty" title="UCS-Kategorie zuweisen" aria-label="UCS-Kategorie zuweisen">+ UCS</button>`;
  }
  const label = UCS_CAT_ID_MAP[catId] || catId;
  return `<button class="ucs-pill-btn ucs-pill" title="${escHtml(label)} – klicken zum ändern" aria-label="UCS: ${escHtml(catId)}">${escHtml(catId)}</button>`;
}

/** Opens a popover-style select for inline UCS tagging. */
function openUcsTagDialog(sound, anchorEl) {
  // Remove existing dialog if any
  document.getElementById('ucs-tag-popover')?.remove();

  const popover = document.createElement('div');
  popover.id = 'ucs-tag-popover';
  popover.className = 'ucs-tag-popover';

  const sel = document.createElement('select');
  sel.className = 'ucs-tag-select';
  sel.innerHTML = `<option value="">– Keine UCS-Kategorie –</option>`;
  UCS_CAT_IDS.forEach(({ id, label }) => {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = `${id} – ${label}`;
    const current = sound.ucs_user_category || sound.ucs_cat_id;
    if (id === current) opt.selected = true;
    sel.appendChild(opt);
  });

  popover.appendChild(sel);
  document.body.appendChild(popover);

  // Position below anchor
  const rect = anchorEl.getBoundingClientRect();
  popover.style.top  = (rect.bottom + window.scrollY + 4) + 'px';
  popover.style.left = (rect.left + window.scrollX) + 'px';

  sel.focus();

  async function applyTag() {
    const chosen = sel.value;
    try {
      await invoke('save_ucs_tag', { id: sound.id, ucsUserCategory: chosen });
      sound.ucs_user_category = chosen || null;
      // Re-render the pill in-place
      const pillCell = anchorEl.closest('td');
      if (pillCell) pillCell.innerHTML = buildUcsPill(sound);
      // Attach new handler
      pillCell?.querySelector('.ucs-pill-btn')?.addEventListener('click', e => {
        e.stopPropagation();
        openUcsTagDialog(sound, pillCell.querySelector('.ucs-pill-btn'));
      });
      showToast(chosen ? `UCS: ${chosen}` : 'UCS-Tag entfernt', 'info');
    } catch (e) {
      showToast('UCS-Fehler: ' + e.message, 'error');
    }
    popover.remove();
  }

  sel.addEventListener('change', applyTag);
  sel.addEventListener('blur', () => setTimeout(() => popover.remove(), 150));
}

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
