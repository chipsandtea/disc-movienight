import { eq } from 'drizzle-orm';
import { VoiceBasedChannel } from 'discord.js';
import { db } from '../db/client.js';
import { attendance, Attendance } from '../db/schema.js';
import { getActiveSchedulingSession, getSessionVotes } from './schedule.service.js';

export interface CandidateAttendee {
  userId: string;
  userName: string;
  source: 'voice' | 'rsvp' | 'manual';
}

/**
 * Discovers potential movie attendees by inspecting the current voice channel
 * and cross-referencing voters from the scheduling session.
 */
export async function detectPotentialAttendees(
  voiceChannel?: VoiceBasedChannel | null
): Promise<CandidateAttendee[]> {
  const map = new Map<string, CandidateAttendee>();

  // 1. Check Voice Channel members
  if (voiceChannel) {
    for (const [memberId, member] of voiceChannel.members) {
      if (!member.user.bot) {
        map.set(memberId, {
          userId: memberId,
          userName: member.displayName || member.user.username,
          source: 'voice',
        });
      }
    }
  }

  // 2. Check active or recently finalized scheduling session
  const session = await getActiveSchedulingSession();
  if (session) {
    const votes = await getSessionVotes(session.id);
    for (const v of votes) {
      // If they voted for any day (and not NONE)
      if (v.selectedDays.length > 0 && !v.selectedDays.includes('NONE') && !map.has(v.userId)) {
        map.set(v.userId, {
          userId: v.userId,
          userName: v.userName,
          source: 'rsvp',
        });
      }
    }
  }

  return Array.from(map.values());
}

/**
 * Saves confirmed attendees into the database for a movie.
 */
export async function recordAttendance(
  movieId: number,
  attendees: { userId: string; userName: string }[]
): Promise<Attendance[]> {
  // Clear any existing attendance for this movie to allow clean re-runs
  await db.delete(attendance).where(eq(attendance.movieId, movieId));

  if (attendees.length === 0) return [];

  const records = await db
    .insert(attendance)
    .values(
      attendees.map(a => ({
        movieId,
        userId: a.userId,
        userName: a.userName,
      }))
    )
    .returning();

  return records;
}

/**
 * Retrieves the list of attendees recorded for a movie.
 */
export async function getAttendeesForMovie(movieId: number): Promise<Attendance[]> {
  return db
    .select()
    .from(attendance)
    .where(eq(attendance.movieId, movieId));
}
