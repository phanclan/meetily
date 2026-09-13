import React, { useState, useEffect } from 'react';
import { Switch } from '@/components/ui/switch';
import { Bell, FolderOpen, HardDrive, Radio } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { DeviceSelection, SelectedDevices } from '@/components/DeviceSelection';
import Analytics from '@/lib/analytics';
import { useConfig } from '@/contexts/ConfigContext';
import { toast } from 'sonner';
import { SettingsRow, SettingsSection } from '@/components/settings/SettingsRow';
import { useCallDetection } from '@/hooks/useCallDetection';

export interface RecordingPreferences {
  save_folder: string;
  auto_save: boolean;
  file_format: string;
  preferred_mic_device: string | null;
  preferred_system_device: string | null;
}

interface RecordingSettingsProps {
  onSave?: (preferences: RecordingPreferences) => void;
}

export function RecordingSettings({ onSave }: RecordingSettingsProps) {
  const { setSelectedDevices } = useConfig();
  const { enabled: callDetectionEnabled, setEnabled: setCallDetectionEnabledPref } = useCallDetection();
  const [preferences, setPreferences] = useState<RecordingPreferences>({
    save_folder: '',
    auto_save: true,
    file_format: 'mp4',
    preferred_mic_device: null,
    preferred_system_device: null
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showRecordingNotification, setShowRecordingNotification] = useState(true);

  // Load recording preferences on component mount
  useEffect(() => {
    const loadPreferences = async () => {
      try {
        const prefs = await invoke<RecordingPreferences>('get_recording_preferences');
        setPreferences(prefs);
      } catch (error) {
        console.error('Failed to load recording preferences:', error);
        // If loading fails, get default folder path
        try {
          const defaultPath = await invoke<string>('get_default_recordings_folder_path');
          setPreferences(prev => ({ ...prev, save_folder: defaultPath }));
        } catch (defaultError) {
          console.error('Failed to get default folder path:', defaultError);
        }
      } finally {
        setLoading(false);
      }
    };

    loadPreferences();
  }, []);

  // Load recording notification preference
  useEffect(() => {
    const loadNotificationPref = async () => {
      try {
        const { Store } = await import('@tauri-apps/plugin-store');
        const store = await Store.load('preferences.json');
        const show = await store.get<boolean>('show_recording_notification') ?? true;
        setShowRecordingNotification(show);
      } catch (error) {
        console.error('Failed to load notification preference:', error);
      }
    };
    loadNotificationPref();
  }, []);

  const handleAutoSaveToggle = async (enabled: boolean) => {
    const newPreferences = { ...preferences, auto_save: enabled };
    setPreferences(newPreferences);
    await savePreferences(newPreferences);

    // Track auto-save setting change
    await Analytics.track('auto_save_recording_toggled', {
      enabled: enabled.toString()
    });
  };

  const handleDeviceChange = async (devices: SelectedDevices) => {
    const newPreferences = {
      ...preferences,
      preferred_mic_device: devices.micDevice,
      preferred_system_device: devices.systemDevice
    };
    setPreferences(newPreferences);
    setSelectedDevices(devices);
    await savePreferences(newPreferences);

    // Track default device preference changes
    // Note: Individual device selection analytics are tracked in DeviceSelection component
    await Analytics.track('default_devices_changed', {
      has_preferred_microphone: (!!devices.micDevice).toString(),
      has_preferred_system_audio: (!!devices.systemDevice).toString()
    });
  };

  const handleOpenFolder = async () => {
    try {
      await invoke('open_recordings_folder');
    } catch (error) {
      console.error('Failed to open recordings folder:', error);
    }
  };

  const handleNotificationToggle = async (enabled: boolean) => {
    try {
      setShowRecordingNotification(enabled);
      const { Store } = await import('@tauri-apps/plugin-store');
      const store = await Store.load('preferences.json');
      await store.set('show_recording_notification', enabled);
      await store.save();
      toast.success('Preference saved');
      await Analytics.track('recording_notification_preference_changed', {
        enabled: enabled.toString()
      });
    } catch (error) {
      console.error('Failed to save notification preference:', error);
      toast.error('Failed to save preference');
    }
  };

  const handleCallDetectionToggle = async (enabled: boolean) => {
    try {
      await setCallDetectionEnabledPref(enabled);
      toast.success('Preference saved');
    } catch (error) {
      console.error('Failed to save call detection preference:', error);
      toast.error('Failed to save preference');
    }
  };

  const savePreferences = async (prefs: RecordingPreferences) => {
    setSaving(true);
    try {
      await invoke('set_recording_preferences', { preferences: prefs });
      onSave?.(prefs);

      // Show success toast with device details
      const micDevice = prefs.preferred_mic_device || 'Default';
      const systemDevice = prefs.preferred_system_device || 'Default';
      toast.success("Device preferences saved", {
        description: `Microphone: ${micDevice}, System Audio: ${systemDevice}`
      });
    } catch (error) {
      console.error('Failed to save recording preferences:', error);
      toast.error("Failed to save device preferences", {
        description: error instanceof Error ? error.message : String(error)
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="animate-pulse space-y-2">
        <div className="h-16 rounded-xl bg-stone-100"></div>
        <div className="h-16 rounded-xl bg-stone-100"></div>
        <div className="h-16 rounded-xl bg-stone-100"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SettingsSection title="Features">
        <SettingsRow
          icon={<Radio />}
          title="Detect meetings"
          description="Offer to start a note when Zoom, Teams, Slack, and other meeting apps are running"
          control={
            <Switch
              checked={callDetectionEnabled}
              onCheckedChange={handleCallDetectionToggle}
            />
          }
        />

        <SettingsRow
          icon={<HardDrive />}
          title="Save Audio Recordings"
          description="Automatically save audio files when recording stops"
          control={
            <Switch
              checked={preferences.auto_save}
              onCheckedChange={handleAutoSaveToggle}
              disabled={saving}
            />
          }
        >
          {!preferences.auto_save ? (
            <p className="text-xs text-stone-500">
              Audio recording is disabled. Enable Save Audio Recordings to automatically save your meeting audio.
            </p>
          ) : null}
        </SettingsRow>

        <SettingsRow
          icon={<Bell />}
          title="Recording Start Notification"
          description="Show reminder to inform participants when recording starts"
          control={
            <Switch
              checked={showRecordingNotification}
              onCheckedChange={handleNotificationToggle}
            />
          }
        />
      </SettingsSection>

      {preferences.auto_save ? (
        <SettingsSection title="Storage">
          <SettingsRow
            icon={<FolderOpen />}
            title="Save Location"
            description={
              <>
                <span className="break-all">
                  {preferences.save_folder || 'Default folder'}
                </span>
                <span className="mt-1 block text-xs text-stone-500">
                  {preferences.file_format.toUpperCase()} files · recording_YYYYMMDD_HHMMSS.{preferences.file_format}
                </span>
              </>
            }
            control={
              <button
                type="button"
                onClick={handleOpenFolder}
                className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-100"
              >
                <FolderOpen className="h-4 w-4" />
                Open Folder
              </button>
            }
          />
        </SettingsSection>
      ) : null}

      <SettingsSection title="Audio Devices">
        <div className="rounded-xl bg-stone-50 p-4">
          <p className="mb-4 text-sm text-stone-600">
            Set your preferred microphone and system audio devices for recording. These will be automatically selected when starting new recordings.
          </p>
          <DeviceSelection
            selectedDevices={{
              micDevice: preferences.preferred_mic_device,
              systemDevice: preferences.preferred_system_device
            }}
            onDeviceChange={handleDeviceChange}
            disabled={saving}
          />
        </div>
      </SettingsSection>
    </div>
  );
}
