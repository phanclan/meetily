'use client'

import './globals.css'
import { Source_Sans_3 } from 'next/font/google'
import { usePathname, useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import { SidebarProvider } from '@/components/Sidebar/SidebarProvider'
import MainContent from '@/components/MainContent'
import AnalyticsProvider from '@/components/AnalyticsProvider'
import { Toaster } from 'sonner'
import "sonner/dist/styles.css"
import { useState, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { TooltipProvider } from '@/components/ui/tooltip'
import { RecordingStateProvider } from '@/contexts/RecordingStateContext'
import { OllamaDownloadProvider } from '@/contexts/OllamaDownloadContext'
import { TranscriptProvider } from '@/contexts/TranscriptContext'
import { ConfigProvider, useConfig } from '@/contexts/ConfigContext'
import { OnboardingProvider } from '@/contexts/OnboardingContext'
import { OnboardingFlow } from '@/components/onboarding'
import { DownloadProgressToastProvider } from '@/components/shared/DownloadProgressToast'
import { UpdateCheckProvider } from '@/components/UpdateCheckProvider'
import { RecordingPostProcessingProvider } from '@/contexts/RecordingPostProcessingProvider'
import { RecordingStartProvider } from '@/contexts/RecordingStartProvider'
import { ImportAudioDialog, ImportDropOverlay } from '@/components/ImportAudio'
import { ImportDialogProvider } from '@/contexts/ImportDialogContext'
import { CallDetectionBanner } from '@/components/CallDetectionBanner'
import { CallDetectionRuntime } from '@/hooks/useCallDetection'
import { BuildIdentityBadge } from '@/components/BuildIdentityBadge'
import { WindowChrome } from '@/components/WindowChrome'
import { createRecordingPath, isNoteWorkspaceRoute } from '@/lib/quickNoteRoute'
import { useConsoleBridge } from '@/hooks/useConsoleBridge'
import { useAppQuitLifecycle } from '@/hooks/useAppQuitLifecycle'
import { useImportDropRuntime } from '@/hooks/useImportDropRuntime'
import { useRecordingToastListeners } from '@/hooks/useRecordingToastListeners'

const sourceSans3 = Source_Sans_3({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-source-sans-3',
})

// Module-level component — stable reference across RootLayout re-renders.
// Defined here (not inside RootLayout) so React never sees a new function type
// on re-render, which would cause unmount/remount and break initialization logic.
function ConditionalImportDialog({
  showImportDialog,
  handleImportDialogClose,
  importFilePath,
}: {
  showImportDialog: boolean;
  handleImportDialogClose: (open: boolean) => void;
  importFilePath: string | null;
}) {
  const { betaFeatures } = useConfig();

  // Only mount ImportAudioDialog (and its hooks/listeners) when feature is enabled
  if (!betaFeatures.importAndRetranscribe) {
    return null;
  }

  return (
    <ImportAudioDialog
      open={showImportDialog}
      onOpenChange={handleImportDialogClose}
      preselectedFile={importFilePath}
    />
  );
}

// export { metadata } from './metadata'

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const router = useRouter()
  const [startupPhase, setStartupPhase] = useState<'checking' | 'ready'>('checking')
  const [showOnboarding, setShowOnboarding] = useState(false)
  const quitDialog = useRef<HTMLDialogElement>(null)
  const isStartupReady = startupPhase === 'ready'

  useConsoleBridge()
  useAppQuitLifecycle(isStartupReady, quitDialog)
  useRecordingToastListeners()
  const {
    showDropOverlay,
    showImportDialog,
    importFilePath,
    handleImportDialogClose,
    handleOpenImportDialog,
  } = useImportDropRuntime({ enabled: isStartupReady && !showOnboarding })

  useEffect(() => {
    let cancelled = false

    invoke<{ completed: boolean } | null>('get_onboarding_status')
      .then((status) => {
        if (cancelled) {
          return
        }

        const isComplete = status?.completed ?? false
        setShowOnboarding(!isComplete)
        console.log(
          isComplete
            ? '[Layout] Onboarding completed, showing main app'
            : '[Layout] Onboarding not completed, showing onboarding flow',
        )
      })
      .catch((error) => {
        if (cancelled) {
          return
        }

        console.error('[Layout] Failed to check onboarding status:', error)
        setShowOnboarding(true)
      })
      .finally(() => {
        if (!cancelled) {
          setStartupPhase('ready')
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (process.env.NODE_ENV === 'production') {
      const handleContextMenu = (e: MouseEvent) => e.preventDefault();
      document.addEventListener('contextmenu', handleContextMenu);
      return () => document.removeEventListener('contextmenu', handleContextMenu);
    }
  }, []);

  const handleOnboardingComplete = () => {
    console.log('[Layout] Onboarding completed, reloading app')
    setShowOnboarding(false)
    // Optionally reload the window to ensure all state is fresh
    window.location.reload()
  }

  const isFocusedWorkspaceRoute = isNoteWorkspaceRoute(pathname)
  const isStartupChecking = startupPhase === 'checking'

  return (
    <html lang="en">
      <body className={`${sourceSans3.variable} font-sans antialiased`}>
        <WindowChrome />
        <AnalyticsProvider>
          <RecordingStateProvider>
            <CallDetectionRuntime />
            <TranscriptProvider>
              <ConfigProvider>
                <OllamaDownloadProvider>
                  <OnboardingProvider>
                    <UpdateCheckProvider>
                      <SidebarProvider>
                        <TooltipProvider>
                          <RecordingPostProcessingProvider>
                            <RecordingStartProvider isOnboardingVisible={showOnboarding}>
                              <ImportDialogProvider onOpen={handleOpenImportDialog}>
                                {/* Download progress toast provider - listens for background downloads */}
                                <DownloadProgressToastProvider />

                                {/* Show onboarding or main app */}
                                {isStartupChecking ? (
                                  <div className="flex min-h-screen items-center justify-center bg-background text-stone-500">
                                    <div className="flex flex-col items-center gap-3">
                                      <div className="h-8 w-8 animate-spin rounded-full border-2 border-stone-300 border-t-stone-700" />
                                      <p className="text-sm font-medium text-stone-700">Loading Afterword...</p>
                                    </div>
                                  </div>
                                ) : showOnboarding ? (
                                  <OnboardingFlow onComplete={handleOnboardingComplete} />
                                ) : (
                                  <div className="flex flex-col">
                                    {!isFocusedWorkspaceRoute && (
                                      <CallDetectionBanner
                                        onStartRecording={() => router.push(createRecordingPath())}
                                      />
                                    )}
                                    <div className="flex flex-1">
                                      {!isFocusedWorkspaceRoute && <Sidebar />}
                                      {isFocusedWorkspaceRoute ? (
                                        <div className="relative z-[30] min-w-0 flex-1">
                                          {children}
                                        </div>
                                      ) : (
                                        <MainContent>{children}</MainContent>
                                      )}
                                    </div>
                                  </div>
                                )}
                                {/* Import audio overlay and dialog */}
                                <ImportDropOverlay visible={showDropOverlay} />
                                <ConditionalImportDialog
                                  showImportDialog={showImportDialog}
                                  handleImportDialogClose={handleImportDialogClose}
                                  importFilePath={importFilePath}
                                />
                              </ImportDialogProvider>
                            </RecordingStartProvider>
                          </RecordingPostProcessingProvider>
                        </TooltipProvider>
                      </SidebarProvider>
                    </UpdateCheckProvider>
                  </OnboardingProvider>

                </OllamaDownloadProvider>
              </ConfigProvider>
            </TranscriptProvider>
          </RecordingStateProvider>
        </AnalyticsProvider>

        <Toaster position="bottom-center" richColors closeButton />
        <dialog ref={quitDialog} tabIndex={-1} onCancel={event => event.preventDefault()} aria-labelledby="quit-title" aria-describedby="quit-description" className="rounded-lg border border-stone-200 bg-white p-6 text-stone-900 shadow-lg backdrop:bg-stone-900/20">
          <h2 id="quit-title" className="text-base font-semibold">Saving before quitting…</h2>
          <p id="quit-description" className="mt-2 text-sm text-stone-600" role="status">Finishing your pending note changes.</p>
        </dialog>
        <BuildIdentityBadge />
      </body>
    </html>
  )
}
