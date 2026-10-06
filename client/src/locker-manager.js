const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

class LockerManager {
  constructor() {
    this.process = null;
    this.isLocked = false;
    this.exePath = path.join(__dirname, '..', 'native', 'locker.exe');
  }

  start() {
    if (!fs.existsSync(this.exePath)) {
      console.warn(`[Locker] Native locker binary not found at ${this.exePath}, running without Win32 hook`);
      return;
    }

    try {
      this.process = spawn(this.exePath, [], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      this.process.stdout.on('data', (data) => {
        const text = data.toString().trim();
        console.log(`[Locker] Out: ${text}`);
        if (text.includes('LOCKED')) this.isLocked = true;
        if (text.includes('UNLOCKED')) this.isLocked = false;
      });

      this.process.stderr.on('data', (data) => {
        console.warn(`[Locker] Err: ${data.toString().trim()}`);
      });

      this.process.on('exit', (code) => {
        console.log(`[Locker] Exited with code ${code}`);
        this.process = null;
        this.isLocked = false;
      });

      console.log('[Locker] Native locker started successfully');
    } catch (err) {
      console.error('[Locker] Failed to spawn locker:', err);
    }
  }

  lock() {
    if (this.process && this.process.stdin.writable) {
      this.process.stdin.write('LOCK\n');
      this.isLocked = true;
    }
  }

  unlock() {
    if (this.process && this.process.stdin.writable) {
      this.process.stdin.write('UNLOCK\n');
      this.isLocked = false;
    }
  }

  stop() {
    if (this.process) {
      try {
        if (this.process.stdin.writable) {
          this.process.stdin.write('EXIT\n');
        }
        setTimeout(() => {
          if (this.process) {
            this.process.kill();
            this.process = null;
          }
        }, 500);
      } catch (_) {}
    }
  }
}

module.exports = new LockerManager();
