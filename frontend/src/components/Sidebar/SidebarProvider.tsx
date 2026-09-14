'use client';

import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Analytics from '@/lib/analytics';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { safelyUnlisten } from '@/lib/tauriEvents';
import { useTranscriptSearch, type TranscriptSearchResult } from '@/hooks/useTranscriptSearch';
import { createRecordingPath } from '@/lib/quickNoteRoute';
import { useSummaryPolling } from '@/hooks/useSummaryPolling';
import { useFolderRead, type NoteFolder } from '@/hooks/useNoteFolders';


interface SidebarItem {
  id: string;
  title: string;
  type: 'folder' | 'file';
  children?: SidebarItem[];
}

export interface CurrentMeeting {
  id: string;
  title: string;
  created_at?: string;
  updated_at?: string;
}

interface SidebarContextType {
  noteFolders: ReturnType<typeof useFolderRead<NoteFolder[]>>;
  folderRevision: number;
  refreshNoteFolders: () => void;
  currentMeeting: CurrentMeeting | null;
  setCurrentMeeting: (meeting: CurrentMeeting | null) => void;
  sidebarItems: SidebarItem[];
  isCollapsed: boolean;
  toggleCollapse: () => void;
  meetings: CurrentMeeting[];
  setMeetings: (meetings: CurrentMeeting[]) => void;
  isMeetingActive: boolean;
  setIsMeetingActive: (active: boolean) => void;
  handleRecordingToggle: () => void;
  searchTranscripts: (query: string) => void;
  searchResults: TranscriptSearchResult[];
  isSearching: boolean;
  setServerAddress: (address: string) => void;
  serverAddress: string;
  transcriptServerAddress: string;
  setTranscriptServerAddress: (address: string) => void;
  // Summary polling management
  activeSummaryPolls: Map<string, NodeJS.Timeout>;
  startSummaryPolling: (meetingId: string, processId: string, onUpdate: (result: any) => void) => void;
  stopSummaryPolling: (meetingId: string) => void;
  // Refetch meetings from backend
  refetchMeetings: () => Promise<void>;

}

const SIDEBAR_EXPANDED_STORAGE_KEY = 'afterword:sidebar-expanded';

const SidebarContext = createContext<SidebarContextType | null>(null);

