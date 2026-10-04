import { describe, it, expect } from 'vitest';
import {
  parseCsvLine,
  parseCsvSubmissions,
  resolveUser,
  deduplicateSubmissionsByLatest,
  UserMappingConfig,
} from '../src/utils/migrationParser.js';

describe('Historical Migration Parser & Normalizer', () => {
  describe('parseCsvLine', () => {
    it('splits simple comma-separated fields', () => {
      const line = 'Timestamp,Email Address,First name,Score';
      expect(parseCsvLine(line)).toEqual(['Timestamp', 'Email Address', 'First name', 'Score']);
    });

    it('handles quoted fields with commas and trimmed spaces', () => {
      const line = '11/6/2025,"user@example.com","Smith, John",9.5';
      expect(parseCsvLine(line)).toEqual(['11/6/2025', 'user@example.com', 'Smith, John', '9.5']);
    });

    it('handles escaped quotes inside quoted fields', () => {
      const line = '10/5/2025,user@example.com,"""Super"" Name",8';
      expect(parseCsvLine(line)).toEqual(['10/5/2025', 'user@example.com', '"Super" Name', '8']);
    });
  });

  describe('parseCsvSubmissions', () => {
    it('parses standard column layout (Timestamp, Email, Name, Score)', () => {
      const csv = `Timestamp,Email Address,First name,Score
10/6/2025 15:32:38,mock1@example.com,Alice,10
10/6/2025 15:33:40,mock2@example.com,Bob,8.5`;

      const result = parseCsvSubmissions(csv);
      expect(result).toHaveLength(2);
      expect(result[0].email).toBe('mock1@example.com');
      expect(result[0].name).toBe('Alice');
      expect(result[0].score).toBe(10);
      expect(result[1].score).toBe(8.5);
      expect(result[0].timestamp).toBeInstanceOf(Date);
    });

    it('parses alternate column layout (Timestamp, Score, Email, Name)', () => {
      const csv = `Timestamp,Score,Email Address,First name
3/14/2025 22:11:06,8,mock1@example.com,Alice
3/14/2025 22:11:26,4,mock2@example.com,Bob`;

      const result = parseCsvSubmissions(csv);
      expect(result).toHaveLength(2);
      expect(result[0].email).toBe('mock1@example.com');
      expect(result[0].name).toBe('Alice');
      expect(result[0].score).toBe(8);
      expect(result[1].score).toBe(4);
    });

    it('skips invalid or non-numeric scores gracefully', () => {
      const csv = `Timestamp,Email Address,First name,Score
10/6/2025 15:32:38,mock1@example.com,Alice,invalid
10/6/2025 15:33:40,mock2@example.com,Bob,9`;

      const result = parseCsvSubmissions(csv);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Bob');
    });
  });

  describe('resolveUser', () => {
    const mockMapping: UserMappingConfig = {
      users: [
        {
          discordUserId: '100000000000000001',
          discordUsername: 'alice',
          emails: ['alice@example.com'],
          names: ['Alice', 'Ali'],
        },
        {
          discordUserId: '100000000000000002',
          discordUsername: 'bob',
          emails: ['bob@example.com'],
          names: ['Bob', 'bobby', 'b'],
        },
        {
          discordUserId: '100000000000000003',
          discordUsername: 'charlie_guest',
          emails: [],
          names: ['CharlieGuest'],
        },
      ],
    };

    it('matches user by exact email', () => {
      const resolved = resolveUser('alice@example.com', 'Random Name', mockMapping);
      expect(resolved).toEqual({
        userId: '100000000000000001',
        userName: 'alice',
      });
    });

    it('matches user by nickname alias when email is different or missing', () => {
      const resolved = resolveUser('', 'bobby', mockMapping);
      expect(resolved).toEqual({
        userId: '100000000000000002',
        userName: 'bob',
      });
    });

    it('prioritizes explicit guest name override even if shared email is used', () => {
      // Charlie used Alice's email in the form
      const resolved = resolveUser('alice@example.com', 'CharlieGuest', mockMapping);
      expect(resolved).toEqual({
        userId: '100000000000000003',
        userName: 'charlie_guest',
      });
    });

    it('returns null if no mapping exists or user ID is empty', () => {
      const emptyConfig: UserMappingConfig = {
        users: [
          {
            discordUserId: '',
            discordUsername: 'unmapped',
            emails: ['unmapped@example.com'],
            names: ['Unmapped'],
          },
        ],
      };
      expect(resolveUser('unmapped@example.com', 'Unmapped', emptyConfig)).toBeNull();
      expect(resolveUser('unknown@example.com', 'Unknown', mockMapping)).toBeNull();
    });
  });

  describe('deduplicateSubmissionsByLatest', () => {
    it('keeps only the latest score when a user submits multiple times', () => {
      const submissions = [
        {
          timestamp: new Date('2025-10-06T15:30:00Z'),
          timestampRaw: '10/6/2025 15:30:00',
          email: 'alice@example.com',
          name: 'Alice',
          score: 7,
          userId: '100000000000000001',
          userName: 'alice',
        },
        {
          timestamp: new Date('2025-10-06T15:35:00Z'),
          timestampRaw: '10/6/2025 15:35:00',
          email: 'alice@example.com',
          name: 'Alice',
          score: 9, // Updated score
          userId: '100000000000000001',
          userName: 'alice',
        },
        {
          timestamp: new Date('2025-10-06T15:32:00Z'),
          timestampRaw: '10/6/2025 15:32:00',
          email: 'bob@example.com',
          name: 'Bob',
          score: 8,
          userId: '100000000000000002',
          userName: 'bob',
        },
      ];

      const deduplicated = deduplicateSubmissionsByLatest(submissions);
      expect(deduplicated).toHaveLength(2);

      const alice = deduplicated.find(s => s.userId === '100000000000000001');
      expect(alice).toBeDefined();
      expect(alice?.score).toBe(9); // Latest score preserved
    });
  });
});
