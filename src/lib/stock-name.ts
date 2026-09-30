/**
 * Strip the tokenized-wrapper and brokerage cruft that upstream feeds tack onto
 * an equity's name, leaving just the company. Handles the on-chain wrapper words
 * ("xStock", "preStock", "Ondo", "tokenized", "stock"), the issuing brokerage
 * ("Backpack Securities"), parentheticals, and trailing entity suffixes
 * ("Inc.", "Corp.", "Class A"). Single source of truth — every name surface
 * (cards, detail sheet, holdings) should run through this.
 */
export function cleanStockName(name: string): string {
  return name
    .replace(/\(.*?\)/g, '')
    .replace(/\bbackpack securities\b/gi, '')
    .replace(/\bbackpack\b/gi, '')
    .replace(/\bxstock\b/gi, '')
    .replace(/\bprestock\b/gi, '')
    .replace(/\bondo\b/gi, '')
    .replace(/\btokeni[sz]ed\b/gi, '')
    .replace(/\bstock\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+,/g, ',')
    .replace(/,\s*(inc\.?|corp\.?|class\s+[a-z])$/i, '')
    // Tidy up any separator left dangling after a suffix was removed
    // (e.g. "Tesla - " or "Apple,").
    .replace(/[\s,\-–·|]+$/, '')
    .trim();
}
