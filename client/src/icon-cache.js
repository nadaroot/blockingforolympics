const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const CACHE_MIN_BYTES = 300; // минимальный размер валидной иконки в кэше
const ICON_SIZE = 128;
const PS_TIMEOUT_MS = 20000;
const WEB_TIMEOUT_MS = 5000;

// Провайдеры веб-иконок, обходятся по очереди (нужен именно PNG, Chromium не умеет .ico)
const WEB_ICON_PROVIDERS = [
  (domain) => `https://favicon.im/${domain}?larger=true`,
  (domain) => `https://icon.horse/icon/${domain}`,
  (domain) => `https://favicone.com/${domain}?s=128`
];

let cachedDir = null;

// Каталог кэша иконок: %LOCALAPPDATA%\LOKED\icons, иначе %USERPROFILE%\.loked\icons
function getCacheDir() {
  if (cachedDir) return cachedDir;
  try {
    const base = process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'LOKED', 'icons')
      : path.join(process.env.USERPROFILE || os.homedir() || '', '.loked', 'icons');
    if (!fs.existsSync(base)) fs.mkdirSync(base, { recursive: true });
    cachedDir = base;
  } catch (err) {
    console.warn('[Icons] Не удалось подготовить каталог кэша:', err.message);
    cachedDir = null;
  }
  return cachedDir;
}

function sha1(value) {
  try {
    return crypto.createHash('sha1').update(String(value)).digest('hex');
  } catch (_) {
    return null;
  }
}

// Windows-путь -> file:///C:/.../иконка.png
function toFileUrl(filePath) {
  try {
    if (!filePath) return null;
    let normalized = String(filePath).replace(/\\/g, '/');
    if (!normalized.startsWith('/')) normalized = '/' + normalized;
    const encoded = normalized
      .replace(/ /g, '%20')
      .replace(/#/g, '%23')
      .replace(/\?/g, '%3F')
      .replace(/%/g, '%25')
      .replace(/%25([0-9A-Fa-f]{2})/g, '%$1');
    return `file://${encoded}`;
  } catch (_) {
    return null;
  }
}

function domainFromUrl(url) {
  try {
    const parsed = new URL(String(url));
    let domain = parsed.hostname.toLowerCase();
    if (domain.startsWith('www.')) domain = domain.slice(4);
    return domain || null;
  } catch (_) {
    return null;
  }
}

// Проверка PNG-сигнатуры (89 50 4E 47) и минимального размера
function isUsablePng(buffer) {
  try {
    if (!buffer || buffer.length < 1024) return false;
    return buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  } catch (_) {
    return false;
  }
}

// Кэш: %LOCALAPPDATA%\LOKED\icons\<sha1(key)>.png
function getCachedIconPath(key) {
  try {
    if (!key) return null;
    const dir = getCacheDir();
    if (!dir) return null;
    const hash = sha1(key);
    if (!hash) return null;
    const file = path.join(dir, `${hash}.png`);
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size <= CACHE_MIN_BYTES) return null;
    return file;
  } catch (_) {
    return null;
  }
}

function saveToCache(key, buffer) {
  try {
    const dir = getCacheDir();
    if (!dir) return null;
    const hash = sha1(key);
    if (!hash) return null;
    const file = path.join(dir, `${hash}.png`);
    fs.writeFileSync(file, buffer);
    return file;
  } catch (err) {
    console.warn('[Icons] Не удалось сохранить иконку в кэш:', err.message);
    return null;
  }
}

function psQuote(value) {
  return String(value).replace(/'/g, "''");
}

// PowerShell-скрипт: иконка из .exe -> PNG 128x128 через System.Drawing
function buildIconScript(exePath, outPath) {
  return [
    "$ErrorActionPreference = 'Stop'",
    `$exe = '${psQuote(exePath)}'`,
    `$out = '${psQuote(outPath)}'`,
    'try { Add-Type -AssemblyName System.Drawing } catch { exit 3 }',
    '$ico = $null',
    '$bmp = $null',
    '$res = $null',
    '$g = $null',
    'try {',
    '  $ico = [System.Drawing.Icon]::ExtractAssociatedIcon($exe)',
    '  if ($ico -eq $null) { exit 2 }',
    '  $bmp = $ico.ToBitmap()',
    `  $res = New-Object System.Drawing.Bitmap -ArgumentList ${ICON_SIZE},${ICON_SIZE}`,
    '  $g = [System.Drawing.Graphics]::FromImage($res)',
    '  $g.Clear([System.Drawing.Color]::Transparent)',
    '  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic',
    '  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality',
    `  $g.DrawImage($bmp, 0, 0, ${ICON_SIZE}, ${ICON_SIZE})`,
    '  $g.Dispose(); $g = $null',
    '  $res.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)',
    '  $res.Dispose(); $res = $null',
    '  exit 0',
    '} catch {',
    '  exit 4',
    '} finally {',
    '  if ($g -ne $null) { $g.Dispose() }',
    '  if ($res -ne $null) { $res.Dispose() }',
    '  if ($bmp -ne $null) { $bmp.Dispose() }',
    '  if ($ico -ne $null) { $ico.Dispose() }',
    '}'
  ].join("\r\n");
}

function runPowerShell(scriptPath) {
  return new Promise((resolve) => {
    try {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
        { timeout: PS_TIMEOUT_MS, windowsHide: true, maxBuffer: 1024 * 1024 },
        (error, stdout, stderr) => {
          const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
          resolve({ ok: !error, code, stdout: String(stdout || ''), stderr: String(stderr || '') });
        }
      );
    } catch (err) {
      resolve({ ok: false, code: 1, stdout: '', stderr: String(err.message || err) });
    }
  });
}

