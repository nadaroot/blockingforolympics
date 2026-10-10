const { app, BrowserWindow, ipcMain, desktopCapturer, dialog, screen, globalShortcut } = require('electron');
const path = require('path');
const { spawn, exec, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');

const locker = require('./locker-manager');
const watchdog = require('./watchdog');
const network = require('./network');
const iconCache = require('./icon-cache');
const provisioner = require('./provisioner');
const pycharmLockdown = require('./pycharm-lockdown');
const aiAssistant = require('./ai-assistant');

let shellWindow = null;
let secondaryWindows = [];
let currentConfig = {
  contestUrl: 'https://contest.yandex.ru',
  allowedDomains: ['contest.yandex.ru', 'yandex.ru', 'codeforces.com', 'informatics.msk.ru', 'acmp.ru'],
  masterPassword: 'Extybr',
  shortcuts: []
};
const isWindowed = process.argv.includes('--windowed') || process.argv.includes('--dev');
let isLocked = !isWindowed;
// Закрытие окна разрешено только после ввода пароля разблокировки
let allowWindowClose = false;
let isExamRunning = false;
let currentActiveAppName = 'LOKED Shell';

// Кэш иконок программ: пересчитываем не чаще раза в 10 минут
const ICON_CACHE_TTL_MS = 10 * 60 * 1000;
let iconCacheTTL = { icons: null, at: 0 };

// Последнее состояние окружения (для рендерера и отчётов)
let envState = { apps: [], missing: [], pycharm: {}, checkedAt: null };
let pendingEnvStatus = null;

// Expand Windows environment variables
function expandEnv(str) {
  if (!str) return '';
  return str.replace(/%([^%]+)%/g, (_, n) => process.env[n] || '');
}

// Find existing executable path
function resolveExePath(shortcut) {
  if (shortcut.paths && Array.isArray(shortcut.paths)) {
    for (const p of shortcut.paths) {
      const expanded = expandEnv(p);
      if (expanded.includes('*')) {
        const dir = path.dirname(expanded);
        const basePattern = path.basename(expanded).replace('*', '').toLowerCase();
        if (fs.existsSync(dir)) {
          const files = fs.readdirSync(dir);
          const match = files.find(f => f.toLowerCase().startsWith(basePattern));
          if (match) {
            const full = path.join(dir, match);
            if (fs.existsSync(full)) return full;
          }
        }
      } else if (fs.existsSync(expanded)) {
        return expanded;
      }
    }
  }
  return shortcut.cmd;
}

// Verify if a shortcut actually exists and can be run on this PC
function isShortcutAvailable(shortcut) {
  if (!shortcut || !shortcut.enabled) return false;
  // Websites and URL shortcuts are always available
  if (shortcut.type === 'browser' || shortcut.type === 'url' || shortcut.url) return true;
  // Custom shortcuts added by the admin are always preserved
  if (shortcut.id && shortcut.id.startsWith('custom_')) return true;

  const cmd = (shortcut.cmd || '').toLowerCase();
  if (cmd === 'calc.exe' || cmd === 'notepad.exe') return true;

  if (cmd === 'python.exe') {
    try {
      execSync('python --version', { stdio: 'ignore' });
      return true;
    } catch (_) {
      // Check if custom paths exist
    }
  }

  const resolved = resolveExePath(shortcut);
  if (resolved && fs.existsSync(resolved)) {
    return true;
  }

  return false;
}

function getFilteredConfig() {
  const filtered = (currentConfig.shortcuts || []).filter(isShortcutAvailable);
  return {
    ...currentConfig,
    shortcuts: filtered
  };
}

// Реестр встроенных доменов для иконок, которых нет на этом ПК.
// Один раз внедряем в страницу оболочки после её загрузки.
async function injectIconDomains(win) {
  try {
    const map = {
      pycharm: 'jetbrains.com',
      vscode: 'code.visualstudio.com',
      codeblocks: 'codeblocks.org',
      pascal: 'pascalabc.net',
      idle: 'python.org',
      contest: 'contest.yandex.ru'
    };
    await win.webContents.executeJavaScript(`window.LOKED_ICON_DOMAINS = ${JSON.stringify(map)}`);
    console.log('[Icons] Реестр доменов внедрён в оболочку');
  } catch (err) {
    console.warn('[Icons] Не удалось внедрить реестр доменов:', err && err.message);
  }
}

// Иконки всех доступных ярлыков: { [shortcutId]: 'file:///...' }. Результат кэшируется на 10 минут.
async function collectShortcutIcons(force = false) {
  const now = Date.now();
  if (!force && iconCacheTTL.icons && (now - iconCacheTTL.at) < ICON_CACHE_TTL_MS) {
    return iconCacheTTL.icons;
  }

  const shortcuts = getFilteredConfig().shortcuts || [];
  try {
    const icons = await iconCache.resolveShortcutIcons(shortcuts, resolveExePath);
    const map = (icons && typeof icons === 'object') ? icons : {};
    iconCacheTTL = { icons: map, at: now };
    console.log(`[Icons] resolved: ${Object.keys(map).length}`);
    return map;
  } catch (err) {
    console.warn('[Icons] Ошибка получения иконок:', err && err.message);
    return iconCacheTTL.icons || {};
  }
}

// Таблица распространённых раскладок: тег Windows -> HKL
const LAYOUT_HKL = {
  'ru': '00000419', 'ru-RU': '00000419',
  'en': '00000409', 'en-US': '00000409',
  'uk': '00000422', 'uk-UA': '00000422',
  'be': '00000423', 'be-BY': '00000423',
  'kk': '0000043F', 'kk-KZ': '0000043F',
  'uz': '00000843', 'uz-UZ': '00000843',
  'de': '00000407', 'de-DE': '00000407',
  'fr': '0000040C', 'fr-FR': '0000040C',
  'es': '0000040A', 'es-ES': '0000040A',
  'tr': '00000443', 'tr-TR': '00000443'
};

const LANG_LABELS = {
  ru: 'Русский', uk: 'Украинский', be: 'Белорусский', kk: 'Казахский',
  uz: 'Узбекский', de: 'Немецкий', fr: 'Французский', es: 'Испанский',
  tr: 'Турецкий', en: 'English'
};

// Запуск PowerShell с Base64-командой (без экранирования кавычек)
function runEncodedPowerShell(script, timeout = 30000) {
  return new Promise((resolve) => {
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    exec(
      `powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`,
      { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || '') });
      }
    );
  });
}

