// The wire contract between the TMS backend and this connector.
// The backend re-declares these shapes structurally in tally-payload.builder.ts; the two repos
// share no package, so the golden-file tests on both sides are what keep them from drifting.

export interface LedgerEntry {
  ledgerName: string;
  amount: number;
  isParty?: boolean;
}

export interface VoucherParty {
  ledgerName: string;
  gstin?: string;
  stateName?: string;
  address?: string[];
}

export interface VoucherPayload {
  remoteId: string;
  company: string;
  voucherType: 'Sales';
  /** YYYYMMDD — Tally's date format. */
  date: string;
  billNo: string;
  narration?: string;
  party: VoucherParty;
  entries: LedgerEntry[];
}

/**
 * One sales line on a Tally Sales Invoice — one per charge type, so Freight Charges (SAC 99651100)
 * and Lolo Income (SAC 996711) stay separate the way they do on the portal's bill.
 */
export interface InvoiceLine {
  /** Sales ledger this charge posts to, e.g. "SALES IGST". */
  ledgerName: string;
  /** Taxable amount, positive. */
  amount: number;
  sacCode?: string;
  gstRate?: number;
  description?: string;
}

export interface TaxLine {
  /** Tax ledger, e.g. "IGST (O/P)". */
  ledgerName: string;
  /** Tax amount, positive. */
  amount: number;
  dutyHead: 'CGST' | 'SGST' | 'IGST';
  gstRate?: number;
}

export interface InvoiceParty extends VoucherParty {
  placeOfSupply?: string;
  registrationType?: 'Regular' | 'Composition' | 'Unregistered' | 'Consumer' | 'Unknown';
}

/**
 * The full GST Sales Invoice shape, as opposed to the lean accounting voucher in VoucherPayload.
 * Services only — this bills freight and agency charges against SAC codes, never stock items, so
 * there are no INVENTORYENTRIES.
 */
export interface InvoicePayload {
  remoteId: string;
  company: string;
  /**
   * Tally voucher type. The client's books post sales under "Sales Taxable", not the stock "Sales"
   * type, and the voucher type also decides whether Tally accepts our voucher number or assigns
   * its own — so this is not cosmetic.
   */
  voucherType?: string;
  /** YYYYMMDD. */
  date: string;
  billNo: string;
  narration?: string;
  party: InvoiceParty;
  lines: InvoiceLine[];
  taxes: TaxLine[];
  roundOff?: number;
  /** Required only when roundOff is non-zero. */
  roundOffLedgerName?: string;
  /** Grand total. The party ledger is debited by exactly this. */
  total: number;
}

export type ConnectorErrorCode =
  | 'AUTH'
  | 'BAD_PAYLOAD'
  | 'TALLY_UNREACHABLE'
  | 'TALLY_TIMEOUT'
  | 'TALLY_LINEERROR'
  | 'TALLY_NO_CHANGE';

export type ConnectorResult =
  | { ok: true; action: 'created' | 'altered'; voucherId: string | null; rawXml: string }
  | { ok: false; errorCode: ConnectorErrorCode; error: string; rawXml: string | null };
