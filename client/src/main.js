const { app, BrowserWindow, ipcMain, desktopCapturer, dialog, screen } = require('electron');
const path = require('path');
const { spawn, exec } = require('child_process');
const fs = require('fs');
const os = require('os');

const locker = require('./locker-manager');
const watchdog = require('./watchdog');
const network = require('./network');

let shellWindow = null;
let browserWindow = null;
let currentConfig = {
  contestUrl: 'https://contest.yandex.ru',
  allowedDomains: ['contest.yandex.ru', 'yandex.ru', 'codeforces.com', 'informatics.msk.ru', 'acmp.ru'],
  masterPassword: 'admin',
  shortcuts: []
};
let isLocked = true;
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
      // Support wildcards like PyCharm Community Edition*
      if (expanded.includes('*')) {
        const dir = path.dirname(expanded);
        const basePattern = path.basename(expanded);
        if (fs.existsSync(dir)) {
          const files = fs.readdirSync(dir);
          const match = files.find(f => f.toLowerCase().startsWith(basePattern.replace('*', '').toLowerCase()));
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

// Create Student Shell Window (Kiosk Desktop)
function createShellWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.bounds;

  shellWindow = new BrowserWindow({
    x: 0,
    y: 0,
    width,
    height,
    fullscreen: true,
    kiosk: true,
    alwaysOnTop: isLocked,
    frame: false,
    resizable: false,
    movable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  shellWindow.loadFile(path.join(__dirname, 'shell', 'index.html'));

  shellWindow.on('closed', () => {
    shellWindow = null;
  });

  // Keep focus on kiosk shell if locked and no child app is active
  shellWindow.on('blur', () => {
    if (isLocked && !browserWindow) {
      // Allow user to use launched IDEs/calculators, but prevent explorer focus
    }
  });
}

// Create or show Safe Chromium Browser Window
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
    width,
    height,
    fullscreen: true,
    alwaysOnTop: isLocked,
    frame: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
      devTools: false,
      preload: path.join(__dirname, 'browser', 'browser-preload.js')
    }
  });

  // Load the Safe Browser shell UI which embeds the contest page
  browserWindow.loadFile(path.join(__dirname, 'browser', 'browser.html'), {
    query: { initialUrl: targetUrl }
  });

  browserWindow.on('closed', () => {
    browserWindow = null;
    if (shellWindow) {
      shellWindow.show();
      shellWindow.focus();
    }
  });
}

// Check if domain is allowed
function isDomainAllowed(targetUrl) {
  try {
    const parsed = new URL(targetUrl);
    const host = parsed.hostname.toLowerCase();
    const allowed = currentConfig.allowedDomains || [];
    return allowed.some(d => host === d.toLowerCase() || host.endsWith('.' + d.toLowerCase()));
  } catch (_) {
    return false;
  }
}

// Setup IPC handlers
function setupIPC() {
  // Launch an authorized desktop app
  ipcMain.handle('launch-app', async (event, shortcutId) => {
    const sc = (currentConfig.shortcuts || []).find(s => s.id === shortcutId);
    if (!sc) return { success: false, message: 'Ярлык не найден' };

    if (sc.type === 'browser') {
      openSafeBrowser(sc.url);
      return { success: true };
    }

    const exePath = resolveExePath(sc);
    console.log(`[Launch] Attempting to start ${sc.name} at: ${exePath}`);

    try {
      if (sc.args && Array.isArray(sc.args)) {
        spawn(exePath, sc.args, { detached: true, stdio: 'ignore' }).unref();
      } else {
        exec(`start "" "${exePath}"`, (err) => {
          if (err) {
            console.error(`[Launch] Exec error:`, err);
          }
        });
      }

      // Temporarily lower shell topmost so student can see and use the launched program
      if (shellWindow) {
        shellWindow.setAlwaysOnTop(false);
      }

      // Notify server of active app
      network.sendHeartbeat({ activeApp: sc.name });
      return { success: true };
    } catch (err) {
      console.error(`[Launch] Failed to run ${sc.name}:`, err);
      return { success: false, message: `Не удалось запустить ${sc.name}: ${err.message}` };
    }
  });

  // Open Contest in Safe Browser
  ipcMain.on('open-contest', (event, url) => {
    openSafeBrowser(url);
  });

  // Close browser and return to desktop
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

  // Verify master unlock password
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
      network.sendHeartbeat({ isLocked: false, status: 'ready' });
      return { success: true };
    }
    return { success: false, message: 'Неверный пароль' };
  });

  // Lock kiosk back
  ipcMain.on('relock-kiosk', () => {
    isLocked = true;
    locker.lock();
    if (shellWindow) {
      shellWindow.setKiosk(true);
      shellWindow.setFullScreen(true);
      shellWindow.setAlwaysOnTop(true);
      shellWindow.focus();
    }
    network.sendHeartbeat({ isLocked: true });
  });

  // Exit application completely (when unlocked)
  ipcMain.on('exit-loked', () => {
    app.quit();
  });
}

// Screen capture for Admin view
async function captureDesktop() {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1280, height: 720 }
    });
    if (sources.length > 0) {
      return sources[0].thumbnail.toDataURL();
    }
  } catch (err) {
    console.error('[Capture] Screen capture error:', err);
  }
  return null;
}

// Setup Network Handlers
function setupNetwork() {
  network.on('connected', (serverUrl) => {
    if (shellWindow) {
      shellWindow.webContents.send('server-status', { connected: true, serverUrl });
    }
  });

  network.on('disconnected', () => {
    if (shellWindow) {
      shellWindow.webContents.send('server-status', { connected: false });
    }
  });

  network.on('client:init', (data) => {
    if (data.config) {
      currentConfig = { ...currentConfig, ...data.config };
    }
    if (shellWindow) {
      shellWindow.webContents.send('config-update', currentConfig);
      if (data.exam) {
        shellWindow.webContents.send('exam-update', data.exam);
      }
    }
  });

  network.on('config:updated', (newConfig) => {
    currentConfig = { ...currentConfig, ...newConfig };
    if (shellWindow) {
      shellWindow.webContents.send('config-update', currentConfig);
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
  });

  network.on('command:unlock', () => {
    isLocked = false;
    locker.unlock();
    if (shellWindow) {
      shellWindow.setAlwaysOnTop(false);
      shellWindow.webContents.send('client-unlocked');
    }
  });

  network.on('command:take_screenshot', async () => {
    const dataUrl = await captureDesktop();
    if (dataUrl) {
      network.sendScreenshot(dataUrl);
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
  createShellWindow();

  // Start Win32 native locker
  locker.start();

  // Start process watchdog
  watchdog.start((violation) => {
    network.sendViolation(violation);
    if (shellWindow) {
      shellWindow.webContents.send('security-violation', violation);
    }
  });

  // Setup networking & discovery
  setupNetwork();
  network.start();

  // Periodic heartbeat to server
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
});

app.on('window-all-closed', () => {
  locker.stop();
  watchdog.stop();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
