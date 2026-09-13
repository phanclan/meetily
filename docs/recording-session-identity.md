# RecordingSession identity contract

Capture, live notes, SQLite, chat, and the meeting title historically shared one
conflated `currentMeetingId`. Starting or resuming capture allocates a **new**
live id (`meeting-<timestamp>`). If notes remount onto that new id, they read
empty `localStorage` and typed notes are lost.

This contract keeps those identities distinct. `RecordingStateContext` remains
the capture lifecycle SSOT. Transcript sequence dedupe (`transcriptSequence.ts`)
is unchanged: resume still starts a new `sequence_scope`.

## IDs

| ID | Owner | Storage | Lifetime |
| --- | --- | --- | --- |
| `liveSessionId` | `TranscriptContext` (capture / IndexedDB recovery) | React state + `indexeddb_current_meeting_id` | One native start, including each resume generation |
| `persistedMeetingId` | SQLite (`meeting-*` UUID / `meeting-recording-*`) | DB + `/recording?saved=` (Afterword) | After the first successful save |
| `notesOwnerId` | `useMeetingNotes` | live: `meetnola.live-notes.<id>`; saved: SQLite | Must **not** change across resume/append |
| `appendTargetMeetingId` | Resume/append | `resume_meeting_id` | From Resume until that generation is saved |

Helpers live in `frontend/src/lib/recordingSessionIdentity.ts`.

`currentMeetingId` in `TranscriptContext` **is** `liveSessionId`. It is not
`notesOwnerId`. Call sites that persist notes must pass `notesOwnerId`.

## Rules

1. **New capture** — `liveSessionId = meeting-<now>`, `persistedMeetingId = null`,
   `notesOwnerId = liveSessionId`. Live notes key off the capture id.
2. **First save** — SQLite creates `persistedMeetingId`. Live notes are copied
   onto that row, then the live id is cleared. Afterword stays on
   `/recording?saved=<persistedMeetingId>`.
3. **Resume / append** — Keep `persistedMeetingId`. Allocate a **new**
   `liveSessionId` for the new capture generation (IndexedDB + sequence scope).
   Set `appendTargetMeetingId = persistedMeetingId` **before** native start.
   `notesOwnerId` stays the persisted id. Do not remount the editor onto the
   new live id.
4. **New recording from a saved note** — Clear resume identity first, then
   treat as rule 1.

`resolveNotesOwnerId()` encodes rules 1–3: append target wins; if a saved
meeting is open and a different live id appears, notes stay on the saved id.

## Resume checklist

- `writeResumeIdentity(persistedMeetingId, baselineCount)` before
  `request_recording_start`
- `beginResumeTranscriptSession()` for sequence-scope dedupe
- `useMeetingNotes(notesOwnerId)` — never `currentMeetingId` when those differ
- Stop appends new transcript segments to `appendTargetMeetingId` / `resume_meeting_id`

## Out of scope

Layout providers (`RecordingStateProvider`, `TranscriptProvider`) are not
rewritten here. Chat still stages against `liveSessionId` and is promoted onto
the saved meeting at persist time.
