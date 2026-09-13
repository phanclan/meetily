'use client';
import { NoteFolderSidebar } from '@/components/NoteFolderControls';

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { File, Settings, Home, Trash2, Mic, Pencil, SearchIcon, X, Upload, FolderOpen, ChevronDown, MoreHorizontal, MessageCircle, PanelLeftClose } from 'lucide-react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useSidebar } from './SidebarProvider';
import type { CurrentMeeting } from '@/components/Sidebar/SidebarProvider';
import { ConfirmationModal } from '../ConfirmationModel/confirmation-modal';
import { ModelConfig } from '@/components/ModelSettingsModal';
import { SettingTabs } from '../SettingTabs';
import { TranscriptModelProps } from '@/components/TranscriptSettings';
import Analytics from '@/lib/analytics';
import { groupMeetingsByTimeRange } from '@/lib/meetingTimeline';
import { invoke } from '@tauri-apps/api/core';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { useRecordingState } from '@/contexts/RecordingStateContext';
import { useImportDialog } from '@/contexts/ImportDialogContext';
import { useConfig } from '@/contexts/ConfigContext';
import { safelyUnlisten } from '@/lib/tauriEvents';
import {
  DEFAULT_SUMMARY_MODEL,
  DEFAULT_SUMMARY_PROVIDER,
  DEFAULT_TRANSCRIPT_MODEL,
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
import Info from '../Info';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { ComplianceNotification } from '../ComplianceNotification';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '../ui/input-group';
import { cn } from '@/lib/utils';
import { homeAskPath, isHomeAskOpen } from '@/lib/askRoute';
import { createSavedNotePath } from '@/lib/savedNoteRoute';
import { RECORDING_ROUTE } from '@/lib/quickNoteRoute';

function RailItem({
  icon,
  label,
  collapsed,
  onClick,
  active = false,
  className,
  ariaLabel,
  ariaCurrent,
  ariaExpanded,
}: {
  icon: React.ReactNode;
  label: string;
  collapsed: boolean;
  onClick: () => void;
  active?: boolean;
  className?: string;
  ariaLabel?: string;
  ariaCurrent?: 'page';
  ariaExpanded?: boolean;
}) {
  const button = (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel ?? label}
      aria-current={ariaCurrent}
      aria-expanded={ariaExpanded}
      className={cn(
        'rail-item text-sm transition-colors',
        active ? 'bg-gray-100 font-medium text-gray-900' : 'text-gray-700 hover:bg-gray-100',
        className,
      )}
    >
      <span className="rail-item-icon">{icon}</span>
      {!collapsed && <span className="rail-item-label">{label}</span>}
    </button>
  );

  if (!collapsed) return button;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right"><p>{label}</p></TooltipContent>
    </Tooltip>
  );
}

interface SidebarItem {
  id: string;
  title: string;
  type: 'folder' | 'file';
  children?: SidebarItem[];
}