// Языки ввода, установленные в системе
async function listSystemLanguages() {
  const probe = await runEncodedPowerShell('Get-WinUserLanguageList | ForEach-Object { $_.LanguageTag }');
  const tags = probe.stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (!tags.length) return [];
  return tags.map((tag) => {
    const base = tag.split('-')[0].toLowerCase();
    return {
      tag,
      hkl: LAYOUT_HKL[tag] || LAYOUT_HKL[base] || '',
      label: LANG_LABELS[base] || tag
    };
  });
}

// Активация раскладки в окне оболочки: AttachThreadInput + ActivateKeyboardLayout
async function setKeyboardLayout(hkl) {
  const script = [
    `$hex = '${hkl}'`,
    'Add-Type -TypeDefinition @"',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public static class LokedKeyboardLayout {',
    '  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
    '  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint procId);',
    '  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);',
    '  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();',
    '  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr LoadKeyboardLayout(string pwszKLID, uint Flags);',
    '  [DllImport("user32.dll")] public static extern IntPtr ActivateKeyboardLayout(IntPtr hkl, uint Flags);',
    '  public static void Set(string hex) {',
    '    IntPtr fg = GetForegroundWindow();',
    '    uint procId;',
    '    uint tid = GetWindowThreadProcessId(fg, out procId);',
    '    uint cur = GetCurrentThreadId();',
    '    bool attached = false;',
    '    if (tid != 0 && tid != cur) attached = AttachThreadInput(cur, tid, true);',
    '    try {',
    '      IntPtr hkl = LoadKeyboardLayout(hex, 1);',
    '      if (hkl != IntPtr.Zero) ActivateKeyboardLayout(hkl, 0x00000100);',
    '    } finally {',
    '      if (attached) AttachThreadInput(cur, tid, false);',
    '    }',
    '  }',
    '}',
    '"@',
    '[LokedKeyboardLayout]::Set($hex)',
    'Write-Output "OK"'
  ].join('\n');

  const result = await runEncodedPowerShell(script);
  if (result.ok && result.stdout.includes('OK')) {
    console.log(`[Lang] Раскладка переключена: ${hkl}`);
    return { success: true };
  }
  const message = (result.stderr || result.stdout || '').trim().slice(0, 400);
  console.warn(`[Lang] Не удалось переключить раскладку: ${message}`);
  return { success: false, message: message || 'Неизвестная ошибка PowerShell' };
}

// Сборка статуса окружения для рендерера и конфига
function buildEnvStatus(apps, pycharm) {
  const list = Array.isArray(apps) ? apps : [];
  return {
    apps: list.map((a) => ({
      id: a.id,
      title: a.title,
      installed: !!a.installed,
      version: a.version || null,
      path: a.path || null
    })),
    missing: list.filter((a) => !a.installed).map((a) => a.id),
    pycharm: pycharm || {}
  };
}

// Отправка статуса окружения в оболочку (с ожиданием готовности рендерера)
function sendEnvStatus(status) {
  if (!shellWindow || shellWindow.isDestroyed()) return;

  const deliver = () => {
    try {
      if (shellWindow && !shellWindow.isDestroyed()) {
        shellWindow.webContents.send('env-status', status);
      }
    } catch (err) {
      console.warn('[Env] Не удалось отправить статус в оболочку:', err && err.message);
    }
  };

  try {
    if (shellWindow.webContents.isLoading()) {
      pendingEnvStatus = status;
      if (!shellWindow.webContents.envStatusHooked) {
        shellWindow.webContents.envStatusHooked = true;
        shellWindow.webContents.once('did-finish-load', () => {
          try { shellWindow.webContents.envStatusHooked = false; } catch (_) {}
          if (pendingEnvStatus) {
            const queued = pendingEnvStatus;
            pendingEnvStatus = null;
            sendEnvStatus(queued);
          }
        });
      }
      return;
    }
  } catch (_) {}

  deliver();
}

// Только проверка окружения (без установки) — вызывается при старте приложения
async function runEnvDetect() {
  try {
    const apps = await provisioner.detectAll();
    let pycharm = {};
    try {
      pycharm = await pycharmLockdown.auditPyCharm();
    } catch (err) {
      pycharm = { installed: false, problems: [`Ошибка аудита PyCharm: ${err && err.message}`] };
    }

    const status = buildEnvStatus(apps, pycharm);
    envState = { ...status, checkedAt: new Date().toISOString() };
    currentConfig.provisioning = { checkedAt: envState.checkedAt, missing: status.missing };

    const installedCount = status.apps.length - status.missing.length;
    console.log(`[Env] Проверка окружения: установлено ${installedCount} из ${status.apps.length}`);
    console.log(`[Env] Отсутствуют: ${status.missing.length ? status.missing.join(', ') : 'нет'}`);

    sendEnvStatus(status);
    return status;
  } catch (err) {
    console.warn('[Env] Ошибка проверки окружения:', err && err.message);
    return null;
  }
}

// Multi-Monitor Window Management
function createAllShellWindows() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const displays = screen.getAllDisplays();

  // 1. Primary Monitor (Interactive Olympiad Desktop)
  const winConfig = isWindowed ? {
    width: 1280,
    height: 800,
    frame: true,
    resizable: true,
    movable: true,
    fullscreen: false,
    kiosk: false,
    alwaysOnTop: false,
    title: 'LOKED (Оконный режим)'
  } : {
    frame: false,
    fullscreen: true,
    kiosk: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    closable: false,
    autoHideMenuBar: true,
    title: 'LOKED'
  };

  shellWindow = new BrowserWindow({
    ...winConfig,
    backgroundColor: '#050505',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webviewTag: true
    }
  });

  if (isWindowed) {
    shellWindow.center();
  } else {
    shellWindow.setFullScreen(true);
    shellWindow.maximize();
    shellWindow.setAlwaysOnTop(true);
  }

  shellWindow.loadFile(path.join(__dirname, 'shell', 'index.html'));

  // Внедряем реестр доменов один раз, когда страница оболочки уже загружена
  shellWindow.webContents.once('did-finish-load', () => {
    injectIconDomains(shellWindow);
  });

  shellWindow.on('closed', () => {
    shellWindow = null;
    closeSecondaryWindows();
  });

  // ЗАЩИТА: окно нельзя закрыть, пока идёт олимпиада. Попытка закрытия
  // возвращает оболочку и просит пароль (тот же Ctrl+Alt+Shift+L экран).
  shellWindow.on('close', (e) => {
    if (allowWindowClose) return;
    if (!isLocked) {
      allowWindowClose = true;
      return;
    }
    e.preventDefault();
    try {
      shellWindow.show();
      shellWindow.focus();
      shellWindow.webContents.send('request-exit-unlock');
    } catch (_) {}
  });

  // 2. Secondary Monitors (Full cover lock screens)
  if (!isWindowed) {
    createSecondaryWindows(displays, primaryDisplay.id);
  }
}

