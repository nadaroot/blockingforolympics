const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');
const cors = require('cors');
const { loadConfig, saveConfig } = require('./config');
const { startDiscoveryServer } = require('./discovery');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 1e8 // 100MB for screenshot buffers
});

let config = loadConfig();
const PORT = process.env.PORT || config.port || 3000;

// Exam state
let examState = {
  status: 'idle', // 'idle' | 'running' | 'paused'
  durationMinutes: config.examDurationMinutes || 120,
  remainingSeconds: (config.examDurationMinutes || 120) * 60,
  startedAt: null
};

// Connected clients map: socketId -> clientData
const clients = new Map();
// Security logs history
const logs = [];

function addLog(type, message, clientInfo = null) {
  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
    timestamp: new Date().toLocaleTimeString('ru-RU'),
    type, // 'info' | 'warning' | 'danger' | 'success'
    message,
    client: clientInfo
  };
  logs.unshift(entry);
  if (logs.length > 200) logs.pop();
  io.to('admins').emit('log:new', entry);
  console.log(`[LOG ${entry.type.toUpperCase()}] ${entry.message}`);
}

// Timer tick
setInterval(() => {
  if (examState.status === 'running') {
    if (examState.remainingSeconds > 0) {
      examState.remainingSeconds -= 1;
      io.emit('exam:tick', {
        remainingSeconds: examState.remainingSeconds,
        status: examState.status
      });
    } else {
      examState.status = 'idle';
      addLog('warning', 'Время олимпиады истекло! Все клиенты переведены в режим ожидания.');
      io.emit('exam:ended');
      io.to('clients').emit('command:lock', { reason: 'Время олимпиады вышло' });
      broadcastAdminsState();
    }
  }
}, 1000);

// Heartbeat cleanup
setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [id, client] of clients.entries()) {
    if (now - client.lastSeen > 15000) {
      addLog('warning', `Компьютер "${client.hostname}" (${client.ip}) потерял связь (таймаут)`, client);
      clients.delete(id);
      changed = true;
    }
  }
  if (changed) {
    broadcastAdminsState();
  }
}, 5000);

