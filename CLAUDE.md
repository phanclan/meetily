# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Meetily** is a privacy-first AI meeting assistant that captures, transcribes, and summarizes meetings entirely on local infrastructure. The supported application is the Tauri desktop app with a Rust core.

1. **Frontend**: Tauri-based desktop application (Rust + Next.js + TypeScript)
2. **Rust Backend**: Tauri commands, audio capture, transcription, storage, and summarization orchestration
3. **Legacy Backend Archive**: the old Python/FastAPI, Docker, and standalone whisper-server backend under `backend/` is archived and unsupported

### Key Technology Stack
- **Desktop App**: Tauri 2.x (Rust) + Next.js 14 + React 18
- **Audio Processing**: Rust (cpal, whisper-rs, professional audio mixing)
- **Transcription**: Whisper.cpp / whisper-rs and Parakeet paths in the Tauri app
- **App API Surface**: Tauri commands and events, not a separate FastAPI service
- **LLM Integration**: Ollama (local), Claude, Groq, OpenRouter

## Essential Development Commands

### Frontend Development (Tauri Desktop App)

**Location**: `/frontend`

```bash
# macOS Development
./clean_run.sh              # Clean build and run with info logging
./clean_run.sh debug        # Run with debug logging
./clean_build.sh            # Production build

# Windows Development
clean_run_windows.bat       # Clean build and run
clean_build_windows.bat     # Production build

# Manual Commands
pnpm install                # Install dependencies
pnpm run dev                # Next.js dev server (port 3118)
pnpm run tauri:dev          # Full Tauri development mode
pnpm run tauri:build        # Production build

# GPU-Specific Builds (for testing acceleration)
pnpm run tauri:dev:metal    # macOS Metal GPU
pnpm run tauri:dev:cuda     # NVIDIA CUDA
pnpm run tauri:dev:vulkan   # AMD/Intel Vulkan
pnpm run tauri:dev:cpu      # CPU-only (no GPU)
```

### Legacy Backend Archive

**Location**: `/backend`

The Python/FastAPI backend, Docker setup, and standalone whisper-server scripts are archived for historical reference and migration context only. Do not use them for current development, new installs, production deployments, or issue triage for the supported app.

The archived FastAPI service had unauthenticated, development-oriented CORS behavior. Treat that behavior as obsolete legacy context, not as a supported production API.

### Service Endpoints
- **Frontend Dev**: http://localhost:3118

## High-Level Architecture

### Tauri Desktop Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Frontend (Tauri Desktop App)                  │
│  ┌──────────────────┐  ┌─────────────────┐  ┌────────────────┐ │
│  │   Next.js UI     │  │  Rust Backend   │  │ Whisper Engine │ │
│  │  (React/TS)      │←→│  (Audio + IPC)  │←→│  (Local STT)   │ │
│  └──────────────────┘  └─────────────────┘  └────────────────┘ │
│         ↑ Tauri Events           ↑ Audio Pipeline               │
└─────────────────────────────────────────────────────────────────┘
```

The current app does not require a separate FastAPI tier. Meeting persistence, local transcription, and summary orchestration are handled through the Rust/Tauri core.

### Current Architecture Source of Truth

For the current packaged-app behavior and critical runtime boundaries, prefer:

- [docs/architecture-current-state.md](docs/architecture-current-state.md)

Use that document when reasoning about:

- which runtime is authoritative for a feature
- current startup / onboarding behavior
- recording -> transcript -> save flow
- summary generation flow
- homepage AI context flow

The older high-level architecture sections in this file are still useful orientation, but
`docs/architecture-current-state.md` should be treated as the practical source of truth for
how the app works today.

### Audio Processing Pipeline (Critical Understanding)

The audio system has **two parallel paths** with different purposes:

```
Raw Audio (Mic + System)
         ↓
┌────────────────────────────────────────────────────────────┐
│              Audio Pipeline Manager                         │
│  (frontend/src-tauri/src/audio/pipeline.rs)                │
└─────────────┬──────────────────────────┬───────────────────┘
              ↓                          ↓
    ┌─────────────────┐        ┌─────────────────────┐
    │ Recording Path  │        │ Transcription Path  │
    │ (Pre-mixed)     │        │ (VAD-filtered)      │
    └─────────────────┘        └─────────────────────┘
              ↓                          ↓
    RecordingSaver.save()      WhisperEngine.transcribe()