function createSecondaryWindows(displays, primaryId) {
  closeSecondaryWindows();
  for (const display of displays) {
    if (display.id === primaryId) continue;

    const secWin = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      frame: false,
      fullscreen: true,
      kiosk: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      autoHideMenuBar: true,
      backgroundColor: '#050505',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    secWin.setFullScreen(true);
    secWin.maximize();
    secWin.setAlwaysOnTop(true);
    secWin.loadFile(path.join(__dirname, 'shell', 'secondary.html'));
    secondaryWindows.push(secWin);
  }
}

function closeSecondaryWindows() {
  for (const win of secondaryWindows) {
    try {
      if (!win.isDestroyed()) win.close();
    } catch (_) {}
  }
  secondaryWindows = [];
}

// Ссылки и контест открываются штатным окном оболочки (со «светофорными» кнопками),
// поэтому отдельное kiosk-окно браузера больше не используется.
function sendOpenUrl(urlToOpen) {
  const target = urlToOpen || currentConfig.contestUrl || 'https://contest.yandex.ru';
  if (shellWindow && !shellWindow.isDestroyed()) {
    shellWindow.webContents.send('open-url', target);
  }
}

const workspaceDir = path.join(os.homedir(), 'Desktop', 'LOKED_Workspace');
function ensureWorkspace() {
  try {
    // Рабочая папка должна быть пустой: никаких образцов и подсказок внутри
    if (!fs.existsSync(workspaceDir)) {
      fs.mkdirSync(workspaceDir, { recursive: true });
    }
  } catch (e) {
    console.warn('[Workspace] Error initializing workspace dir:', e);
  }
}
ensureWorkspace();

