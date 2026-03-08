'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { File, Settings, PanelLeftClose, PanelLeftOpen, Home, Trash2, Mic, Square, Pencil, SearchIcon, X, Upload, FolderOpen, ChevronDown } from 'lucide-react';
import { useRouter, usePathname } from 'next/navigation';
import { useSidebar } from './SidebarProvider';
import type { CurrentMeeting } from '@/components/Sidebar/SidebarProvider';
import { ConfirmationModal } from '../ConfirmationModel/confirmation-modal';
import { ModelConfig } from '@/components/ModelSettingsModal';
import { SettingTabs } from '../SettingTabs';
import { TranscriptModelProps } from '@/components/TranscriptSettings';
import Analytics from '@/lib/analytics';
import { invoke } from '@tauri-apps/api/core';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { useRecordingState } from '@/contexts/RecordingStateContext';
import { useImportDialog } from '@/contexts/ImportDialogContext';
import { useConfig } from '@/contexts/ConfigContext';
import { safelyUnlisten } from '@/lib/tauriEvents';
import {
  DEFAULT_GROQ_SUMMARY_MODEL,
  DEFAULT_GROQ_TRANSCRIPT_MODEL,
  DEFAULT_SUMMARY_PROVIDER,
  DEFAULT_TRANSCRIPT_PROVIDER,
  DEFAULT_WHISPER_MODEL,
} from '@/constants/modelDefaults';

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog"
import { VisuallyHidden } from "@/components/ui/visually-hidden"

import { MessageToast } from '../MessageToast';
import Logo from '../Logo';
import Info from '../Info';
import { ComplianceNotification } from '../ComplianceNotification';
import { Input } from '../ui/input';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '../ui/input-group';

interface SidebarItem {
  id: string;
  title: string;
  type: 'folder' | 'file';
  children?: SidebarItem[];
}

