import fs from 'node:fs';
import path from 'node:path';

/**
 * Date-stamped file logging, plus the console.
 *
 * Written by hand rather than pulled from npm: the connector runs unattended on a client's server,
 * and one file per day that anyone can open in Notepad is worth more there than a logging
 * framework. When a push fails at 4pm on a Tuesday, the question is always "what did Tally
 * actually say", and that has to be answerable without a rebuild or a remote session.
 *
 * Nothing here ever writes the shared secret — see `redact`.
 */

const LOG_DIR = path.join(process.cwd(), 'logs');

type Level = 'info' | 'warn' | 'error';

/** Values that must never reach a log file, set once at startup. */
let secrets: string[] = [];

export function setLogSecrets(values: Array<string | undefined>): void {
  secrets = values.filter((v): v is string => Boolean(v && v.length >= 4));
}

/**
 * Blanks out anything registered as a secret.
 *
 * Logs get pasted into chats and screenshots — that is exactly how the tunnel token leaked once
 * already — so redaction happens on the way out rather than relying on call sites to be careful.
 */
export function redact(text: string): string {
  return secrets.reduce((out, secret) => out.split(secret).join('***'), text);
}

function fileFor(now: Date): string {
  // Local date, not UTC: whoever opens this is looking for "today" in their own timezone.
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return path.join(LOG_DIR, `tally-connector-${stamp}.log`);
}

function write(level: Level, message: string, meta?: Record<string, unknown>): void {
  const now = new Date();
  const detail = meta && Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  const line = redact(`${now.toISOString()} ${level.toUpperCase().padEnd(5)} ${message}${detail}`);

  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);

  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(fileFor(now), line + '\n');
  } catch {
    // A log that cannot be written must never take the connector down with it.
  }
}

export const log = {
  info: (message: string, meta?: Record<string, unknown>) => write('info', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => write('warn', message, meta),
  error: (message: string, meta?: Record<string, unknown>) => write('error', message, meta),
};
