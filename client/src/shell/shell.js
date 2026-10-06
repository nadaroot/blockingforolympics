const { ipcRenderer } = require('electron');
const os = require('os');

// DOM Elements
const stationNameEl = document.getElementById('stationName');
const netStatusEl = document.getElementById('netStatus');
const timerDigitsEl = document.getElementById('timerDigits');
const timerBadgeEl = document.getElementById('timerBadge');
const systemClockEl = document.getElementById('systemClock');
const shortcutsGridEl = document.getElementById('shortcutsGrid');

// Modals & Overlays
const broadcastBanner = document.getElementById('broadcastBanner');
const broadcastText = document.getElementById('broadcastText');
const btnCloseBanner = document.getElementById('btnCloseBanner');

const violationModal = document.getElementById('violationModal');
const violationMsg = document.getElementById('violationMsg');
const btnAckViolation = document.getElementById('btnAckViolation');

const screenLockerOverlay = document.getElementById('screenLockerOverlay');
const lockerReasonEl = document.getElementById('lockerReason');

const unlockModal = document.getElementById('unlockModal');
const unlockPasswordInput = document.getElementById('unlockPasswordInput');
const btnUnlockPrompt = document.getElementById('btnUnlockPrompt');
const btnCancelUnlock = document.getElementById('btnCancelUnlock');
const btnConfirmUnlock = document.getElementById('btnConfirmUnlock');
const unlockErrorEl = document.getElementById('unlockError');

// State
let stationHostname = os.hostname();
stationNameEl.textContent = `СТАНЦИЯ: ${stationHostname.toUpperCase()}`;

let shortcuts = [
  {
    id: 'contest',
    name: 'Олимпиада (Контест)',
    type: 'browser',
    icon: 'trophy',
    color: '#f59e0b',
    url: 'https://contest.yandex.ru',
    enabled: true
  },
  {
    id: 'pycharm',
    name: 'PyCharm Community',
    type: 'app',
    icon: 'code',
    color: '#06b6d4',
    enabled: true
  },
  {
    id: 'pascal',
    name: 'PascalABC.NET',
    type: 'app',
    icon: 'terminal',
    color: '#3b82f6',
    enabled: true
  },
  {
    id: 'codeblocks',
    name: 'Code::Blocks (C++)',
    type: 'app',
    icon: 'cpu',
    color: '#10b981',
    enabled: true
  },
  {
    id: 'vscode',
    name: 'VS Code',
    type: 'app',
    icon: 'file-code',
    color: '#6366f1',
    enabled: true
  },
  {
    id: 'idle',
    name: 'Python IDLE',
    type: 'app',
    icon: 'hash',
    color: '#eab308',
    enabled: true
  },
  {
    id: 'calc',
    name: 'Калькулятор',
    type: 'app',
    icon: 'calculator',
    color: '#8b5cf6',
    enabled: true
  },
  {
    id: 'notepad',
    name: 'Блокнот',
    type: 'app',
    icon: 'file-text',
    color: '#64748b',
    enabled: true
  }
];

// Clock tick
function updateClock() {
  const now = new Date();
  systemClockEl.textContent = now.toLocaleTimeString('ru-RU');
}
setInterval(updateClock, 1000);
updateClock();

// Format time
function formatTime(totalSeconds) {
  if (totalSeconds < 0) totalSeconds = 0;
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map(v => v.toString().padStart(2, '0')).join(':');
}

// Render Shortcuts Grid
function renderShortcuts() {
  const activeShortcuts = shortcuts.filter(s => s.enabled);
  shortcutsGridEl.innerHTML = activeShortcuts.map(s => {
    const isContest = s.id === 'contest';
    const featuredClass = isContest ? 'featured' : '';
    const desc = isContest ? 'Тестирующая система' : (s.type === 'browser' ? 'Веб-ресурс' : 'Среда разработки');

    return `
      <div class="shortcut-tile ${featuredClass}" onclick="launchShortcut('${s.id}')">
        <div class="tile-icon" style="background: ${s.color || '#3b82f6'};">
          <i class="fa-solid fa-${s.icon || 'cube'}"></i>
        </div>
        <div>
          <div class="tile-title">${escapeHtml(s.name)}</div>
          <div class="tile-desc">${desc}</div>
        </div>
      </div>
    `;
  }).join('');
}

window.launchShortcut = async function(id) {
  const res = await ipcRenderer.invoke('launch-app', id);
  if (!res.success && res.message) {
    alert(res.message);
  }
};