// Setup IPC handlers
function setupIPC() {
  ipcMain.handle('get-config', () => {
    return getFilteredConfig();
  });

  // Desktop File System Handlers
  ipcMain.handle('fs:list', async () => {
    ensureWorkspace();
    try {
      const files = fs.readdirSync(workspaceDir);
      return files.map(name => {
        const full = path.join(workspaceDir, name);
        const stat = fs.statSync(full);
        return {
          name,
          isDirectory: stat.isDirectory(),
          size: stat.size,
          mtime: stat.mtimeMs,
          ext: path.extname(name).toLowerCase()
        };
      });
    } catch (e) {
      return [];
    }
  });

  ipcMain.handle('fs:read-file', async (event, filename) => {
    try {
      const full = path.join(workspaceDir, path.basename(filename));
      if (fs.existsSync(full)) {
        return { success: true, content: fs.readFileSync(full, 'utf-8'), filename: path.basename(filename) };
      }
      return { success: false, message: 'Файл не найден' };
    } catch (e) {
      return { success: false, message: e.message };
    }
  });

  ipcMain.handle('fs:save-file', async (event, { filename, content }) => {
    try {
      const full = path.join(workspaceDir, path.basename(filename));
      fs.writeFileSync(full, content, 'utf-8');
      return { success: true };
    } catch (e) {
      return { success: false, message: e.message };
    }
  });

  ipcMain.handle('fs:create-file', async (event, { filename, content = '' }) => {
    try {
      const safeName = path.basename(filename);
      const full = path.join(workspaceDir, safeName);
      if (fs.existsSync(full)) {
        return { success: false, message: 'Файл с таким именем уже существует' };
      }
      fs.writeFileSync(full, content, 'utf-8');
      return { success: true, name: safeName };
    } catch (e) {
      return { success: false, message: e.message };
    }
  });

  ipcMain.handle('fs:create-folder', async (event, folderName) => {
    try {
      const safeName = path.basename(folderName);
      const full = path.join(workspaceDir, safeName);
      if (!fs.existsSync(full)) {
        fs.mkdirSync(full, { recursive: true });
        return { success: true, name: safeName };
      }
      return { success: false, message: 'Папка с таким именем уже существует' };
    } catch (e) {
      return { success: false, message: e.message };
    }
  });

  ipcMain.handle('fs:delete', async (event, itemName) => {
    try {
      const safeName = path.basename(itemName);
      const full = path.join(workspaceDir, safeName);
      if (fs.existsSync(full)) {
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          fs.rmdirSync(full, { recursive: true });
        } else {
          fs.unlinkSync(full);
        }
        return { success: true };
      }
      return { success: false, message: 'Элемент не найден' };
    } catch (e) {
      return { success: false, message: e.message };
    }
  });

  ipcMain.handle('fs:rename', async (event, { oldName, newName }) => {
    try {
      const oldPath = path.join(workspaceDir, path.basename(oldName));
      const newPath = path.join(workspaceDir, path.basename(newName));
      if (fs.existsSync(oldPath)) {
        fs.renameSync(oldPath, newPath);
        return { success: true };
      }
      return { success: false, message: 'Файл не найден' };
    } catch (e) {
      return { success: false, message: e.message };
    }
  });

  ipcMain.handle('fs:get-workspace-path', () => workspaceDir);

  // Иконки реальных программ: { [shortcutId]: 'file:///...' }
  ipcMain.handle('icons:resolve', async () => {
    return collectShortcutIcons(false);
  });

  // Проверка установленного олимпиадного ПО
  ipcMain.handle('env:detect', async () => {
    const status = await runEnvDetect();
    return status || { apps: [], missing: envState.missing, pycharm: {} };
  });

  // Полная подготовка окружения: установка + настройка PyCharm
  ipcMain.handle('env:ensure', async (event, options = {}) => {
    const opts = options || {};
    console.log('[Env] Запрошена подготовка окружения (autoInstall: ' + (!!opts.autoInstall) + ')');

    let report = null;
    try {
      report = await provisioner.ensureEnvironment({
        autoInstall: !!opts.autoInstall,
        hardenPyCharm: opts.hardenPyCharm !== false,
        blockNetwork: !!opts.blockNetwork,
        onProgress: (step) => {
          console.log(`[Env] ${step.step}: ${step.message}`);
        }
      });
    } catch (err) {
      console.warn('[Env] Ошибка подготовки окружения:', err && err.message);
      return { success: false, message: `Ошибка подготовки окружения: ${err && err.message}`, apps: [], missing: envState.missing, pycharm: {} };
    }

    const status = buildEnvStatus(report.apps, report.pycharm);
    envState = { ...status, checkedAt: report.checkedAt || new Date().toISOString() };
    currentConfig.provisioning = { checkedAt: envState.checkedAt, missing: status.missing };

    for (const errItem of report.errors || []) {
      console.warn(`[Env] ${errItem}`);
    }
    console.log(`[Env] Подготовка завершена. Отсутствуют: ${status.missing.length ? status.missing.join(', ') : 'нет'}`);

    sendEnvStatus(status);

    return {
      success: true,
      checkedAt: envState.checkedAt,
      apps: status.apps,
      missing: status.missing,
      pycharm: status.pycharm,
      installed: report.installed || [],
      errors: report.errors || []
    };
  });

  ipcMain.handle('launch-app', async (event, shortcutId) => {
    const sc = (currentConfig.shortcuts || []).find(s => s.id === shortcutId);
    if (!sc) return { success: false, message: 'Ярлык не найден' };

    if (sc.type === 'browser' || sc.type === 'url' || sc.url) {
      // Ссылки открываются штатным окном оболочки, отдельный браузер не нужен
      sendOpenUrl(sc.url || currentConfig.contestUrl);
      currentActiveAppName = sc.name;
      network.sendHeartbeat({ activeApp: sc.name });
      return { success: true };
    }

    const exePath = resolveExePath(sc);
    console.log(`[Launch] Executing ${sc.name}: ${exePath}`);

    try {
      if (sc.args && Array.isArray(sc.args)) {
        spawn(exePath, sc.args, { detached: true, stdio: 'ignore' }).unref();
      } else {
        exec(`start "" /MAX "${exePath}"`, (err) => {
          if (err) console.error(`[Launch] Error:`, err);
        });
      }

      currentActiveAppName = sc.name;

      if (shellWindow) {
        shellWindow.setAlwaysOnTop(false);
        try {
          const handleBuf = shellWindow.getNativeWindowHandle();
          const hwndVal = handleBuf.readBigInt64LE ? handleBuf.readBigInt64LE() : handleBuf.readInt32LE();
          locker.sendToBottom(hwndVal);
        } catch (_) {}
      }
      network.sendHeartbeat({ activeApp: sc.name });
      return { success: true };
    } catch (err) {
      return { success: false, message: `Ошибка запуска: ${err.message}` };
    }
  });

  ipcMain.on('open-contest', (event, url) => {
    sendOpenUrl(url);
  });

  // Заглушка: отдельного браузера больше нет, просто возвращаем оболочку на экран
  ipcMain.on('close-browser', () => {
    if (shellWindow && !shellWindow.isDestroyed()) {
      shellWindow.show();
      shellWindow.focus();
    }
  });

  ipcMain.handle('verify-unlock', async (event, password) => {
    const expected = currentConfig.masterPassword || 'Extybr';
    if (password === expected) {
      isLocked = false;
      allowWindowClose = true; // после разблокировки паролем приложение можно закрыть
      locker.unlock();
      if (shellWindow) {
        shellWindow.setKiosk(false);
        shellWindow.setFullScreen(false);
        shellWindow.setAlwaysOnTop(false);
        shellWindow.setClosable(true);
      }
      for (const sec of secondaryWindows) {
        try {
          sec.setKiosk(false);
          sec.setFullScreen(false);
          sec.setAlwaysOnTop(false);
        } catch (_) {}
      }
      network.sendHeartbeat({ isLocked: false, status: 'ready' });
      return { success: true };
    }
    return { success: false, message: 'Неверный пароль' };
  });

  ipcMain.on('exit-loked', () => {
    app.quit();
  });

  // Скрытый ИИ-помощник: запрос выделенного кода + задания
  ipcMain.handle('ai:ask', async (event, payload) => {
    const p = payload || {};
    return aiAssistant.ask({ prompt: p.prompt || '', code: p.code || '' });
  });

  ipcMain.handle('ai:status', async () => {
    return aiAssistant.getStatus();
  });

  // Список языков ввода в системе (для меню переключения в оболочке)
  ipcMain.handle('lang:list', async () => {
    return listSystemLanguages();
  });

  // Переключение раскладки: HKL активируется для активного окна оболочки
  ipcMain.handle('lang:set', async (event, payload) => {
    const ticket = payload && payload.hkl ? String(payload.hkl) : '';
    if (!/^[0-9a-fA-F]{8}$/.test(ticket)) {
      return { success: false, message: 'Некорректный идентификатор раскладки' };
    }
    return setKeyboardLayout(ticket);
  });
}

