const socket = io();

// State
let currentClients = [];
let currentExam = { status: 'idle', remainingSeconds: 7200 };
let currentConfig = { shortcuts: [] };
let activeModalClientId = null;
let audioCtx = null;
let toastTimeout = null;

// DOM Elements
const clientsCountEl = document.getElementById('clientsCount');
const mClientsCountEl = document.getElementById('mClientsCount');
const wallCountEl = document.getElementById('wallCount');
const violationsCountEl = document.getElementById('violationsCount');
const statOnlineEl = document.getElementById('statOnline');
const computersGrid = document.getElementById('computersGrid');
const wallGrid = document.getElementById('wallGrid');
const filterInput = document.getElementById('filterInput');
const appToast = document.getElementById('appToast');

// Timer DOM
const timerValueEl = document.getElementById('timerValue');
const timerStatusEl = document.getElementById('timerStatus');
const timerDot = document.getElementById('timerDot');
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
const scTypeApp = document.getElementById('scTypeApp');
const scTypeBrowser = document.getElementById('scTypeBrowser');
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
const modalLivePill = document.getElementById('modalLivePill');
const screenshotImage = document.getElementById('screenshotImage');
const screenshotLoading = document.getElementById('screenshotLoading');
const modalViewContainer = document.getElementById('modalViewContainer');
const chkRemoteControl = document.getElementById('chkRemoteControl');
const remoteBanner = document.getElementById('remoteBanner');
const btnModalToggleLock = document.getElementById('btnModalToggleLock');
const btnCloseModal = document.getElementById('btnCloseModal');
const btnBottomCloseModal = document.getElementById('btnBottomCloseModal');
const modalDim = document.getElementById('modalDim');

// In-App Toast
function showToast(message) {
  if (!appToast) return;
  appToast.textContent = message;
  appToast.classList.add('active');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    appToast.classList.remove('active');
  }, 2800);
}

// Sound Alarm
function playViolationSound() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.setValueAtTime(600, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(300, audioCtx.currentTime + 0.2);
    gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.2);
  } catch (_) {}
}

function formatTime(totalSeconds) {
  if (totalSeconds < 0) totalSeconds = 0;
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map(v => v.toString().padStart(2, '0')).join(':');
}

function updateTimerUI(exam) {
  currentExam = exam;
  timerValueEl.textContent = formatTime(exam.remainingSeconds);

  if (exam.status === 'running') {
    timerStatusEl.textContent = 'Идет тур';
    if (timerDot) timerDot.classList.add('active');
    btnStartExam.style.display = 'none';
    btnPauseExam.style.display = 'inline-flex';
    btnPauseExam.querySelector('.btn-text').textContent = 'Пауза';
    btnStopExam.style.display = 'inline-flex';
  } else if (exam.status === 'paused') {
    timerStatusEl.textContent = 'Пауза';
    if (timerDot) timerDot.classList.remove('active');
    btnStartExam.style.display = 'none';
    btnPauseExam.style.display = 'inline-flex';
    btnPauseExam.querySelector('.btn-text').textContent = 'Старт';
    btnStopExam.style.display = 'inline-flex';
  } else {
    timerStatusEl.textContent = 'Ожидание';
    if (timerDot) timerDot.classList.remove('active');
    btnStartExam.style.display = 'inline-flex';
    btnPauseExam.style.display = 'none';
    btnStopExam.style.display = 'none';
  }
}

