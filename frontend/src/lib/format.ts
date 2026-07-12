// Consistent price display wherever a note/item carries a parsed `price_amount` + `currency`
// alongside the raw scraped string (product notes today; any future template that adopts the
// same shape should use this too, instead of showing whatever punctuation the source page used).
export function formatPrice(
  amount?: number | null,
  currency?: string | null,
  raw?: string | null,
): string | null {
  if (amount != null && currency) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
      }).format(amount);
    } catch {
      // Unknown/invalid ISO currency code from the source — fall through to the raw string.
    }
  }
  // No parsed amount+currency: still normalize a simple "<symbol><digits>" raw string
  // (e.g. "₹3999" → "₹3,999") so cards never mix grouped and ungrouped prices. Anything
  // more complex ("$10-$20", "from ₹999") is left untouched.
  if (raw) {
    const m = raw.trim().match(/^(₹|\$|€|£|Rs\.?\s?)\s?(\d{4,})(?:\.\d+)?$/);
    if (m) return `${m[1].trim()}${Number(m[2]).toLocaleString()}`;
  }
  return raw ?? null;
}
