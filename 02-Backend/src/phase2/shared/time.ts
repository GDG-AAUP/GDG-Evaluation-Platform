// The platform's single definition of "which month is it": Asia/Hebron.

export const APP_TIME_ZONE = 'Asia/Hebron';

export type YearMonth = { year: number; month: number };

export function currentYearMonth(now: Date = new Date()): YearMonth {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit'
  }).formatToParts(now);

  return {
    year: Number(parts.find((p) => p.type === 'year')?.value),
    month: Number(parts.find((p) => p.type === 'month')?.value)
  };
}

export function previousYearMonth({ year, month }: YearMonth): YearMonth {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

export function monthId({ year, month }: YearMonth): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function parseMonthId(value: unknown): YearMonth | null {
  const match = /^(\d{4})-(\d{2})$/.exec(String(value ?? ''));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  return year >= 2000 && month >= 1 && month <= 12 ? { year, month } : null;
}

export type PeriodBounds = { start: string | null; end: string | null };

/** Hebron wall-clock bounds: a month, a whole year (month null), or unbounded (year null). */
export function periodBounds(year: number | null, month: number | null): PeriodBounds {
  if (year === null) return { start: null, end: null };
  if (month === null) {
    return { start: `${year}-01-01 00:00:00`, end: `${year + 1}-01-01 00:00:00` };
  }
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  return {
    start: `${monthId({ year, month })}-01 00:00:00`,
    end: `${monthId(next)}-01 00:00:00`
  };
}

/** SQL condition limiting a TIMESTAMPTZ column to bounds held in two parameters. */
export function instantInPeriodSql(column: string, startParam: number, endParam: number): string {
  return `($${startParam}::timestamp IS NULL OR ${column} >= $${startParam}::timestamp AT TIME ZONE '${APP_TIME_ZONE}')
    AND ($${endParam}::timestamp IS NULL OR ${column} < $${endParam}::timestamp AT TIME ZONE '${APP_TIME_ZONE}')`;
}

export function campusKey(name: string): string {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, '-');
}
