import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { Alert, AlertDescription } from './ui/alert';
import { Eye, EyeOff, Lock, Unlock, Check, CircleHelp, ExternalLink } from 'lucide-react';
import { ModelManager } from './WhisperModelManager';
import { ParakeetModelManager } from './ParakeetModelManager';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { useOptionalConfig } from '@/contexts/ConfigContext';

const GROQ_KEYS_URL = 'https://console.groq.com/keys';
const GROQ_PRICING_URL = 'https://groq.com/pricing';

export interface TranscriptModelProps {
    provider: 'localWhisper' | 'parakeet' | 'deepgram' | 'elevenLabs' | 'groq' | 'openai';
    model: string;
    apiKey?: string | null;
}

export interface TranscriptSettingsProps {
    transcriptModelConfig: TranscriptModelProps;
    setTranscriptModelConfig: (config: TranscriptModelProps) => void;
    onModelSelect?: () => void;
}

export function TranscriptSettings({ transcriptModelConfig, setTranscriptModelConfig, onModelSelect }: TranscriptSettingsProps) {
    const configContext = useOptionalConfig();
    const updateProviderApiKey = configContext?.updateProviderApiKey;
    const [apiKey, setApiKey] = useState<string | null>(transcriptModelConfig.apiKey || null);
    const [showApiKey, setShowApiKey] = useState<boolean>(false);
    const [isApiKeyLocked, setIsApiKeyLocked] = useState<boolean>(!!transcriptModelConfig.apiKey);
    const [isLockButtonVibrating, setIsLockButtonVibrating] = useState<boolean>(false);
    const [uiProvider, setUiProvider] = useState<TranscriptModelProps['provider']>(transcriptModelConfig.provider);
    const [isSaved, setIsSaved] = useState<boolean>(false);

    // Sync uiProvider when backend config changes (e.g., after model selection or initial load)
    useEffect(() => {
        setUiProvider(transcriptModelConfig.provider);
    }, [transcriptModelConfig.provider]);

    // Sync apiKey from config when it changes (e.g., after async DB load on mount)
    useEffect(() => {
        setApiKey(transcriptModelConfig.apiKey || null);
        setIsApiKeyLocked(!!transcriptModelConfig.apiKey);
    }, [transcriptModelConfig.apiKey]);

    useEffect(() => {
        if (transcriptModelConfig.provider === 'localWhisper' || transcriptModelConfig.provider === 'parakeet') {
            setApiKey(null);
        }
        // Lock only if a key is already saved for this provider
        setIsApiKeyLocked(!!transcriptModelConfig.apiKey);
    }, [transcriptModelConfig.provider]);

    const isSharedProvider = (provider: string) => provider === 'groq' || provider === 'openai';

    const fetchApiKey = async (provider: string) => {
        try {
            const data = await invoke('api_get_transcript_api_key', { provider }) as string | null;
            const normalizedApiKey = data || null;
            setApiKey(normalizedApiKey);
            if (updateProviderApiKey && isSharedProvider(provider)) {
                updateProviderApiKey(provider, normalizedApiKey);
            }
        } catch (err) {
            console.error('Error fetching API key:', err);
            setApiKey(null);
        }
    };
    const modelOptions = {
        localWhisper: [], // Model selection handled by ModelManager component
        parakeet: [], // Model selection handled by ParakeetModelManager component
        deepgram: ['nova-2-phonecall'],
        elevenLabs: ['eleven_multilingual_v2'],
        groq: ['whisper-large-v3-turbo', 'whisper-large-v3'],
        openai: ['gpt-4o'],
    };
    const requiresApiKey = uiProvider === 'deepgram' || uiProvider === 'elevenLabs' || uiProvider === 'openai' || uiProvider === 'groq';
    const modelListTooltip = uiProvider === 'groq'
        ? "Groq transcript models use the built-in supported list in this screen. This dropdown does not auto-refresh from Groq's API."
        : null;

    const openExternalUrl = async (url: string) => {
        try {
            await invoke('open_external_url', { url });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            toast.error('Failed to open link', { description: message });
        }
    };

    const handleInputClick = () => {
        if (isApiKeyLocked) {
            setIsLockButtonVibrating(true);
            setTimeout(() => setIsLockButtonVibrating(false), 500);
        }
    };

    const handleWhisperModelSelect = (modelName: string) => {
        // Always update config when model is selected, regardless of current provider
        // This ensures the model is set when user switches back
        setTranscriptModelConfig({
            ...transcriptModelConfig,
            provider: 'localWhisper', // Ensure provider is set correctly
            model: modelName
        });
        // Close modal after selection
        if (onModelSelect) {
            onModelSelect();
        }
    };

    const handleParakeetModelSelect = (modelName: string) => {
        // Always update config when model is selected, regardless of current provider
        // This ensures the model is set when user switches back
        setTranscriptModelConfig({
            ...transcriptModelConfig,
            provider: 'parakeet', // Ensure provider is set correctly
            model: modelName
        });
        // Close modal after selection
        if (onModelSelect) {
            onModelSelect();
        }
    };

    const handleSaveApiKey = async () => {
        const normalizedApiKey = typeof apiKey === 'string' ? apiKey.trim() || null : null;
        const payload = { provider: uiProvider, model: transcriptModelConfig.model, apiKey: normalizedApiKey };
        console.log('[TranscriptSettings] Saving transcript config:', { provider: payload.provider, model: payload.model, hasKey: !!payload.apiKey });
        try {
            await invoke('api_save_transcript_config', {
                provider: payload.provider,
                model: payload.model,
                apiKey: payload.apiKey,
            });
            console.log('[TranscriptSettings] Save succeeded');
            setTranscriptModelConfig({ ...transcriptModelConfig, provider: uiProvider, apiKey: normalizedApiKey });
            if (updateProviderApiKey && isSharedProvider(uiProvider)) {
                updateProviderApiKey(uiProvider, normalizedApiKey);
            }
            setIsApiKeyLocked(true);
            setIsSaved(true);
            setTimeout(() => setIsSaved(false), 2000);
            toast.success('API key saved');
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error('[TranscriptSettings] Error saving API key:', err);
            toast.error('Failed to save API key', { description: message });
        }
    };

    return (
        <div>
            <div>
                {/* <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-semibold text-gray-900">Transcript Settings</h3>
                </div> */}
                <div className="space-y-4 pb-6">
                    <div>
                        <Label className="block text-sm font-medium text-gray-700 mb-1">
                            Transcript Model
                        </Label>
                        <div className="flex space-x-2 mx-1">
                            <Select
                                value={uiProvider}
                                onValueChange={(value) => {
                                    const provider = value as TranscriptModelProps['provider'];
                                    setUiProvider(provider);
                                    if (provider !== 'localWhisper' && provider !== 'parakeet') {
                                        fetchApiKey(provider);
                                    }
                                    if (provider === 'groq') {
                                        setTranscriptModelConfig({ ...transcriptModelConfig, provider, model: 'whisper-large-v3-turbo' });
                                    }
                                }}
                            >
                                <SelectTrigger className='focus:ring-1 focus:ring-blue-500 focus:border-blue-500'>
                                    <SelectValue placeholder="Select provider" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="parakeet">⚡ Parakeet (Recommended - Real-time / Accurate)</SelectItem>
                                    <SelectItem value="localWhisper">🏠 Local Whisper (High Accuracy)</SelectItem>
                                    <SelectItem value="groq">☁️ Groq Whisper (Cloud - Fast)</SelectItem>
                                    {/* <SelectItem value="deepgram">☁️ Deepgram (Backup)</SelectItem>
                                    <SelectItem value="elevenLabs">☁️ ElevenLabs</SelectItem>
                                    <SelectItem value="openai">☁️ OpenAI</SelectItem> */}
                                </SelectContent>
                            </Select>

                            {uiProvider !== 'localWhisper' && uiProvider !== 'parakeet' && (
                                <div className="flex items-center gap-2">
                                    <Select
                                        value={transcriptModelConfig.model}
                                        onValueChange={(value) => {
                                            const model = value as TranscriptModelProps['model'];
                                            setTranscriptModelConfig({ ...transcriptModelConfig, provider: uiProvider, model });
                                        }}
                                    >
                                        <SelectTrigger className='focus:ring-1 focus:ring-blue-500 focus:border-blue-500'>
                                            <SelectValue placeholder="Select model" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {modelOptions[uiProvider].map((model) => (
                                                <SelectItem key={model} value={model}>{model}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>

                                    {modelListTooltip && (
                                        <TooltipProvider>
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <button
                                                        type="button"
                                                        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-input bg-background text-muted-foreground transition-colors hover:text-foreground"
                                                        aria-label="How transcript model loading works"
                                                    >
                                                        <CircleHelp className="h-4 w-4" />
                                                    </button>
                                                </TooltipTrigger>
                                                <TooltipContent className="max-w-xs leading-relaxed">
                                                    {modelListTooltip}
                                                </TooltipContent>
                                            </Tooltip>
                                        </TooltipProvider>
                                    )}
                                </div>
                            )}

                        </div>
                        {uiProvider === 'groq' && (
                            <div className="mt-2 mx-1 space-y-2">
                                <p className="text-xs text-amber-600">
                                    Audio is sent to Groq&apos;s servers for transcription and permanently deleted after processing. See groq.com/privacy.
                                </p>
                                <Alert className="border-blue-200 bg-blue-50">
                                    <AlertDescription className="space-y-3 text-blue-900">
                                        <p className="text-xs leading-relaxed">
                                            Need a Groq key? Testers can create one in Groq Console and use Groq&apos;s Free plan for evaluation, subject to Groq rate limits.
                                        </p>
                                        <div className="flex flex-wrap gap-2">
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="outline"
                                                className="border-blue-300 bg-white text-blue-900 hover:bg-blue-100"
                                                onClick={() => openExternalUrl(GROQ_KEYS_URL)}
                                            >
                                                <ExternalLink className="mr-2 h-4 w-4" />
                                                Get Groq API Key
                                            </Button>
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="outline"
                                                className="border-blue-300 bg-white text-blue-900 hover:bg-blue-100"
                                                onClick={() => openExternalUrl(GROQ_PRICING_URL)}
                                            >
                                                <ExternalLink className="mr-2 h-4 w-4" />
                                                View Groq Free Plan
                                            </Button>
                                        </div>
                                    </AlertDescription>
                                </Alert>
                            </div>
                        )}
                    </div>

                    {uiProvider === 'localWhisper' && (
                        <div className="mt-6">
                            <ModelManager
                                selectedModel={transcriptModelConfig.provider === 'localWhisper' ? transcriptModelConfig.model : undefined}
                                onModelSelect={handleWhisperModelSelect}
                                autoSave={true}
                            />
                        </div>
                    )}

                    {uiProvider === 'parakeet' && (
                        <div className="mt-6">
                            <ParakeetModelManager
                                selectedModel={transcriptModelConfig.provider === 'parakeet' ? transcriptModelConfig.model : undefined}
                                onModelSelect={handleParakeetModelSelect}
                                autoSave={true}
                            />
                        </div>
                    )}


                    {requiresApiKey && (
                        <div>
                            <Label className="block text-sm font-medium text-gray-700 mb-1">
                                API Key
                            </Label>
                            <div className="relative mx-1">
                                <Input
                                    type={showApiKey ? "text" : "password"}
                                    className={`pr-24 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 ${isApiKeyLocked ? 'bg-gray-100 cursor-not-allowed' : ''
                                        }`}
                                    value={apiKey || ''}
                                    onChange={(e) => setApiKey(e.target.value)}
                                    disabled={isApiKeyLocked}
                                    onClick={handleInputClick}
                                    placeholder="Enter your API key"
                                />
                                {isApiKeyLocked && (
                                    <div
                                        onClick={handleInputClick}
                                        className="absolute inset-0 flex items-center justify-center bg-gray-100 bg-opacity-50 rounded-md cursor-not-allowed"
                                    />
                                )}
                                <div className="absolute inset-y-0 right-0 pr-1 flex items-center">
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => setIsApiKeyLocked(!isApiKeyLocked)}
                                        className={`transition-colors duration-200 ${isLockButtonVibrating ? 'animate-vibrate text-red-500' : ''
                                            }`}
                                        title={isApiKeyLocked ? "Unlock to edit" : "Lock to prevent editing"}
                                    >
                                        {isApiKeyLocked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => setShowApiKey(!showApiKey)}
                                    >
                                        {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                    </Button>
                                </div>
                            </div>
                            {!isApiKeyLocked && (
                                <Button
                                    type="button"
                                    size="sm"
                                    onClick={handleSaveApiKey}
                                    className="mt-2 mx-1"
                                    disabled={!apiKey}
                                >
                                    {isSaved ? <><Check className="h-4 w-4 mr-1" />Saved</> : 'Save API Key'}
                                </Button>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div >
    )
}





