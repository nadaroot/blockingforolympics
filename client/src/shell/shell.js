const { ipcRenderer } = require('electron');

// State
let currentConfig = { contestUrl: 'https://contest.yandex.ru', shortcuts: [] };
let activeTopZ = 200;
let openWindows = new Set();
let runningExternalApps = new Map(); // id -> shortcut object
let desktopFiles = [];
let currentEditorFile = 'solution.py';
let selectedItemId = null;

// DOM Elements
const systemClock = document.getElementById('systemClock');
const timerDot = document.getElementById('timerDot');
const timerDigits = document.getElementById('timerDigits');
const timerLabel = document.getElementById('timerLabel');

const desktopSurface = document.getElementById('desktopSurface');
const desktopIcons = document.getElementById('desktopIcons');
const desktopContextMenu = document.getElementById('desktopContextMenu');
const itemContextMenu = document.getElementById('itemContextMenu');
const selectionBox = document.getElementById('selectionBox');
const dockNavList = document.getElementById('dockNavList');

const broadcastBanner = document.getElementById('broadcastBanner');
const broadcastText = document.getElementById('broadcastText');
const btnCloseBanner = document.getElementById('btnCloseBanner');

const screenLockerOverlay = document.getElementById('screenLockerOverlay');
const lockerReason = document.getElementById('lockerReason');

const unlockModal = document.getElementById('unlockModal');
const unlockPasswordInput = document.getElementById('unlockPasswordInput');
const btnCancelUnlock = document.getElementById('btnCancelUnlock');
const btnConfirmUnlock = document.getElementById('btnConfirmUnlock');
const unlockError = document.getElementById('unlockError');

// Windows
const winBrowser = document.getElementById('winBrowser');
const winEditor = document.getElementById('winEditor');
const winFiles = document.getElementById('winFiles');
const winCalc = document.getElementById('winCalc');

// Safe Browser Elements
const desktopBrowserWv = document.getElementById('desktopBrowserWv');
const wvBtnBack = document.getElementById('wvBtnBack');
const wvBtnForward = document.getElementById('wvBtnForward');
const wvBtnReload = document.getElementById('wvBtnReload');
const wvBtnHome = document.getElementById('wvBtnHome');
const wvCurrentDomain = document.getElementById('wvCurrentDomain');
const browserWinTitle = document.getElementById('browserWinTitle');

// Editor Elements
const editorTextarea = document.getElementById('editorTextarea');
const editorLineNumbers = document.getElementById('editorLineNumbers');
const editorCurrentFilename = document.getElementById('editorCurrentFilename');
const editorLangBadge = document.getElementById('editorLangBadge');
const editorSaveStatus = document.getElementById('editorSaveStatus');
const btnEditorSave = document.getElementById('btnEditorSave');
const btnEditorClear = document.getElementById('btnEditorClear');

// Files Window Elements
const filesWindowGrid = document.getElementById('filesWindowGrid');
const btnFilesNewFile = document.getElementById('btnFilesNewFile');
const btnFilesNewFolder = document.getElementById('btnFilesNewFolder');
const btnFilesRefresh = document.getElementById('btnFilesRefresh');

// Context Menu Target Tracking
let itemCtxTarget = null;

// Clock
function updateClock() {
  const now = new Date();
  systemClock.textContent = now.toLocaleTimeString('ru-RU');
}
setInterval(updateClock, 1000);
updateClock();

// Format Seconds
function formatTime(totalSeconds) {
  if (totalSeconds < 0) totalSeconds = 0;
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map(v => v.toString().padStart(2, '0')).join(':');
}

// Inline SVG Icon Helpers
function makeSvgDataUri(svgContent) {
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svgContent.trim());
}

