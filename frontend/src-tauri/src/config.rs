/// Application configuration constants
///
/// Centralized definitions for default models and settings.
/// Used across database initialization, import, and retranscription.
///
/// Meetnola feature builds flip summary → Vercel AI Gateway (`custom-openai`)
/// and live transcription → local Parakeet. See `meetnola::defaults`.

/// Default Whisper model for transcription when no preference is configured.
/// This is the recommended balance of accuracy and speed.
pub const DEFAULT_WHISPER_MODEL: &str = "large-v3-turbo";

/// Default Groq transcription model (Meetily Groq-first path / optional cloud STT).
pub const DEFAULT_GROQ_TRANSCRIPT_MODEL: &str = "whisper-large-v3-turbo";

/// Default Groq summary model (Meetily Groq-first path).
pub const DEFAULT_GROQ_SUMMARY_MODEL: &str = "openai/gpt-oss-120b";

/// Default Parakeet model for transcription when no preference is configured.
/// This is the quantized version optimized for speed.
pub const DEFAULT_PARAKEET_MODEL: &str = "parakeet-tdt-0.6b-v3-int8";

/// Default summary provider for a fresh install.
#[cfg(feature = "meetnola")]
pub const DEFAULT_SUMMARY_PROVIDER: &str = "custom-openai";
#[cfg(not(feature = "meetnola"))]
pub const DEFAULT_SUMMARY_PROVIDER: &str = "groq";

/// Default live-transcription provider for a fresh install.
#[cfg(feature = "meetnola")]
pub const DEFAULT_TRANSCRIPT_PROVIDER: &str = "parakeet";
#[cfg(not(feature = "meetnola"))]
pub const DEFAULT_TRANSCRIPT_PROVIDER: &str = "groq";

/// Default summary model id for a fresh install.
#[cfg(feature = "meetnola")]
pub const DEFAULT_SUMMARY_MODEL: &str = "openai/gpt-4o-mini";
#[cfg(not(feature = "meetnola"))]
pub const DEFAULT_SUMMARY_MODEL: &str = DEFAULT_GROQ_SUMMARY_MODEL;

/// Default live-transcription model id for a fresh install.
#[cfg(feature = "meetnola")]
pub const DEFAULT_TRANSCRIPT_MODEL: &str = DEFAULT_PARAKEET_MODEL;
#[cfg(not(feature = "meetnola"))]
pub const DEFAULT_TRANSCRIPT_MODEL: &str = DEFAULT_GROQ_TRANSCRIPT_MODEL;

/// Whisper model catalog with metadata for all supported models.
/// Used by both WhisperEngine::discover_models() and discover_models_standalone().
///
/// Format: (name, filename, size_mb, accuracy, speed, description)
pub const WHISPER_MODEL_CATALOG: &[(&str, &str, u32, &str, &str, &str)] = &[
    // Standard f16 models (full precision)
    ("tiny", "ggml-tiny.bin", 74, "Decent", "Very Fast", "Fastest processing, good for real-time use"),
    ("base", "ggml-base.bin", 142, "Good", "Fast", "Good balance of speed and accuracy"),
    ("small", "ggml-small.bin", 466, "Good", "Medium", "Better accuracy, moderate speed"),
    ("medium", "ggml-medium.bin", 1463, "High", "Slow", "High accuracy for professional use"),
    ("large-v3-turbo", "ggml-large-v3-turbo.bin", 1549, "High", "Medium", "Best accuracy with improved speed"),
    ("large-v3", "ggml-large-v3.bin", 2951, "High", "Slow", "Most Accurate, latest large model"),

    // Q5_1 quantized models (balanced speed/accuracy, slightly better quality than Q5_0)
    ("tiny-q5_1", "ggml-tiny-q5_1.bin", 31, "Decent", "Very Fast", "Quantized tiny model, ~50% faster processing"),
    ("base-q5_1", "ggml-base-q5_1.bin", 57, "Good", "Fast", "Quantized base model, good speed/accuracy balance"),
    ("small-q5_1", "ggml-small-q5_1.bin", 181, "Good", "Fast", "Quantized small model, faster than f16 version"),

    // Q5_0 quantized models (balanced speed/accuracy)
    ("medium-q5_0", "ggml-medium-q5_0.bin", 514, "High", "Medium", "Quantized medium model, professional quality"),
    ("large-v3-turbo-q5_0", "ggml-large-v3-turbo-q5_0.bin", 547, "High", "Medium", "Quantized large model, best balance"),
    ("large-v3-q5_0", "ggml-large-v3-q5_0.bin", 1031, "High", "Slow", "Quantized large model, high accuracy"),
];
