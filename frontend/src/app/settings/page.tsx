'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ArrowLeft, Settings2, Mic, Database as DatabaseIcon, SparkleIcon, FlaskConical } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
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
import { cn } from '@/lib/utils';

const TABS = [
  { value: 'general', label: 'General', icon: Settings2 },
  { value: 'recording', label: 'Recording', icon: Mic },
  { value: 'Transcriptionmodels', label: 'Transcription', icon: DatabaseIcon },
  { value: 'summaryModels', label: 'AI Enhancement', icon: SparkleIcon },
  { value: 'beta', label: 'Beta', icon: FlaskConical },
] as const;

type TabValue = (typeof TABS)[number]['value'];

function isTabValue(value: string | null): value is TabValue {
  return TABS.some((tab) => tab.value === value);
}

const TRANSCRIPT_PROVIDERS = ['localWhisper', 'parakeet', 'deepgram', 'elevenLabs', 'groq', 'openai'] as const;

/** The DB returns a plain string; anything unknown falls back to local Whisper. */
function toTranscriptProvider(value: string | null | undefined): TranscriptModelProps['provider'] {
  return TRANSCRIPT_PROVIDERS.find((provider) => provider === value) ?? 'localWhisper';
}

export default function SettingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { transcriptModelConfig, setTranscriptModelConfig } = useConfig();

  const [activeTab, setActiveTab] = useState<TabValue>('general');
  const onboardingIntent = searchParams.get('onboarding');
  const [buildInfo, setBuildInfo] = useState<BuildInfo | null>(null);

  useEffect(() => {
    const requestedTab = searchParams.get('tab');
    if (isTabValue(requestedTab)) {
      setActiveTab(requestedTab);
    }
  }, [searchParams]);

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

  const selectTab = useCallback(
    (value: TabValue) => {
      setActiveTab(value);
      const params = new URLSearchParams(searchParams.toString());
      if (value === 'general') {
        params.delete('tab');
      } else {
        params.set('tab', value);
      }
      const query = params.toString();
      router.replace(query ? `/settings?${query}` : '/settings');
    },
    [router, searchParams],
  );

  const activeSection = useMemo(
    () => TABS.find((tab) => tab.value === activeTab) ?? TABS[0],
    [activeTab],
  );

  return (
    <div className="flex h-screen flex-col bg-background">
      <div className="sticky top-0 z-10 border-b border-stone-200 bg-background">
        <ChromeDragBar className="px-5 md:px-8">
          <button
            type="button"
            onClick={() => router.back()}
            className="no-drag flex items-center gap-2 text-stone-600 transition-colors hover:text-stone-900"
          >
            <ArrowLeft className="h-5 w-5" />
            <span>Back</span>
          </button>
        </ChromeDragBar>
      </div>

      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="Settings sections"
          className="flex w-[220px] shrink-0 flex-col border-r border-stone-200/80 px-3 py-4"
        >
          <ul className="flex flex-col gap-0.5">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = tab.value === activeTab;
              return (
                <li key={tab.value}>
                  <button
                    type="button"
                    onClick={() => selectTab(tab.value)}
                    aria-current={isActive ? 'page' : undefined}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400 focus-visible:ring-offset-2',
                      isActive
                        ? 'bg-stone-100 font-medium text-stone-900'
                        : 'text-stone-600 hover:bg-stone-50 hover:text-stone-900',
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden />
                    <span>{tab.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-5 py-5 md:px-8">
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

            <h2 className="font-serif text-2xl tracking-tight text-stone-900">
              {activeSection.label}
            </h2>

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