// Screen capture for Admin view
async function captureDesktop(width = 1280, height = 720) {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width, height }
    });
    if (sources.length > 0) {
      return sources[0].thumbnail.toDataURL();
    }
  } catch (err) {
    console.error('[Capture] Screen capture error:', err);
  }
  return null;
}

let streamIntervalMs = 1200;
let isStreaming = true;
let isCapturing = false;

async function streamTick() {
  if (!isStreaming) return;
  if (!isCapturing) {
    isCapturing = true;
    try {
      const frame = await captureDesktop(640, 360);
      if (frame) {
        network.sendScreenFrame(frame, currentActiveAppName);
      }
    } catch (_) {
    } finally {
      isCapturing = false;
    }
  }
  setTimeout(streamTick, streamIntervalMs);
}

// Setup Network Handlers
function setupNetwork() {
  network.on('client:init', (data) => {
    if (data.config) {
      currentConfig = { ...currentConfig, ...data.config };
      iconCacheTTL = { icons: null, at: 0 };
      aiAssistant.configure(currentConfig.ai);
    }
    if (shellWindow) {
      shellWindow.webContents.send('config-update', getFilteredConfig());
      if (data.exam) {
        shellWindow.webContents.send('exam-update', data.exam);
      }
    }
  });

  network.on('config:updated', (newConfig) => {
    currentConfig = { ...currentConfig, ...newConfig };
    aiAssistant.configure(currentConfig.ai);
    // Ярлыки изменились — сбрасываем кэш иконок, чтобы пересчитать при следующем запросе
    iconCacheTTL = { icons: null, at: 0 };
    if (shellWindow) {
      shellWindow.webContents.send('config-update', getFilteredConfig());
    }
  });

  network.on('exam:started', (examData) => {
    isExamRunning = true;
    if (shellWindow) {
      shellWindow.webContents.send('exam-update', examData);
    }
  });

  network.on('exam:tick', (tickData) => {
    if (shellWindow) {
      shellWindow.webContents.send('exam-tick', tickData);
    }
  });

  network.on('exam:ended', () => {
    isExamRunning = false;
    currentActiveAppName = 'LOKED Shell';
    if (shellWindow) {
      shellWindow.webContents.send('exam-ended');
      shellWindow.show();
      shellWindow.focus();
    }
  });

  network.on('command:lock', (data) => {
    isLocked = true;
    locker.lock();
    if (shellWindow) {
      shellWindow.setAlwaysOnTop(true);
      shellWindow.webContents.send('client-locked', data);
    }
    for (const sec of secondaryWindows) {
      try { sec.setAlwaysOnTop(true); } catch (_) {}
    }
  });

  network.on('command:unlock', () => {
    isLocked = false;
    locker.unlock();
    if (shellWindow) {
      shellWindow.setAlwaysOnTop(false);
      shellWindow.webContents.send('client-unlocked');
    }
    for (const sec of secondaryWindows) {
      try { sec.setAlwaysOnTop(false); } catch (_) {}
    }
  });

  network.on('command:take_screenshot', async () => {
    const dataUrl = await captureDesktop(1280, 720);
    if (dataUrl) {
      network.sendScreenshot(dataUrl);
    }
  });

  network.on('command:set_stream_rate', (data) => {
    if (data && data.fps) {
      streamIntervalMs = Math.max(200, Math.round(1000 / data.fps));
    }
  });

  network.on('command:remote_input', (data) => {
    if (!data) return;
    try {
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width, height } = primaryDisplay.bounds;
      const targetX = Math.round((data.normX ?? 0) * width);
      const targetY = Math.round((data.normY ?? 0) * height);

      if (data.action === 'move') {
        locker.mouseMove(targetX, targetY);
      } else if (data.action === 'click') {
        locker.mouseClick(data.button || 'left', targetX, targetY);
      } else if (data.action === 'key' && data.vkCode) {
        locker.keyPress(data.vkCode);
      }
    } catch (e) {
      console.warn('[RemoteInput] Error executing input:', e);
    }
  });

  network.on('command:message', (data) => {
    if (shellWindow) {
      shellWindow.webContents.send('broadcast-message', data.text);
    }
  });

  network.on('command:reboot', () => {
    exec('shutdown /r /t 3 /f');
  });

  network.on('command:shutdown', () => {
    exec('shutdown /s /t 3 /f');
  });
}

