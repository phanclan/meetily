'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { homeAskFromAskPage } from '@/lib/askRoute';

export default function AskNotesPage() {
  return (
    <Suspense fallback={<p className="p-8 text-sm text-stone-500">Opening Ask…</p>}>
      <AskNotesRedirect />
    </Suspense>
  );
}

function AskNotesRedirect() {
  const router = useRouter();
  const params = useSearchParams();
  const dest = homeAskFromAskPage(params.toString());

  useEffect(() => {
    router.replace(dest);
  }, [router, dest]);

  return <p className="p-8 text-sm text-stone-500">Opening Ask…</p>;
}
