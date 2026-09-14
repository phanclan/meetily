#!/usr/bin/env node
/**
 * Auto-detect GPU and run Tauri with appropriate features
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Get the command (dev or build)
const command = process.argv[2];
if (!command || !['dev', 'build'].includes(command)) {
  console.error('Usage: node tauri-auto.js [dev|build]');
  process.exit(1);
}
const extraArgs = process.argv.slice(3);

// Detect GPU feature
let feature = '';

// Check for environment variable override first
if (process.env.TAURI_GPU_FEATURE) {
  feature = process.env.TAURI_GPU_FEATURE;
  console.log(`🔧 Using forced GPU feature from environment: ${feature}`);
} else {
  try {
    const result = execSync('node scripts/auto-detect-gpu.js', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'inherit']
    });
    feature = result.trim();
  } catch (err) {
    // If detection fails, continue with no features
  }
}

console.log(''); // Empty line for spacing

// Platform-specific environment variables
const platform = os.platform();
const env = { ...process.env };
const testerConfig = extraArgs.some(
  (arg) => typeof arg === 'string' && arg.includes('tauri.afterword.tester.conf.json')
);

function timestampBuildId() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    '-',
    pad(now.getHours()),
    pad(now.getMinutes()),
  ].join('');
}

function gitShortSha() {
  try {
    return execSync('git rev-parse --short HEAD', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
  } catch (_err) {
    return '';
  }
}

const shortSha = gitShortSha();
const defaultBuildId = [timestampBuildId(), shortSha].filter(Boolean).join('-');
// AFTERWORD_BUILD_* identifies channel, flavor, and build id.
env.AFTERWORD_BUILD_ID = env.AFTERWORD_BUILD_ID || defaultBuildId;
env.AFTERWORD_BUILD_CHANNEL =
  env.AFTERWORD_BUILD_CHANNEL || (command === 'build' ? 'bundle' : 'dev');
env.AFTERWORD_BUILD_FLAVOR =
  env.AFTERWORD_BUILD_FLAVOR || (testerConfig ? 'afterword-tester' : 'meetily');

// Frontend flavor gate (Afterword ipc / UI extensions)
if (testerConfig) {
  env.NEXT_PUBLIC_FLAVOR = env.NEXT_PUBLIC_FLAVOR || 'afterword';
}

console.log(`🏷️  Build identity: ${env.AFTERWORD_BUILD_FLAVOR} ${env.AFTERWORD_BUILD_CHANNEL} ${env.AFTERWORD_BUILD_ID}`);
console.log('');

if (platform === 'linux' && feature === 'cuda') {
  console.log('🐧 Linux/CUDA detected: Setting CMAKE flags for NVIDIA GPU');
  env.CMAKE_CUDA_ARCHITECTURES = '75';
  env.CMAKE_CUDA_STANDARD = '17';
  env.CMAKE_POSITION_INDEPENDENT_CODE = 'ON';
}

// Build the tauri command
let tauriCmd = `tauri ${command}`;
if (extraArgs.length > 0) {
  tauriCmd += ` ${extraArgs.map((arg) => JSON.stringify(arg)).join(' ')}`;
  console.log(`🧩 Extra Tauri args: ${extraArgs.join(' ')}`);
}
// Afterword tester builds always enable the afterword Cargo feature.
const featureList = [];
if (feature && feature !== 'none') {
  featureList.push(feature);
}
if (testerConfig) {
  featureList.push('afterword');
}
if (featureList.length > 0) {
  const featuresArg = featureList.join(',');
  tauriCmd += ` -- --features ${featuresArg}`;
  console.log(`🚀 Running: tauri ${command} with features: ${featuresArg}`);
} else {
  console.log(`🚀 Running: tauri ${command} (CPU-only mode)`);
}
console.log('');

// Execute the command
try {
  execSync(tauriCmd, { stdio: 'inherit', env });
} catch (err) {
  process.exit(err.status || 1);
}
