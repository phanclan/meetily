import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const noop = () => {};
function storage() {
  const values = new Map();
  return { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) };
}
function loader(stubs = {}, globals = {}) {
  const cache = new Map();
  function load(file) {
    if (file in stubs) return stubs[file];
    const resolved = file.startsWith('@/') ? path.join(root, 'src', file.slice(2) + '.ts') : file;
    if (!path.isAbsolute(resolved)) return require(resolved);
    if (cache.has(resolved)) return cache.get(resolved);
    const module = { exports: {} };
    cache.set(resolved, module.exports);
    const compiled = ts.transpileModule(fs.readFileSync(resolved, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText;
    vm.runInNewContext(compiled, {
      module, exports: module.exports, require: load,
      console: { log: noop, warn: noop, error: noop },
      setTimeout: cb => { queueMicrotask(cb); return 1; }, clearTimeout: noop,
      ...globals,
    }, { filename: resolved });
    return module.exports;
  }
  return load;
}
const blocks = [{ id: 'note-1', type: 'paragraph', content: [{ type: 'text', text: 'Synthetic recovery note', styles: {} }], children: [] }];
const quietReact = { useCallback: f => f, useEffect: noop, useRef: value => ({ current: value }), useState: value => [value, noop] };

function stopFixture({ failNotes = false } = {}) {
  const localStorage = storage();
  const sessionStorage = storage();
  const events = [];
  const transcripts = [{ text: 'Synthetic transcript', audio_start_time: 0, audio_end_time: 1 }];
  let saves = 0;
  const load = loader({
    react: quietReact,
    'next/navigation': { useRouter: () => ({ push: () => events.push('navigate') }) },
    '@tauri-apps/api/event': { listen: async () => noop },
    '@tauri-apps/plugin-store': { Store: { load: async () => ({ get: async () => 2 }) } },
    sonner: { toast: { success: () => events.push('toast'), warning: noop, error: noop } },
    '@/contexts/TranscriptContext': { useTranscripts: () => ({ currentMeetingId: 'meeting-1', transcriptsRef: { current: transcripts }, flushBuffer: noop, clearTranscripts: noop, meetingTitle: 'Synthetic meeting', markMeetingAsSaved: async () => events.push('marked') }) },
    '@/components/Sidebar/SidebarProvider': { useSidebar: () => ({ refetchMeetings: async () => {}, setCurrentMeeting: noop, setMeetings: noop, meetings: [], setIsMeetingActive: noop }) },
    '@/contexts/RecordingStateContext': { useRecordingState: () => ({ setStatus: noop }), RecordingStatus: { STOPPING: 'stopping', IDLE: 'idle', COMPLETED: 'completed', SAVING: 'saving', ERROR: 'error', PROCESSING_TRANSCRIPTS: 'processing' } },
    '@/services/transcriptService': { transcriptService: { getTranscriptionStatus: async () => ({ is_processing: false, chunks_in_queue: 0 }) } },
    '@/services/storageService': { storageService: { saveMeeting: async (_title, received) => { assert.equal(received.length, 1); saves++; events.push('meeting'); return { meeting_id: 'meeting-a5ce2dc0-f470-485c-b35d-1b2bd0b49059' }; }, getMeeting: async () => ({ id: 'meeting-a5ce2dc0-f470-485c-b35d-1b2bd0b49059', title: 'Synthetic meeting' }) } },
    '@/lib/analytics': { default: new Proxy({}, { get: () => async () => {} }), __esModule: true },
    '@/lib/summary-language-preferences': { applyPinnedSummaryLanguageToMeeting: async () => true },
    '@/meetnola/ipc': { saveMeetingNotes: async args => { events.push('notes'); if (failNotes) throw new Error('disk full'); assert.equal(args.meetingId, 'meeting-a5ce2dc0-f470-485c-b35d-1b2bd0b49059'); assert.match(args.notesMarkdown, /Synthetic recovery note/); } },
  }, { localStorage, sessionStorage });
  const notes = load('@/lib/liveMeetingNotes');
  notes.writeLiveMeetingNotes('meeting-1', blocks);
  const { useRecordingStop } = load('@/hooks/useRecordingStop');
  return { notes, events, useRecordingStop, saves: () => saves };
}

test('UI stop persists live notes before callback and honors navigation/toast options', async () => {
  const f = stopFixture();
  const result = await f.useRecordingStop(noop, noop).handleRecordingStop(true, {
    autoNavigate: false, showToast: false, onSaved: () => f.events.push('callback'),
  });
  assert.equal(result, 'meeting-a5ce2dc0-f470-485c-b35d-1b2bd0b49059');
  assert.deepEqual(f.events, ['meeting', 'notes', 'callback', 'marked']);
  assert.equal(f.notes.readLiveMeetingNotes('meeting-1'), null);
});

test('tray stop persists live notes without a mounted editor or callback', async () => {
  const f = stopFixture();
  assert.equal(await f.useRecordingStop(noop, noop).handleRecordingStop(true), 'meeting-a5ce2dc0-f470-485c-b35d-1b2bd0b49059');
  assert.ok(f.events.includes('notes'));
  assert.ok(f.events.includes('navigate'));
});

test('partial stop does not save or discard the live draft', async () => {
  const f = stopFixture();
  assert.equal(await f.useRecordingStop(noop, noop).handleRecordingStop(false), undefined);
  assert.equal(f.saves(), 0);
  assert.notEqual(f.notes.readLiveMeetingNotes('meeting-1'), null);
});

test('failed note persistence retains recovery data and does not mark success', async () => {
  const f = stopFixture({ failNotes: true });
  assert.equal(await f.useRecordingStop(noop, noop).handleRecordingStop(true), undefined);
  assert.notEqual(f.notes.readLiveMeetingNotes('meeting-1'), null);
  assert.ok(!f.events.includes('marked'));
  assert.ok(!f.events.includes('navigate'));
});

test('simultaneous UI and tray handlers save only one meeting', async () => {
  const f = stopFixture();
  const one = f.useRecordingStop(noop, noop);
  const two = f.useRecordingStop(noop, noop);
  await Promise.all([one.handleRecordingStop(true), two.handleRecordingStop(true)]);
  assert.equal(f.saves(), 1);
});

test('live notes survive editor unmount/remount without a SQLite write', async () => {
  const localStorage = storage();
  let effects = [];
  const stateValues = [];
  const load = loader({
    react: { ...quietReact, useEffect: effect => effects.push(effect), useState: v => [v, value => stateValues.push(value)] },
    sonner: { toast: { error: noop } },
    '@/meetnola/ipc': { saveMeetingNotes: () => { throw new Error('Temporary IDs cannot reference a SQLite meeting'); } },
  }, { localStorage });
  const { useMeetingNotes } = load('@/hooks/useMeetingNotes');
  const first = useMeetingNotes('meeting-1');
  const cleanup = effects.map(effect => effect());
  first.saveNotes(blocks);
  cleanup.forEach(fn => fn?.());
  effects = [];
  useMeetingNotes('meeting-1');
  effects.forEach(effect => effect());
  assert.ok(stateValues.some(value => JSON.stringify(value) === JSON.stringify(blocks)));
  effects = [];
  useMeetingNotes('meeting-2');
  effects.forEach(effect => effect());
  assert.equal(load('@/lib/liveMeetingNotes').readLiveMeetingNotes('meeting-2'), null);
});

test('recording service returns native stop result and invokes registered session commands', async () => {
  const calls = [];
  const result = { status: 'partial', chunks_remaining: 2, reason: 'timeout', message: 'Incomplete' };
  const load = loader({
    '@tauri-apps/api/core': { invoke: async (command, args) => { calls.push({ command, args }); return command === 'stop_recording' ? result : null; } },
    '@tauri-apps/api/event': {},
  });
  const { recordingService } = load('@/services/recordingService');
  assert.equal(await recordingService.stopRecording('/tmp/synthetic.wav'), result);
  await recordingService.getMeetingSession();
  await recordingService.updateMeetingSessionTitle('Synthetic');
  assert.deepEqual(calls.map(c => c.command), ['stop_recording', 'get_meeting_session', 'update_meeting_session_title']);
});


test('saved meeting UUIDs load and save through SQLite rather than the live-draft cache', async () => {
  const localStorage = storage();
  const effects = [];
  const writes = [];
  const id = 'meeting-a5ce2dc0-f470-485c-b35d-1b2bd0b49059';
  const load = loader({
    react: { ...quietReact, useEffect: effect => effects.push(effect) },
    sonner: { toast: { error: noop } },
    '@/meetnola/ipc': {
      getMeetingNotes: async received => { assert.equal(received, id); return { notes_json: JSON.stringify(blocks) }; },
      saveMeetingNotes: async args => writes.push(args),
    },
  }, { localStorage });
  const notes = load('@/lib/liveMeetingNotes');
  assert.equal(notes.isLiveMeetingId(id), false);
  assert.equal(notes.isLiveMeetingId('meeting-1788630000000'), true);
  const hook = load('@/hooks/useMeetingNotes').useMeetingNotes(id);
  effects.forEach(effect => effect());
  await new Promise(resolve => setImmediate(resolve));
  hook.replaceNotes(blocks, { immediate: true });
  await hook.flushPendingSave();
  assert.ok(writes.length > 0);
  assert.equal(writes.at(-1).meetingId, id);
  assert.equal(notes.readLiveMeetingNotes(id), null);
});

test('interrupted notes-only recording can be recovered and clears its draft only after saving', async () => {
  const localStorage = storage();
  const events = [];
  const load = loader({
    react: quietReact,
    sonner: { toast: { error: noop, warning: noop } },
    '@tauri-apps/api/core': { invoke: async () => null },
    '@/services/indexedDBService': { indexedDBService: {
      getMeetingMetadata: async () => ({ title: 'Synthetic interrupted note' }),
      getTranscripts: async () => [],
      markMeetingSaved: async () => events.push('marked'),
    } },
    '@/services/storageService': { storageService: { saveMeeting: async () => ({ meeting_id: 'meeting-saved-uuid' }) } },
    '@/lib/summary-language-preferences': { applyPinnedSummaryLanguageToMeeting: async () => {} },
    '@/meetnola/ipc': { saveMeetingNotes: async args => { assert.match(args.notesMarkdown, /Synthetic/); events.push('notes'); } },
  }, { localStorage });
  const notes = load('@/lib/liveMeetingNotes');
  notes.writeLiveMeetingNotes('meeting-1', blocks);
  const result = await load('@/hooks/useTranscriptRecovery').useTranscriptRecovery().recoverMeeting('meeting-1');
  assert.equal(result.success, true);
  assert.deepEqual(events, ['notes', 'marked']);
  assert.equal(notes.readLiveMeetingNotes('meeting-1'), null);
});
