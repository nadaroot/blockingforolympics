const { exec } = require('child_process');

const BLACKLIST_PROCESSES = [
  'chrome.exe',
  'msedge.exe',
  'firefox.exe',
  'opera.exe',
  'brave.exe',
  'browser.exe', // Yandex Browser
  'tor.exe',
  'telegram.exe',
  'discord.exe',
  'whatsapp.exe',
  'viber.exe',
  'skype.exe',
  'steam.exe',
  'epicgameslauncher.exe',
  'battlenet.exe',
  'riotclientservices.exe',
  'utorrent.exe',
  'qbittorrent.exe',
  'cheatengine.exe',
  'fiddler.exe',
  'wireshark.exe'
];

class Watchdog {
  constructor() {
    this.timer = null;
    this.intervalMs = 2500;
    this.onViolation = null;
    this.isRunning = false;
    this.recentlyKilled = new Set();
  }

  start(onViolationCallback) {
    if (this.isRunning) return;
    this.isRunning = true;
    this.onViolation = onViolationCallback;

    this.timer = setInterval(() => {
      this.checkProcesses();
    }, this.intervalMs);

    console.log('[Watchdog] Security process scanner active');
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
    console.log('[Watchdog] Scanner stopped');
  }

  checkProcesses() {
    // Run tasklist on Windows
    exec('tasklist /fo csv /nh', (err, stdout) => {
      if (err || !stdout) return;

      const lines = stdout.split('\r\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        const parts = line.split('","');
        if (parts.length > 0) {
          const rawName = parts[0].replace(/^"/, '').toLowerCase();

          for (const blocked of BLACKLIST_PROCESSES) {
            if (rawName === blocked.toLowerCase()) {
              this.killProcess(rawName);
            }
          }
        }
      }
    });
  }

  killProcess(processName) {
    exec(`taskkill /F /IM "${processName}"`, (err) => {
      if (!this.recentlyKilled.has(processName)) {
        this.recentlyKilled.add(processName);
        setTimeout(() => this.recentlyKilled.delete(processName), 5000);

        console.warn(`[Watchdog] Terminated prohibited process: ${processName}`);
        if (typeof this.onViolation === 'function') {
          this.onViolation({
            processName,
            details: 'Принудительно закрыт Watchdog-системой'
          });
        }
      }
    });
  }
}

module.exports = new Watchdog();
