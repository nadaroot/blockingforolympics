const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const pycharmLockdown = require('./pycharm-lockdown');

const WINGET_TIMEOUT_MS = 15 * 60 * 1000;
const INSTALL_TIMEOUT_MS = 20 * 60 * 1000;
const DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1000;
const PROBE_TIMEOUT_MS = 20000;
const MODEL_PULL_TIMEOUT_MS = 60 * 60 * 1000;
const OLLAMA_SETX_TIMEOUT_MS = 20000;

// Скрытый ИИ-помощник: локальный сервер модели (на диске E, как требует владелец проекта)
const AI_MODEL = 'qwen2.5-coder:1.5b';
const AI_MODELS_DIR = 'E:\\LOKED\\Ollama\\models';
const AI_OLLAMA_DIR = 'E:\\LOKED\\Ollama';

function localAppData() {
  return process.env.LOCALAPPDATA || '';
}

function isFile(p) {
  try { return !!p && fs.statSync(p).isFile(); } catch (_) { return false; }
}

function isDir(p) {
  try { return !!p && fs.statSync(p).isDirectory(); } catch (_) { return false; }
}

// Обёртка execFile: никогда не бросает, всегда возвращает код и вывод
function runCommand(file, args, timeout = PROBE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    try {
      execFile(file, args, {
        timeout,
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024
      }, (error, stdout, stderr) => {
        let code = 0;
        if (error) {
          if (typeof error.code === 'number') code = error.code;
          else code = error.killed ? -1 : 1;
        }
        resolve({
          ok: !error,
          code,
          stdout: String(stdout || ''),
          stderr: String(stderr || ''),
          error: error ? String(error.message || error) : null
        });
      });
    } catch (err) {
      resolve({ ok: false, code: 1, stdout: '', stderr: '', error: String(err && err.message || err) });
    }
  });
}

function firstExisting(candidates) {
  for (const c of candidates) {
    if (isFile(c)) return c;
  }
  return null;
}

// Поиск PascalABCNET.exe в Program Files (неглубокий обход)
function searchProgramFiles(fileName) {
  const roots = [
    'C:\\Program Files',
    'C:\\Program Files (x86)',
    path.join(localAppData(), 'Programs')
  ];
  const target = fileName.toLowerCase();
  for (const root of roots) {
    if (!isDir(root)) continue;
    let entries = [];
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (_) { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const direct = path.join(root, entry.name, fileName);
      if (isFile(direct)) return direct;
      // один уровень вложенности (например C:\Program Files (x86)\PascalABC.NET\PascalABCNET.exe)
      const nestedDir = path.join(root, entry.name);
      try {
        for (const sub of fs.readdirSync(nestedDir, { withFileTypes: true })) {
          if (!sub.isDirectory()) continue;
          const nested = path.join(nestedDir, sub.name, fileName);
          if (isFile(nested)) return nested;
          if (target === 'pascalabcnet.exe') {
            // возможен запуск через bin\ или похожую структуру
            const binFile = path.join(nestedDir, sub.name, 'bin', fileName);
            if (isFile(binFile)) return binFile;
          }
        }
      } catch (_) {}
    }
  }
  return null;
}

async function detectPython38() {
  const exe = firstExisting([
    path.join(localAppData(), 'Programs', 'Python', 'Python38', 'python.exe'),
    'C:\\Python38\\python.exe',
    'C:\\Program Files\\Python38\\python.exe'
  ]);
  if (exe) return exe;

  const probe = await runCommand('python', ['--version'], 15000);
  const text = `${probe.stdout} ${probe.stderr}`.trim();
  if (probe.ok && /3\.8(\.\d+)?/.test(text)) return `python ${text.split(/\s+/).pop()}`;
  if (probe.ok && /^Python\s+3\.8/i.test(text)) return text;
  return false;
}