// Render Computers Grid
function renderComputersGrid() {
  const query = filterInput ? filterInput.value.toLowerCase().trim() : '';
  const filtered = currentClients.filter(c => 
    c.hostname.toLowerCase().includes(query) || c.ip.includes(query)
  );

  statOnlineEl.textContent = currentClients.length;
  const violations = currentClients.filter(c => c.status === 'violation' || (c.violationsCount > 0)).length;
  violationsCountEl.textContent = violations;
  clientsCountEl.textContent = currentClients.length;
  if (mClientsCountEl) mClientsCountEl.textContent = currentClients.length;
  if (wallCountEl) wallCountEl.textContent = currentClients.length;

  renderWallGrid();

  if (filtered.length === 0) {
    computersGrid.innerHTML = `
      <div class="empty-state">
        <p>${currentClients.length === 0 ? 'Ожидание подключения компьютеров учеников...' : 'Компьютеры не найдены'}</p>
        <small>${currentClients.length === 0 ? 'Запустите лаунчер на станциях' : 'Измените запрос поиска'}</small>
      </div>
    `;
    return;
  }

  computersGrid.innerHTML = filtered.map(client => {
    let badgeText = 'Готов';
    let badgeClass = '';
    let cardClass = 'client-card';

    if (client.status === 'exam') {
      badgeText = 'В контесте';
      badgeClass = 'active';
    } else if (client.status === 'violation') {
      badgeText = 'Нарушение';
      badgeClass = 'danger';
      cardClass += ' violation';
    } else if (client.isLocked) {
      badgeText = 'Заблокирован';
      badgeClass = 'locked';
    }

    return `
      <div class="${cardClass}" id="pc-${client.id}">
        <div class="card-top">
          <div class="card-title">
            <h4>${escapeHtml(client.hostname)}</h4>
            <p>${client.ip}</p>
          </div>
          <span class="status-badge ${badgeClass}">${badgeText}</span>
        </div>

        <div class="card-info">
          <div class="info-row">
            <span>Активно:</span>
            <span>${escapeHtml(client.activeApp)}</span>
          </div>
        </div>

        <div class="card-actions">
          <button class="btn btn-secondary btn-sm" onclick="openScreenshotModal('${client.id}', '${escapeHtml(client.hostname)}')">
            Экран
          </button>
          <button class="btn btn-secondary btn-sm" onclick="toggleClientLock('${client.id}', ${client.isLocked})">
            ${client.isLocked ? 'Разблок' : 'Блок'}
          </button>
          <button class="btn btn-secondary btn-sm" title="Перезагрузка" onclick="rebootClient('${client.id}')">
            ⟳
          </button>
        </div>
      </div>
    `;
  }).join('');
}

// Render Live Wall Grid (All Screens)
function renderWallGrid() {
  if (!wallGrid) return;
  if (wallCountEl) wallCountEl.textContent = currentClients.length;

  if (currentClients.length === 0) {
    wallGrid.innerHTML = `
      <div class="empty-state">
        <p>Ожидание подключения компьютеров для трансляции экранов...</p>
        <small>Запустите лаунчер на станциях в классе</small>
      </div>
    `;
    return;
  }

  wallGrid.innerHTML = currentClients.map(client => {
    const hasFrame = !!client.lastFrame;
    const isViolation = client.status === 'violation';

    return `
      <div class="wall-card ${isViolation ? 'violation' : ''}" onclick="openScreenshotModal('${client.id}', '${escapeHtml(client.hostname)}')">
        <div class="wall-screen-box">
          ${hasFrame 
            ? `<img class="wall-thumb" id="wall-img-${client.id}" src="${client.lastFrame}" alt="Экран">`
            : `<div class="wall-thumb-placeholder" id="wall-placeholder-${client.id}">Ожидание видеопотока...</div>`
          }
          <div class="wall-live-tag">
            <span class="dot"></span>
            LIVE
          </div>
        </div>
        <div class="wall-meta">
          <div class="wall-meta-title">
            <h4>${escapeHtml(client.hostname)}</h4>
            <p>${client.ip}</p>
          </div>
          <div class="wall-app-pill" id="wall-app-${client.id}" title="${escapeHtml(client.activeApp)}">
            ${escapeHtml(client.activeApp || 'LOKED')}
          </div>
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
      <div class="sc-row">
        <div>
          <div class="sc-name">${escapeHtml(sc.name)}</div>
          <div class="sc-sub">${escapeHtml(sc.url || sc.cmd || (sc.type === 'browser' ? 'Веб-сайт' : 'Программа'))}</div>
        </div>
        <div class="sc-actions">
          <input type="checkbox" ${sc.enabled ? 'checked' : ''} onchange="toggleShortcut(${index}, this.checked)">
          <button class="btn-sc-del" onclick="deleteShortcut(${index})" title="Удалить ярлык">✕</button>
        </div>
      </div>
    `;
  }).join('');
}