```

**Key Insight**: The pipeline performs **professional audio mixing** (RMS-based ducking, clipping prevention) for recording, while simultaneously applying **Voice Activity Detection (VAD)** to send only speech segments to Whisper for transcription.

### Audio Device Modularization (Recently Completed)

**Context**: The audio system was refactored from a monolithic 1028-line `core.rs` file into focused modules. See [AUDIO_MODULARIZATION_PLAN.md](AUDIO_MODULARIZATION_PLAN.md) for details.

```
audio/
├── devices/                    # Device discovery and configuration
│   ├── discovery.rs           # list_audio_devices, trigger_audio_permission
│   ├── microphone.rs          # default_input_device
│   ├── speakers.rs            # default_output_device
│   ├── configuration.rs       # AudioDevice types, parsing
│   └── platform/              # Platform-specific implementations
│       ├── windows.rs         # WASAPI logic (~200 lines)
│       ├── macos.rs           # ScreenCaptureKit logic
│       └── linux.rs           # ALSA/PulseAudio logic
├── capture/                   # Audio stream capture
│   ├── microphone.rs          # Microphone capture stream
│   ├── system.rs              # System audio capture stream
│   └── core_audio.rs          # macOS ScreenCaptureKit integration
├── pipeline.rs                # Audio mixing and VAD processing
├── recording_manager.rs       # High-level recording coordination
├── recording_commands.rs      # Tauri command interface
└── recording_saver.rs         # Audio file writing
```

**When working on audio features**:
- Device detection issues → `devices/discovery.rs` or `devices/platform/{windows,macos,linux}.rs`
- Microphone/speaker problems → `devices/microphone.rs` or `devices/speakers.rs`
- Audio capture issues → `capture/microphone.rs` or `capture/system.rs`
- Mixing/processing problems → `pipeline.rs`
- Recording workflow → `recording_manager.rs`

### Rust ↔ Frontend Communication (Tauri Architecture)

**Command Pattern** (Frontend → Rust):
```typescript
// Frontend: src/app/page.tsx
await invoke('start_recording', {
  mic_device_name: "Built-in Microphone",
  system_device_name: "BlackHole 2ch",
  meeting_name: "Team Standup"
});
```

```rust
// Rust: src/lib.rs
#[tauri::command]
async fn start_recording<R: Runtime>(
    app: AppHandle<R>,
    mic_device_name: Option<String>,
    system_device_name: Option<String>,
    meeting_name: Option<String>
) -> Result<(), String> {
    // Implementation delegates to audio::recording_commands
}
```

**Event Pattern** (Rust → Frontend):
```rust
// Rust: Emit transcript updates
app.emit("transcript-update", TranscriptUpdate {
    text: "Hello world".to_string(),
    timestamp: chrono::Utc::now(),
    // ...
})?;
```

```typescript
// Frontend: Listen for events
await listen<TranscriptUpdate>('transcript-update', (event) => {
  setTranscripts(prev => [...prev, event.payload]);
});
```

### Whisper Model Management

**Model Storage Locations**:
- **Development**: `frontend/models/`
- **Production (macOS)**: `~/Library/Application Support/Meetily/models/`
- **Production (Windows)**: `%APPDATA%\Meetily\models\`

**Model Loading** (frontend/src-tauri/src/whisper_engine/whisper_engine.rs):
```rust
pub async fn load_model(&self, model_name: &str) -> Result<()> {
    // Automatically detects GPU capabilities (Metal/CUDA/Vulkan)
    // Falls back to CPU if GPU unavailable
}
```

**GPU Acceleration**:
- **macOS**: Metal + CoreML (automatically enabled)
- **Windows/Linux**: CUDA (NVIDIA), Vulkan (AMD/Intel), or CPU
- Configure via Cargo features: `--features cuda`, `--features vulkan`

## Critical Development Patterns

### 1. Audio Buffer Management

**Ring Buffer Mixing** (pipeline.rs):
- Mic and system audio arrive asynchronously at different rates
- Ring buffer accumulates samples until both streams have aligned windows (50ms)
- Professional mixing applies RMS-based ducking to prevent system audio from drowning out microphone
- Uses `VecDeque` for efficient windowed processing

### 2. Thread Safety and Async Boundaries

**Recording State** (recording_state.rs):
```rust
pub struct RecordingState {
    is_recording: Arc<AtomicBool>,
    audio_sender: Arc<RwLock<Option<mpsc::UnboundedSender<AudioChunk>>>>,
    // ...
}
```

**Key Pattern**: Use `Arc<RwLock<T>>` for shared state across async tasks, `Arc<AtomicBool>` for simple flags.

### 3. Error Handling and Logging

**Performance-Aware Logging** (lib.rs):
```rust
#[cfg(debug_assertions)]
macro_rules! perf_debug {
    ($($arg:tt)*) => { log::debug!($($arg)*) };
}

