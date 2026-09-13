'use client'

import { useCallback, useEffect, useState } from 'react'
import { listen, UnlistenFn } from '@tauri-apps/api/event'
import { toast } from 'sonner'
import { loadBetaFeatures } from '@/types/betaFeatures'
import { isAudioExtension, getAudioFormatsDisplayList } from '@/constants/audioFormats'
import { safelyUnlisten } from '@/lib/tauriEvents'

export function hasImportableAudioPath(paths: string[] | undefined | null) {
  if (!paths || paths.length === 0) {
    return false
  }

  return paths.some((path) => {
    const ext = path.split('.').pop()?.toLowerCase()
    return !!ext && isAudioExtension(ext)
  })
}

/**
 * Drag-drop import overlay + dialog open state. Disabled during startup/onboarding.
 */
export function useImportDropRuntime({ enabled }: { enabled: boolean }) {
  const [showDropOverlay, setShowDropOverlay] = useState(false)
  const [showImportDialog, setShowImportDialog] = useState(false)
  const [importFilePath, setImportFilePath] = useState<string | null>(null)

  const handleFileDrop = useCallback((paths: string[]) => {
    // Check if beta features are enabled (read from localStorage directly since we're outside ConfigProvider)
    const betaFeatures = loadBetaFeatures()

    if (!betaFeatures.importAndRetranscribe) {
      toast.error('Beta feature disabled', {
        description: 'Enable "Import Audio & Retranscribe" in Settings > Beta to use this feature.',
      })
      return
    }

    const audioFile = paths.find(p => {
      const ext = p.split('.').pop()?.toLowerCase()
      return !!ext && isAudioExtension(ext)
    })

    if (audioFile) {
      console.log('[Layout] Audio file dropped:', audioFile)
      setImportFilePath(audioFile)
      setShowImportDialog(true)
    } else if (paths.length > 0) {
      toast.error('Please drop an audio file', {
        description: `Supported formats: ${getAudioFormatsDisplayList()}`,
      })
    }
  }, [])

  useEffect(() => {
    if (!enabled) return

    const unlisteners: UnlistenFn[] = []
    const cleanedUpRef = { current: false }

    const setupListeners = async () => {
      const unlistenDragEnter = await listen<{ paths?: string[] }>('tauri://drag-enter', (event) => {
        if (
          loadBetaFeatures().importAndRetranscribe &&
          hasImportableAudioPath(event.payload?.paths)
        ) {
          setShowDropOverlay(true)
        }
      })
      if (cleanedUpRef.current) {
        safelyUnlisten(unlistenDragEnter, 'layout:drag-enter')
        return
      }
      unlisteners.push(unlistenDragEnter)

      const unlistenDragLeave = await listen('tauri://drag-leave', () => {
        setShowDropOverlay(false)
      })
      if (cleanedUpRef.current) {
        safelyUnlisten(unlistenDragLeave, 'layout:drag-leave')
        unlisteners.forEach(u => safelyUnlisten(u, 'layout:drag-cleanup'))
        return
      }
      unlisteners.push(unlistenDragLeave)

      const unlistenDrop = await listen<{ paths: string[] }>('tauri://drag-drop', (event) => {
        setShowDropOverlay(false)
        handleFileDrop(event.payload.paths)
      })
      if (cleanedUpRef.current) {
        safelyUnlisten(unlistenDrop, 'layout:drag-drop')
        unlisteners.forEach(u => safelyUnlisten(u, 'layout:drag-cleanup'))
        return
      }
      unlisteners.push(unlistenDrop)
    }

    setupListeners()

    return () => {
      cleanedUpRef.current = true
      unlisteners.forEach((unlisten) => safelyUnlisten(unlisten, 'layout:drag-cleanup'))
    }
  }, [enabled, handleFileDrop])

  const handleImportDialogClose = useCallback((open: boolean) => {
    setShowImportDialog(open)
    if (!open) {
      setImportFilePath(null)
    }
  }, [])

  const handleOpenImportDialog = useCallback((filePath?: string | null) => {
    setImportFilePath(filePath ?? null)
    setShowImportDialog(true)
  }, [])

  return {
    showDropOverlay,
    showImportDialog,
    importFilePath,
    handleImportDialogClose,
    handleOpenImportDialog,
  }
}
