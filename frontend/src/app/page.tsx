'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';
import { usePermissionCheck } from '@/hooks/usePermissionCheck';
import { useRecordingState, RecordingStatus } from '@/contexts/RecordingStateContext';
import { useConfig } from '@/contexts/ConfigContext';
import { HomeDashboard } from '@/app/_components/HomeDashboard';
import Analytics from '@/lib/analytics';
import { invoke } from '@tauri-apps/api/core';
import { TrashDialog } from '@/components/TrashDialog';
import { meetnolaInvoke } from '@/meetnola/ipc';
import { SettingsModals } from './_components/SettingsModal';
import { useModalState, type ModalType } from '@/hooks/useModalState';
import { useTranscriptRecovery } from '@/hooks/useTranscriptRecovery';
import { TranscriptRecovery } from '@/components/TranscriptRecovery';
import { indexedDBService } from '@/services/indexedDBService';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { useImportDialog } from '@/contexts/ImportDialogContext';
import { createDraftNotePath, createRecordingPath } from '@/lib/quickNoteRoute';

export default function Home() {
  const [showRecoveryDialog, setShowRecoveryDialog] = useState(false);
  const [showTrash, setShowTrash] = useState(false);

  const { transcriptModelConfig, selectedDevices, modelConfig, betaFeatures } = useConfig();
  const recordingState = useRecordingState();
  const { status } = recordingState;

  const { hasMicrophone, hasSystemAudio, isChecking: isCheckingPermissions } = usePermissionCheck();
  const { refetchMeetings, refreshNoteFolders, meetings } = useSidebar();
  const { modals, messages, hideModal } = useModalState(transcriptModelConfig);
  const { openImportDialog } = useImportDialog();

  const handleModalClose = useCallback((name: ModalType) => {
    hideModal(name);
  }, [hideModal]);

  // Recovery hook
  const {
    recoverableMeetings,
    checkForRecoverableTranscripts,
    recoverMeeting,
    loadMeetingTranscripts,
    deleteRecoverableMeeting
  } = useTranscriptRecovery();

  const router = useRouter();

  const handleDeleteMeeting = async (meetingId: string) => {
    try {
      await meetnolaInvoke('trash_meeting', { meetingId });
      await refetchMeetings();
      refreshNoteFolders();
      toast.success('Note moved to Trash', { action: { label: 'Open Trash', onClick: () => setShowTrash(true) } });
    } catch (error) {
      toast.error('Could not move note to Trash', {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  useEffect(() => {
    // Track page view
    Analytics.trackPageView('home');
  }, []);

  useEffect(() => {
    void refetchMeetings();
  }, [refetchMeetings]);

  // Startup recovery check
  useEffect(() => {
    const performStartupChecks = async () => {
      try {
        // Skip recovery check if currently recording or processing stop
        // This prevents the recovery dialog from showing when:
        if (recordingState.isRecording ||
          status === RecordingStatus.STOPPING ||
          status === RecordingStatus.PROCESSING_TRANSCRIPTS ||
          status === RecordingStatus.SAVING) {
          console.log('Skipping recovery check - recording in progress or processing');
          return;
        }

        // 1. Clean up old meetings (7+ days)
        try {
          await indexedDBService.deleteOldMeetings(7);
        } catch (error) {
          console.warn('⚠️ Failed to clean up old meetings:', error);
        }

        // 2. Clean up saved meetings (24+ hours after save)
        try {
          await indexedDBService.deleteSavedMeetings(24);
        } catch (error) {
          console.warn('⚠️ Failed to clean up saved meetings:', error);
        }

        // 3. Always check for recoverable meetings on startup
        // Don't skip based on sessionStorage - we need to check every time
        await checkForRecoverableTranscripts();
      } catch (error) {
        console.error('Failed to perform startup checks:', error);
      }
    };

    performStartupChecks();
  }, [checkForRecoverableTranscripts, recordingState.isRecording, status]);

  // Watch for recoverable meetings changes and show dialog once per session
  useEffect(() => {
    // Only show dialog if we have meetings and haven't shown it yet this session
    if (recoverableMeetings.length > 0) {
      const shownThisSession = sessionStorage.getItem('recovery_dialog_shown');
      if (!shownThisSession) {
        setShowRecoveryDialog(true);
        sessionStorage.setItem('recovery_dialog_shown', 'true');
      }
    }
  }, [recoverableMeetings]);

  // Handle recovery with toast notifications and navigation
  const handleRecovery = async (meetingId: string) => {
    try {
      const result = await recoverMeeting(meetingId);

      if (result.success) {
        toast.success('Meeting recovered successfully!', {
          description: result.audioRecoveryStatus?.status === 'success'
            ? 'Transcripts and audio recovered'
            : 'Transcripts recovered (no audio available)',
          action: result.meetingId ? {
            label: 'View Meeting',
            onClick: () => {
              router.push(`/meeting-details?id=${result.meetingId}`);
            }
          } : undefined,
          duration: 10000,
        });

        // Refresh sidebar to show the newly recovered meeting
        await refetchMeetings();

        // If no more recoverable meetings, clear session flag so dialog can show again
        if (recoverableMeetings.length === 0) {
          sessionStorage.removeItem('recovery_dialog_shown');
        }

        // Navigation is the toast's "View Meeting" action only. The timed auto-navigate
        // that used to run alongside it yanked the user off whatever they opened next.
      }
    } catch (error) {
      toast.error('Failed to recover meeting', {
        description: error instanceof Error ? error.message : 'Unknown error occurred',
      });
      throw error;
    }
  };

  // Handle dialog close - clear session flag if no meetings left
  const handleDialogClose = () => {
    setShowRecoveryDialog(false);
    // If user closes dialog and there are no more meetings, clear the flag
    // This allows the dialog to show again next session if new meetings appear
    if (recoverableMeetings.length === 0) {
      sessionStorage.removeItem('recovery_dialog_shown');
    }
  };

  // The recording workspace owns any live session, so hand it back the route.
  useEffect(() => {
    const showLiveWorkspace =
      recordingState.isRecording ||
      status === RecordingStatus.STARTING ||
      status === RecordingStatus.STOPPING ||
      status === RecordingStatus.PROCESSING_TRANSCRIPTS ||
      status === RecordingStatus.SAVING;
    if (showLiveWorkspace) {
      router.replace(createRecordingPath());
    }
  }, [recordingState.isRecording, status, router]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="flex flex-col h-screen bg-gray-50"
    >
      <SettingsModals
        modals={modals}
        messages={messages}
        onClose={handleModalClose}
      />
      <TranscriptRecovery
        isOpen={showRecoveryDialog}
        onClose={handleDialogClose}
        recoverableMeetings={recoverableMeetings}
        onRecover={handleRecovery}
        onDelete={deleteRecoverableMeeting}
        onLoadPreview={loadMeetingTranscripts}
      />
      <HomeDashboard
        meetings={meetings}
        hasMicrophone={hasMicrophone}
        hasSystemAudio={hasSystemAudio}
        isCheckingPermissions={isCheckingPermissions}
        transcriptModelConfig={transcriptModelConfig}
        modelConfig={modelConfig}
        selectedDevices={selectedDevices}
        recoverableMeetings={recoverableMeetings}
        onOpenMeeting={(meetingId, searchQuery, match, folderId) => {
          const params = new URLSearchParams({ id: meetingId, ...(searchQuery ? { search: searchQuery } : {}) });
          if (folderId) params.set('folder', folderId);
          if (searchQuery && match?.sourceId && (match.kind === 'notes' || match.kind === 'transcript')) {
            params.set('match', match.kind);
            params.set('sourceId', match.sourceId);
          }
          router.push(`/meeting-details?${params}`);
        }}
        onOpenRecovery={() => setShowRecoveryDialog(true)}
        onImportAudio={() => openImportDialog()}
        importEnabled={betaFeatures.importAndRetranscribe}
        onStartRecording={(folderId) => router.push(createRecordingPath(folderId))}
        onOpenDraft={(folderId) => router.push(createDraftNotePath(folderId))}
        onDeleteMeeting={handleDeleteMeeting}
        onOpenTrash={() => setShowTrash(true)}
        isRecordingDisabled={false}
      />
      <TrashDialog open={showTrash} onOpenChange={setShowTrash} onChanged={() => { void refetchMeetings(); refreshNoteFolders(); }} />
    </motion.div>
  );
}