// Иконка из самого .exe / .lnk файла
async function extractIconFromExecutable(exePath) {
  let tmpPs1 = null;
  let tmpOut = null;
  try {
    if (!exePath || !fs.existsSync(exePath)) return null;
    const stat = fs.statSync(exePath);
    const key = `exe|${exePath}|${stat.mtimeMs}`;

    const cached = getCachedIconPath(key);
    if (cached) return toFileUrl(cached);

    const dir = getCacheDir();
    if (!dir) return null;
    const hash = sha1(key);
    if (!hash) return null;

    tmpOut = path.join(dir, `${hash}.png`);
    if (fs.existsSync(tmpOut)) {
      try { fs.unlinkSync(tmpOut); } catch (_) {}
    }

    tmpPs1 = path.join(os.tmpdir(), `loked-icon-${process.pid}-${Date.now()}.ps1`);
    fs.writeFileSync(tmpPs1, buildIconScript(exePath, tmpOut), 'utf8');

    const result = await runPowerShell(tmpPs1);
    if (!result.ok || result.code !== 0) {
      console.warn(`[Icons] PowerShell не смог извлечь иконку из ${exePath} (код ${result.code})`);
      try { if (tmpOut && fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut); } catch (_) {}
      return null;
    }

    if (!fs.existsSync(tmpOut)) return null;
    const buffer = fs.readFileSync(tmpOut);
    if (!isUsablePng(buffer)) {
      console.warn(`[Icons] Извлечённый файл не похож на PNG: ${exePath}`);
      try { fs.unlinkSync(tmpOut); } catch (_) {}
      return null;
    }
    return toFileUrl(tmpOut);
  } catch (err) {
    console.warn('[Icons] Ошибка извлечения иконки:', err.message || err);
    return null;
  } finally {
    try { if (tmpPs1 && fs.existsSync(tmpPs1)) fs.unlinkSync(tmpPs1); } catch (_) {}
    // временный PNG остаётся в кэше (это и есть файл кэша), битые удаляем
    try {
      if (tmpOut && fs.existsSync(tmpOut) && fs.statSync(tmpOut).size <= CACHE_MIN_BYTES) {
        fs.unlinkSync(tmpOut);
      }
    } catch (_) {}
  }
}

async function downloadIcon(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WEB_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        redirect: 'follow',
        signal: controller.signal,
        headers: { 'User-Agent': 'LOKED/1.0 (icon-cache)' }
      });
      if (!res.ok) return null;
      const buffer = Buffer.from(await res.arrayBuffer());
      return isUsablePng(buffer) ? buffer : null;
    } finally {
      clearTimeout(timer);
    }
  } catch (_) {
    return null;
  }
}

// Иконка из интернета по домену сайта (только PNG)
async function fetchIconFromWeb(domain) {
  try {
    if (!domain) return null;
    let host = String(domain).trim().toLowerCase();
    if (!host) return null;
    if (host.includes('://')) host = domainFromUrl(host) || '';
    if (host.startsWith('www.')) host = host.slice(4);
    if (!host || host.indexOf('/') !== -1) return null;

    const key = `web|${host}`;
    const cached = getCachedIconPath(key);
    if (cached) return toFileUrl(cached);

    for (const provider of WEB_ICON_PROVIDERS) {
      let url;
      try { url = provider(host); } catch (_) { continue; }
      const buffer = await downloadIcon(url);
      if (!buffer) continue;
      const saved = saveToCache(key, buffer);
      if (saved) return toFileUrl(saved);
    }

    console.warn(`[Icons] Веб-иконка для ${host} не найдена`);
    return null;
  } catch (err) {
    console.warn('[Icons] Ошибка загрузки веб-иконки:', err.message || err);
    return null;
  }
}

// Массовое разрешение иконок: приоритет exe-иконка, затем веб по домену
async function resolveShortcutIcons(shortcuts, resolveExePath) {
  const result = {};
  const list = Array.isArray(shortcuts) ? shortcuts : [];

  const resolveOne = async (shortcut) => {
    try {
      if (!shortcut || !shortcut.id) return null;

      if (shortcut.url) {
        const domain = domainFromUrl(shortcut.url);
        if (domain) {
          const webIcon = await fetchIconFromWeb(domain);
          if (webIcon) return { id: shortcut.id, url: webIcon };
        }
        return null;
      }

      if (typeof resolveExePath !== 'function') return null;
      let exePath = null;
      try { exePath = resolveExePath(shortcut); } catch (_) { exePath = null; }
      if (!exePath || !fs.existsSync(exePath)) return null;

      const exeIcon = await extractIconFromExecutable(exePath);
      if (exeIcon) return { id: shortcut.id, url: exeIcon };
      return null;
    } catch (err) {
      console.warn(`[Icons] Не удалось получить иконку для ${shortcut && shortcut.id}:`, err.message || err);
      return null;
    }
  };

  // Ограниченный параллелизм, чтобы не плодить PowerShell-процессы
  const CONCURRENCY = 4;
  let cursor = 0;
  const workers = [];
  const workerCount = Math.min(CONCURRENCY, list.length);
  for (let i = 0; i < workerCount; i++) {
    workers.push((async () => {
      while (cursor < list.length) {
        const item = list[cursor++];
        const resolved = await resolveOne(item);
        if (resolved && resolved.url) result[resolved.id] = resolved.url;
      }
    })());
  }
  await Promise.all(workers);
  return result;
}

module.exports = {
  extractIconFromExecutable,
  fetchIconFromWeb,
  getCachedIconPath,
  resolveShortcutIcons
};
