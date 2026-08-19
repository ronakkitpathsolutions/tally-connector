export interface AppConfig {
  port: number;
  host: string;
  sharedSecret: string;
  tallyHost: string;
  tallyPort: number;
  tallyTimeoutMs: number;
  defaultCompany: string;
  /**
   * TESTING ONLY. Normalises voucher dates to the 1st/2nd/last day that TallyPrime's free
   * Educational version accepts. Must stay off against a licensed Tally.
   */
  eduMode: boolean;
  /**
   * Port to read master names from, which may be a different TallyPrime instance to the one
   * vouchers are written to. Defaults to tallyPort.
   */
  mastersPort: number;
  /**
   * Create missing ledgers alongside the voucher. Off by default: against a real company a mapping
   * typo would silently become a new ledger instead of a loud failure.
   */
  allowMasterCreate: boolean;
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
}

/**
 * Reads a boolean env var forgivingly. Matching only the exact string 'true' meant TRUE, True and
 * yes all read as off, silently — the setting looked present in .env and did nothing.
 */
function flag(value: string | undefined): boolean {
  const v = value?.trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes' || v === 'on';
}

/**
 * Interface to listen on. `127.0.0.1` reaches only this machine; `0.0.0.0` binds every interface,
 * so both http://localhost:4000 and http://<lan-ip>:4000 work.
 *
 * Binding a single LAN address does NOT also cover loopback, which is why 0.0.0.0 is the value to
 * use when both need to answer. Anything other than loopback puts :4000 on the office network,
 * after which the shared secret is the only thing guarding it.
 */
function bindHostOf(env: NodeJS.ProcessEnv): string {
  return env.HOST?.trim() || '127.0.0.1';
}

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  return {
    port: Number(env.PORT ?? 4000),
    host: bindHostOf(env),
    sharedSecret: required(env, 'SHARED_SECRET'),
    // Not the bind address, and not configurable: TallyPrime runs on this same PC, and 0.0.0.0 —
    // the value needed to bind every interface — is not something you can connect *to*.
    tallyHost: '127.0.0.1',
    // 9001, not Tally's 9000: on the client's terminal server 9000 belongs to the TallyPrime
    // instance holding their live books.
    tallyPort: Number(env.TALLY_PORT ?? 9001),
    // Read-only, and deliberately its own setting rather than a request parameter: the client's
    // live company is on another port, and its ledger names are what the portal must map against.
    // Letting a caller choose the port would let an import reach the live books by mistake — the
    // write paths never look at this.
    mastersPort: Number(env.TALLY_MASTERS_PORT ?? env.TALLY_PORT ?? 9001),
    tallyTimeoutMs: Number(env.TALLY_TIMEOUT_MS ?? 30000),
    defaultCompany: required(env, 'DEFAULT_COMPANY'),
    eduMode: flag(env.TALLY_EDU_MODE),
    allowMasterCreate: flag(env.ALLOW_MASTER_CREATE),
  };
}