window.toggleShortcut = function(index, checked) {
  if (currentConfig.shortcuts[index]) {
    currentConfig.shortcuts[index].enabled = checked;
    saveCurrentConfig('Статус ярлыка изменен');
  }
};

window.deleteShortcut = function(index) {
  if (currentConfig.shortcuts && currentConfig.shortcuts[index]) {
    const removed = currentConfig.shortcuts.splice(index, 1)[0];
    renderShortcutsList();
    saveCurrentConfig(`Ярлык "${removed.name}" удален`);
  }
};

// Render Logs
function renderLogs(logs) {
  logsFeed.innerHTML = logs.map(log => `
    <div class="log-item ${log.type === 'danger' ? 'danger' : ''}">
      <span class="log-t">${log.timestamp}</span>
      <span>${escapeHtml(log.message)}</span>
    </div>
  `).join('');
}

function appendLog(log) {
  const div = document.createElement('div');
  div.className = `log-item ${log.type === 'danger' ? 'danger' : ''}`;
  div.innerHTML = `
    <span class="log-t">${log.timestamp}</span>
    <span>${escapeHtml(log.message)}</span>
  `;
  logsFeed.insertBefore(div, logsFeed.firstChild);
}

function escapeHtml(text) {
  if (!text) return '';
  return text.toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Global Tab Switching (Mobile + Desktop)
window.switchTab = function(tabId) {
  // Update desktop tabs
  document.querySelectorAll('.tab-item').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-tab') === tabId);
  });
  // Update mobile bottom nav
  document.querySelectorAll('.m-tab').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-tab') === tabId);
  });
  // Switch pane
  document.querySelectorAll('.tab-pane').forEach(p => {
    p.classList.remove('active');
  });
  const targetPane = document.getElementById(`tab-${tabId}`);
  if (targetPane) {
    targetPane.classList.add('active');
  }
  window.scrollTo({ top: 0, behavior: 'instant' });
};

// Click handler for desktop tabs
document.querySelectorAll('.tab-item').forEach(btn => {
  btn.addEventListener('click', () => {
    switchTab(btn.getAttribute('data-tab'));
  });
});

if (filterInput) {
  filterInput.addEventListener('input', renderComputersGrid);
}

// Socket.io Events
socket.on('connect', () => {
  socket.emit('admin:register');
});

socket.on('admin:init', (data) => {
  currentClients = data.clients || [];
  currentExam = data.exam;
  currentConfig = data.config;

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
  showToast('Время тура олимпиады подошло к концу');
});

socket.on('log:new', (log) => {
  appendLog(log);
});

socket.on('alert:violation', (alertData) => {
  playViolationSound();
  showToast(`Внимание: нарушение на "${alertData.hostname}" (${alertData.processName})`);
  const pc = currentClients.find(c => c.id === alertData.clientId);
  if (pc) {
    pc.status = 'violation';
    renderComputersGrid();
  }
});

// Live Screen Stream Frame Handler
socket.on('stream:frame', (data) => {
  const pc = currentClients.find(c => c.id === data.clientId);
  if (pc) {
    pc.lastFrame = data.frame;
    if (data.activeApp) pc.activeApp = data.activeApp;
  }

  // 1. Update miniature on Live Wall
  const wallImg = document.getElementById(`wall-img-${data.clientId}`);
  const wallPlaceholder = document.getElementById(`wall-placeholder-${data.clientId}`);
  const wallApp = document.getElementById(`wall-app-${data.clientId}`);

  if (wallImg) {
    wallImg.src = data.frame;
  } else if (wallPlaceholder && wallPlaceholder.parentElement) {
    wallPlaceholder.parentElement.innerHTML = `
      <img class="wall-thumb" id="wall-img-${data.clientId}" src="${data.frame}" alt="Экран">
      <div class="wall-live-tag"><span class="dot"></span> LIVE</div>
    `;
  }

  if (wallApp && data.activeApp) {
    wallApp.textContent = data.activeApp;
    wallApp.title = data.activeApp;
  }

  // 2. Update modal view if currently watching this PC
  if (activeModalClientId === data.clientId) {
    screenshotLoading.style.display = 'none';
    screenshotImage.src = data.frame;
    screenshotImage.style.display = 'block';
  }
});

