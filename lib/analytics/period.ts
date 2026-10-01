/**
 * Analytics-periodelogica (2026-10-01) — puur en deterministisch.
 *
 * Alle dag-/week-/maand-/jaargrenzen zijn gedefinieerd in de lokale tijdzone
 * van de studio-eigenaar (Europe/Amsterdam), inclusief zomer-/wintertijd.
 * Geen moment gebruik van de server-tijdzone: Vercel draait UTC.
 */

export const AGENCY_TIMEZONE = "Europe/Amsterdam";

export type PeriodKind = "today" | "week" | "month" | "year" | "custom" | "all";

export interface PeriodRange {
  kind: PeriodKind;
  label: string;
  /** Inclusive start (UTC-instant). */
  from: Date;
  /** Exclusive end (UTC-instant). */
  to: Date;
}

const PERIOD_LABELS: Record<Exclude<PeriodKind, "custom">, string> = {
  today: "Vandaag",
  week: "Deze week",
  month: "Deze maand",
  year: "Dit jaar",
  all: "Sinds start",
};

// --- Tijdzone-hulpstukken -------------------------------------------------

const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: AGENCY_TIMEZONE,
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function zonedParts(date: Date): ZonedParts {
  const parts = partsFormatter.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
}

/** Offset (ms) van de agent-tijdzone op een gegeven UTC-instant. */
function tzOffsetMs(date: Date): number {
  const p = zonedParts(date);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - date.getTime();
}

/** UTC-instant van een lokale wandtijd (default middernacht) in de agent-tz. */
function zonedToUtc(year: number, month: number, day: number, hour = 0, minute = 0): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const offset = tzOffsetMs(new Date(guess));
  return new Date(guess - offset);
}

/** Lokale datum (agent-tz) als {year, month, day}. */
export function localDateParts(date: Date): { year: number; month: number; day: number } {
  const p = zonedParts(date);
  return { year: p.year, month: p.month, day: p.day };
}

// --- Periode-berekening ---------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

export function periodRange(kind: PeriodKind, now: Date, custom?: { from?: string; to?: string }): PeriodRange {
  const { year, month, day } = localDateParts(now);

  switch (kind) {
    case "today":
      return { kind, label: PERIOD_LABELS.today, from: zonedToUtc(year, month, day), to: now };
    case "week": {
      // Maandag als weekstart (NL-conventie).
      const midnight = zonedToUtc(year, month, day).getTime();
      const weekday = zonedWeekday(now);
      const monday = new Date(midnight - weekday * DAY_MS);
      return { kind, label: PERIOD_LABELS.week, from: monday, to: now };
    }
    case "month":
      return { kind, label: PERIOD_LABELS.month, from: zonedToUtc(year, month, 1), to: now };
    case "year":
      return { kind, label: PERIOD_LABELS.year, from: zonedToUtc(year, 1, 1), to: now };
    case "custom": {
      const from = parseDateInput(custom?.from);
      const to = parseDateInput(custom?.to, true);
      if (!from || !to || from.getTime() >= to.getTime()) {
        return periodRange("month", now);
      }
      const label = `${fmtDayLabel(from)} – ${fmtDayLabel(new Date(to.getTime() - 1))}`;
      return { kind, label, from, to };
    }
    case "all":
    default:
      return { kind: "all", label: PERIOD_LABELS.all, from: new Date(0), to: now };
  }
}

function zonedWeekday(date: Date): number {
  // 0 = maandag … 6 = zondag, berekend in de agent-tz.
  const { year, month, day } = localDateParts(date);
  const utcMidnight = Date.UTC(year, month - 1, day);
  // Date.UTC behandelt de datum als lokale callee-loos (UTC), dus getUTCDay
  // geeft de weekdag van de *lokale* kalenderdag.
  return (new Date(utcMidnight).getUTCDay() + 6) % 7;
}

export function parseDateInput(value: string | undefined, endOfDay = false): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = zonedToUtc(y, m, d, endOfDay ? 23 : 0, endOfDay ? 59 : 0);
  if (endOfDay) date.setUTCSeconds(59, 999);
  return date;
}

function fmtDayLabel(date: Date): string {
  const { year, month, day } = localDateParts(date);
  return `${day}-${month}-${year}`;
}

// --- Periodeselectie uit searchParams --------------------------------------

const KINDS: PeriodKind[] = ["today", "week", "month", "year", "custom", "all"];

