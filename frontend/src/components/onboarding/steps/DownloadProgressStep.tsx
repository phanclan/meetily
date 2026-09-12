import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Cloud, ExternalLink, KeyRound, Mic, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { OnboardingContainer } from '../OnboardingContainer';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { toast } from 'sonner';
import { getPostOnboardingRoute } from '@/lib/postOnboardingNavigation';
import { isAfterword } from '@/flavor';

const GROQ_KEYS_URL = 'https://console.groq.com/keys';
const GROQ_PRICING_URL = 'https://groq.com/pricing';
const GATEWAY_DOCS_URL = 'https://vercel.com/docs/ai-gateway';

export function DownloadProgressStep() {
  const { goNext, completeOnboarding } = useOnboarding();
  const [isMac, setIsMac] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);

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
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error('Failed to open link', { description: message });
    }
  };

  const handleContinue = async () => {
    if (isMac) {
      goNext();
      return;
    }

    setIsCompleting(true);
    try {
      await completeOnboarding();
      const nextRoute = await getPostOnboardingRoute();
      window.location.assign(nextRoute);
    } catch (error) {
      console.error('Failed to complete onboarding:', error);
      toast.error('Failed to complete setup', {
        description: 'Please try again.',
      });
      setIsCompleting(false);
    }
  };

  return (
    <OnboardingContainer
      title={isAfterword ? 'Local STT + AI Gateway' : 'Use Groq Free Tier'}
      description={
        isAfterword
          ? 'Afterword transcribes on-device by default. Summaries and Enhance use Vercel AI Gateway when you add a key.'
          : 'Afterword will use Groq for summaries and transcription by default. Local models stay optional and can be added later from Settings.'
      }
      step={3}
      totalSteps={isMac ? 4 : 3}
    >
      <div className="flex flex-col items-center space-y-6">
        <div className="w-full max-w-xl space-y-4">
          {isAfterword ? (
            <>
              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                    <Mic className="h-5 w-5" />
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-sm font-semibold text-gray-900">Recording stays local</h3>
                    <p className="text-sm text-gray-600">
                      Live transcription defaults to Parakeet on your machine. Download the model from
                      Settings when you are ready — no cloud STT key is required to record.
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-full bg-sky-100 text-sky-700">
                    <KeyRound className="h-5 w-5" />
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-sm font-semibold text-gray-900">Gateway for summaries</h3>
                    <p className="text-sm text-gray-600">
                      Paste a Vercel AI Gateway API key under Settings → Summary (Custom Server / AI
                      Gateway preset). Without a key, summary and Enhance actions fail cleanly.
                    </p>
                    <div className="flex flex-wrap gap-3 pt-1">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => openExternalUrl(GATEWAY_DOCS_URL)}
                      >
                        AI Gateway docs
                        <ExternalLink className="ml-2 h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              <Alert className="border-amber-200 bg-amber-50 text-amber-950">
                <Settings2 className="h-4 w-4" />
                <AlertDescription>
                  Missing Gateway credentials never block local recording. Configure the key when you
                  want cloud summaries.
                </AlertDescription>
              </Alert>
            </>
          ) : (
            <>
              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-full bg-sky-100 text-sky-700">
                    <Cloud className="h-5 w-5" />
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-sm font-semibold text-gray-900">What testers need</h3>
                    <p className="text-sm text-gray-600">
                      Create a Groq API key, then paste that same key into Afterword&apos;s transcript and
                      summary settings. The shared key flow is already wired for Groq.
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                    <KeyRound className="h-5 w-5" />
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-sm font-semibold text-gray-900">Free-tier path</h3>
                    <p className="text-sm text-gray-600">
                      Groq offers a free plan that is good enough for peer testing. Afterword does not
                      auto-provision a key, so each tester should use their own Groq account.
                    </p>
                    <div className="flex flex-wrap gap-3 pt-1">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => openExternalUrl(GROQ_KEYS_URL)}
                      >
                        Get Groq API Key
                        <ExternalLink className="ml-2 h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => openExternalUrl(GROQ_PRICING_URL)}
                      >
                        View Groq Free Plan
                        <ExternalLink className="ml-2 h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              <Alert className="border-amber-200 bg-amber-50 text-amber-950">
                <Settings2 className="h-4 w-4" />
                <AlertDescription>
                  AI features will not work until a Groq key is entered. If a tester wants offline
                  models later, they can download them from <strong>Settings</strong> after
                  onboarding.
                </AlertDescription>
              </Alert>
            </>
          )}
        </div>

        <div className="w-full max-w-xs">
          <Button
            onClick={handleContinue}
            disabled={isCompleting}
            className="w-full h-11 bg-gray-900 hover:bg-gray-800 text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isCompleting
              ? 'Finishing Setup...'
              : isMac
                ? 'Continue to Permissions'
                : 'Finish Setup'}
          </Button>
        </div>
      </div>
    </OnboardingContainer>
  );
}
