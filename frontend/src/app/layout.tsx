'use client'

import './globals.css'
import { Source_Sans_3 } from 'next/font/google'
import { usePathname, useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import { SidebarProvider } from '@/components/Sidebar/SidebarProvider'
import MainContent from '@/components/MainContent'
import AnalyticsProvider from '@/components/AnalyticsProvider'
import { Toaster, toast } from 'sonner'
import "sonner/dist/styles.css"
import { useState, useEffect, useCallback, useRef } from 'react'
import { listen, UnlistenFn } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import {
  appendFrontendLog as appendFrontendLogIpc,
  setCallDetectionEnabled,
} from '@/meetnola/ipc'
import { TooltipProvider } from '@/components/ui/tooltip'
import { RecordingStateProvider } from '@/contexts/RecordingStateContext'
import { OllamaDownloadProvider } from '@/contexts/OllamaDownloadContext'
import { TranscriptProvider } from '@/contexts/TranscriptContext'
import { ConfigProvider, useConfig } from '@/contexts/ConfigContext'
import { OnboardingProvider } from '@/contexts/OnboardingContext'
import { OnboardingFlow } from '@/components/onboarding'
import { loadBetaFeatures } from '@/types/betaFeatures'
import { DownloadProgressToastProvider } from '@/components/shared/DownloadProgressToast'
import { UpdateCheckProvider } from '@/components/UpdateCheckProvider'
import { RecordingPostProcessingProvider } from '@/contexts/RecordingPostProcessingProvider'
import { RecordingStartProvider } from '@/contexts/RecordingStartProvider'
import { ImportAudioDialog, ImportDropOverlay } from '@/components/ImportAudio'
import { ImportDialogProvider } from '@/contexts/ImportDialogContext'
import { isAudioExtension, getAudioFormatsDisplayList } from '@/constants/audioFormats'
import { CallDetectionBanner } from '@/components/CallDetectionBanner'
import { loadCallDetectionPreference } from '@/lib/callDetectionSettings'
import { safelyUnlisten } from '@/lib/tauriEvents'
import { BuildIdentityBadge } from '@/components/BuildIdentityBadge'
import { createRecordingPath, isNoteWorkspaceRoute } from '@/lib/quickNoteRoute'
import { flushPendingWrites } from '@/lib/pendingWrites'
import { createQuitHandler } from '@/lib/appQuit'

type RecordingStopResultPayload = {
  status: 'complete' | 'partial'
  reason?: string | null
  chunks_remaining?: number
  message: string
}

// Console → Rust log bridge tuning. Logs are buffered and flushed on this interval
// instead of each console call awaiting its own IPC round-trip.
const CONSOLE_BRIDGE_FLUSH_MS = 250
const CONSOLE_BRIDGE_MAX_PENDING = 1000
const CONSOLE_BRIDGE_OPT_IN_KEY = 'meetily:console-bridge'

/**
 * The bridge is a debugging tool. It runs in development builds, and in any build where
 * a tester has explicitly opted in via localStorage.
 */
function isConsoleBridgeEnabled(): boolean {
  if (process.env.NODE_ENV !== 'production') {
    return true
  }

  try {
    return window.localStorage.getItem(CONSOLE_BRIDGE_OPT_IN_KEY) === '1'
  } catch {
    return false
  }
}

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

  // Import audio state
  const [showDropOverlay, setShowDropOverlay] = useState(false)
  const [showImportDialog, setShowImportDialog] = useState(false)
  const [importFilePath, setImportFilePath] = useState<string | null>(null)

  const hasImportableAudioPath = useCallback((paths: string[] | undefined | null) => {
    if (!paths || paths.length === 0) {
      return false
    }

    return paths.some((path) => {
      const ext = path.split('.').pop()?.toLowerCase()
      return !!ext && isAudioExtension(ext)
    })
  }, [])

  const appendFrontendLog = useCallback(async (
    level: 'info' | 'warn' | 'error',
    message: string,
    metadata?: Record<string, unknown>,
  ) => {
    try {
      await appendFrontendLogIpc({
        level,
        message,
        metadata: metadata ?? null,
      })
    } catch {
      // Avoid recursive console logging when the logging bridge is unavailable.
    }
  }, [])

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
    if (startupPhase !== 'ready') {
      return
    }

    let cancelled = false
    let readyTimer: ReturnType<typeof setTimeout> | undefined
    let unlistenQuit: UnlistenFn | undefined
    const quit = createQuitHandler({
      flush: flushPendingWrites,
      complete: requestId => invoke('complete_app_quit', { requestId }),
      cancel: requestId => invoke('cancel_app_quit', { requestId }),
      setBusy: busy => {
        if (busy && !quitDialog.current?.open) quitDialog.current?.showModal()
        else if (!busy) quitDialog.current?.close()
      },
      reportError: error => toast.error('App remains open', { description: String(error), duration: 10000 }),
    })

    const notifyFrontendReady = async () => {
      await new Promise<void>((resolve) => {
        readyTimer = setTimeout(resolve, 0)
      })

      if (cancelled) {
        return
      }

      try {
        unlistenQuit = await listen<number>('app-quit-requested', event => { void quit.request(event.payload) })
        if (cancelled) { unlistenQuit(); return }
        await invoke('frontend_bootstrap_complete')
      } catch (error) {
        console.error('[Layout] Failed to notify Rust that frontend is ready:', error)
      }
    }

    void notifyFrontendReady()

    return () => {
      cancelled = true
      quit.dispose()
      unlistenQuit?.()
      if (readyTimer) {
        clearTimeout(readyTimer)
      }
    }
  }, [startupPhase])

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      void appendFrontendLog('error', event.message || 'window error', {
        source: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        stack: event.error instanceof Error ? event.error.stack : undefined,
      })
    }

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason
      void appendFrontendLog('error', 'unhandledrejection', {
        reason:
          reason instanceof Error
            ? { message: reason.message, stack: reason.stack }
            : String(reason),
      })
    }

    window.addEventListener('error', handleError)
    window.addEventListener('unhandledrejection', handleUnhandledRejection)

    return () => {
      window.removeEventListener('error', handleError)
      window.removeEventListener('unhandledrejection', handleUnhandledRejection)
    }
  }, [appendFrontendLog])

  useEffect(() => {
    let stopResultUnlisten: UnlistenFn | undefined
    let chunkLossUnlisten: UnlistenFn | undefined
    let cancelled = false

    const setupListeners = async () => {
      stopResultUnlisten = await listen<RecordingStopResultPayload>('recording-stop-result', (event) => {
        if (event.payload.status !== 'complete') {
          toast.error('Recording stopped with incomplete transcript', {
            description: event.payload.message,
          })
        }
      })

      chunkLossUnlisten = await listen<{
        chunks_queued: number
        chunks_completed: number
        chunks_lost: number
        message: string
      }>('transcript-chunk-loss-detected', (event) => {
        toast.error('Transcript chunk loss detected', {
          description: event.payload.message,
        })
      })

      if (cancelled) {
        safelyUnlisten(stopResultUnlisten, 'layout:recording-stop-result')
        safelyUnlisten(chunkLossUnlisten, 'layout:chunk-loss')
      }
    }

    setupListeners().catch(() => {
      // Ignore listener setup failures. The console bridge will capture details when available.
    })

    return () => {
      cancelled = true
      safelyUnlisten(stopResultUnlisten, 'layout:recording-stop-result')
      safelyUnlisten(chunkLossUnlisten, 'layout:chunk-loss')
    }
  }, [])

  // Pipe all console.log/warn/error to the Rust log file so frontend events
  // appear alongside Rust logs without requiring DevTools.
  //
  // This is a debugging aid, not a production feature: every forwarded call costs a
  // JSON serialization plus a Tauri IPC round-trip, and the hot transcript path logs
  // several times per segment. It is therefore off in production builds unless a
  // tester explicitly opts in with `localStorage['meetily:console-bridge'] = '1'`.
  useEffect(() => {
    if (!isConsoleBridgeEnabled()) {
      return
    }

    const orig = {
      log: console.log.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
    }
    let disposed = false

    const serializeArg = (arg: unknown): string => {
      if (typeof arg === 'string') {
        return arg
      }
      if (arg instanceof Error) {
        return JSON.stringify({
          name: arg.name,
          message: arg.message,
          stack: arg.stack,
        })
      }
      try {
        const seen = new WeakSet<object>()
        const json = JSON.stringify(arg, (_key, value) => {
          if (typeof value === 'bigint') {
            return value.toString()
          }
          if (value instanceof Error) {
            return {
              name: value.name,
              message: value.message,
              stack: value.stack,
            }
          }
          if (typeof value === 'object' && value !== null) {
            if (seen.has(value)) {
              return '[Circular]'
            }
            seen.add(value)
          }
          return value
        })
        return json ?? String(arg)
      } catch {
        return String(arg)
      }
    }

    // Buffer entries and flush on an interval. Forwarding each call individually
    // through a serial promise chain made every console.* call wait on the previous
    // IPC round-trip, which is ruinous on the transcript path.
    let pending: Array<{ level: 'info' | 'warn' | 'error'; message: string }> = []
    let dropped = 0
    let flushing = false

    const flush = async () => {
      if (flushing || pending.length === 0) {
        return
      }

      flushing = true
      const batch = pending
      pending = []

      if (dropped > 0) {
        batch.unshift({ level: 'warn', message: `[console-bridge] dropped ${dropped} log line(s) - buffer overflow` })
        dropped = 0
      }

      try {
        // Sequential so the log file keeps the order the app produced.
        for (const entry of batch) {
          if (disposed) {
            return
          }
          await appendFrontendLogIpc({ level: entry.level, message: entry.message, metadata: null })
        }
      } catch {
        // Ignore bridge failures to avoid recursive logging loops.
      } finally {
        flushing = false
      }
    }

    const flushTimer = setInterval(() => { void flush() }, CONSOLE_BRIDGE_FLUSH_MS)

    const fwd = (level: 'info' | 'warn' | 'error', args: unknown[]) => {
      if (disposed) {
        return
      }

      if (pending.length >= CONSOLE_BRIDGE_MAX_PENDING) {
        dropped += 1
        return
      }

      pending.push({ level, message: args.map(serializeArg).join(' ') })
    }

    console.log   = (...args) => { orig.log(...args);   fwd('info',  args) }
    console.warn  = (...args) => { orig.warn(...args);  fwd('warn',  args) }
    console.error = (...args) => { orig.error(...args); fwd('error', args) }

    return () => {
      console.log   = orig.log
      console.warn  = orig.warn
      console.error = orig.error
      clearInterval(flushTimer)
      // Let whatever is already buffered reach the log file before tearing down.
      void flush().finally(() => { disposed = true })
    }
  }, []) // install once, cleanup on unmount

  useEffect(() => {
    const syncCallDetectionPreference = async () => {
      try {
        await setCallDetectionEnabled(loadCallDetectionPreference())
      } catch (error) {
        console.error('[Layout] Failed to sync call detection preference:', error)
      }
    }

    syncCallDetectionPreference()
  }, [])

  // Disable context menu in production
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') {
      const handleContextMenu = (e: MouseEvent) => e.preventDefault();
      document.addEventListener('contextmenu', handleContextMenu);
      return () => document.removeEventListener('contextmenu', handleContextMenu);
    }
  }, []);
  // Handle file drop for audio import
  const handleFileDrop = useCallback((paths: string[]) => {
    // Check if beta features are enabled (read from localStorage directly since we're outside ConfigProvider)
    const betaFeatures = loadBetaFeatures();

    if (!betaFeatures.importAndRetranscribe) {
      toast.error('Beta feature disabled', {
        description: 'Enable "Import Audio & Retranscribe" in Settings > Beta to use this feature.'
      });
      return;
    }

    // Find the first audio file
    const audioFile = paths.find(p => {
      const ext = p.split('.').pop()?.toLowerCase();
      return !!ext && isAudioExtension(ext);
    });

    if (audioFile) {
      console.log('[Layout] Audio file dropped:', audioFile);
      setImportFilePath(audioFile);
      setShowImportDialog(true);
    } else if (paths.length > 0) {
      toast.error('Please drop an audio file', {
        description: `Supported formats: ${getAudioFormatsDisplayList()}`
      });
    }
  }, []);

  // Listen for drag-drop events
  useEffect(() => {
    if (startupPhase !== 'ready' || showOnboarding) return; // Don't handle drops during startup or onboarding

    const unlisteners: UnlistenFn[] = [];
    const cleanedUpRef = { current: false };

    const setupListeners = async () => {
      // Drag enter/over - show overlay only if beta feature is enabled
      const unlistenDragEnter = await listen<{ paths?: string[] }>('tauri://drag-enter', (event) => {
        if (
          loadBetaFeatures().importAndRetranscribe &&
          hasImportableAudioPath(event.payload?.paths)
        ) {
          setShowDropOverlay(true);
        }
      });
      if (cleanedUpRef.current) {
        safelyUnlisten(unlistenDragEnter, 'layout:drag-enter');
        return;
      }
      unlisteners.push(unlistenDragEnter);

      // Drag leave - hide overlay
      const unlistenDragLeave = await listen('tauri://drag-leave', () => {
        setShowDropOverlay(false);
      });
      if (cleanedUpRef.current) {
        safelyUnlisten(unlistenDragLeave, 'layout:drag-leave');
        unlisteners.forEach(u => safelyUnlisten(u, 'layout:drag-cleanup'));
        return;
      }
      unlisteners.push(unlistenDragLeave);

      // Drop - process files
      const unlistenDrop = await listen<{ paths: string[] }>('tauri://drag-drop', (event) => {
        setShowDropOverlay(false);
        handleFileDrop(event.payload.paths);
      });
      if (cleanedUpRef.current) {
        safelyUnlisten(unlistenDrop, 'layout:drag-drop');
        unlisteners.forEach(u => safelyUnlisten(u, 'layout:drag-cleanup'));
        return;
      }
      unlisteners.push(unlistenDrop);
    };

    setupListeners();

    return () => {
      cleanedUpRef.current = true;
      unlisteners.forEach((unlisten) => safelyUnlisten(unlisten, 'layout:drag-cleanup'));
    };
  }, [startupPhase, showOnboarding, handleFileDrop, hasImportableAudioPath]);

  // Handle import dialog close
  const handleImportDialogClose = useCallback((open: boolean) => {
    setShowImportDialog(open);
    if (!open) {
      setImportFilePath(null);
    }
  }, []);

  // Handler for ImportDialogProvider - opens import dialog from any child component
  const handleOpenImportDialog = useCallback((filePath?: string | null) => {
    setImportFilePath(filePath ?? null);
    setShowImportDialog(true);
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
        <AnalyticsProvider>
          <RecordingStateProvider>
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
                                        <div className="flex-1 min-w-0">
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
