import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSettingsTab,
  settingsPath,
  settingsTabFromSearch,
  settingsTabMeta,
} from '../../src/lib/settingsNav';

describe('settingsNav', () => {
  test('treats missing and unknown tabs as General', () => {
    assert.equal(settingsTabFromSearch(''), 'general');
    assert.equal(settingsTabFromSearch('onboarding=groq-key'), 'general');
    assert.equal(parseSettingsTab('not-a-tab'), null);
    assert.equal(settingsTabMeta(settingsTabFromSearch('tab=nope')).label, 'General');
  });

  test('preserves canonical tab ids and accepts case-insensitive aliases', () => {
    assert.equal(settingsTabFromSearch('tab=Transcriptionmodels'), 'Transcriptionmodels');
    assert.equal(settingsTabFromSearch('tab=summaryModels'), 'summaryModels');
    assert.equal(parseSettingsTab('Summarymodels'), 'summaryModels');
    assert.equal(parseSettingsTab('transcriptionmodels'), 'Transcriptionmodels');
  });

  test('builds settings hrefs without dropping onboarding params', () => {
    assert.equal(settingsPath(), '/settings');
    assert.equal(settingsPath('general'), '/settings');
    assert.equal(settingsPath('recording'), '/settings?tab=recording');
    assert.equal(
      settingsPath('Transcriptionmodels', 'onboarding=groq-key'),
      '/settings?onboarding=groq-key&tab=Transcriptionmodels',
    );
    assert.equal(
      settingsPath('general', 'tab=recording&onboarding=gateway-key'),
      '/settings?onboarding=gateway-key',
    );
    assert.equal(
      settingsPath('summaryModels', 'tab=recording&onboarding=gateway-key'),
      '/settings?tab=summaryModels&onboarding=gateway-key',
    );
  });
});
