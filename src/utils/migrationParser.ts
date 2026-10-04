import { parseRating } from './ratingParser.js';

export interface UserMappingEntry {
  discordUserId: string;
  discordUsername: string;
  emails: string[];
  names: string[];
}

export interface UserMappingConfig {
  users: UserMappingEntry[];
}

export interface ParsedSubmission {
  timestamp: Date | null;
  timestampRaw: string;
  email: string;
  name: string;
  score: number;
}

export interface ResolvedSubmission extends ParsedSubmission {
  userId: string;
  userName: string;
}

export interface ResolvedUser {
  userId: string;
  userName: string;
}

/**
 * Resolves a participant (by email and/or name) to their Discord user ID and username.
 * Matching hierarchy:
 * 1. Name match for distinct guest users (e.g. Sammie submitted via another's device)
 * 2. Exact email match (case-insensitive)
 * 3. Fallback name / nickname alias match (case-insensitive)
 */
export function resolveUser(
  email: string,
  name: string,
  mapping: UserMappingConfig
): ResolvedUser | null {
  const normEmail = email.trim().toLowerCase();
  const normName = name.trim().toLowerCase();

  // 1. High priority check: Distinct named participant whose entry is configured specifically
  // (e.g. Sammie who has no email configured or distinct names)
  if (normName) {
    const distinctNameMatch = mapping.users.find(
      u =>
        u.names.some(n => n.trim().toLowerCase() === normName) &&
        (u.emails.length === 0 || u.emails.some(e => e.trim().toLowerCase() === normEmail))
    );
    if (distinctNameMatch && distinctNameMatch.discordUserId) {
      return {
        userId: distinctNameMatch.discordUserId,
        userName: distinctNameMatch.discordUsername,
      };
    }
  }

  // 2. Exact email match
  if (normEmail) {
    const emailMatch = mapping.users.find(u =>
      u.emails.some(e => e.trim().toLowerCase() === normEmail)
    );
    if (emailMatch && emailMatch.discordUserId) {
      return {
        userId: emailMatch.discordUserId,
        userName: emailMatch.discordUsername,
      };
    }
  }

  // 3. Fallback name / alias match
  if (normName) {
    const fallbackMatch = mapping.users.find(u =>
      u.names.some(n => n.trim().toLowerCase() === normName)
    );
    if (fallbackMatch && fallbackMatch.discordUserId) {
      return {
        userId: fallbackMatch.discordUserId,
        userName: fallbackMatch.discordUsername,
      };
    }
  }

  return null;
}

/**
 * Parses raw CSV text into a list of submissions.
 * Dynamically identifies columns regardless of order (e.g. Score before Email vs Score after Name).
 */
export function parseCsvSubmissions(csvContent: string): ParsedSubmission[] {
  const lines = csvContent
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0);

  if (lines.length < 2) return [];

  // Parse header
  const header = parseCsvLine(lines[0]).map(h => h.trim().toLowerCase());

  let emailIdx = -1;
  let nameIdx = -1;
  let scoreIdx = -1;
  let timeIdx = -1;

  for (let i = 0; i < header.length; i++) {
    const col = header[i];
    if (col.includes('email')) emailIdx = i;
    else if (col.includes('name')) nameIdx = i;
    else if (col.includes('score')) scoreIdx = i;
    else if (col.includes('time')) timeIdx = i;
  }

  const submissions: ParsedSubmission[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    if (cols.length === 0 || cols.every(c => c.trim() === '')) continue;

    const email = emailIdx !== -1 && cols[emailIdx] ? cols[emailIdx].trim() : '';
    const name = nameIdx !== -1 && cols[nameIdx] ? cols[nameIdx].trim() : '';
    const rawScore = scoreIdx !== -1 && cols[scoreIdx] ? cols[scoreIdx].trim() : '';
    const rawTime = timeIdx !== -1 && cols[timeIdx] ? cols[timeIdx].trim() : '';

    const scoreResult = parseRating(rawScore);
    if (!scoreResult.valid || scoreResult.rating === undefined) {
      continue;
    }

    let parsedDate: Date | null = null;
    if (rawTime) {
      const parsedTime = Date.parse(rawTime);
      if (!isNaN(parsedTime)) {
        parsedDate = new Date(parsedTime);
      }
    }

    submissions.push({
      timestamp: parsedDate,
      timestampRaw: rawTime,
      email,
      name,
      score: scoreResult.rating,
    });
  }

  return submissions;
}

/**
 * Filters submissions to retain only the latest score per resolved user.
 * Preserves the chronologically latest submission if an attendee submitted more than once.
 */
export function deduplicateSubmissionsByLatest<T extends ParsedSubmission & { userId?: string }>(
  submissions: T[]
): T[] {
  // Sort chronologically ascending
  const sorted = [...submissions].sort((a, b) => {
    const timeA = a.timestamp ? a.timestamp.getTime() : 0;
    const timeB = b.timestamp ? b.timestamp.getTime() : 0;
    return timeA - timeB;
  });

  const latestByUser = new Map<string, T>();

  for (const sub of sorted) {
    const key = sub.userId || sub.email || sub.name;
    latestByUser.set(key, sub);
  }

  return Array.from(latestByUser.values());
}

/**
 * Robust CSV line tokenizer that properly handles double-quoted strings,
 * escaped quotes (""), and embedded commas.
 */
export function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++; // skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current);
  return result;
}
