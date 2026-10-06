const socket = io();

// State
let currentClients = [];
let currentExam = { status: 'idle', remainingSeconds: 7200 };
let currentConfig = { shortcuts: [] };
let activeModalClientId = null;
let violationAudioContext = null;

// DOM Elements
const clientsCountEl = document.getElementById('clientsCount');
const violationsCountEl = document.getElementById('violationsCount');
const statOnlineEl = document.getElementById('statOnline');
const statExamEl = document.getElementById('statExam');
const statViolationsEl = document.getElementById('statViolations');
const computersGrid = document.getElementById('computersGrid');
const filterInput = document.getElementById('filterInput');

// Timer DOM
const timerValueEl = document.getElementById('timerValue');
const timerStatusEl = document.getElementById('timerStatus');
const btnStartExam = document.getElementById('btnStartExam');
const btnPauseExam = document.getElementById('btnPauseExam');
const btnStopExam = document.getElementById('btnStopExam');
const btnLockAll = document.getElementById('btnLockAll');
const btnUnlockAll = document.getElementById('btnUnlockAll');

// Config DOM
const cfgContestUrl = document.getElementById('cfgContestUrl');
const cfgAllowedDomains = document.getElementById('cfgAllowedDomains');
const cfgDurationMinutes = document.getElementById('cfgDurationMinutes');
const cfgMasterPassword = document.getElementById('cfgMasterPassword');
const shortcutsListContainer = document.getElementById('shortcutsListContainer');
const btnAddCustomShortcut = document.getElementById('btnAddCustomShortcut');
const newShortcutName = document.getElementById('newShortcutName');
const newShortcutCmd = document.getElementById('newShortcutCmd');
const btnSaveConfig = document.getElementById('btnSaveConfig');

// Broadcast DOM
const broadcastInput = document.getElementById('broadcastInput');
const btnSendBroadcast = document.getElementById('btnSendBroadcast');

// Logs DOM
const logsFeed = document.getElementById('logsFeed');
const btnClearLogs = document.getElementById('btnClearLogs');

// Modal DOM
const screenshotModal = document.getElementById('screenshotModal');
const modalPcTitle = document.getElementById('modalPcTitle');
const screenshotImage = document.getElementById('screenshotImage');
const screenshotLoading = document.getElementById('screenshotLoading');
const btnRefreshScreenshot = document.getElementById('btnRefreshScreenshot');
const btnCloseModal = document.getElementById('btnCloseModal');

