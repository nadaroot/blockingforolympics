const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Блокировка сети JetBrains пишется между этими маркерами в hosts
const HOSTS_START = '# LOKED-START';
const HOSTS_END = '# LOKED-END';
const HOSTS_FILE = 'C:\\Windows\\System32\\drivers\\etc\\hosts';
const HOSTS_BLOCK_LINES = [
  '0.0.0.0 plugins.jetbrains.com',
  '0.0.0.0 www.jetbrains.com',
  '0.0.0.0 download.jetbrains.com',
  '0.0.0.0 data.services.jetbrains.com'
];

// Официальные системные свойства, отключающие телеметрию/согласия/доверие проектам
const VMOPTIONS_REQUIRED = [
  '-Djb.consents.endurance.enabled=false',
  '-Djb.privacy.policy.text=##0.0.0.0',
  '-Didea.trust.all.projects=true'
];

// Признаки AI-плагинов (без ложных срабатываний вроде mail/chain/domain)
const AI_TOKENS = [
  'com.intellij.ml.chat',
  'intellij.ai',
  'ai.assistant',
  'com.intellij.ai',
  'copilot',
  'llm',
  'jetbrains.ai',
  'ml.chat',
  'chatgpt',
  'gemini',
  'codeium',
  'tabnine',
  'aider'
];
const AI_NAME_WORDS = ['ai', 'chatgpt', 'llm', 'copilot', 'assistant', 'intelligence', 'ml'];

// Каталоги, где может лежать установленный PyCharm
function getSearchRoots() {
  const localAppData = process.env.LOCALAPPDATA || '';
  const appData = process.env.APPDATA || '';
  return [
    path.join(localAppData, 'Programs'),
    path.join(localAppData, 'JetBrains', 'Toolbox', 'apps'),
    'C:\\Program Files\\JetBrains',
    'C:\\Program Files (x86)\\JetBrains'
  ];
}

function safeReaddir(dir) {
  try {
    if (!dir || !fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return [];
  }
}

function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch (_) { return false; }
}

function isFile(p) {
  try { return fs.statSync(p).isFile(); } catch (_) { return false; }
}

// product-info.json рядом с exe лежит в корне установки
function readVersionFromProductInfo(installDir) {
  try {
    const file = path.join(installDir, 'product-info.json');
    if (!isFile(file)) return null;
    const raw = fs.readFileSync(file, 'utf8');
    const json = JSON.parse(raw);
    if (json && json.version) return String(json.version);
    return null;
  } catch (_) {
    return null;
  }
}

function findExeInInstall(installDir) {
  const candidates = [
    path.join(installDir, 'bin', 'pycharm64.exe'),
    path.join(installDir, 'bin', 'pycharm.exe'),
    path.join(installDir, 'pycharm64.exe'),
    path.join(installDir, 'pycharm.exe')
  ];
  for (const c of candidates) {
    if (isFile(c)) return c;
  }
  return null;
}

// Один уровень вложенности (JetBrains Toolbox: apps\PyCharm-P\<chan>\<build>)
function collectInstallDirs(root, depth = 2) {
  const found = [];
  const walk = (dir, level) => {
    for (const entry of safeReaddir(dir)) {
      if (!entry.isDirectory()) continue;
      const full = path.join(dir, entry.name);
      const lower = entry.name.toLowerCase();
      if (level === 0 && !lower.startsWith('pycharm')) continue;
      found.push(full);
      if (level + 1 < depth) walk(full, level + 1);
    }
  };
  walk(root, 0);
  return found;
}

// Поиск установленного PyCharm. Возвращает null, если не найден.
function findPyCharmInstall() {
  try {
    const candidates = [];

    for (const root of getSearchRoots()) {
      if (!root || !isDir(root)) continue;
      for (const dir of collectInstallDirs(root, 3)) {
        const exePath = findExeInInstall(dir);
        if (exePath) candidates.push({ installDir: dir, exePath });
      }
    }

    if (candidates.length === 0) return null;

    // Берем самую свежую установку (по product-info.json / дате изменения папки)
    candidates.sort((a, b) => {
      const av = readVersionFromProductInfo(a.installDir) || '0';
      const bv = readVersionFromProductInfo(b.installDir) || '0';
      if (av !== bv) return av < bv ? 1 : -1;
      try {
        return fs.statSync(b.exePath).mtimeMs - fs.statSync(a.exePath).mtimeMs;
      } catch (_) {
        return 0;
      }
    });

    const best = candidates[0];
    let version = readVersionFromProductInfo(best.installDir);

    if (!version) {
      // Подсказка о версии из %APPDATA%\JetBrains\PyCharm<version>
      try {
        const jetbrainsDir = path.join(process.env.APPDATA || '', 'JetBrains');
        const dirs = safeReaddir(jetbrainsDir)
          .filter((d) => d.isDirectory() && /^pycharm/i.test(d.name))
          .map((d) => d.name.replace(/^pycharm/i, ''))
          .filter(Boolean)
          .sort();
        if (dirs.length > 0) version = dirs[dirs.length - 1];
      } catch (_) {}
    }

    if (!version) version = 'unknown';

    const configDir = path.join(process.env.APPDATA || '', 'JetBrains', `PyCharm${version}`);
    return { installDir: best.installDir, exePath: best.exePath, version, configDir };
  } catch (err) {
    console.warn('[PyCharm] Ошибка поиска установки:', err && err.message);
    return null;
  }
}

