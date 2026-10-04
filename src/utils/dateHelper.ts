/**
 * Utilities for parsing human-friendly days and times into JavaScript Date objects
 * for Discord Scheduled Events.
 */

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};

/**
 * Parses time strings like "8:00 PM", "8pm", "20:30", "8:30" into hours and minutes.
 */
export function parseTimeString(timeStr?: string): { hours: number; minutes: number } {
  if (!timeStr) {
    return { hours: 20, minutes: 0 }; // Default 8:00 PM
  }

  const match = timeStr.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!match) {
    return { hours: 20, minutes: 0 };
  }

  let hours = parseInt(match[1], 10);
  const minutes = match[2] ? parseInt(match[2], 10) : 0;
  const meridian = match[3] ? match[3].toLowerCase() : null;

  if (hours > 23 || minutes > 59) {
    return { hours: 20, minutes: 0 };
  }

  if (meridian === 'pm' && hours < 12) {
    hours += 12;
  } else if (meridian === 'am' && hours === 12) {
    hours = 0;
  } else if (!meridian && hours >= 1 && hours <= 11) {
    // If user says "8:00" or "8" for a movie night without AM/PM, assume evening (20:00)
    hours += 12;
  }

  return { hours, minutes };
}

/**
 * Calculates a future Date from a day string (e.g. "Friday", "Saturday", "Tomorrow", "Tonight")
 * and an optional time string (e.g. "8:00 PM").
 */
export function calculateEventDate(dayInput: string, timeInput?: string, referenceDate: Date = new Date()): Date {
  const { hours, minutes } = parseTimeString(timeInput);
  const normalizedDay = dayInput.trim().toLowerCase();

  const targetDate = new Date(referenceDate);
  targetDate.setHours(hours, minutes, 0, 0);

  // 1. Check for "today" / "tonight"
  if (/\b(today|tonight)\b/.test(normalizedDay)) {
    if (targetDate.getTime() <= referenceDate.getTime() + 60_000) {
      // If time has already passed today, advance by 7 days
      targetDate.setDate(targetDate.getDate() + 7);
    }
    return targetDate;
  }

  // 2. Check for "tomorrow"
  if (/\btomorrow\b/.test(normalizedDay)) {
    targetDate.setDate(targetDate.getDate() + 1);
    return targetDate;
  }

  // 3. Check for weekday name (e.g. "Friday", "Saturday")
  let targetWeekday: number | undefined;
  // Sort by length descending so "saturday" is evaluated before "sat"
  const weekdayEntries = Object.entries(WEEKDAYS).sort((a, b) => b[0].length - a[0].length);
  for (const [name, dayNum] of weekdayEntries) {
    if (new RegExp(`\\b${name}\\b`).test(normalizedDay)) {
      targetWeekday = dayNum;
      break;
    }
  }

  if (targetWeekday !== undefined) {
    const currentDay = referenceDate.getDay();
    let dayDiff = (targetWeekday - currentDay + 7) % 7;

    // If today is the target day, but the scheduled time has already passed today
    if (dayDiff === 0 && targetDate.getTime() <= referenceDate.getTime() + 60_000) {
      dayDiff = 7;
    }

    targetDate.setDate(targetDate.getDate() + dayDiff);
    return targetDate;
  }

  // 4. Try parsing as standard date (e.g. "2026-10-15" or "Oct 15")
  const parsedTimestamp = Date.parse(dayInput);
  if (!isNaN(parsedTimestamp)) {
    const parsed = new Date(parsedTimestamp);
    parsed.setHours(hours, minutes, 0, 0);
    if (parsed.getTime() > referenceDate.getTime()) {
      return parsed;
    }
  }

  // 5. Fallback: 2 days in the future
  targetDate.setDate(targetDate.getDate() + 2);
  return targetDate;
}
