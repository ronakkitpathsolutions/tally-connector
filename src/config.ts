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

/** The address this PC is reachable at — used both to bind and to reach Tally. */
function hostOf(env: NodeJS.ProcessEnv): string {
  return env.HOST?.trim() || '127.0.0.1';
}

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  return {
    port: Number(env.PORT ?? 4000),
    // One HOST for both, because the connector and TallyPrime run on the same PC — it is the
    // address this machine is reachable at, and the address Tally is listening on.
    //
    // Defaults to loopback. Setting it to a LAN address makes :4000 reachable from the whole
    // office network, after which the shared secret is the only thing guarding it.
    host: hostOf(env),
    sharedSecret: required(env, 'SHARED_SECRET'),
    tallyHost: hostOf(env),
    // 9001, not Tally's 9000: on the client's terminal server 9000 belongs to the TallyPrime
    // instance holding their live books.
    tallyPort: Number(env.TALLY_PORT ?? 9001),
    tallyTimeoutMs: Number(env.TALLY_TIMEOUT_MS ?? 30000),
    defaultCompany: required(env, 'DEFAULT_COMPANY'),
    eduMode: env.TALLY_EDU_MODE === 'true' || env.TALLY_EDU_MODE === '1',
    allowMasterCreate: env.ALLOW_MASTER_CREATE === 'true' || env.ALLOW_MASTER_CREATE === '1',
  };
}
