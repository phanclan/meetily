import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

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
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
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

test('reopened paginated API transcripts render their saved recording times', async () => {
  const saved = [25.3, 29.8, 48.1].map((seconds, i) => ({
    id: `saved-${i}`, text: `Synthetic segment ${i}`, timestamp: '14:51:30',
    audio_start_time: seconds, audio_end_time: seconds + 2,
  }));
  const state = [];
  let cursor = 0;
  const load = loader({
    react: {
      ...quietReact,
      useMemo: fn => fn(),
      useState: initial => {
        const index = cursor++;
        if (!(index in state)) state[index] = initial;
        return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
      },
    },
    '@tauri-apps/api/core': { invoke: async command => {
      if (command === 'api_get_meeting_metadata') return { id: 'synthetic', title: 'Saved meeting' };
      assert.equal(command, 'api_get_meeting_transcripts');
      return { transcripts: saved, total_count: saved.length, has_more: false };
    } },
  });
  const { usePaginatedTranscripts } = load('@/hooks/usePaginatedTranscripts');
  await usePaginatedTranscripts({ meetingId: 'synthetic' }).refetch();
  cursor = 0;
  const { transcripts } = usePaginatedTranscripts({ meetingId: 'synthetic' });
  const { SavedTranscriptRows } = load(path.join(root, 'src/components/MeetingDetails/SavedTranscriptRows.tsx'));
  const html = renderToStaticMarkup(createElement(SavedTranscriptRows, { transcripts }));
  for (const time of ['0:25', '0:29', '0:48']) assert.ok(html.includes(time));
  for (const item of saved) assert.ok(html.includes(item.text));
  assert.ok(!html.includes('--:--'));
  assert.ok(!html.includes('14:51:30'));
});

test('saved transcript rows distinguish zero from missing or invalid recording times', () => {
  const { SavedTranscriptRows } = loader()(path.join(root, 'src/components/MeetingDetails/SavedTranscriptRows.tsx'));
  for (const [seconds, expected] of [[0, '0:00'], [125.9, '2:05'], [null, '--:--'], [undefined, '--:--'], [NaN, '--:--'], [Infinity, '--:--']]) {
    const html = renderToStaticMarkup(createElement(SavedTranscriptRows, {
      transcripts: [{ id: 'synthetic', text: 'Saved text', timestamp: '14:51:30', audio_start_time: seconds }],
    }));
    assert.ok(html.includes(expected), `Expected ${expected} for ${seconds}`);
    assert.ok(html.includes('Saved text'));
  }
  assert.match(renderToStaticMarkup(createElement(SavedTranscriptRows, { transcripts: [] })), /No transcript segments/);
});

test('notes-only and mixed follow-up context reaches the native assistant with source labels', async () => {
  const calls = [];
  const load = loader({
    react: quietReact,
    '@/meetnola/ipc': { liveQuery: async args => { calls.push(args); return 'Synthetic answer'; } },
  });
  const { buildMeetingContext } = load('@/lib/meetingContext');
  const chat = load('@/hooks/useLiveMeetingChat').useLiveMeetingChat();
  await chat.send('What is the action?', buildMeetingContext('', 'Action: test reopening.'));
  assert.equal(calls[0].transcriptContext, 'Written notes:\nAction: test reopening.');
  await chat.send('Summarize both sources', buildMeetingContext('Captured speech', 'Written note'));
  assert.equal(calls[1].transcriptContext, 'Written notes:\nWritten note\n\nTranscript:\nCaptured speech');
  assert.equal(buildMeetingContext('  ', '\n'), '');
});

test('draft navigation does not request a fresh recording while explicit recording entry does', () => {
  const route = loader()('@/lib/quickNoteRoute');
  assert.equal(route.createDraftNotePath(), '/quick-note');
  assert.match(route.createQuickNotePath(), /^\/quick-note\?fresh=\d+$/);
  assert.equal(route.createRecordingWorkspacePath(true), '/quick-note');
  assert.match(route.createRecordingWorkspacePath(false), /fresh=/);
});