const Sidebar: React.FC = () => {
  const router = useRouter();
  const pathname = usePathname();
  const {
    currentMeeting,
    setCurrentMeeting,
    sidebarItems,
    isCollapsed,
    toggleCollapse,
    handleRecordingToggle,
    searchTranscripts,
    searchResults,
    isSearching,
    meetings,
    setMeetings,
    serverAddress
  } = useSidebar();

  // Get recording state from RecordingStateContext (single source of truth)
  const { isRecording } = useRecordingState();
  const { openImportDialog } = useImportDialog();
  const { betaFeatures } = useConfig();
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['meetings']));
  const [meetingsExpanded, setMeetingsExpanded] = useState(true);
  const [showAllMeetings, setShowAllMeetings] = useState(false);
  const MEETINGS_PREVIEW_COUNT = 10;
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showModelSettings, setShowModelSettings] = useState(false);
  const [modelConfig, setModelConfig] = useState<ModelConfig>({
    provider: DEFAULT_SUMMARY_PROVIDER,
    model: DEFAULT_GROQ_SUMMARY_MODEL,
    whisperModel: DEFAULT_WHISPER_MODEL,
    apiKey: null,
    ollamaEndpoint: null
  });
  const [transcriptModelConfig, setTranscriptModelConfig] = useState<TranscriptModelProps>({
    provider: DEFAULT_TRANSCRIPT_PROVIDER,
    model: DEFAULT_GROQ_TRANSCRIPT_MODEL,
  });
  const [settingsSaveSuccess, setSettingsSaveSuccess] = useState<boolean | null>(null);
  const isHomePage = pathname === '/';

  // State for edit modal
  const [editModalState, setEditModalState] = useState<{ isOpen: boolean; meetingId: string | null; currentTitle: string }>({
    isOpen: false,
    meetingId: null,
    currentTitle: ''
  });
  const [editingTitle, setEditingTitle] = useState<string>('');

  // useEffect(() => {
  //   if (settingsSaveSuccess !== null) {
  //     const timer = setTimeout(() => {
  //       setSettingsSaveSuccess(null);
  //     }, 3000);
  //   }
  // }, [settingsSaveSuccess]);


  const [deleteModalState, setDeleteModalState] = useState<{ isOpen: boolean; itemId: string | null }>({ isOpen: false, itemId: null });

  useEffect(() => {
    // Note: Don't set hardcoded defaults - let DB be the source of truth
    const fetchModelConfig = async () => {
      // Only make API call if serverAddress is loaded
      if (!serverAddress) {
        console.log('Waiting for server address to load before fetching model config');
        return;
      }

      try {
        const data = await invoke('api_get_model_config') as any;
        if (data && data.provider !== null) {
          // Fetch API key if not included and provider requires it
          if (data.provider !== 'ollama' && !data.apiKey) {
            try {
              const apiKeyData = await invoke('api_get_api_key', {
                provider: data.provider
              }) as string;
              data.apiKey = apiKeyData;
            } catch (err) {
              console.error('Failed to fetch API key:', err);
            }
          }
          setModelConfig(data);
        }
      } catch (error) {
        console.error('Failed to fetch model config:', error);
      }
    };

    fetchModelConfig();
  }, [serverAddress]);


  useEffect(() => {
    // Note: Don't set hardcoded defaults - let DB be the source of truth
    const fetchTranscriptSettings = async () => {
      // Only make API call if serverAddress is loaded
      if (!serverAddress) {
        console.log('Waiting for server address to load before fetching transcript settings');
        return;
      }

      try {
        const data = await invoke('api_get_transcript_config') as any;
        if (data && data.provider !== null) {
          setTranscriptModelConfig(data);
        }
      } catch (error) {
        console.error('Failed to fetch transcript settings:', error);
      }
    };
    fetchTranscriptSettings();
  }, [serverAddress]);

  // Listen for model config updates from other components
  useEffect(() => {
    const setupListener = async () => {
      const { listen } = await import('@tauri-apps/api/event');
      const unlisten = await listen<ModelConfig>('model-config-updated', (event) => {
        console.log('Sidebar received model-config-updated event:', event.payload);
        setModelConfig(event.payload);
      });

      return unlisten;
    };

    let cleanup: (() => void) | undefined;
    setupListener().then(fn => cleanup = fn);

    return () => {
      safelyUnlisten(cleanup, 'sidebar:model-config-updated');
    };
  }, []);



  // Handle model config save
  const handleSaveModelConfig = async (config: ModelConfig) => {
    try {
      await invoke('api_save_model_config', {
        provider: config.provider,
        model: config.model,
        whisperModel: config.whisperModel,
        apiKey: config.apiKey,
        ollamaEndpoint: config.ollamaEndpoint,
      });

      setModelConfig(config);
      console.log('Model config saved successfully');
      setSettingsSaveSuccess(true);

      // Emit event to sync other components
      const { emit } = await import('@tauri-apps/api/event');
      await emit('model-config-updated', config);

      // Track settings change
      await Analytics.trackSettingsChanged('model_config', `${config.provider}_${config.model}`);
    } catch (error) {
      console.error('Error saving model config:', error);
      setSettingsSaveSuccess(false);
    }
  };

  const handleSaveTranscriptConfig = async (updatedConfig?: TranscriptModelProps) => {
    try {
      const configToSave = updatedConfig || transcriptModelConfig;
      const payload = {
        provider: configToSave.provider,
        model: configToSave.model,
        apiKey: configToSave.apiKey ?? null
      };
      console.log('Saving transcript config with payload:', payload);

      await invoke('api_save_transcript_config', {
        provider: payload.provider,
        model: payload.model,
        apiKey: payload.apiKey,
      });


      setSettingsSaveSuccess(true);

      // Track settings change
      const transcriptConfigToSave = updatedConfig || transcriptModelConfig;
      await Analytics.trackSettingsChanged('transcript_config', `${transcriptConfigToSave.provider}_${transcriptConfigToSave.model}`);
    } catch (error) {
      console.error('Failed to save transcript config:', error);
      setSettingsSaveSuccess(false);
    }
  };

  // Handle search input changes
  const handleSearchChange = useCallback(async (value: string) => {
    setSearchQuery(value);

    // If search query is empty, just return to normal view
    if (!value.trim()) return;

    // Search through transcripts
    await searchTranscripts(value);

    // Make sure the meetings folder is expanded when searching
    if (!expandedFolders.has('meetings')) {
      const newExpanded = new Set(expandedFolders);
      newExpanded.add('meetings');
      setExpandedFolders(newExpanded);
    }
  }, [expandedFolders, searchTranscripts]);

  // Combine search results with sidebar items
  const filteredSidebarItems = useMemo(() => {
    if (!searchQuery.trim()) return sidebarItems;

    // If we have search results, highlight matching meetings
    if (searchResults.length > 0) {
      // Get the IDs of meetings that matched in transcripts
      const matchedMeetingIds = new Set(searchResults.map(result => result.id));

      return sidebarItems
        .map(folder => {
          // Always include folders in the results
          if (folder.type === 'folder') {
            if (!folder.children) return folder;

            // Filter children based on search results or title match
            const filteredChildren = folder.children.filter(item => {
              // Include if the meeting ID is in our search results
              if (matchedMeetingIds.has(item.id)) return true;

              // Or if the title matches the search query
              return item.title.toLowerCase().includes(searchQuery.toLowerCase());
            });

            return {
              ...folder,
              children: filteredChildren
            };
          }

          // For non-folder items, check if they match the search
          return (matchedMeetingIds.has(folder.id) ||
            folder.title.toLowerCase().includes(searchQuery.toLowerCase()))
            ? folder : undefined;
        })
        .filter((item): item is SidebarItem => item !== undefined); // Type-safe filter
    } else {
      // Fall back to title-only filtering if no transcript results
      return sidebarItems
        .map(folder => {
          // Always include folders in the results
          if (folder.type === 'folder') {
            if (!folder.children) return folder;

            // Filter children based on search query
            const filteredChildren = folder.children.filter(item =>
              item.title.toLowerCase().includes(searchQuery.toLowerCase())
            );

            return {
              ...folder,
              children: filteredChildren
            };
          }

          // For non-folder items, check if they match the search
          return folder.title.toLowerCase().includes(searchQuery.toLowerCase()) ? folder : undefined;
        })
        .filter((item): item is SidebarItem => item !== undefined); // Type-safe filter
    }
  }, [sidebarItems, searchQuery, searchResults, expandedFolders]);

  // Derive the flat meeting items list from filtered sidebar items
  const meetingItems = useMemo(() => {
    const folder = filteredSidebarItems.find(item => item.type === 'folder' && item.id === 'meetings');
    return folder?.children ?? [];
  }, [filteredSidebarItems]);

  const visibleMeetings = useMemo(
    () => showAllMeetings ? meetingItems : meetingItems.slice(0, MEETINGS_PREVIEW_COUNT),
    [meetingItems, showAllMeetings]
  );

  const handleDelete = async (itemId: string) => {
    console.log('Deleting item:', itemId);
    const payload = {
      meetingId: itemId
    };

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('api_delete_meeting', {
        meetingId: itemId,
      });
      console.log('Meeting deleted successfully');
      const updatedMeetings = meetings.filter((m: CurrentMeeting) => m.id !== itemId);
      setMeetings(updatedMeetings);

      // Track meeting deletion
      Analytics.trackMeetingDeleted(itemId);

      // Show success toast
      toast.success("Meeting deleted successfully", {
        description: "All associated data has been removed"
      });

      // If deleting the active meeting, navigate to home
      if (currentMeeting?.id === itemId) {
        setCurrentMeeting({ id: 'intro-call', title: '+ New Call' });
        router.push('/');
      }
    } catch (error) {
      console.error('Failed to delete meeting:', error);
      toast.error("Failed to delete meeting", {
        description: error instanceof Error ? error.message : String(error)
      });
    }
  };

  const handleDeleteConfirm = () => {
    if (deleteModalState.itemId) {
      handleDelete(deleteModalState.itemId);
    }
    setDeleteModalState({ isOpen: false, itemId: null });
  };

  // Handle modal editing of meeting names
  const handleEditStart = (meetingId: string, currentTitle: string) => {
    setEditModalState({
      isOpen: true,
      meetingId: meetingId,
      currentTitle: currentTitle
    });
    setEditingTitle(currentTitle);
  };

  const handleEditConfirm = async () => {
    const newTitle = editingTitle.trim();
    const meetingId = editModalState.meetingId;

    if (!meetingId) return;

    // Prevent empty titles
    if (!newTitle) {
      toast.error("Meeting title cannot be empty");
      return;
    }

    try {
      await invoke('api_save_meeting_title', {
        meetingId: meetingId,
        title: newTitle,
      });

      // Update local state
      const updatedMeetings = meetings.map((m: CurrentMeeting) =>
        m.id === meetingId ? { ...m, title: newTitle } : m
      );
      setMeetings(updatedMeetings);

      // Update current meeting if it's the one being edited
      if (currentMeeting?.id === meetingId) {
        setCurrentMeeting({ id: meetingId, title: newTitle });
      }

      // Track the edit
      Analytics.trackButtonClick('edit_meeting_title', 'sidebar');

      toast.success("Meeting title updated successfully");

      // Close modal and reset state
      setEditModalState({ isOpen: false, meetingId: null, currentTitle: '' });
      setEditingTitle('');
    } catch (error) {
      console.error('Failed to update meeting title:', error);
      toast.error("Failed to update meeting title", {
        description: error instanceof Error ? error.message : String(error)
      });
    }
  };

  const handleEditCancel = () => {
    setEditModalState({ isOpen: false, meetingId: null, currentTitle: '' });
    setEditingTitle('');
  };

  const toggleFolder = (folderId: string) => {
    // Normal toggle behavior for all folders
    const newExpanded = new Set(expandedFolders);
    if (newExpanded.has(folderId)) {
      newExpanded.delete(folderId);
    } else {
      newExpanded.add(folderId);
    }
    setExpandedFolders(newExpanded);
  };

  // Expose setShowModelSettings to window for Rust tray to call
  useEffect(() => {
    (window as any).openSettings = () => {
      setShowModelSettings(true);
    };

    // Cleanup on unmount
    return () => {
      delete (window as any).openSettings;
    };
  }, []);

  // Find matching transcript snippet for a meeting item
  const findMatchingSnippet = (itemId: string) => {
    if (!searchQuery.trim() || !searchResults.length) return null;
    return searchResults.find(result => result.id === itemId);
  };

  const renderItem = (item: SidebarItem, depth = 0) => {
    const isActive = item.type === 'file' && currentMeeting?.id === item.id;
    const isMeetingItem = item.type === 'file' && item.id.includes('-') && !item.id.startsWith('intro-call');
    const matchingResult = isMeetingItem ? findMatchingSnippet(item.id) : null;
    const hasTranscriptMatch = !!matchingResult;

    if (item.type !== 'file') return null;

    // Collapsed: icon-only with tooltip
    if (isCollapsed) {
      return (
        <Tooltip key={item.id}>
          <TooltipTrigger asChild>
            <div
              className={`flex items-center justify-center p-2 rounded-lg my-0.5 cursor-pointer transition-colors ${
                isActive ? 'bg-blue-100 text-blue-700' : 'hover:bg-gray-100 text-gray-500'
              }`}
              onClick={() => {
                setCurrentMeeting({ id: item.id, title: item.title });
                const path = item.id.startsWith('intro-call') ? '/' : `/meeting-details?id=${item.id}`;
                router.push(path);
              }}
            >
              <File className="w-4 h-4" />
            </div>
          </TooltipTrigger>
          <TooltipContent side="right"><p>{item.title}</p></TooltipContent>
        </Tooltip>
      );
    }

    // Expanded: full item with label + actions
    return (
      <div key={item.id}>
        <div
          className={`flex items-center px-3 py-2 my-0.5 rounded-lg text-sm cursor-pointer group transition-colors ${
            isActive ? 'bg-blue-100 text-blue-700 font-medium' :
            hasTranscriptMatch ? 'bg-yellow-50 hover:bg-yellow-100' : 'hover:bg-gray-100 text-gray-700'
          }`}
          onClick={() => {
            setCurrentMeeting({ id: item.id, title: item.title });
            const path = item.id.startsWith('intro-call') ? '/' : `/meeting-details?id=${item.id}`;
            router.push(path);
          }}
        >
          <File className="w-3.5 h-3.5 flex-shrink-0 mr-2 text-gray-400" />
          <span className="flex-1 truncate">{item.title}</span>
          {isMeetingItem && (
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
              <button
                onClick={(e) => { e.stopPropagation(); handleEditStart(item.id, item.title); }}
                className="hover:text-blue-600 p-1 rounded hover:bg-blue-50"
                aria-label="Edit meeting title"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setDeleteModalState({ isOpen: true, itemId: item.id }); }}
                className="hover:text-red-600 p-1 rounded hover:bg-red-50"
                aria-label="Delete meeting"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
        {hasTranscriptMatch && (
          <div className="mx-3 mb-1 text-xs text-gray-500 bg-yellow-50 p-1.5 rounded border border-yellow-100 line-clamp-2">
            <span className="font-medium text-yellow-600">Match:</span> {matchingResult.matchContext}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
    <div
      className={`sticky top-0 h-screen flex-shrink-0 bg-white border-r shadow-sm flex flex-col transition-all duration-300 overflow-hidden z-40 ${
        isCollapsed ? 'w-14' : 'w-56'
      }`}
    >
        {/* Header: Logo + toggle button */}
        <div className="flex items-center justify-between px-3 py-3 flex-shrink-0">
          <Logo isCollapsed={isCollapsed} />
          <button
            onClick={toggleCollapse}
            className="p-1.5 rounded-md hover:bg-gray-100 text-gray-500 flex-shrink-0 transition-colors"
            aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {isCollapsed
              ? <PanelLeftOpen className="w-4 h-4" />
              : <PanelLeftClose className="w-4 h-4" />}
          </button>
        </div>

        {/* Search */}
        <div className="px-2 mb-1 flex-shrink-0">
          {isCollapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={toggleCollapse}
                  className="flex items-center justify-center w-full p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors"
                >
                  <SearchIcon className="w-4 h-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right"><p>Search</p></TooltipContent>
            </Tooltip>
          ) : (
            <InputGroup>
              <InputGroupInput
                placeholder='Search meeting content...'
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
              />
              <InputGroupAddon><SearchIcon /></InputGroupAddon>
              {searchQuery && (
                <InputGroupAddon align={'inline-end'}>
                  <InputGroupButton onClick={() => handleSearchChange('')}><X /></InputGroupButton>
                </InputGroupAddon>
              )}
            </InputGroup>
          )}
        </div>

        {/* Top nav items */}
        <div className="flex-shrink-0 px-2 space-y-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => router.push('/')}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg w-full text-sm transition-colors ${
                  isHomePage ? 'bg-gray-100 font-medium text-gray-900' : 'hover:bg-gray-100 text-gray-700'
                }`}
              >
                <Home className="w-4 h-4 flex-shrink-0" />
                {!isCollapsed && <span>Home</span>}
              </button>
            </TooltipTrigger>
            {isCollapsed && <TooltipContent side="right"><p>Home</p></TooltipContent>}
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleRecordingToggle}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg w-full text-sm transition-colors ${
                  isRecording
                    ? 'text-red-500 bg-red-50 hover:bg-red-100'
                    : 'text-gray-700 hover:bg-red-50 hover:text-red-600'
                }`}
              >
                {isRecording
                  ? <Square className="w-4 h-4 flex-shrink-0" />
                  : <Mic className="w-4 h-4 flex-shrink-0" />}
                {!isCollapsed && (
                  <span>{isRecording ? 'Recording in progress...' : 'Start Recording'}</span>
                )}
              </button>
            </TooltipTrigger>
            {isCollapsed && (
              <TooltipContent side="right">
                <p>{isRecording ? 'Recording in progress...' : 'Start Recording'}</p>
              </TooltipContent>
            )}
          </Tooltip>
        </div>

        {/* Meetings section */}
        <div className="flex-1 flex flex-col min-h-0 mt-3 overflow-hidden">
          {isCollapsed ? (
            // Collapsed: single Meetings icon, clicking expands sidebar + ensures meetings list is open
            <div className="px-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => { setMeetingsExpanded(true); toggleCollapse(); }}
                    className="flex items-center gap-3 px-3 py-2 rounded-lg w-full text-sm hover:bg-gray-100 text-gray-500 transition-colors"
                  >
                    <FolderOpen className="w-4 h-4 flex-shrink-0" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right"><p>Meetings</p></TooltipContent>
              </Tooltip>
            </div>
          ) : (
            <>
              {/* Collapsible section header */}
              <button
                className="flex items-center gap-1 w-full px-3 py-0.5 mb-1 rounded hover:bg-gray-50 flex-shrink-0 group"
                onClick={() => setMeetingsExpanded(e => !e)}
              >
                <p className="text-xs font-medium uppercase tracking-wider text-gray-400 flex-1 text-left">
                  Meetings
                </p>
                {searchQuery && isSearching && (
                  <span className="text-xs text-blue-400 animate-pulse mr-1">Searching...</span>
                )}
                <ChevronDown className={`w-3 h-3 text-gray-400 transition-transform duration-200 flex-shrink-0 ${meetingsExpanded ? '' : '-rotate-90'}`} />
              </button>

              {meetingsExpanded && (
                <div className="flex-1 overflow-y-auto custom-scrollbar min-h-0 px-2">
                  {visibleMeetings.map(child => renderItem(child, 0))}
                  {!showAllMeetings && meetingItems.length > MEETINGS_PREVIEW_COUNT && (
                    <button
                      className="w-full text-left px-3 py-1.5 text-xs text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-lg transition-colors"
                      onClick={() => setShowAllMeetings(true)}
                    >
                      Show {meetingItems.length - MEETINGS_PREVIEW_COUNT} more…
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 border-t border-gray-100 px-2 py-2 space-y-0.5">
          {betaFeatures.importAndRetranscribe && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => openImportDialog()}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg w-full text-sm hover:bg-gray-100 text-gray-700 transition-colors"
                >
                  <Upload className="w-4 h-4 flex-shrink-0" />
                  {!isCollapsed && <span>Import Audio</span>}
                </button>
              </TooltipTrigger>
              {isCollapsed && <TooltipContent side="right"><p>Import Audio</p></TooltipContent>}
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => router.push('/settings')}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg w-full text-sm transition-colors ${
                  pathname === '/settings' ? 'bg-gray-100 font-medium text-gray-900' : 'hover:bg-gray-100 text-gray-700'
                }`}
              >
                <Settings className="w-4 h-4 flex-shrink-0" />
                {!isCollapsed && <span>Settings</span>}
              </button>
            </TooltipTrigger>
            {isCollapsed && <TooltipContent side="right"><p>Settings</p></TooltipContent>}
          </Tooltip>
          <Info isCollapsed={isCollapsed} />
            <div className="w-full flex items-center justify-center px-3 py-1 text-xs text-gray-400">
              v0.4.0
            </div>
        </div>
      </div>

      {/* Confirmation Modal for Delete */}
      <ConfirmationModal
        isOpen={deleteModalState.isOpen}
        text="Are you sure you want to delete this meeting? This action cannot be undone."
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteModalState({ isOpen: false, itemId: null })}
      />

      {/* Edit Meeting Title Modal */}
      <Dialog open={editModalState.isOpen} onOpenChange={(open) => {
        if (!open) handleEditCancel();
      }}>
        <DialogContent className="sm:max-w-[425px]">
          <VisuallyHidden>
            <DialogTitle>Edit Meeting Title</DialogTitle>
          </VisuallyHidden>
          <div className="py-4">
            <h3 className="text-lg font-semibold mb-4">Edit Meeting Title</h3>
            <div className="space-y-4">
              <div>
                <label htmlFor="meeting-title" className="block text-sm font-medium text-gray-700 mb-2">
                  Meeting Title
                </label>
                <input
                  id="meeting-title"
                  type="text"
                  value={editingTitle}
                  onChange={(e) => setEditingTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleEditConfirm();
                    } else if (e.key === 'Escape') {
                      handleEditCancel();
                    }
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Enter meeting title"
                  autoFocus
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <button
              onClick={handleEditCancel}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleEditConfirm}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors"
            >
              Save
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default Sidebar;