export const useSidebar = () => {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error('useSidebar must be used within a SidebarProvider');
  }
  return context;
};

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [currentMeeting, setCurrentMeeting] = useState<CurrentMeeting | null>({ id: 'intro-call', title: '+ New Call' });
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [meetings, setMeetings] = useState<CurrentMeeting[]>([]);
  const [sidebarItems, setSidebarItems] = useState<SidebarItem[]>([]);
  const [isMeetingActive, setIsMeetingActive] = useState(false);
  const { searchResults, isSearching, searchTranscripts } = useTranscriptSearch();
  const [serverAddress, setServerAddress] = useState('');
  const [transcriptServerAddress, setTranscriptServerAddress] = useState('');
  const [folderRevision, setFolderRevision] = useState(0);
  const noteFolders = useFolderRead<NoteFolder[]>('list_note_folders', {}, Boolean(serverAddress), folderRevision);
  const refreshNoteFolders = React.useCallback(() => setFolderRevision(value => value + 1), []);
  const { activeSummaryPolls, startSummaryPolling, stopSummaryPolling } = useSummaryPolling();

  const pathname = usePathname();
  const router = useRouter();

  // Extract fetchMeetings as a reusable function
  const fetchMeetings = React.useCallback(async () => {
    if (serverAddress) {
      try {
        const meetings = await invoke('api_get_meetings') as Array<{
          id: string;
          title: string;
          created_at?: string;
          updated_at?: string;
        }>;
        const transformedMeetings = meetings.map((meeting: any) => ({
          id: meeting.id,
          title: meeting.title,
          created_at: meeting.created_at,
          updated_at: meeting.updated_at,
        }));
        setMeetings(transformedMeetings);
        refreshNoteFolders();
        Analytics.trackBackendConnection(true);
      } catch (error) {
        console.error('Error fetching meetings:', error);
        setMeetings([]);
        Analytics.trackBackendConnection(false, error instanceof Error ? error.message : 'Unknown error');
      }
    }
  }, [serverAddress, refreshNoteFolders]);

  useEffect(() => {
    fetchMeetings();
  }, [serverAddress, fetchMeetings]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: UnlistenFn | undefined;

    const setup = async () => {
      unlisten = await listen<{ meeting_id: string; title: string; previous_title: string }>(
        'meeting-title-suggested',
        (event) => {
          const meetingId = event.payload?.meeting_id;
          const title = event.payload?.title?.trim();
          if (!meetingId || !title) return;
          setMeetings((current) =>
            current.map((meeting) => (meeting.id === meetingId ? { ...meeting, title } : meeting)),
          );
          setCurrentMeeting((current) =>
            current && current.id === meetingId ? { ...current, title } : current,
          );
        },
      );
      if (cancelled) safelyUnlisten(unlisten, 'sidebar:meeting-title-suggested');
    };

    void setup();
    return () => {
      cancelled = true;
      safelyUnlisten(unlisten, 'sidebar:meeting-title-suggested');
    };
  }, []);

  useEffect(() => {
    const fetchSettings = async () => {
      setServerAddress('http://localhost:5167');
      setTranscriptServerAddress('http://127.0.0.1:8178/stream');
    };
    fetchSettings();
  }, []);

  const baseItems: SidebarItem[] = [
    {
      id: 'meetings',
      title: 'Meeting Notes',
      type: 'folder' as const,
      children: [
        ...meetings.map(meeting => ({ id: meeting.id, title: meeting.title, type: 'file' as const }))
      ]
    },
  ];


  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(SIDEBAR_EXPANDED_STORAGE_KEY);
      if (saved === '1') setIsCollapsed(false);
    } catch {
      // Ignore quota / private-mode failures; stay on the compact default.
    }
  }, []);

  const toggleCollapse = useCallback(() => {
    setIsCollapsed(previous => {
      const next = !previous;
      try {
        window.localStorage.setItem(SIDEBAR_EXPANDED_STORAGE_KEY, next ? '0' : '1');
      } catch {
        // Ignore quota / private-mode failures.
      }
      return next;
    });
  }, []);

  // Update current meeting when on home page
  useEffect(() => {
    if (pathname === '/') {
      setCurrentMeeting({ id: 'intro-call', title: '+ New Call' });
    }
    setSidebarItems(baseItems);
  }, [pathname]);

  // Update sidebar items when meetings change
  useEffect(() => {
    setSidebarItems(baseItems);
  }, [meetings]);

  // Function to handle recording toggle from sidebar.
  // The recording route starts a session, or reopens the one already running.
  const handleRecordingToggle = useCallback(() => {
    router.push(createRecordingPath());
  }, [router]);

  const value = useMemo<SidebarContextType>(() => ({
    noteFolders,
    folderRevision,
    refreshNoteFolders,
    currentMeeting,
    setCurrentMeeting,
    sidebarItems,
    isCollapsed,
    toggleCollapse,
    meetings,
    setMeetings,
    isMeetingActive,
    setIsMeetingActive,
    handleRecordingToggle,
    searchTranscripts,
    searchResults,
    isSearching,
    setServerAddress,
    serverAddress,
    transcriptServerAddress,
    setTranscriptServerAddress,
    activeSummaryPolls,
    startSummaryPolling,
    stopSummaryPolling,
    refetchMeetings: fetchMeetings,
  }), [
    activeSummaryPolls,
    currentMeeting,
    fetchMeetings,
    folderRevision,
    handleRecordingToggle,
    isCollapsed,
    isMeetingActive,
    isSearching,
    meetings,
    noteFolders,
    refreshNoteFolders,
    searchResults,
    searchTranscripts,
    serverAddress,
    sidebarItems,
    startSummaryPolling,
    stopSummaryPolling,
    toggleCollapse,
    transcriptServerAddress,
  ]);

  return (
    <SidebarContext.Provider value={value}>
      {children}
    </SidebarContext.Provider>
  );
}
