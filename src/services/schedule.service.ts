import { eq, desc, or, and } from 'drizzle-orm';
import { db } from '../db/client.js';
import { schedulingSessions, availabilityVotes, SchedulingSession } from '../db/schema.js';

export interface ParsedVote {
  userId: string;
  userName: string;
  selectedDays: string[];
}

/**
 * Creates a new weekly availability scheduling session.
 * Requires a planned movie ID. Automatically deactivates any previously active session.
 */
export async function createSchedulingSession(
  candidateDays: string[],
  defaultTime: string = '8:00 PM',
  plannedMovieId: number,
  channelId?: string
): Promise<SchedulingSession> {
  return db.transaction(async tx => {
    // Cancel previous active sessions
    await tx
      .update(schedulingSessions)
      .set({ status: 'cancelled' })
      .where(eq(schedulingSessions.status, 'active'));

    const [session] = await tx
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
  });
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
 * Retrieves the most recent active or finalized scheduling session.
 */
export async function getLatestSchedulingSession(): Promise<SchedulingSession | null> {
  const results = await db
    .select()
    .from(schedulingSessions)
    .where(or(eq(schedulingSessions.status, 'active'), eq(schedulingSessions.status, 'finalized')))
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
 * Updates the planned movie ID associated with a scheduling session.
 */
export async function updateSessionPlannedMovie(sessionId: number, plannedMovieId: number): Promise<void> {
  await db
    .update(schedulingSessions)
    .set({ plannedMovieId })
    .where(eq(schedulingSessions.id, sessionId));
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
  const existingRecords = await db
    .select()
    .from(availabilityVotes)
    .where(and(eq(availabilityVotes.sessionId, sessionId), eq(availabilityVotes.userId, userId)))
    .limit(1);

  const userRecord = existingRecords[0];
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

  await db
    .insert(availabilityVotes)
    .values({
      sessionId,
      userId,
      userName,
      selectedDays: JSON.stringify(currentDays),
      updatedAt: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: [availabilityVotes.sessionId, availabilityVotes.userId],
      set: {
        selectedDays: JSON.stringify(currentDays),
        userName,
        updatedAt: new Date().toISOString(),
      },
    });

  return getSessionVotes(sessionId);
}

/**
 * Finalizes or modifies a scheduling session with the chosen day, time, and Discord event info.
 */
export async function finalizeSchedulingSession(
  sessionId: number,
  winningDay: string,
  timeSlot?: string,
  discordEventId?: string | null,
  scheduledStartTime?: string | null
): Promise<SchedulingSession | null> {
  const slot = timeSlot ? `${winningDay} @ ${timeSlot}` : winningDay;

  const updateData: Partial<SchedulingSession> = {
    status: 'finalized',
    finalizedSlot: slot,
  };

  if (discordEventId !== undefined) {
    updateData.discordEventId = discordEventId;
  }
  if (scheduledStartTime !== undefined) {
    updateData.scheduledStartTime = scheduledStartTime;
  }

  const [finalized] = await db
    .update(schedulingSessions)
    .set(updateData)
    .where(eq(schedulingSessions.id, sessionId))
    .returning();

  return finalized || null;
}

/**
 * Cancels a scheduling session.
 */
export async function cancelSchedulingSession(sessionId: number): Promise<void> {
  await db
    .update(schedulingSessions)
    .set({ status: 'cancelled' })
    .where(eq(schedulingSessions.id, sessionId));
}
