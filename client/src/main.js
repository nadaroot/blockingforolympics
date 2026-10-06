const { app, BrowserWindow, ipcMain, desktopCapturer, dialog, screen, globalShortcut } = require('electron');
const path = require('path');
const { spawn, exec, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');

const locker = require('./locker-manager');
const watchdog = require('./watchdog');
const network = require('./network');

let shellWindow = null;
let secondaryWindows = [];
let browserWindow = null;
let currentConfig = {
  contestUrl: 'https://contest.yandex.ru',
  allowedDomains: ['contest.yandex.ru', 'yandex.ru', 'codeforces.com', 'informatics.msk.ru', 'acmp.ru'],
  masterPassword: 'admin',
  shortcuts: []
};
const isWindowed = process.argv.includes('--windowed') || process.argv.includes('--dev');
let isLocked = !isWindowed;
let isExamRunning = false;

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
    autoHideMenuBar: true,
    title: 'LOKED'
  };

  shellWindow = new BrowserWindow({
    ...winConfig,
    backgroundColor: '#050505',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
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

  shellWindow.on('closed', () => {
    shellWindow = null;
    closeSecondaryWindows();
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

// Safe Chromium Browser Window
function openSafeBrowser(urlToOpen) {
  const targetUrl = urlToOpen || currentConfig.contestUrl || 'https://contest.yandex.ru';

  if (browserWindow) {
    browserWindow.show();
    browserWindow.focus();
    if (urlToOpen) {
      browserWindow.loadURL(targetUrl);
    }
    return;
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.bounds;

  browserWindow = new BrowserWindow({
    frame: false,
    fullscreen: true,
    kiosk: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    autoHideMenuBar: true,
    backgroundColor: '#050505',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
      devTools: false,
      preload: path.join(__dirname, 'browser', 'browser-preload.js')
    }
  });

  browserWindow.setFullScreen(true);
  browserWindow.maximize();
  browserWindow.setAlwaysOnTop(true);

  // Catch Escape globally across all inner frames/webviews
  browserWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'Escape' && input.type === 'keyDown') {
      if (browserWindow) {
        browserWindow.close();
        browserWindow = null;
      }
      if (shellWindow) {
        shellWindow.show();
        shellWindow.focus();
      }
    }
  });

  browserWindow.loadFile(path.join(__dirname, 'browser', 'browser.html'), {
    query: { initialUrl: targetUrl }
  });

  browserWindow.on('closed', () => {
    browserWindow = null;
    currentActiveAppName = 'LOKED Shell';
    if (shellWindow) {
      shellWindow.show();
      shellWindow.focus();
    }
  });
}

// Setup IPC handlers
function setupIPC() {
  ipcMain.handle('get-config', () => {
    return getFilteredConfig();
  });

  ipcMain.handle('launch-app', async (event, shortcutId) => {
    const sc = (currentConfig.shortcuts || []).find(s => s.id === shortcutId);
    if (!sc) return { success: false, message: 'Ярлык не найден' };

    if (sc.type === 'browser' || sc.type === 'url' || sc.url) {
      openSafeBrowser(sc.url);
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
        exec(`start "" "${exePath}"`, (err) => {
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
    openSafeBrowser(url);
  });

  ipcMain.on('close-browser', () => {
    if (browserWindow) {
      browserWindow.close();
      browserWindow = null;
    }
    if (shellWindow) {
      shellWindow.show();
      shellWindow.focus();
    }
  });

  ipcMain.handle('verify-unlock', async (event, password) => {
    const expected = currentConfig.masterPassword || 'admin';
    if (password === expected) {
      isLocked = false;
      locker.unlock();
      if (shellWindow) {
        shellWindow.setKiosk(false);
        shellWindow.setFullScreen(false);
        shellWindow.setAlwaysOnTop(false);
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
    if (browserWindow) {
      browserWindow.close();
      browserWindow = null;
    }
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
