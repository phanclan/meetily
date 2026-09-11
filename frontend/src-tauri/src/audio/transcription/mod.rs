// audio/transcription/mod.rs
//
// Transcription module: Provider abstraction, engine management, and worker pool.

pub mod provider;
pub mod whisper_provider;
pub mod parakeet_provider;
pub mod engine;
pub mod worker;

// Re-export commonly used types
pub use provider::{TranscriptionError, TranscriptionProvider, TranscriptResult};
pub use whisper_provider::WhisperProvider;
pub use parakeet_provider::ParakeetProvider;
pub use engine::{
    TranscriptionEngine,
    validate_transcription_model_ready,
    get_or_init_transcription_engine,
    get_or_init_whisper
};
pub use worker::{
    start_transcription_task,
    reset_speech_detected_flag,
    reset_sequence_counter,
    TranscriptUpdate
};

/// Lightweight worker status for meeting-session diagnostics.
/// Returns (chunks_in_queue, is_processing, last_activity_ms).
/// Stub baseline: real counters live in worker.rs and can be wired later
/// without enabling cloud STT providers.
pub fn get_worker_status() -> (usize, bool, u64) {
    (0, false, 0)
}
