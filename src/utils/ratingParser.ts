export interface RatingParseResult {
  valid: boolean;
  rating?: number;
  error?: string;
}

/**
 * Parses and validates user-submitted rating strings.
 * Forgiving parser that supports:
 * - Whole numbers: "8", "10", "0"
 * - Decimals with dot or comma: "8.5", "8,5", "7.2"
 * - Fractional formats: "8/10", "8.5/10"
 * 
 * Valid range: 0.0 to 10.0
 */
export function parseRating(input: string): RatingParseResult {
  if (!input || typeof input !== 'string') {
    return { valid: false, error: 'Please enter a rating between 0 and 10.' };
  }

  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { valid: false, error: 'Rating cannot be empty.' };
  }

  // Handle "/10" suffix with optional whitespace (e.g. "8.5/10", "8.5 / 10")
  let sanitized = trimmed.replace(/\s*\/\s*10(\.0+)?$/i, '').trim();

  // Normalize commas to dots (e.g. "8,5" -> "8.5")
  sanitized = sanitized.replace(',', '.');

  // Check if sanitized string is numeric
  if (!/^[0-9]+(\.[0-9]+)?$/.test(sanitized)) {
    return {
      valid: false,
      error: `"${trimmed}" is not a valid number. Please provide a score like 8 or 8.5.`,
    };
  }

  const num = parseFloat(sanitized);
  if (isNaN(num)) {
    return { valid: false, error: 'Could not parse number.' };
  }

  if (num < 0 || num > 10) {
    return {
      valid: false,
      error: `Score must be between 0 and 10 (received ${num}).`,
    };
  }

  // Round to 1 decimal place (e.g. 8.25 -> 8.3)
  const rounded = Math.round(num * 10) / 10;

  return {
    valid: true,
    rating: rounded,
  };
}
