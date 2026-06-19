const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🚀 Setting up KobeanSQL...');

const projectDir = path.resolve(__dirname, '..');

function run(cmd) {
  try {
    execSync(cmd, { stdio: 'inherit', cwd: projectDir });
  } catch (error) {
    console.error(`❌ Command failed: ${cmd}`);
    process.exit(1);
  }
}

// Check Node.js version against .nvmrc
const nvmrcPath = path.join(projectDir, '.nvmrc');
if (fs.existsSync(nvmrcPath)) {
  const expectedVersion = fs.readFileSync(nvmrcPath, 'utf8').trim();
  const currentVersion = process.version;
  const expectedMajor = expectedVersion.split('.')[0];
  if (!currentVersion.startsWith('v' + expectedMajor)) {
    console.log(`⚠️  Warning: You are using Node ${currentVersion}. Recommended version is v${expectedVersion}.`);
  } else {
    console.log(`📦 Node version ${currentVersion} looks good.`);
  }
}

console.log('\n📥 Installing dependencies and rebuilding native modules...');
run('npm run install:dev');

console.log('\n⚙️ Fixing Electron binary installation...');
const electronInstallScript = path.join(projectDir, 'node_modules', 'electron', 'install.js');
if (fs.existsSync(electronInstallScript)) {
  run(`node "${electronInstallScript}"`);
}

console.log('\n🔗 Setting up cross-platform "kb" CLI...');
try {
  run('npm link');
  console.log('✨ Successfully added "kb" command globally!');
  console.log('👉 From now on, you can simply type "kb start" from ANY directory on your computer.');
} catch (err) {
  console.log('⚠️ Could not automatically link the "kb" CLI. You might need to run "npm link" with admin privileges.');
}

console.log('\n✅ Setup complete! Launching the application...');
run('npm run dev');