#[cfg(not(debug_assertions))]
macro_rules! perf_debug {
    ($($arg:tt)*) => {};  // Zero overhead in release builds
}
```

**Usage**: Use `perf_debug!()` and `perf_trace!()` for hot-path logging that should be eliminated in production.

### 4. Frontend State Management

**Sidebar Context** (components/Sidebar/SidebarProvider.tsx):
- Global state for meetings list, current meeting, recording status
- Communicates with the Rust/Tauri core through Tauri commands and events
- Keeps React state synchronized with native recording, meeting, transcript, and summary state

**Pattern**: Tauri commands update Rust state → Emit events → Frontend listeners update React state → Context propagates to components

## Common Development Tasks

### Adding a New Audio Device Platform

1. Create platform file: `audio/devices/platform/{platform_name}.rs`
2. Implement device enumeration for the platform
3. Add platform-specific configuration in `audio/devices/configuration.rs`
4. Update `audio/devices/platform/mod.rs` to export new platform functions
5. Test with `cargo check` and platform-specific device tests

### Adding a New Tauri Command

1. Define command in `src/lib.rs`:
   ```rust
   #[tauri::command]
   async fn my_command(arg: String) -> Result<String, String> { /* ... */ }
   ```
2. Register in `tauri::Builder`:
   ```rust
   .invoke_handler(tauri::generate_handler![
       start_recording,
       my_command,  // Add here
   ])
   ```
3. Call from frontend:
   ```typescript
   const result = await invoke<string>('my_command', { arg: 'value' });
   ```

### Modifying Audio Pipeline Behavior

**Location**: `frontend/src-tauri/src/audio/pipeline.rs`

Key components:
- `AudioMixerRingBuffer`: Manages mic + system audio synchronization
- `ProfessionalAudioMixer`: RMS-based ducking and mixing
- `AudioPipelineManager`: Orchestrates VAD, mixing, and distribution

**Testing Audio Changes**:
```bash
# Enable verbose audio logging
RUST_LOG=app_lib::audio=debug ./clean_run.sh

# Monitor audio metrics in real-time
# Check Developer Console in the app (Cmd+Shift+I on macOS)
```

### Tauri Backend Development

Current app behavior should be implemented in the Rust/Tauri core, not in the archived Python backend. Add new frontend-facing behavior through Tauri commands/events and existing Rust services under `frontend/src-tauri/src`.

Do not add new endpoints to `backend/app/main.py`; that FastAPI code is legacy archive material only.

## Testing and Debugging

### Frontend Debugging

**Enable Rust Logging**:
```bash
# macOS
RUST_LOG=debug ./clean_run.sh

