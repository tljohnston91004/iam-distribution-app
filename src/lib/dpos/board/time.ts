/**
 * Stage 4D company-local time helpers. The company's own IANA time zone decides every week boundary; there is never a UTC fallback
 * (an invalid or missing zone is an error the caller surfaces, not a silent default).
 */
import { iamOperatingPeriodFor, isValidIanaTimeZone } from "../contract/iam-results-return";

const DAY_MS = 24 * 3600 * 1000;

/** The instant of local midnight at the start of `dateStr` (YYYY-MM-DD) in `timeZone`. */
export function localMidnightInstant(dateStr: string, timeZone: string): Date {
  if (!isValidIanaTimeZone(timeZone)) throw new RangeError(`Invalid IANA time zone: ${String(timeZone)}`);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) throw new RangeError(`Invalid date: ${dateStr}`);
  const utcGuess = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const offsetAt = (ms: number): number => {
    const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
    return asUtc - Math.floor(ms / 1000) * 1000;
  };
  let instant = utcGuess - offsetAt(utcGuess);
  instant = utcGuess - offsetAt(instant); // second pass settles a daylight-saving boundary
  return new Date(instant);
}

export interface OperatingWeek {
  /** The Sunday, YYYY-MM-DD. */
  start: string;
  /** The Saturday, YYYY-MM-DD. */
  end: string;
  startsAt: Date;
}

export function operatingWeekFor(at: Date, timeZone: string): OperatingWeek {
  const p = iamOperatingPeriodFor(at, timeZone);
  return { start: p.start, end: p.end, startsAt: localMidnightInstant(p.start, timeZone) };
}

/** Sunday of the operating week `weeks` weeks before the week containing `at`. */
export function operatingWeekBefore(at: Date, timeZone: string, weeks: number): OperatingWeek {
  const cur = operatingWeekFor(at, timeZone);
  const d = new Date(Date.parse(`${cur.start}T00:00:00.000Z`) - weeks * 7 * DAY_MS);
  const start = d.toISOString().slice(0, 10);
  const end = new Date(d.getTime() + 6 * DAY_MS).toISOString().slice(0, 10);
  return { start, end, startsAt: localMidnightInstant(start, timeZone) };
}
