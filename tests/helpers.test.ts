import { describe, it, expect } from 'vitest';
import { Guild, PermissionsBitField } from 'discord.js';
import { Movie } from '../src/db/schema.js';
import { isUserAdmin } from '../src/utils/auth.js';
import { formatWheelExport } from '../src/utils/wheelHelper.js';
import { formatRuntime, resolveMovieChannel, buildRevealEmbed } from '../src/utils/discordHelpers.js';

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
    expect(result.pickerWheelUrl).toContain(encodeURIComponent('The Matrix (1999)'));
  });

  it('sanitizes commas in movie titles so choices are not broken on Picker Wheel', () => {
    const list = [
      { title: 'Everything Everywhere All at Once, Special Edition', releaseYear: 2022 },
    ];

    const result = formatWheelExport(list);
    // PickerWheel choices param shouldn't have raw commas within a single choice
    const urlParams = new URL(result.pickerWheelUrl);
    const choices = urlParams.searchParams.get('choices');
    expect(choices).not.toBeNull();
    // The choice should have replaced the comma with a dash
    expect(choices).toBe('Everything Everywhere All at Once - Special Edition (2022)');
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

  it('resolves channel by name with or without hash, and by ID', () => {
    const mockGuild = {
      channels: {
        cache: [
          { id: '123456789', name: 'shows-n-movies', isTextBased: () => true },
          { id: '987654321', name: 'general', isTextBased: () => true },
        ],
      },
    } as unknown as Guild;

    expect(resolveMovieChannel(mockGuild, 'shows-n-movies')?.id).toBe('123456789');
    expect(resolveMovieChannel(mockGuild, '#shows-n-movies')?.id).toBe('123456789');
    expect(resolveMovieChannel(mockGuild, '#SHOWS-N-MOVIES')?.id).toBe('123456789');
    expect(resolveMovieChannel(mockGuild, '123456789')?.id).toBe('123456789');
    expect(resolveMovieChannel(mockGuild, 'non-existent')).toBeUndefined();
  });

  it('chunks reviews in buildRevealEmbed to ensure no field exceeds Discord 1024 char limit', () => {
    const mockMovie: Movie = {
      id: 1,
      title: 'Dune: Part Two',
      releaseYear: 2024,
      runtimeMinutes: 166,
      overview: 'Paul Atreides unites with Chani and the Fremen.',
      suggestedByUserId: 'user1',
      suggestedByUsername: 'User 1',
      tmdbId: 693134,
      posterPath: 'https://image.tmdb.org/t/p/w500/path.jpg',
      status: 'watched',
      createdAt: new Date().toISOString(),
      watchedAt: new Date().toISOString(),
      ratingMessageId: null,
      ratingChannelId: null,
    };

    // Create 10 long reviews (200 chars each = 2000+ chars total)
    const longReviews = Array.from({ length: 8 }, (_, i) => ({
      userId: `user_${i}`,
      userName: `User ${i}`,
      rating: 9.0,
      reviewText: 'An absolutely stunning cinematic experience with unmatched sound design, epic scale, and phenomenal acting throughout! '.repeat(2),
    }));

    const embed = buildRevealEmbed(mockMovie, 9.0, longReviews, []);
    const fields = embed.data.fields || [];

    // All fields must be strictly under 1024 characters
    for (const field of fields) {
      expect(field.value.length).toBeLessThanOrEqual(1024);
    }

    // Should have split reviews into multiple chunked fields
    const reviewFields = fields.filter(f => f.name.includes('Member Ratings & Reviews'));
    expect(reviewFields.length).toBeGreaterThan(1);
    expect(reviewFields[0].name).toContain('(1/');
  });
});

describe('Auth Helper', () => {
  it('correctly determines admin permissions via Discord permissions or roles', () => {
    // 1. User with Administrator permission
    const adminPermsInteraction = {
      memberPermissions: new PermissionsBitField(PermissionsBitField.Flags.Administrator),
    } as unknown as Parameters<typeof isUserAdmin>[0];
    expect(isUserAdmin(adminPermsInteraction)).toBe(true);

    // 2. User with ManageGuild permission
    const manageGuildInteraction = {
      memberPermissions: new PermissionsBitField(PermissionsBitField.Flags.ManageGuild),
    } as unknown as Parameters<typeof isUserAdmin>[0];
    expect(isUserAdmin(manageGuildInteraction)).toBe(true);

    // 3. User with no special permissions
    const regularInteraction = {
      memberPermissions: new PermissionsBitField(),
      member: { roles: [] },
    } as unknown as Parameters<typeof isUserAdmin>[0];
    expect(isUserAdmin(regularInteraction)).toBe(false);
  });
});

