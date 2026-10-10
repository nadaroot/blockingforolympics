/* LOKED preview shim — заглушка Electron API для браузерного превью (порт 4888) */

(function () {
  // Рабочая папка в превью чистая: никаких предустановленных файлов и папок.
  // Состояние держим в памяти, чтобы превью честно повторяло работу с реальной папкой.
  let files = [];
  let contents = {};

  const MOCK_APPS = [
    { id: 'python38', title: 'Python 3.8', installed: true, version: '3.8.10', path: null },
    { id: 'fpc', title: 'Free Pascal 3.x', installed: true, version: '3.2.2', path: null },
    { id: 'codeblocks', title: 'Code::Blocks 17.12+', installed: false, version: null, path: null },
    { id: 'pascalabc', title: 'PascalABC.NET 3.x', installed: false, version: null, path: null },
    { id: 'pycharm', title: 'PyCharm Community (без ИИ)', installed: false, version: null, path: null }
  ];

  const listeners = {};

  function extOf(name) {
    const dot = String(name).lastIndexOf('.');
    if (dot <= 0) return '';
    return String(name).slice(dot).toLowerCase();
  }

  function byteLength(text) {
    const str = text == null ? '' : String(text);
    try {
      return new TextEncoder().encode(str).length;
    } catch (_) {
      return str.length;
    }
  }

  function findEntry(name) {
    return files.find(f => f.name === name) || null;
  }

  function emit(channel, ...args) {
    if (channel === 'open-url') {
      const target = args[0];
      const url = typeof target === 'string' ? target : (target && target.url);
      try {
        if (typeof window.openWindow === 'function') window.openWindow('browser', { url });
      } catch (err) {
        console.warn('[preview] open-url:', err && err.message);
      }
      return;
    }
    if (channel === 'env-status') return;
    (listeners[channel] || []).forEach(cb => {
      try { cb({}, ...args); } catch (_) {}
    });
  }

  function previewConfig() {
    return {
      contestUrl: 'https://contest.yandex.ru',
      allowedDomains: ['contest.yandex.ru', 'yandex.ru', 'codeforces.com', 'informatics.msk.ru', 'acmp.ru'],
      masterPassword: 'Extybr',
      ai: {
        freedepsekUrl: 'http://127.0.0.1:8317/v1/chat/completions',
        ollamaUrl: 'http://127.0.0.1:11434',
        model: 'qwen2.5-coder:1.5b',
        preferFreedepsek: true
      },
      shortcuts: window.__LOKED_PREVIEW_SHORTCUTS__ || []
    };
  }

  function handle(channel, args) {
    switch (channel) {
      case 'get-config':
        return previewConfig();
      case 'fs:get-workspace-path':
        return '%USERPROFILE%\\Desktop\\LOKED_Workspace (preview)';
      case 'fs:list':
        return files.map(f => Object.assign({}, f));
      case 'fs:read-file': {
        const name = String(args[0] || '');
        const entry = findEntry(name);
        if (entry) {
          if (entry.isDirectory) return { success: false, message: 'Это папка, а не файл' };
          return { success: true, content: contents[name] == null ? '' : contents[name], filename: name };
        }
        return { success: false, message: 'Файл не найден' };
      }
      case 'fs:save-file': {
        const payload = args[0] || {};
        const name = String(payload.filename || '');
        if (!name) return { success: false, message: 'Не указано имя файла' };
        const content = payload.content == null ? '' : String(payload.content);
        const entry = findEntry(name);
        if (entry) {
          if (entry.isDirectory) return { success: false, message: 'Это папка, а не файл' };
          contents[name] = content;
          entry.size = byteLength(content);
          entry.mtime = Date.now();
        } else {
          files.push({ name, isDirectory: false, size: byteLength(content), mtime: Date.now(), ext: extOf(name) });
          contents[name] = content;
        }
        return { success: true, name };
      }
      case 'fs:create-file': {
        const payload = args[0] || {};
        const name = String(payload.filename || '');
        if (!name) return { success: false, message: 'Не указано имя файла' };
        if (findEntry(name)) return { success: false, message: 'Файл с таким именем уже существует' };
        const content = payload.content == null ? '' : String(payload.content);
        files.push({ name, isDirectory: false, size: byteLength(content), mtime: Date.now(), ext: extOf(name) });
        contents[name] = content;
        return { success: true, name };
      }
      case 'fs:create-folder': {
        const name = String(args[0] || '');
        if (!name) return { success: false, message: 'Не указано имя папки' };
        if (findEntry(name)) return { success: false, message: 'Папка с таким именем уже существует' };
        files.push({ name, isDirectory: true, size: 0, mtime: Date.now(), ext: '' });
        return { success: true, name };
      }
      case 'fs:delete': {
        const name = String(args[0] || '');
        const idx = files.findIndex(f => f.name === name);
        if (idx < 0) return { success: false, message: 'Элемент не найден' };
        files.splice(idx, 1);
        delete contents[name];
        return { success: true };
      }
      case 'fs:rename': {
        const payload = args[0] || {};
        const oldName = String(payload.oldName || '');
        const newName = String(payload.newName || '');
        const entry = findEntry(oldName);
        if (!entry) return { success: false, message: 'Файл не найден' };
        if (newName !== oldName && findEntry(newName)) {
          return { success: false, message: 'Элемент с таким именем уже существует' };
        }
        entry.name = newName;
        entry.ext = entry.isDirectory ? '' : extOf(newName);
        entry.mtime = Date.now();
        if (Object.prototype.hasOwnProperty.call(contents, oldName)) {
          contents[newName] = contents[oldName];
          delete contents[oldName];
        }
        return { success: true };
      }
      case 'icons:resolve':
        return {};
      case 'env:detect':
        return {
          apps: MOCK_APPS.map(a => Object.assign({}, a)),
          missing: MOCK_APPS.filter(a => !a.installed).map(a => a.id),
          pycharm: { installed: false, problems: ['PyCharm в превью не проверяется'] }
        };
      case 'env:ensure':
        return { apps: [], installed: [], missing: [], pycharm: { audit: { installed: false } }, errors: [] };
      case 'launch-app':
        console.info('[preview] launch-app:', args[0]);
        return { success: true };
      case 'verify-unlock':
        return { success: true };
      case 'lang:list':
        return [
          { tag: 'ru', hkl: '00000419', label: 'Русский' },
          { tag: 'en', hkl: '00000409', label: 'English' }
        ];
      case 'lang:set':
        console.info('[preview] lang:set:', args[0]);
        return { success: true };
      case 'ai:status':
        return { freedepsek: false, ollama: true, model: 'qwen2.5-coder:1.5b', activeBackend: 'ollama' };
      case 'ai:ask': {
        const payload = args[0] || {};
        const text = [
          '# Решение (превью)',
          '',
          'def solve():',
          '    print("ответ")',
          '',
          'solve()',
          '',
          `// запрос: ${String(payload.prompt || '').trim() || 'без уточнения'}`,
          `// backend: ollama`
        ].join('\n');
        return { success: true, text, backend: 'ollama' };
      }
      default:
        console.info('[preview] ipcRenderer.invoke:', channel, args);
        return { success: true };
    }
  }

  const ipcRenderer = {
    invoke(channel, ...args) {
      try {
        return Promise.resolve(handle(channel, args));
      } catch (err) {
        console.warn('[preview] invoke failed:', channel, err && err.message);
        return Promise.resolve({ success: false, message: String((err && err.message) || err) });
      }
    },
    on(channel, cb) {
      (listeners[channel] = listeners[channel] || []).push(cb);
      return this;
    },
    once(channel, cb) {
      const wrapper = (...a) => {
        ipcRenderer.removeListener(channel, wrapper);
        cb({}, ...a);
      };
      return this.on(channel, wrapper);
    },
    removeListener(channel, cb) {
      const list = listeners[channel] || [];
      const idx = list.indexOf(cb);
      if (idx >= 0) list.splice(idx, 1);
      return this;
    },
    send() {}
  };

  window.require = function requireShim(id) {
    if (id === 'electron') {
      return {
        ipcRenderer,
        shell: { showItemInFolder() {}, openExternal() {} },
        clipboard: { writeText() {}, readText: () => Promise.resolve('') },
        webFrame: { setZoomLevel() {}, getZoomLevel: () => 0 },
        remote: { getCurrentWindow: () => ({ setFullScreen() {}, close() {} }) }
      };
    }
    return {};
  };

  window.__LOKED_PREVIEW__ = true;

  window.addEventListener('error', (e) => {
    const box = document.createElement('pre');
    box.style.cssText = 'position:fixed;left:0;top:0;z-index:999999;background:#7f1d1d;color:#fecaca;padding:8px;font:12px monospace;white-space:pre-wrap;max-width:100%';
    box.textContent = `JS ERROR: ${e.message}\n${e.filename}:${e.lineno}:${e.colno}\n${e.error && e.error.stack || ''}`;
    document.documentElement.appendChild(box);
  });

  // Служебные режимы превью для быстрой проверки вёрстки: ?desktop=1, ?menu=1, ?win=editor
  const params = new URLSearchParams(location.search);
  if (params.has('desktop')) {
    setTimeout(() => {
      try { window.closeWindow('browser'); } catch (_) {}
    }, 1200);
  }
  if (params.has('win')) {
    setTimeout(() => {
      try {
        window.closeWindow('browser');
        const key = params.get('win');
        window.openWindow(key);
        if (params.has('restore')) window.toggleMaximizeWindow(key);
      } catch (_) {}
    }, 1200);
  }
  if (params.has('mbmenu')) {
    setTimeout(() => {
      try { window.openMenubarMenu(params.get('mbmenu')); } catch (err) { console.warn(err); }
    }, 1500);
  }
  // ?langmenu=1 — меню выбора языка ввода (клик по индикатору в панели)
  if (params.has('langmenu')) {
    setTimeout(() => {
      try {
        const node = document.getElementById('mbLang');
        if (node) node.click();
      } catch (err) {
        console.warn('[preview] lang menu:', err && err.message);
      }
    }, 1600);
  }
  if (params.has('menu')) {
    setTimeout(() => {
      const surface = document.getElementById('desktopSurface');
      if (surface) {
        surface.dispatchEvent(new MouseEvent('contextmenu', {
          bubbles: true, clientX: 380, clientY: 300
        }));
      }
      const trigger = document.getElementById('desktopCreateItem');
      if (trigger) trigger.dispatchEvent(new MouseEvent('mouseenter'));
    }, 1800);
  }
  // ?ai=1 — сценарий скрытого ИИ-помощника: выделение в редакторе + Ctrl+Shift+P
  if (params.has('ai')) {
    setTimeout(() => {
      try {
        window.openWindow('editor', { filename: 'test.py', content: 'print("hello")' });
        const ta = document.getElementById('editorTextarea');
        if (ta) {
          ta.focus();
          ta.setSelectionRange(0, 9);
        }
        window.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'P', code: 'KeyP', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true
        }));
      } catch (err) {
        console.warn('[preview] ai scenario:', err && err.message);
      }
    }, 1800);
  }

  // ?filesmenu=1 — ПКМ по файлу в окне «Мои файлы»
  if (params.has('filesmenu')) {
    setTimeout(() => {
      try {
        window.openWindow('files');
        window.__previewCreateFile('test.py');
        if (typeof window.loadFilesWindow === 'function') window.loadFilesWindow();
        setTimeout(() => {
          const grid = document.getElementById('filesWindowGrid');
          const box = grid && grid.querySelector('.file-box');
          if (box) {
            box.dispatchEvent(new MouseEvent('contextmenu', {
              bubbles: true, cancelable: true, clientX: 400, clientY: 300
            }));
          }
        }, 500);
      } catch (err) {
        console.warn('[preview] filesmenu:', err && err.message);
      }
    }, 1600);
  }

  window.__previewEmit = emit;
  window.__previewFs = {
    list: () => files.map(f => Object.assign({}, f)),
    reset: () => { files = []; contents = {}; }
  };
  // Создание файла превью-памятью (для тестовых режимов)
  window.__previewCreateFile = function(name, content) {
    return handle('fs:create-file', [{ filename: name, content: content || 'x' }]);
  };
})();
