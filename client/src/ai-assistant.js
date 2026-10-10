// Скрытый ИИ-помощник LOKED (только встроенные модули Node.js).
// Приоритетный бэкенд — freedepsek (OpenAI-совместимый прокси к DeepSeek),
// если он недоступен — локальная модель Ollama (qwen2.5-coder:1.5b).

const { spawn } = require('child_process');

const DEFAULTS = {
  freedepsekUrl: 'http://127.0.0.1:8317/v1/chat/completions',
  freedepsekModel: 'deepseek-chat',
  freedepsekApiKey: '',
  freedepsekTimeoutMs: 30000,
  ollamaUrl: 'http://127.0.0.1:11434',
  model: 'qwen2.5-coder:1.5b',
  ollamaTimeoutMs: 90000,
  preferFreedepsek: true
};

// Куда складываем веса локальной модели (диск E, как требует владелец проекта)
const OLLAMA_MODELS_DIR = 'E:\\LOKED\\Ollama\\models';

const PROBE_TIMEOUT_MS = 2500;
const SERVER_WAIT_MS = 20000;

let config = { ...DEFAULTS };

function configure(aiConfig) {
  config = { ...DEFAULTS, ...(aiConfig && typeof aiConfig === 'object' ? aiConfig : {}) };
  return config;
}

function trimUrl(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

function fetchWithTimeout(url, options = {}, timeoutMs = PROBE_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function probeFreedepsek() {
  const url = trimUrl(config.freedepsekUrl);
  if (!url) return false;
  try {
    await fetchWithTimeout(url, { method: 'GET' }, PROBE_TIMEOUT_MS);
    return true;
  } catch (err) {
    if (err && err.name === 'AbortError') return true; // сервер ответил медленнее таймаута, но живой
    return false;
  }
}

async function probeOllama() {
  const base = trimUrl(config.ollamaUrl);
  if (!base) return false;
  try {
    const res = await fetchWithTimeout(`${base}/api/tags`, { method: 'GET' }, PROBE_TIMEOUT_MS);
    if (!res.ok) return false;
    const data = await res.json();
    const models = Array.isArray(data && data.models) ? data.models : [];
    return models.some(m => String((m && m.name) || '').startsWith(String(config.model || '').split(':')[0]));
  } catch (err) {
    return false;
  }
}

// Если сервер Ollama не запущен — поднимаем его сами
async function ensureOllamaServer() {
  if (await probeOllama()) return true;
  try {
    const child = spawn('ollama', ['serve'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, OLLAMA_MODELS: process.env.OLLAMA_MODELS || OLLAMA_MODELS_DIR }
    });
    child.on('error', () => {});
    child.unref();
  } catch (_) {
    return false;
  }
  const deadline = Date.now() + SERVER_WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 1500));
    if (await probeOllama()) return true;
  }
  return false;
}

function systemPrompt() {
  return [
    'Ты помогаешь школьнику на олимпиаде по программированию.',
    'Пиши максимально простой и короткий код без лишних усложнений и комментариев.',
    'Отвечай на русском языке, если не просят иное.',
    'Код оформляй одним блоком, без лишних объяснений.'
  ].join(' ');
}

function buildUserMessage(prompt, code) {
  const parts = [];
  const task = String(prompt || '').trim();
  const src = String(code || '').trim();
  if (task) parts.push(`Задание: ${task}`);
  if (src) parts.push(`Код:\n${src}`);
  if (!parts.length) parts.push('Помоги с задачей.');
  parts.push('Дай простое решение.');
  return parts.join('\n\n');
}

function extractText(content) {
  let text = String(content || '').trim();
  const fence = text.match(/```[a-zA-Z0-9+.-]*\n([\s\S]*?)```/);
  if (fence && fence[1]) text = fence[1].trim();
  return text;
}

async function askFreedepsek(prompt, code) {
  const url = trimUrl(config.freedepsekUrl);
  const headers = { 'Content-Type': 'application/json' };
  const key = String(config.freedepsekApiKey || '').trim();
  if (key) headers.Authorization = `Bearer ${key}`;

  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: config.freedepsekModel || 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt() },
        { role: 'user', content: buildUserMessage(prompt, code) }
      ],
      temperature: 0.2,
      stream: false
    })
  }, config.freedepsekTimeoutMs);

  if (!res.ok) throw new Error(`freedepsek ответил HTTP ${res.status}`);
  const data = await res.json();
  const text = extractText(data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content);
  if (!text) throw new Error('freedepsek вернул пустой ответ');
  return text;
}

async function askOllama(prompt, code) {
  const ready = await ensureOllamaServer();
  if (!ready) throw new Error('Локальная модель Ollama недоступна');
  const base = trimUrl(config.ollamaUrl);

  const res = await fetchWithTimeout(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.model || 'qwen2.5-coder:1.5b',
      messages: [
        { role: 'system', content: systemPrompt() },
        { role: 'user', content: buildUserMessage(prompt, code) }
      ],
      stream: false
    })
  }, config.ollamaTimeoutMs);

  if (!res.ok) throw new Error(`Ollama ответила HTTP ${res.status}`);
  const data = await res.json();
  const text = extractText(data && data.message && data.message.content);
  if (!text) throw new Error('Ollama вернула пустой ответ');
  return text;
}

async function ask(payload = {}) {
  const prompt = String(payload.prompt || '');
  const code = String(payload.code || '');
  if (!prompt.trim() && !code.trim()) {
    return { success: false, message: 'Пустый запрос' };
  }

  if (config.preferFreedepsek !== false && (await probeFreedepsek())) {
    try {
      const text = await askFreedepsek(prompt, code);
      console.log('[AI] Ответ получен через freedepsek');
      return { success: true, text, backend: 'freedepsek' };
    } catch (err) {
      console.warn('[AI] freedepsek недоступен, переключаемся на локальную модель:', err && err.message);
    }
  }

  try {
    const text = await askOllama(prompt, code);
    console.log('[AI] Ответ получен через локальную модель Ollama');
    return { success: true, text, backend: 'ollama' };
  } catch (err) {
    const message = String((err && err.message) || err);
    console.warn('[AI] Локальная модель недоступна:', message);
    return { success: false, message: `ИИ недоступен: ${message}` };
  }
}

async function getStatus() {
  const freedepsek = config.preferFreedepsek !== false ? await probeFreedepsek() : false;
  const ollama = await probeOllama();
  return {
    freedepsek,
    ollama,
    model: config.model,
    activeBackend: freedepsek ? 'freedepsek' : (ollama ? 'ollama' : null)
  };
}

module.exports = {
  DEFAULTS,
  OLLAMA_MODELS_DIR,
  configure,
  ask,
  getStatus
};
