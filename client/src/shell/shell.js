const { ipcRenderer } = require('electron');

// Маппинг доменов для веб-иконок программ (используется главным процессом при загрузке иконок)
const ICON_WEB_DOMAINS = { pycharm: 'jetbrains.com', vscode: 'code.visualstudio.com', codeblocks: 'codeblocks.org', pascal: 'pascalabc.net', idle: 'python.org', contest: 'contest.yandex.ru' };
window.LOKED_ICON_DOMAINS = ICON_WEB_DOMAINS;

// State
let currentConfig = { contestUrl: 'https://contest.yandex.ru', shortcuts: [] };
let activeTopZ = 200;
let openWindows = new Set();
let runningExternalApps = new Map(); // id -> shortcut object
let desktopFiles = [];
let currentEditorFile = 'solution.py';
let selectedItemId = null;

// Иконки, полученные от главного процесса: shortcutId -> file:///... (иначе рисуем векторные заглушки)
const runtimeIcons = new Map();

// DOM Elements
const systemClock = document.getElementById('mbClock');
const timerDot = document.getElementById('timerDot');
const timerDigits = document.getElementById('timerDigits');
const timerLabel = document.getElementById('timerLabel');

const desktopSurface = document.getElementById('desktopSurface');
const desktopShell = document.getElementById('desktopShell');
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

// Clock (day + date + time, compact macOS-style)
const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

function updateClock() {
  const now = new Date();
  const time = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  systemClock.textContent = `${WEEKDAYS[now.getDay()]}, ${now.getDate()} ${MONTHS[now.getMonth()]}  ${time}`;
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

// macOS-style app tile: squircle plate + artwork (как иконки приложений в macOS)
function makeAppTile(artwork, topColor, bottomColor, plateId = 'g') {
  return makeSvgDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="64" height="64">
      <defs>
        <linearGradient id="${plateId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${topColor}"/>
          <stop offset="1" stop-color="${bottomColor}"/>
        </linearGradient>
      </defs>
      <rect width="128" height="128" rx="28" fill="url(#${plateId})"/>
      <rect x="1.6" y="1.6" width="124.8" height="124.8" rx="26.5" fill="none" stroke="rgba(255,255,255,0.30)" stroke-width="3.2"/>
      <rect width="128" height="64" rx="28" fill="rgba(255,255,255,0.10)"/>
      ${artwork}
    </svg>
  `);
}

// macOS-style generic document icon with extension badge
const FILE_ICON_COLORS = {
  '.py': ['#3776ab', '#ffd43b'],
  '.pyw': ['#3776ab', '#ffd43b'],
  '.cpp': ['#0f766e', '#5eead4'],
  '.cc': ['#0f766e', '#5eead4'],
  '.cxx': ['#0f766e', '#5eead4'],
  '.c': ['#334155', '#cbd5e1'],
  '.h': ['#334155', '#cbd5e1'],
  '.hpp': ['#334155', '#cbd5e1'],
  '.pas': ['#0284c7', '#bae6fd'],
  '.java': ['#b45309', '#fde68a'],
  '.cs': ['#7c3aed', '#ddd6fe'],
  '.js': ['#a16207', '#fef08a'],
  '.json': ['#065f46', '#a7f3d0'],
  '.html': ['#c2410c', '#fed7aa'],
  '.css': ['#1d4ed8', '#bfdbfe'],
  '.md': ['#475569', '#e2e8f0'],
  '.txt': ['#475569', '#e2e8f0']
};

function makeFileIcon(ext) {
  const e = String(ext || '').toLowerCase();
  const label = (e.replace('.', '') || 'file').toUpperCase().slice(0, 4);
  const [bg, fg] = FILE_ICON_COLORS[e] || ['#475569', '#e2e8f0'];
  return makeSvgDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="64" height="64">
      <path d="M26 10 h50 l26 26 v78 a6 6 0 0 1 -6 6 h-70 a6 6 0 0 1 -6 -6 v-98 a6 6 0 0 1 6 -6 z" fill="#f8fafc" stroke="#cbd5e1" stroke-width="2"/>
      <path d="M76 10 l26 26 h-26 z" fill="#cbd5e1"/>
      <rect x="30" y="76" width="68" height="28" rx="9" fill="${bg}"/>
      <text x="64" y="96" text-anchor="middle" font-family="-apple-system, Segoe UI, Roboto, sans-serif" font-size="17" font-weight="700" fill="${fg}">${label}</text>
    </svg>
  `);
}

// Единая иконка для папок: та же, что у «Мои файлы» (BASE_ICONS.files).
// Отдельной «синей папки» в оболочке больше нет — папка и файл отличаются только подписью.

