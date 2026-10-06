const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const releasesDir = path.join(distDir, 'releases');
const electronDist = path.join(rootDir, 'node_modules', 'electron', 'dist');
const cscPath = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';

console.log('=== LOKED Automated Build System ===');

// 1. Build Native Locker
console.log('\n[1/6] Building native locker (Win32 API hook)...');
try {
  const lockerSrc = path.join(rootDir, 'client', 'native', 'Locker.cs');
  const lockerOut = path.join(rootDir, 'client', 'native', 'locker.exe');
  execSync(`"${cscPath}" /nologo /target:winexe /out:"${lockerOut}" "${lockerSrc}"`);
  console.log('✔ Native locker compiled successfully.');
} catch (err) {
  console.error('✖ Failed to compile native locker:', err.message);
  process.exit(1);
}

// 2. Prepare Dist Directory
console.log('\n[2/6] Preparing output directories...');
if (fs.existsSync(distDir)) {
  fs.rmSync(distDir, { recursive: true, force: true });
}
fs.mkdirSync(distDir, { recursive: true });
fs.mkdirSync(releasesDir, { recursive: true });

// Directory copy helper
function copyDir(src, dest, filterFn = null) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (filterFn && !filterFn(srcPath, entry)) continue;
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath, filterFn);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// Copy node_modules excluding electron runtime
function copyNodeModules(destModules) {
  console.log(`  Copying dependencies to ${path.relative(rootDir, destModules)}...`);
  const srcModules = path.join(rootDir, 'node_modules');
  copyDir(srcModules, destModules, (srcPath, entry) => {
    if (entry.name === 'electron') return false;
    if (entry.name === '.bin') return false;
    if (entry.name === '.package-lock.json') return false;
    return true;
  });
}

// 3. Assemble LOKED-Client package
console.log('\n[3/6] Packaging LOKED-Client...');
const clientDist = path.join(distDir, 'LOKED-Client');
copyDir(electronDist, clientDist);
fs.renameSync(path.join(clientDist, 'electron.exe'), path.join(clientDist, 'LOKED-Client.exe'));

const clientAppDir = path.join(clientDist, 'resources', 'app');
const clientDefaultAsar = path.join(clientDist, 'resources', 'default_app.asar');
if (fs.existsSync(clientDefaultAsar)) fs.unlinkSync(clientDefaultAsar);
fs.mkdirSync(clientAppDir, { recursive: true });

copyDir(path.join(rootDir, 'client', 'src'), path.join(clientAppDir, 'src'));
copyDir(path.join(rootDir, 'client', 'native'), path.join(clientAppDir, 'native'));
copyNodeModules(path.join(clientAppDir, 'node_modules'));

fs.writeFileSync(path.join(clientAppDir, 'package.json'), JSON.stringify({
  name: 'loked-client',
  version: '1.0.0',
  description: 'LOKED Student Client',
  main: 'src/main.js'
}, null, 2));
console.log('✔ LOKED-Client package assembled.');

// 4. Assemble LOKED-Admin package
console.log('\n[4/6] Packaging LOKED-Admin...');
const adminDist = path.join(distDir, 'LOKED-Admin');
copyDir(electronDist, adminDist);
fs.renameSync(path.join(adminDist, 'electron.exe'), path.join(adminDist, 'LOKED-Admin.exe'));

const adminAppDir = path.join(adminDist, 'resources', 'app');
const adminDefaultAsar = path.join(adminDist, 'resources', 'default_app.asar');
if (fs.existsSync(adminDefaultAsar)) fs.unlinkSync(adminDefaultAsar);
fs.mkdirSync(adminAppDir, { recursive: true });

copyDir(path.join(rootDir, 'admin-desktop'), path.join(adminAppDir, 'admin-desktop'));
copyDir(path.join(rootDir, 'server'), path.join(adminAppDir, 'server'), (srcPath, entry) => {
  if (entry.name === 'logs' || entry.name.endsWith('.log')) return false;
  return true;
});
copyNodeModules(path.join(adminAppDir, 'node_modules'));

fs.writeFileSync(path.join(adminAppDir, 'package.json'), JSON.stringify({
  name: 'loked-admin',
  version: '1.0.0',
  description: 'LOKED Admin Console & Server',
  main: 'admin-desktop/main.js'
}, null, 2));
console.log('✔ LOKED-Admin package assembled.');

// 5. Create ZIP archives
console.log('\n[5/6] Creating ZIP distributions...');
const clientZip = path.join(releasesDir, 'LOKED-Client-win-x64.zip');
const adminZip = path.join(releasesDir, 'LOKED-Admin-win-x64.zip');

console.log('  Archiving LOKED-Client-win-x64.zip...');
execSync(`powershell -NoProfile -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory('${clientDist}', '${clientZip}')"`);
console.log('✔ Client archive created.');

console.log('  Archiving LOKED-Admin-win-x64.zip...');
execSync(`powershell -NoProfile -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory('${adminDist}', '${adminZip}')"`);
console.log('✔ Admin archive created.');

// 6. Compile Standalone Single-File .EXEs
console.log('\n[6/6] Compiling standalone single-file .EXE binaries...');
const launcherSrc = path.join(__dirname, 'Launcher.cs');
const clientExe = path.join(releasesDir, 'LOKED-Client.exe');
const adminExe = path.join(releasesDir, 'LOKED-Admin.exe');

console.log('  Compiling standalone LOKED-Client.exe...');
execSync(`"${cscPath}" /nologo /target:winexe /define:CLIENT /reference:System.IO.Compression.FileSystem.dll /resource:"${clientZip}",Payload /out:"${clientExe}" "${launcherSrc}"`);
console.log('✔ LOKED-Client.exe compiled.');

console.log('  Compiling standalone LOKED-Admin.exe...');
execSync(`"${cscPath}" /nologo /target:winexe /define:ADMIN /reference:System.IO.Compression.FileSystem.dll /resource:"${adminZip}",Payload /out:"${adminExe}" "${launcherSrc}"`);
console.log('✔ LOKED-Admin.exe compiled.');

console.log('\n=== Artifacts in dist/releases: ===');
const releaseFiles = fs.readdirSync(releasesDir);
for (const f of releaseFiles) {
  const stat = fs.statSync(path.join(releasesDir, f));
  console.log(` - ${f} (${(stat.size / 1024 / 1024).toFixed(2)} MB)`);
}
console.log('\n=== Build Succeeded! ===');
