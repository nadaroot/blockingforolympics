const { app, BrowserWindow, Menu, Tray, dialog } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');

let mainWindow = null;
let tray = null;
let serverProcess = null;

// Ensure server is started
function checkOrStartServer() {
  return new Promise((resolve) => {
    const req = http.get('http://localhost:3000/api/status', (res) => {
      console.log('[Admin Desktop] Existing server detected on port 3000');
      resolve();
    });

    req.on('error', () => {
      console.log('[Admin Desktop] Starting embedded server...');
      try {
        require('../server/src/index.js');
        setTimeout(resolve, 800);
      } catch (err) {
        console.error('[Admin Desktop] Failed to start internal server:', err);
        resolve();
      }
    });

    req.setTimeout(1000, () => {
      req.abort();
      try {
        require('../server/src/index.js');
        setTimeout(resolve, 800);
      } catch (_) {
        resolve();
      }
    });
  });
}

async function createWindow() {
  await checkOrStartServer();

  const iconPath = path.join(__dirname, 'icon.png');
  const windowOpts = {
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    title: 'LOKED Admin — Панель управления олимпиадой',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  };
  if (fs.existsSync(iconPath)) {
    windowOpts.icon = iconPath;
  }

  mainWindow = new BrowserWindow(windowOpts);

  Menu.setApplicationMenu(null);
  mainWindow.loadURL('http://localhost:3000');

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
