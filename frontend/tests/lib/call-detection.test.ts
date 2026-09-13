import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  announcementAfterRecordStop,
  callDetectionBannerCopy,
  shouldAnnounceCall,
  shouldShowCallDetectionBanner,
} from '../../src/lib/callDetectionCopy';

describe('callDetectionCopy', () => {
  test('shows the in-app banner by default when a call is detected (and hides while recording)', () => {
    assert.equal(
      shouldShowCallDetectionBanner({
        enabled: true,
        lastDetected: 'Microsoft Teams',
        dismissed: false,
        isRecording: true,
        announcement: 'running',
      }),
      false,
    );
    assert.equal(
      shouldShowCallDetectionBanner({
        enabled: true,
        lastDetected: 'Microsoft Teams',
        dismissed: false,
        isRecording: false,
        announcement: 'running',
      }),
      true,
    );
    assert.equal(
      shouldShowCallDetectionBanner({
        enabled: true,
        lastDetected: 'Zoom',
        dismissed: false,
        isRecording: false,
        announcement: 'detected',
      }),
      true,
    );
  });

  test('uses honest copy after recording the same still-active meeting', () => {
    assert.equal(
      announcementAfterRecordStop({
        appStillPresent: 'Microsoft Teams',
        appWhenRecordingStarted: 'Microsoft Teams',
      }),
      'running',
    );
    assert.equal(
      callDetectionBannerCopy('Microsoft Teams', 'running'),
      'Microsoft Teams meeting still active. Record?',
    );
    assert.equal(
      callDetectionBannerCopy('Zoom', 'detected'),
      'Zoom meeting. Record?',
    );
  });

  test('does not announce the same app after record; a new app may still announce', () => {
    assert.equal(
      shouldAnnounceCall({
        isRecording: true,
        previousApp: 'Microsoft Teams',
        nextApp: 'Microsoft Teams',
      }),
      false,
    );
    assert.equal(
      shouldAnnounceCall({
        isRecording: false,
        previousApp: 'Microsoft Teams',
        nextApp: 'Microsoft Teams',
      }),
      false,
    );
    assert.equal(
      shouldAnnounceCall({
        isRecording: false,
        previousApp: 'Microsoft Teams',
        nextApp: 'Zoom',
      }),
      true,
    );
  });
});
