'use client';

import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';

export interface BuildInfo {
  version: string;
  buildId: string;
  channel: string;
  flavor: string;
  displayName: string;
}

let buildInfoPromise: Promise<BuildInfo> | null = null;

const fallbackBuildInfo = async (): Promise<BuildInfo> => {
  const version = await getVersion().catch(() => '0.3.0');
  return {
    version,
    buildId: 'unknown',
    channel: 'unknown',
    flavor: 'meetily',
    displayName: `Afterword v${version}`,
  };
};

export async function getBuildInfo(): Promise<BuildInfo> {
  if (!buildInfoPromise) {
    buildInfoPromise = invoke<BuildInfo>('get_build_info').catch(() => fallbackBuildInfo());
  }

  return buildInfoPromise;
}