// Canonical / Standard Base Icons
const BASE_ICONS = {
  // Official Yandex Red Badge
  contest: makeSvgDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="64" height="64">
      <circle cx="64" cy="64" r="58" fill="#fc3f1d"/>
      <circle cx="64" cy="64" r="48" fill="#ffffff"/>
      <path d="M72 34 h-16 c-8 0 -14 6 -14 14 c0 6 3 11 8 13 l-10 23 h11 l9 -21 h4 v21 h10 v-50 z M64 57 h-8 c-4 0 -6 -2 -6 -6 c0 -4 2 -6 6 -6 h8 v12 z" fill="#fc3f1d"/>
    </svg>
  `),

  // Official Python Logo (Interlocking Blue & Yellow Serpents)
  python: makeSvgDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="64" height="64">
      <path d="M63.5 12 c-22.4 0 -21 9.7 -21 9.7 l.02 10.1 h21.4 v3 h-30 c-13.8 0 -24.2 8.3 -24.2 24.1 c0 15.8 8.8 23.3 20.3 23.3 h7.4 v-10.3 c0 -11.7 10.1 -11.7 10.1 -11.7 h20.9 c10.3 0 10.1 -9.9 10.1 -9.9 v-19.5 c0 -9.6 -9.2 -18.8 -25 -18.8 z M51 21.6 a4 4 0 1 1 0 8 a4 4 0 0 1 0 -8 z" fill="#387eb8"/>
      <path d="M64.5 116 c22.4 0 21 -9.7 21 -9.7 l-.02 -10.1 h-21.4 v-3 h30 c13.8 0 24.2 -8.3 24.2 -24.1 c0 -15.8 -8.8 -23.3 -20.3 -23.3 h-7.4 v10.3 c0 11.7 -10.1 11.7 -10.1 11.7 h-20.9 c-10.3 0 -10.1 9.9 -10.1 9.9 v19.5 c0 9.6 9.2 18.8 25 18.8 z M77 106.4 a4 4 0 1 1 0 -8 a4 4 0 0 1 0 8 z" fill="#ffe052"/>
    </svg>
  `),

  // Official Microsoft Visual Studio Code Origami Ribbon
  vscode: makeSvgDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="64" height="64">
      <path d="M96.7 122.9 a8 8 0 0 0 5.4 -1.6 l21.3 -16.4 a8 8 0 0 0 3 -6.3 V29.4 a8 8 0 0 0 -3 -6.3 L102.1 6.7 a8 8 0 0 0 -8.6 -.2 l-58 37.8 -21 -16 a5.5 5.5 0 0 0 -7.8 1.4 l-4.7 6.3 a5.5 5.5 0 0 0 1.4 7.8 L22.8 58 2 74 a5.5 5.5 0 0 0 -1.4 7.8 l4.7 6.3 a5.5 5.5 0 0 0 7.8 1.4 l22.4 -17 58.1 48.7 a8 8 0 0 0 3.1 1.7 z" fill="#0065a9"/>
      <path d="M93.5 6.5 l-58 37.8 22.8 19.7 40.8 -31.5 V11 a5 5 0 0 0 -5.6 -4.5 z" fill="#007acc"/>
      <path d="M93.5 121.5 a5 5 0 0 0 5.6 -4.5 V95.5 L58.3 64 l-22.8 19.7 58 37.8 z" fill="#1f9cf0"/>
      <path d="M123.4 23.1 L99.1 41.5 58.3 64 l40.8 22.5 24.3 18.4 a5 5 0 0 0 3 -4.5 V27.6 a5 5 0 0 0 -3 -4.5 z" fill="#0065a9"/>
    </svg>
  `),

  // Official JetBrains PyCharm Logo
  pycharm: makeSvgDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="64" height="64">
      <rect width="128" height="128" rx="26" fill="#212121"/>
      <path d="M14 16 h50 v50 h-50 Z" fill="#21D789"/>
      <path d="M64 64 h50 v50 h-50 Z" fill="#FC801D"/>
      <rect x="18" y="18" width="92" height="92" rx="14" fill="#181818"/>
      <path d="M30 94 h26 v6 h-26 Z" fill="#ffffff"/>
      <text x="26" y="66" font-family="'JetBrains Mono', Consolas, monospace" font-weight="900" font-size="34" fill="#ffffff">PC</text>
    </svg>
  `),

  // Classic Pascal / PascalABC Logo
  pascal: makeSvgDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="64" height="64">
      <rect width="128" height="128" rx="26" fill="#0284c7"/>
      <circle cx="64" cy="64" r="46" fill="#0369a1"/>
      <text x="64" y="80" text-anchor="middle" font-family="Georgia, serif" font-weight="bold" font-size="56" fill="#ffffff">P</text>
      <text x="64" y="102" text-anchor="middle" font-family="sans-serif" font-weight="bold" font-size="13" fill="#bae6fd">PASCAL</text>
    </svg>
  `),

  // Code::Blocks 4 Color Blocks & C++ Logo
  codeblocks: makeSvgDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="64" height="64">
      <rect width="128" height="128" rx="26" fill="#0f172a"/>
      <rect x="22" y="22" width="38" height="38" rx="6" fill="#ef4444"/>
      <rect x="68" y="22" width="38" height="38" rx="6" fill="#3b82f6"/>
      <rect x="22" y="68" width="38" height="38" rx="6" fill="#eab308"/>
      <rect x="68" y="68" width="38" height="38" rx="6" fill="#10b981"/>
      <text x="64" y="74" text-anchor="middle" font-family="sans-serif" font-weight="900" font-size="28" fill="#ffffff">C++</text>
    </svg>
  `),

  // Standard macOS/Modern Code Editor
  editor: makeSvgDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="64" height="64">
      <rect width="128" height="128" rx="26" fill="#0f172a"/>
      <rect x="14" y="14" width="100" height="100" rx="16" fill="#1e293b" stroke="#334155" stroke-width="2"/>
      <path d="M44 42 L24 64 L44 86" stroke="#38bdf8" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      <path d="M84 42 L104 64 L84 86" stroke="#38bdf8" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      <line x1="72" y1="36" x2="56" y2="92" stroke="#f43f5e" stroke-width="8" stroke-linecap="round"/>
    </svg>
  `),

  // Standard Files Explorer
  files: makeSvgDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="64" height="64">
      <path d="M16 28 h36 l12 12 h48 a8 8 0 0 1 8 8 v56 a8 8 0 0 1 -8 8 h-96 a8 8 0 0 1 -8 -8 v-76 z" fill="#0284c7"/>
      <path d="M16 46 h96 a8 8 0 0 1 8 8 v50 a8 8 0 0 1 -8 8 h-96 a8 8 0 0 1 -8 -8 v-50 a8 8 0 0 1 8 -8 z" fill="#38bdf8"/>
    </svg>
  `),

  // Standard Calculator
  calc: makeSvgDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="64" height="64">
      <rect width="128" height="128" rx="26" fill="#1c1917"/>
      <rect x="18" y="16" width="92" height="28" rx="8" fill="#292524"/>
      <text x="100" y="38" text-anchor="end" font-family="sans-serif" font-weight="bold" font-size="20" fill="#f5f5f4">0</text>
      <rect x="22" y="54" width="38" height="28" rx="6" fill="#44403c"/>
      <text x="41" y="74" text-anchor="middle" font-family="sans-serif" font-size="20" font-weight="bold" fill="#fff">+</text>
      <rect x="68" y="54" width="38" height="28" rx="6" fill="#44403c"/>
      <text x="87" y="74" text-anchor="middle" font-family="sans-serif" font-size="20" font-weight="bold" fill="#fff">−</text>
      <rect x="22" y="88" width="38" height="28" rx="6" fill="#44403c"/>
      <text x="41" y="108" text-anchor="middle" font-family="sans-serif" font-size="20" font-weight="bold" fill="#fff">×</text>
      <rect x="68" y="88" width="38" height="28" rx="6" fill="#ea580c"/>
      <text x="87" y="108" text-anchor="middle" font-family="sans-serif" font-size="20" font-weight="bold" fill="#fff">=</text>
    </svg>
  `),

  // Standard Windows Notepad Memo
  notepad: makeSvgDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="64" height="64">
      <rect x="22" y="14" width="84" height="100" rx="10" fill="#f8fafc" stroke="#94a3b8" stroke-width="3"/>
      <path d="M22 14 h84 v20 h-84 Z" fill="#0284c7"/>
      <line x1="36" y1="50" x2="92" y2="50" stroke="#94a3b8" stroke-width="4" stroke-linecap="round"/>
      <line x1="36" y1="66" x2="92" y2="66" stroke="#94a3b8" stroke-width="4" stroke-linecap="round"/>
      <line x1="36" y1="82" x2="72" y2="82" stroke="#94a3b8" stroke-width="4" stroke-linecap="round"/>
      <line x1="36" y1="98" x2="84" y2="98" stroke="#94a3b8" stroke-width="4" stroke-linecap="round"/>
    </svg>
  `),

  // Web Browser / Website Globe
  genericWeb: makeSvgDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="64" height="64">
      <circle cx="64" cy="64" r="54" fill="#0284c7"/>
      <circle cx="64" cy="64" r="46" fill="none" stroke="#e0f2fe" stroke-width="6"/>
      <ellipse cx="64" cy="64" rx="24" ry="46" fill="none" stroke="#e0f2fe" stroke-width="5"/>
      <line x1="18" y1="64" x2="110" y2="64" stroke="#e0f2fe" stroke-width="5"/>
    </svg>
  `)
};

// Resolver for standard base icons
function resolveAppIcon(id, sc = null) {
  const normId = (id || '').toLowerCase();
  const cmd = (sc?.cmd || '').toLowerCase();
  const name = (sc?.name || '').toLowerCase();
  const type = (sc?.type || '').toLowerCase();

  if (normId === 'contest' || name.includes('контест') || name.includes('яндекс')) {
    return BASE_ICONS.contest;
  }
  if (normId === 'editor' || name.includes('редактор')) {
    return BASE_ICONS.editor;
  }
  if (normId === 'files' || name.includes('файл') || name.includes('проводник')) {
    return BASE_ICONS.files;
  }
  if (normId === 'calc' || cmd.includes('calc') || name.includes('калькулятор')) {
    return BASE_ICONS.calc;
  }
  if (normId === 'python' || normId === 'idle' || cmd.includes('python') || name.includes('idle') || name.includes('python')) {
    return BASE_ICONS.python;
  }
  if (normId === 'vscode' || cmd.includes('code') || name.includes('visual studio code') || name.includes('vs code')) {
    return BASE_ICONS.vscode;
  }
  if (normId === 'pycharm' || cmd.includes('pycharm') || name.includes('pycharm')) {
    return BASE_ICONS.pycharm;
  }
  if (normId === 'pascal' || cmd.includes('pascal') || name.includes('pascal')) {
    return BASE_ICONS.pascal;
  }
  if (normId === 'codeblocks' || cmd.includes('codeblocks') || name.includes('c++') || name.includes('code::blocks')) {
    return BASE_ICONS.codeblocks;
  }
  if (normId === 'notepad' || cmd.includes('notepad') || name.includes('блокнот')) {
    return BASE_ICONS.notepad;
  }
  if (type === 'browser' || type === 'url' || sc?.url) {
    return BASE_ICONS.genericWeb;
  }
  return BASE_ICONS.editor;
}

// ==========================================================================
// WINDOW MANAGER (MACOS STYLE)
// ==========================================================================

const WINDOWS_MAP = {
  browser: winBrowser,
  editor: winEditor,
  files: winFiles,
  calc: winCalc
};

function bringToFront(win) {
  if (!win) return;
  activeTopZ++;
  win.style.zIndex = activeTopZ;
  document.querySelectorAll('.mac-window').forEach(w => w.classList.remove('active'));
  win.classList.add('active');
}

function openWindow(key, data = null) {
  const win = WINDOWS_MAP[key];
  if (!win) return;

  win.style.display = 'flex';
  win.classList.remove('minimized');
  bringToFront(win);
  openWindows.add(key);
  renderDock();

  if (key === 'browser') {
    const url = data?.url || currentConfig.contestUrl || 'https://contest.yandex.ru';
    browserWinTitle.textContent = 'Яндекс Контест — Безопасный браузер';
    wvCurrentDomain.textContent = url;
    if (desktopBrowserWv.getAttribute('src') !== url) {
      desktopBrowserWv.setAttribute('src', url);
    }
  } else if (key === 'editor') {
    if (data && data.filename) {
      loadFileIntoEditor(data.filename, data.content);
    } else {
      loadDefaultEditorFile();
    }
  } else if (key === 'files') {
    loadFilesWindow();
  }
}

function closeWindow(key) {
  const win = WINDOWS_MAP[key];
  if (!win) return;
  win.style.display = 'none';
  openWindows.delete(key);
  renderDock();
}

function minimizeWindow(key) {
  const win = WINDOWS_MAP[key];
  if (!win) return;
  win.classList.add('minimized');
  renderDock();
}

function toggleMaximizeWindow(key) {
  const win = WINDOWS_MAP[key];
  if (!win) return;
  win.classList.toggle('maximized');
  bringToFront(win);
}

// Window Dragging & Resizing
function initDraggable(win, header) {
  let isDragging = false;
  let startX = 0, startY = 0;
  let initialLeft = 0, initialTop = 0;

  header.addEventListener('mousedown', (e) => {
    if (e.target.closest('.mac-window-controls')) return;
    if (win.classList.contains('maximized')) return;

    bringToFront(win);
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    initialLeft = win.offsetLeft;
    initialTop = win.offsetTop;
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    const newLeft = Math.max(0, Math.min(window.innerWidth - win.offsetWidth, initialLeft + dx));
    const newTop = Math.max(32, Math.min(window.innerHeight - 80, initialTop + dy));

    win.style.left = `${newLeft}px`;
    win.style.top = `${newTop}px`;
  });

  window.addEventListener('mouseup', () => {
    isDragging = false;
  });

  win.addEventListener('mousedown', () => {
    bringToFront(win);
  });
}

function initResizable(win) {
  const handle = win.querySelector('.mac-resize-handle');
  if (!handle) return;

  let isResizing = false;
  let startX = 0, startY = 0;
  let startW = 0, startH = 0;

  handle.addEventListener('mousedown', (e) => {
    if (win.classList.contains('maximized')) return;
    bringToFront(win);
    isResizing = true;
    startX = e.clientX;
    startY = e.clientY;
    startW = win.offsetWidth;
    startH = win.offsetHeight;
    e.preventDefault();
    e.stopPropagation();
  });

  window.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    const newW = Math.max(340, startW + (e.clientX - startX));
    const newH = Math.max(220, startH + (e.clientY - startY));
    win.style.width = `${newW}px`;
    win.style.height = `${newH}px`;
  });

  window.addEventListener('mouseup', () => {
    isResizing = false;
  });
}

[winBrowser, winEditor, winFiles, winCalc].forEach(win => {
  if (win) {
    const header = win.querySelector('.mac-window-header');
    if (header) initDraggable(win, header);
    initResizable(win);
  }
});

// Update Dock Running Dots
function updateDockRunningStatus() {
  document.querySelectorAll('#dockNavList .nav-item').forEach(item => {
    const appKey = item.getAttribute('data-app');
    if (openWindows.has(appKey)) {
      item.classList.add('running');
    } else {
      item.classList.remove('running');
    }
  });
}

// ==========================================================================
// SAFE BROWSER WINDOW INTEGRATION
// ==========================================================================

desktopBrowserWv.addEventListener('dom-ready', () => {
  try {
    const parsed = new URL(desktopBrowserWv.getURL());
    wvCurrentDomain.textContent = parsed.hostname;
  } catch (_) {}
  desktopBrowserWv.executeJavaScript(`
    window.addEventListener('contextmenu', e => e.preventDefault(), true);
  `);
});

desktopBrowserWv.addEventListener('did-navigate', (e) => {
  try {
    const parsed = new URL(e.url);
    wvCurrentDomain.textContent = parsed.hostname;
  } catch (_) {}
});

desktopBrowserWv.addEventListener('will-navigate', (e) => {
  try {
    const parsed = new URL(e.url);
    const host = parsed.hostname.toLowerCase();
    const isAllowed = host.includes('yandex') || host.includes('codeforces') || host.includes('informatics') || host.includes('acmp') || host.includes('ejudge');
    if (!isAllowed) {
      e.preventDefault();
      alert(`Переход на сторонний ресурс запрещен регламентом (${host})`);
    }
  } catch (_) {}
});

wvBtnBack.addEventListener('click', () => { if (desktopBrowserWv.canGoBack()) desktopBrowserWv.goBack(); });
wvBtnForward.addEventListener('click', () => { if (desktopBrowserWv.canGoForward()) desktopBrowserWv.goForward(); });
wvBtnReload.addEventListener('click', () => { desktopBrowserWv.reload(); });
wvBtnHome.addEventListener('click', () => {
  desktopBrowserWv.setAttribute('src', currentConfig.contestUrl || 'https://contest.yandex.ru');
});

// ==========================================================================
// CODE & TEXT EDITOR
// ==========================================================================

function updateLineNumbers() {
  const lines = editorTextarea.value.split('\n').length;
  let nums = '';
  for (let i = 1; i <= Math.max(lines, 1); i++) {
    nums += i + '\n';
  }
  editorLineNumbers.textContent = nums;
}

editorTextarea.addEventListener('input', () => {
  updateLineNumbers();
  editorSaveStatus.textContent = 'Не сохранено*';
  editorSaveStatus.style.color = '#f59e0b';
});

editorTextarea.addEventListener('scroll', () => {
  editorLineNumbers.scrollTop = editorTextarea.scrollTop;
});

async function loadFileIntoEditor(filename, content = null) {
  currentEditorFile = filename;
  editorCurrentFilename.textContent = filename;
  const ext = filename.split('.').pop().toLowerCase();

  if (ext === 'py') editorLangBadge.textContent = 'Python';
  else if (ext === 'cpp' || ext === 'c') editorLangBadge.textContent = 'C++';
  else if (ext === 'pas') editorLangBadge.textContent = 'Pascal';
  else editorLangBadge.textContent = 'Текст';

  if (content !== null) {
    editorTextarea.value = content;
    updateLineNumbers();
    editorSaveStatus.textContent = 'Сохранено';
    editorSaveStatus.style.color = '#10b981';
  } else {
    const res = await ipcRenderer.invoke('fs:read-file', filename);
    if (res.success) {
      editorTextarea.value = res.content;
      updateLineNumbers();
      editorSaveStatus.textContent = 'Сохранено';
      editorSaveStatus.style.color = '#10b981';
    } else {
      editorTextarea.value = '';
      updateLineNumbers();
    }
  }
}

async function loadDefaultEditorFile() {
  await loadFileIntoEditor('solution.py');
}

async function saveCurrentEditorFile() {
  const content = editorTextarea.value;
  const res = await ipcRenderer.invoke('fs:save-file', {
    filename: currentEditorFile,
    content
  });
  if (res.success) {
    editorSaveStatus.textContent = 'Сохранено ✓';
    editorSaveStatus.style.color = '#10b981';
    refreshDesktopFiles();
  } else {
    alert('Ошибка при сохранении: ' + res.message);
  }
}

btnEditorSave.addEventListener('click', saveCurrentEditorFile);
btnEditorClear.addEventListener('click', () => {
  if (confirm('Очистить содержимое редактора?')) {
    editorTextarea.value = '';
    updateLineNumbers();
    editorSaveStatus.textContent = 'Не сохранено*';
    editorSaveStatus.style.color = '#f59e0b';
  }
});

window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'ы' || e.key === 'S' || e.key === 'Ы')) {
    if (winEditor.style.display !== 'none') {
      e.preventDefault();
      saveCurrentEditorFile();
    }
  }
});

// ==========================================================================
// FILES EXPLORER WINDOW
// ==========================================================================

async function loadFilesWindow() {
  const files = await ipcRenderer.invoke('fs:list');
  filesWindowGrid.innerHTML = files.map(f => {
    const icon = f.isDirectory ? '📁' : getFileEmoji(f.ext);
    const sizeStr = f.isDirectory ? 'Папка' : formatBytes(f.size);

    return `
      <div class="file-box" onclick="handleFileBoxClick('${f.name}', ${f.isDirectory})">
        <div class="file-box-icon" style="font-size:32px;">${icon}</div>
        <div class="file-box-name" title="${f.name}">${f.name}</div>
        <div class="file-box-size">${sizeStr}</div>
      </div>
    `;
  }).join('');
}

window.handleFileBoxClick = async function(name, isDir) {
  if (isDir) {
    // Open folder
  } else {
    const res = await ipcRenderer.invoke('fs:read-file', name);
    if (res.success) {
      openWindow('editor', { filename: name, content: res.content });
    }
  }
};

btnFilesNewFile.addEventListener('click', () => createDesktopItem('python'));
btnFilesNewFolder.addEventListener('click', () => createDesktopItem('folder'));
btnFilesRefresh.addEventListener('click', () => {
  loadFilesWindow();
  refreshDesktopFiles();
});

// ==========================================================================
// CALCULATOR WINDOW
// ==========================================================================

let calcCurrent = '0';
let calcOp = null;
let calcPrev = null;
let calcResetOnNext = false;

window.calcInput = function(val) {
  const display = document.getElementById('calcDisplay');
  if (val === 'C') {
    calcCurrent = '0';
    calcOp = null;
    calcPrev = null;
    calcResetOnNext = false;
  } else if (val === '±') {
    calcCurrent = (parseFloat(calcCurrent) * -1).toString();
  } else if (val === '%') {
    calcCurrent = (parseFloat(calcCurrent) / 100).toString();
  } else if (['+', '-', '*', '/'].includes(val)) {
    calcPrev = parseFloat(calcCurrent);
    calcOp = val;
    calcResetOnNext = true;
  } else if (val === '=') {
    if (calcOp && calcPrev !== null) {
      const cur = parseFloat(calcCurrent);
      let res = 0;
      if (calcOp === '+') res = calcPrev + cur;
      if (calcOp === '-') res = calcPrev - cur;
      if (calcOp === '*') res = calcPrev * cur;
      if (calcOp === '/') res = cur !== 0 ? calcPrev / cur : 0;
      calcCurrent = res.toString();
      calcOp = null;
      calcPrev = null;
      calcResetOnNext = true;
    }
  } else if (val === '.') {
    if (!calcCurrent.includes('.')) calcCurrent += '.';
  } else {
    if (calcCurrent === '0' || calcResetOnNext) {
      calcCurrent = val;
      calcResetOnNext = false;
    } else {
      calcCurrent += val;
    }
  }
  display.textContent = calcCurrent;
};

// ==========================================================================
// REAL DESKTOP SURFACE & FILE WORKSPACE
// ==========================================================================

function getFileEmoji(ext) {
  if (ext === '.py') return '🐍';
  if (ext === '.cpp' || ext === '.c') return '⚡';
  if (ext === '.pas') return '📘';
  if (ext === '.txt' || ext === '.md') return '📄';
  return '📦';
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  return (bytes / 1024).toFixed(1) + ' KB';
}

async function refreshDesktopFiles() {
  desktopFiles = await ipcRenderer.invoke('fs:list');
  renderDesktopIcons();
  if (winFiles.style.display !== 'none') {
    loadFilesWindow();
  }
}

// Built-in system applications on desktop
const BUILTIN_DESKTOP_APPS = [
  { id: 'browser', name: 'Яндекс Контест', iconKey: 'contest', type: 'builtin' },
  { id: 'editor', name: 'Редактор кода', iconKey: 'editor', type: 'builtin' },
  { id: 'files', name: 'Мои файлы', iconKey: 'files', type: 'builtin' },
  { id: 'calc', name: 'Калькулятор', iconKey: 'calc', type: 'builtin' }
];

function renderDesktopIcons() {
  const items = [];

  // 1. Built-in system programs (Standard base icons)
  BUILTIN_DESKTOP_APPS.forEach(app => {
    items.push({
      id: app.id,
      name: app.name,
      icon: BASE_ICONS[app.iconKey],
      isApp: true,
      appType: 'builtin'
    });
  });

  // 2. Teacher configured shortcuts (PyCharm, VS Code, Python IDLE, Pascal, etc.)
  (currentConfig.shortcuts || []).forEach(sc => {
    if (sc.id === 'contest') return; // Handled by built-in browser
    items.push({
      id: sc.id,
      name: sc.name,
      icon: resolveAppIcon(sc.id, sc),
      isApp: true,
      appType: 'shortcut',
      shortcut: sc
    });
  });

  // 3. Workspace files & folders created by the student
  (desktopFiles || []).forEach(f => {
    items.push({
      id: f.name,
      name: f.name,
      isApp: false,
      isDirectory: f.isDirectory,
      ext: f.ext,
      fileData: f
    });
  });

  desktopIcons.innerHTML = items.map(item => {
    const isSelected = selectedItemId === item.id ? 'selected' : '';
    let iconContent = '';

    if (item.isApp) {
      iconContent = `<img src="${item.icon}" class="desktop-app-img" alt="${escapeHtml(item.name)}">`;
    } else if (item.isDirectory) {
      iconContent = `<span style="font-size:36px;">📁</span>`;
    } else {
      iconContent = `<span style="font-size:36px;">${getFileEmoji(item.ext)}</span>`;
    }

    return `
      <div class="desktop-item ${isSelected}" data-id="${item.id}" data-isapp="${item.isApp}" data-apptype="${item.appType || ''}" data-isdir="${item.isDirectory || false}">
        <div class="desktop-icon-img">${iconContent}</div>
        <div class="desktop-item-name">${escapeHtml(item.name)}</div>
      </div>
    `;
  }).join('');

  // Attach event handlers
  desktopIcons.querySelectorAll('.desktop-item').forEach(item => {
    const id = item.getAttribute('data-id');
    const isApp = item.getAttribute('data-isapp') === 'true';
    const appType = item.getAttribute('data-apptype');
    const isDir = item.getAttribute('data-isdir') === 'true';

    item.addEventListener('click', (e) => {
      e.stopPropagation();
      selectedItemId = id;
      desktopIcons.querySelectorAll('.desktop-item').forEach(it => it.classList.remove('selected'));
      item.classList.add('selected');
    });

    item.addEventListener('dblclick', async (e) => {
      e.stopPropagation();
      if (isApp) {
        if (appType === 'builtin') {
          openWindow(id);
        } else if (appType === 'shortcut') {
          handleShortcutClick(id);
        }
      } else {
        if (isDir) {
          openWindow('files');
        } else {
          const res = await ipcRenderer.invoke('fs:read-file', id);
          if (res.success) {
            openWindow('editor', { filename: id, content: res.content });
          }
        }
      }
    });

    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (isApp) {
        itemCtxTarget = { name: id, isApp: true, appType, isDir: false };
        openAppContextMenu(e.clientX, e.clientY);
      } else {
        itemCtxTarget = { name: id, isApp: false, isDir };
        openItemContextMenu(e.clientX, e.clientY);
      }
    });
  });
}

// Right Click Context Menus
desktopSurface.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  closeContextMenus();
  desktopContextMenu.style.left = `${Math.min(window.innerWidth - 220, e.clientX)}px`;
  desktopContextMenu.style.top = `${Math.min(window.innerHeight - 240, e.clientY)}px`;
  desktopContextMenu.style.display = 'block';
});

function openAppContextMenu(x, y) {
  closeContextMenus();
  itemContextMenu.style.left = `${Math.min(window.innerWidth - 180, x)}px`;
  itemContextMenu.style.top = `${Math.min(window.innerHeight - 150, y)}px`;
  document.getElementById('itemCtxRename').style.display = 'none';
  document.getElementById('itemCtxDelete').style.display = 'none';
  itemContextMenu.style.display = 'block';
}

function openItemContextMenu(x, y) {
  closeContextMenus();
  itemContextMenu.style.left = `${Math.min(window.innerWidth - 180, x)}px`;
  itemContextMenu.style.top = `${Math.min(window.innerHeight - 150, y)}px`;
  document.getElementById('itemCtxRename').style.display = 'flex';
  document.getElementById('itemCtxDelete').style.display = 'flex';
  itemContextMenu.style.display = 'block';
}

function closeContextMenus() {
  desktopContextMenu.style.display = 'none';
  itemContextMenu.style.display = 'none';
}

window.addEventListener('click', () => {
  closeContextMenus();
  selectedItemId = null;
  desktopIcons.querySelectorAll('.desktop-item').forEach(it => it.classList.remove('selected'));
});

// Universal In-App Prompt Dialog
function showPrompt(title, defaultValue = '', subText = '') {
  return new Promise((resolve) => {
    const modal = document.getElementById('promptModal');
    const titleEl = document.getElementById('promptModalTitle');
    const subEl = document.getElementById('promptModalSub');
    const inputEl = document.getElementById('promptModalInput');
    const btnCancel = document.getElementById('btnCancelPrompt');
    const btnConfirm = document.getElementById('btnConfirmPrompt');

    titleEl.textContent = title || 'Ввод данных';
    subEl.textContent = subText || 'Введите значение:';
    subEl.style.display = subText ? 'block' : 'none';
    inputEl.value = defaultValue || '';

    modal.classList.add('active');
    modal.style.display = 'flex';
    setTimeout(() => {
      inputEl.focus();
      inputEl.select();
    }, 50);

    function cleanup() {
      modal.classList.remove('active');
      modal.style.display = 'none';
      btnCancel.onclick = null;
      btnConfirm.onclick = null;
      inputEl.onkeydown = null;
    }

    btnCancel.onclick = () => {
      cleanup();
      resolve(null);
    };

    btnConfirm.onclick = () => {
      const val = inputEl.value.trim();
      cleanup();
      resolve(val);
    };

    inputEl.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        btnConfirm.click();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        btnCancel.click();
      }
    };
  });
}

// Universal In-App Confirm Dialog
function showConfirm(title, message = '') {
  return new Promise((resolve) => {
    const modal = document.getElementById('confirmModal');
    const titleEl = document.getElementById('confirmModalTitle');
    const subEl = document.getElementById('confirmModalSub');
    const btnCancel = document.getElementById('btnCancelConfirm');
    const btnOk = document.getElementById('btnOkConfirm');

    titleEl.textContent = title || 'Подтверждение';
    subEl.textContent = message || 'Вы уверены?';

    modal.classList.add('active');
    modal.style.display = 'flex';
    setTimeout(() => btnOk.focus(), 50);

    function cleanup() {
      modal.classList.remove('active');
      modal.style.display = 'none';
      btnCancel.onclick = null;
      btnOk.onclick = null;
      window.removeEventListener('keydown', handleKey);
    }

    function handleKey(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        btnOk.click();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        btnCancel.click();
      }
    }

    window.addEventListener('keydown', handleKey);

    btnCancel.onclick = () => {
      cleanup();
      resolve(false);
    };

    btnOk.onclick = () => {
      cleanup();
      resolve(true);
    };
  });
}

// Global overrides for prompt and confirm
window.prompt = function(message, defaultValue) {
  return showPrompt('Ввод данных', defaultValue || '', message || '');
};
window.confirm = function(message) {
  return showConfirm('Подтверждение', message || '');
};

// Item Context Actions
document.getElementById('itemCtxOpen').addEventListener('click', async () => {
  if (!itemCtxTarget) return;
  if (itemCtxTarget.isApp) {
    if (itemCtxTarget.appType === 'builtin') {
      openWindow(itemCtxTarget.name);
    } else {
      handleShortcutClick(itemCtxTarget.name);
    }
  } else if (itemCtxTarget.isDir) {
    openWindow('files');
  } else {
    const res = await ipcRenderer.invoke('fs:read-file', itemCtxTarget.name);
    if (res.success) {
      openWindow('editor', { filename: itemCtxTarget.name, content: res.content });
    }
  }
  closeContextMenus();
});

document.getElementById('itemCtxRename').addEventListener('click', async () => {
  if (!itemCtxTarget || itemCtxTarget.isApp) return;
  const oldName = itemCtxTarget.name;
  closeContextMenus();
  const newName = await showPrompt('Переименование', oldName, 'Введите новое имя файла или папки:');
  if (newName && newName !== oldName) {
    await ipcRenderer.invoke('fs:rename', { oldName, newName });
    await refreshDesktopFiles();
  }
});

document.getElementById('itemCtxDelete').addEventListener('click', async () => {
  if (!itemCtxTarget || itemCtxTarget.isApp) return;
  const name = itemCtxTarget.name;
  closeContextMenus();
  const ok = await showConfirm('Удаление', `Удалить "${name}" безвозвратно?`);
  if (ok) {
    await ipcRenderer.invoke('fs:delete', name);
    await refreshDesktopFiles();
  }
});

// Create Desktop Items with In-App Prompt
window.createDesktopItem = async function(type) {
  closeContextMenus();
  let defaultName = 'solution.py';
  let defaultContent = '# Решение задачи\n';
  let title = 'Новый файл Python';

  if (type === 'python') {
    defaultName = 'solution.py';
    defaultContent = '# Решение олимпиадной задачи на Python\nimport sys\n\ndef solve():\n    pass\n\nif __name__ == "__main__":\n    solve()\n';
    title = 'Новый файл Python (.py)';
  } else if (type === 'cpp') {
    defaultName = 'task.cpp';
    defaultContent = '#include <iostream>\nusing namespace std;\n\nint main() {\n    ios_base::sync_with_stdio(false);\n    cin.tie(NULL);\n    cout << "Ready!" << endl;\n    return 0;\n}\n';
    title = 'Новый файл C++ (.cpp)';
  } else if (type === 'pascal') {
    defaultName = 'task.pas';
    defaultContent = 'program Olympiad;\nbegin\n    writeln(\'Решение\');\nend.\n';
    title = 'Новый файл Pascal (.pas)';
  } else if (type === 'text') {
    defaultName = 'notes.txt';
    defaultContent = 'Заметки решения:\n';
    title = 'Новый текстовый файл (.txt)';
  } else if (type === 'folder') {
    const folderName = await showPrompt('Новая папка', 'Новая папка', 'Введите имя новой папки:');
    if (!folderName) return;
    await ipcRenderer.invoke('fs:create-folder', folderName);
    await refreshDesktopFiles();
    return;
  }

  const filename = await showPrompt(title, defaultName, 'Введите имя файла:');
  if (!filename) return;

  await ipcRenderer.invoke('fs:create-file', { filename, content: defaultContent });
  await refreshDesktopFiles();
  openWindow('editor', { filename, content: defaultContent });
};

// ==========================================================================
// MACOS DOCK: ONLY SHOW RUNNING / OPENED PROGRAMS
// ==========================================================================

function renderDock() {
  const runningItems = [];

  // 1. Open built-in windows
  if (openWindows.has('browser')) {
    runningItems.push({ key: 'browser', name: 'Яндекс Контест', icon: BASE_ICONS.contest });
  }
  if (openWindows.has('editor')) {
    runningItems.push({ key: 'editor', name: 'Редактор кода', icon: BASE_ICONS.editor });
  }
  if (openWindows.has('files')) {
    runningItems.push({ key: 'files', name: 'Мои файлы', icon: BASE_ICONS.files });
  }
  if (openWindows.has('calc')) {
    runningItems.push({ key: 'calc', name: 'Калькулятор', icon: BASE_ICONS.calc });
  }

  // 2. Running external shortcuts
  for (const [scId, sc] of runningExternalApps.entries()) {
    runningItems.push({
      key: scId,
      name: sc.name,
      icon: resolveAppIcon(scId, sc),
      isExternal: true
    });
  }

  const dockerEl = document.querySelector('.docker');
  if (runningItems.length === 0) {
    dockNavList.innerHTML = '';
    if (dockerEl) dockerEl.classList.add('empty');
    return;
  }

  if (dockerEl) dockerEl.classList.remove('empty');

  dockNavList.innerHTML = runningItems.map(app => {
    return `
      <li class="nav-item running" data-app="${app.key}">
        <a href="#" class="nav-item__link" onclick="handleDockItemClick('${app.key}')" oncontextmenu="handleDockItemContextMenu(event, '${app.key}')">
          <img src="${app.icon}" loading="eager" alt="${escapeHtml(app.name)}" class="image">
          <div class="dock-running-dot"></div>
        </a>
        <div class="nav-item__tooltip">
          <div>${escapeHtml(app.name)}</div>
        </div>
      </li>
    `;
  }).join('');
}

window.handleDockItemContextMenu = function(e, appKey) {
  e.preventDefault();
  e.stopPropagation();
  if (WINDOWS_MAP[appKey]) {
    closeWindow(appKey);
  } else if (runningExternalApps.has(appKey)) {
    runningExternalApps.delete(appKey);
    renderDock();
  }
};

window.handleDockItemClick = function(appKey) {
  const win = WINDOWS_MAP[appKey];
  if (win) {
    if (win.style.display === 'none') {
      openWindow(appKey);
    } else if (win.classList.contains('minimized')) {
      win.classList.remove('minimized');
      bringToFront(win);
    } else if (win.classList.contains('active')) {
      minimizeWindow(appKey);
    } else {
      bringToFront(win);
    }
    return;
  }

  // External app
  if (runningExternalApps.has(appKey)) {
    ipcRenderer.invoke('launch-app', appKey);
  }
};

window.handleShortcutClick = async function(scId) {
  const sc = (currentConfig.shortcuts || []).find(s => s.id === scId);
  if (!sc) return;

  if (sc.type === 'browser' || sc.type === 'url' || sc.url) {
    openWindow('browser', { url: sc.url });
    return;
  }

  // Add to running in dock
  runningExternalApps.set(scId, sc);
  renderDock();

  // Launch external program
  const res = await ipcRenderer.invoke('launch-app', scId);
  if (!res.success && res.message) {
    runningExternalApps.delete(scId);
    renderDock();
    await showConfirm('Ошибка запуска', res.message);
  }
};

function escapeHtml(text) {
  if (!text) return '';
  return text.toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ==========================================================================
// IPC HANDLERS & NOTIFICATIONS
// ==========================================================================

ipcRenderer.on('config-update', (event, config) => {
  currentConfig = { ...currentConfig, ...config };
  renderDesktopIcons();
  renderDock();
});

ipcRenderer.on('exam-update', (event, exam) => {
  if (exam.status === 'running') {
    timerDigits.textContent = formatTime(exam.remainingSeconds);
    timerLabel.textContent = 'Идет тур';
    timerDot.classList.add('active');
    screenLockerOverlay.classList.remove('active');
  } else if (exam.status === 'paused') {
    timerLabel.textContent = 'Пауза';
    timerDot.classList.remove('active');
  } else {
    timerDigits.textContent = '--:--:--';
    timerLabel.textContent = 'Ожидание';
    timerDot.classList.remove('active');
  }
});

ipcRenderer.on('exam-tick', (event, tick) => {
  timerDigits.textContent = formatTime(tick.remainingSeconds);
  if (tick.status === 'running') {
    timerLabel.textContent = 'Идет тур';
    timerDot.classList.add('active');
  }
});

ipcRenderer.on('exam-ended', () => {
  timerLabel.textContent = 'Завершен';
  timerDot.classList.remove('active');
  lockerReason.textContent = 'Время тура олимпиады истекло.';
  screenLockerOverlay.classList.add('active');
});

ipcRenderer.on('client-locked', (event, data) => {
  lockerReason.textContent = data?.reason || 'Ожидайте указаний преподавателя.';
  screenLockerOverlay.classList.add('active');
});

ipcRenderer.on('client-unlocked', () => {
  screenLockerOverlay.classList.remove('active');
});

ipcRenderer.on('broadcast-message', (event, text) => {
  broadcastText.textContent = text;
  broadcastBanner.classList.add('active');
  setTimeout(() => broadcastBanner.classList.remove('active'), 12000);
});

btnCloseBanner.addEventListener('click', () => {
  broadcastBanner.classList.remove('active');
});

// Secret Master Unlock Dialog (Ctrl + Alt + Shift + L)
function openSecretUnlock() {
  unlockPasswordInput.value = '';
  unlockError.style.display = 'none';
  unlockModal.classList.add('active');
  unlockPasswordInput.focus();
}

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.altKey && e.shiftKey && (e.key === 'L' || e.key === 'l' || e.key === 'д' || e.key === 'Д')) {
    e.preventDefault();
    openSecretUnlock();
  }
});

btnCancelUnlock.addEventListener('click', () => {
  unlockModal.classList.remove('active');
});

btnConfirmUnlock.addEventListener('click', async () => {
  const pwd = unlockPasswordInput.value;
  const res = await ipcRenderer.invoke('verify-unlock', pwd);
  if (res.success) {
    unlockModal.classList.remove('active');
  } else {
    unlockError.style.display = 'block';
  }
});

unlockPasswordInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') btnConfirmUnlock.click();
  if (e.key === 'Escape') btnCancelUnlock.click();
});

// Initialization
ipcRenderer.invoke('get-config').then(cfg => {
  if (cfg) {
    currentConfig = { ...currentConfig, ...cfg };
    renderDesktopIcons();
    renderDock();
  }
});

refreshDesktopFiles();

// Open Contest Browser by default on start
setTimeout(() => {
  openWindow('browser');
}, 400);
