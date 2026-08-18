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
