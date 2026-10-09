'use strict';

/**
 * LOKED build packer.
 *
 * Zero external dependencies (only Node.js builtins) so it can run on the
 * windows-latest GitHub runner right after `npm ci`.
 *
 * Usage:
 *   node scripts/pack.js            -> full build (electron dist + zips + standalone exe)
 *   node scripts/pack.js --verify   -> preflight only: checks every source/resource that
 *                                      the build needs, without touching dist/ and
 *                                      without requiring the Electron runtime.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const releasesDir = path.join(distDir, 'releases');
const electronDist = path.join(rootDir, 'node_modules', 'electron', 'dist');
const lockerSrc = path.join(rootDir, 'client', 'native', 'Locker.cs');
const lockerExe = path.join(rootDir, 'client', 'native', 'locker.exe');
const launcherSrc = path.join(__dirname, 'Launcher.cs');
const cscPath = process.env.LOKED_CSC || 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';

const VERIFY_ONLY = process.argv.includes('--verify') || process.argv.includes('--check');
const rootPkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const APP_VERSION = rootPkg.version || '1.0.0';

// --------------------------------------------------------------------------------------
// Explicit, verifiable manifests.
// --------------------------------------------------------------------------------------

// Files (relative to repo root) that MUST exist in the source tree before building.
const REQUIRED_SOURCE_FILES = [
  'package.json',
  'scripts/Launcher.cs',
  'client/native/Locker.cs',
  'client/src/main.js',
  'client/src/locker-manager.js',
  'client/src/watchdog.js',
  'client/src/network.js',
  'client/src/icon-cache.js',
  'client/src/provisioner.js',
  'client/src/pycharm-lockdown.js',
  'client/src/shell/index.html',
  'client/src/shell/secondary.html',
  'client/src/shell/shell.css',
  'client/src/shell/shell.js',
  'client/src/shell/vendor/font-awesome/css/all.min.css',
  'client/src/browser/browser.html',
  'client/src/browser/browser-preload.js',
  'admin-desktop/main.js',
  'server/src/index.js',
  'server/src/config.js',
  'server/src/discovery.js',
  'server/public/index.html',
  'server/public/app.js',
  'server/public/style.css',
  'server/public/vendor/font-awesome/css/all.min.css'
];

// Directories (relative to repo root) that MUST exist and contain at least one file.
const REQUIRED_SOURCE_DIRS = [
  'client/src/shell',
  'client/src/shell/vendor/font-awesome/webfonts',
  'client/src/browser',
  'server/public/vendor/font-awesome/webfonts'
];

// Files that MUST exist inside dist/LOKED-Client/resources/app (paths use '/', zip style).
const CLIENT_APP_FILES = [
  'package.json',
  'src/main.js',
  'src/locker-manager.js',
  'src/watchdog.js',
  'src/network.js',
  'src/icon-cache.js',
  'src/provisioner.js',
  'src/pycharm-lockdown.js',
  'src/shell/index.html',
  'src/shell/secondary.html',
  'src/shell/shell.css',
  'src/shell/shell.js',
  'src/shell/vendor/font-awesome/css/all.min.css',
  'src/browser/browser.html',
  'src/browser/browser-preload.js',
  'native/locker.exe'
];

// Directories that MUST exist and be non-empty inside dist/LOKED-Client/resources/app.
const CLIENT_APP_DIRS = [
  'src/shell',
  'src/shell/vendor/font-awesome/webfonts',
  'src/browser',
  'node_modules'
];

// Files that MUST exist inside dist/LOKED-Admin/resources/app (paths use '/', zip style).
const ADMIN_APP_FILES = [
  'package.json',
  'admin-desktop/main.js',
  'server/src/index.js',
  'server/src/config.js',
  'server/src/discovery.js',
  'server/public/index.html',
  'server/public/app.js',
  'server/public/style.css',
  'server/public/vendor/font-awesome/css/all.min.css',
  'node_modules/socket.io/package.json',
  'node_modules/express/package.json'
];

const CLIENT_ZIP = path.join(releasesDir, 'LOKED-Client-win-x64.zip');
const ADMIN_ZIP = path.join(releasesDir, 'LOKED-Admin-win-x64.zip');
const CLIENT_EXE = path.join(releasesDir, 'LOKED-Client.exe');
const ADMIN_EXE = path.join(releasesDir, 'LOKED-Admin.exe');

const SKIP_ENTRIES = new Set(['.git', '.DS_Store', 'Thumbs.db', '.bin', '.package-lock.json', 'logs']);

// --------------------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------------------

function fail(stage, message, details) {
  console.error('');
  console.error('================================================================');
  console.error('BUILD FAILED at ' + stage);
  console.error(message);
  (details || []).forEach((d) => console.error('  - ' + d));
  console.error('================================================================');
  process.exit(1);
}

function rel(p) {
  return path.relative(rootDir, p) || '.';
}

function countFilesRecursive(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += countFilesRecursive(full);
    else if (entry.isFile()) total += 1;
  }
  return total;
}

function copyDir(src, dest, filterFn) {
  if (!fs.existsSync(src)) {
    fail('copy', 'Source directory does not exist: ' + rel(src));
  }
  fs.mkdirSync(dest, { recursive: true });
  let copied = 0;
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (SKIP_ENTRIES.has(entry.name)) continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (filterFn && !filterFn(srcPath, entry)) continue;
    if (entry.isDirectory()) {
      copied += copyDir(srcPath, destPath, filterFn);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
      copied += 1;
    }
  }
  return copied;
}

function verifyTree(baseDir, label, requiredFiles, requiredDirs) {
  const missing = [];
  for (const f of requiredFiles) {
    const full = path.join(baseDir, f.split('/').join(path.sep));
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) missing.push(label + ': ' + f);
    else if (fs.statSync(full).size === 0) missing.push(label + ': ' + f + ' (empty file)');
  }
  for (const d of requiredDirs || []) {
    const full = path.join(baseDir, d.split('/').join(path.sep));
    if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) missing.push(label + ': ' + d + '/ (missing directory)');
    else if (countFilesRecursive(full) === 0) missing.push(label + ': ' + d + '/ (empty directory)');
  }
  if (missing.length) {
    fail('verify ' + label, 'Required packaged files are missing:', missing);
  }
  console.log('  ' + label + ': verified ' + requiredFiles.length + ' files' +
    (requiredDirs && requiredDirs.length ? ' + ' + requiredDirs.length + ' directories' : ''));
}

function bytes(n) {
  return (n / 1024 / 1024).toFixed(2) + ' MB';
}

function runCommand(command, stage) {
  try {
    execSync(command, { stdio: ['ignore', 'pipe', 'pipe'], cwd: rootDir });
  } catch (err) {
    const out = ((err.stdout || '') + (err.stderr || '')).toString().trim();
    fail(stage, 'Command failed: ' + command, out ? out.split(/\r?\n/).slice(-15) : [String(err.message)]);
  }
}

// --------------------------------------------------------------------------------------
// 0. Preflight
// --------------------------------------------------------------------------------------

console.log('=== LOKED Automated Build System ===');
console.log('version: ' + APP_VERSION);
console.log('mode:    ' + (VERIFY_ONLY ? 'VERIFY ONLY (no dist/ changes)' : 'FULL BUILD'));
console.log('\n[0/7] Preflight checks...');

const missingSources = [];
for (const f of REQUIRED_SOURCE_FILES) {
  const full = path.join(rootDir, f.split('/').join(path.sep));
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) missingSources.push(f);
}
for (const d of REQUIRED_SOURCE_DIRS) {
  const full = path.join(rootDir, d.split('/').join(path.sep));
  if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) missingSources.push(d + '/ (directory)');
  else if (countFilesRecursive(full) === 0) missingSources.push(d + '/ (directory is empty)');
}
if (missingSources.length) {
  fail('preflight', 'Source tree is incomplete - commit/push these files before tagging:', missingSources);
}
console.log('  Source tree: ' + REQUIRED_SOURCE_FILES.length + ' files + ' + REQUIRED_SOURCE_DIRS.length + ' directories present.');

if (process.platform !== 'win32') {
  fail('preflight', 'This build script targets Windows only (csc.exe + Windows Electron).');
}
if (!fs.existsSync(cscPath)) {
  fail('preflight', 'C# compiler not found: ' + cscPath +
    '\n  On GitHub windows-latest it is at C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe' +
    '\n  Override with the LOKED_CSC environment variable.');
}
console.log('  csc.exe: ' + cscPath);

const electronReady = fs.existsSync(path.join(electronDist, 'electron.exe'));
if (VERIFY_ONLY) {
  console.log((electronReady ? '  ✔ ' : '  ⚠ ') + 'Electron runtime: ' +
    (electronReady ? rel(electronDist) + ' (full build possible)' : 'NOT installed - run `npm install` before a full build'));
} else if (!electronReady) {
  fail('preflight', 'Electron runtime is missing: ' + rel(electronDist) +
    '\n  Run `npm install` (or `npm ci`) before `npm run pack` - the postinstall downloads the Electron binaries.');
}
if (VERIFY_ONLY) {
  console.log('\n=== Verify Succeeded - sources and toolchain are ready for `npm run pack` ===');
  process.exit(0);
}

// --------------------------------------------------------------------------------------
// 1. Compile native locker
// --------------------------------------------------------------------------------------
console.log('\n[1/7] Compiling native locker (Win32 keyboard hook)...');
runCommand('"' + cscPath + '" /nologo /target:winexe /out:"' + lockerExe + '" "' + lockerSrc + '"', 'compile Locker.cs');
if (!fs.existsSync(lockerExe) || fs.statSync(lockerExe).size < 4096) {
  fail('compile Locker.cs', 'locker.exe was not produced correctly: ' + rel(lockerExe));
}
console.log('  ✔ locker.exe (' + bytes(fs.statSync(lockerExe).size) + ')');

// --------------------------------------------------------------------------------------
// 2. Prepare output directories
// --------------------------------------------------------------------------------------
console.log('\n[2/7] Preparing output directories...');
fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(releasesDir, { recursive: true });
console.log('  ✔ ' + rel(releasesDir));

// --------------------------------------------------------------------------------------
// 3. Assemble LOKED-Client
// --------------------------------------------------------------------------------------
console.log('\n[3/7] Packaging LOKED-Client...');
const clientDist = path.join(distDir, 'LOKED-Client');
copyDir(electronDist, clientDist);
const clientElectronExe = path.join(clientDist, 'electron.exe');
if (!fs.existsSync(clientElectronExe)) {
  fail('package client', 'electron.exe not found in ' + rel(electronDist) + ' - Electron install is broken.');
}
fs.renameSync(clientElectronExe, path.join(clientDist, 'LOKED-Client.exe'));

const clientAppDir = path.join(clientDist, 'resources', 'app');
const clientDefaultAsar = path.join(clientDist, 'resources', 'default_app.asar');
if (fs.existsSync(clientDefaultAsar)) fs.unlinkSync(clientDefaultAsar);
fs.mkdirSync(clientAppDir, { recursive: true });

let clientAppFiles = copyDir(path.join(rootDir, 'client', 'src'), path.join(clientAppDir, 'src'));
clientAppFiles += copyDir(path.join(rootDir, 'client', 'native'), path.join(clientAppDir, 'native'),
  (p, entry) => !entry.name.endsWith('.cs'));
const clientDeps = copyDir(path.join(rootDir, 'node_modules'), path.join(clientAppDir, 'node_modules'),
  (p, entry) => entry.name !== 'electron');

fs.writeFileSync(path.join(clientAppDir, 'package.json'), JSON.stringify({
  name: 'loked-client',
  version: APP_VERSION,
  description: 'LOKED Student Client',
  main: 'src/main.js'
}, null, 2));
console.log('  app resources: ' + clientAppFiles + ' files, dependencies: ' + clientDeps + ' files');
verifyTree(clientAppDir, 'LOKED-Client app', CLIENT_APP_FILES, CLIENT_APP_DIRS);

// --------------------------------------------------------------------------------------
// 4. Assemble LOKED-Admin
// --------------------------------------------------------------------------------------
console.log('\n[4/7] Packaging LOKED-Admin...');
const adminDist = path.join(distDir, 'LOKED-Admin');
copyDir(electronDist, adminDist);
const adminElectronExe = path.join(adminDist, 'electron.exe');
if (!fs.existsSync(adminElectronExe)) {
  fail('package admin', 'electron.exe not found in ' + rel(electronDist) + ' - Electron install is broken.');
}
fs.renameSync(adminElectronExe, path.join(adminDist, 'LOKED-Admin.exe'));

const adminAppDir = path.join(adminDist, 'resources', 'app');
const adminDefaultAsar = path.join(adminDist, 'resources', 'default_app.asar');
if (fs.existsSync(adminDefaultAsar)) fs.unlinkSync(adminDefaultAsar);
fs.mkdirSync(adminAppDir, { recursive: true });

let adminAppFiles = copyDir(path.join(rootDir, 'admin-desktop'), path.join(adminAppDir, 'admin-desktop'));
adminAppFiles += copyDir(path.join(rootDir, 'server'), path.join(adminAppDir, 'server'),
  (p, entry) => !entry.name.endsWith('.log'));
const adminDeps = copyDir(path.join(rootDir, 'node_modules'), path.join(adminAppDir, 'node_modules'),
  (p, entry) => entry.name !== 'electron');

fs.writeFileSync(path.join(adminAppDir, 'package.json'), JSON.stringify({
  name: 'loked-admin',
  version: APP_VERSION,
  description: 'LOKED Admin Console & Server',
  main: 'admin-desktop/main.js'
}, null, 2));
console.log('  app resources: ' + adminAppFiles + ' files, dependencies: ' + adminDeps + ' files');
verifyTree(adminAppDir, 'LOKED-Admin app', ADMIN_APP_FILES, ['server/src', 'server/public', 'node_modules']);

// --------------------------------------------------------------------------------------
// 5. ZIP archives
// --------------------------------------------------------------------------------------
console.log('\n[5/7] Creating ZIP archives...');
function createZip(sourceDir, zipPath, label) {
  if (!fs.existsSync(zipPath)) fs.mkdirSync(path.dirname(zipPath), { recursive: true });
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  runCommand('powershell -NoProfile -ExecutionPolicy Bypass -Command "' +
    'Add-Type -AssemblyName System.IO.Compression.FileSystem; ' +
    '[System.IO.Compression.ZipFile]::CreateFromDirectory(\'' + sourceDir + '\', \'' + zipPath + '\')"',
    'create ' + label);
  if (!fs.existsSync(zipPath) || fs.statSync(zipPath).size === 0) {
    fail('create ' + label, 'Archive was not created: ' + rel(zipPath));
  }
  console.log('  ✔ ' + rel(zipPath) + ' (' + bytes(fs.statSync(zipPath).size) + ')');
}
createZip(clientDist, CLIENT_ZIP, 'LOKED-Client-win-x64.zip');
createZip(adminDist, ADMIN_ZIP, 'LOKED-Admin-win-x64.zip');

// --------------------------------------------------------------------------------------
// 6. Standalone single-file .exe launchers
// --------------------------------------------------------------------------------------
console.log('\n[6/7] Compiling standalone single-file launchers...');
function createStandalone(zipPath, exePath, define, label) {
  runCommand('"' + cscPath + '" /nologo /target:winexe /define:' + define +
    ' /reference:System.IO.Compression.FileSystem.dll /resource:"' + zipPath + '",Payload' +
    ' /out:"' + exePath + '" "' + launcherSrc + '"', 'compile ' + label);
  if (!fs.existsSync(exePath) || fs.statSync(exePath).size < 1024 * 1024) {
    fail('compile ' + label, 'Standalone launcher is missing or does not embed the payload: ' + rel(exePath));
  }
  console.log('  ✔ ' + rel(exePath) + ' (' + bytes(fs.statSync(exePath).size) + ')');
}
createStandalone(CLIENT_ZIP, CLIENT_EXE, 'CLIENT', 'LOKED-Client.exe');
createStandalone(ADMIN_ZIP, ADMIN_EXE, 'ADMIN', 'LOKED-Admin.exe');

// --------------------------------------------------------------------------------------
// 7. Final report
// --------------------------------------------------------------------------------------
console.log('\n[7/7] Build report');
console.log('  Verified source files: ' + REQUIRED_SOURCE_FILES.length + ' / ' + REQUIRED_SOURCE_DIRS.length + ' directories');
console.log('  Verified client app:   ' + CLIENT_APP_FILES.length + ' files / ' + CLIENT_APP_DIRS.length + ' directories');
console.log('  Verified admin app:    ' + ADMIN_APP_FILES.length + ' files');
console.log('\n  Artifacts in ' + rel(releasesDir) + ':');
for (const f of fs.readdirSync(releasesDir).sort()) {
  const stat = fs.statSync(path.join(releasesDir, f));
  console.log('   - ' + f + '  (' + bytes(stat.size) + ')');
}
console.log('  Full trees: ' + rel(clientDist) + '  (' + countFilesRecursive(clientDist) + ' files)');
console.log('               ' + rel(adminDist) + '  (' + countFilesRecursive(adminDist) + ' files)');
console.log('\n=== Build Succeeded! ===');