'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode, useRef } from 'react';
import { TranscriptModelProps } from '@/components/TranscriptSettings';
import { SelectedDevices } from '@/components/DeviceSelection';
import { configService, ModelConfig } from '@/services/configService';
import { invoke } from '@tauri-apps/api/core';
import Analytics from '@/lib/analytics';
import { BetaFeatures, BetaFeatureKey, loadBetaFeatures, saveBetaFeatures } from '@/types/betaFeatures';
import {
  DEFAULT_SUMMARY_MODEL,
  DEFAULT_SUMMARY_PROVIDER,
  DEFAULT_TRANSCRIPT_MODEL,
  DEFAULT_TRANSCRIPT_PROVIDER,
  DEFAULT_WHISPER_MODEL,
} from '@/constants/modelDefaults';

export interface OllamaModel {
  name: string;
  id: string;
  size: string;
  modified: string;
}

export interface StorageLocations {
  database: string;
  models: string;
  recordings: string;
}

export interface NotificationSettings {
  recording_notifications: boolean;
  time_based_reminders: boolean;
  meeting_reminders: boolean;
  respect_do_not_disturb: boolean;
  notification_sound: boolean;
  system_permission_granted: boolean;
  consent_given: boolean;
  manual_dnd_mode: boolean;
  notification_preferences: {
    show_recording_started: boolean;
    show_recording_stopped: boolean;
    show_recording_paused: boolean;
    show_recording_resumed: boolean;
    show_transcription_complete: boolean;
    show_meeting_reminders: boolean;
    show_system_errors: boolean;
    meeting_reminder_minutes: number[];
  };
}

interface ConfigContextType {
  // Model configuration
  modelConfig: ModelConfig;
  setModelConfig: (config: ModelConfig | ((prev: ModelConfig) => ModelConfig)) => void;

  // Transcript model configuration
  transcriptModelConfig: TranscriptModelProps;
  setTranscriptModelConfig: (config: TranscriptModelProps | ((prev: TranscriptModelProps) => TranscriptModelProps)) => void;

  // Device configuration
  selectedDevices: SelectedDevices;
  setSelectedDevices: (devices: SelectedDevices) => void;

  // Language preference
  selectedLanguage: string;
  setSelectedLanguage: (lang: string) => void;

  // UI preferences
  showConfidenceIndicator: boolean;
  toggleConfidenceIndicator: (checked: boolean) => void;

  // Beta features
  betaFeatures: BetaFeatures;
  toggleBetaFeature: (featureKey: BetaFeatureKey, enabled: boolean) => void;

  // Ollama models
  models: OllamaModel[];
  modelOptions: Record<ModelConfig['provider'], string[]>;
  error: string;

  // Summary configuration
  isAutoSummary: boolean;
  toggleIsAutoSummary: (checked: boolean) => void;

  // Provider-specific API keys
  providerApiKeys: {
    claude: string | null;
    groq: string | null;
    openai: string | null;
    openrouter: string | null;
  };
  updateProviderApiKey: (provider: string, apiKey: string | null) => void;

  // Preference settings (lazy loaded)
  notificationSettings: NotificationSettings | null;
  storageLocations: StorageLocations | null;
  isLoadingPreferences: boolean;
  loadPreferences: () => Promise<void>;
  updateNotificationSettings: (settings: NotificationSettings) => Promise<void>;
}

const ConfigContext = createContext<ConfigContextType | undefined>(undefined);

const SHARED_PROVIDER_API_KEYS = new Set(['groq', 'openai']);
const CLOUD_PROVIDER_KEYS = ['claude', 'groq', 'openai', 'openrouter'] as const;
type CloudProviderKey = (typeof CLOUD_PROVIDER_KEYS)[number];
const CLOUD_PROVIDER_KEY_SET = new Set<string>(CLOUD_PROVIDER_KEYS);

interface PersistedRecordingPreferences {
  save_folder: string;
  auto_save: boolean;
  file_format: string;
  preferred_mic_device: string | null;
  preferred_system_device: string | null;
  system_audio_backend?: string | null;
}

