// Evaluate synthetic sources through the app's note wrapper and native pipeline.
// Phrase checks are bounded regressions; the saved prose still needs review.
require('./register-typescript-tests.cjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildEnhanceNotesPrompt } = require('../src/lib/enhanceNotes.ts');

const frontend = path.resolve(__dirname, '..');
const cases = JSON.parse(fs.readFileSync(path.join(frontend, 'tests/fixtures/summary-quality.json'), 'utf8'));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'afterword-summary-eval-'));
const input = path.join(temporary, 'contexts.json');
try {
  fs.writeFileSync(input, JSON.stringify(Object.fromEntries(cases.map(item => [item.id, buildEnhanceNotesPrompt(item.notes)]))));
  const run = spawnSync('cargo', ['test', '--features', 'afterword', '--lib', 'summary::quality_evals::live_summary_quality', '--', '--exact', '--ignored', '--nocapture'], {
    cwd: path.join(frontend, 'src-tauri'),
    stdio: 'inherit',
    env: {
      ...process.env,
      CARGO_TARGET_DIR: process.env.CARGO_TARGET_DIR || path.resolve(frontend, '../target/afterword'),
      AFTERWORD_EVAL_CONTEXT: process.env.AFTERWORD_EVAL_CONTEXT || 'runtime',
      AFTERWORD_SUMMARY_EVAL_CONTEXTS: input,
    },
  });
  if (run.error) throw run.error;
  process.exitCode = run.status ?? 1;
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
