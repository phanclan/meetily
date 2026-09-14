'use client';

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { invoke } from '@tauri-apps/api/core';
import { TranscriptSettings, type TranscriptModelProps } from '@/components/TranscriptSettings';
import { RecordingSettings } from '@/components/RecordingSettings';
import { PreferenceSettings } from '@/components/PreferenceSettings';
import { SummaryModelSettings } from '@/components/SummaryModelSettings';
import { BetaSettings } from '@/components/BetaSettings';
import { useConfig } from '@/contexts/ConfigContext';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { getBuildInfo, type BuildInfo } from '@/lib/buildInfo';
import { ChromeDragBar } from '@/components/WindowChrome';
import { parseSettingsTab, settingsTabMeta } from '@/lib/settingsNav';

const TRANSCRIPT_PROVIDERS = ['localWhisper', 'parakeet', 'deepgram', 'elevenLabs', 'groq', 'openai'] as const;

/** The DB returns a plain string; anything unknown falls back to local Whisper. */
function toTranscriptProvider(value: string | null | undefined): TranscriptModelProps['provider'] {
  return TRANSCRIPT_PROVIDERS.find((provider) => provider === value) ?? 'localWhisper';
}

export default function SettingsPage() {
  const searchParams = useSearchParams();
  const { transcriptModelConfig, setTranscriptModelConfig } = useConfig();

  const activeTab = parseSettingsTab(searchParams.get('tab')) ?? 'general';
  const onboardingIntent = searchParams.get('onboarding');
  const [buildInfo, setBuildInfo] = useState<BuildInfo | null>(null);
  const activeSection = settingsTabMeta(activeTab);

  useEffect(() => {
    getBuildInfo().then(setBuildInfo).catch(console.error);
  }, []);

  useEffect(() => {
    const loadTranscriptConfig = async () => {
      try {
        const config = (await invoke('api_get_transcript_config')) as {
          provider?: string;
          model?: string;
          apiKey?: string | null;
        } | null;
        if (config) {
          console.log('Loaded saved transcript config:', {
            provider: config.provider,
            model: config.model,
            hasKey: !!config.apiKey,
          });
          setTranscriptModelConfig({
            provider: toTranscriptProvider(config.provider),
            model: config.model || 'large-v3',
            apiKey: config.apiKey || null,
          });
        }
      } catch (error) {
        console.error('Failed to load transcript config:', error);
      }
    };
    void loadTranscriptConfig();
  }, [setTranscriptModelConfig]);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <ChromeDragBar />

      <div className="notes-scroll-frame">
        <div className="notes-scrollbar">
          <div className="mx-auto max-w-3xl px-5 pb-6 pt-0 md:px-8">
            {onboardingIntent === 'groq-key' && (
              <Alert className="mb-6 border-blue-200 bg-blue-50 text-blue-950">
                <AlertDescription className="space-y-2">
                  <p className="font-medium">Afterword is ready, but Groq still needs an API key.</p>
                  <p className="text-sm leading-relaxed">
                    Enter one Groq key in <strong>Transcription</strong> below. Afterword shares that
                    same key with <strong>Summary</strong>, so you only need to save it once.
                  </p>
                </AlertDescription>
              </Alert>
            )}

            <h1 className="font-serif text-2xl tracking-tight text-stone-900">
              {activeSection.label}
            </h1>

            <div className="mt-5">
              {activeTab === 'general' && <PreferenceSettings />}
              {activeTab === 'recording' && <RecordingSettings />}
              {activeTab === 'Transcriptionmodels' && (
                <TranscriptSettings
                  transcriptModelConfig={transcriptModelConfig}
                  setTranscriptModelConfig={setTranscriptModelConfig}
                />
              )}
              {activeTab === 'summaryModels' && <SummaryModelSettings />}
              {activeTab === 'beta' && <BetaSettings />}
            </div>

            {buildInfo && (
              <div className="mt-8 border-t border-stone-200 pt-4 text-xs text-stone-500">
                <p>{buildInfo.displayName}</p>
                <p className="mt-1">
                  Channel: {buildInfo.channel} · Build ID: {buildInfo.buildId}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
