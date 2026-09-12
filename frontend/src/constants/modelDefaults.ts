/**
 * Default model names for transcription engines.
 * IMPORTANT: Keep in sync with Rust constants in src-tauri/src/config.rs
 * and afterword/defaults.rs (Afterword feature builds).
 */

import { isAfterword } from '@/flavor';

/**
 * Default Whisper model for transcription when no preference is configured.
 * This is the recommended balance of accuracy and speed.
 */
export const DEFAULT_WHISPER_MODEL = 'large-v3-turbo';

/**
 * Default Groq transcription model (Meetily Groq-first / optional cloud STT).
 */
export const DEFAULT_GROQ_TRANSCRIPT_MODEL = 'whisper-large-v3-turbo';

/**
 * Default Groq summary model (Meetily Groq-first).
 */
export const DEFAULT_GROQ_SUMMARY_MODEL = 'openai/gpt-oss-120b';

/**
 * Default Parakeet model for transcription when no preference is configured.
 * This is the quantized version optimized for speed.
 */
export const DEFAULT_PARAKEET_MODEL = 'parakeet-tdt-0.6b-v3-int8';

/**
 * Vercel AI Gateway (OpenAI-compatible) defaults for Afterword summaries/Enhance.
 * Auth: user's Gateway API key via CustomOpenAI config — never NEXT_PUBLIC_*.
 * Model: openai/gpt-5.6-luna — listed on https://ai-gateway.vercel.sh/v1/models
 */
export const AFTERWORD_GATEWAY_ENDPOINT = 'https://ai-gateway.vercel.sh/v1';
export const AFTERWORD_GATEWAY_MODEL = 'openai/gpt-5.6-luna';
export const AFTERWORD_SUMMARY_PROVIDER = 'custom-openai' as const;
export const AFTERWORD_TRANSCRIPT_PROVIDER = 'parakeet' as const;

/**
 * Default providers / models for a fresh install.
 * Afterword: local Parakeet STT + Gateway summaries.
 * Meetily: Groq-first (unchanged).
 */
export const DEFAULT_SUMMARY_PROVIDER = isAfterword
  ? AFTERWORD_SUMMARY_PROVIDER
  : 'groq';

export const DEFAULT_TRANSCRIPT_PROVIDER = isAfterword
  ? AFTERWORD_TRANSCRIPT_PROVIDER
  : 'groq';

export const DEFAULT_SUMMARY_MODEL = isAfterword
  ? AFTERWORD_GATEWAY_MODEL
  : DEFAULT_GROQ_SUMMARY_MODEL;

export const DEFAULT_TRANSCRIPT_MODEL = isAfterword
  ? DEFAULT_PARAKEET_MODEL
  : DEFAULT_GROQ_TRANSCRIPT_MODEL;

/**
 * Model defaults by provider type
 */
export const MODEL_DEFAULTS = {
  whisper: DEFAULT_WHISPER_MODEL,
  localWhisper: DEFAULT_WHISPER_MODEL,
  parakeet: DEFAULT_PARAKEET_MODEL,
  groq: DEFAULT_GROQ_TRANSCRIPT_MODEL,
} as const;
