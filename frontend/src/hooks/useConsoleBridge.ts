'use client'

import { useEffect } from 'react'
import { appendFrontendLog, installConsoleBridge } from '@/lib/consoleBridge'

/**
 * Forwards window errors and (when enabled) console.* to the Rust log file.
 * Installs once per mount; the lib guards against nested HMR patches.
 */
export function useConsoleBridge() {
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
  }, [])

  // Pipe all console.log/warn/error to the Rust log file so frontend events
  // appear alongside Rust logs without requiring DevTools.
  //
  // This is a debugging aid, not a production feature: every forwarded call costs a
  // JSON serialization plus a Tauri IPC round-trip, and the hot transcript path logs
  // several times per segment. It is therefore off in production builds unless a
  // tester explicitly opts in with `localStorage['meetily:console-bridge'] = '1'`.
  useEffect(() => installConsoleBridge(), [])
}
