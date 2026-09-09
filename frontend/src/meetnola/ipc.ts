import { invoke } from '@tauri-apps/api/core'

/**
 * Meetnola commands are registered on the internal Tauri plugin `meetnola`.
 * Invoke names are `plugin:meetnola|<command>` (not bare app commands).
 */
const PLUGIN = 'plugin:meetnola'

export function meetnolaInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(`${PLUGIN}|${command}`, args)
}

export function appendFrontendLog(args: {
  level: string
  message: string
  metadata?: unknown
}): Promise<void> {
  return meetnolaInvoke('append_frontend_log', args as Record<string, unknown>)
}

export interface MeetingExchange {
  question: string
  answer: string
}

export function prepareLiveQuery(): Promise<string> {
  return meetnolaInvoke<string>('prepare_live_query')
}

export function cancelLiveQuery(requestId: string): Promise<void> {
  return meetnolaInvoke('cancel_live_query', { requestId })
}

export function liveQuery(args: {
  requestId: string
  userMessage: string
  transcriptContext: string
  history?: MeetingExchange[]
}): Promise<string> {
  return meetnolaInvoke<string>('live_query', args as Record<string, unknown>)
}

export function setCallDetectionEnabled(enabled: boolean): Promise<void> {
  return meetnolaInvoke('set_call_detection_enabled', { enabled })
}

export function getCallDetectionEnabled(): Promise<boolean> {
  return meetnolaInvoke<boolean>('get_call_detection_enabled')
}

export function startCallDetection(): Promise<void> {
  return meetnolaInvoke('start_call_detection')
}

export function stopCallDetection(): Promise<void> {
  return meetnolaInvoke('stop_call_detection')
}

export function saveMeetingNotes(args: {
  meetingId: string
  notesMarkdown?: string | null
  notesJson?: string | null
}): Promise<void> {
  return meetnolaInvoke('save_meeting_notes', args as Record<string, unknown>)
}

export function getMeetingNotes<T = { notes_json?: string | null; notes_markdown?: string | null } | null>(
  meetingId: string
): Promise<T> {
  return meetnolaInvoke<T>('get_meeting_notes', { meetingId })
}

export function moveMeetingNotes(fromMeetingId: string, toMeetingId: string): Promise<void> {
  return meetnolaInvoke('move_meeting_notes', { fromMeetingId, toMeetingId })
}
