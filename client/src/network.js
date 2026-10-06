const dgram = require('dgram');
const { io } = require('socket.io-client');
const os = require('os');

class ClientNetwork {
  constructor() {
    this.socket = null;
    this.serverUrl = null;
    this.hostname = os.hostname();
    this.handlers = {};
  }

  on(event, handler) {
    this.handlers[event] = handler;
  }

  emit(event, data) {
    if (this.socket && this.socket.connected) {
      this.socket.emit(event, data);
    }
  }

  start(fallbackUrl = 'http://localhost:3000') {
    this.discoverServer((detectedUrl) => {
      const url = detectedUrl || fallbackUrl;
      console.log(`[Network] Connecting to LOKED Server at ${url}...`);
      this.connect(url);
    });
  }

  discoverServer(callback) {
    const client = dgram.createSocket('udp4');
    let resolved = false;

    client.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        try { client.close(); } catch (_) {}
        callback(null);
      }
    });

    client.on('message', (msg, rinfo) => {
      const text = msg.toString().trim();
      if (text.startsWith('LOKED_SERVER:')) {
        const parts = text.split(':');
        const port = parts[1] || '3000';
        const serverUrl = `http://${rinfo.address}:${port}`;
        if (!resolved) {
          resolved = true;
          try { client.close(); } catch (_) {}
          console.log(`[UDP Discovery] Server located at ${serverUrl}`);
          callback(serverUrl);
        }
      }
    });

    try {
      client.bind(() => {
        client.setBroadcast(true);
        const packet = Buffer.from('LOKED_DISCOVER');
        client.send(packet, 0, packet.length, 41234, '255.255.255.255', (err) => {
          if (err) console.warn('[UDP Discovery] Broadcast send error:', err);
        });
      });
    } catch (e) {
      console.warn('[UDP Discovery] Failed to bind client socket:', e);
    }

    // Timeout fallback after 2.5 seconds
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try { client.close(); } catch (_) {}
        callback(null);
      }
    }, 2500);
  }

  connect(url) {
    this.serverUrl = url;
    this.socket = io(url, {
      reconnection: true,
      reconnectionDelay: 2000,
      timeout: 5000
    });

    this.socket.on('connect', () => {
      console.log('[Network] Connected to Server!');
      this.socket.emit('client:register', {
        hostname: this.hostname,
        version: '1.0.0',
        isLocked: true
      });
      if (this.handlers['connected']) this.handlers['connected'](url);
    });

    this.socket.on('disconnect', () => {
      console.log('[Network] Disconnected from server');
      if (this.handlers['disconnected']) this.handlers['disconnected']();
    });

    // Event forwarding
    const events = [
      'client:init',
      'config:updated',
      'exam:started',
      'exam:paused',
      'exam:resumed',
      'exam:stopped',
      'exam:tick',
      'exam:ended',
      'command:lock',
      'command:unlock',
      'command:take_screenshot',
      'command:message',
      'command:reboot',
      'command:shutdown',
      'command:remote_input',
      'command:set_stream_rate'
    ];

    for (const evt of events) {
      this.socket.on(evt, (data) => {
        if (this.handlers[evt]) {
          this.handlers[evt](data);
        }
      });
    }
  }

  sendHeartbeat(data) {
    this.emit('client:heartbeat', data);
  }

  sendViolation(data) {
    this.emit('client:violation', data);
  }

  sendScreenshot(imageDataUrl) {
    this.emit('client:screenshot_data', { image: imageDataUrl });
  }

  sendScreenFrame(imageDataUrl, activeApp) {
    this.emit('client:screen_frame', { frame: imageDataUrl, activeApp });
  }
}

module.exports = new ClientNetwork();
