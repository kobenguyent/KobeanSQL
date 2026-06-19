#!/usr/bin/env node
const { execSync } = require('child_process');
const path = require('path');

const args = process.argv.slice(2);
const command = args[0] || 'start';

// The project root is one level up from the scripts directory
const projectDir = path.resolve(__dirname, '..');

if (command === 'start') {
  console.log('🚀 Starting KobeanSQL via kb CLI...');
  try {
    // Execute npm run dev in the project directory
    execSync('npm run dev', { stdio: 'inherit', cwd: projectDir });
  } catch (error) {
    process.exit(1);
  }
} else {
  console.log('Usage: kb start');
}