// Sound synthesis for alarm
function playViolationSound() {
  try {
    if (!violationAudioContext) {
      violationAudioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    const ctx = violationAudioContext;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.3);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch (_) {}
}

// Format seconds into HH:MM:SS
function formatTime(totalSeconds) {
  if (totalSeconds < 0) totalSeconds = 0;
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map(v => v.toString().padStart(2, '0')).join(':');
}

// Update Timer UI
function updateTimerUI(exam) {
  currentExam = exam;
  timerValueEl.textContent = formatTime(exam.remainingSeconds);

  if (exam.status === 'running') {
    timerStatusEl.className = 'timer-status badge badge-running';
    timerStatusEl.textContent = 'Идет олимпиада';
    btnStartExam.style.display = 'none';
    btnPauseExam.style.display = 'inline-flex';
    btnPauseExam.innerHTML = '<i class="fa-solid fa-pause"></i> Пауза';
    btnStopExam.style.display = 'inline-flex';
  } else if (exam.status === 'paused') {
    timerStatusEl.className = 'timer-status badge badge-paused';
    timerStatusEl.textContent = 'На паузе';
    btnStartExam.style.display = 'none';
    btnPauseExam.style.display = 'inline-flex';
    btnPauseExam.innerHTML = '<i class="fa-solid fa-play"></i> Продолжить';
    btnStopExam.style.display = 'inline-flex';
  } else {
    timerStatusEl.className = 'timer-status badge badge-idle';
    timerStatusEl.textContent = 'Не начата';
    btnStartExam.style.display = 'inline-flex';
    btnPauseExam.style.display = 'none';
    btnStopExam.style.display = 'none';
  }
}

// Render Computers Grid
function renderComputersGrid() {
  const query = filterInput.value.toLowerCase().trim();
  const filtered = currentClients.filter(c => 
    c.hostname.toLowerCase().includes(query) || c.ip.includes(query)
  );

  statOnlineEl.textContent = currentClients.length;
  statExamEl.textContent = currentClients.filter(c => c.status === 'exam').length;
  const violations = currentClients.filter(c => c.status === 'violation' || (c.violationsCount > 0)).length;
  statViolationsEl.textContent = violations;
  violationsCountEl.textContent = violations;
  clientsCountEl.textContent = currentClients.length;

  if (filtered.length === 0) {
    computersGrid.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-network-wired"></i>
        <h3>${currentClients.length === 0 ? 'Ожидание подключения компьютеров учеников...' : 'Компьютеры по запросу не найдены'}</h3>
        <p>${currentClients.length === 0 ? 'Запустите LOKED на ПК в классе. Они появятся здесь автоматически.' : 'Попробуйте изменить поисковый запрос.'}</p>
      </div>
    `;
    return;
  }

  computersGrid.innerHTML = filtered.map(client => {
    let statusBadge = '<span class="badge badge-idle">Готов</span>';
    let cardClass = 'pc-card';

    if (client.status === 'exam') {
      statusBadge = '<span class="badge badge-running">В контесте</span>';
    } else if (client.status === 'violation') {
      statusBadge = '<span class="badge badge-danger">Нарушение!</span>';
      cardClass += ' violation';
    } else if (client.isLocked) {
      statusBadge = '<span class="badge badge-paused">Заблокирован</span>';
    }

    const lockBtnText = client.isLocked ? 
      '<i class="fa-solid fa-lock-open"></i> Разблок.' : 
      '<i class="fa-solid fa-lock"></i> Блок.';
    const lockBtnClass = client.isLocked ? 'btn-outline-success' : 'btn-outline-danger';

    return `
      <div class="${cardClass}" id="pc-${client.id}">
        <div class="pc-card-header">
          <div class="pc-title">
            <div class="pc-icon"><i class="fa-solid fa-desktop"></i></div>
            <div class="pc-info">
              <h4>${escapeHtml(client.hostname)}</h4>
              <p>IP: ${client.ip}</p>
            </div>
          </div>
          <div>${statusBadge}</div>
        </div>

        <div class="pc-card-body">
          <div class="pc-meta-row">
            <span>Активное окно:</span>
            <span title="${escapeHtml(client.activeApp)}">${escapeHtml(client.activeApp)}</span>
          </div>
          <div class="pc-meta-row">
            <span>Нарушений:</span>
            <span style="color: ${client.violationsCount > 0 ? '#ef4444' : '#10b981'}; font-weight: bold;">
              ${client.violationsCount || 0}
            </span>
          </div>
        </div>

        <div class="pc-card-actions">
          <button class="btn btn-secondary btn-sm" onclick="openScreenshotModal('${client.id}', '${escapeHtml(client.hostname)}')">
            <i class="fa-solid fa-eye"></i> Экран
          </button>
          <button class="btn ${lockBtnClass} btn-sm" onclick="toggleClientLock('${client.id}', ${client.isLocked})">
            ${lockBtnText}
          </button>
          <button class="btn btn-secondary btn-sm" title="Перезагрузить ПК" onclick="rebootClient('${client.id}')">
            <i class="fa-solid fa-power-off"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

// Render Shortcuts in Config Tab
function renderShortcutsList() {
  if (!currentConfig.shortcuts) return;

  shortcutsListContainer.innerHTML = currentConfig.shortcuts.map((sc, index) => {
    return `
      <div class="shortcut-item">
        <div class="shortcut-info">
          <i class="fa-solid fa-${sc.icon || 'code'}" style="color: ${sc.color || '#3b82f6'};"></i>
          <div>
            <div class="shortcut-name">${escapeHtml(sc.name)}</div>
            <div class="shortcut-sub">${escapeHtml(sc.cmd || sc.url || 'Приложение')}</div>
          </div>
        </div>
        <label class="switch">
          <input type="checkbox" ${sc.enabled ? 'checked' : ''} onchange="toggleShortcut(${index}, this.checked)">
          <span class="slider"></span>
        </label>
      </div>
    `;
  }).join('');
}

window.toggleShortcut = function(index, checked) {
  if (currentConfig.shortcuts[index]) {
    currentConfig.shortcuts[index].enabled = checked;
  }
};

// Render Logs
function renderLogs(logs) {
  logsFeed.innerHTML = logs.map(log => `
    <div class="log-entry ${log.type}">
      <span class="log-time">${log.timestamp}</span>
      <span class="log-msg">${escapeHtml(log.message)}</span>
    </div>
  `).join('');
}

function appendLog(log) {
  const div = document.createElement('div');
  div.className = `log-entry ${log.type}`;
  div.innerHTML = `
    <span class="log-time">${log.timestamp}</span>
    <span class="log-msg">${escapeHtml(log.message)}</span>
  `;
  logsFeed.insertBefore(div, logsFeed.firstChild);
}

// Helpers
function escapeHtml(text) {
  if (!text) return '';
  return text.toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Tab Switching
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    const tabId = btn.getAttribute('data-tab');
    document.getElementById(`tab-${tabId}`).classList.add('active');
  });
});

filterInput.addEventListener('input', renderComputersGrid);

// Socket.io Events
socket.on('connect', () => {
  console.log('Connected to LOKED Server');
  socket.emit('admin:register');
});

socket.on('admin:init', (data) => {
  currentClients = data.clients || [];
  currentExam = data.exam;
  currentConfig = data.config;

  // Fill form
  cfgContestUrl.value = currentConfig.contestUrl || '';
  cfgAllowedDomains.value = (currentConfig.allowedDomains || []).join(', ');
  cfgDurationMinutes.value = currentConfig.examDurationMinutes || 120;
  cfgMasterPassword.value = currentConfig.masterPassword || 'admin';

  updateTimerUI(currentExam);
  renderComputersGrid();
  renderShortcutsList();
  renderLogs(data.logs || []);
});

