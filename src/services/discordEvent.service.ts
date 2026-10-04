import {
  Guild,
  GuildScheduledEvent,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  GuildScheduledEventCreateOptions,
} from 'discord.js';
import { Movie, SchedulingSession } from '../db/schema.js';
import { formatRuntime } from '../utils/discordHelpers.js';

export interface SyncEventOptions {
  guild: Guild;
  session: SchedulingSession;
  movie: Movie;
  targetDate?: Date;
}

/**
 * Creates or updates a native Discord Scheduled Event to match the planned movie
 * and finalized schedule date/time.
 */
export async function syncDiscordEvent({
  guild,
  session,
  movie,
  targetDate,
}: SyncEventOptions): Promise<GuildScheduledEvent | null> {
  if (!guild || !guild.scheduledEvents) {
    return null;
  }

  const startTime = targetDate
    ? targetDate
    : session.scheduledStartTime
    ? new Date(session.scheduledStartTime)
    : new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);

  // Discord requires scheduledStartTime to be in the future
  if (startTime.getTime() <= Date.now() + 60_000) {
    console.warn('[EventSync] Scheduled start time is in the past or within 1 minute; skipping Discord Event creation/sync.');
    return null;
  }

  // Scheduled end time based on runtime + 30m buffer
  const runtimeMins = movie.runtimeMinutes || 120;
  const endTime = new Date(startTime.getTime() + (runtimeMins + 30) * 60 * 1000);

  const eventTitle = `🎬 Movie Night: ${movie.title}`.slice(0, 100);
  const overview = movie.overview ? `\n\n${movie.overview}` : '';
  const description = `Watching ${movie.title} (${movie.releaseYear || 'N/A'}). Runtime: ${formatRuntime(movie.runtimeMinutes)}.${overview}`.slice(0, 1000);

  const voiceChannel = guild.channels.cache.find(c => c.isVoiceBased());

  // 1. Try to update existing Discord Event if linked
  if (session.discordEventId) {
    try {
      const existingEvent = await guild.scheduledEvents.fetch(session.discordEventId);
      if (existingEvent) {
        const editPayload: Parameters<GuildScheduledEvent['edit']>[0] = {
          name: eventTitle,
          description,
          scheduledStartTime: startTime,
          scheduledEndTime: endTime,
        };

        if (voiceChannel && existingEvent.entityType === GuildScheduledEventEntityType.Voice) {
          editPayload.channel = voiceChannel.id;
        }

        const updated = await existingEvent.edit(editPayload);
        return updated;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[EventSync] Existing event ${session.discordEventId} not found or couldn't be edited:`, msg);
      // Fall through to create a new event
    }
  }

  // 2. Create a new event if none existed or previous was deleted
  try {
    if (voiceChannel) {
      const createPayload: GuildScheduledEventCreateOptions = {
        name: eventTitle,
        scheduledStartTime: startTime,
        scheduledEndTime: endTime,
        privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
        entityType: GuildScheduledEventEntityType.Voice,
        channel: voiceChannel.id,
        description,
      };
      return await guild.scheduledEvents.create(createPayload);
    } else {
      const createPayload: GuildScheduledEventCreateOptions = {
        name: eventTitle,
        scheduledStartTime: startTime,
        scheduledEndTime: endTime,
        privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
        entityType: GuildScheduledEventEntityType.External,
        entityMetadata: { location: 'Movie Voice Channel' },
        description,
      };
      return await guild.scheduledEvents.create(createPayload);
    }
  } catch (err: unknown) {
    console.error('[EventSync] Failed to create Discord Scheduled Event:', err);
    return null;
  }
}

/**
 * Deletes / cancels a Discord Scheduled Event by ID.
 */
export async function deleteDiscordEvent(guild: Guild, eventId: string): Promise<boolean> {
  if (!guild || !guild.scheduledEvents || !eventId) {
    return false;
  }

  try {
    const existing = await guild.scheduledEvents.fetch(eventId);
    if (existing) {
      await existing.delete();
      return true;
    }
  } catch (err: any) {
    console.warn(`[EventSync] Could not delete event ${eventId}:`, err.message);
  }

  return false;
}