# Windows (PowerShell)
$env:RUST_LOG="debug"; ./clean_run_windows.bat
```

**Developer Tools**:
- Open DevTools: `Cmd+Shift+I` (macOS) or `Ctrl+Shift+I` (Windows)
- Console Toggle: Built into app UI (console icon)
- View Rust logs: Check terminal output

### Audio Pipeline Debugging

**Key Metrics** (emitted by pipeline):
- Buffer sizes (mic/system)
- Mixing window count
- VAD detection rate
- Dropped chunk warnings

**Monitor via Developer Console**: The app includes real-time metrics display when recording.

## Platform-Specific Notes

### macOS
- **Audio Capture**: Uses ScreenCaptureKit for system audio (macOS 13+)
- **GPU**: Metal + CoreML automatically enabled
- **Permissions**: Requires microphone + screen recording permissions
- **System Audio**: Requires virtual audio device (BlackHole) for system capture

### Windows
- **Audio Capture**: Uses WASAPI (Windows Audio Session API)
- **GPU**: CUDA (NVIDIA) or Vulkan (AMD/Intel) via Cargo features
- **Build Tools**: Requires Visual Studio Build Tools with C++ workload
- **System Audio**: Uses WASAPI loopback for system capture

### Linux
- **Audio Capture**: ALSA/PulseAudio
- **GPU**: CUDA (NVIDIA) or Vulkan via Cargo features
- **Dependencies**: Requires cmake, llvm, libomp

## Performance Optimization Guidelines

### Audio Processing
- Use `perf_debug!()` / `perf_trace!()` for hot-path logging (zero cost in release)
- Batch audio metrics using `AudioMetricsBatcher` (pipeline.rs)
- Pre-allocate buffers with `AudioBufferPool` (buffer_pool.rs)
- VAD filtering reduces Whisper load by ~70% (only processes speech)

### Whisper Transcription
- **Model Selection**: Balance accuracy vs speed
  - Development: `base` or `small` (fast iteration)
  - Production: `medium` or `large-v3` (best quality)
- **GPU Acceleration**: 5-10x faster than CPU
- **Parallel Processing**: Available in `whisper_engine/parallel_processor.rs` for batch workloads

### Frontend Performance
- React state updates batched via Sidebar context
- Transcript rendering virtualized for large meetings
- Audio level monitoring throttled to 60fps

## Important Constraints and Gotchas

1. **Audio Chunk Size**: Pipeline expects consistent 48kHz sample rate. Resampling happens at capture time.

2. **Platform Audio Quirks**:
   - macOS: ScreenCaptureKit requires macOS 13+, needs screen recording permission
   - Windows: WASAPI exclusive mode can conflict with other apps
   - System audio requires virtual device (BlackHole on macOS, WASAPI loopback on Windows)

3. **Whisper Model Loading**: Models are loaded once and cached. Changing models requires app restart or manual unload/reload.

4. **No Separate Backend Dependency**: Meeting persistence, transcription, and LLM features are handled by the Tauri app. Do not reintroduce the archived FastAPI backend as a supported requirement.

5. **Legacy FastAPI Security Context**: The archived FastAPI/CORS behavior is unsupported legacy code and must not be treated as a supported production API.

6. **File Paths**: Use Tauri's path APIs (`downloadDir`, etc.) for cross-platform compatibility. Never hardcode paths.

7. **Audio Permissions**: Request permissions early. macOS requires both microphone AND screen recording for system audio.

17. **BlockNote CSS overrides must be outside `@layer`**: `@blocknote/shadcn/style.css` is unlayered CSS. Any overrides placed inside `@layer base` in `globals.css` will silently lose to BlockNote's rules — even with `!important`. This is per the CSS cascade spec: unlayered styles always beat `@layer` styles. All BlockNote overrides live after the `@layer base` closing brace in `globals.css`. If you add new BlockNote CSS overrides, place them there.

18. **Native title bar with warm tint**: `backgroundColor: [246, 242, 234, 255]` (`#f6f2ea`) in `tauri.conf.json` tints the native macOS title bar. Custom title bar (`titleBarStyle: "Overlay"`) was tried but reverted — drag didn't work reliably when the app had focus.

## Repository-Specific Conventions

- **Logging Format**: Rust logs should include enough module context to diagnose app behavior
- **Error Handling**: Rust uses `anyhow::Result`, frontend uses try-catch with user-friendly messages
- **Naming**: Audio devices use "microphone" and "system" consistently (not "input"/"output")
- **Git Branches**:
  - `main`: Stable releases
  - `fix/*`: Bug fixes
  - `enhance/*`: Feature enhancements
  - Current: `fix/audio-mixing` (working on audio pipeline improvements)

## Key Files Reference

