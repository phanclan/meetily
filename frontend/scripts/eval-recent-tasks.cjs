// Synthetic task classification through the production recent-source formatter
// and native streaming Q&A. Exit 0 proves transport only; review every answer.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { spawnSync } = require('node:child_process');

const frontend = path.resolve(__dirname, '..');
const question = process.argv.includes('--categorized')
  ? 'Review follow-ups in these meetings. Use separate headings: Agreed follow-ups, Unresolved assignments, and Requirements or acceptance criteria. Put each item in the appropriate category, or say None stated. For agreed follow-ups, include owners and deadlines only if stated. Exclude completed work and declined requests from agreed follow-ups. For unresolved assignments, preserve each conflicting owner/date pair without choosing one. Cite each item.'
  : 'List the explicit follow-ups agreed in these recent meetings. Include an owner or deadline only when stated, and cite each source.';
if (process.argv.slice(2).some(arg => arg !== '--categorized')) throw new Error('Usage: node scripts/eval-recent-tasks.cjs [--categorized]');

async function main() {
  const cases = JSON.parse(fs.readFileSync(path.join(frontend, 'tests/fixtures/recent-task-quality.json'), 'utf8'));
  let excerpts;
  const loaded = { exports: {} };
  // Only retrieval is replaced: no app database, saved meeting, or preference is read.
  const compiled = ts.transpileModule(fs.readFileSync(path.join(frontend, 'src/lib/libraryAnswerContext.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(compiled, { module: loaded, exports: loaded.exports, require: name => {
    if (name !== '@/meetnola/ipc') throw new Error(`Unexpected formatter dependency: ${name}`);
    return { meetnolaInvoke: async command => {
      if (command !== 'get_recent_library_sources') throw new Error(`Unexpected retrieval: ${command}`);
      return { excerpts, totalMeetings: 1 };
    } };
  } });
  const input = [];
  for (const item of cases) {
    excerpts = item.texts.map((text, index) => ({ meetingId: 'synthetic', title: 'Synthetic task review', createdAt: '2026-09-09',
      kind: index ? 'transcript' : 'notes', audioStartTime: index ? 45 : null, text }));
    const { context } = await loaded.exports.loadLibraryAnswerContext(question, [], '7', 'recent');
    input.push({ id: item.id, context, question, claim: '', expected: item.expected });
  }
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'meetnola-task-eval-'));
  try {
    const inputPath = path.join(temporary, 'questions.json');
    fs.writeFileSync(inputPath, JSON.stringify(input));
    // Reuse the question/expected-answer report harness used by source claim checks.
    const run = spawnSync('cargo', ['test', '--features', 'meetnola', '--lib', 'summary::quality_evals::live_summary_claim_checks', '--', '--exact', '--ignored', '--nocapture'], {
      cwd: path.join(frontend, 'src-tauri'), stdio: 'inherit', env: { ...process.env,
        CARGO_TARGET_DIR: process.env.CARGO_TARGET_DIR || path.resolve(frontend, '../target/meetnola'),
        MEETNOLA_CLAIM_EVAL_INPUT: inputPath,
        MEETNOLA_EVAL_REPORT: process.env.MEETNOLA_EVAL_REPORT || path.join(os.tmpdir(), 'meetnola-task-quality.json'),
      },
    });
    if (run.error) throw run.error;
    process.exitCode = run.status ?? 1;
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
