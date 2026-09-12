// Use the actual frontend claim prompt and native streaming Q&A implementation.
// Synthetic inputs only. The report needs human semantic review, even on exit 0.
require('./register-typescript-tests.cjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { summaryClaimQuestion } = require('../src/lib/summaryClaim.ts');

const frontend = path.resolve(__dirname, '..');
const cases = JSON.parse(fs.readFileSync(path.join(frontend, 'tests/fixtures/summary-claims.json'), 'utf8'));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'afterword-claim-eval-'));
const input = path.join(temporary, 'questions.json');
try {
  fs.writeFileSync(input, JSON.stringify(cases.map(item => ({ ...item, question: summaryClaimQuestion(item.claim) }))));
  const run = spawnSync('cargo', ['test', '--features', 'afterword', '--lib', 'live_summary_claim_checks', '--', '--ignored', '--nocapture'], {
    cwd: path.join(frontend, 'src-tauri'),
    stdio: 'inherit',
    env: {
      ...process.env,
      CARGO_TARGET_DIR: process.env.CARGO_TARGET_DIR || path.resolve(frontend, '../target/afterword'),
      AFTERWORD_CLAIM_EVAL_INPUT: input,
    },
  });
  if (run.error) throw run.error;
  process.exitCode = run.status ?? 1;
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
