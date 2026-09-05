# Meetnola maintenance

Decision: 2026-09-05. Meetnola is maintained as an independent product fork with selective upstream adoption.

## Branch policy

- `origin` is the personal fork. `upstream` is the original Meetily repository.
- Develop features from the fork's `main`, using committed branches and separate worktrees.
- Do not routinely rebase the product branch onto upstream releases. Stashes are temporary conveniences, not release handoffs.
- Review upstream security, platform, audio, and transcription fixes. Adopt product/UI changes only when wanted.
- Integrate selected changes on a branch. Use `git cherry-pick -x` for self-contained commits; port changes explicitly when their dependencies do not fit. Preserve source attribution and existing license notices.
- Promote a branch only after the checks below pass. Publishing/pushing is a separate operation.

## Supported baseline

The Tauri app and Rust core remain authoritative. Meetnola's plugin owns notes, live queries, and product extensions. The archived Python backend is not part of this baseline.

Transcription uses local Parakeet or Whisper. Cloud transcription is unavailable in this recovery baseline; the Meetnola selector disables Groq and explains the limitation for existing cloud configurations. Stored credentials are retained. Summary providers remain separate from transcription; their live network behavior is not established by an offline recording test.

Live notes are stored locally under the temporary IndexedDB recording ID (`meeting-<timestamp>`). The shared stop handler saves them to SQLite under the persisted meeting ID (`meeting-<UUID>`) before marking the recording saved. Interrupted recordings retain their draft for the existing recovery flow. Saved-note edits use the native notes API.

## Validation before promotion

From `frontend`:

```sh
npm run typecheck
npm run test:recording
npm run test:markdown
node --test tests/lib/onboarding-summary-model.test.mjs
NEXT_PUBLIC_FLAVOR=meetnola npm run build
```

From the repository root:

```sh
cargo check --offline -p meetily --features meetnola
git diff --check
```

Use a packaged tester for macOS audio validation. The release bundle can be built with `frontend/build-meetnola.sh`; when only an app is needed, pass `--bundles app` to the Tauri build command. Do not launch a dev instance and packaged tester with the same bundle ID simultaneously.

Verify **New note** starts recording, synthetic speech produces a transcript, notes/title/transcript survive leaving the workspace, **Stop** saves once, and reopening shows the saved content. Edit the saved note and reopen again. Repeat a recording to catch stale session state. Check the visible build badge against the intended build.
