/**
 * Thin product-flavor selector.
 *
 * Meetnola builds set NEXT_PUBLIC_FLAVOR=meetnola (or meetnola-tester) via the
 * tester/dev scripts. Upstream Meetily builds leave it unset / "meetily".
 */

export type ProductFlavor = 'meetily' | 'meetnola'

function normalizeFlavor(raw: string | undefined): ProductFlavor {
  const value = (raw || '').trim().toLowerCase()
  if (value === 'meetnola' || value.startsWith('meetnola-')) {
    return 'meetnola'
  }
  return 'meetily'
}

export const productFlavor: ProductFlavor = normalizeFlavor(
  process.env.NEXT_PUBLIC_FLAVOR
)

export const isMeetnola = productFlavor === 'meetnola'

/** Meetnola-only module surface — import lazily from call sites when needed. */
export const meetnolaExtensions = isMeetnola
  ? {
      ipc: () => import('@/meetnola/ipc'),
    }
  : null