**Core Coordination**:
- [frontend/src-tauri/src/lib.rs](frontend/src-tauri/src/lib.rs) - Main Tauri entry point, command registration
- [frontend/src-tauri/src/audio/mod.rs](frontend/src-tauri/src/audio/mod.rs) - Audio module exports
- [frontend/src-tauri/src/database/mod.rs](frontend/src-tauri/src/database/mod.rs) - Local database module

**Audio System**:
- [frontend/src-tauri/src/audio/recording_manager.rs](frontend/src-tauri/src/audio/recording_manager.rs) - Recording orchestration
- [frontend/src-tauri/src/audio/pipeline.rs](frontend/src-tauri/src/audio/pipeline.rs) - Audio mixing and VAD
- [frontend/src-tauri/src/audio/recording_saver.rs](frontend/src-tauri/src/audio/recording_saver.rs) - Audio file writing

**UI Components**:
- [frontend/src/app/page.tsx](frontend/src/app/page.tsx) - Main recording interface
- [frontend/src/components/Sidebar/SidebarProvider.tsx](frontend/src/components/Sidebar/SidebarProvider.tsx) - Global state management

**Whisper Integration**:
- [frontend/src-tauri/src/whisper_engine/whisper_engine.rs](frontend/src-tauri/src/whisper_engine/whisper_engine.rs) - Whisper model management and transcription


## Meetnola fork notes

Meetnola is this fork's tester/product flavor of Meetily.

- Stock app data (Meetily): `~/Library/Application Support/com.meetily.ai/`
- Tester app data (Meetnola): `~/Library/Application Support/com.meetnola.tester/`
- Tester bundle id: `com.meetnola.tester`
- Packaged tester: prefer `frontend/build-meetnola.sh` / `meetnola Tester.app` for macOS system-audio permission testing (`tauri dev` is not trustworthy for TCC)
- WIP handoffs live under `docs/wip/` (see `handoff-meetnola-current-state.md`)

### Recording / UI stability debugging

When the app shows an error and then all buttons stop working, treat it as a frontend state deadlock first, not a native crash.

Primary log locations:
- `frontend/logs/clean-run-*.log` — combined Next.js + Tauri dev logs from `clean_run.sh`
- `~/Library/Application Support/com.meetnola.tester/logs/frontend-runtime.log` — tester frontend runtime logs
- `~/Library/Application Support/com.meetily.ai/logs/frontend-runtime.log` — stock Meetily runtime logs

Check these first:
- Whether backend recording is still active via `get_recording_state` / `is_recording`
- Whether frontend `RecordingStatus` is stuck in `starting`, `stopping`, `processing`, `saving`, or `error`
- Whether a full-screen modal/overlay is still mounted and intercepting clicks
- Whether the stop result was `status: "complete"` or `status: "partial"`

Stop-flow contract:
- Rust `stop_recording` returns `status`, `reason`, `chunks_remaining`, and `message`
- Rust emits `recording-stop-result` and `recording-stopped`
- Tray-driven stop emits `recording-stop-complete`
- Frontend must only save meetings when stop result is `status === "complete"`
- Partial/error stop paths should do cleanup and UI recovery, not continue waiting for save

### Browser Testing Mode (Next.js without Tauri)

Run the UI in a regular browser without building the Tauri desktop app:

```bash
cd frontend
BROWSER_TESTING=1 pnpm run dev   # http://localhost:3118
```

When `BROWSER_TESTING=1`, webpack aliases redirect all `@tauri-apps/api/*` imports to
mock shims in `frontend/src/lib/tauri-shim/`. Edit `core.ts` in that directory to add
or modify mock responses for `invoke()` calls during browser development.

> **WARNING — `BROWSER_TESTING=1` in `.env.local`**: If `frontend/.env.local` contains
> `BROWSER_TESTING=1`, the shim is active even when running the real Tauri app. All
> `invoke()` calls will hit mock functions instead of Rust — no data will be written to
> SQLite. **Always clear this file before running the Tauri app**:
> ```bash
> echo "" > frontend/.env.local
> ```

### Debugging the Tauri App (with log capture)

The recommended way to run the app when debugging, especially for Rust-side issues:

