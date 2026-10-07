// Exact money (doc/13 A4): prices are integer minor units in a currency. Decimals
// from people and files are converted once, here, and refused if they carry more
// precision than the currency has (USD 12.345, JPY 1.5).
import { minorDigits } from '@project/shared'

/** A decimal amount → minor units, or null if it has more decimals than the currency allows. */
export function toMinor(amount: number, currency: string): number | null {
  if (!Number.isFinite(amount)) return null
  const scaled = amount * 10 ** minorDigits(currency)
  const minor = Math.round(scaled)
  // Binary floats: 19.99 * 100 = 1998.9999999999998 — within a hair of a whole cent is that cent.
  return Math.abs(scaled - minor) < 1e-6 && Number.isSafeInteger(minor) ? minor : null
}

/** Minor units → the decimal amount (for the API's `price` and legacy readers). */
export const fromMinor = (minor: number, currency: string) => minor / 10 ** minorDigits(currency)
