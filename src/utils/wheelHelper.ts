/**
 * Utility functions for exporting backlog movie titles to external spinner wheels (Picker Wheel).
 */

export interface WheelExportResult {
  titles: string[];
  plainText: string;
  pickerWheelUrl: string;
}

/**
 * Formats a list of movie titles for Picker Wheel (pickerwheel.com) or manual copy-pasting.
 */
export function formatWheelExport(movies: { title: string; releaseYear?: number | null }[]): WheelExportResult {
  const titles = movies.map(m => (m.releaseYear ? `${m.title} (${m.releaseYear})` : m.title));
  const plainText = titles.join('\n');

  // Picker Wheel choices parameter syntax (replace commas in titles to avoid splitting slices)
  const sanitizedChoices = titles.map(t => t.replace(/,/g, ' -'));
  const encodedChoices = encodeURIComponent(sanitizedChoices.join(','));
  const pickerWheelUrl = `https://pickerwheel.com/?choices=${encodedChoices}`;

  return {
    titles,
    plainText,
    pickerWheelUrl,
  };
}