```bash
cd frontend
MEETILY_AUTOMATION=1 RUST_LOG=debug ./clean_run.sh 2>&1 | tee /tmp/meetily-dev.log
```

- `2>&1 | tee` captures both stdout and stderr (Rust logs) to a file you can inspect
- `MEETILY_AUTOMATION=1` starts the automation HTTP server on port 21734 (see below)
- `RUST_LOG=debug` is now respected — the hardcoded `LevelFilter::Info` clamp was removed
- `clean_run.sh` now **pre-warms Next.js** before starting Tauri: it starts `pnpm dev`, polls `localhost:3118` until the home page compiles (~6s), kills it, then starts Tauri. This prevents the ChunkLoadError on first webview load caused by on-demand compilation timing.
- Use `--no-clean` only when iterating quickly and you have NOT changed `layout.tsx` or other Next.js files. After any layout change, delete `.next/` first or run without `--no-clean`.

**Logging Phase 1 (implemented)** — frontend console output now appears in the terminal:
- All `console.log/warn/error` calls in React components are forwarded to Rust via `append_frontend_log` (buffered, flushed every 250ms)
- These appear in terminal as `INFO app_lib::frontend_logging [frontend] <message>`
- DB-layer transcript config reads/writes log at `info` level — look for `[settings]` prefix
- `frontend-runtime.log` is also written to `~/Library/Application Support/com.meetily.ai/logs/`
- **The console bridge is development-only.** It costs one IPC round-trip per log line, and the transcript path logs several times per segment. In a packaged (production) build it is off unless a tester opts in from DevTools: `localStorage.setItem('meetily:console-bridge', '1')` then reload. Uncaught errors and unhandled rejections are always logged, bridge or not.

### Meetnola Tester Build (Preferred for macOS audio / peer testing)

Use the packaged tester app when validating macOS permissions, startup behavior, or peer-ready flows:

```bash
cd frontend
./build-meetnola.sh
open -n '../target/release/bundle/macos/meetnola Tester.app'
```

Important paths:
- Packaged app: `target/release/bundle/macos/meetnola Tester.app`
- Bundle id: `com.meetnola.tester`
- Tester app data: `~/Library/Application Support/com.meetnola.tester/`
- Tester DB: `~/Library/Application Support/com.meetnola.tester/meeting_minutes.sqlite`

Why this matters:
- `tauri dev` is not reliable for macOS TCC / System Audio Recording permission validation
- The packaged bundle identity is what macOS actually grants permissions to
- Use the packaged tester app for system audio capture checks and peer-test validation

Tester builds also expose a visible build badge in the UI. Use it to confirm the running app is the expected bundle/build before comparing screenshots or behavior.

Operational note:
- The `.app` bundle is currently the peer-test artifact; the `.dmg` step still fails in this branch.
- `docs/meetnola-tester-readme.md` is the current setup/troubleshooting guide for testers.
- `frontend/build-gpu.sh` now normalizes executable bits on `*.app/Contents/MacOS/*` after build so the packaged bundle is less fragile if DMG bundling fails later.

### Automation HTTP API (Testing & Scripting)

An opt-in HTTP API for programmatic testing, bound to `127.0.0.1:21734` only.
Enable by setting `MEETILY_AUTOMATION=1` before launching the app.

**Endpoints**:
- `GET  /health` — returns `{"status":"ok","version":"..."}`
- `GET  /v1/config/transcript` — returns current provider/model/apiKey from DB
- `PUT  /v1/config/transcript` — writes provider/model/apiKey to DB (requires Bearer token)

**Token**: printed to stderr on startup. Override with `MEETILY_AUTOMATION_TOKEN=mytoken`.

**Test scripts** (in `scripts/`):
```bash
# Direct SQLite inspection (no app needed)
./scripts/test-transcript-config.sh read
./scripts/test-transcript-config.sh write groq whisper-large-v3-turbo gsk_yourkey
./scripts/test-transcript-config.sh reset
./scripts/test-transcript-config.sh test-groq   # full write/verify/restore cycle

# End-to-end HTTP API test (app must be running with MEETILY_AUTOMATION=1)
MEETILY_AUTOMATION_TOKEN=<token-from-stderr> ./scripts/test-automation-api.sh
```
