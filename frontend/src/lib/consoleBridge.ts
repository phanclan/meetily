import { appendFrontendLog as appendFrontendLogIpc } from '@/afterword/ipc'
import { migrateProductStorageKeys } from '@/lib/migrateProductStorageKeys'

// Console → Rust log bridge tuning. Logs are buffered and flushed on this interval
// instead of each console call awaiting its own IPC round-trip.
export const CONSOLE_BRIDGE_FLUSH_MS = 250
export const CONSOLE_BRIDGE_MAX_PENDING = 1000
export const CONSOLE_BRIDGE_OPT_IN_KEY = 'afterword:console-bridge'

/**
 * The bridge is a debugging tool. It runs in development builds, and in any build where
 * a tester has explicitly opted in via localStorage.
 */
export function isConsoleBridgeEnabled(): boolean {
  if (typeof window === 'undefined') {
    return false
  }

  migrateProductStorageKeys()

  if (process.env.NODE_ENV !== 'production') {
    return true
  }

  try {
    migrateProductStorageKeys()
    return window.localStorage.getItem(CONSOLE_BRIDGE_OPT_IN_KEY) === '1'
  } catch {
    return false
  }
}

export function serializeConsoleArg(arg: unknown): string {
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

export async function appendFrontendLog(
  level: 'info' | 'warn' | 'error',
  message: string,
  metadata?: Record<string, unknown>,
) {
  try {
    await appendFrontendLogIpc({
      level,
      message,
      metadata: metadata ?? null,
    })
  } catch {
    // Avoid recursive console logging when the logging bridge is unavailable.
  }
}

let bridgeActive = false

/**
 * Patch console.* once for the JS realm. A module flag prevents HMR/layout
 * remounts from wrapping an already-wrapped console.
 */
export function installConsoleBridge(): () => void {
  if (!isConsoleBridgeEnabled() || bridgeActive) {
    return () => {}
  }

  bridgeActive = true
  const orig = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  }
  let disposed = false

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

    pending.push({ level, message: args.map(serializeConsoleArg).join(' ') })
  }

  console.log   = (...args) => { orig.log(...args);   fwd('info',  args) }
  console.warn  = (...args) => { orig.warn(...args);  fwd('warn',  args) }
  console.error = (...args) => { orig.error(...args); fwd('error', args) }

  return () => {
    console.log   = orig.log
    console.warn  = orig.warn
    console.error = orig.error
    clearInterval(flushTimer)
    bridgeActive = false
    // Let whatever is already buffered reach the log file before tearing down.
    void flush().finally(() => { disposed = true })
  }
}
