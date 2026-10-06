const { ipcRenderer } = require('electron');

// State
let currentConfig = { contestUrl: 'https://contest.yandex.ru', shortcuts: [] };
let activeTopZ = 200;
let openWindows = new Set();
let desktopFiles = [];
let currentEditorFile = 'solution.py';
let selectedItemName = null;

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
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svgContent);
}

const DOCK_ICONS = {
  contest: makeSvgDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
      <defs>
        <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#f59e0b"/>
          <stop offset="100%" stop-color="#b45309"/>
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill="url(#g1)"/>
      <path d="M20 20 h24 v10 a12 12 0 0 1 -24 0 Z" fill="#ffffff" opacity="0.95"/>
      <path d="M16 22 h4 v6 a6 6 0 0 1 -4 -6 Z" fill="#ffffff" opacity="0.7"/>
      <path d="M48 22 h-4 v6 a6 6 0 0 0 4 -6 Z" fill="#ffffff" opacity="0.7"/>
      <rect x="29" y="38" width="6" height="10" fill="#ffffff"/>
      <rect x="22" y="48" width="20" height="4" rx="2" fill="#ffffff"/>
    </svg>
  `),
  editor: makeSvgDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
      <defs>
        <linearGradient id="g2" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#0284c7"/>
          <stop offset="100%" stop-color="#0369a1"/>
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill="url(#g2)"/>
      <path d="M26 24 l-8 8 l8 8" stroke="#ffffff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      <path d="M38 24 l8 8 l-8 8" stroke="#ffffff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      <line x1="34" y1="20" x2="30" y2="44" stroke="#7dd3fc" stroke-width="3" stroke-linecap="round"/>
    </svg>
  `),
  files: makeSvgDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
      <defs>
        <linearGradient id="g3" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#3b82f6"/>
          <stop offset="100%" stop-color="#1d4ed8"/>
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill="url(#g3)"/>
      <path d="M16 22 h12 l4 4 h16 a4 4 0 0 1 4 4 v18 a4 4 0 0 1 -4 4 h-32 a4 4 0 0 1 -4 -4 Z" fill="#ffffff" opacity="0.95"/>
    </svg>
  `),
  calc: makeSvgDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
      <defs>
        <linearGradient id="g4" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#475569"/>
          <stop offset="100%" stop-color="#1e293b"/>
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill="url(#g4)"/>
      <rect x="18" y="16" width="28" height="10" rx="3" fill="#f8fafc"/>
      <circle cx="23" cy="34" r="3.5" fill="#94a3b8"/>
      <circle cx="32" cy="34" r="3.5" fill="#94a3b8"/>
      <circle cx="41" cy="34" r="3.5" fill="#f59e0b"/>
      <circle cx="23" cy="44" r="3.5" fill="#94a3b8"/>
      <circle cx="32" cy="44" r="3.5" fill="#94a3b8"/>
      <circle cx="41" cy="44" r="3.5" fill="#f59e0b"/>
    </svg>
  `),
  appGeneric: makeSvgDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
      <defs>
        <linearGradient id="g5" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#6366f1"/>
          <stop offset="100%" stop-color="#4338ca"/>
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill="url(#g5)"/>
      <rect x="22" y="22" width="20" height="20" rx="4" fill="#ffffff" opacity="0.9"/>
    </svg>
  `)
};

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
  updateDockRunningStatus();

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
  updateDockRunningStatus();
}

function minimizeWindow(key) {
  const win = WINDOWS_MAP[key];
  if (!win) return;
  win.classList.add('minimized');
  // Keeps openWindows so dock shows running dot
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

function renderDesktopIcons() {
  desktopIcons.innerHTML = desktopFiles.map(f => {
    const isSelected = selectedItemName === f.name ? 'selected' : '';
    const iconContent = f.isDirectory 
      ? `<span style="font-size:36px;">📁</span>`
      : `<span style="font-size:36px;">${getFileEmoji(f.ext)}</span>`;

    return `
      <div class="desktop-item ${isSelected}" data-name="${f.name}" data-isdir="${f.isDirectory}">
        <div class="desktop-icon-img">${iconContent}</div>
        <div class="desktop-item-name">${escapeHtml(f.name)}</div>
      </div>
    `;
  }).join('');

  // Attach event handlers
  desktopIcons.querySelectorAll('.desktop-item').forEach(item => {
    const name = item.getAttribute('data-name');
    const isDir = item.getAttribute('data-isdir') === 'true';

    item.addEventListener('click', (e) => {
      e.stopPropagation();
      selectedItemName = name;
      desktopIcons.querySelectorAll('.desktop-item').forEach(it => it.classList.remove('selected'));
      item.classList.add('selected');
    });

    item.addEventListener('dblclick', async (e) => {
      e.stopPropagation();
      if (isDir) {
        openWindow('files');
      } else {
        const res = await ipcRenderer.invoke('fs:read-file', name);
        if (res.success) {
          openWindow('editor', { filename: name, content: res.content });
        }
      }
    });

    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      itemCtxTarget = { name, isDir };
      openItemContextMenu(e.clientX, e.clientY);
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

function openItemContextMenu(x, y) {
  closeContextMenus();
  itemContextMenu.style.left = `${Math.min(window.innerWidth - 180, x)}px`;
  itemContextMenu.style.top = `${Math.min(window.innerHeight - 150, y)}px`;
  itemContextMenu.style.display = 'block';
}

function closeContextMenus() {
  desktopContextMenu.style.display = 'none';
  itemContextMenu.style.display = 'none';
}

window.addEventListener('click', () => {
  closeContextMenus();
  selectedItemName = null;
  desktopIcons.querySelectorAll('.desktop-item').forEach(it => it.classList.remove('selected'));
});

// Item Context Actions
document.getElementById('itemCtxOpen').addEventListener('click', async () => {
  if (!itemCtxTarget) return;
  if (itemCtxTarget.isDir) {
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
  if (!itemCtxTarget) return;
  const newName = prompt('Введите новое имя:', itemCtxTarget.name);
  if (newName && newName !== itemCtxTarget.name) {
    await ipcRenderer.invoke('fs:rename', { oldName: itemCtxTarget.name, newName });
    refreshDesktopFiles();
  }
  closeContextMenus();
});

document.getElementById('itemCtxDelete').addEventListener('click', async () => {
  if (!itemCtxTarget) return;
  if (confirm(`Удалить "${itemCtxTarget.name}"?`)) {
    await ipcRenderer.invoke('fs:delete', itemCtxTarget.name);
    refreshDesktopFiles();
  }
  closeContextMenus();
});

// Create Desktop Items
window.createDesktopItem = async function(type) {
  closeContextMenus();
  if (type === 'python') {
    const num = Math.floor(Math.random() * 900) + 100;
    const name = `solution_${num}.py`;
    const template = '# Решение олимпиадной задачи на Python\nimport sys\n\ndef solve():\n    pass\n\nif __name__ == "__main__":\n    solve()\n';
    await ipcRenderer.invoke('fs:create-file', { filename: name, content: template });
    await refreshDesktopFiles();
    openWindow('editor', { filename: name, content: template });
  } else if (type === 'cpp') {
    const num = Math.floor(Math.random() * 900) + 100;
    const name = `task_${num}.cpp`;
    const template = '#include <iostream>\nusing namespace std;\n\nint main() {\n    ios_base::sync_with_stdio(false);\n    cin.tie(NULL);\n    cout << "Ready!" << endl;\n    return 0;\n}\n';
    await ipcRenderer.invoke('fs:create-file', { filename: name, content: template });
    await refreshDesktopFiles();
    openWindow('editor', { filename: name, content: template });
  } else if (type === 'pascal') {
    const num = Math.floor(Math.random() * 900) + 100;
    const name = `task_${num}.pas`;
    const template = 'program Olympiad;\nbegin\n    writeln(\'Решение\');\nend.\n';
    await ipcRenderer.invoke('fs:create-file', { filename: name, content: template });
    await refreshDesktopFiles();
    openWindow('editor', { filename: name, content: template });
  } else if (type === 'text') {
    const num = Math.floor(Math.random() * 900) + 100;
    const name = `notes_${num}.txt`;
    await ipcRenderer.invoke('fs:create-file', { filename: name, content: 'Заметки решения:\n' });
    await refreshDesktopFiles();
    openWindow('editor', { filename: name, content: 'Заметки решения:\n' });
  } else if (type === 'folder') {
    const num = Math.floor(Math.random() * 90) + 10;
    const name = `Папка_${num}`;
    await ipcRenderer.invoke('fs:create-folder', name);
    await refreshDesktopFiles();
  }
};

// ==========================================================================
// MACOS DOCK (USER'S EXACT STRUCTURE & WIDE SPACING)
// ==========================================================================

function renderDock(shortcuts = []) {
  // 1. Built-in system apps
  const builtIns = [
    { key: 'browser', name: 'Яндекс Контест', icon: DOCK_ICONS.contest },
    { key: 'editor', name: 'Редактор кода', icon: DOCK_ICONS.editor },
    { key: 'files', name: 'Файлы (Workspace)', icon: DOCK_ICONS.files },
    { key: 'calc', name: 'Калькулятор', icon: DOCK_ICONS.calc }
  ];

  let html = builtIns.map(app => {
    const isRunning = openWindows.has(app.key) ? 'running' : '';
    return `
      <li class="nav-item ${isRunning}" data-app="${app.key}">
        <a href="#" class="nav-item__link" onclick="handleDockItemClick('${app.key}')">
          <img src="${app.icon}" loading="eager" alt="${app.name}" class="image">
          <div class="dock-running-dot"></div>
        </a>
        <div class="nav-item__tooltip">
          <div>${app.name}</div>
        </div>
      </li>
    `;
  }).join('');

  // 2. Teacher-configured custom programs / websites
  (shortcuts || []).forEach(sc => {
    if (sc.id === 'contest') return; // Handled by builtIn browser
    const icon = sc.icon === 'code' ? DOCK_ICONS.editor : DOCK_ICONS.appGeneric;

    html += `
      <li class="nav-item" data-app="${sc.id}">
        <a href="#" class="nav-item__link" onclick="handleShortcutClick('${sc.id}')">
          <img src="${icon}" loading="eager" alt="${escapeHtml(sc.name)}" class="image">
          <div class="dock-running-dot"></div>
        </a>
        <div class="nav-item__tooltip">
          <div>${escapeHtml(sc.name)}</div>
        </div>
      </li>
    `;
  });

  dockNavList.innerHTML = html;
}

window.handleDockItemClick = function(appKey) {
  const win = WINDOWS_MAP[appKey];
  if (!win) return;

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
};

window.handleShortcutClick = async function(scId) {
  const sc = (currentConfig.shortcuts || []).find(s => s.id === scId);
  if (!sc) return;

  if (sc.type === 'browser' || sc.type === 'url' || sc.url) {
    openWindow('browser', { url: sc.url });
    return;
  }

  // External program launch
  const res = await ipcRenderer.invoke('launch-app', scId);
  if (!res.success && res.message) {
    alert(res.message);
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
  renderDock(config.shortcuts || []);
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
    renderDock(cfg.shortcuts || []);
  }
});

refreshDesktopFiles();

// Open Contest Browser by default on start
setTimeout(() => {
  openWindow('browser');
}, 400);
