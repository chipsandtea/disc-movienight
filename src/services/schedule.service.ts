import { eq, desc } from 'drizzle-orm';
import { db } from '../db/client.js';
import { schedulingSessions, availabilityVotes, SchedulingSession, AvailabilityVote } from '../db/schema.js';

export interface ParsedVote {
  userId: string;
  userName: string;
  selectedDays: string[];
}

/**
 * Creates a new weekly availability scheduling session.
 * Automatically deactivates any previously active session.
 */
export async function createSchedulingSession(
  candidateDays: string[],
  defaultTime: string = '8:00 PM',
  plannedMovieId: number | null = null,
  channelId?: string
): Promise<SchedulingSession> {
  // Cancel previous active sessions
  await db
    .update(schedulingSessions)
    .set({ status: 'cancelled' })
    .where(eq(schedulingSessions.status, 'active'));

  const [session] = await db
    .insert(schedulingSessions)
    .values({
      candidateDays: JSON.stringify(candidateDays),
      defaultTime,
      plannedMovieId,
      channelId,
      status: 'active',
    })
    .returning();

  return session;
}

/**
 * Retrieves the currently active scheduling session, if any.
 */
export async function getActiveSchedulingSession(): Promise<SchedulingSession | null> {
  const results = await db
    .select()
    .from(schedulingSessions)
    .where(eq(schedulingSessions.status, 'active'))
    .orderBy(desc(schedulingSessions.createdAt))
    .limit(1);

  return results[0] || null;
}

/**
 * Retrieves a session by its primary ID.
 */
export async function getSchedulingSessionById(id: number): Promise<SchedulingSession | null> {
  const results = await db
    .select()
    .from(schedulingSessions)
    .where(eq(schedulingSessions.id, id))
    .limit(1);

  return results[0] || null;
}

/**
 * Updates the Discord message ID linked to a session.
 */
export async function updateSessionMessageId(id: number, messageId: string): Promise<void> {
  await db
    .update(schedulingSessions)
    .set({ messageId })
    .where(eq(schedulingSessions.id, id));
}

/**
 * Fetches and parses all availability votes for a given session.
 */
export async function getSessionVotes(sessionId: number): Promise<ParsedVote[]> {
  const votes = await db
    .select()
    .from(availabilityVotes)
    .where(eq(availabilityVotes.sessionId, sessionId));

  return votes.map(v => {
    let days: string[] = [];
    try {
      days = JSON.parse(v.selectedDays) as string[];
    } catch {
      days = [];
    }
    return {
      userId: v.userId,
      userName: v.userName,
      selectedDays: days,
    };
  });
}

/**
 * Toggles a user's availability for a specific day in a session.
 * Stateless and persisted directly to SQLite.
 */
export async function toggleUserAvailability(
  sessionId: number,
  userId: string,
  userName: string,
  day: string
): Promise<ParsedVote[]> {
  const existingVote = await db
    .select()
    .from(availabilityVotes)
    .where(eq(availabilityVotes.sessionId, sessionId))
    .all();

  const userRecord = existingVote.find(v => v.userId === userId);
  let currentDays: string[] = [];

  if (userRecord) {
    try {
      currentDays = JSON.parse(userRecord.selectedDays) as string[];
    } catch {
      currentDays = [];
    }
  }

  if (day === 'NONE') {
    // "Cannot make it" button: toggle between empty and ['NONE']
    if (currentDays.includes('NONE')) {
      currentDays = [];
    } else {
      currentDays = ['NONE'];
    }
  } else {
    // Normal day: remove 'NONE' if present
    currentDays = currentDays.filter(d => d !== 'NONE');
    if (currentDays.includes(day)) {
      currentDays = currentDays.filter(d => d !== day);
    } else {
      currentDays.push(day);
    }
  }

  if (userRecord) {
    await db
      .update(availabilityVotes)
      .set({
        selectedDays: JSON.stringify(currentDays),
        userName,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(availabilityVotes.id, userRecord.id));
  } else {
    await db.insert(availabilityVotes).values({
      sessionId,
      userId,
      userName,
      selectedDays: JSON.stringify(currentDays),
    });
  }

  return getSessionVotes(sessionId);
}

/**
 * Finalizes a scheduling session with the chosen day and time.
 */
export async function finalizeSchedulingSession(
  sessionId: number,
  winningDay: string,
  timeSlot?: string
): Promise<SchedulingSession | null> {
  const slot = timeSlot ? `${winningDay} @ ${timeSlot}` : winningDay;

  const [finalized] = await db
    .update(schedulingSessions)
    .set({
      status: 'finalized',
      finalizedSlot: slot,
    })
    .where(eq(schedulingSessions.id, sessionId))
    .returning();

  return finalized || null;
}

/**
 * Cancels an active scheduling session.
 */
export async function cancelSchedulingSession(sessionId: number): Promise<void> {
  await db
    .update(schedulingSessions)
    .set({ status: 'cancelled' })
    .where(eq(schedulingSessions.id, sessionId));
}