function readPluginXml(pluginDir) {
  const xml = path.join(pluginDir, 'META-INF', 'plugin.xml');
  if (!isFile(xml)) return null;
  try {
    const raw = fs.readFileSync(xml, 'utf8');
    const pick = (tag) => {
      const m = raw.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'));
      return m ? m[1].trim() : null;
    };
    return { id: pick('id'), name: pick('name') };
  } catch (_) {
    return null;
  }
}

// Список встроенных (bundled) плагинов из META-INF/plugin.xml
function listBundledPlugins(installDir) {
  const result = [];
  const seen = new Set();
  try {
    if (!installDir || !isDir(installDir)) return result;

    const roots = [path.join(installDir, 'plugins')];
    const pyRoot = path.join(installDir, 'plugins', 'python-ce-root', 'plugins');
    if (isDir(pyRoot)) roots.push(pyRoot);

    for (const root of roots) {
      for (const entry of safeReaddir(root)) {
        if (!entry.isDirectory()) continue;
        const dir = path.join(root, entry.name);
        const meta = readPluginXml(dir);
        if (!meta && !isDir(path.join(dir, 'META-INF'))) continue;

        const id = meta && meta.id ? meta.id : entry.name;
        const name = meta && meta.name ? meta.name : entry.name;
        const key = `${root}|${id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({ id, name, dir });
      }
    }
    return result;
  } catch (err) {
    console.warn('[PyCharm] Ошибка чтения списка плагинов:', err && err.message);
    return result;
  }
}

// Признак AI-плагина: ищем целые слова в id/name, без ложных срабатываний
function isAiPlugin(plugin) {
  const id = String((plugin && plugin.id) || '').toLowerCase();
  const name = String((plugin && plugin.name) || '').toLowerCase();
  const haystack = `${id} ${name}`;

  for (const token of AI_TOKENS) {
    if (haystack.includes(token)) return true;
  }

  // Целые слова: "ai", "AI Assistant", "Chat", "LLM" и т.п.
  const words = haystack.split(/[^a-z0-9.]+/);
  for (const word of words) {
    const clean = word.replace(/^\.+|\.+$/g, '');
    if (!clean) continue;
    if (AI_NAME_WORDS.includes(clean)) return true;
  }
  return false;
}

function ensureDir(dir) {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return true;
  } catch (_) {
    return false;
  }
}

// Записывает disabled_plugins.txt (официальный способ отключения плагинов)
function writeDisabledPlugins(configDir, plugins) {
  const file = path.join(configDir, 'disabled_plugins.txt');
  const existing = [];
  try {
    if (isFile(file)) {
      for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const t = line.trim();
        if (t) existing.push(t);
      }
    }
  } catch (_) {}

  // Комментарии в этом файле официально не поддерживаются — только id/name
  const ids = [];
  const names = [];
  for (const plugin of plugins) {
    if (plugin.id) ids.push(plugin.id);
    if (plugin.name) names.push(plugin.name);
  }

  const merged = [];
  const seen = new Set();
  for (const value of [...existing, ...ids, ...names]) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(value);
  }

  fs.writeFileSync(file, `${merged.join('\n')}\n`, 'utf8');
  return { file, count: ids.length };
}

// Дописывает vmoptions, сохраняя существующие строки и не создавая дублей
function writeVmOptions(configDir) {
  const file64 = path.join(configDir, 'pycharm64.exe.vmoptions');
  const file32 = path.join(configDir, 'pycharm.exe.vmoptions');
  const target = isFile(file32) ? file32 : file64;

  let lines = [];
  try {
    if (isFile(target)) {
      lines = fs.readFileSync(target, 'utf8').split(/\r?\n/);
    }
  } catch (err) {
    console.warn('[PyCharm] Не удалось прочитать vmoptions:', err && err.message);
    return { file: target, ok: false };
  }

  let changed = false;
  for (const option of VMOPTIONS_REQUIRED) {
    const present = lines.some((line) => line.trim() === option);
    if (!present) {
      lines.push(option);
      changed = true;
    }
  }

  const body = lines.filter((line, index) => !(line === '' && index === lines.length - 1));
  try {
    fs.writeFileSync(target, `${body.join('\n')}\n`, 'utf8');
    return { file: target, ok: true, changed };
  } catch (err) {
    console.warn('[PyCharm] Не удалось записать vmoptions:', err && err.message);
    return { file: target, ok: false };
  }
}

function isAdministrator() {
  try {
    const result = spawnSync('net', ['session'], {
      windowsHide: true,
      timeout: 8000,
      stdio: 'ignore'
    });
    return !result.error && result.status === 0;
  } catch (_) {
    return false;
  }
}

function canWriteHosts() {
  try {
    if (!isFile(HOSTS_FILE)) return false;
    fs.accessSync(HOSTS_FILE, fs.constants.W_OK);
    const handle = fs.openSync(HOSTS_FILE, 'r+');
    fs.closeSync(handle);
    return true;
  } catch (_) {
    return false;
  }
}

// Идемпотентная блокировка доменов JetBrains между маркерами LOKED
function blockJetBrainsNetwork() {
  const note = (text) => ({ ok: false, note: text });

  try {
    if (!isFile(HOSTS_FILE)) {
      return note('Файл hosts не найден — блокировка сети невозможна');
    }
    if (!isAdministrator()) {
      return note('Нет прав администратора — блокировка доменов JetBrains пропущена');
    }
    if (!canWriteHosts()) {
      return note('Нет доступа на запись в hosts — блокировка доменов JetBrains пропущена');
    }

    let content = '';
    try {
      content = fs.readFileSync(HOSTS_FILE, 'utf8');
    } catch (err) {
      return note(`Не удалось прочитать hosts: ${err && err.message}`);
    }

    const lines = content.split(/\r?\n/);
    const out = [];
    let insideBlock = false;
    let alreadyPresent = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === HOSTS_START) { insideBlock = true; continue; }
      if (trimmed === HOSTS_END) { insideBlock = false; continue; }
      if (insideBlock) continue; // старый блок выбрасываем целиком
      if (HOSTS_BLOCK_LINES.includes(trimmed)) { alreadyPresent = true; continue; }
      out.push(line);
    }

    if (alreadyPresent) {
      // Дубли не создаём: если правила уже есть вне блока, просто добавим блок без дублей
      const filtered = out.filter((line) => !HOSTS_BLOCK_LINES.includes(line.trim()));
      out.length = 0;
      out.push(...filtered);
    }

    const tail = out.length > 0 && out[out.length - 1].trim() !== '' ? [''] : [];
    const block = [HOSTS_START, ...HOSTS_BLOCK_LINES, HOSTS_END];
    const nextContent = [...out, ...tail, ...block, ''].join('\r\n');

    try {
      fs.writeFileSync(HOSTS_FILE, nextContent, 'utf8');
    } catch (err) {
      return note(`Запись в hosts не удалась: ${err && err.message}`);
    }

    return { ok: true, note: 'Домены JetBrains заблокированы в hosts (требуется перезапуск сетевого стека для полного эффекта)' };
  } catch (err) {
    return note(`Ошибка блокировки сети: ${err && err.message}`);
  }
}

// Усиление конфигурации PyCharm официальными средствами JetBrains
async function hardenPyCharm(options = {}) {
  const opts = options || {};
  const report = {
    ok: false,
    installDir: null,
    version: null,
    configDir: null,
    pluginsDisabled: 0,
    vmoptionsWritten: false,
    networkBlocked: false,
    networkNote: 'Блокировка сети не запрашивалась',
    errors: []
  };

  try {
    const install = findPyCharmInstall();
    if (!install) {
      report.errors.push('PyCharm не найден — нечего настраивать');
      return report;
    }

    report.installDir = install.installDir;
    report.version = install.version;
    report.configDir = install.configDir;

    if (!ensureDir(install.configDir)) {
      report.errors.push(`Не удалось создать каталог конфигурации ${install.configDir}`);
      return report;
    }

    const plugins = listBundledPlugins(install.installDir);
    try {
      const disabled = writeDisabledPlugins(install.configDir, plugins);
      report.pluginsDisabled = disabled.count;
      console.log(`[PyCharm] Записано ${disabled.count} плагинов в disabled_plugins.txt`);
    } catch (err) {
      report.errors.push(`Ошибка записи disabled_plugins.txt: ${err && err.message}`);
    }

    try {
      const vm = writeVmOptions(install.configDir);
      report.vmoptionsWritten = !!vm.ok;
      if (!vm.ok) report.errors.push('Не удалось записать vmoptions');
    } catch (err) {
      report.errors.push(`Ошибка записи vmoptions: ${err && err.message}`);
    }

    if (opts.blockNetwork === true) {
      const net = blockJetBrainsNetwork();
      report.networkBlocked = !!net.ok;
      report.networkNote = net.note;
    } else {
      report.networkNote = 'Блокировка сети отключена (передайте blockNetwork: true)';
    }

    report.ok = report.errors.length === 0;
    return report;
  } catch (err) {
    console.warn('[PyCharm] hardenPyCharm: непредвиденная ошибка:', err && err.message);
    report.errors.push(`Непредвиденная ошибка: ${err && err.message}`);
    return report;
  }
}

function readDisabledPluginIds(configDir) {
  const file = path.join(configDir, 'disabled_plugins.txt');
  const set = new Set();
  try {
    if (!isFile(file)) return set;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const t = line.trim();
      if (t) set.add(t.toLowerCase());
    }
  } catch (_) {}
  return set;
}

function isNetworkBlocked() {
  try {
    if (!isFile(HOSTS_FILE)) return false;
    const content = fs.readFileSync(HOSTS_FILE, 'utf8');
    return HOSTS_BLOCK_LINES.every((line) => content.includes(line));
  } catch (_) {
    return false;
  }
}

// Аудит текущего состояния PyCharm
async function auditPyCharm() {
  const report = {
    installed: false,
    version: null,
    totalPlugins: 0,
    disabledCount: 0,
    allDisabled: false,
    aiPluginIds: [],
    aiDisabled: false,
    networkBlocked: false,
    problems: []
  };

  try {
    const install = findPyCharmInstall();
    if (!install) {
      report.problems.push('PyCharm не установлен');
      return report;
    }

    report.installed = true;
    report.version = install.version;

    const plugins = listBundledPlugins(install.installDir);
    report.totalPlugins = plugins.length;

    const disabled = readDisabledPluginIds(install.configDir);
    report.disabledCount = plugins.filter((p) => {
      return disabled.has(String(p.id || '').toLowerCase()) || disabled.has(String(p.name || '').toLowerCase());
    }).length;

    report.allDisabled = report.totalPlugins === 0 ? true : report.disabledCount === report.totalPlugins;

    const aiPlugins = plugins.filter(isAiPlugin);
    report.aiPluginIds = aiPlugins.map((p) => p.id);
    const aiOff = aiPlugins.filter((p) => {
      return disabled.has(String(p.id || '').toLowerCase()) || disabled.has(String(p.name || '').toLowerCase());
    });
    report.aiDisabled = aiPlugins.length === 0 ? true : aiOff.length === aiPlugins.length;

    if (aiPlugins.length > 0 && !report.aiDisabled) {
      const stillOn = aiPlugins.filter((p) => {
        return !(disabled.has(String(p.id || '').toLowerCase()) || disabled.has(String(p.name || '').toLowerCase()));
      });
      report.problems.push(`Включены AI-плагины: ${stillOn.map((p) => p.id).join(', ')}`);
    }

    if (!report.allDisabled) {
      report.problems.push(`Отключено ${report.disabledCount} из ${report.totalPlugins} плагинов`);
    }

    const vm64 = path.join(install.configDir, 'pycharm64.exe.vmoptions');
    const vm32 = path.join(install.configDir, 'pycharm.exe.vmoptions');
    const vmFile = isFile(vm32) ? vm32 : vm64;
    let vmText = '';
    try {
      if (isFile(vmFile)) vmText = fs.readFileSync(vmFile, 'utf8');
      else report.problems.push('Файл vmoptions отсутствует');
    } catch (_) {}
    for (const option of VMOPTIONS_REQUIRED) {
      if (!vmText.includes(option)) {
        report.problems.push(`В vmoptions нет строки ${option}`);
      }
    }

    report.networkBlocked = isNetworkBlocked();
    return report;
  } catch (err) {
    console.warn('[PyCharm] auditPyCharm: непредвиденная ошибка:', err && err.message);
    report.problems.push(`Ошибка аудита: ${err && err.message}`);
    return report;
  }
}

module.exports = {
  findPyCharmInstall,
  listBundledPlugins,
  hardenPyCharm,
  auditPyCharm
};
