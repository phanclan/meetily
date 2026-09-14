'use client';

import { useEffect, useState } from 'react';
import { getBuildInfo, type BuildInfo } from '@/lib/buildInfo';

export function BuildIdentityBadge() {
  const [buildInfo, setBuildInfo] = useState<BuildInfo | null>(null);

  useEffect(() => {
    let cancelled = false;

    getBuildInfo()
      .then((info) => {
        if (!cancelled) {
          setBuildInfo(info);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  const testerFlavors = ['afterword-tester'];
  if (!buildInfo || !testerFlavors.includes(buildInfo.flavor)) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed bottom-0 right-4 z-[60] max-w-[80vw] truncate bg-white/90 px-1 text-[10px] leading-3 text-stone-500">
      {buildInfo.displayName}
    </div>
  );
}