// App lifecycle
app.whenReady().then(() => {
  setupIPC();
  createAllShellWindows();

  // Multi-display change dynamic tracking
  screen.on('display-added', () => {
    if (!isWindowed && shellWindow) {
      const primary = screen.getPrimaryDisplay();
      createSecondaryWindows(screen.getAllDisplays(), primary.id);
    }
  });

  screen.on('display-removed', () => {
    if (!isWindowed && shellWindow) {
      const primary = screen.getPrimaryDisplay();
      createSecondaryWindows(screen.getAllDisplays(), primary.id);
    }
  });

  // Start Win32 native locker (only in production kiosk mode)
  if (!isWindowed) {
    locker.start();
  }

  // Start process watchdog (only kill in production mode)
  watchdog.start((violation) => {
    network.sendViolation(violation);
    if (shellWindow) {
      shellWindow.webContents.send('security-violation', violation);
    }
  }, !isWindowed);

  // Setup networking & discovery
  setupNetwork();
  network.start();

  // ЗАЩИТА: сторож жизни. Пока идёт олимпиада — окно всегда поверх, всегда видимо,
  // хук клавиатуры перезапускается, если его убили. Оконный режим не трогаем.
  if (!isWindowed) {
    setInterval(() => {
      try {
        if (shellWindow && !shellWindow.isDestroyed()) {
          if (shellWindow.isMinimized()) shellWindow.restore();
          if (!shellWindow.isVisible()) shellWindow.show();
          if (!shellWindow.isFocused()) shellWindow.focus();
          if (!shellWindow.isAlwaysOnTop()) shellWindow.setAlwaysOnTop(true);
        }
        if (isLocked && !locker.process) {
          console.warn('[Guard] Хук клавиатуры не запущен — перезапуск');
          locker.start();
        }
      } catch (_) {}
    }, 2000);
  }

  // Проверка окружения при старте (только детект, установка — исключительно по IPC)
  runEnvDetect();

  // Start live screen frame streaming loop
  setTimeout(streamTick, 1000);

  // Global hotkey to bring LOKED desktop back to focus
  try {
    globalShortcut.register('CommandOrControl+Space', () => {
      if (shellWindow) {
        shellWindow.setAlwaysOnTop(true);
        shellWindow.show();
        shellWindow.focus();
        if (!isLocked) {
          shellWindow.setAlwaysOnTop(false);
        }
      }
    });
  } catch (_) {}

  setInterval(() => {
    network.sendHeartbeat({
      isLocked,
      status: isExamRunning ? 'exam' : (isLocked ? 'ready' : 'unlocked')
    });
  }, 4000);
});

app.on('before-quit', () => {
  locker.stop();
  watchdog.stop();
  closeSecondaryWindows();
});

app.on('window-all-closed', () => {
  locker.stop();
  watchdog.stop();
  closeSecondaryWindows();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
