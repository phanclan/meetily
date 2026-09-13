'use client'

import { useEffect } from 'react'
import { listen, UnlistenFn } from '@tauri-apps/api/event'
import { toast } from 'sonner'
import { safelyUnlisten } from '@/lib/tauriEvents'

type RecordingStopResultPayload = {
  status: 'complete' | 'partial'
  reason?: string | null
  chunks_remaining?: number
  message: string
}

/** Surface incomplete-stop and transcript chunk-loss events as toasts. */
export function useRecordingToastListeners() {
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
}
