export const SETTINGS_TABS = [
  { value: 'general', label: 'General' },
  { value: 'recording', label: 'Recording' },
  { value: 'Transcriptionmodels', label: 'Transcription' },
  { value: 'summaryModels', label: 'AI Enhancement' },
  { value: 'beta', label: 'Beta' },
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number]['value'];

const SETTINGS_TAB_BY_VALUE = new Map<string, SettingsTab>(
  SETTINGS_TABS.map((tab) => [tab.value, tab.value]),
);

const SETTINGS_TAB_BY_LOWER = new Map<string, SettingsTab>(
  SETTINGS_TABS.map((tab) => [tab.value.toLowerCase(), tab.value]),
);

function searchParamsFrom(search: string) {
  return new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
}

export function isSettingsPath(pathname: string) {
  return pathname === '/settings';
}

export function parseSettingsTab(value: string | null | undefined): SettingsTab | null {
  if (!value) return null;
  return SETTINGS_TAB_BY_VALUE.get(value) ?? SETTINGS_TAB_BY_LOWER.get(value.toLowerCase()) ?? null;
}

export function settingsTabFromSearch(search: string): SettingsTab {
  return parseSettingsTab(searchParamsFrom(search).get('tab')) ?? 'general';
}

export function settingsPath(tab: SettingsTab = 'general', currentSearch = ''): string {
  const params = searchParamsFrom(currentSearch);
  if (tab === 'general') {
    params.delete('tab');
  } else {
    params.set('tab', tab);
  }
  const query = params.toString();
  return query ? `/settings?${query}` : '/settings';
}

export function settingsTabMeta(tab: SettingsTab) {
  return SETTINGS_TABS.find((item) => item.value === tab) ?? SETTINGS_TABS[0];
}