async function detectFpc() {
  const fpcDir = process.env.FPCDIR || '';
  const candidates = [
    path.join(fpcDir, 'bin', 'i386-win32', 'fpc.exe'),
    'C:\\FPC\\3.2.2\\bin\\i386-win32\\fpc.exe'
  ];
  const direct = firstExisting(candidates.filter(Boolean));
  if (direct) return direct;

  // Поиск в C:\FPC\<версия>\bin\i386-win32\fpc.exe
  const fpcRoot = 'C:\\FPC';
  if (isDir(fpcRoot)) {
    try {
      const dirs = fs.readdirSync(fpcRoot, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => path.join(fpcRoot, d.name))
        .sort()
        .reverse();
      for (const dir of dirs) {
        const bin = ['i386-win32', 'x86_64-win64', 'i386-win32']
          .map((b) => path.join(dir, 'bin', b, 'fpc.exe'))
          .find(isFile);
        if (bin) return bin;
      }
    } catch (_) {}
  }

  const probe = await runCommand('fpc', ['-iV'], 15000);
  if (probe.ok && probe.stdout.trim()) return `fpc ${probe.stdout.trim()}`;
  return false;
}

async function detectCodeBlocks() {
  const exe = firstExisting([
    'C:\\Program Files\\CodeBlocks\\codeblocks.exe',
    'C:\\Program Files (x86)\\CodeBlocks\\codeblocks.exe',
    path.join(localAppData(), 'Programs', 'CodeBlocks', 'codeblocks.exe')
  ]);
  if (exe) return exe;
  return false;
}

async function detectPascalAbc() {
  const exe = firstExisting([
    'C:\\Program Files (x86)\\PascalABC.NET\\PascalABCNET.exe',
    'C:\\Program Files\\PascalABC.NET\\PascalABCNET.exe',
    path.join(localAppData(), 'PascalABC.NET', 'PascalABCNET.exe'),
    path.join(localAppData(), 'Programs', 'PascalABC.NET', 'PascalABCNET.exe')
  ]);
  if (exe) return exe;
  const found = searchProgramFiles('PascalABCNET.exe');
  return found || false;
}

async function detectPyCharm() {
  try {
    const install = pycharmLockdown.findPyCharmInstall();
    if (install) return `${install.version} — ${install.exePath}`;
  } catch (_) {}
  return false;
}

async function detectOllama() {
  const exe = firstExisting([
    path.join(localAppData(), 'Programs', 'Ollama', 'ollama.exe'),
    path.join(AI_OLLAMA_DIR, 'ollama.exe')
  ]);
  if (exe) return exe;

  const probe = await runCommand('ollama', ['--version'], 15000);
  if (probe.ok && probe.stdout.trim()) return `ollama ${probe.stdout.trim()}`;
  return false;
}

// Проверка, что модель уже скачана
async function isAiModelPresent() {
  const probe = await runCommand('ollama', ['list'], 60000);
  if (!probe.ok) return false;
  return probe.stdout.toLowerCase().includes(AI_MODEL.toLowerCase());
}

