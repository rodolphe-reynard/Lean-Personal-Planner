import { Task, TaskDeadline, TaskStatus } from '../types';

export type DateLocale = 'en' | 'fr';

const SHORT_MONTHS: Record<DateLocale, string[]> = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  fr: ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'],
};

const SHORT_DAYS: Record<DateLocale, string[]> = {
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  fr: ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'],
};

const FULL_DAYS: Record<DateLocale, string[]> = {
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  fr: ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'],
};

/**
 * Formats a local Date into YYYY-MM-DD without UTC conversion shifts.
 */
export function formatLocalDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Returns today's date in the user's local timezone as YYYY-MM-DD.
 */
export function getTodayDateString(): string {
  return formatLocalDate(new Date());
}

/**
 * Parses a YYYY-MM-DD string into a local Date anchored at 12:00 noon to prevent DST midnight drift.
 */
export function parseLocalDate(dateStr: string): Date {
  const parts = dateStr.split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
  }
  const [y, m, d] = parts;
  return new Date(y, m - 1, d, 12, 0, 0);
}

export function isValidDateString(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d, 12, 0, 0);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

export function addDays(dateStr: string, days: number): string {
  const dt = parseLocalDate(dateStr);
  dt.setDate(dt.getDate() + days);
  return formatLocalDate(dt);
}

export function getDatesBetween(startDate: string, endDate: string, maxDays = 180): string[] {
  const from = startDate <= endDate ? startDate : endDate;
  const to = startDate <= endDate ? endDate : startDate;
  const result: string[] = [];
  let cursor = from;
  let count = 0;
  while (cursor <= to && count < maxDays) {
    result.push(cursor);
    cursor = addDays(cursor, 1);
    count += 1;
  }
  return result;
}

/**
 * Returns the Saturday (YYYY-MM-DD) starting the Sat–Fri week containing dateStr.
 * Saturday = first day of week, Friday = last day of week.
 */
export function getStartOfWeek(dateStr: string): string {
  const dt = parseLocalDate(dateStr);
  const jsDay = dt.getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
  const diffToSaturday = -((jsDay + 1) % 7);
  dt.setDate(dt.getDate() + diffToSaturday);
  return formatLocalDate(dt);
}

/**
 * Returns an ordered 7-element array [Sat, Sun, Mon, Tue, Wed, Thu, Fri] as YYYY-MM-DD strings.
 */
export function getWeekDays(weekStartStr: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStartStr, i));
}

export function isDateInWeek(dateStr: string, weekStartStr: string): boolean {
  const weekEndStr = addDays(weekStartStr, 6);
  return dateStr >= weekStartStr && dateStr <= weekEndStr;
}

/**
 * Calculates ISO-8601 week number (1..53) for a given YYYY-MM-DD date.
 */
