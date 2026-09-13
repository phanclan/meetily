/**
 * Thin product-flavor selector.
 *
 * Afterword builds set NEXT_PUBLIC_FLAVOR=afterword (or afterword-tester) via
 * the tester/dev scripts. Upstream Meetily builds leave it unset / "meetily".
 *
 * Product defaults (Parakeet STT + Gateway/Luna) live in
 * `src/constants/modelDefaults.ts` and `src-tauri/src/config.rs`.
 * See `docs/afterword-product-defaults.md`.
 *
 * The legacy `meetnola` / `meetnola-*` values still resolve to `afterword` so
 * older shells, scripts, and cached env files keep working.
 */

export type ProductFlavor = 'meetily' | 'afterword'

function normalizeFlavor(raw: string | undefined): ProductFlavor {
  const value = (raw || '').trim().toLowerCase()
  if (
    value === 'afterword' ||
    value.startsWith('afterword-') ||
    // Legacy Meetnola flavor values.
    value === 'meetnola' ||
    value.startsWith('meetnola-')
  ) {
    return 'afterword'
  }
  return 'meetily'
}

export const productFlavor: ProductFlavor = normalizeFlavor(
  typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_FLAVOR : undefined
)

export const isAfterword = productFlavor === 'afterword'

/** @deprecated Use `isAfterword`. Kept so older call sites keep compiling. */
export const isMeetnola = isAfterword

/** Afterword-only module surface — import lazily from call sites when needed. */
export const afterwordExtensions = isAfterword
  ? {
      ipc: () => import('@/afterword/ipc'),
    }
  : null
