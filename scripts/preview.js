/**
 * LOKED — браузерное превью рабочего стола (временная отладочная версия).
 *
 * Отдаёт клиентскую оболочку (client/src/shell) в обычном браузере с подменой
 * Electron IPC на мок-данные, чтобы видеть реальный интерфейс, не перекрывая
 * рабочий стол kiosk-окном.
 *
 * Запуск:  node scripts/preview.js   →  http://127.0.0.1:4888
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { DEFAULT_CONFIG } = require('../server/src/config');

const PORT = Number(process.env.PREVIEW_PORT || 4888);
const HOST = process.env.PREVIEW_HOST || '127.0.0.1';
const SHELL_DIR = path.join(__dirname, '..', 'client', 'src', 'shell');
const SHIM_FILE = path.join(__dirname, 'preview-shim.js');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.ico': 'image/x-icon'
};

const SHIM_TAG = '<script src="/__preview/shim.js"></script>';

function injectShim(html) {
  if (html.includes(SHIM_TAG)) return html;
  const shim = `${SHIM_TAG}\n  `;
  if (html.includes('<script src="shell.js"></script>')) {
    return html.replace('<script src="shell.js"></script>', `${shim}<script src="shell.js"></script>`);
  }
  return html.replace('</body>', `${shim}</body>`);
}

function send(res, status, body, type) {
  res.writeHead(status, {
    'Content-Type': type || 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate'
  });
  res.end(body);
}

function serveShim(res) {
  fs.readFile(SHIM_FILE, 'utf-8', (err, data) => {
    if (err) return send(res, 500, 'shim read error: ' + err.message);
    const prelude = `window.__LOKED_PREVIEW_SHORTCUTS__ = ${JSON.stringify(DEFAULT_CONFIG.shortcuts)};\n`;
    send(res, 200, prelude + data, MIME['.js']);
  });
}

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (_) {
    return send(res, 400, 'Bad request');
  }

  if (urlPath === '/__preview/shim.js') return serveShim(res);

  if (urlPath === '/' || urlPath === '/index.html') urlPath = '/index.html';

  const safeRel = path.normalize(urlPath).replace(/^([\\/])+/, '');
  const fullPath = path.join(SHELL_DIR, safeRel);
  if (!fullPath.startsWith(SHELL_DIR)) return send(res, 403, 'Forbidden');

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      console.warn('[preview] 404:', safeRel);
      return send(res, 404, 'Not found: ' + safeRel);
    }
    const ext = path.extname(fullPath).toLowerCase();
    if (ext === '.html') {
      return send(res, 200, injectShim(data.toString('utf-8')), MIME['.html']);
    }
    send(res, 200, data, MIME[ext] || 'application/octet-stream');
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[preview] LOKED shell preview: http://${HOST}:${PORT}`);
  console.log('[preview] корень оболочки:', SHELL_DIR);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[preview] порт ${PORT} уже занят. Закрой старый превью или запусти с другим: PREVIEW_PORT=4890 node scripts/preview.js`);
    process.exit(1);
  }
  console.error('[preview] ошибка сервера:', err);
  process.exit(1);
});
