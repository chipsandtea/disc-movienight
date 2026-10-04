import { describe, it, expect } from 'vitest';
import { parseTimeString, calculateEventDate } from '../src/utils/dateHelper.js';

describe('Date & Time Helper', () => {
  it('parses various time string formats', () => {
    expect(parseTimeString('8:00 PM')).toEqual({ hours: 20, minutes: 0 });
    expect(parseTimeString('8:30pm')).toEqual({ hours: 20, minutes: 30 });
    expect(parseTimeString('8pm')).toEqual({ hours: 20, minutes: 0 });
    expect(parseTimeString('11:45 AM')).toEqual({ hours: 11, minutes: 45 });
    expect(parseTimeString('12:00 AM')).toEqual({ hours: 0, minutes: 0 });
    expect(parseTimeString('12:30 PM')).toEqual({ hours: 12, minutes: 30 });
    expect(parseTimeString('21:15')).toEqual({ hours: 21, minutes: 15 });
    expect(parseTimeString('7:00')).toEqual({ hours: 19, minutes: 0 }); // assumed evening for movie night
    expect(parseTimeString()).toEqual({ hours: 20, minutes: 0 }); // default
  });

  it('calculates event date for tomorrow and weekdays', () => {
    // Reference date: Wednesday Oct 14, 2026 at 12:00 PM
    const refWednesday = new Date('2026-10-14T12:00:00');

    // Tomorrow -> Thursday Oct 15 at 8:00 PM
    const tomorrow = calculateEventDate('tomorrow', '8:00 PM', refWednesday);
    expect(tomorrow.getDate()).toBe(15);
    expect(tomorrow.getHours()).toBe(20);

    // Friday -> Oct 16
    const friday = calculateEventDate('Friday', '8:30 PM', refWednesday);
    expect(friday.getDate()).toBe(16);
    expect(friday.getHours()).toBe(20);
    expect(friday.getMinutes()).toBe(30);

    // Saturday -> Oct 17
    const saturday = calculateEventDate('Saturday', '9:00 PM', refWednesday);
    expect(saturday.getDate()).toBe(17);
    expect(saturday.getHours()).toBe(21);

    // Sunday -> Oct 18
    const sunday = calculateEventDate('Sunday', '7:00 PM', refWednesday);
    expect(sunday.getDate()).toBe(18);
    expect(sunday.getHours()).toBe(19);

    // Today (Wednesday) at 8:00 PM (future today) -> Oct 14 at 20:00
    const todayEvening = calculateEventDate('today', '8:00 PM', refWednesday);
    expect(todayEvening.getDate()).toBe(14);
    expect(todayEvening.getHours()).toBe(20);

    // Wednesday when 8:00 PM already passed (ref: 11 PM) -> Next Wednesday Oct 21
    const refLateWed = new Date('2026-10-14T23:00:00');
    const nextWed = calculateEventDate('Wednesday', '8:00 PM', refLateWed);
    expect(nextWed.getDate()).toBe(21);
  });
});
