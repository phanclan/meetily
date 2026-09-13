import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  announcementAfterRecordStop,
  callDetectionBannerCopy,
  shouldAnnounceCall,
  shouldShowCallDetectionBanner,
} from '../../src/lib/callDetectionCopy';

describe('callDetectionCopy', () => {
  test('hides the banner while recording without requiring lastDetected to clear', () => {
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
  });

  test('uses honest copy after recording the same still-running app', () => {
    assert.equal(
      announcementAfterRecordStop({
        appStillPresent: 'Microsoft Teams',
        appWhenRecordingStarted: 'Microsoft Teams',
      }),
      'running',
    );
    assert.equal(
      callDetectionBannerCopy('Microsoft Teams', 'running'),
      'Microsoft Teams is running. Record?',
    );
    assert.equal(
      callDetectionBannerCopy('Zoom', 'detected'),
      'Zoom detected. Record?',
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
