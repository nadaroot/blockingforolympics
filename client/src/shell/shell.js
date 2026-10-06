const { ipcRenderer } = require('electron');

// Elements
const timerContainer = document.getElementById('examTimerContainer');
const timerDot = document.getElementById('timerDot');
const timerDigits = document.getElementById('timerDigits');
const timerLabel = document.getElementById('timerLabel');
const systemClock = document.getElementById('systemClock');
const shortcutsGrid = document.getElementById('shortcutsGrid');

const broadcastBanner = document.getElementById('broadcastBanner');
const broadcastText = document.getElementById('broadcastText');
const btnCloseBanner = document.getElementById('btnCloseBanner');

const screenLockerOverlay = document.getElementById('screenLockerOverlay');
const lockerReason = document.getElementById('lockerReason');

const unlockModal = document.getElementById('unlockModal');
const unlockPasswordInput = document.getElementById('unlockPasswordInput');
const btnCancelUnlock = document.getElementById('btnCancelUnlock');
const btnConfirmUnlock = document.getElementById('btnConfirmUnlock');
const unlockError = document.getElementById('unlockError');

// Minimal SVG Icons (Lucide/Geist stroke icons)
const ICONS = {
  trophy: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>`,
  code: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,
  terminal: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/></svg>`,
  calculator: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect width="16" height="20" x="4" y="2" rx="2"/><line x1="8" x2="16" y1="6" y2="6"/><line x1="16" x2="16" y1="14" y2="18"/><path d="M16 10h.01"/><path d="M12 10h.01"/><path d="M8 10h.01"/><path d="M12 14h.01"/><path d="M8 14h.01"/><path d="M12 18h.01"/><path d="M8 18h.01"/></svg>`,
  file: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>`,
  cpu: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/></svg>`,
  cube: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m21.12 6.4-6.05-4.06a4.95 4.95 0 0 0-5.14 0L3.88 6.4a2.98 2.98 0 0 0-1.88 2.76v5.68c0 1.16.68 2.2 1.88 2.76l6.05 4.06c1.62 1.08 3.52 1.08 5.14 0l6.05-4.06c1.2-.56 1.88-1.6 1.88-2.76V9.16c0-1.16-.68-2.2-1.88-2.76Z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" x2="12" y1="22.08" y2="12"/></svg>`
};

function getIcon(iconType) {
  if (iconType === 'trophy') return ICONS.trophy;
  if (iconType === 'terminal') return ICONS.terminal;
  if (iconType === 'calculator') return ICONS.calculator;
  if (iconType === 'file-text' || iconType === 'file-code') return ICONS.file;
  if (iconType === 'cpu') return ICONS.cpu;
  if (iconType === 'code' || iconType === 'hash') return ICONS.code;
  return ICONS.cube;
}

// Clock
function updateClock() {
  const now = new Date();
  systemClock.textContent = now.toLocaleTimeString('ru-RU');
}
setInterval(updateClock, 1000);
updateClock();

// Format Seconds
function formatTime(totalSeconds) {
  if (totalSeconds < 0) totalSeconds = 0;
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map(v => v.toString().padStart(2, '0')).join(':');
}

// Render Available Shortcuts
function renderShortcuts(shortcuts) {
  if (!shortcuts || shortcuts.length === 0) {
    shortcutsGrid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; color: #525252; padding: 40px; font-size: 13px;">
        Нет доступных программ на данной станции.
      </div>
    `;
    return;
  }

  shortcutsGrid.innerHTML = shortcuts.map(s => {
    const isContest = s.id === 'contest';
    const featuredClass = isContest ? 'featured' : '';
    const desc = isContest ? 'Тестирующая система' : 'Среда разработки';

    return `
      <div class="app-card ${featuredClass}" onclick="launchApp('${s.id}')">
        <div class="app-icon">
          ${getIcon(s.icon || (isContest ? 'trophy' : 'code'))}
        </div>
        <div class="app-meta">
          <div class="app-name">${escapeHtml(s.name)}</div>
          <div class="app-desc">${desc}</div>
        </div>
      </div>
    `;
  }).join('');
}

window.launchApp = async function(id) {
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

// IPC Handlers
ipcRenderer.on('config-update', (event, config) => {
  if (config.shortcuts) {
    renderShortcuts(config.shortcuts);
  }
});

ipcRenderer.on('exam-update', (event, exam) => {
  if (exam.status === 'running') {
    timerDigits.textContent = formatTime(exam.remainingSeconds);
    timerLabel.textContent = 'Идет тур';
    timerDot.classList.add('active');
    screenLockerOverlay.classList.remove('active');
  } else if (exam.status === 'paused') {
    timerLabel.textContent = 'Пауза';
    timerDot.classList.remove('active');
  } else {
    timerDigits.textContent = '--:--:--';
    timerLabel.textContent = 'Ожидание';
    timerDot.classList.remove('active');
  }
});

ipcRenderer.on('exam-tick', (event, tick) => {
  timerDigits.textContent = formatTime(tick.remainingSeconds);
  if (tick.status === 'running') {
    timerLabel.textContent = 'Идет тур';
    timerDot.classList.add('active');
  }
});

ipcRenderer.on('exam-ended', () => {
  timerLabel.textContent = 'Завершен';
  timerDot.classList.remove('active');
  lockerReason.textContent = 'Время тура истекло.';
  screenLockerOverlay.classList.add('active');
});

ipcRenderer.on('client-locked', (event, data) => {
  lockerReason.textContent = data?.reason || 'Ожидайте указаний преподавателя.';
  screenLockerOverlay.classList.add('active');
});

ipcRenderer.on('client-unlocked', () => {
  screenLockerOverlay.classList.remove('active');
});

ipcRenderer.on('broadcast-message', (event, text) => {
  broadcastText.textContent = text;
  broadcastBanner.classList.add('active');
  setTimeout(() => broadcastBanner.classList.remove('active'), 12000);
});

btnCloseBanner.addEventListener('click', () => {
  broadcastBanner.classList.remove('active');
});

// Secret Teacher Unlock Dialog (Ctrl + Alt + Shift + L)
function openSecretUnlock() {
  unlockPasswordInput.value = '';
  unlockError.style.display = 'none';
  unlockModal.classList.add('active');
  unlockPasswordInput.focus();
}

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.altKey && e.shiftKey && (e.key === 'L' || e.key === 'l' || e.key === 'д' || e.key === 'Д')) {
    e.preventDefault();
    openSecretUnlock();
  }
});

btnCancelUnlock.addEventListener('click', () => {
  unlockModal.classList.remove('active');
});

btnConfirmUnlock.addEventListener('click', async () => {
  const pwd = unlockPasswordInput.value;
  const res = await ipcRenderer.invoke('verify-unlock', pwd);
  if (res.success) {
    unlockModal.classList.remove('active');
  } else {
    unlockError.style.display = 'block';
  }
});

unlockPasswordInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') btnConfirmUnlock.click();
  if (e.key === 'Escape') btnCancelUnlock.click();
});

// Initial config fetch
ipcRenderer.invoke('get-config').then(cfg => {
  if (cfg && cfg.shortcuts) {
    renderShortcuts(cfg.shortcuts);
  }
});
