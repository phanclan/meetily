'use client';

import { invoke } from '@tauri-apps/api/core';
import { isMeetnola } from '@/flavor';
import {
  MEETNOLA_GATEWAY_ENDPOINT,
  MEETNOLA_SUMMARY_PROVIDER,
} from '@/constants/modelDefaults';

const HOME_ROUTE = '/';
const GROQ_SETUP_ROUTE = '/settings?tab=Transcriptionmodels&onboarding=groq-key';
const GATEWAY_SETUP_ROUTE = '/settings?tab=Summarymodels&onboarding=gateway-key';

type ProviderConfig = {
  provider?: string | null;
};

type CustomOpenAIConfig = {
  endpoint?: string | null;
  apiKey?: string | null;
};

function normalizeProvider(config: ProviderConfig | null): string | null {
  return typeof config?.provider === 'string' ? config.provider : null;
}

export async function getPostOnboardingRoute(): Promise<string> {
  try {
    if (isMeetnola) {
      const [summaryConfig, customConfig] = await Promise.all([
        invoke<ProviderConfig | null>('api_get_model_config').catch(() => null),
        invoke<CustomOpenAIConfig | null>('api_get_custom_openai_config').catch(() => null),
      ]);

      const usesGateway =
        normalizeProvider(summaryConfig) === MEETNOLA_SUMMARY_PROVIDER ||
        (customConfig?.endpoint || '')
          .trim()
          .replace(/\/$/, '')
          .toLowerCase() === MEETNOLA_GATEWAY_ENDPOINT.toLowerCase();

      if (usesGateway && !customConfig?.apiKey?.trim()) {
        return GATEWAY_SETUP_ROUTE;
      }

      return HOME_ROUTE;
    }

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
    // Safe fallback for first-launch issues.
    return isMeetnola ? GATEWAY_SETUP_ROUTE : GROQ_SETUP_ROUTE;
  }
}
