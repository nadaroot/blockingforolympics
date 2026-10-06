const path = require('path');
const fs = require('fs');

const DATA_FILE = path.join(__dirname, '..', 'loked-config.json');

const DEFAULT_CONFIG = {
  port: 3000,
  udpPort: 41234,
  masterPassword: 'admin',
  contestUrl: 'https://contest.yandex.ru',
  allowedDomains: [
    'contest.yandex.ru',
    'yandex.ru',
    'codeforces.com',
    'informatics.msk.ru',
    'acmp.ru',
    'ejudge.ru'
  ],
  examDurationMinutes: 120,
  shortcuts: [
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
      cmd: 'pycharm64.exe',
      paths: [
        'C:\\Program Files\\JetBrains\\PyCharm Community Edition*\\bin\\pycharm64.exe',
        '%LOCALAPPDATA%\\Programs\\PyCharm Community Edition*\\bin\\pycharm64.exe'
      ],
      enabled: true
    },
    {
      id: 'pascal',
      name: 'PascalABC.NET',
      type: 'app',
      icon: 'terminal',
      color: '#3b82f6',
      cmd: 'PascalABCNET.exe',
      paths: [
        'C:\\Program Files (x86)\\PascalABC.NET\\PascalABCNET.exe',
        'C:\\Program Files\\PascalABC.NET\\PascalABCNET.exe'
      ],
      enabled: true
    },
    {
      id: 'codeblocks',
      name: 'Code::Blocks (C++)',
      type: 'app',
      icon: 'cpu',
      color: '#10b981',
      cmd: 'codeblocks.exe',
      paths: [
        'C:\\Program Files\\CodeBlocks\\codeblocks.exe',
        'C:\\Program Files (x86)\\CodeBlocks\\codeblocks.exe'
      ],
      enabled: true
    },
    {
      id: 'vscode',
      name: 'Visual Studio Code',
      type: 'app',
      icon: 'file-code',
      color: '#6366f1',
      cmd: 'Code.exe',
      paths: [
        '%LOCALAPPDATA%\\Programs\\Microsoft VS Code\\Code.exe',
        'C:\\Program Files\\Microsoft VS Code\\Code.exe'
      ],
      enabled: true
    },
    {
      id: 'idle',
      name: 'Python IDLE',
      type: 'app',
      icon: 'hash',
      color: '#eab308',
      cmd: 'python.exe',
      args: ['-m', 'idlelib'],
      paths: [
        'python.exe'
      ],
      enabled: true
    },
    {
      id: 'calc',
      name: 'Калькулятор',
      type: 'app',
      icon: 'calculator',
      color: '#8b5cf6',
      cmd: 'calc.exe',
      paths: ['calc.exe'],
      enabled: true
    },
    {
      id: 'notepad',
      name: 'Блокнот',
      type: 'app',
      icon: 'file-text',
      color: '#64748b',
      cmd: 'notepad.exe',
      paths: ['notepad.exe'],
      enabled: true
    }
  ],
  allowedProcessNames: [
    'loked',
    'electron',
    'node',
    'locker',
    'pycharm64',
    'idea64',
    'codeblocks',
    'code',
    'pascalabcnet',
    'python',
    'pythonw',
    'calc',
    'calculatorapp',
    'notepad',
    'conhost',
    'cmd',
    'gcc',
    'g++',
    'fpc',
    'javaw',
    'java'
  ]
};

function loadConfig() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = fs.readFileSync(DATA_FILE, 'utf-8');
      return { ...DEFAULT_CONFIG, ...JSON.parse(data) };
    }
  } catch (err) {
    console.error('Error loading config, using default:', err);
  }
  return { ...DEFAULT_CONFIG };
}

function saveConfig(config) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(config, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('Error saving config:', err);
    return false;
  }
}

module.exports = {
  loadConfig,
  saveConfig,
  DEFAULT_CONFIG
};
