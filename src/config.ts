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
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  return {
    port: Number(env.PORT ?? 4000),
    // Neither host is configurable, and both are loopback for the same reason: the connector and
    // TallyPrime always run on the one office PC. Binding wider would expose the connector to the
    // office LAN, and a settable Tally host could only ever be set wrong.
    host: '127.0.0.1',
    sharedSecret: required(env, 'SHARED_SECRET'),
    tallyHost: '127.0.0.1',
    tallyPort: Number(env.TALLY_PORT ?? 9000),
    tallyTimeoutMs: Number(env.TALLY_TIMEOUT_MS ?? 30000),
    defaultCompany: required(env, 'DEFAULT_COMPANY'),
    eduMode: env.TALLY_EDU_MODE === 'true' || env.TALLY_EDU_MODE === '1',
  };
}
