'use client'

import { type RefObject, useEffect } from 'react'
import { listen, UnlistenFn } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { toast } from 'sonner'
import { flushPendingWrites } from '@/lib/pendingWrites'
import { createQuitHandler } from '@/lib/appQuit'

/**
 * Once the shell is ready: listen for quit, flush pending writes, then tell
 * Rust the frontend bootstrap is complete.
 */
export function useAppQuitLifecycle(
  ready: boolean,
  quitDialog: RefObject<HTMLDialogElement | null>,
) {
  useEffect(() => {
    if (!ready) {
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
  }, [quitDialog, ready])
}