// Canonical / Standard Base Icons
const BASE_ICONS = {
  // Yandex Contest — macOS-style red squircle
  contest: makeAppTile(`
    <circle cx="64" cy="64" r="36" fill="#ffffff"/>
    <text x="64" y="82" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-weight="700" font-size="52" fill="#fc3f1d">Я</text>
  `, '#ff6a4d', '#d92c15', 'gc'),

  // Python — macOS-style dark squircle with interlocking snakes
  python: makeAppTile(`
    <g transform="translate(14,14) scale(0.78)">
      <path d="M63.5 12 c-22.4 0 -21 9.7 -21 9.7 l.02 10.1 h21.4 v3 h-30 c-13.8 0 -24.2 8.3 -24.2 24.1 c0 15.8 8.8 23.3 20.3 23.3 h7.4 v-10.3 c0 -11.7 10.1 -11.7 10.1 -11.7 h20.9 c10.3 0 10.1 -9.9 10.1 -9.9 v-19.5 c0 -9.6 -9.2 -18.8 -25 -18.8 z" fill="#ffffff"/>
      <path d="M64.5 116 c22.4 0 21 -9.7 21 -9.7 l-.02 -10.1 h-21.4 v-3 h30 c13.8 0 24.2 -8.3 24.2 -24.1 c0 -15.8 -8.8 -23.3 -20.3 -23.3 h-7.4 v10.3 c0 11.7 -10.1 11.7 -10.1 11.7 h-20.9 c-10.3 0 -10.1 9.9 -10.1 9.9 v19.5 c0 9.6 9.2 18.8 25 18.8 z" fill="#ffd43b"/>
    </g>
  `, '#2b3a55', '#111827', 'gp'),

  // Visual Studio Code — macOS-style blue squircle
  vscode: makeAppTile(`
    <path d="M54 36 L28 64 L54 92 L66 82 L48 64 L66 46 Z" fill="#ffffff"/>
    <path d="M74 36 L100 64 L74 92 L62 82 L80 64 L62 46 Z" fill="#bae6fd"/>
    <rect x="60" y="28" width="8" height="72" rx="4" fill="#ffffff" opacity="0.92"/>
  `, '#38bdf8', '#0369a1', 'gv'),

  // Official JetBrains PyCharm Logo
  pycharm: makeSvgDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="64" height="64">
      <rect width="128" height="128" rx="28" fill="#212121"/>
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
      <rect width="128" height="128" rx="28" fill="#0284c7"/>
      <circle cx="64" cy="64" r="46" fill="#0369a1"/>
      <text x="64" y="80" text-anchor="middle" font-family="Georgia, serif" font-weight="bold" font-size="56" fill="#ffffff">P</text>
      <text x="64" y="102" text-anchor="middle" font-family="sans-serif" font-weight="bold" font-size="13" fill="#bae6fd">PASCAL</text>
    </svg>
  `),

  // Code::Blocks 4 Color Blocks & C++ Logo
  codeblocks: makeSvgDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="64" height="64">
      <rect width="128" height="128" rx="28" fill="#0f172a"/>
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
      <rect width="128" height="128" rx="28" fill="#0f172a"/>
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
      <rect width="128" height="128" rx="28" fill="#1c1917"/>
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
  if (normId === 'pycharm' || cmd.includes('pycharm') || name.includes('pycharm')) {
    return BASE_ICONS.pycharm;
  }
  if (normId === 'pascal' || cmd.includes('pascal') || name.includes('pascal')) {
    return BASE_ICONS.pascal;
  }
  if (normId === 'codeblocks' || cmd.includes('codeblocks') || name.includes('c++') || name.includes('code::blocks')) {
    return BASE_ICONS.codeblocks;
  }
  if (normId === 'vscode' || cmd.includes('code.exe') || name.includes('visual studio code') || name.includes('vs code')) {
    return BASE_ICONS.vscode;
  }
  if (normId === 'notepad' || cmd.includes('notepad') || name.includes('блокнот')) {
    return BASE_ICONS.notepad;
  }
  if (type === 'browser' || type === 'url' || sc?.url) {
    return BASE_ICONS.genericWeb;
  }
  return BASE_ICONS.editor;
}

// Настоящие иконки программ с главного процесса; если их нет — векторные заглушки
function getRuntimeIcon(shortcutId, sc) {
  const found = runtimeIcons.get(shortcutId);
  if (found) return found;
  return resolveAppIcon(shortcutId, sc);
}

// Запрашиваем у главного процесса иконки установленных программ: { [shortcutId]: 'file:///...' }
async function refreshRuntimeIcons() {
  let payload = null;
  try {
    payload = await ipcRenderer.invoke('icons:resolve');
  } catch (err) {
    return; // главный процесс может не поддерживать канал — остаются заглушки
  }

  if (!payload || typeof payload !== 'object') return;

  runtimeIcons.clear();
  Object.keys(payload).forEach(id => {
    const value = payload[id];
    if (typeof value === 'string' && value) runtimeIcons.set(id, value);
  });

  // Обновляем иконки на месте, без перезагрузки оболочки
  try {
    if (winFiles && winFiles.style.display !== 'none') loadFilesWindow();
    renderDesktopIcons();
    renderDock();
  } catch (err) {
    // отрисовка не должна ломать оболочку — иконки обновимся при следующем вызове
  }
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

// ==========================================================================
// TOUCH BAR (macOS-style context strip)
// ==========================================================================

const touchBar = document.getElementById('touchBar');
const touchBarGroup = document.getElementById('touchBarGroup');
const mbAppName = document.getElementById('mbAppName');
const mbMenus = document.getElementById('mbMenus');
const mbBrandTrigger = document.getElementById('mbBrandTrigger');
const mbBrandMenu = document.getElementById('mbBrandMenu');
const btnTouchBarToggle = document.getElementById('btnTouchBarToggle');

const TB_SVG = {
  trophy: '<path d="M7 4h10v5a5 5 0 0 1-10 0V4Z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/><path d="M9 21h6M12 17v4"/>',
  code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>',
  calc: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  forward: '<path d="m9 18 6-6-6-6"/>',
  reload: '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>',
  home: '<path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
  eraser: '<path d="M4 20h16"/><path d="m6 16 8-8 5 5-6 6H8Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  expand: '<path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
  cut: '<circle cx="6" cy="18" r="3"/><circle cx="18" cy="18" r="3"/><path d="M8 12 18 4M16 12 6 4"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  paste: '<path d="M9 4h6v3H9z"/><path d="M15 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2"/>',
  selectall: '<rect x="4" y="4" width="16" height="16" rx="2" stroke-dasharray="3 3"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  minimize: '<path d="M5 12h14"/>',
  monitor: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.6 2.6 0 1 1 3.4 2.5c-.6.2-.9.8-.9 1.4v.6M12 17h.01"/>',
  shield: '<path d="M12 3 5 6v6c0 4.5 3 7.9 7 9 4-1.1 7-4.5 7-9V6l-7-3Z"/>',
  check: '<path d="m5 13 4 4L19 7"/>'
};

const TOUCHBAR_APPS = {
  browser: { name: 'Яндекс Контест', icon: BASE_ICONS.contest },
  editor: { name: 'Редактор кода', icon: BASE_ICONS.editor },
  files: { name: 'Мои файлы', icon: BASE_ICONS.files },
  calc: { name: 'Калькулятор', icon: BASE_ICONS.calc }
};

const TOUCHBAR_ACTIONS = {
  'win:browser': () => openWindow('browser'),
  'win:editor': () => openWindow('editor'),
  'win:files': () => openWindow('files'),
  'win:calc': () => openWindow('calc'),
  'win:fullscreen': () => { const k = getActiveWindowKey(); if (k) toggleMaximizeWindow(k); },
  'win:close': () => { const k = getActiveWindowKey(); if (k) closeWindow(k); },
  'new:python': () => window.createDesktopItem('python'),
  'new:custom': () => window.createDesktopItem('custom'),
  'desktop:refresh': () => refreshDesktopFiles(),
  'browser:back': () => { if (desktopBrowserWv.canGoBack()) desktopBrowserWv.goBack(); },
  'browser:forward': () => { if (desktopBrowserWv.canGoForward()) desktopBrowserWv.goForward(); },
  'browser:reload': () => desktopBrowserWv.reload(),
  'browser:home': () => desktopBrowserWv.setAttribute('src', currentConfig.contestUrl || 'https://contest.yandex.ru'),
  'editor:save': () => saveCurrentEditorFile(),
  'editor:clear': () => btnEditorClear.click(),
  'files:newfile': () => window.createDesktopItem('python'),
  'files:newfolder': () => window.createDesktopItem('folder'),
  'files:refresh': () => { refreshDesktopFiles(); loadFilesWindow(); },
  'calc:C': () => window.calcInput('C'),
  'calc:sign': () => window.calcInput('±'),
  'calc:percent': () => window.calcInput('%'),
  'calc:div': () => window.calcInput('/'),
  'calc:mul': () => window.calcInput('*'),
  'calc:sub': () => window.calcInput('-'),
  'calc:add': () => window.calcInput('+'),
  'calc:eq': () => window.calcInput('=')
};

const TOUCHBAR_LAYOUTS = {
  desktop: [
    { icon: 'trophy', label: 'Контест', cmd: 'win:browser', accent: true },
    { icon: 'code', label: 'Редактор', cmd: 'win:editor' },
    { icon: 'folder', label: 'Файлы', cmd: 'win:files' },
    { icon: 'calc', label: 'Калькулятор', cmd: 'win:calc' },
    { sep: true },
    { icon: 'plus', label: 'Новый файл', cmd: 'new:python' },
    { icon: 'reload', label: 'Обновить', cmd: 'desktop:refresh' }
  ],
  browser: [
    { icon: 'back', label: 'Назад', cmd: 'browser:back', compact: true },
    { icon: 'forward', label: 'Вперёд', cmd: 'browser:forward', compact: true },
    { icon: 'reload', label: 'Обновить', cmd: 'browser:reload', compact: true },
    { icon: 'home', label: 'На главную', cmd: 'browser:home', compact: true },
    { sep: true },
    { icon: 'plus', label: 'Новый файл', cmd: 'new:custom' },
    { sep: true },
    { icon: 'expand', label: 'Во весь экран', cmd: 'win:fullscreen' },
    { icon: 'close', label: 'Закрыть', cmd: 'win:close', danger: true }
  ],
  editor: [
    { icon: 'save', label: 'Сохранить', cmd: 'editor:save', accent: true },
    { icon: 'eraser', label: 'Очистить', cmd: 'editor:clear' },
    { sep: true },
    { icon: 'plus', label: 'Новый файл', cmd: 'new:custom' },
    { sep: true },
    { icon: 'expand', label: 'Во весь экран', cmd: 'win:fullscreen' },
    { icon: 'close', label: 'Закрыть', cmd: 'win:close', danger: true }
  ],
  files: [
    { icon: 'plus', label: 'Новый файл', cmd: 'files:newfile', accent: true },
    { icon: 'folder', label: 'Новая папка', cmd: 'files:newfolder' },
    { icon: 'reload', label: 'Обновить', cmd: 'files:refresh' },
    { sep: true },
    { icon: 'expand', label: 'Во весь экран', cmd: 'win:fullscreen' },
    { icon: 'close', label: 'Закрыть', cmd: 'win:close', danger: true }
  ],
  calc: [
    { icon: 'eraser', label: 'C', cmd: 'calc:C', compact: true },
    { icon: 'plus', label: '±', cmd: 'calc:sign', compact: true },
    { icon: 'reload', label: '%', cmd: 'calc:percent', compact: true },
    { sep: true },
    { icon: 'code', label: '÷', cmd: 'calc:div', compact: true },
    { icon: 'code', label: '×', cmd: 'calc:mul', compact: true },
    { icon: 'code', label: '−', cmd: 'calc:sub', compact: true },
    { icon: 'plus', label: '+', cmd: 'calc:add', compact: true },
    { icon: 'trophy', label: '=', cmd: 'calc:eq', compact: true },
    { sep: true },
    { icon: 'expand', label: 'Во весь экран', cmd: 'win:fullscreen' },
    { icon: 'close', label: 'Закрыть', cmd: 'win:close', danger: true }
  ]
};

function tbIcon(name, size = 15) {
  return `<span class="tb-icon"><svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${TB_SVG[name] || ''}</svg></span>`;
}

function getActiveWindowKey() {
  const active = document.querySelector('.mac-window.active');
  if (!active) return null;
  if (active.style.display === 'none' || active.classList.contains('minimized')) return null;
  return Object.keys(WINDOWS_MAP).find(k => WINDOWS_MAP[k] === active) || null;
}

function updateTouchBarApp(key) {
  if (mbAppName) mbAppName.textContent = key && TOUCHBAR_APPS[key] ? TOUCHBAR_APPS[key].name : 'Рабочий стол';
}

function renderTouchBar() {
  if (!touchBarGroup) return;
  const key = getActiveWindowKey();
  const layout = TOUCHBAR_LAYOUTS[key] || TOUCHBAR_LAYOUTS.desktop;

  touchBarGroup.innerHTML = layout.map(item => {
    if (item.sep) return '<span class="tb-sep"></span>';
    const cls = ['tb-btn'];
    if (item.accent) cls.push('accent');
    if (item.danger) cls.push('danger');
    if (item.compact) cls.push('compact');
    if (!item.label) cls.push('icon-only');
    const title = escapeHtml(item.label || '');
    return `<button class="${cls.join(' ')}" data-cmd="${item.cmd}" title="${title}">${item.icon ? tbIcon(item.icon) : ''}${item.label ? `<span>${escapeHtml(item.label)}</span>` : ''}</button>`;
  }).join('');

  updateTouchBarApp(key);
}

if (touchBarGroup) {
  touchBarGroup.addEventListener('click', (e) => {
    const btn = e.target.closest('.tb-btn');
    if (!btn) return;
    const action = TOUCHBAR_ACTIONS[btn.dataset.cmd];
    if (!action) return;
    try {
      action();
    } catch (err) {
      console.warn('[TouchBar] action failed:', err);
    }
  });
}

if (btnTouchBarToggle) {
  btnTouchBarToggle.addEventListener('click', () => {
    const collapsed = touchBar.classList.toggle('collapsed');
    if (desktopShell) desktopShell.classList.toggle('touchbar-collapsed', collapsed);
    btnTouchBarToggle.title = collapsed ? 'Показать Touch Bar' : 'Свернуть Touch Bar';
    if (collapsed) hideTouchBar();
    else showTouchBar();
  });
}

// ==========================================================================
// TOUCH BAR: скрыт по умолчанию, показывается по наведению (как в macOS)
// ==========================================================================

const TOUCHBAR_HIDE_DELAY = 2500; // скрывать через ~2.5 с без активности
const TOUCHBAR_TOP_ZONE = 140;    // верхняя кромка экрана

let touchBarHideTimer = null;

// Активное окно может само просить не показывать Touch Bar (data-touchbar="hide")
function activeWindowHidesTouchBar() {
  const key = getActiveWindowKey();
  if (!key) return false;
  const win = WINDOWS_MAP[key];
  if (!win) return false;
  const flag = win.getAttribute('data-touchbar');
  return flag === 'hide' || flag === 'false';
}

function touchBarBlocked() {
  if (!touchBar) return true;
  if (touchBar.classList.contains('collapsed')) return true; // пользователь свернул вручную
  return activeWindowHidesTouchBar();
}

function showTouchBar() {
  if (!touchBar || touchBarBlocked()) return;
  touchBar.classList.add('touchbar-visible');
  if (desktopShell) desktopShell.classList.add('touchbar-peek');
  scheduleTouchBarHide();
}

function hideTouchBar() {
  if (!touchBar) return;
  clearTimeout(touchBarHideTimer);
  touchBarHideTimer = null;
  touchBar.classList.remove('touchbar-visible');
  if (desktopShell) desktopShell.classList.remove('touchbar-peek');
}

function scheduleTouchBarHide() {
  clearTimeout(touchBarHideTimer);
  touchBarHideTimer = setTimeout(hideTouchBar, TOUCHBAR_HIDE_DELAY);
}

// Зона над меню-баром, куда попадает указатель у верхней кромки экрана
const touchbarHotzone = document.getElementById('touchbarHotzone');

if (touchbarHotzone) {
  touchbarHotzone.addEventListener('mouseenter', showTouchBar);
  touchbarHotzone.addEventListener('mousemove', showTouchBar);
}

// Наведение на док тоже поднимает Touch Bar
const dockWrap = document.querySelector('.nav-wrap');
const dockBar = document.querySelector('.nav-bar');
[dockWrap, dockBar].forEach(node => {
  if (!node) return;
  node.addEventListener('mouseenter', showTouchBar);
  node.addEventListener('mousemove', showTouchBar);
});

// Движение мыши к верхней кромке экрана при открытом/активном окне
document.addEventListener('mousemove', (e) => {
  if (e.clientY >= TOUCHBAR_TOP_ZONE) return;
  if (!openWindows.size) return;
  showTouchBar();
});

// Touch Bar сам продлевает свою видимость, пока указатель над ним
if (touchBar) {
  touchBar.addEventListener('mouseenter', showTouchBar);
  touchBar.addEventListener('mousemove', scheduleTouchBarHide);
}

// ==========================================================================
// TOP MENU BAR (dropdown menus)
// ==========================================================================

const MENUBAR_ACTIONS = {
  'file:new': () => window.createDesktopItem('custom'),
  'file:folder': () => window.createDesktopItem('folder'),
  'file:open': () => openWindow('editor'),
  'file:save': () => saveCurrentEditorFile(),
  'file:rename': () => renameWorkspaceItem(),
  'file:delete': () => deleteWorkspaceItem(),
  'file:close': () => { const k = getActiveWindowKey(); if (k) closeWindow(k); },

  'edit:undo': () => runTextCommand('undo'),
  'edit:redo': () => runTextCommand('redo'),
  'edit:cut': () => editClipboard('cut'),
  'edit:copy': () => editClipboard('copy'),
  'edit:paste': () => editClipboard('paste'),
  'edit:selectall': () => runTextCommand('selectAll'),
  'edit:find': () => openWindow('files'),

  'view:fullscreen': () => { const k = getActiveWindowKey(); if (k) toggleMaximizeWindow(k); },
  'view:minimize': () => { const k = getActiveWindowKey(); if (k) minimizeWindow(k); },
  'view:touchbar': () => {
    if (!touchBar) return;
    if (touchBar.classList.contains('touchbar-visible')) { hideTouchBar(); return; }
    // Ручное «показать» снимает и режим свернутой панели
    if (touchBar.classList.contains('collapsed') && btnTouchBarToggle) btnTouchBarToggle.click();
    showTouchBar();
  },
  'view:dock': () => { const d = document.querySelector('.docker'); if (d) d.classList.toggle('force-hidden'); },
  'view:refresh': () => refreshDesktopFiles(),
  'view:reset-layout': () => resetDesktopIconLayout(),

  'go:desktop': () => closeAllWindows(),
  'go:browser': () => openWindow('browser'),
  'go:editor': () => openWindow('editor'),
  'go:files': () => openWindow('files'),
  'go:calc': () => openWindow('calc'),

  'win:minimize': () => { const k = getActiveWindowKey(); if (k) minimizeWindow(k); },
  'win:zoom': () => { const k = getActiveWindowKey(); if (k) toggleMaximizeWindow(k); },
  'win:close': () => { const k = getActiveWindowKey(); if (k) closeWindow(k); },

  'help:about': () => showConfirm('LOKED', `LOKED — защищённая олимпиадная среда.\nРабочая папка: LOKED_Workspace\nВерсия интерфейса: 1.1`),
  'help:rules': () => showConfirm('Правила олимпиады', 'Разрешены только Контест, редактор кода и файлы рабочего места. Сторонние программы и сайты заблокированы.'),
  'help:unlock': () => openSecretUnlock()
};

function menubarMenus() {
  const key = getActiveWindowKey();
  const touchbarHidden = touchBar && !touchBar.classList.contains('touchbar-visible');
  const dockHidden = document.querySelector('.docker') &&
    document.querySelector('.docker').classList.contains('force-hidden');

  return [
    {
      id: 'brand', label: null,
      items: [
        { label: 'О LOKED', icon: 'info', cmd: 'help:about' },
        { label: 'Рабочая папка LOKED_Workspace', icon: 'folder', cmd: 'go:files' },
        { sep: true },
        { label: 'Обновить рабочий стол', icon: 'reload', cmd: 'view:refresh' }
      ]
    },
    {
      id: 'file', label: 'Файл',
      items: [
        { label: 'Новый файл…', icon: 'plus', cmd: 'file:new', key: 'Ctrl+N' },
        { label: 'Новая папка', icon: 'folder', cmd: 'file:folder' },
        { label: 'Открыть в редакторе', icon: 'code', cmd: 'file:open', key: 'Ctrl+O' },
        { sep: true },
        { label: 'Сохранить', icon: 'save', cmd: 'file:save', key: 'Ctrl+S' },
        { label: 'Переименовать…', icon: 'reload', cmd: 'file:rename', disabled: getFileActionTargets().length === 0 },
        { label: 'Удалить', icon: 'close', cmd: 'file:delete', danger: true, disabled: getFileActionTargets().length === 0 },
        { sep: true },
        { label: 'Закрыть окно', icon: 'close', cmd: 'file:close', key: 'Ctrl+W', disabled: !key }
      ]
    },
    {
      id: 'edit', label: 'Правка',
      items: [
        { label: 'Отменить', icon: 'undo', cmd: 'edit:undo', key: 'Ctrl+Z' },
        { label: 'Вернуть', icon: 'redo', cmd: 'edit:redo', key: 'Ctrl+Shift+Z' },
        { sep: true },
        { label: 'Вырезать', icon: 'cut', cmd: 'edit:cut', key: 'Ctrl+X' },
        { label: 'Копировать', icon: 'copy', cmd: 'edit:copy', key: 'Ctrl+C' },
        { label: 'Вставить', icon: 'paste', cmd: 'edit:paste', key: 'Ctrl+V' },
        { label: 'Выделить всё', icon: 'selectall', cmd: 'edit:selectall', key: 'Ctrl+A' },
        { sep: true },
        { label: 'Найти файл…', icon: 'search', cmd: 'edit:find', key: 'Ctrl+F' }
      ]
    },
    {
      id: 'view', label: 'Вид',
      items: [
        { label: 'Во весь экран', icon: 'expand', cmd: 'view:fullscreen', disabled: !key },
        { label: 'Свернуть окно', icon: 'minimize', cmd: 'view:minimize', disabled: !key },
        { sep: true },
        { label: touchbarHidden ? 'Показать Touch Bar' : 'Скрыть Touch Bar', icon: 'monitor', cmd: 'view:touchbar' },
        { label: dockHidden ? 'Показать док' : 'Скрыть док', icon: 'eye', cmd: 'view:dock' },
        { sep: true },
        { label: 'Обновить рабочий стол', icon: 'reload', cmd: 'view:refresh', key: 'F5' },
        { sep: true },
        { label: 'Вернуть иконки на место', icon: 'home', cmd: 'view:reset-layout' }
      ]
    },
    {
      id: 'go', label: 'Переход',
      items: [
        { label: 'Рабочий стол', icon: 'monitor', cmd: 'go:desktop', check: !key },
        { sep: true },
        { label: 'Яндекс Контест', icon: 'trophy', cmd: 'go:browser', check: key === 'browser' },
        { label: 'Редактор кода', icon: 'code', cmd: 'go:editor', check: key === 'editor' },
        { label: 'Мои файлы', icon: 'folder', cmd: 'go:files', check: key === 'files' },
        { label: 'Калькулятор', icon: 'calc', cmd: 'go:calc', check: key === 'calc' }
      ]
    },
    {
      id: 'win', label: 'Окно',
      items: [
        { label: 'Свернуть', icon: 'minimize', cmd: 'win:minimize', key: 'Ctrl+M', disabled: !key },
        { label: 'Развернуть / в окно', icon: 'expand', cmd: 'win:zoom', disabled: !key },
        { sep: true },
        { label: 'Закрыть', icon: 'close', cmd: 'win:close', key: 'Ctrl+W', disabled: !key }
      ]
    },
    {
      id: 'help', label: 'Справка',
      items: [
        { label: 'О LOKED', icon: 'info', cmd: 'help:about' },
        { sep: true },
        { label: 'Правила олимпиады', icon: 'shield', cmd: 'help:rules' }
      ]
    }
  ];
}

let openMenubarMenuId = null;

function renderMenubarDropdown(menu) {
  return menu.items.map(item => {
    if (item.sep) return '<div class="mb-dd-sep"></div>';
    const cls = ['mb-dd-item'];
    if (item.danger) cls.push('danger');
    if (item.disabled) cls.push('disabled');
    const icon = item.check ? 'check' : (item.icon || '');
    return `<button class="${cls.join(' ')}" data-cmd="${item.cmd}"${item.disabled ? ' disabled' : ''}>` +
      `<span class="mb-dd-icon">${icon ? tbIcon(icon, item.check ? 14 : 15) : ''}</span>` +
      `<span class="mb-dd-label">${escapeHtml(item.label)}</span>` +
      `${item.key ? `<span class="mb-dd-key">${escapeHtml(item.key)}</span>` : ''}</button>`;
  }).join('');
}

function renderMenubarMenus() {
  if (!mbMenus) return;
  mbMenus.innerHTML = menubarMenus()
    .filter(menu => menu.label)
    .map(menu => `
      <div class="mb-menu-wrap" id="mbWrap_${menu.id}">
        <button class="mb-item" data-menu="${menu.id}">${escapeHtml(menu.label)}</button>
        <div class="mb-dropdown" id="mbMenu_${menu.id}">${renderMenubarDropdown(menu)}</div>
      </div>
    `).join('');

  if (mbBrandMenu) mbBrandMenu.innerHTML = renderMenubarDropdown(menubarMenus()[0]);
}

function closeMenubarMenus() {
  document.querySelectorAll('.mb-dropdown.open').forEach(p => p.classList.remove('open'));
  document.querySelectorAll('.mb-item.open').forEach(t => t.classList.remove('open'));
  openMenubarMenuId = null;
}

function openMenubarMenu(id) {
  closeMenubarMenus();
  // Перерисовываем меню ДО получения ссылок — иначе панель отсоединится от DOM
  renderMenubarMenus();

  const panel = id === 'brand'
    ? mbBrandMenu
    : document.getElementById(`mbMenu_${id}`);
  const wrap = id === 'brand' ? null : document.getElementById(`mbWrap_${id}`);
  const trigger = id === 'brand' ? mbBrandTrigger : (wrap && wrap.querySelector('.mb-item'));

  if (!panel || !trigger) return;
  panel.classList.add('open');
  trigger.classList.add('open');
  openMenubarMenuId = id;
}

function toggleMenubarMenu(id) {
  if (openMenubarMenuId === id) {
    closeMenubarMenus();
    return;
  }
  openMenubarMenu(id);
}

function handleMenubarAction(cmd) {
  const action = MENUBAR_ACTIONS[cmd];
  closeMenubarMenus();
  if (!action) return;
  try {
    action();
  } catch (err) {
    console.warn('[MenuBar] action failed:', err);
  }
}

if (mbMenus) {
  mbMenus.addEventListener('click', (e) => {
    const item = e.target.closest('.mb-dd-item');
    if (item) {
      if (item.hasAttribute('disabled')) return;
      handleMenubarAction(item.dataset.cmd);
      return;
    }
    const trigger = e.target.closest('.mb-item');
    if (trigger) {
      e.stopPropagation();
      toggleMenubarMenu(trigger.dataset.menu);
    }
  });

  mbMenus.addEventListener('mouseover', (e) => {
    const wrap = e.target.closest('.mb-menu-wrap');
    if (wrap && openMenubarMenuId && openMenubarMenuId !== wrap.id.replace('mbWrap_', '')) {
      openMenubarMenu(wrap.id.replace('mbWrap_', ''));
    }
  });

  mbMenus.addEventListener('click', (e) => e.stopPropagation());
}

if (mbBrandTrigger) {
  mbBrandTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMenubarMenu('brand');
  });
  mbBrandTrigger.addEventListener('mouseover', () => {
    if (openMenubarMenuId && openMenubarMenuId !== 'brand') openMenubarMenu('brand');
  });
}

if (mbBrandMenu) {
  mbBrandMenu.addEventListener('click', (e) => {
    e.stopPropagation();
    const item = e.target.closest('.mb-dd-item');
    if (item && !item.hasAttribute('disabled')) handleMenubarAction(item.dataset.cmd);
  });
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.mac-menubar')) closeMenubarMenus();
  // Клик вне мини-меню дока закрывает его
  if (dockContextMenu && !e.target.closest('.context-menu')) closeDockContextMenu();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeMenubarMenus();
    closeDockContextMenu();
  }
});

// Editing helpers used by the menu bar
function getFileTarget() {
  if (itemCtxTarget && !itemCtxTarget.isApp) return itemCtxTarget;
  if (selectedItemId && !BUILTIN_DESKTOP_APPS.some(app => app.id === selectedItemId)) {
    const file = (desktopFiles || []).find(f => f.name === selectedItemId);
    if (file) return { name: file.name, isApp: false, isDirectory: !!file.isDirectory };
  }
  return null;
}

// Все рабочие файлы, попавшие в действие: рамка выделения (selectedIds), затем одиночный выбор
function getFileActionTargets(target = null) {
  if (target && !target.isApp) return [target];

  const bulk = [...selectedIds]
    .map(name => {
      const file = (desktopFiles || []).find(f => f.name === name);
      return file ? { name: file.name, isApp: false, isDirectory: !!file.isDirectory } : null;
    })
    .filter(Boolean);
  if (bulk.length) return bulk;

  const single = getFileTarget();
  return single ? [single] : [];
}

function closeAllWindows() {
  Object.keys(WINDOWS_MAP).forEach(closeWindow);
}

function runTextCommand(command) {
  if (winEditor.style.display === 'none') openWindow('editor');
  editorTextarea.focus();
  try {
    document.execCommand(command);
  } catch (_) {}
}

async function editClipboard(action) {
  if (winEditor.style.display === 'none') openWindow('editor');
  editorTextarea.focus();

  const start = editorTextarea.selectionStart;
  const end = editorTextarea.selectionEnd;

  if (action === 'copy' || action === 'cut') {
    const text = editorTextarea.value.slice(start, end);
    if (!text) return;
    try {
      window.require('electron').clipboard.writeText(text);
    } catch (_) {
      try { navigator.clipboard.writeText(text); } catch (_) {}
    }
    if (action === 'cut') {
      editorTextarea.value = editorTextarea.value.slice(0, start) + editorTextarea.value.slice(end);
      editorTextarea.selectionStart = editorTextarea.selectionEnd = start;
      editorTextarea.dispatchEvent(new Event('input'));
    }
    return;
  }

  let text = '';
  try {
    text = window.require('electron').clipboard.readText() || '';
  } catch (_) {}
  if (!text && navigator.clipboard) {
    try { text = await navigator.clipboard.readText(); } catch (_) {}
  }
  if (!text) return;
  editorTextarea.value = editorTextarea.value.slice(0, start) + text + editorTextarea.value.slice(end);
  editorTextarea.selectionStart = editorTextarea.selectionEnd = start + text.length;
  editorTextarea.dispatchEvent(new Event('input'));
}

function bringToFront(win) {
  if (!win) return;
  activeTopZ++;
  win.style.zIndex = activeTopZ;
  document.querySelectorAll('.mac-window').forEach(w => w.classList.remove('active'));
  win.classList.add('active');
  renderTouchBar();
}

// Пока хотя бы одно окно развёрнуто на весь экран — док прячется
function syncFullscreenState() {
  const anyFullscreen = Object.values(WINDOWS_MAP).some(win => win &&
    win.style.display !== 'none' &&
    !win.classList.contains('minimized') &&
    win.classList.contains('maximized'));
  if (desktopShell) desktopShell.classList.toggle('has-fullscreen-window', anyFullscreen);
}

// Окно открывается обычным плавающим окном (не на весь экран) и коротко
// проигрывает анимацию появления: класс window-in снимаем после ~220 мс.
function playWindowOpenAnimation(win) {
  if (!win) return;
  win.classList.remove('window-out');
  win.classList.add('window-in');
  clearTimeout(win._openAnimTimer);
  win._openAnimTimer = setTimeout(() => win.classList.remove('window-in'), 240);
}

function openWindow(key, data = null) {
  const win = WINDOWS_MAP[key];
  if (!win) return;

  const wasHidden = win.style.display === 'none';
  win.style.display = 'flex';
  win.classList.remove('minimized');
  // Отменяем незавершённую анимацию закрытия, если окно открыли снова
  clearTimeout(win._closeAnimTimer);
  if (win._closeAnimHandler) {
    win.removeEventListener('transitionend', win._closeAnimHandler);
    win._closeAnimHandler = null;
  }
  // Полноэкранный режим включается только зелёной кнопкой (toggleMaximizeWindow):
  // открытое из закрытого окно всегда обычное, плавающее.
  if (wasHidden) {
    win.classList.remove('maximized');
    const maxBtn = win.querySelector('.mac-window-controls .mac-btn.maximize');
    if (maxBtn) {
      maxBtn.classList.remove('fullscreen-mode');
      maxBtn.title = 'Развернуть на весь экран';
    }
    playWindowOpenAnimation(win);
  }
  bringToFront(win);
  openWindows.add(key);
  renderDock();
  syncFullscreenState();

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

// Закрытие окна: сначала класс window-out (анимация ухода ~160 мс),
// и только потом display:none — иначе анимация не успеет отрисоваться.
function closeWindow(key) {
  const win = WINDOWS_MAP[key];
  if (!win) return;
  openWindows.delete(key);
  renderDock();
  syncFullscreenState();

  win.classList.remove('window-in');
  win.classList.add('window-out');

  const finish = () => {
    win.classList.remove('window-out');
    win.style.display = 'none';
    renderTouchBar();
  };

  clearTimeout(win._closeAnimTimer);
  if (win._closeAnimHandler) win.removeEventListener('transitionend', win._closeAnimHandler);
  const complete = () => {
    clearTimeout(win._closeAnimTimer);
    if (win._closeAnimHandler) {
      win.removeEventListener('transitionend', win._closeAnimHandler);
      win._closeAnimHandler = null;
    }
    finish();
  };
  win._closeAnimTimer = setTimeout(complete, 170);
  win._closeAnimHandler = (e) => {
    if (e.target !== win) return;
    complete();
  };
  win.addEventListener('transitionend', win._closeAnimHandler);
}

function minimizeWindow(key) {
  const win = WINDOWS_MAP[key];
  if (!win) return;
  win.classList.add('minimized');
  renderDock();
  syncFullscreenState();
  renderTouchBar();
}

function toggleMaximizeWindow(key) {
  // Калькулятор никогда не разворачивается на весь экран: он всегда остаётся
  // компактным окном 304×416 (проверка здесь же закрывает док, меню и Touch Bar).
  if (key === 'calc') return;
  const win = WINDOWS_MAP[key];
  if (!win) return;
  const btn = win.querySelector('.mac-window-controls .mac-btn.maximize');
  const nowFullscreen = win.classList.toggle('maximized');
  if (btn) {
    btn.title = nowFullscreen ? 'Свернуть в окно' : 'Развернуть на весь экран';
    btn.classList.toggle('fullscreen-mode', nowFullscreen);
  }
  bringToFront(win);
  syncFullscreenState();
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
  updateTouchBarApp(getActiveWindowKey());
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
    updateTouchBarApp(getActiveWindowKey());
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
    const icon = f.isDirectory ? BASE_ICONS.files : makeFileIcon(f.ext);
    const sizeStr = f.isDirectory ? 'Папка' : formatBytes(f.size);

    return `
      <div class="file-box" onclick="handleFileBoxClick('${f.name}', ${f.isDirectory})">
        <img class="file-box-icon" src="${icon}" alt="">
        <div class="file-box-name" title="${f.name}">${f.name}</div>
        <div class="file-box-size">${sizeStr}</div>
      </div>
    `;
  }).join('');
}

window.handleFileBoxClick = async function(name, isDirectory) {
  if (isDirectory) {
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
// CALCULATOR WINDOW (поведение как в macOS Calculator)
// ==========================================================================

let calcCurrent = '0';       // строка текущего ввода (то, что видно на дисплее)
let calcOp = null;           // '+' | '-' | '*' | '/'
let calcPrev = null;         // левое значение отложенной операции (число)
let calcResetOnNext = false; // следующая цифра начинает новое число
let calcLastOperand = null;  // правый операнд последней операции (для повторного '=')
let calcLastOp = null;       // последняя операция (для повторного '=')
let calcError = '';          // текст ошибки (деление на ноль)

const CALC_MAX_DIGITS = 16;      // максимум цифр вводимого числа
const CALC_MAX_SIGNIFICANT = 15; // максимум значащих цифр при выводе
const CALC_MAX_DECIMALS = 10;    // знаков после запятой

// Форматирование числа для дисплея: целые без дробной части, максимум 10 знаков после запятой,
// очень большие/маленькие — экспоненциальная запись без хвостовых нулей
function formatCalcNumber(value) {
  const num = Number(value);
  if (!isFinite(num)) {
    return Number.isNaN(num) ? 'Неверное число' : (num > 0 ? 'Бесконечность' : '-Бесконечность');
  }
  if (num === 0) return '0';
  const abs = Math.abs(num);
  if (abs >= 1e15 || abs < 1e-7) {
    // Экспоненциальная запись: 15 значащих цифр и без хвостовых нулей (1e+15, 1.2345e-8)
    const parts = num.toPrecision(CALC_MAX_SIGNIFICANT).split('e');
    if (parts.length !== 2) return String(Number(parts[0]));
    const mantissa = parts[0].indexOf('.') >= 0 ? parts[0].replace(/0+$/, '').replace(/\.$/, '') : parts[0];
    return `${mantissa}e${parts[1]}`;
  }
  if (Number.isInteger(num)) return String(num);
  let str = num.toFixed(CALC_MAX_DECIMALS);
  if (str.indexOf('.') >= 0) str = str.replace(/0+$/, '').replace(/\.$/, '');
  return str;
}

// Подсветка нажатой кнопки (ищем по inline onclick, иначе — по подписи)
const CALC_BTN_ALIASES = { '−': '-', '–': '-', '—': '-', '×': '*', '⋅': '*', '÷': '/', '±': '+/-' };

function flashCalcButton(val) {
  if (!winCalc) return;
  const target = CALC_BTN_ALIASES[val] || val;
  const buttons = winCalc.querySelectorAll('.calc-btn');
  for (let i = 0; i < buttons.length; i++) {
    const btn = buttons[i];
    const inline = btn.getAttribute('onclick') || '';
    const label = (btn.textContent || '').replace(/\s+/g, '');
    const byInline = inline.indexOf(`calcInput('${val}')`) >= 0 || inline.indexOf(`calcInput("${val}")`) >= 0;
    const byLabel = label === val || label === target || label === target.replace('-', '−');
    if (!byInline && !byLabel) continue;
    btn.classList.add('active');
    setTimeout(() => btn.classList.remove('active'), 120);
    return;
  }
}

function calcRender() {
  const display = document.getElementById('calcDisplay');
  if (display) display.textContent = calcError || calcCurrent;
}

function calcResetState() {
  calcCurrent = '0';
  calcOp = null;
  calcPrev = null;
  calcResetOnNext = false;
  calcLastOperand = null;
  calcLastOp = null;
  calcError = '';
}

function calcClearError() {
  if (!calcError) return false;
  calcError = '';
  calcCurrent = '0';
  calcOp = null;
  calcPrev = null;
  calcResetOnNext = true;
  return true;
}

// Вычисление отложенной операции: возвращает текст результата или null при ошибке
function calcApply(op, left, right) {
  let result;
  if (op === '+') result = left + right;
  else if (op === '-') result = left - right;
  else if (op === '*') result = left * right;
  else if (op === '/') {
    if (right === 0) return null;
    result = left / right;
  } else result = right;

  if (!isFinite(result)) return null;
  return formatCalcNumber(result);
}

window.calcInput = function(val) {
  const key = val === undefined || val === null ? '' : String(val);
  flashCalcButton(key);

  if (calcClearError()) {
    calcRender();
    if (key === 'C' || key === '±' || key === '%') return;
  }

  if (key === 'C') {
    calcResetState();
  } else if (key === '±') {
    const num = parseFloat(calcCurrent) || 0;
    calcCurrent = num === 0 ? '0' : formatCalcNumber(-num); // -0 не показываем
    calcResetOnNext = false;
  } else if (key === '%') {
    const num = parseFloat(calcCurrent) || 0;
    calcCurrent = formatCalcNumber(num / 100);
    calcResetOnNext = false;
  } else if (key === '+' || key === '-' || key === '*' || key === '/') {
    const cur = parseFloat(calcCurrent) || 0;
    // Если операция уже отложена и введено новое число — сначала считаем её (как в macOS)
    if (calcOp && !calcResetOnNext) {
      const done = calcApply(calcOp, calcPrev, cur);
      if (done === null) {
        calcCurrent = '0';
        calcOp = null;
        calcPrev = null;
        calcResetOnNext = true;
        calcError = 'Деление на ноль невозможно';
        calcLastOp = null;
        calcLastOperand = null;
        calcRender();
        return;
      }
      calcLastOp = calcOp;
      calcLastOperand = cur;
      calcCurrent = done;
      calcPrev = parseFloat(done) || 0;
    } else {
      calcPrev = cur;
    }
    calcOp = key;
    calcResetOnNext = true;
  } else if (key === '=') {
    if (calcOp && calcPrev !== null) {
      const cur = parseFloat(calcCurrent) || 0;
      const done = calcApply(calcOp, calcPrev, cur);
      if (done === null) {
        calcCurrent = '0';
        calcOp = null;
        calcPrev = null;
        calcResetOnNext = true;
        calcError = 'Деление на ноль невозможно';
        calcLastOp = null;
        calcLastOperand = null;
        calcRender();
        return;
      }
      calcLastOp = calcOp;
      calcLastOperand = cur;
      calcCurrent = done;
      calcOp = null;
      calcPrev = null;
      calcResetOnNext = true;
    } else if (calcLastOp && calcLastOperand !== null) {
      // Повторное '=' повторяет последнюю операцию (как в macOS)
      const cur = parseFloat(calcCurrent) || 0;
      const done = calcApply(calcLastOp, cur, calcLastOperand);
      if (done === null) {
        calcCurrent = '0';
        calcResetOnNext = true;
        calcError = 'Деление на ноль невозможно';
        calcRender();
        return;
      }
      calcCurrent = done;
      calcResetOnNext = true;
    }
  } else if (key === '.') {
    if (calcResetOnNext) {
      calcCurrent = '0.';
      calcResetOnNext = false;
    } else if (calcCurrent.indexOf('.') < 0) {
      calcCurrent += '.';
    }
  } else if (key === 'backspace') {
    calcResetOnNext = false;
    if (calcCurrent.length <= 1 || (calcCurrent.length === 2 && calcCurrent.charAt(0) === '-')) {
      calcCurrent = '0';
    } else {
      calcCurrent = calcCurrent.slice(0, -1);
      if (calcCurrent === '-' || calcCurrent === '' || calcCurrent === '.') calcCurrent = '0';
    }
  } else if (/^[0-9]$/.test(key)) {
    const digits = calcCurrent.replace(/[^0-9]/g, '').length;
    if (calcResetOnNext) {
      calcCurrent = key;
      calcResetOnNext = false;
    } else if (calcCurrent === '0') {
      calcCurrent = key;
    } else if (digits < CALC_MAX_DIGITS) {
      calcCurrent += key;
    }
    // длина исчерпана — игнорируем лишние цифры
  }

  calcRender();
};

// Активная кнопка калькулятора -> кнопка в разметке (для клавиатуры и Touch Bar)
function isCalcWindowActive() {
  if (!winCalc) return false;
  if (winCalc.style.display === 'none') return false;
  return !winCalc.classList.contains('minimized');
}

// Не перехватываем клавиши, пока пользователь печатает в другом поле ввода
function isTypingElsewhere() {
  const el = document.activeElement;
  if (!el || el === document.body) return false;
  if (winCalc && winCalc.contains(el)) return false;
  const tag = (el.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || el.isContentEditable) return true;
  return false;
}

window.addEventListener('keydown', (e) => {
  if (!isCalcWindowActive()) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (isTypingElsewhere()) return;

  const key = e.key;
  let action = null;

  if (key >= '0' && key <= '9') action = key;
  else if (key === '.' || key === ',') action = '.';
  else if (key === '+' || key === '-' || key === '*' || key === '/') action = key;
  else if (key === 'Enter' || key === '=') action = '=';
  else if (key === 'Escape' || key === 'Delete') action = 'C';
  else if (key === 'Backspace') action = 'backspace';
  else if (key === '%') action = '%';

  if (!action) return;
  e.preventDefault();
  window.calcInput(action);
});

// ==========================================================================
// REAL DESKTOP SURFACE & FILE WORKSPACE
// ==========================================================================

function getFileIconMarkup(ext, isDirectory) {
  const src = isDirectory ? BASE_ICONS.files : makeFileIcon(ext);
  return `<img class="mac-file-icon" src="${src}" alt="">`;
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  return (bytes / 1024).toFixed(1) + ' KB';
}

async function refreshDesktopFiles() {
  desktopFiles = await ipcRenderer.invoke('fs:list');
  // Выделение рамкой: забываем id, которых больше нет на рабочем столе (иконки программ не трогаем)
  const existing = new Set(desktopFiles.map(f => f.name));
  const appIds = new Set(BUILTIN_DESKTOP_APPS.map(app => app.id));
  (currentConfig.shortcuts || []).forEach(sc => appIds.add(sc.id));
  selectedIds.forEach(id => { if (!existing.has(id) && !appIds.has(id)) selectedIds.delete(id); });
  if (selectedItemId && !existing.has(selectedItemId) && !appIds.has(selectedItemId)) selectedItemId = null;
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

// ==========================================================================
// РАБОЧИЙ СТОЛ: свободное перетаскивание иконок и сохранение позиций
// ==========================================================================

const DESKTOP_LAYOUT_KEY = 'loked.desktop.layout.v1';
let desktopLayout = loadDesktopLayout();
let desktopIconDrag = null;          // текущий перенос иконки
let suppressItemActivateUntil = 0;   // после переноса не открываем иконку

function loadDesktopLayout() {
  try {
    const raw = window.localStorage.getItem(DESKTOP_LAYOUT_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch (_) {
    return {};
  }
}

function saveDesktopLayout() {
  try {
    window.localStorage.setItem(DESKTOP_LAYOUT_KEY, JSON.stringify(desktopLayout));
  } catch (_) {}
}

function resetDesktopIconLayout() {
  desktopLayout = {};
  try { window.localStorage.removeItem(DESKTOP_LAYOUT_KEY); } catch (_) {}
  renderDesktopIcons();
}

// Применяем сохранённые координаты: такие иконки живут в свободном слое
// (position:absolute + left/top), остальные остаются в CSS-гриде.
function applyDesktopIconLayout() {
  if (!desktopIcons) return;
  desktopIcons.querySelectorAll('.desktop-item').forEach(node => {
    const id = node.getAttribute('data-id');
    const pos = desktopLayout[id];
    if (!pos || typeof pos.left !== 'number' || typeof pos.top !== 'number') {
      node.style.position = '';
      node.style.left = '';
      node.style.top = '';
      return;
    }
    node.style.position = 'absolute';
    node.style.left = `${pos.left}px`;
    node.style.top = `${pos.top}px`;
  });
}

// Координаты offsetLeft/offsetTop и CSS left/top у иконок совпадают:
// .desktop-surface позиционирован, поэтому это координаты внутри рабочего стола
function desktopItemPos(item) {
  return { left: item.offsetLeft, top: item.offsetTop };
}

function clampDesktopPos(left, top, item) {
  const maxLeft = Math.max(0, desktopSurface.clientWidth - item.offsetWidth);
  const maxTop = Math.max(0, desktopSurface.clientHeight - item.offsetHeight);
  return {
    left: Math.max(0, Math.min(maxLeft, Math.round(left))),
    top: Math.max(0, Math.min(maxTop, Math.round(top)))
  };
}

function beginDesktopIconDrag(item, e) {
  const start = desktopItemPos(item);
  const p = surfacePoint(e);
  desktopIconDrag = {
    item,
    id: item.getAttribute('data-id'),
    startClientX: e.clientX,
    startClientY: e.clientY,
    // Точка захвата в координатах рабочего стола
    grabLeft: p.x - start.left,
    grabTop: p.y - start.top,
    originLeft: start.left,
    originTop: start.top,
    moved: false
  };
  // Левая кнопка на иконке не запускает выделение рамкой и не открывает иконку
  e.preventDefault();
  e.stopPropagation();
}

function moveDesktopIconDrag(e) {
  const drag = desktopIconDrag;
  if (!drag) return;

  const dx = e.clientX - drag.startClientX;
  const dy = e.clientY - drag.startClientY;

  if (!drag.moved) {
    // Порог в 5px: короткий клик остаётся выделением, а не переносом
    if (Math.abs(dx) <= 5 && Math.abs(dy) <= 5) return;
    drag.moved = true;
    drag.item.classList.add('dragging');
    drag.item.style.position = 'absolute';
    drag.item.style.left = `${drag.originLeft}px`;
    drag.item.style.top = `${drag.originTop}px`;
  }

  const p = surfacePoint(e);
  const next = clampDesktopPos(p.x - drag.grabLeft, p.y - drag.grabTop, drag.item);
  drag.item.style.left = `${next.left}px`;
  drag.item.style.top = `${next.top}px`;
}

function endDesktopIconDrag() {
  const drag = desktopIconDrag;
  if (!drag) return;
  desktopIconDrag = null;

  if (!drag.moved) {
    drag.item.classList.remove('dragging');
    return;
  }

  drag.item.classList.remove('dragging');
  const pos = clampDesktopPos(drag.item.offsetLeft, drag.item.offsetTop, drag.item);
  drag.item.style.left = `${pos.left}px`;
  drag.item.style.top = `${pos.top}px`;

  if (drag.id) {
    desktopLayout[drag.id] = pos;
    saveDesktopLayout();
  }
  // Двойной клик после переноса не должен открывать приложение
  suppressItemActivateUntil = Date.now() + 250;
}

window.addEventListener('mousemove', (e) => {
  if (desktopIconDrag) moveDesktopIconDrag(e);
  if (marqueeActive) updateMarquee(e);
});

window.addEventListener('mouseup', () => {
  endDesktopIconDrag();
});

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
    if (BUILTIN_DESKTOP_APPS.some(app => app.id === sc.id)) return; // Already shown as built-in
    items.push({
      id: sc.id,
      name: sc.name,
      icon: getRuntimeIcon(sc.id, sc),
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
    const isSelected = (selectedItemId === item.id || (selectedIds.size && selectedIds.has(item.id))) ? 'selected' : '';
    let iconContent = '';

    if (item.isApp) {
      iconContent = `<img src="${item.icon}" class="desktop-app-img" alt="${escapeHtml(item.name)}">`;
    } else {
      iconContent = getFileIconMarkup(item.ext, item.isDirectory);
    }

    return `
      <div class="desktop-item ${isSelected}" data-id="${item.id}" data-isapp="${item.isApp}" data-apptype="${item.appType || ''}" data-isdir="${item.isDirectory || false}">
        <div class="desktop-icon-img">${iconContent}</div>
        <div class="desktop-item-name">${escapeHtml(item.name)}</div>
      </div>
    `;
  }).join('');

  applyDesktopIconLayout();

  // Attach event handlers
  desktopIcons.querySelectorAll('.desktop-item').forEach(item => {
    const id = item.getAttribute('data-id');
    const isApp = item.getAttribute('data-isapp') === 'true';
    const appType = item.getAttribute('data-apptype');
    const isDirectory = item.getAttribute('data-isdir') === 'true';

    item.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return; // правый клик ничего не двигает
      beginDesktopIconDrag(item, e);
    });

    item.addEventListener('click', (e) => {
      e.stopPropagation();
      selectedItemId = id;
      desktopIcons.querySelectorAll('.desktop-item').forEach(it => it.classList.remove('selected'));
      item.classList.add('selected');
    });

    item.addEventListener('dblclick', async (e) => {
      e.stopPropagation();
      if (Date.now() < suppressItemActivateUntil) return; // это было перетаскивание, а не запуск
      if (isApp) {
        if (appType === 'builtin') {
          openWindow(id);
        } else if (appType === 'shortcut') {
          handleShortcutClick(id);
        }
      } else {
        if (isDirectory) {
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
      // ПКМ тоже делает элемент выделенным (иначе Файл → Удалить цепляет старую рамку)
      selectedIds.clear();
      selectedIds.add(id);
      selectedItemId = id;
      desktopIcons.querySelectorAll('.desktop-item').forEach(it => it.classList.remove('selected'));
      item.classList.add('selected');
      if (isApp) {
        itemCtxTarget = { name: id, isApp: true, appType, isDirectory: false };
        openAppContextMenu(e.clientX, e.clientY);
      } else {
        itemCtxTarget = { name: id, isApp: false, isDirectory };
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
  closeContextSubmenus();
  desktopContextMenu.style.display = 'none';
  itemContextMenu.style.display = 'none';
}

// ---- Submenus (Windows-style "Create >") ----
function closeContextSubmenus(keep = null) {
  document.querySelectorAll('.context-submenu.open').forEach(sm => {
    if (sm === keep) return;
    sm.classList.remove('open');
    const parent = sm.parentElement;
    if (parent) parent.classList.remove('submenu-open');
  });
}

function setupContextSubmenus() {
  document.querySelectorAll('.context-item.has-submenu').forEach(trigger => {
    const submenu = trigger.querySelector('.context-submenu');
    if (!submenu) return;

    const open = () => {
      closeContextSubmenus(submenu);
      submenu.classList.add('open');
      trigger.classList.add('submenu-open');
      submenu.style.left = '';
      submenu.style.right = '';
      submenu.style.top = '';
      submenu.style.bottom = '';

      const rect = submenu.getBoundingClientRect();
      if (rect.right > window.innerWidth - 8) {
        submenu.style.left = 'auto';
        submenu.style.right = 'calc(100% - 6px)';
      }
      if (rect.bottom > window.innerHeight - 8) {
        submenu.style.top = 'auto';
        submenu.style.bottom = '-6px';
      }
    };

    trigger.addEventListener('mouseenter', open);
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      open();
    });
    submenu.addEventListener('click', (e) => e.stopPropagation());
  });
}

setupContextSubmenus();

// ==========================================================================
// MARQUEE SELECTION (левая кнопка мыши) + macOS-style курсор
// ==========================================================================

let marqueeActive = false;
let marqueeStart = { x: 0, y: 0 };
let selectedIds = new Set();
let suppressClickClear = false;

function surfacePoint(e) {
  const rect = desktopSurface.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function markMarqueeSelection(box) {
  const surfaceRect = desktopSurface.getBoundingClientRect();
  selectedIds.clear();
  desktopIcons.querySelectorAll('.desktop-item').forEach(item => {
    const r = item.getBoundingClientRect();
    const it = {
      left: r.left - surfaceRect.left,
      top: r.top - surfaceRect.top,
      right: r.right - surfaceRect.left,
      bottom: r.bottom - surfaceRect.top
    };
    const hit = !(it.right < box.left || it.left > box.right || it.bottom < box.top || it.top > box.bottom);
    item.classList.toggle('selected', hit);
    if (hit) selectedIds.add(item.getAttribute('data-id'));
  });
}

function selectAllDesktopItems() {
  selectedIds.clear();
  desktopIcons.querySelectorAll('.desktop-item').forEach(item => {
    item.classList.add('selected');
    selectedIds.add(item.getAttribute('data-id'));
  });
  selectedItemId = selectedIds.size === 1 ? [...selectedIds][0] : null;
}

desktopSurface.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  if (e.target.closest('.desktop-item')) return;
  if (e.target.closest('.context-menu')) return;

  marqueeActive = true;
  marqueeStart = surfacePoint(e);
  selectionBox.style.display = 'block';
  selectionBox.style.left = `${marqueeStart.x}px`;
  selectionBox.style.top = `${marqueeStart.y}px`;
  selectionBox.style.width = '0px';
  selectionBox.style.height = '0px';
  e.preventDefault();
});

// Рамка выделения. Общий mousemove для неё и для переноса иконок
// зарегистрирован выше (updateMarquee).
function updateMarquee(e) {
  if (!marqueeActive) return;
  const p = surfacePoint(e);
  const left = Math.min(p.x, marqueeStart.x);
  const top = Math.min(p.y, marqueeStart.y);
  const width = Math.abs(p.x - marqueeStart.x);
  const height = Math.abs(p.y - marqueeStart.y);

  selectionBox.style.left = `${left}px`;
  selectionBox.style.top = `${top}px`;
  selectionBox.style.width = `${width}px`;
  selectionBox.style.height = `${height}px`;

  markMarqueeSelection({ left, top, right: left + width, bottom: top + height });
}

window.addEventListener('mouseup', () => {
  if (!marqueeActive) return;
  marqueeActive = false;
  selectionBox.style.display = 'none';

  selectedItemId = selectedIds.size === 1 ? [...selectedIds][0] : null;
  if (selectedIds.size > 0) {
    suppressClickClear = true;
  } else {
    selectedIds.clear();
    desktopIcons.querySelectorAll('.desktop-item').forEach(it => it.classList.remove('selected'));
  }
});

window.addEventListener('click', () => {
  closeContextMenus();
  if (suppressClickClear) {
    suppressClickClear = false;
    return;
  }
  selectedItemId = null;
  selectedIds.clear();
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
  } else if (itemCtxTarget.isDirectory) {
    openWindow('files');
  } else {
    const res = await ipcRenderer.invoke('fs:read-file', itemCtxTarget.name);
    if (res.success) {
      openWindow('editor', { filename: itemCtxTarget.name, content: res.content });
    }
  }
  closeContextMenus();
});

async function renameWorkspaceItem(target = null) {
  const targets = getFileActionTargets(target);
  if (!targets.length) return;
  closeContextMenus();

  for (const t of targets) {
    const oldName = t.name;
    const newName = await showPrompt('Переименование', oldName, 'Введите новое имя файла или папки:');
    if (!newName || newName === oldName) continue;
    const res = await ipcRenderer.invoke('fs:rename', { oldName, newName });
    if (res && res.success === false) {
      await showConfirm('Не удалось переименовать', res.message || 'Файл не найден');
      continue;
    }
    await refreshDesktopFiles();
  }
}

async function deleteWorkspaceItem(target = null) {
  const targets = getFileActionTargets(target);
  if (!targets.length) return;
  closeContextMenus();

  const names = targets.map(t => t.name);
  const question = names.length > 1
    ? `Удалить выбранные объекты (${names.length}) безвозвратно?\n\n${names.join('\n')}`
    : `Удалить "${names[0]}" безвозвратно?`;

  const ok = await showConfirm('Удаление', question);
  if (!ok) return;

  for (const name of names) {
    try {
      await ipcRenderer.invoke('fs:delete', name);
    } catch (_) {}
  }

  selectedIds.clear();
  selectedItemId = null;
  desktopIcons.querySelectorAll('.desktop-item').forEach(it => it.classList.remove('selected'));
  await refreshDesktopFiles();
}

document.getElementById('itemCtxRename').addEventListener('click', () => renameWorkspaceItem(itemCtxTarget));

document.getElementById('itemCtxDelete').addEventListener('click', () => deleteWorkspaceItem(itemCtxTarget));

// Create Desktop Items with In-App Prompt
// Шаблоны файлов: тип определяется по расширению, которое вводит пользователь
const FILE_TEMPLATES = {
  '.py': { label: 'Python', name: 'solution.py', content: '# Решение олимпиадной задачи на Python\nimport sys\n\ndef solve():\n    pass\n\nif __name__ == "__main__":\n    solve()\n' },
  '.pyw': { label: 'Python', name: 'solution.pyw', content: 'import sys\n\ndef solve():\n    pass\n\nif __name__ == "__main__":\n    solve()\n' },
  '.cpp': { label: 'C++', name: 'task.cpp', content: '#include <iostream>\nusing namespace std;\n\nint main() {\n    ios_base::sync_with_stdio(false);\n    cin.tie(NULL);\n    cout << "Ready!" << endl;\n    return 0;\n}\n' },
  '.cc': { label: 'C++', name: 'task.cc', content: '#include <iostream>\nusing namespace std;\n\nint main() {\n    return 0;\n}\n' },
  '.cxx': { label: 'C++', name: 'task.cxx', content: '#include <iostream>\n\nint main() {\n    return 0;\n}\n' },
  '.c': { label: 'C', name: 'task.c', content: '#include <stdio.h>\n\nint main(void) {\n    printf("Ready!\\n");\n    return 0;\n}\n' },
  '.h': { label: 'C/C++ заголовок', name: 'header.h', content: '#ifndef HEADER_H\n#define HEADER_H\n\n#endif\n' },
  '.hpp': { label: 'C++ заголовок', name: 'header.hpp', content: '#pragma once\n' },
  '.pas': { label: 'Pascal', name: 'task.pas', content: "program Olympiad;\nbegin\n    writeln('Решение');\nend.\n" },
  '.java': { label: 'Java', name: 'Main.java', content: 'import java.util.Scanner;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner in = new Scanner(System.in);\n    }\n}\n' },
  '.cs': { label: 'C#', name: 'Program.cs', content: 'using System;\n\nclass Program\n{\n    static void Main()\n    {\n        Console.WriteLine("Ready!");\n    }\n}\n' },
  '.js': { label: 'JavaScript', name: 'script.js', content: 'function solve() {\n    \n}\n\nsolve();\n' },
  '.txt': { label: 'текстовый', name: 'notes.txt', content: 'Заметки решения:\n' },
  '.md': { label: 'Markdown', name: 'notes.md', content: '# Заметки\n\n' },
  '.json': { label: 'JSON', name: 'data.json', content: '{\n  \n}\n' },
  '.html': { label: 'HTML', name: 'page.html', content: '<!DOCTYPE html>\n<html lang="ru">\n<head>\n  <meta charset="UTF-8">\n  <title>Страница</title>\n</head>\n<body>\n  \n</body>\n</html>\n' },
  '.css': { label: 'CSS', name: 'style.css', content: 'body {\n  margin: 0;\n}\n' }
};

const PRESET_CREATE_TYPES = {
  python: '.py',
  cpp: '.cpp',
  c: '.c',
  pascal: '.pas',
  java: '.java',
  csharp: '.cs',
  text: '.txt'
};

function detectExtension(filename) {
  const match = String(filename || '').trim().toLowerCase().match(/(\.[a-z0-9]+)$/);
  return match ? match[1] : '';
}

window.createDesktopItem = async function(type) {
  closeContextMenus();

  if (type === 'folder') {
    const folderName = await showPrompt('Новая папка', 'Новая папка', 'Введите имя новой папки:');
    if (!folderName) return;
    const res = await ipcRenderer.invoke('fs:create-folder', folderName);
    if (res && res.success === false) {
      await showConfirm('Не удалось создать папку', res.message || 'Папка уже существует');
      return;
    }
    await refreshDesktopFiles();
    return;
  }

  const presetExt = PRESET_CREATE_TYPES[type];
  const preset = presetExt ? FILE_TEMPLATES[presetExt] : null;
  const defaultName = preset ? preset.name : 'solution.py';
  const title = type === 'custom'
    ? 'Новый файл (любое расширение)'
    : `Новый файл: ${preset ? preset.label : type}`;
  const subText = type === 'custom'
    ? 'Введите имя с расширением — шаблон подставится сам (.py, .cpp, .c, .pas, .java, .cs, .js, .txt и др.):'
    : `Введите имя файла (можно с другим расширением — шаблон подставится автоматически):`;

  const enteredName = await showPrompt(title, defaultName, subText);
  if (!enteredName) return;

  // Расширение из имени имеет приоритет над выбранным в меню
  const userExt = detectExtension(enteredName);
  const template = FILE_TEMPLATES[userExt] || preset || FILE_TEMPLATES['.txt'];

  // Как в Windows: если расширение не введено — подставляем своё
  const filename = (!userExt && presetExt) ? `${enteredName}${presetExt}` : enteredName;

  const res = await ipcRenderer.invoke('fs:create-file', { filename, content: template.content });
  if (res && res.success === false) {
    await showConfirm('Не удалось создать файл', res.message || 'Файл с таким именем уже существует');
    return;
  }

  await refreshDesktopFiles();
  openWindow('editor', { filename, content: template.content });
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
      icon: getRuntimeIcon(scId, sc),
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

// Мини-меню дока собирается динамически из уже существующих классов
// (.context-menu / .context-item / .context-separator / .context-icon)
let dockContextMenu = null;

function closeDockContextMenu() {
  if (!dockContextMenu) return;
  if (dockContextMenu.parentNode) dockContextMenu.parentNode.removeChild(dockContextMenu);
  dockContextMenu = null;
}

function makeDockMenuItem(icon, label, danger, onClick) {
  const item = document.createElement('div');
  item.className = 'context-item' + (danger ? ' danger' : '');
  const ic = document.createElement('span');
  ic.className = 'context-icon';
  ic.textContent = icon;
  item.appendChild(ic);
  item.appendChild(document.createTextNode(' ' + label));
  item.addEventListener('click', (ev) => {
    ev.stopPropagation();
    closeDockContextMenu();
    onClick();
  });
  return item;
}

function makeDockMenuSeparator() {
  const sep = document.createElement('div');
  sep.className = 'context-separator';
  return sep;
}

function openDockContextMenu(appKey, anchorRect) {
  closeDockContextMenu();
  closeContextMenus();
  closeMenubarMenus();

  const sc = runningExternalApps.get(appKey);
  const name = (WINDOWS_MAP[appKey] && (TOUCHBAR_APPS[appKey] || {}).name) || (sc && sc.name) || appKey;
  const isWindow = !!WINDOWS_MAP[appKey];

  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.style.position = 'absolute';
  menu.style.display = 'block';

  // Показать / Открыть
  menu.appendChild(makeDockMenuItem('↗', isWindow ? 'Показать' : 'Открыть', false, () => {
    if (isWindow) {
      openWindow(appKey);
      const win = WINDOWS_MAP[appKey];
      if (win && win.classList.contains('minimized')) win.classList.remove('minimized');
    } else {
      window.handleDockItemClick(appKey);
    }
  }));

  menu.appendChild(makeDockMenuSeparator());

  // Скрыть (свернуть окно)
  menu.appendChild(makeDockMenuItem('—', 'Скрыть', false, () => {
    if (isWindow) {
      minimizeWindow(appKey);
    } else {
      // Внешнее приложение просто убираем из дока, само оно продолжает работать
      runningExternalApps.delete(appKey);
      renderDock();
    }
  }));

  // Закрыть
  menu.appendChild(makeDockMenuItem('✕', 'Закрыть', true, () => {
    if (isWindow) {
      closeWindow(appKey);
    } else {
      runningExternalApps.delete(appKey);
      renderDock();
    }
  }));

  menu.setAttribute('data-app', appKey);
  menu.setAttribute('title', name);
  document.body.appendChild(menu);

  // Позиционируем над иконкой дока, не давая уехать за края экрана
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  const left = Math.max(6, Math.min(window.innerWidth - mw - 6, anchorRect.left + anchorRect.width / 2 - mw / 2));
  const top = Math.max(6, anchorRect.top - mh - 10);
  menu.style.left = `${left + window.scrollX}px`;
  menu.style.top = `${top + window.scrollY}px`;

  dockContextMenu = menu;
}

// Правый клик по иконке дока больше не закрывает приложение — показывает меню
window.handleDockItemContextMenu = function(e, appKey) {
  e.preventDefault();
  e.stopPropagation();
  const anchor = (e.currentTarget || e.target).getBoundingClientRect
    ? (e.currentTarget || e.target).getBoundingClientRect()
    : { left: e.clientX, top: e.clientY, width: 0, height: 0 };
  openDockContextMenu(appKey, anchor);
};

// Левый клик по иконке дока (как в macOS): уже открытое — показать, нет — запустить
window.handleDockItemClick = function(appKey) {
  const win = WINDOWS_MAP[appKey];
  if (win) {
    if (win.style.display === 'none') {
      openWindow(appKey);
    } else if (win.classList.contains('minimized')) {
      win.classList.remove('minimized');
      bringToFront(win);
      syncFullscreenState();
      renderTouchBar();
    } else {
      // Клик по иконке не прячет приложение — просто поднимаем окно
      bringToFront(win);
      syncFullscreenState();
    }
    return;
  }

  // Внешнее приложение: уже запущено — показываем «Мои файлы», не перезапуская
  if (runningExternalApps.has(appKey)) {
    openWindow('files');
    return;
  }
  window.handleShortcutClick(appKey);
};

// Короткая анимация «отскока» иконки дока при запуске внешней программы
function bounceDockItem(appKey) {
  if (!dockNavList) return;
  const node = dockNavList.querySelector(`.nav-item[data-app="${appKey}"]`);
  if (!node) return;
  node.classList.add('bounce');
  setTimeout(() => node.classList.remove('bounce'), 750);
}

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
  bounceDockItem(scId);

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
  refreshRuntimeIcons();
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

// Ссылки и контест открываем встроенным окном браузера оболочки,
// а не отдельным kiosk-окном главного процесса.
ipcRenderer.on('open-url', (event, url) => {
  try {
    openWindow('browser', { url: url || currentConfig.contestUrl || 'https://contest.yandex.ru' });
  } catch (err) {
    console.warn('[Shell] open-url failed:', err);
  }
});

// Неброское предупреждение внизу экрана, если часть программ не установлена
let envWarningEl = null;
let envWarningText = null;
let envWarningShownOnce = false;

const ENV_APP_TITLES = {
  pycharm: 'PyCharm',
  vscode: 'Visual Studio Code',
  codeblocks: 'Code::Blocks',
  pascal: 'PascalABC',
  idle: 'Python IDLE',
  python: 'Python',
  contest: 'Яндекс Контест'
};

function envTitle(appId) {
  if (ENV_APP_TITLES[appId]) return ENV_APP_TITLES[appId];
  const sc = (currentConfig.shortcuts || []).find(s => s.id === appId);
  return (sc && sc.name) || appId;
}

function showEnvWarning(missing) {
  if (!missing || !missing.length) {
    hideEnvWarning();
    return;
  }
  if (!envWarningEl) {
    // Используем существующие классы .toast-banner / .toast-text
    const banner = document.createElement('div');
    banner.className = 'toast-banner';
    banner.id = 'envWarningBanner';
    banner.style.top = 'auto';
    banner.style.bottom = '96px';

    const content = document.createElement('div');
    content.className = 'toast-content';

    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('class', 'toast-icon');
    icon.setAttribute('width', '18');
    icon.setAttribute('height', '18');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('fill', 'none');
    icon.setAttribute('stroke', 'currentColor');
    icon.setAttribute('stroke-width', '1.75');
    icon.setAttribute('stroke-linecap', 'round');
    icon.setAttribute('stroke-linejoin', 'round');
    icon.innerHTML = '<circle cx="12" cy="12" r="9"/><path d="M12 8v5"/><path d="M12 16h.01"/>';
    content.appendChild(icon);

    const text = document.createElement('div');
    text.className = 'toast-text';
    content.appendChild(text);

    const close = document.createElement('button');
    close.className = 'toast-close';
    close.innerHTML = '&times;';
    close.addEventListener('click', hideEnvWarning);

    banner.appendChild(content);
    banner.appendChild(close);
    document.body.appendChild(banner);
    envWarningEl = banner;
    envWarningText = text;
  }

  const names = missing.map(envTitle).join(', ');
  if (envWarningText) {
    envWarningText.textContent = `Не найдены программы: ${names}. Установка доступна преподавателю.`;
  }
  envWarningEl.classList.add('active');
}

function hideEnvWarning() {
  if (envWarningEl) envWarningEl.classList.remove('active');
}

ipcRenderer.on('env-status', (event, status) => {
  const missing = Array.isArray(status && status.missing) ? status.missing : [];
  if (missing.length === 0) {
    hideEnvWarning();
    return;
  }
  // Плашку показываем один раз, чтобы не мешать работе
  if (envWarningShownOnce) return;
  envWarningShownOnce = true;
  showEnvWarning(missing);
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

// ==========================================================================
// ЯЗЫК ВВОДА В ВЕРХНЕЙ ПАНЕЛИ (рядом с часами)
// ==========================================================================

// Узел в разметке отсутствует — создаём его динамически и вставляем
// в .menubar-right перед #mbClock. Если API раскладки недоступен — не показываем.
function initLangIndicator() {
  const clock = document.getElementById('mbClock');
  const host = (clock && clock.parentElement) || document.querySelector('.menubar-right');
  if (!host) return;

  const existing = document.getElementById('mbLang');
  if (existing) return;

  const kb = navigator.keyboard;
  if (!kb || typeof kb.getLayoutMap !== 'function') return;

  const node = document.createElement('span');
  node.className = 'mb-right-item';
  node.id = 'mbLang';
  node.title = 'Язык ввода';
  node.textContent = 'EN';
  if (clock && clock.parentElement === host) host.insertBefore(node, clock);
  else host.appendChild(node);

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Process' || /^[a-zA-Z]$/.test(e.key)) updateLangFromEvent(e);
  });

  if (typeof kb.addEventListener === 'function') {
    try {
      kb.addEventListener('change', () => updateLangFromEvent());
    } catch (_) {
      // Chromium/Electron без события change — не критично, обновимся по keydown
    }
  }

  updateLangFromEvent();
}

// Надёжный источник раскладки: navigator.keyboard.getLayoutMap() по коду клавиши
async function updateLangFromEvent(e) {
  const node = document.getElementById('mbLang');
  if (!node) return;
  const kb = navigator.keyboard;
  if (!kb || typeof kb.getLayoutMap !== 'function') return;
  const code = (e && e.code) ? e.code : 'KeyA';
  try {
    const map = await kb.getLayoutMap();
    if (!map) return;
    const value = map.get(code);
    if (typeof value === 'string' && value) {
      node.textContent = value.toUpperCase();
      node.title = `Язык ввода: ${value.toUpperCase()}`;
    }
  } catch (_) {
    // API может быть недоступен — оставляем предыдущее значение
  }
}

// ==========================================================================
// INIT
// ==========================================================================

initLangIndicator();

// Initialization
renderMenubarMenus();
renderTouchBar();

ipcRenderer.invoke('get-config').then(cfg => {
  if (cfg) {
    currentConfig = { ...currentConfig, ...cfg };
    renderDesktopIcons();
    renderDock();
  }
});

// Реальные иконки установленных программ (с заглушками, если главный процесс их не отдал)
refreshRuntimeIcons();

refreshDesktopFiles();

// Open Contest Browser by default on start
setTimeout(() => {
  openWindow('browser');
}, 400);
