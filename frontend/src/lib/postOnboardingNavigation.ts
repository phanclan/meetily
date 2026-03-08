'use client';

import { invoke } from '@tauri-apps/api/core';

const HOME_ROUTE = '/';
const GROQ_SETUP_ROUTE = '/settings?tab=Transcriptionmodels&onboarding=groq-key';

type ProviderConfig = {
  provider?: string | null;
};

function normalizeProvider(config: ProviderConfig | null): string | null {
  return typeof config?.provider === 'string' ? config.provider : null;
}

export async function getPostOnboardingRoute(): Promise<string> {
  try {
    const [summaryConfig, transcriptConfig, groqApiKey] = await Promise.all([
      invoke<ProviderConfig | null>('api_get_model_config').catch(() => null),
      invoke<ProviderConfig | null>('api_get_transcript_config').catch(() => null),
      invoke<string | null>('api_get_api_key', { provider: 'groq' }).catch(() => null),
    ]);

    const usesGroq =
      normalizeProvider(summaryConfig) === 'groq' ||
      normalizeProvider(transcriptConfig) === 'groq';

    if (usesGroq && !groqApiKey?.trim()) {
      return GROQ_SETUP_ROUTE;
    }

    return HOME_ROUTE;
  } catch {
    // Safe fallback for first-launch issues: land on the Groq setup screen.
    return GROQ_SETUP_ROUTE;
  }
}