export function ConfigProvider({ children }: { children: ReactNode }) {
  // Model configuration state
  const [modelConfig, setModelConfig] = useState<ModelConfig>({
    provider: DEFAULT_SUMMARY_PROVIDER,
    model: DEFAULT_SUMMARY_MODEL,
    whisperModel: DEFAULT_WHISPER_MODEL,
    ollamaEndpoint: null
  });

  // Transcript model configuration state
  const [transcriptModelConfig, setTranscriptModelConfig] = useState<TranscriptModelProps>({
    provider: DEFAULT_TRANSCRIPT_PROVIDER,
    model: DEFAULT_TRANSCRIPT_MODEL,
    apiKey: null
  });

  // Provider-specific API keys (loaded once at startup)
  // Note: Gemini omitted for now - add when UI support is added
  const [providerApiKeys, setProviderApiKeys] = useState<{
    claude: string | null;
    groq: string | null;
    openai: string | null;
    openrouter: string | null;
  }>({
    claude: null,
    groq: null,
    openai: null,
    openrouter: null,
  });

  // Ollama models list and error state
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [error, setError] = useState<string>('');

  // Device configuration state
  const [selectedDevices, setSelectedDevicesState] = useState<SelectedDevices>({
    micDevice: null,
    systemDevice: null
  });

  // Language preference state
  const [selectedLanguage, setSelectedLanguage] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('primaryLanguage');
      return saved || 'auto';
    }
    return 'auto';
  });

  // UI preferences state
  const [showConfidenceIndicator, setShowConfidenceIndicator] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('showConfidenceIndicator');
      return saved !== null ? saved === 'true' : true;
    }
    return true;
  });

  // Summary configs
  const [isAutoSummary, setisAutoSummary] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('isAutoSummary');
      return saved !== null ? saved === 'true' : false
    }
    return false;
  });

  // Beta features state (localStorage)
  const [betaFeatures, setBetaFeatures] = useState<BetaFeatures>(() => {
    return loadBetaFeatures();
  });

  // Preference settings state (lazy loaded)
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings | null>(null);
  const [storageLocations, setStorageLocations] = useState<StorageLocations | null>(null);
  const [isLoadingPreferences, setIsLoadingPreferences] = useState(false);
  const preferencesLoadedRef = useRef(false);
  const isLoadingRef = useRef(false);
  const loadedProviderApiKeysRef = useRef<Set<CloudProviderKey>>(new Set());
  const [hasLoadedModelConfig, setHasLoadedModelConfig] = useState(false);
  const [hasLoadedTranscriptConfig, setHasLoadedTranscriptConfig] = useState(false);

  // Load Ollama models only when Ollama is the active summary provider.
  useEffect(() => {
    if (modelConfig.provider !== 'ollama') {
      return;
    }

    let cancelled = false;

    const loadModels = async () => {
      try {
        const endpoint = modelConfig.ollamaEndpoint || null;
        const modelList = await invoke<OllamaModel[]>('get_ollama_models', { endpoint });
        if (cancelled) {
          return;
        }
        setModels(modelList);
        setError('');
      } catch (err) {
        if (cancelled) {
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to load Ollama models');
        console.error('Error loading models:', err);
      }
    };

    void loadModels();

    return () => {
      cancelled = true;
    };
  }, [modelConfig.provider, modelConfig.ollamaEndpoint]);

  // Load transcript configuration on mount
  useEffect(() => {
    let cancelled = false;

    const loadTranscriptConfig = async () => {
      try {
        const config = await configService.getTranscriptConfig();
        if (cancelled) {
          return;
        }
        if (config) {
          console.log('[ConfigContext] Loaded saved transcript config:', { provider: config.provider, model: config.model, hasKey: !!config.apiKey });
          setTranscriptModelConfig({
            provider: config.provider || DEFAULT_TRANSCRIPT_PROVIDER,
            model: config.model || DEFAULT_TRANSCRIPT_MODEL,
            apiKey: config.apiKey || null
          });
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        console.error('[ConfigContext] Failed to load transcript config:', error);
      } finally {
        if (!cancelled) {
          setHasLoadedTranscriptConfig(true);
        }
      }
    };

    void loadTranscriptConfig();

    return () => {
      cancelled = true;
    };
  }, []);

  // Sync language preference to Rust on mount (fixes startup desync bug)
  useEffect(() => {
    if (selectedLanguage) {
      invoke('set_language_preference', { language: selectedLanguage })
        .then(() => {
          console.log('[ConfigContext] Synced language preference to Rust on startup:', selectedLanguage);
        })
        .catch(err => {
          console.error('[ConfigContext] Failed to sync language preference to Rust on startup:', err);
        });
    }
  }, []); 

  // Load model configuration on mount
  useEffect(() => {
    let cancelled = false;

    const fetchModelConfig = async () => {
      try {
        const data = await configService.getModelConfig();
        if (cancelled) {
          return;
        }
        if (data && data.provider) {
          // If provider is custom-openai, fetch the additional config
          if (data.provider === 'custom-openai') {
            try {
              const customConfig = await configService.getCustomOpenAIConfig();
              if (cancelled) {
                return;
              }
              if (customConfig) {
                // Merge custom config fields into modelConfig
                console.log('[ConfigContext] Loading custom OpenAI config:', {
                  endpoint: customConfig.endpoint,
                  model: customConfig.model,
                });
                const resolvedModel = customConfig.model || data.model || '';
                setModelConfig(prev => ({
                  ...prev,
                  provider: data.provider,
                  model: resolvedModel || prev.model,
                  whisperModel: data.whisperModel || prev.whisperModel,
                  customOpenAIEndpoint: customConfig.endpoint,
                  customOpenAIModel: customConfig.model,
                  customOpenAIApiKey: customConfig.apiKey,
                  maxTokens: customConfig.maxTokens,
                  temperature: customConfig.temperature,
                  topP: customConfig.topP,
                }));

                // Seed per-provider model cache from DB
                if (resolvedModel) {
                  const map = JSON.parse(localStorage.getItem('providerModelMap') || '{}');
                  map[data.provider] = resolvedModel;
                  localStorage.setItem('providerModelMap', JSON.stringify(map));
                }

                return; // Early return
              }
            } catch (err) {
              if (cancelled) {
                return;
              }
              console.error('[ConfigContext] Failed to fetch custom OpenAI config:', err);
            }
          }

          // For non-custom-openai providers, just set base config
          setModelConfig(prev => ({
            ...prev,
            provider: data.provider,
            model: data.model || prev.model,
            whisperModel: data.whisperModel || prev.whisperModel,
            ollamaEndpoint: data.ollamaEndpoint,
          }));

          // Seed per-provider model cache from DB
          if (data.model) {
            const map = JSON.parse(localStorage.getItem('providerModelMap') || '{}');
            map[data.provider] = data.model;
            localStorage.setItem('providerModelMap', JSON.stringify(map));
          }
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        console.error('Failed to fetch saved model config in ConfigContext:', error);
      } finally {
        if (!cancelled) {
          setHasLoadedModelConfig(true);
        }
      }
    };

    void fetchModelConfig();

    return () => {
      cancelled = true;
    };
  }, []);

  const activeApiKeyProviders = useMemo(() => {
    if (!hasLoadedModelConfig || !hasLoadedTranscriptConfig) {
      return [] as CloudProviderKey[];
    }

    const providers = new Set<CloudProviderKey>();
    for (const provider of [modelConfig.provider, transcriptModelConfig.provider]) {
      if (CLOUD_PROVIDER_KEY_SET.has(provider)) {
        providers.add(provider as CloudProviderKey);
      }
    }

    return Array.from(providers).sort();
  }, [
    hasLoadedModelConfig,
    hasLoadedTranscriptConfig,
    modelConfig.provider,
    transcriptModelConfig.provider,
  ]);

  // Load only the API keys needed by the active providers.
  useEffect(() => {
    const providersToLoad = activeApiKeyProviders.filter(
      (provider) => !loadedProviderApiKeysRef.current.has(provider),
    );

    if (providersToLoad.length === 0) {
      return;
    }

    let cancelled = false;

    const loadActiveApiKeys = async () => {
      try {
        const keys = await Promise.all(
          providersToLoad.map(async (provider) => [
            provider,
            await invoke<string>('api_get_api_key', { provider }).catch(() => null),
          ] as const),
        );

        if (cancelled) {
          return;
        }

        setProviderApiKeys((prev) => {
          const next = { ...prev };
          for (const [provider, apiKey] of keys) {
            next[provider] = apiKey;
          }
          return next;
        });

        providersToLoad.forEach((provider) => {
          loadedProviderApiKeysRef.current.add(provider);
        });

        console.log('[ConfigContext] Loaded active provider API keys:', providersToLoad);
      } catch (error) {
        console.error('[ConfigContext] Failed to load provider API keys:', error);
      }
    };

    void loadActiveApiKeys();

    return () => {
      cancelled = true;
    };
  }, [activeApiKeyProviders]);

  // Listen for model config updates from other components
  useEffect(() => {
    const setupListener = async () => {
      const { listen } = await import('@tauri-apps/api/event');
      const unlisten = await listen<ModelConfig>('model-config-updated', (event) => {
        setModelConfig(event.payload);

        // Update provider-specific key when config changes
        if (event.payload.apiKey && event.payload.provider !== 'custom-openai') {
          updateProviderApiKey(event.payload.provider, event.payload.apiKey);
        }
      });
      return unlisten;
    };

    let cleanup: (() => void) | undefined;
    setupListener().then(fn => cleanup = fn);

    return () => {
      cleanup?.();
    };
  }, []);

  // Load device preferences on mount
  useEffect(() => {
    const loadDevicePreferences = async () => {
      try {
        const prefs = await configService.getRecordingPreferences();
        if (prefs && (prefs.preferred_mic_device || prefs.preferred_system_device)) {
          setSelectedDevicesState({
            micDevice: prefs.preferred_mic_device,
            systemDevice: prefs.preferred_system_device
          });
          console.log('Loaded device preferences:', prefs);
        }
      } catch (error) {
        console.log('No device preferences found or failed to load:', error);
      }
    };
    loadDevicePreferences();
  }, []);

  // Calculate model options based on available models
  const modelOptions: Record<ModelConfig['provider'], string[]> = {
    ollama: models.map(model => model.name),
    claude: ['claude-3-5-sonnet-latest'],
    groq: ['llama-3.3-70b-versatile'],
    openrouter: [],
    openai: ['gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    'builtin-ai': [],
    'custom-openai': [],
  };

  // Toggle confidence indicator with localStorage persistence
  const toggleConfidenceIndicator = useCallback((checked: boolean) => {
    setShowConfidenceIndicator(checked);
    if (typeof window !== 'undefined') {
      localStorage.setItem('showConfidenceIndicator', checked.toString());
    }
    // Trigger a custom event to notify other components
    window.dispatchEvent(new CustomEvent('confidenceIndicatorChanged', { detail: checked }));
  }, []);

  const toggleIsAutoSummary = useCallback((checked: boolean) => {
    setisAutoSummary(checked);
    if (typeof window !== 'undefined') {
      localStorage.setItem('isAutoSummary', checked.toString());
    }
  }, [])

  // Toggle beta feature with localStorage persistence and analytics
  const toggleBetaFeature = useCallback((featureKey: BetaFeatureKey, enabled: boolean) => {
    setBetaFeatures(prev => {
      const updated = { ...prev, [featureKey]: enabled };
      saveBetaFeatures(updated);

      // Track analytics with specific feature
      Analytics.track('beta_feature_toggled', {
        feature: featureKey,
        enabled: enabled.toString(),
      }).catch(err => console.error('Failed to track beta feature toggle:', err));

      return updated;
    });
  }, []);

  // Update individual provider API key
  const updateProviderApiKey = useCallback((provider: string, apiKey: string | null) => {
    setProviderApiKeys(prev => ({ ...prev, [provider]: apiKey }));
    if (CLOUD_PROVIDER_KEY_SET.has(provider)) {
      loadedProviderApiKeysRef.current.add(provider as CloudProviderKey);
    }
    if (!SHARED_PROVIDER_API_KEYS.has(provider)) {
      return;
    }

    setTranscriptModelConfig(prev => {
      if (prev.provider !== provider) {
        return prev;
      }

      return {
        ...prev,
        apiKey,
      };
    });
  }, []);

  const handleSetSelectedDevices = useCallback((devices: SelectedDevices) => {
    setSelectedDevicesState((prev) => {
      if (
        prev.micDevice === devices.micDevice &&
        prev.systemDevice === devices.systemDevice
      ) {
        return prev;
      }

      return devices;
    });

    void (async () => {
      try {
        const currentPreferences = await invoke<PersistedRecordingPreferences>('get_recording_preferences');

        if (
          currentPreferences.preferred_mic_device === devices.micDevice &&
          currentPreferences.preferred_system_device === devices.systemDevice
        ) {
          return;
        }

        await invoke('set_recording_preferences', {
          preferences: {
            ...currentPreferences,
            preferred_mic_device: devices.micDevice,
            preferred_system_device: devices.systemDevice,
          },
        });
      } catch (error) {
        console.error('[ConfigContext] Failed to persist selected audio devices:', error);
      }
    })();
  }, []);

  // Lazy load preference settings (only loads if not already cached)
  const loadPreferences = useCallback(async () => {
    // If already loaded, don't reload
    if (preferencesLoadedRef.current) {
      return;
    }

    // If currently loading, don't start another load
    if (isLoadingRef.current) {
      return;
    }

    isLoadingRef.current = true;
    setIsLoadingPreferences(true);
    try {
      // Load notification settings from backend
      let settings: NotificationSettings | null = null;
      try {
        settings = await invoke<NotificationSettings>('get_notification_settings');
        setNotificationSettings(settings);
      } catch (notifError) {
        console.error('[ConfigContext] Failed to load notification settings:', notifError);
        // Use default values if notification settings fail to load
        setNotificationSettings(null);
      }

      // Load storage locations
      const [dbDir, modelsDir, recordingsDir] = await Promise.all([
        invoke<string>('get_database_directory'),
        invoke<string>('whisper_get_models_directory'),
        invoke<string>('get_default_recordings_folder_path')
      ]);

      setStorageLocations({
        database: dbDir,
        models: modelsDir,
        recordings: recordingsDir
      });

      // Mark as loaded
      preferencesLoadedRef.current = true;
    } catch (error) {
      console.error('[ConfigContext] Failed to load preferences:', error);
    } finally {
      isLoadingRef.current = false;
      setIsLoadingPreferences(false);
    }
  }, []);

  // Update notification settings
  const updateNotificationSettings = useCallback(async (settings: NotificationSettings) => {
    try {
      await invoke('set_notification_settings', { settings });
      setNotificationSettings(settings);
    } catch (error) {
      console.error('[ConfigContext] Failed to update notification settings:', error);
      throw error; // Re-throw so component can handle error
    }
  }, []);

  // Wrapper for setSelectedLanguage that persists to localStorage and syncs to Rust
  const handleSetSelectedLanguage = useCallback((lang: string) => {
    setSelectedLanguage(lang);
    if (typeof window !== 'undefined') {
      localStorage.setItem('primaryLanguage', lang);
    }
    // Sync with Rust in-memory state for live recording
    invoke('set_language_preference', { language: lang }).catch(err =>
      console.error('Failed to sync language preference to Rust:', err)
    );
  }, []);

  const value: ConfigContextType = useMemo(() => ({
    modelConfig,
    setModelConfig,
    isAutoSummary,
    toggleIsAutoSummary,
    providerApiKeys,
    updateProviderApiKey,
    transcriptModelConfig,
    setTranscriptModelConfig,
    selectedDevices,
    setSelectedDevices: handleSetSelectedDevices,
    selectedLanguage,
    setSelectedLanguage: handleSetSelectedLanguage,
    showConfidenceIndicator,
    toggleConfidenceIndicator,
    betaFeatures,
    toggleBetaFeature,
    models,
    modelOptions,
    error,
    notificationSettings,
    storageLocations,
    isLoadingPreferences,
    loadPreferences,
    updateNotificationSettings,
  }), [
    modelConfig,
    isAutoSummary,
    toggleIsAutoSummary,
    providerApiKeys,
    updateProviderApiKey,
    transcriptModelConfig,
    selectedDevices,
    handleSetSelectedDevices,
    selectedLanguage,
    handleSetSelectedLanguage,
    showConfidenceIndicator,
    toggleConfidenceIndicator,
    betaFeatures,
    toggleBetaFeature,
    models,
    modelOptions,
    error,
    notificationSettings,
    storageLocations,
    isLoadingPreferences,
    loadPreferences,
    updateNotificationSettings,
  ]);

  return (
    <ConfigContext.Provider value={value}>
      {children}
    </ConfigContext.Provider>
  );
}

export function useConfig() {
  const context = useContext(ConfigContext);
  if (context === undefined) {
    throw new Error('useConfig must be used within a ConfigProvider');
  }
  return context;
}

export function useOptionalConfig() {
  return useContext(ConfigContext);
}