export function getISOWeekNumber(dateStr: string): number {
  const dt = parseLocalDate(dateStr);
  const dayNum = dt.getDay() || 7;
  dt.setDate(dt.getDate() + 4 - dayNum);
  const yearStart = new Date(dt.getFullYear(), 0, 1, 12, 0, 0);
  return Math.ceil(((dt.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export function formatWeekRange(weekStartStr: string, lang: DateLocale = 'en'): string {
  const months = SHORT_MONTHS[lang];
  const start = parseLocalDate(weekStartStr);
  const end = parseLocalDate(addDays(weekStartStr, 6));

  const sDay = start.getDate();
  const eDay = end.getDate();
  const sMonth = months[start.getMonth()];
  const eMonth = months[end.getMonth()];
  const sYear = start.getFullYear();
  const eYear = end.getFullYear();

  if (sYear !== eYear) {
    return `${sDay} ${sMonth} ${sYear} – ${eDay} ${eMonth} ${eYear}`;
  }
  if (start.getMonth() !== end.getMonth()) {
    return `${sDay} ${sMonth} – ${eDay} ${eMonth} ${eYear}`;
  }
  return `${sDay} – ${eDay} ${eMonth} ${eYear}`;
}

export function formatShortDate(dateStr: string, lang: DateLocale = 'en'): string {
  const dt = parseLocalDate(dateStr);
  return `${dt.getDate()} ${SHORT_MONTHS[lang][dt.getMonth()]} ${dt.getFullYear()}`;
}

export function formatCompactDate(dateStr: string, lang: DateLocale = 'en'): string {
  const dt = parseLocalDate(dateStr);
  return `${dt.getDate()} ${SHORT_MONTHS[lang][dt.getMonth()]}`;
}

export function formatDayHeader(
  dateStr: string,
  lang: DateLocale = 'en'
): { shortName: string; fullName: string; dayNum: number; monthShort: string } {
  const dt = parseLocalDate(dateStr);
  const idx = dt.getDay(); // 0=Sun..6=Sat
  return {
    shortName: SHORT_DAYS[lang][idx],
    fullName: FULL_DAYS[lang][idx],
    dayNum: dt.getDate(),
    monthShort: SHORT_MONTHS[lang][dt.getMonth()],
  };
}

export function getTaskDeadlines(task: Task): TaskDeadline[] {
  if (Array.isArray(task.deadlines) && task.deadlines.length > 0) {
    return [...task.deadlines]
      .filter((d) => isValidDateString(d.date))
      .sort((a, b) => a.date.localeCompare(b.date));
  }
  return isValidDateString(task.deadline)
    ? [{ id: `${task.id}-dl-0`, date: task.deadline, label: 'Deadline' }]
    : [];
}

export function getPrimaryDeadline(deadlines: TaskDeadline[], fallback?: string): string {
  const valid = deadlines.filter((d) => isValidDateString(d.date)).sort((a, b) => a.date.localeCompare(b.date));
  if (valid.length > 0) return valid[0].date;
  return fallback && isValidDateString(fallback) ? fallback : getTodayDateString();
}

export function getNextRelevantDeadline(task: Task, todayStr: string): TaskDeadline {
  const list = getTaskDeadlines(task);
  if (list.length === 0) {
    return { id: `${task.id}-dl-fallback`, date: task.deadline };
  }
  if (task.status === 'completed') {
    return list[list.length - 1];
  }
  return list.find((d) => d.date >= todayStr) ?? list[0];
}

export function doesTaskHaveDeadlineInWeek(task: Task, weekStartStr: string): boolean {
  const deadlines = getTaskDeadlines(task);
  return deadlines.some((d) => isDateInWeek(d.date, weekStartStr));
}

export function isTaskOverdue(taskOrDeadline: Task | string, status: TaskStatus, todayStr: string): boolean {
  if (status === 'completed') return false;
  if (typeof taskOrDeadline === 'string') {
    return taskOrDeadline < todayStr;
  }
  const deadlines = getTaskDeadlines(taskOrDeadline);
  return deadlines.some((d) => d.date < todayStr);
}

export function formatRelativeDeadline(
  deadlineStr: string,
  todayStr: string,
  status: TaskStatus,
  lang: DateLocale = 'en'
): {
  label: string;
  isOverdue: boolean;
  isDueToday: boolean;
  isDueSoon: boolean;
} {
  if (status === 'completed') {
    return { label: formatShortDate(deadlineStr, lang), isOverdue: false, isDueToday: false, isDueSoon: false };
  }
  const d1 = parseLocalDate(todayStr).getTime();
  const d2 = parseLocalDate(deadlineStr).getTime();
  const diffDays = Math.round((d2 - d1) / 86400000);

  if (diffDays < 0) {
    const overdue = Math.abs(diffDays);
    return {
      label: lang === 'fr' ? `Retard ${overdue}j` : `${overdue}d overdue`,
      isOverdue: true,
      isDueToday: false,
      isDueSoon: false,
    };
  }
  if (diffDays === 0) {
    return {
      label: lang === 'fr' ? "Aujourd'hui" : 'Due today',
      isOverdue: false,
      isDueToday: true,
      isDueSoon: true,
    };
  }
  if (diffDays === 1) {
    return {
      label: lang === 'fr' ? 'Demain' : 'Due tomorrow',
      isOverdue: false,
      isDueToday: false,
      isDueSoon: true,
    };
  }
  if (diffDays <= 7) {
    return {
      label: lang === 'fr' ? `Dans ${diffDays}j` : `In ${diffDays}d`,
      isOverdue: false,
      isDueToday: false,
      isDueSoon: true,
    };
  }
  return {
    label: lang === 'fr' ? `Dans ${diffDays}j` : `In ${diffDays}d`,
    isOverdue: false,
    isDueToday: false,
    isDueSoon: false,
  };
}

export function formatMinutesToTime(minutesFromMidnight: number): string {
  const clamped = Math.max(0, Math.min(24 * 60, minutesFromMidnight));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