// Каталог требуемых программ для олимпиады
const REQUIRED_APPS = [
  {
    id: 'python38',
    title: 'Python 3.8',
    winget: 'Python.Python.3.8',
    urls: ['https://www.python.org/ftp/python/3.8.10/python-3.8.10-amd64.exe'],
    detect: detectPython38,
    install: { silentArgs: ['/quiet', 'InstallAllUsers=1', 'PrependPath=1', 'Include_test=0'], installerType: 'python.org' }
  },
  {
    id: 'fpc',
    title: 'Free Pascal 3.x',
    winget: 'FreePascal.FreePascal',
    urls: ['https://sourceforge.net/projects/freepascal/files/Win32/3.2.2/fpc-3.2.2.i386-win32.exe/download'],
    detect: detectFpc,
    install: { silentArgs: ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-'], installerType: 'inno' }
  },
  {
    id: 'codeblocks',
    title: 'Code::Blocks 17.12+',
    winget: 'CodeBlocks.CodeBlocks',
    urls: ['https://sourceforge.net/projects/codeblocks/files/17.12%20%28v%202023%2012%2C%20rev%2012259%29/Windows/64bit/codeblocks-17.12-setup.exe/download'],
    detect: detectCodeBlocks,
    install: { silentArgs: ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-'], installerType: 'inno' }
  },
  {
    id: 'pascalabc',
    title: 'PascalABC.NET 3.x',
    winget: null, // winget-ид не существует, ставим только по официальному URL
    urls: ['https://pascalabc.net/downloads/pascalabc-3.7.1-setup.exe'],
    detect: detectPascalAbc,
    install: { silentArgs: ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-'], installerType: 'inno' }
  },
  {
    id: 'pycharm',
    title: 'PyCharm Community (без ИИ)',
    winget: 'JetBrains.PyCharmCommunity',
    urls: ['https://download.jetbrains.com/python/pycharm-community-2024.3.5.exe'],
    detect: detectPyCharm,
    install: { silentArgs: ['/S'], installerType: 'nsis' }
  }
];

function reportProgress(onProgress, step, message, extra = {}) {
  try {
    if (typeof onProgress === 'function') onProgress({ step, message, ...extra });
  } catch (_) {}
}

// Проверка всех программ
async function detectAll() {
  const results = [];
  for (const app of REQUIRED_APPS) {
    const entry = { id: app.id, title: app.title, installed: false, version: null, required: true };
    try {
      const detected = await app.detect();
      if (detected && detected !== false) {
        const value = String(detected);
        entry.installed = true;
        entry.version = value;
        entry.path = /^[a-zA-Z]:[\\/]/.test(value) ? value : null;
      }
    } catch (err) {
      console.warn(`[Provisioner] Ошибка проверки ${app.id}:`, err && err.message);
      entry.error = String(err && err.message || err);
    }
    results.push(entry);
  }
  return results;
}

function getSetupDir() {
  const base = path.join(os.tmpdir(), 'LOKED-setup');
  try {
    if (!fs.existsSync(base)) fs.mkdirSync(base, { recursive: true });
    return base;
  } catch (err) {
    console.warn('[Provisioner] Не удалось создать каталог загрузок:', err && err.message);
    return os.tmpdir();
  }
}

function fileNameFromUrl(url, fallbackId) {
  try {
    const parsed = new URL(url);
    let name = decodeURIComponent(path.basename(parsed.pathname) || '');
    name = name.replace(/[\\/:*?"<>|]/g, '_').trim();
    if (!name || name.length < 3) return `${fallbackId}-setup.exe`;
    return name;
  } catch (_) {
    return `${fallbackId}-setup.exe`;
  }
}

// Идентификатор программы из пути загрузки (для прогресса)
function appIdFromPath(filePath) {
  try {
    const name = path.basename(filePath);
    const suffix = ['-setup.exe', '-win32.exe', '-amd64.exe'];
    for (const s of suffix) {
      if (name.toLowerCase().endsWith(s)) return name.slice(0, -s.length);
    }
    return name;
  } catch (_) {
    return filePath;
  }
}

// Скачивание установщика нативным fetch (streams в %TEMP%\LOKED-setup)
async function downloadInstaller(url, destPath, log, onProgress) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    log.push(`Скачивание ${url}`);
    reportProgress(onProgress, 'download', `Скачивание ${appIdFromPath(destPath)}`, { url });

    const res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'LOKED/1.0 (provisioner)' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

    const total = Number(res.headers.get('content-length') || 0);
    let received = 0;
    const source = Readable.fromWeb(res.body);
    if (total > 0) {
      source.on('data', (chunk) => {
        received += chunk.length;
        const percent = Math.round((received / total) * 100);
        reportProgress(onProgress, 'download_progress', `Загружено ${percent}% (${appIdFromPath(destPath)})`, { percent });
      });
    }

    const partPath = `${destPath}.part`;
    await pipeline(source, fs.createWriteStream(partPath));
    try { fs.renameSync(partPath, destPath); } catch (_) { fs.copyFileSync(partPath, destPath); fs.unlinkSync(partPath); }

    const size = fs.statSync(destPath).size;
    log.push(`Файл сохранён: ${destPath} (${size} байт)`);
    return { ok: true, size };
  } catch (err) {
    log.push(`Ошибка скачивания: ${err && err.message ? err.message : String(err)}`);
    return { ok: false, error: String(err && err.message || err) };
  } finally {
    clearTimeout(timer);
  }
}

async function installViaWinget(app, log, onProgress) {
  const probe = await runCommand('winget', ['--version'], 20000);
  if (!probe.ok) {
    log.push('winget недоступен');
    return { ok: false, reason: 'winget недоступен' };
  }

  const args = [
    'install',
    '--id', app.winget,
    '--exact',
    '--silent',
    '--accept-package-agreements',
    '--accept-source-agreements',
    '--disable-interactivity'
  ];
  log.push(`winget ${args.join(' ')}`);
  reportProgress(onProgress, 'winget', `Установка ${app.title} через winget (${app.winget})`, { appId: app.id });

  const result = await runCommand('winget', args, WINGET_TIMEOUT_MS);
  if (result.ok && result.code === 0) {
    log.push('Установка через winget завершена');
    return { ok: true };
  }

  log.push(`winget завершился с кодом ${result.code}${result.error ? `: ${result.error}` : ''}`);
  if (result.stderr.trim()) log.push(`winget stderr: ${result.stderr.trim().slice(0, 500)}`);
  return { ok: false, reason: `код выхода ${result.code}` };
}

// Установка одной программы: winget, затем официальный URL
async function installApp(app, onProgress) {
  const log = [];
  const result = { ok: false, method: 'fail', log, error: null };

  try {
    if (!app || !app.id) {
      result.error = 'Некорректное описание программы';
      return result;
    }

    reportProgress(onProgress, 'start', `Проверка ${app.title}`, { appId: app.id });

    let already = false;
    try {
      already = !!(await app.detect());
    } catch (_) {}
    if (already) {
      log.push('Программа уже установлена — установка не требуется');
      result.ok = true;
      result.method = 'skip';
      return result;
    }

    // Шаг 1: winget
    if (app.winget) {
      const wingetResult = await installViaWinget(app, log, onProgress);
      if (wingetResult.ok) {
        result.ok = true;
        result.method = 'winget';
        return result;
      }
      log.push(`Переход на установку по URL (winget не сработал: ${wingetResult.reason || 'ошибка'})`);
    } else {
      log.push('winget-ид не используется — установка по официальному URL');
    }

    // Шаг 2: официальный URL
    const url = (app.urls && app.urls[0]) || null;
    if (!url) {
      result.error = 'Нет URL для загрузки';
      log.push(result.error);
      return result;
    }

    const setupDir = getSetupDir();
    const fileName = fileNameFromUrl(url, app.id);
    const destPath = path.join(setupDir, `${app.id}-${fileName}`);

    try {
      const download = await downloadInstaller(url, destPath, log, onProgress);
      if (!download.ok) {
        result.error = download.error || 'не удалось скачать установщик';
        return result;
      }

      // Шаг 3: тихая установка
      const ext = path.extname(destPath).toLowerCase();
      let args = [];
      if (ext === '.exe') {
        const silent = (app.install && app.install.silentArgs) || ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-'];
        args = silent;
      } else {
        log.push('Файл не .exe — запуск без аргументов');
      }
      log.push(`Запуск установщика: ${destPath} ${args.join(' ')}`.trim());
      reportProgress(onProgress, 'installer', `Тихая установка ${app.title}`, { appId: app.id });

      const run = await runCommand(destPath, args, INSTALL_TIMEOUT_MS);
      log.push(`Установщик завершился с кодом ${run.code}`);

      // Шаг 4: контрольная проверка
      let detected = false;
      try {
        detected = await app.detect();
      } catch (_) {}
      if (detected) {
        result.ok = true;
        result.method = 'url';
        log.push(`Контрольная проверка: ${detected}`);
      } else {
        result.ok = run.ok && run.code === 0;
        result.method = run.ok && run.code === 0 ? 'url' : 'fail';
        if (!result.ok) result.error = `После установки программа не обнаружена (код установщика ${run.code})`;
        log.push(result.error);
      }
      return result;
    } finally {
      // Удаляем скачанный файл в любом случае
      try {
        if (isFile(destPath)) fs.unlinkSync(destPath);
        if (isFile(`${destPath}.part`)) fs.unlinkSync(`${destPath}.part`);
        log.push('Временный установщик удалён');
      } catch (err) {
        log.push(`Не удалось удалить установщик: ${err && err.message}`);
      }
    }
  } catch (err) {
    const message = String(err && err.message || err);
    console.warn(`[Provisioner] installApp(${app && app.id}):`, message);
    log.push(`Непредвиденная ошибка: ${message}`);
    result.error = message;
    result.method = 'fail';
    return result;
  }
}

// Подготовка скрытого ИИ-помощника: сервер Ollama + модель на диске E.
// Не входит в список олимпиадных программ, чтобы ученики ничего не видели.
async function ensureAiStack(options = {}) {
  const opts = options || {};
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
  const log = [];
  const result = { ok: true, ollama: null, model: null, log };

  const ollamaApp = {
    id: 'ollama',
    title: 'Ollama (сервер локальной ИИ-модели)',
    winget: 'Ollama.Ollama',
    urls: ['https://ollama.com/download/OllamaSetup.exe'],
    detect: detectOllama,
    install: { silentArgs: ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-'], installerType: 'inno' }
  };

  reportProgress(onProgress, 'ai_install', 'Установка сервера локальной ИИ-модели', { appId: 'ollama' });
  try {
    const outcome = await installApp(ollamaApp, onProgress);
    result.ollama = { ok: !!outcome.ok, method: outcome.method };
    for (const line of outcome.log || []) log.push(`[ollama] ${line}`);
    if (!outcome.ok) {
      result.ok = false;
      log.push(`Ollama не установлена: ${outcome.error || 'неизвестная ошибка'}`);
      return result;
    }
  } catch (err) {
    result.ok = false;
    result.ollama = { ok: false, method: 'fail' };
    log.push(`Ollama: непредвиденная ошибка: ${err && err.message}`);
    return result;
  }

  // Веса модели складываем на диск E
  try {
    process.env.OLLAMA_MODELS = AI_MODELS_DIR;
    if (!fs.existsSync(AI_MODELS_DIR)) fs.mkdirSync(AI_MODELS_DIR, { recursive: true });
    log.push(`Каталог моделей: ${AI_MODELS_DIR}`);
    const setx = await runCommand('setx', ['OLLAMA_MODELS', AI_MODELS_DIR], OLLAMA_SETX_TIMEOUT_MS);
    log.push(setx.ok ? 'Переменная OLLAMA_MODELS сохранена для пользователя' : 'Не удалось сохранить OLLAMA_MODELS (не критично)');
  } catch (err) {
    log.push(`Ошибка каталога моделей: ${err && err.message}`);
  }

  if (await isAiModelPresent()) {
    log.push(`Модель ${AI_MODEL} уже загружена`);
    result.model = { ok: true, present: true };
    return result;
  }

  reportProgress(onProgress, 'ai_model', `Загрузка модели ${AI_MODEL}`, { model: AI_MODEL });
  log.push(`ollama pull ${AI_MODEL}`);
  const pull = await runCommand('ollama', ['pull', AI_MODEL], MODEL_PULL_TIMEOUT_MS);
  result.model = { ok: pull.ok && pull.code === 0, present: await isAiModelPresent() };
  if (!result.model.ok) {
    result.ok = false;
    log.push(`Не удалось загрузить модель ${AI_MODEL} (код ${pull.code})`);
  } else {
    log.push(`Модель ${AI_MODEL} готова`);
  }
  return result;
}

// Полная подготовка окружения: проверка -> установка -> аудит
async function ensureEnvironment(options = {}) {
  const opts = options || {};
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
  const report = {
    checkedAt: new Date().toISOString(),
    apps: [],
    installed: [],
    pycharm: {},
    errors: []
  };

  try {
    reportProgress(onProgress, 'detect', 'Проверка установленного ПО');
    let detected = [];
    try {
      detected = await detectAll();
    } catch (err) {
      report.errors.push(`Ошибка проверки окружения: ${err && err.message}`);
    }
    report.apps = detected;

    const missing = detected.filter((app) => !app.installed);
    if (missing.length === 0) {
      console.log('[Provisioner] Всё необходимое ПО уже установлено');
    } else {
      console.log(`[Provisioner] Отсутствует программ: ${missing.length}`);
    }

    if (opts.autoInstall === true) {
      for (const entry of missing) {
        const app = REQUIRED_APPS.find((a) => a.id === entry.id);
        if (!app) continue;
        reportProgress(onProgress, 'install_start', `Установка ${app.title}`, { appId: app.id });
        console.log(`[Provisioner] Установка ${app.title}...`);

        let outcome = { ok: false, method: 'fail', log: ['внутренняя ошибка'], error: null };
        try {
          outcome = await installApp(app, onProgress);
        } catch (err) {
          outcome.error = String(err && err.message || err);
        }

        for (const line of outcome.log || []) console.log(`[Provisioner] [${app.id}] ${line}`);

        report.installed.push({
          id: app.id,
          title: app.title,
          method: outcome.method,
          ok: !!outcome.ok,
          error: outcome.error || null
        });

        if (!outcome.ok) report.errors.push(`${app.title}: ${outcome.error || 'установка не удалась'}`);

        // Обновляем статус в общем отчёте
        const target = report.apps.find((a) => a.id === app.id);
        if (target) {
          try {
            const now = await app.detect();
            target.installed = !!(now && now !== false);
            target.version = target.installed ? String(now) : target.version;
          } catch (_) {}
        }
      }
    } else {
      reportProgress(onProgress, 'skip_install', 'Автоустановка выключена (autoInstall: false)');
    }

    // Аудит PyCharm
    let audit = { installed: false, problems: ['Аудит не выполнялся'] };
    try {
      audit = await pycharmLockdown.auditPyCharm();
    } catch (err) {
      report.errors.push(`Ошибка аудита PyCharm: ${err && err.message}`);
    }

    let harden = null;
    if (opts.hardenPyCharm !== false) {
      try {
        reportProgress(onProgress, 'harden_pycharm', 'Настройка PyCharm без ИИ и плагинов');
        harden = await pycharmLockdown.hardenPyCharm({ blockNetwork: !!opts.blockNetwork });
        for (const e of harden.errors || []) report.errors.push(`PyCharm: ${e}`);
      } catch (err) {
        report.errors.push(`Ошибка настройки PyCharm: ${err && err.message}`);
      }
    }

    report.pycharm = { audit, harden };

    // Скрытый ИИ-помощник: ставим только при явной автоустановке
    if (opts.autoInstall === true) {
      reportProgress(onProgress, 'ai_start', 'Подготовка локальной ИИ-модели');
      try {
        report.ai = await ensureAiStack({ onProgress });
        for (const line of report.ai.log || []) console.log(`[Provisioner] [ai] ${line}`);
        if (!report.ai.ok) report.errors.push('ИИ-помощник: не удалось подготовить локальную модель');
      } catch (err) {
        report.errors.push(`Ошибка подготовки ИИ-помощника: ${err && err.message}`);
      }
    }

    return report;
  } catch (err) {
    const message = String(err && err.message || err);
    console.warn('[Provisioner] ensureEnvironment:', message);
    report.errors.push(`Непредвиденная ошибка: ${message}`);
    return report;
  }
}

module.exports = {
  REQUIRED_APPS,
  AI_MODEL,
  AI_MODELS_DIR,
  detectAll,
  installApp,
  ensureAiStack,
  ensureEnvironment
};