socket.on('admin:screenshot_result', (data) => {
  if (data.clientId === activeModalClientId && data.image) {
    screenshotLoading.style.display = 'none';
    screenshotImage.src = data.image;
    screenshotImage.style.display = 'block';
  }
});

// Admin Actions
btnStartExam.addEventListener('click', () => {
  const mins = parseInt(cfgDurationMinutes.value, 10) || 120;
  socket.emit('admin:start_exam', { durationMinutes: mins });
  showToast(`Олимпиада запущена на ${mins} минут`);
});

btnPauseExam.addEventListener('click', () => {
  socket.emit('admin:pause_exam');
  showToast('Статус олимпиады изменен');
});

btnStopExam.addEventListener('click', () => {
  if (confirm('Завершить олимпиаду для всех участников?')) {
    socket.emit('admin:stop_exam');
    showToast('Олимпиада завершена');
  }
});

btnLockAll.addEventListener('click', () => {
  socket.emit('admin:lock_all');
  showToast('Все компьютеры заблокированы');
});

btnUnlockAll.addEventListener('click', () => {
  socket.emit('admin:unlock_all');
  showToast('Все компьютеры разблокированы');
});

window.toggleClientLock = function(clientId, isCurrentlyLocked) {
  if (isCurrentlyLocked) {
    socket.emit('admin:unlock_client', { clientId });
    showToast('Компьютер разблокирован');
  } else {
    socket.emit('admin:lock_client', { clientId });
    showToast('Компьютер заблокирован');
  }
};

window.rebootClient = function(clientId) {
  if (confirm('Перезагрузить ПК?')) {
    socket.emit('admin:reboot_client', { clientId });
    showToast('Команда перезагрузки отправлена');
  }
};

// Screenshot & Live Control Modal
window.openScreenshotModal = function(clientId, hostname) {
  activeModalClientId = clientId;
  modalPcTitle.textContent = hostname;
  
  if (chkRemoteControl) chkRemoteControl.checked = false;
  if (remoteBanner) remoteBanner.style.display = 'none';
  if (modalViewContainer) modalViewContainer.classList.remove('remote-active');

  const pc = currentClients.find(c => c.id === clientId);
  if (pc && pc.lastFrame) {
    screenshotImage.src = pc.lastFrame;
    screenshotLoading.style.display = 'none';
    screenshotImage.style.display = 'block';
  } else {
    screenshotImage.style.display = 'none';
    screenshotLoading.style.display = 'block';
  }

  if (btnModalToggleLock && pc) {
    btnModalToggleLock.textContent = pc.isLocked ? 'Разблок' : 'Блок';
    btnModalToggleLock.onclick = () => {
      toggleClientLock(pc.id, pc.isLocked);
      btnModalToggleLock.textContent = !pc.isLocked ? 'Разблок' : 'Блок';
    };
  }

  screenshotModal.classList.add('active');
  // Request high FPS stream from client
  socket.emit('admin:focus_client', { clientId });
};

function closeScreenshotModal() {
  if (activeModalClientId) {
    socket.emit('admin:unfocus_client', { clientId: activeModalClientId });
  }
  screenshotModal.classList.remove('active');
  if (chkRemoteControl) chkRemoteControl.checked = false;
  if (remoteBanner) remoteBanner.style.display = 'none';
  if (modalViewContainer) modalViewContainer.classList.remove('remote-active');
  activeModalClientId = null;
}

btnCloseModal.addEventListener('click', closeScreenshotModal);
if (btnBottomCloseModal) btnBottomCloseModal.addEventListener('click', closeScreenshotModal);
if (modalDim) modalDim.addEventListener('click', closeScreenshotModal);

