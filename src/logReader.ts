import fs from 'node:fs';
import path from 'node:path';
import { dayStamp, logFileName, redact } from './logger';

/**
 * Reads one day's log for the public `GET /logs` route and returns only what Tally did with each
 * push — successes, warnings and errors — as structured entries.
 *
 * The connector runs on a client's server that we reach only through the tunnel, and "what did
 * Tally say at 11:57" should not need a remote-desktop session. Read-only, never touches Tally.
 *
 * Deliberately narrow: the date must be `YYYY-MM-DD`, so the only files reachable are this
 * logger's own; the search is plain text (with `|` meaning "any of"), never a regex, so a query
 * cannot hang the process; and every line is redacted again before it leaves.
 */

export type Outcome = 'success' | 'warning' | 'error';

/**
 * The log events that are a Tally outcome, by the exact message routes.ts writes. Anything else
 * (startup, "push received", log pruning) is left out. A new outcome logged in routes.ts must be
 * added here, or it will not show on /logs.
 */
const TALLY_EVENTS: Record<string, Outcome> = {
  imported: 'success',
  'already in Tally, skipped': 'success',
  'ledger list served': 'success',
  'rejected before Tally': 'warning',
  'creating missing ledger': 'warning',
  'Tally rejected the voucher': 'error',
  'duplicate check failed, not imported': 'error',
  'ledger creation failed': 'error',
  'ledger list failed': 'error',
};

const OUTCOMES: Outcome[] = ['success', 'warning', 'error'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const OWN_FILE = /^tally-connector-(\d{4}-\d{2}-\d{2})\.log$/;
// `2026-11-04T06:27:38.100Z ERROR Tally rejected the voucher {"billNo":…}` — see logger.ts write().
const LINE = /^(\S+) (?:INFO|WARN|ERROR)\s+(.+?)(?: (\{.*))?$/;
const MAX_TAIL = 2000;
// The whole day by default: a day of pushes is a few hundred lines, and "show me everything" is
// the usual question. The cap only bounds a runaway file.
const DEFAULT_TAIL = MAX_TAIL;
const MAX_GREP = 200;

export type LogQuery = { date?: unknown; grep?: unknown; tail?: unknown; outcome?: unknown };

export type LogEntry = { at: string; outcome: Outcome; event: string; [detail: string]: unknown };

export type LogResult =
  | {
      ok: true;
      file: string;
      days: string[];
      counts: Record<Outcome, number>;
      matched: number;
      returned: number;
      entries: LogEntry[];
    }
  | { ok: false; errorCode: 'BAD_QUERY' | 'NOT_FOUND'; error: string; available?: string[] };

const bad = (error: string): LogResult => ({ ok: false, errorCode: 'BAD_QUERY', error });

function availableDays(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir)
      .map((name) => OWN_FILE.exec(name)?.[1])
      .filter((day): day is string => Boolean(day))
      .sort();
  } catch {
    return [];
  }
}

/** A Tally outcome entry, or null for any line that is not one. */
function toEntry(line: string): LogEntry | null {
  const match = LINE.exec(line);
  if (!match) return null;
  const [, at, event, meta] = match;
  const outcome = TALLY_EVENTS[event];
  if (!outcome) return null;
  if (!meta) return { at, outcome, event };
  try {
    return { at, outcome, event, ...(JSON.parse(meta) as Record<string, unknown>) };
  } catch {
    return { at, outcome, event, raw: meta };
  }
}

const splitTerms = (value: string): string[] =>
  value
    .split('|')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

export function readLog(query: LogQuery, opts: { dir: string; now: Date }): LogResult {
  const date = query.date === undefined ? dayStamp(opts.now) : query.date;
  if (typeof date !== 'string' || !DATE.test(date)) return bad('date must be YYYY-MM-DD');

  let tail = DEFAULT_TAIL;
  if (query.tail !== undefined) {
    if (typeof query.tail !== 'string' || !/^\d+$/.test(query.tail) || Number(query.tail) < 1) {
      return bad('tail must be a whole number of at least 1');
    }
    tail = Math.min(Number(query.tail), MAX_TAIL);
  }

  let terms: string[] = [];
  if (query.grep !== undefined) {
    if (typeof query.grep !== 'string' || query.grep.length > MAX_GREP) {
      return bad(`grep must be a single value of at most ${MAX_GREP} characters`);
    }
    terms = splitTerms(query.grep);
  }

  let wanted: Outcome[] = OUTCOMES;
  if (query.outcome !== undefined) {
    const asked = typeof query.outcome === 'string' ? splitTerms(query.outcome) : [];
    if (asked.length === 0 || asked.some((o) => !OUTCOMES.includes(o as Outcome))) {
      return bad('outcome must be success, warning or error (| for several)');
    }
    wanted = asked as Outcome[];
  }

  const file = logFileName(date);
  let text: string;
  try {
    text = fs.readFileSync(path.join(opts.dir, file), 'utf8');
  } catch {
    return { ok: false, errorCode: 'NOT_FOUND', error: `No log for ${date}`, available: availableDays(opts.dir) };
  }

  const counts: Record<Outcome, number> = { success: 0, warning: 0, error: 0 };
  const matching: LogEntry[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = redact(raw);
    const entry = toEntry(line);
    if (!entry) continue;
    counts[entry.outcome] += 1;
    if (!wanted.includes(entry.outcome)) continue;
    if (terms.length > 0 && !terms.some((t) => line.toLowerCase().includes(t))) continue;
    matching.push(entry);
  }
  const entries = matching.slice(-tail);

  return { ok: true, file, days: availableDays(opts.dir), counts, matched: matching.length, returned: entries.length, entries };
}