function broadcastAdminsState() {
  const clientsList = Array.from(clients.values());
  io.to('admins').emit('state:update', {
    clients: clientsList,
    exam: examState,
    config: {
      contestUrl: config.contestUrl,
      allowedDomains: config.allowedDomains,
      shortcuts: config.shortcuts,
      examDurationMinutes: config.examDurationMinutes
    }
  });
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// API Endpoints
app.get('/api/status', (req, res) => {
  res.json({
    clientsCount: clients.size,
    exam: examState,
    uptime: process.uptime()
  });
});

app.get('/api/config', (req, res) => {
  res.json(config);
});

// Socket.IO Handling
io.on('connection', (socket) => {
  const clientIp = socket.handshake.address.replace(/^.*:/, '') || '127.0.0.1';

  // 1. Admin registration
  socket.on('admin:register', () => {
    socket.join('admins');
    socket.emit('admin:init', {
      clients: Array.from(clients.values()),
      exam: examState,
      config,
      logs: logs.slice(0, 50)
    });
    console.log(`[Admin] Connected from ${clientIp} (${socket.id})`);
  });

  // 2. Client registration
  socket.on('client:register', (data) => {
    socket.join('clients');
    const clientData = {
      id: socket.id,
      hostname: data.hostname || `ПК-${socket.id.substr(0, 4)}`,
      ip: clientIp,
      mac: data.mac || 'N/A',
      version: data.version || '1.0.0',
      status: examState.status === 'running' ? 'exam' : 'ready', // 'ready' | 'exam' | 'locked' | 'violation'
      isLocked: data.isLocked ?? true,
      activeApp: data.activeApp || 'Loked Desktop',
      lastSeen: Date.now(),
      violationsCount: 0
    };
    clients.set(socket.id, clientData);
    addLog('success', `Подключился компьютер: "${clientData.hostname}" (${clientIp})`, clientData);

    // Send initial config and exam state to client
    socket.emit('client:init', {
      config: {
        contestUrl: config.contestUrl,
        allowedDomains: config.allowedDomains,
        shortcuts: config.shortcuts,
        masterPassword: config.masterPassword
      },
      exam: examState
    });

    broadcastAdminsState();
  });

  // 3. Client heartbeat
  socket.on('client:heartbeat', (data) => {
    const client = clients.get(socket.id);
    if (client) {
      client.lastSeen = Date.now();
      if (data.activeApp) client.activeApp = data.activeApp;
      if (typeof data.isLocked === 'boolean') client.isLocked = data.isLocked;
      if (data.status && client.status !== 'violation') client.status = data.status;
      broadcastAdminsState();
    }
  });

  // 4. Security Violation from Client
  socket.on('client:violation', (data) => {
    const client = clients.get(socket.id);
    if (client) {
      client.violationsCount = (client.violationsCount || 0) + 1;
      client.status = 'violation';
      addLog('danger', `НАРУШЕНИЕ на "${client.hostname}"! Обнаружен запрещенный процесс: ${data.processName} (${data.details || 'заблокирован и закрыт'})`, client);
      io.to('admins').emit('alert:violation', {
        clientId: client.id,
        hostname: client.hostname,
        processName: data.processName,
        timestamp: new Date().toLocaleTimeString('ru-RU')
      });
      broadcastAdminsState();
    }
  });

  // 5. Live Screen Frame from Client
  socket.on('client:screen_frame', (data) => {
    const client = clients.get(socket.id);
    if (client) {
      client.lastFrame = data.frame;
      if (data.activeApp) client.activeApp = data.activeApp;
      io.to('admins').emit('stream:frame', {
        clientId: socket.id,
        frame: data.frame,
        activeApp: client.activeApp
      });
    }
  });

  // 6. Screenshot response (legacy fallback)
  socket.on('client:screenshot_data', (data) => {
    io.to('admins').emit('admin:screenshot_result', {
      clientId: socket.id,
      image: data.image
    });
  });

  // 7. Remote Control Input forwarding (Mouse/Keyboard from Admin)
  socket.on('admin:remote_input', (data) => {
    if (data && data.clientId) {
      io.to(data.clientId).emit('command:remote_input', data);
    }
  });

  // 8. Stream rate control (high FPS for focused screen)
  socket.on('admin:focus_client', (data) => {
    if (data && data.clientId) {
      io.to(data.clientId).emit('command:set_stream_rate', { fps: 4 });
    }
  });

  socket.on('admin:unfocus_client', (data) => {
    if (data && data.clientId) {
      io.to(data.clientId).emit('command:set_stream_rate', { fps: 1 });
    }
  });

  // 6. Admin Actions
  socket.on('admin:start_exam', (data) => {
    const duration = data?.durationMinutes || config.examDurationMinutes || 120;
    examState = {
      status: 'running',
      durationMinutes: duration,
      remainingSeconds: duration * 60,
      startedAt: Date.now()
    };
    for (const client of clients.values()) {
      client.status = 'exam';
      client.isLocked = true;
    }
    io.to('clients').emit('exam:started', examState);
    addLog('info', `Учитель запустил олимпиаду на ${duration} минут!`);
    broadcastAdminsState();
  });

  socket.on('admin:pause_exam', () => {
    if (examState.status === 'running') {
      examState.status = 'paused';
      io.to('clients').emit('exam:paused');
      addLog('warning', 'Олимпиада временно приостановлена учителем');
      broadcastAdminsState();
    } else if (examState.status === 'paused') {
      examState.status = 'running';
      io.to('clients').emit('exam:resumed');
      addLog('info', 'Олимпиада возобновлена');
      broadcastAdminsState();
    }
  });

  socket.on('admin:stop_exam', () => {
    examState.status = 'idle';
    examState.remainingSeconds = examState.durationMinutes * 60;
    for (const client of clients.values()) {
      client.status = 'ready';
    }
    io.to('clients').emit('exam:stopped');
    addLog('info', 'Олимпиада завершена учителем');
    broadcastAdminsState();
  });

  socket.on('admin:lock_all', () => {
    for (const client of clients.values()) {
      client.isLocked = true;
    }
    io.to('clients').emit('command:lock', { reason: 'Блокировка учителем' });
    addLog('warning', 'Все компьютеры заблокированы учителем');
    broadcastAdminsState();
  });

  socket.on('admin:unlock_all', () => {
    for (const client of clients.values()) {
      client.isLocked = false;
    }
    io.to('clients').emit('command:unlock');
    addLog('success', 'Все компьютеры разблокированы учителем');
    broadcastAdminsState();
  });

  socket.on('admin:lock_client', (data) => {
    const client = clients.get(data.clientId);
    if (client) {
      client.isLocked = true;
      io.to(data.clientId).emit('command:lock', { reason: 'Индивидуальная блокировка' });
      addLog('warning', `Компьютер "${client.hostname}" заблокирован индивидуально`);
      broadcastAdminsState();
    }
  });

  socket.on('admin:unlock_client', (data) => {
    const client = clients.get(data.clientId);
    if (client) {
      client.isLocked = false;
      client.status = examState.status === 'running' ? 'exam' : 'ready';
      io.to(data.clientId).emit('command:unlock');
      addLog('success', `Компьютер "${client.hostname}" разблокирован`);
      broadcastAdminsState();
    }
  });

  socket.on('admin:request_screenshot', (data) => {
    if (data.clientId) {
      io.to(data.clientId).emit('command:take_screenshot');
    }
  });

  socket.on('admin:save_config', (newConfig) => {
    config = { ...config, ...newConfig };
    saveConfig(config);
    // Broadcast updated config to clients
    io.to('clients').emit('config:updated', {
      contestUrl: config.contestUrl,
      allowedDomains: config.allowedDomains,
      shortcuts: config.shortcuts,
      masterPassword: config.masterPassword
    });
    addLog('info', 'Конфигурация (ярлыки и настройки контеста) обновлена и разослана на все ПК');
    broadcastAdminsState();
  });

  socket.on('admin:broadcast_message', (data) => {
    const text = data?.message || '';
    if (text) {
      io.to('clients').emit('command:message', { text });
      addLog('info', `Объявление отправлено на все ПК: "${text}"`);
    }
  });

  socket.on('admin:reboot_client', (data) => {
    if (data.clientId) {
      io.to(data.clientId).emit('command:reboot');
      addLog('warning', `Команда перезагрузки отправлена на ПК`);
    }
  });

  socket.on('admin:shutdown_client', (data) => {
    if (data.clientId) {
      io.to(data.clientId).emit('command:shutdown');
      addLog('warning', `Команда выключения отправлена на ПК`);
    }
  });

  // Disconnection
  socket.on('disconnect', () => {
    const client = clients.get(socket.id);
    if (client) {
      addLog('warning', `Компьютер "${client.hostname}" (${client.ip}) отключился`, client);
      clients.delete(socket.id);
      broadcastAdminsState();
    }
  });
});

// Start services
server.listen(PORT, '0.0.0.0', () => {
  const networkInterfaces = os.networkInterfaces();
  const localIPs = [];
  for (const net of Object.values(networkInterfaces)) {
    for (const iface of net) {
      if (iface.family === 'IPv4' && !iface.internal) {
        localIPs.push(iface.address);
      }
    }
  }

  console.log(`=======================================================`);
  console.log(`  LOKED Server started!`);
  console.log(`  Local Admin URL: http://localhost:${PORT}`);
  localIPs.forEach(ip => {
    console.log(`  LAN Web Admin:   http://${ip}:${PORT}`);
  });
  console.log(`=======================================================`);

  // Start UDP Discovery responder
  startDiscoveryServer(PORT, config.udpPort || 41234);
});

module.exports = { app, server, io };