// Remote Control Toggle & Input Tracking
if (chkRemoteControl) {
  chkRemoteControl.addEventListener('change', () => {
    if (chkRemoteControl.checked) {
      if (remoteBanner) remoteBanner.style.display = 'flex';
      if (modalViewContainer) modalViewContainer.classList.add('remote-active');
      showToast('Режим удаленного управления включен');
    } else {
      if (remoteBanner) remoteBanner.style.display = 'none';
      if (modalViewContainer) modalViewContainer.classList.remove('remote-active');
      showToast('Режим удаленного управления выключен');
    }
  });
}

let lastRemoteMove = 0;
if (modalViewContainer) {
  modalViewContainer.addEventListener('mousemove', (e) => {
    if (!chkRemoteControl || !chkRemoteControl.checked || !activeModalClientId) return;
    const now = Date.now();
    if (now - lastRemoteMove < 50) return; // ~20 fps
    lastRemoteMove = now;

    const rect = screenshotImage.getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) return;

    const normX = (e.clientX - rect.left) / rect.width;
    const normY = (e.clientY - rect.top) / rect.height;

    socket.emit('admin:remote_input', {
      clientId: activeModalClientId,
      action: 'move',
      normX,
      normY
    });
  });

  modalViewContainer.addEventListener('mousedown', (e) => {
    if (!chkRemoteControl || !chkRemoteControl.checked || !activeModalClientId) return;
    e.preventDefault();

    const rect = screenshotImage.getBoundingClientRect();
    const normX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const normY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    const btn = e.button === 2 ? 'right' : 'left';

    socket.emit('admin:remote_input', {
      clientId: activeModalClientId,
      action: 'click',
      button: btn,
      normX,
      normY
    });
  });

  modalViewContainer.addEventListener('contextmenu', (e) => {
    if (chkRemoteControl && chkRemoteControl.checked) {
      e.preventDefault();
    }
  });
}

// Config Save & Auto Sync
function saveCurrentConfig(toastMsg) {
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
  if (toastMsg) showToast(toastMsg);
}

btnSaveConfig.addEventListener('click', () => {
  saveCurrentConfig('Настройки сохранены и применены на всех ПК');
});

// Shortcut Type Toggle Listeners
if (scTypeApp && scTypeBrowser) {
  scTypeApp.addEventListener('change', () => {
    newShortcutCmd.placeholder = 'Путь к файлу / команда (напр. C:\\Programs\\fp.exe)';
    newShortcutName.placeholder = 'Название (напр. Free Pascal)';
  });
  scTypeBrowser.addEventListener('change', () => {
    newShortcutCmd.placeholder = 'URL-адрес (напр. https://acmp.ru, https://codeforces.com)';
    newShortcutName.placeholder = 'Название (напр. Яндекс Контест)';
  });
}

btnAddCustomShortcut.addEventListener('click', () => {
  const name = newShortcutName.value.trim();
  const target = newShortcutCmd.value.trim();
  if (!name || !target) {
    showToast('Введите название и путь к файлу/URL');
    return;
  }

  const isBrowser = scTypeBrowser && scTypeBrowser.checked;
  const newSc = {
    id: 'custom_' + Date.now(),
    name,
    type: isBrowser ? 'browser' : 'app',
    icon: isBrowser ? 'trophy' : 'code',
    cmd: target,
    url: target,
    paths: [target],
    enabled: true
  };

  if (!currentConfig.shortcuts) currentConfig.shortcuts = [];
  currentConfig.shortcuts.push(newSc);

  newShortcutName.value = '';
  newShortcutCmd.value = '';
  renderShortcutsList();

  saveCurrentConfig(`Ярлык "${name}" добавлен и применен на всех ПК`);
});

// Broadcast
btnSendBroadcast.addEventListener('click', () => {
  const msg = broadcastInput.value.trim();
  if (!msg) return;
  socket.emit('admin:broadcast_message', { message: msg });
  broadcastInput.value = '';
  showToast('Объявление отправлено на все ПК');
});

document.querySelectorAll('.chip').forEach(chip => {
  chip.addEventListener('click', () => {
    broadcastInput.value = chip.getAttribute('data-msg');
  });
});

btnClearLogs.addEventListener('click', () => {
  logsFeed.innerHTML = '';
  showToast('Журнал очищен');
});
