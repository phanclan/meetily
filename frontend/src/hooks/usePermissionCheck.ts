import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';

export interface PermissionStatus {
  hasMicrophone: boolean;
  hasSystemAudio: boolean;
  isChecking: boolean;
  error: string | null;
}

type AudioDevice = { name: string; device_type: 'Input' | 'Output' };

const DEVICE_CACHE_MS = 30_000;
let cachedDevices: { at: number; devices: AudioDevice[] } | null = null;

async function listAudioDevices(force = false): Promise<AudioDevice[]> {
  if (!force && cachedDevices && Date.now() - cachedDevices.at < DEVICE_CACHE_MS) {
    return cachedDevices.devices;
  }
  const devices = await invoke<AudioDevice[]>('get_audio_devices');
  cachedDevices = { at: Date.now(), devices };
  return devices;
}

export function usePermissionCheck() {
  const [status, setStatus] = useState<PermissionStatus>({
    hasMicrophone: false,
    hasSystemAudio: false,
    isChecking: true,
    error: null,
  });

  const checkPermissions = useCallback(async (force = false) => {
    setStatus(prev => ({ ...prev, isChecking: true, error: null }));

    try {
      const devices = await listAudioDevices(force);
      const hasMicrophone = devices.some(d => d.device_type === 'Input');
      const hasSystemAudio = devices.some(d => d.device_type === 'Output');

      setStatus({
        hasMicrophone,
        hasSystemAudio,
        isChecking: false,
        error: null,
      });

      return { hasMicrophone, hasSystemAudio };
    } catch (error) {
      console.error('Failed to check audio permissions:', error);
      setStatus({
        hasMicrophone: false,
        hasSystemAudio: false,
        isChecking: false,
        error: error instanceof Error ? error.message : 'Failed to check permissions',
      });
      return { hasMicrophone: false, hasSystemAudio: false };
    }
  }, []);

  const requestPermissions = useCallback(async () => {
    try {
      await listAudioDevices(true);
      setTimeout(() => {
        void checkPermissions(true);
      }, 1000);
    } catch (error) {
      console.error('Failed to request permissions:', error);
    }
  }, [checkPermissions]);

  useEffect(() => {
    void checkPermissions();
  }, [checkPermissions]);

  return {
    ...status,
    checkPermissions,
    requestPermissions,
  };
}