test('rapid title edits are serialized and navigation waits for the final write', async () => {
  const requests = [];
  let finishFirst;
  const firstWrite = new Promise(resolve => { finishFirst = resolve; });
  const load = loader({
    react: quietReact,
    '@tauri-apps/api/core': { invoke: async (command, args) => {
      assert.equal(command, 'api_save_meeting_title');
      requests.push(args.title);
      if (requests.length === 1) await firstWrite;
    } },
  });
  const title = load('@/hooks/useMeetingTitleSave').useMeetingTitleSave('saved-meeting');
  const first = title.save('First');
  const second = title.save('Final');
  let navigated = false;
  const flush = title.flush().then(() => { navigated = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(requests, ['First']);
  assert.equal(navigated, false);
  finishFirst();
  await Promise.all([first, second, flush]);
  assert.deepEqual(requests, ['First', 'Final']);
  assert.equal(navigated, true);
});

test('failed title writes retain the latest edit for retry and keep flush rejected until saved', async () => {
  let fail = true;
  const requests = [];
  const statuses = [];
  const load = loader({
    react: { ...quietReact, useState: value => [value, status => statuses.push(status)] },
    '@tauri-apps/api/core': { invoke: async (_command, args) => {
      requests.push(args.title);
      if (fail) throw new Error('synthetic unavailable storage');
    } },
  });
  const title = load('@/hooks/useMeetingTitleSave').useMeetingTitleSave('saved-meeting');
  await assert.rejects(title.save('Keep this title'));
  await assert.rejects(title.flush());
  assert.equal(statuses.at(-1), 'error');
  fail = false;
  await title.flush();
  assert.deepEqual(requests, ['Keep this title', 'Keep this title', 'Keep this title']);
  assert.equal(statuses.at(-1), 'saved');
});

test('leaving before notes load never overwrites stored notes with an empty document', async () => {
  const writes = [];
  const load = loader({
    react: quietReact,
    '@/meetnola/ipc': { getMeetingNotes: async () => null, saveMeetingNotes: async args => writes.push(args) },
    sonner: { toast: { error: noop } },
  });
  await load('@/hooks/useMeetingNotes').useMeetingNotes('saved-meeting').flushPendingSave();
  assert.deepEqual(writes, []);
});

test('legacy text notes load into the editor and a failed edit can be retried intact', async () => {
  const effects = [];
  const state = [];
  let fail = true;
  const writes = [];
  const load = loader({
    react: {
      ...quietReact,
      useEffect: effect => effects.push(effect),
      useState: value => {
        const index = state.length;
        state.push(value);
        return [value, next => { state[index] = next; }];
      },
    },
    '@/meetnola/ipc': {
      getMeetingNotes: async () => ({ notes_json: null, notes_markdown: 'Existing legacy note' }),
      saveMeetingNotes: async args => {
        writes.push(args);
        if (fail) throw new Error('synthetic disk failure');
      },
    },
    sonner: { toast: { error: noop } },
  }, { crypto: { randomUUID: () => 'synthetic-block' }, setTimeout: () => 1 });
  const hook = load('@/hooks/useMeetingNotes').useMeetingNotes('saved-meeting');
  effects[0]();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(state[0][0].content[0].text, 'Existing legacy note');
  hook.saveNotes(blocks);
  await assert.rejects(hook.flushPendingSave(true));
  assert.equal(state[3], true);
  fail = false;
  await hook.flushPendingSave(true);
  assert.equal(state[3], false);
  assert.equal(state[1], false);
  assert.equal(writes.at(-1).notesMarkdown, 'Synthetic recovery note');
});

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
    '@/services/storageService': { storageService: { saveMeeting: async (_title, received, _folder, sourceId) => { assert.equal(sourceId, 'meeting-1'); assert.equal(received.length, 1); saves++; events.push('meeting'); return { meeting_id: 'meeting-a5ce2dc0-f470-485c-b35d-1b2bd0b49059' }; }, getMeeting: async () => ({ id: 'meeting-a5ce2dc0-f470-485c-b35d-1b2bd0b49059', title: 'Synthetic meeting' }) } },
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

test('Meetnola never checks or installs an upstream application update', async () => {
  const unexpected = () => { throw new Error('Upstream updater must not run'); };
  const load = loader({
    '@/flavor': { isMeetnola: true },
    '@tauri-apps/plugin-updater': { check: unexpected },
    '@tauri-apps/plugin-process': { relaunch: unexpected },
    '@tauri-apps/api/app': { getVersion: async () => '0.4.0' },
  });
  const { updateService } = load('@/services/updateService');
  assert.equal((await updateService.checkForUpdates(true)).available, false);
  await assert.rejects(updateService.downloadAndInstall({ download: unexpected, install: unexpected }), /verified fork build/);
});


for (const audioStatus of ['failed', 'partial', 'success']) {
  test(`audio recovery ${audioStatus} preserves retry data unless completely recovered`, async () => {
    const localStorage = storage();
    const events = [];
    const load = loader({
      react: quietReact,
      sonner: { toast: { error: noop, warning: noop } },
      '@tauri-apps/api/core': { invoke: async cmd => {
        events.push(cmd);
        return { status: audioStatus };
      } },
      '@/services/indexedDBService': { indexedDBService: {
        getMeetingMetadata: async () => ({ title: 'Synthetic', folderPath: '/synthetic/checkpoints' }),
        getTranscripts: async () => [{ text: 'Synthetic transcript' }],
        markMeetingSaved: async () => events.push('marked'),
      } },
      '@/services/storageService': { storageService: { saveMeeting: async (_t, _s, _p, sourceId) => {
        assert.equal(sourceId, 'meeting-1'); return { meeting_id: 'meeting-recording-meeting-1' };
      } } },
      '@/lib/summary-language-preferences': { applyPinnedSummaryLanguageToMeeting: async () => {} },
      '@/meetnola/ipc': { saveMeetingNotes: async () => {} },
    }, { localStorage });
    const notes = load('@/lib/liveMeetingNotes');
    notes.writeLiveMeetingNotes('meeting-1', blocks);
    const recovery = load('@/hooks/useTranscriptRecovery').useTranscriptRecovery();
    if (audioStatus === 'success') {
      await recovery.recoverMeeting('meeting-1');
      assert.ok(events.includes('cleanup_checkpoints'));
      assert.ok(events.includes('marked'));
      assert.equal(notes.readLiveMeetingNotes('meeting-1'), null);
    } else {
      await assert.rejects(recovery.recoverMeeting('meeting-1'), /checkpoints were retained/);
      assert.ok(!events.includes('cleanup_checkpoints'));
      assert.ok(!events.includes('marked'));
      assert.notEqual(notes.readLiveMeetingNotes('meeting-1'), null);
    }
  });
}

for (const source of ['notes', 'empty', 'fetch-error']) {
  test(`summary generation handles ${source} without inventing transcript content`, async () => {
    const requests = [];
    const load = loader({
      react: quietReact,
      sonner: { toast: { error: noop, warning: noop, info: noop } },
      '@/components/Sidebar/SidebarProvider': { useSidebar: () => ({ startSummaryPolling: noop }) },
      '@tauri-apps/api/core': { invoke: async (cmd, args) => {
        if (cmd === 'api_get_meeting_transcripts') {
          if (source === 'fetch-error') throw new Error('synthetic unavailable database');
          return { total_count: 0, transcripts: [] };
        }
        if (cmd === 'api_process_transcript') { requests.push(args); return { process_id: 'synthetic' }; }
      } },
      '@/lib/analytics': { default: new Proxy({}, { get: () => async () => {} }), __esModule: true },
      '@/lib/utils': { isOllamaNotInstalledError: () => false },
      '@/lib/summary-language-preferences': { readMeetingSummaryLanguage: async () => ({ language: 'en' }) },
    });
    const hook = load('@/hooks/meeting-details/useSummaryGeneration').useSummaryGeneration({
      meeting: { id: 'synthetic', created_at: new Date().toISOString() }, transcripts: [],
      notesText: source === 'empty' ? '' : 'Synthetic action: check the report.',
      modelConfig: { provider: 'groq', model: 'synthetic', apiKey: 'synthetic' },
      isModelConfigLoading: false, selectedTemplate: 'default', updateMeetingTitle: noop, setAiSummary: noop,
    });
    await hook.handleGenerateSummary('Enhance these notes');
    await hook.handleRegenerateSummary();
    if (source === 'notes') {
      assert.equal(requests.length, 2);
      assert.match(requests[0].text, /Meeting notes \(no transcript available\)/);
      assert.match(requests[0].text, /check the report/);
    } else assert.equal(requests.length, 0);
  });
}
