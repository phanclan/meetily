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

  if (!buildInfo || buildInfo.flavor !== 'meetnola-tester') {
    return null;
  }

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[60] rounded-full border border-stone-200/80 bg-white/88 px-3 py-1 text-[10px] font-medium text-stone-500 shadow-[0_14px_32px_-26px_rgba(41,37,36,0.38)] backdrop-blur">
      {buildInfo.displayName}
    </div>
  );
}