const Sidebar: React.FC = () => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const askOpen = isHomeAskOpen(pathname, searchParams.toString());
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
  const [collapsedDateKeys, setCollapsedDateKeys] = useState<Set<string>>(new Set());
  const MEETINGS_PREVIEW_COUNT = 10;
  const [searchQuery, setSearchQuery] = useState<string>('');
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const focusSearchOnExpand = useRef(false);
  const meetingsToggleRef = useRef<HTMLButtonElement>(null);
  const focusMeetingsOnExpand = useRef(false);
  const editTriggerIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isCollapsed && focusSearchOnExpand.current) {
      searchContainerRef.current?.querySelector('input')?.focus();
      focusSearchOnExpand.current = false;
    }
    if (!isCollapsed && focusMeetingsOnExpand.current) {
      meetingsToggleRef.current?.focus();
      focusMeetingsOnExpand.current = false;
    }
  }, [isCollapsed]);
  const [showModelSettings, setShowModelSettings] = useState(false);
  const [modelConfig, setModelConfig] = useState<ModelConfig>({
    provider: DEFAULT_SUMMARY_PROVIDER,
    model: DEFAULT_SUMMARY_MODEL,
    whisperModel: DEFAULT_WHISPER_MODEL,
    apiKey: null,
    ollamaEndpoint: null
  });
  const [transcriptModelConfig, setTranscriptModelConfig] = useState<TranscriptModelProps>({
    provider: DEFAULT_TRANSCRIPT_PROVIDER,
    model: DEFAULT_TRANSCRIPT_MODEL,
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
  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    searchTranscripts(value);

    // If search query is empty, just return to normal view
    if (!value.trim()) return;

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

  const meetingDateGroups = useMemo(() => {
    const byId = new Map(meetings.map(meeting => [meeting.id, meeting]));
    const dated = visibleMeetings.map(item => ({
      ...item,
      created_at: byId.get(item.id)?.created_at ?? byId.get(item.id)?.updated_at,
    }));
    return groupMeetingsByTimeRange(dated);
  }, [visibleMeetings, meetings]);

  const toggleDateGroup = (key: string) => {
    setCollapsedDateKeys(previous => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

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
    const savedId = searchParams.get('saved');
    const isActive =
      (pathname === '/meeting-details' && currentMeeting?.id === item.id) ||
      (pathname === RECORDING_ROUTE && savedId === item.id);
    const isMeetingItem = item.type === 'file' && item.id.includes('-') && !item.id.startsWith('intro-call');
    const matchingResult = isMeetingItem ? findMatchingSnippet(item.id) : null;
    const hasTranscriptMatch = !!matchingResult;

    if (item.type !== 'file') return null;

    // Collapsed: icon-only with tooltip
    if (isCollapsed) {
      return (
        <Tooltip key={item.id}>
          <TooltipTrigger asChild>
            <button
              aria-label={item.title}
              aria-current={isActive ? 'page' : undefined}
              className={`flex items-center justify-center p-2 rounded-lg my-0.5 cursor-pointer transition-colors ${
                isActive ? 'bg-stone-200 text-stone-900' : 'hover:bg-gray-100 text-gray-500'
              }`}
              onClick={() => {
                setCurrentMeeting({ id: item.id, title: item.title });
                const path = item.id.startsWith('intro-call') ? '/' : createSavedNotePath(item.id);
                router.push(path);
              }}
            >
              <File className="w-4 h-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right"><p>{item.title}</p></TooltipContent>
        </Tooltip>
      );
    }

    // Expanded: full item with label + actions
    return (
      <div key={item.id}>
        <div
          className={`flex items-center pr-1 rounded-md text-sm group transition-colors ${
            isActive ? 'bg-stone-200 text-stone-900 font-medium' :
            hasTranscriptMatch ? 'bg-yellow-50 hover:bg-yellow-100' : 'hover:bg-gray-100 text-gray-700'
          }`}
        >
          <button
            className="flex items-center flex-1 min-w-0 px-2 py-1 rounded-md text-left"
            aria-current={isActive ? 'page' : undefined}
            onClick={() => {
              setCurrentMeeting({ id: item.id, title: item.title });
              const path = item.id.startsWith('intro-call') ? '/' : createSavedNotePath(item.id);
              router.push(path);
            }}
          >
            <File className="w-3.5 h-3.5 flex-shrink-0 mr-2 text-gray-400" />
            <span className="flex-1 truncate" title={item.title}>{item.title}</span>
          </button>
          {isMeetingItem && (
            <DropdownMenu onOpenChange={(open) => { if (open) editTriggerIdRef.current = `meeting-actions-${item.id}`; }}>
              <DropdownMenuTrigger asChild>
                <button
                  id={`meeting-actions-${item.id}`}
                  aria-label={`Actions for ${item.title}`}
                  className="shrink-0 rounded-md p-1.5 text-stone-500 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100 hover:bg-stone-200"
                ><MoreHorizontal className="h-4 w-4" /></button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onSelect={() => handleEditStart(item.id, item.title)}><Pencil className="mr-2 h-4 w-4" />Edit title</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setDeleteModalState({ isOpen: true, itemId: item.id })} className="text-red-600"><Trash2 className="mr-2 h-4 w-4" />Delete meeting</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
    <nav
      aria-label="Main navigation"
      data-expanded={isCollapsed ? 'false' : 'true'}
      className="sidebar-rail sticky top-0 z-40 flex h-screen flex-shrink-0 flex-col overflow-hidden bg-background [&_button:focus-visible]:-outline-offset-2 [&_button:focus-visible]:outline [&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-stone-700"
    >
        {/* Overlay chrome: lights are native. Expanded row is collapse only.
            Search lives in the rail body (field) or as a collapsed rail icon — never in chrome. */}
        <div className="window-chrome-toolbar pointer-events-none flex shrink-0">
          <div className="window-chrome-traffic-lights" aria-hidden />
          {!isCollapsed && (
            <div
              data-tauri-drag-region="deep"
              className="titlebar window-chrome-toolbar pointer-events-auto flex min-w-0 flex-1 items-center pr-1"
            >
              <div className="no-drag flex items-center">
                <button
                  type="button"
                  onClick={toggleCollapse}
                  className="rounded-md p-1.5 text-stone-500 hover:bg-stone-100 hover:text-stone-800"
                  aria-label="Collapse sidebar"
                  aria-expanded="true"
                >
                  <PanelLeftClose className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>

        {isCollapsed ? (
          <RailItem
            collapsed
            label="Search"
            ariaLabel="Search meetings"
            icon={<SearchIcon className="h-4 w-4" />}
            onClick={() => { focusSearchOnExpand.current = true; toggleCollapse(); }}
          />
        ) : (
          <div ref={searchContainerRef} className="flex min-h-10 shrink-0 items-center px-2">
            <InputGroup className="h-8">
              <InputGroupInput
                aria-label="Search meeting content"
                placeholder="Search…"
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
              />
              <InputGroupAddon><SearchIcon /></InputGroupAddon>
              {searchQuery && (
                <InputGroupAddon align={'inline-end'}>
                  <InputGroupButton aria-label="Clear meeting search" onClick={() => {
                    handleSearchChange('');
                    searchContainerRef.current?.querySelector('input')?.focus();
                  }}><X /></InputGroupButton>
                </InputGroupAddon>
              )}
            </InputGroup>
          </div>
        )}

        <div className="shrink-0">
          <RailItem
            collapsed={isCollapsed}
            label="Home"
            icon={<Home className="h-4 w-4" />}
            active={isHomePage && !askOpen}
            ariaCurrent={isHomePage && !askOpen ? 'page' : undefined}
            onClick={() => router.push('/')}
          />
          <RailItem
            collapsed={isCollapsed}
            label={isRecording ? 'Open recording' : 'Start Recording'}
            icon={<Mic className="h-4 w-4" />}
            className={isRecording ? 'bg-red-50 text-red-500 hover:bg-red-100' : 'hover:bg-red-50 hover:text-red-600'}
            onClick={handleRecordingToggle}
          />
          <RailItem
            collapsed={isCollapsed}
            label="Ask your notes"
            icon={<MessageCircle className="h-4 w-4" />}
            active={askOpen}
            ariaCurrent={askOpen ? 'page' : undefined}
            ariaExpanded={pathname === '/' ? askOpen : undefined}
            onClick={() => {
              if (isHomePage && askOpen) return;
              router.push(isHomePage ? homeAskPath(searchParams.toString()) : homeAskPath('', searchParams.get('chat')));
            }}
          />
        </div>

        {/* Meetings section */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {isCollapsed ? (
            <RailItem
              collapsed
              label="Meetings"
              ariaLabel="Show meetings"
              ariaExpanded={false}
              icon={<FolderOpen className="h-4 w-4" />}
              onClick={() => {
                focusMeetingsOnExpand.current = true;
                setMeetingsExpanded(true);
                toggleCollapse();
              }}
            />
          ) : (
            <>
              <NoteFolderSidebar />
              {/* Collapsible section header */}
              <button
                ref={meetingsToggleRef}
                className="flex items-center gap-1 w-full px-3 py-0.5 mb-1 rounded hover:bg-gray-50 flex-shrink-0 group"
                onClick={() => setMeetingsExpanded(e => !e)}
                aria-expanded={meetingsExpanded}
                aria-controls="sidebar-meetings"
              >
                <p className="text-xs font-medium uppercase tracking-wider text-gray-400 flex-1 text-left">
                  Meetings
                </p>
                {searchQuery && isSearching && (
                  <span className="text-xs text-blue-400 animate-pulse mr-1">Searching...</span>
                )}
                <ChevronDown className={`w-3 h-3 text-gray-400 transition-transform duration-200 flex-shrink-0 ${meetingsExpanded ? '' : '-rotate-90'}`} />
              </button>

                {searchQuery && !isSearching && searchResults.length >= 100 && (
                  <p className="px-3 pb-2 text-xs text-stone-500" role="status">Showing 100 matching meetings. Refine your search for more.</p>
                )}
                <div id="sidebar-meetings" hidden={!meetingsExpanded} className="flex-1 overflow-y-auto custom-scrollbar min-h-0 px-1.5">
                  {meetingDateGroups.map(group => {
                    const isDateExpanded = !collapsedDateKeys.has(group.key);
                    return (
                      <div key={group.key} className="mb-1">
                        <button
                          type="button"
                          className="flex w-full items-center gap-1 rounded px-2 py-0.5 text-left hover:bg-gray-50"
                          onClick={() => toggleDateGroup(group.key)}
                          aria-expanded={isDateExpanded}
                        >
                          <span className="flex-1 truncate text-[11px] font-medium uppercase tracking-wider text-gray-400">
                            {group.label}
                          </span>
                          <span className="text-[10px] tabular-nums text-gray-300">{group.meetings.length}</span>
                          <ChevronDown className={`h-3 w-3 shrink-0 text-gray-400 transition-transform ${isDateExpanded ? '' : '-rotate-90'}`} />
                        </button>
                        {isDateExpanded && group.meetings.map(child => renderItem(child, 0))}
                      </div>
                    );
                  })}
                  {!showAllMeetings && meetingItems.length > MEETINGS_PREVIEW_COUNT && (
                    <button
                      className="w-full rounded-md px-2 py-1 text-left text-xs text-gray-400 transition-colors hover:bg-gray-50 hover:text-gray-600"
                      onClick={() => setShowAllMeetings(true)}
                    >
                      Show {meetingItems.length - MEETINGS_PREVIEW_COUNT} more…
                    </button>
                  )}
                </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-gray-100 py-1">
          {betaFeatures.importAndRetranscribe && (
            <RailItem
              collapsed={isCollapsed}
              label="Import Audio"
              icon={<Upload className="h-4 w-4" />}
              onClick={() => openImportDialog()}
            />
          )}
          <RailItem
            collapsed={isCollapsed}
            label="Settings"
            icon={<Settings className="h-4 w-4" />}
            active={pathname === '/settings'}
            ariaCurrent={pathname === '/settings' ? 'page' : undefined}
            onClick={() => router.push('/settings')}
          />
          <Info isCollapsed={isCollapsed} />
        </div>
      </nav>

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
        <DialogContent className="sm:max-w-[425px]" onCloseAutoFocus={(event) => {
          if (editTriggerIdRef.current) {
            event.preventDefault();
            requestAnimationFrame(() => {
              document.getElementById(editTriggerIdRef.current!)?.focus();
            });
          }
        }}>
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
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-stone-600 focus:border-transparent"
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
              className="px-4 py-2 text-sm font-medium text-white bg-stone-900 hover:bg-stone-800 rounded-md transition-colors"
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
