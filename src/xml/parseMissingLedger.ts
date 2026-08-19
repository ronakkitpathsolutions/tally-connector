/**
 * Pulls the ledger name out of Tally's "does not exist" complaint.
 *
 * This replaces fetching the company's whole ledger list before every push. That list is 5,218
 * entries in the client's real company, and transferring it per invoice made a 50-invoice batch
 * take minutes and blocked a Tally that four other people were using. Importing first and reading
 * the failure costs nothing in the normal case, where every ledger already exists.
 *
 * Tally names one missing ledger per attempt, so a voucher short of several needs several rounds.
 */

const PATTERNS = [
  /Ledger\s+'([^']+)'\s+does not exist/i,
  /Ledger\s+&apos;([^&]+)&apos;\s+does not exist/i,
  /Ledger\s+"([^"]+)"\s+does not exist/i,
];

export function parseMissingLedger(error: string): string | null {
  for (const pattern of PATTERNS) {
    const match = pattern.exec(error);
    if (match) return match[1].trim() || null;
  }
  return null;
}

/**
 * The name as this voucher spells it, or null when the voucher never mentioned it.
 *
 * Matching back against the payload is the safety catch: it means a name only ever gets created
 * because *we* asked for it. Without this, any "does not exist" text Tally produced — about a
 * voucher type, a stock item, something on an unrelated line — would be taken as an instruction to
 * create a ledger in the client's books.
 *
 * The payload's spelling wins, since Tally matches verbatim and its message may differ in case.
 */
export function matchToPayloadLedger(missing: string, payloadLedgers: string[]): string | null {
  const wanted = missing.trim().toLowerCase();
  if (!wanted) return null;
  return payloadLedgers.find((name) => name.trim().toLowerCase() === wanted) ?? null;
}
