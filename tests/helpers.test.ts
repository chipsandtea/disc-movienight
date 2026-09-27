import { describe, it, expect } from 'vitest';
import { formatWheelExport } from '../src/utils/wheelHelper.js';
import { formatRuntime } from '../src/utils/discordHelpers.js';

describe('Wheel Helper', () => {
  it('formats movie titles with release years', () => {
    const list = [
      { title: 'The Matrix', releaseYear: 1999 },
      { title: 'Inception', releaseYear: 2010 },
      { title: 'Unknown Film', releaseYear: null },
    ];

    const result = formatWheelExport(list);
    expect(result.titles).toEqual([
      'The Matrix (1999)',
      'Inception (2010)',
      'Unknown Film',
    ]);
    expect(result.plainText).toBe('The Matrix (1999)\nInception (2010)\nUnknown Film');
    expect(result.wheelOfNamesUrl).toContain('https://wheelofnames.com?entries=');
    expect(result.wheelOfNamesUrl).toContain(encodeURIComponent('The Matrix (1999)'));
  });
});

describe('Discord Helpers', () => {
  it('formats runtime into hours and minutes', () => {
    expect(formatRuntime(null)).toBe('Unknown runtime');
    expect(formatRuntime(0)).toBe('Unknown runtime');
    expect(formatRuntime(45)).toBe('45m');
    expect(formatRuntime(120)).toBe('2h');
    expect(formatRuntime(136)).toBe('2h 16m');
  });
});