export function parsePeriodSearchParams(params: Record<string, string | string[] | undefined>, now: Date): PeriodRange {
  const raw = Array.isArray(params.period) ? params.period[0] : params.period;
  const kind: PeriodKind = KINDS.includes(raw as PeriodKind) ? (raw as PeriodKind) : "month";
  const from = Array.isArray(params.from) ? params.from[0] : params.from;
  const to = Array.isArray(params.to) ? params.to[0] : params.to;
  return kind === "custom" ? periodRange("custom", now, { from, to }) : periodRange(kind, now);
}

/** Vorige periode met dezelfde lengte (periode-over-periode vergelijking). */
export function previousRange(range: PeriodRange): PeriodRange | null {
  if (range.kind === "all") return null;
  const length = range.to.getTime() - range.from.getTime();
  return {
    kind: range.kind,
    label: "Vorige periode",
    from: new Date(range.from.getTime() - length),
    to: range.from,
  };
}

// --- Bucketing voor tijdreeksen --------------------------------------------

export interface TimeBucket {
  key: string;
  label: string;
  from: Date;
  to: Date;
}

const MONTH_LABELS = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];

/** Maand-buckets (agent-tz) van `from` tot en met de maand van `to`. */
export function monthlyBuckets(from: Date, to: Date, maxBuckets = 12): TimeBucket[] {
  const start = localDateParts(from);
  const end = localDateParts(to);
  const buckets: TimeBucket[] = [];
  let y = start.year;
  let m = start.month;
  // Blijf binnen maxBuckets: start eventueel later zodat de nieuwste maand telt.
  const totalMonths =
    (end.year - y) * 12 + (end.month - m) + 1;
  if (totalMonths > maxBuckets) {
    const skip = totalMonths - maxBuckets;
    y += Math.floor((m - 1 + skip) / 12);
    m = (((m - 1 + skip) % 12) + 1);
  }
  while (y < end.year || (y === end.year && m <= end.month)) {
    const nextY = m === 12 ? y + 1 : y;
    const nextM = m === 12 ? 1 : m + 1;
    buckets.push({
      key: `${y}-${String(m).padStart(2, "0")}`,
      label: `${MONTH_LABELS[m - 1]}${String(y).slice(2) !== "00" ? ` '${String(y).slice(2)}` : ""}`,
      from: zonedToUtc(y, m, 1),
      to: zonedToUtc(nextY, nextM, 1),
    });
    y = nextY;
    m = nextM;
  }
  return buckets;
}

/** Dag-buckets (agent-tz) voor korte periodes (vandaag/week/maand/custom). */
export function dailyBuckets(from: Date, to: Date, maxBuckets = 31): TimeBucket[] {
  const startDay = localDateParts(from);
  const buckets: TimeBucket[] = [];
  let cursor = zonedToUtc(startDay.year, startDay.month, startDay.day);
  const endLimit = to.getTime();
  while (cursor.getTime() < endLimit && buckets.length < maxBuckets) {
    const next = new Date(cursor.getTime() + DAY_MS);
    const { year, month, day } = localDateParts(cursor);
    buckets.push({
      key: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      label: `${day} ${MONTH_LABELS[month - 1]}`,
      from: cursor,
      to: next,
    });
    cursor = next;
  }
  return buckets;
}

/** Tel items per bucket (timestamp-extractie + range-check). */
export function bucketCounts<T>(items: T[], buckets: TimeBucket[], timestampOf: (item: T) => string | null | undefined): number[] {
  const sorted = items
    .map((item) => timestampOf(item))
    .filter((ts): ts is string => typeof ts === "string")
    .map((ts) => new Date(ts).getTime())
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
  return buckets.map((bucket) => {
    const from = bucket.from.getTime();
    const to = bucket.to.getTime();
    let count = 0;
    for (const t of sorted) {
      if (t >= to) break;
      if (t >= from) count += 1;
    }
    return count;
  });
}

/** Som van een numerieke waarde per bucket. */
export function bucketSums<T>(items: T[], buckets: TimeBucket[], timestampOf: (item: T) => string | null | undefined, valueOf: (item: T) => number): number[] {
  const rows = items
    .map((item) => ({ t: timestampOf(item), v: valueOf(item) }))
    .filter((row): row is { t: string; v: number } => typeof row.t === "string" && Number.isFinite(row.v))
    .map((row) => ({ t: new Date(row.t).getTime(), v: row.v }))
    .filter((row) => Number.isFinite(row.t))
    .sort((a, b) => a.t - b.t);
  return buckets.map((bucket) => {
    const from = bucket.from.getTime();
    const to = bucket.to.getTime();
    let sum = 0;
    for (const row of rows) {
      if (row.t >= to) break;
      if (row.t >= from) sum += row.v;
    }
    return sum;
  });
}