function escapeHtml(text) {
  if (!text) return '';
  return text.toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// IPC from Main Process
ipcRenderer.on('server-status', (event, data) => {
  if (data.connected) {
    netStatusEl.innerHTML = `<i class="fa-solid fa-circle text-success"></i> В сети с сервером учителя (${data.serverUrl})`;
  } else {
    netStatusEl.innerHTML = `<i class="fa-solid fa-circle text-danger"></i> Офлайн (Поиск учителя...)`;
  }
});

ipcRenderer.on('config-update', (event, config) => {
  if (config.shortcuts && Array.isArray(config.shortcuts)) {
    shortcuts = config.shortcuts;
    renderShortcuts();
  }
});

ipcRenderer.on('exam-update', (event, exam) => {
  if (exam.status === 'running') {
    timerDigitsEl.textContent = formatTime(exam.remainingSeconds);
    timerBadgeEl.className = 'timer-badge badge-active';
    timerBadgeEl.textContent = 'Идет олимпиада';
    screenLockerOverlay.classList.remove('active');
  } else if (exam.status === 'paused') {
    timerBadgeEl.className = 'timer-badge badge-paused';
    timerBadgeEl.textContent = 'На паузе';
  } else {
    timerDigitsEl.textContent = '--:--:--';
    timerBadgeEl.className = 'timer-badge badge-waiting';
    timerBadgeEl.textContent = 'Ожидание старта';
  }
});

ipcRenderer.on('exam-tick', (event, tick) => {
  timerDigitsEl.textContent = formatTime(tick.remainingSeconds);
  if (tick.status === 'running') {
    timerBadgeEl.className = 'timer-badge badge-active';
    timerBadgeEl.textContent = 'Идет олимпиада';
  }
});

ipcRenderer.on('exam-ended', () => {
  timerBadgeEl.className = 'timer-badge badge-waiting';
  timerBadgeEl.textContent = 'Олимпиада завершена';
  lockerReasonEl.textContent = 'Время тура истекло! Ожидайте подведения итогов.';
  screenLockerOverlay.classList.add('active');
});

ipcRenderer.on('client-locked', (event, data) => {
  lockerReasonEl.textContent = data?.reason || 'Ожидайте указаний учителя.';
  screenLockerOverlay.classList.add('active');
});

ipcRenderer.on('client-unlocked', () => {
  screenLockerOverlay.classList.remove('active');
});

ipcRenderer.on('broadcast-message', (event, text) => {
  broadcastText.textContent = text;
  broadcastBanner.classList.add('active');
  // Auto-hide after 15 seconds
  setTimeout(() => {
    broadcastBanner.classList.remove('active');
  }, 15000);
});

btnCloseBanner.addEventListener('click', () => {
  broadcastBanner.classList.remove('active');
});

ipcRenderer.on('security-violation', (event, violation) => {
  violationMsg.textContent = `Обнаружен запуск неразрешенного приложения: "${violation.processName}". Процесс был немедленно принудительно закрыт. Учитель уведомлен о нарушении!`;
  violationModal.classList.add('active');
});

btnAckViolation.addEventListener('click', () => {
  violationModal.classList.remove('active');
});

// Master Unlock
btnUnlockPrompt.addEventListener('click', () => {
  unlockPasswordInput.value = '';
  unlockErrorEl.style.display = 'none';
  unlockModal.classList.add('active');
  unlockPasswordInput.focus();
});

btnCancelUnlock.addEventListener('click', () => {
  unlockModal.classList.remove('active');
});

btnConfirmUnlock.addEventListener('click', async () => {
  const pwd = unlockPasswordInput.value;
  const res = await ipcRenderer.invoke('verify-unlock', pwd);
  if (res.success) {
    unlockModal.classList.remove('active');
    alert('ПК успешно разблокирован! Нажмите OK для выхода из полноэкранного режима.');
  } else {
    unlockErrorEl.style.display = 'block';
  }
});

unlockPasswordInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    btnConfirmUnlock.click();
  } else if (e.key === 'Escape') {
    btnCancelUnlock.click();
  }
});

// Secret Teacher Hotkey (Ctrl + Alt + Shift + L)
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.altKey && e.shiftKey && (e.key === 'L' || e.key === 'l' || e.key === 'д' || e.key === 'Д')) {
    btnUnlockPrompt.click();
  }
});

// Initial Render
renderShortcuts();
