import { describe, it, expect } from 'vitest';
import { parseRating } from '../src/utils/ratingParser.js';

describe('Rating Parser', () => {
  it('parses standard whole number integers', () => {
    expect(parseRating('8')).toEqual({ valid: true, rating: 8 });
    expect(parseRating('10')).toEqual({ valid: true, rating: 10 });
    expect(parseRating('0')).toEqual({ valid: true, rating: 0 });
  });

  it('parses half points with dot notation', () => {
    expect(parseRating('8.5')).toEqual({ valid: true, rating: 8.5 });
    expect(parseRating('7.2')).toEqual({ valid: true, rating: 7.2 });
    expect(parseRating('0.5')).toEqual({ valid: true, rating: 0.5 });
  });

  it('parses European comma notation', () => {
    expect(parseRating('8,5')).toEqual({ valid: true, rating: 8.5 });
    expect(parseRating('9,0')).toEqual({ valid: true, rating: 9 });
  });

  it('parses fractional /10 notations', () => {
    expect(parseRating('8/10')).toEqual({ valid: true, rating: 8 });
    expect(parseRating('8.5/10')).toEqual({ valid: true, rating: 8.5 });
    expect(parseRating('9.5/10.0')).toEqual({ valid: true, rating: 9.5 });
    expect(parseRating('8 / 10')).toEqual({ valid: true, rating: 8 });
    expect(parseRating('8.5 / 10')).toEqual({ valid: true, rating: 8.5 });
    expect(parseRating('8,5 / 10')).toEqual({ valid: true, rating: 8.5 });
  });

  it('rejects numbers outside the 0.0 to 10.0 range', () => {
    expect(parseRating('11').valid).toBe(false);
    expect(parseRating('-1').valid).toBe(false);
    expect(parseRating('10.5').valid).toBe(false);
  });

  it('rejects non-numeric text and empty inputs', () => {
    expect(parseRating('').valid).toBe(false);
    expect(parseRating('   ').valid).toBe(false);
    expect(parseRating('masterpiece').valid).toBe(false);
  });
});
