import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Cloud, ExternalLink, HardDriveDownload, KeyRound, Mic } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { OnboardingContainer } from '../OnboardingContainer';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { isMeetnola } from '@/flavor';

const GROQ_KEYS_URL = 'https://console.groq.com/keys';
const GROQ_PRICING_URL = 'https://groq.com/pricing';
const GATEWAY_DOCS_URL = 'https://vercel.com/docs/ai-gateway';

export function SetupOverviewStep() {
  const { goNext } = useOnboarding();
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    const checkPlatform = async () => {
      try {
        const { platform } = await import('@tauri-apps/plugin-os');
        setIsMac(platform() === 'macos');
      } catch {
        setIsMac(navigator.userAgent.includes('Mac'));
      }
    };

    checkPlatform();
  }, []);

  const openExternalUrl = async (url: string) => {
    try {
      await invoke('open_external_url', { url });
    } catch (error) {
      console.error('Failed to open external URL:', error);
    }
  };

  const meetnolaSteps = [
    {
      icon: <Mic className="w-5 h-5 text-emerald-600" />,
      title: 'Transcribe locally by default',
      description:
        'Afterword uses on-device Parakeet (or Whisper) for live transcription. Recording does not require a cloud key.',
    },
    {
      icon: <Cloud className="w-5 h-5 text-sky-600" />,
      title: 'Summaries via Vercel AI Gateway',
      description:
        'Enhance and meeting summaries use the Custom OpenAI transport pointed at Vercel AI Gateway. Bring your Gateway API key in Settings.',
    },
    {
      icon: <HardDriveDownload className="w-5 h-5 text-amber-600" />,
      title: 'Download local STT when ready',
      description:
        'Parakeet models can be downloaded from Settings after onboarding. Missing Gateway credentials only block cloud summaries, never recording.',
    },
  ];

  const meetilySteps = [
    {
      icon: <Cloud className="w-5 h-5 text-sky-600" />,
      title: 'Use Groq by default',
      description:
        'Afterword is preconfigured to use Groq for transcription and summaries on fresh installs.',
    },
    {
      icon: <KeyRound className="w-5 h-5 text-emerald-600" />,
      title: 'Bring one Groq API key',
      description:
        'The same Groq key works for both transcription and summary settings, and Groq offers a free tier for testing.',
    },
    {
      icon: <HardDriveDownload className="w-5 h-5 text-amber-600" />,
      title: 'Keep local models optional',
      description:
        'If a tester wants offline models later, they can download them from Settings instead of during onboarding.',
    },
  ];

  const steps = isMeetnola ? meetnolaSteps : meetilySteps;

  return (
    <OnboardingContainer
      title="Setup Overview"
      description={
        isMeetnola
          ? 'Afterword starts with local transcription and Vercel AI Gateway for summaries. Existing Groq choices are preserved on upgrade.'
          : 'Afterword now starts Groq-first. Local transcription and summary models are optional and can be added later.'
      }
      step={2}
      totalSteps={isMac ? 4 : 3}
    >
      <div className="flex flex-col items-center space-y-8">
        <div className="w-full max-w-xl space-y-3">
          {steps.map((step) => (
            <div
              key={step.title}
              className="flex items-start gap-4 rounded-xl border border-gray-200 bg-white p-4"
            >
              <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-full bg-gray-100">
                {step.icon}
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-gray-900">{step.title}</h3>
                <p className="text-sm text-gray-600">{step.description}</p>
              </div>
            </div>
          ))}
        </div>

        <Alert className="w-full max-w-xl border-sky-200 bg-sky-50">
          <AlertDescription className="space-y-4">
            {isMeetnola ? (
              <>
                <p className="text-sm text-sky-950">
                  Add a Vercel AI Gateway API key under Settings → Summary when you want cloud
                  summaries or Enhance. Live recording works without it.
                </p>
                <div className="flex flex-wrap gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    className="border-sky-200 bg-white text-sky-900 hover:bg-sky-100"
                    onClick={() => openExternalUrl(GATEWAY_DOCS_URL)}
                  >
                    AI Gateway docs
                    <ExternalLink className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-sky-950">
                  Testers can use Groq&apos;s free tier. They only need to create a key and paste it
                  into Afterword&apos;s settings once.
                </p>
                <div className="flex flex-wrap gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    className="border-sky-200 bg-white text-sky-900 hover:bg-sky-100"
                    onClick={() => openExternalUrl(GROQ_KEYS_URL)}
                  >
                    Get Groq API Key
                    <ExternalLink className="ml-2 h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="border-sky-200 bg-white text-sky-900 hover:bg-sky-100"
                    onClick={() => openExternalUrl(GROQ_PRICING_URL)}
                  >
                    View Groq Free Plan
                    <ExternalLink className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              </>
            )}
          </AlertDescription>
        </Alert>

        <div className="w-full max-w-xs space-y-4">
          <Button
            onClick={goNext}
            className="w-full h-11 bg-gray-900 hover:bg-gray-800 text-white"
          >
            Continue
          </Button>
          <div className="text-center">
            <a
              href="https://github.com/Zackriya-Solutions/meeting-minutes"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-gray-600 hover:underline"
            >
              Report issues on GitHub
            </a>
          </div>
        </div>
      </div>
    </OnboardingContainer>
  );
}