socket.on('state:update', (data) => {
  currentClients = data.clients || [];
  if (data.exam) updateTimerUI(data.exam);
  renderComputersGrid();
});

socket.on('exam:tick', (data) => {
  currentExam.remainingSeconds = data.remainingSeconds;
  currentExam.status = data.status;
  updateTimerUI(currentExam);
});

socket.on('exam:ended', () => {
  currentExam.status = 'idle';
  updateTimerUI(currentExam);
  alert('Время олимпиады подошло к концу!');
});

socket.on('log:new', (log) => {
  appendLog(log);
});

socket.on('alert:violation', (alertData) => {
  playViolationSound();
  // Highlight or notify
  const pc = currentClients.find(c => c.id === alertData.clientId);
  if (pc) {
    pc.status = 'violation';
    renderComputersGrid();
  }
});

socket.on('admin:screenshot_result', (data) => {
  if (data.clientId === activeModalClientId && data.image) {
    screenshotLoading.style.display = 'none';
    screenshotImage.src = data.image;
    screenshotImage.style.display = 'block';
  }
});

// Admin Button Actions
btnStartExam.addEventListener('click', () => {
  const mins = parseInt(cfgDurationMinutes.value, 10) || 120;
  if (confirm(`Запустить олимпиаду на ${mins} минут?`)) {
    socket.emit('admin:start_exam', { durationMinutes: mins });
  }
});

btnPauseExam.addEventListener('click', () => {
  socket.emit('admin:pause_exam');
});

btnStopExam.addEventListener('click', () => {
  if (confirm('Вы уверены, что хотите завершить олимпиаду для всех участников?')) {
    socket.emit('admin:stop_exam');
  }
});

btnLockAll.addEventListener('click', () => {
  if (confirm('Заблокировать экраны всех компьютеров?')) {
    socket.emit('admin:lock_all');
  }
});

btnUnlockAll.addEventListener('click', () => {
  socket.emit('admin:unlock_all');
});

// Individual client actions
window.toggleClientLock = function(clientId, isCurrentlyLocked) {
  if (isCurrentlyLocked) {
    socket.emit('admin:unlock_client', { clientId });
  } else {
    socket.emit('admin:lock_client', { clientId });
  }
};

window.rebootClient = function(clientId) {
  if (confirm('Перезагрузить этот компьютер?')) {
    socket.emit('admin:reboot_client', { clientId });
  }
};

// Screenshot Modal
window.openScreenshotModal = function(clientId, hostname) {
  activeModalClientId = clientId;
  modalPcTitle.innerHTML = `<i class="fa-solid fa-display"></i> Экран: ${escapeHtml(hostname)}`;
  screenshotImage.style.display = 'none';
  screenshotLoading.style.display = 'flex';
  screenshotModal.classList.add('active');
  socket.emit('admin:request_screenshot', { clientId });
};

btnRefreshScreenshot.addEventListener('click', () => {
  if (activeModalClientId) {
    screenshotImage.style.display = 'none';
    screenshotLoading.style.display = 'flex';
    socket.emit('admin:request_screenshot', { clientId: activeModalClientId });
  }
});

btnCloseModal.addEventListener('click', () => {
  screenshotModal.classList.remove('active');
  activeModalClientId = null;
});

document.querySelector('.modal-backdrop').addEventListener('click', () => {
  screenshotModal.classList.remove('active');
  activeModalClientId = null;
});

// Config Save
btnSaveConfig.addEventListener('click', () => {
  const domains = cfgAllowedDomains.value
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const updatedConfig = {
    contestUrl: cfgContestUrl.value.trim(),
    allowedDomains: domains,
    examDurationMinutes: parseInt(cfgDurationMinutes.value, 10) || 120,
    masterPassword: cfgMasterPassword.value.trim() || 'admin',
    shortcuts: currentConfig.shortcuts
  };

  socket.emit('admin:save_config', updatedConfig);
  alert('Настройки успешно сохранены и отправлены на все компьютеры!');
});

// Add custom shortcut
btnAddCustomShortcut.addEventListener('click', () => {
  const name = newShortcutName.value.trim();
  const cmd = newShortcutCmd.value.trim();
  if (!name || !cmd) {
    alert('Укажите название и команду запуска (exe)!');
    return;
  }
  const newSc = {
    id: 'custom_' + Date.now(),
    name,
    type: 'app',
    icon: 'cube',
    color: '#10b981',
    cmd,
    paths: [cmd],
    enabled: true
  };
  currentConfig.shortcuts.push(newSc);
  newShortcutName.value = '';
  newShortcutCmd.value = '';
  renderShortcutsList();
});

// Broadcast
btnSendBroadcast.addEventListener('click', () => {
  const msg = broadcastInput.value.trim();
  if (!msg) return;
  socket.emit('admin:broadcast_message', { message: msg });
  broadcastInput.value = '';
  alert('Сообщение отправлено!');
});

document.querySelectorAll('.chip').forEach(chip => {
  chip.addEventListener('click', () => {
    broadcastInput.value = chip.getAttribute('data-msg');
  });
});

btnClearLogs.addEventListener('click', () => {
  logsFeed.innerHTML = '';
});
