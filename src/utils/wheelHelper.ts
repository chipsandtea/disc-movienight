/**
 * Utility functions for exporting backlog movie titles to external spinner wheels.
 */

export interface WheelExportResult {
  titles: string[];
  plainText: string;
  wheelOfNamesUrl: string;
}

/**
 * Formats a list of movie titles for Wheel of Names or manual copy-pasting.
 */
export function formatWheelExport(movies: { title: string; releaseYear?: number | null }[]): WheelExportResult {
  const titles = movies.map(m => (m.releaseYear ? `${m.title} (${m.releaseYear})` : m.title));
  const plainText = titles.join('\n');

  // Wheel of Names accepts a URL parameter or can be used with custom format
  // Note: Wheel of Names API/URL parameters often use ?entries= encoded
  const encodedEntries = encodeURIComponent(titles.join('\n'));
  const wheelOfNamesUrl = `https://wheelofnames.com?entries=${encodedEntries}`;

  return {
    titles,
    plainText,
    wheelOfNamesUrl,
  };
}
