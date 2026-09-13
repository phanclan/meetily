'use client'

import { useEffect } from 'react'
import { toast } from 'sonner'
import { isAfterword, productFlavor } from '@/flavor'
import { getBuildInfo } from '@/lib/buildInfo'

/**
 * The JS flavor comes from `NEXT_PUBLIC_FLAVOR` at Next.js build time; the native
 * flavor comes from the `afterword` Cargo feature. Nothing forces the two build
 * steps to agree, and a mismatch is quiet: Afterword-only UI renders against a
 * binary with no Afterword commands (or the reverse). Say so loudly instead.
 *
 * Never fatal - a disagreeing build still runs, it just lies about what it is.
 */
export function useFlavorAgreement() {
  useEffect(() => {
    let cancelled = false

    getBuildInfo()
      .then((info) => {
        if (cancelled) return

        const native = info.nativeFlavor
        // `unknown` means the IPC fell back (browser testing, missing command);
        // there is no native flavor to disagree with.
        if (native !== 'afterword' && native !== 'meetily') return
        if ((native === 'afterword') === isAfterword) return

        console.error(
          `[flavor] Build mismatch: JS flavor is "${productFlavor}" (NEXT_PUBLIC_FLAVOR) but the ` +
            `Rust binary was compiled as "${native}" (afterword Cargo feature). ` +
            'Afterword-only features will not line up with the native commands. ' +
            'Rebuild both halves with the same flavor.',
        )

        if (process.env.NODE_ENV !== 'production') {
          toast.error('Build flavor mismatch', {
            description: `Frontend is ${productFlavor}, native binary is ${native}. Rebuild both with the same flavor.`,
            duration: 10000,
          })
        }
      })
      .catch(() => {
        // getBuildInfo already falls back; nothing left to assert.
      })

    return () => {
      cancelled = true
    }
  }, [])
}
