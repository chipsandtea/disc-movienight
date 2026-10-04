import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import { db, configurePragmas } from '../db/client.js';
import { movies, attendance, ratings } from '../db/schema.js';
import { searchMovies, getMovieDetails } from '../services/tmdb.service.js';
import {
  parseCsvSubmissions,
  resolveUser,
  deduplicateSubmissionsByLatest,
  UserMappingConfig,
  ResolvedSubmission,
  ResolvedUser,
} from '../utils/migrationParser.js';

interface TabMetadata {
  tabName: string;
  csvFileName: string;
  expectedTitle: string;
  suggesterName: string;
  gid: string;
  scoresTabWatchDate: string | null;
  scoresTabExpectedAvg: number | null;
}

interface TabsConfig {
  spreadsheetId: string;
  scoresTabGid: string;
  tabs: TabMetadata[];
}

interface CachedMovie {
  tmdbId: string;
  title: string;
  releaseYear: number | null;
  runtimeMinutes: number | null;
  overview: string | null;
  posterPath: string | null;
}

type MovieCache = Record<string, CachedMovie>;

const USERS_FILE = path.resolve(process.cwd(), 'migration-users.json');
const MOVIES_FILE = path.resolve(process.cwd(), 'migration-movies.json');
const TABS_FILE = path.resolve(process.cwd(), 'data/historical/tabs.json');
const RAW_CSV_DIR = path.resolve(process.cwd(), 'data/historical/raw');

function loadJson<T>(filePath: string, fallback: T): T {
  if (fs.existsSync(filePath)) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
    } catch {
      console.warn(`[Warning] Could not parse ${filePath}, using fallback default.`);
    }
  }
  return fallback;
}

function saveJson(filePath: string, data: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

async function promptUserForDiscordId(
  rl: readline.Interface,
  name: string,
  email: string,
  mapping: UserMappingConfig
): Promise<ResolvedUser> {
  console.log(`\n❓ Unmapped participant found: Name="${name}", Email="${email}"`);
  const discordUserId = (await rl.question(`   Enter Discord User ID for ${name || email}: `)).trim();
  const discordUsername = (await rl.question(`   Enter Discord Username / Display Name for ${name || email}: `)).trim() || name || email;

  // Save to mapping
  let entry = mapping.users.find(u =>
    (email && u.emails.includes(email.toLowerCase())) ||
    (name && u.names.map(n => n.toLowerCase()).includes(name.toLowerCase()))
  );

  if (entry) {
    entry.discordUserId = discordUserId;
    entry.discordUsername = discordUsername;
  } else {
    entry = {
      discordUserId,
      discordUsername,
      emails: email ? [email.toLowerCase()] : [],
      names: name ? [name] : [],
    };
    mapping.users.push(entry);
  }

  saveJson(USERS_FILE, mapping);
  console.log(`   ✓ Saved mapping for ${discordUsername} (${discordUserId})`);

  return { userId: discordUserId, userName: discordUsername };
}

async function resolveTmdbForMovie(
  rl: readline.Interface | null,
  tab: TabMetadata,
  cache: MovieCache,
  isInteractive: boolean
): Promise<CachedMovie | null> {
  if (cache[tab.tabName] && cache[tab.tabName].tmdbId) {
    return cache[tab.tabName];
  }

  console.log(`\n🔍 Resolving TMDB entry for: "${tab.expectedTitle}"`);

  if (!config.tmdbApiKey) {
    console.warn(`[TMDB] No TMDB_API_KEY in .env. Falling back to default metadata.`);
    return {
      tmdbId: `mock_${tab.tabName.toLowerCase()}`,
      title: tab.expectedTitle,
      releaseYear: null,
      runtimeMinutes: null,
      overview: null,
      posterPath: null,
    };
  }

  let searchQuery = tab.expectedTitle;

  while (true) {
    const results = await searchMovies(searchQuery);
    if (!results || results.length === 0) {
      console.log(`   No TMDB results found for "${searchQuery}".`);
      if (!isInteractive || !rl) {
        return null;
      }
      const customQuery = (await rl.question('   Enter new search query or [s]kip: ')).trim();
      if (!customQuery || customQuery.toLowerCase() === 's') return null;
      searchQuery = customQuery;
      continue;
    }

    if (!isInteractive || !rl) {
      // Non-interactive: auto-pick first result
      const top = results[0];
      const details = await getMovieDetails(top.id);
      const cached: CachedMovie = {
        tmdbId: String(top.id),
        title: top.title,
        releaseYear: details?.releaseYear || (top.release_date ? parseInt(top.release_date.split('-')[0], 10) : null),
        runtimeMinutes: details?.runtimeMinutes || null,
        overview: top.overview || details?.overview || null,
        posterPath: top.poster_path || null,
      };
      cache[tab.tabName] = cached;
      saveJson(MOVIES_FILE, cache);
      return cached;
    }

    console.log(`   Found TMDB candidates:`);
    const slice = results.slice(0, 5);
    slice.forEach((r, idx) => {
      const year = r.release_date ? ` (${r.release_date.split('-')[0]})` : '';
      console.log(`   [${idx + 1}] ${r.title}${year} - TMDB ID: ${r.id}`);
    });
    console.log(`   [s] Custom search query`);
    console.log(`   [m] Enter TMDB ID directly`);
    console.log(`   [k] Skip this movie`);

    const answer = (await rl.question('   Select option [1]: ')).trim().toLowerCase() || '1';

    if (answer === 'k') {
      return null;
    } else if (answer === 's') {
      const custom = (await rl.question('   Search query: ')).trim();
      if (custom) searchQuery = custom;
      continue;
    } else if (answer === 'm') {
      const manualId = (await rl.question('   TMDB ID: ')).trim();
      const details = await getMovieDetails(manualId);
      if (details) {
        const cached: CachedMovie = {
          tmdbId: String(details.id),
          title: details.title,
          releaseYear: details.releaseYear,
          runtimeMinutes: details.runtimeMinutes,
          overview: details.overview,
          posterPath: details.posterUrl,
        };
        cache[tab.tabName] = cached;
        saveJson(MOVIES_FILE, cache);
        return cached;
      } else {
        console.log('   Could not retrieve movie details for that ID.');
        continue;
      }
    } else {
      const num = parseInt(answer, 10);
      if (!isNaN(num) && num >= 1 && num <= slice.length) {
        const selected = slice[num - 1];
        const details = await getMovieDetails(selected.id);
        const cached: CachedMovie = {
          tmdbId: String(selected.id),
          title: selected.title,
          releaseYear: details?.releaseYear || (selected.release_date ? parseInt(selected.release_date.split('-')[0], 10) : null),
          runtimeMinutes: details?.runtimeMinutes || null,
          overview: selected.overview || details?.overview || null,
          posterPath: selected.poster_path || null,
        };
        cache[tab.tabName] = cached;
        saveJson(MOVIES_FILE, cache);
        return cached;
      }
    }
  }
}

export async function runMigration(): Promise<void> {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const isNonInteractive = args.includes('--non-interactive');

  console.log(`\n======================================================`);
  console.log(`🍿 Discord Movie Night - Historical Data Migration`);
  console.log(`Mode: ${isDryRun ? 'DRY RUN (Preview Only - No DB writes)' : 'LIVE INGESTION (Writing to Database)'}`);
  console.log(`======================================================\n`);

  // Ensure SQLite pragmas (WAL mode, busy timeout, foreign keys) are enabled
  await configurePragmas();

  const tabsConfig = loadJson<TabsConfig>(TABS_FILE, { spreadsheetId: '', scoresTabGid: '', tabs: [] });
  if (tabsConfig.tabs.length === 0) {
    console.error(`[Error] No tabs defined in ${TABS_FILE}.`);
    process.exit(1);
  }

  const userMapping = loadJson<UserMappingConfig>(USERS_FILE, { users: [] });
  const movieCache = loadJson<MovieCache>(MOVIES_FILE, {});

  const rl = isNonInteractive ? null : readline.createInterface({ input, output });

  try {
    const summaryStats: {
      title: string;
      tmdbId: string;
      watchDate: string;
      suggester: string;
      attendanceCount: number;
      ratingsCount: number;
      computedAvg: number;
      expectedAvg: number | null;
      status: string;
    }[] = [];

    for (const tab of tabsConfig.tabs) {
      console.log(`\n------------------------------------------------------`);
      console.log(`🎬 Processing: "${tab.expectedTitle}" (Tab: ${tab.tabName})`);
      console.log(`------------------------------------------------------`);

      // 1. Resolve TMDB Details
      const tmdbMovie = await resolveTmdbForMovie(rl, tab, movieCache, !isNonInteractive);
      if (!tmdbMovie) {
        console.warn(`⚠️ Skipping "${tab.expectedTitle}": TMDB metadata not resolved.`);
        continue;
      }
      console.log(`   ✓ Matched: ${tmdbMovie.title} (${tmdbMovie.releaseYear ?? 'Unknown Year'}) [TMDB ID: ${tmdbMovie.tmdbId}]`);

      // 2. Read & Parse CSV
      const csvPath = path.join(RAW_CSV_DIR, tab.csvFileName);
      if (!fs.existsSync(csvPath)) {
        console.warn(`⚠️ CSV file not found: ${csvPath}`);
        continue;
      }

      const csvContent = fs.readFileSync(csvPath, 'utf-8');
      const rawSubmissions = parseCsvSubmissions(csvContent);
      console.log(`   Found ${rawSubmissions.length} raw form responses in ${tab.csvFileName}`);

      // 3. Resolve Users
      const resolvedSubmissions: ResolvedSubmission[] = [];
      for (const sub of rawSubmissions) {
        let user = resolveUser(sub.email, sub.name, userMapping);

        if (!user || !user.userId) {
          if (!isNonInteractive && rl) {
            user = await promptUserForDiscordId(rl, sub.name, sub.email, userMapping);
          } else {
            console.warn(`   ⚠️ Unresolved user in non-interactive mode: "${sub.name}" <${sub.email}>. Assigning placeholder.`);
            user = { userId: `mock_${(sub.name || sub.email).replace(/\s+/g, '_')}`, userName: sub.name || sub.email };
          }
        }

        resolvedSubmissions.push({
          ...sub,
          userId: user.userId,
          userName: user.userName,
        });
      }

      // 4. Deduplicate (latest score only per user)
      const deduplicated = deduplicateSubmissionsByLatest(resolvedSubmissions);
      if (deduplicated.length < rawSubmissions.length) {
        console.log(`   ✓ Deduplicated: ${rawSubmissions.length} submissions -> ${deduplicated.length} unique latest user scores`);
      }

      // 5. Resolve Watch Date
      // Use the latest submission timestamp as watchedAt; fallback to scoresTabWatchDate
      let watchDateIso = new Date().toISOString();
      const validTimestamps = deduplicated
        .map(s => s.timestamp)
        .filter((t): t is Date => t !== null && !isNaN(t.getTime()))
        .sort((a, b) => a.getTime() - b.getTime());

      if (validTimestamps.length > 0) {
        watchDateIso = validTimestamps[validTimestamps.length - 1].toISOString();
      } else if (tab.scoresTabWatchDate) {
        const parsed = new Date(tab.scoresTabWatchDate);
        if (!isNaN(parsed.getTime())) {
          watchDateIso = parsed.toISOString();
        }
      }

      // 6. Resolve Suggester
      let suggester: ResolvedUser | null = resolveUser('', tab.suggesterName, userMapping);
      if (!suggester || !suggester.userId) {
        if (!isNonInteractive && rl) {
          suggester = await promptUserForDiscordId(rl, tab.suggesterName, '', userMapping);
        } else {
          suggester = {
            userId: `mock_${tab.suggesterName.toLowerCase()}`,
            userName: tab.suggesterName,
          };
        }
      }
      console.log(`   Suggester: ${suggester.userName} (${suggester.userId})`);
      console.log(`   Watch Date: ${new Date(watchDateIso).toLocaleDateString()} (${watchDateIso})`);

      // 7. Calculate Average Score
      const totalScore = deduplicated.reduce((sum, s) => sum + s.score, 0);
      const avgScore = deduplicated.length > 0 ? Math.round((totalScore / deduplicated.length) * 100) / 100 : 0;
      console.log(`   Ratings: ${deduplicated.length} submitted. Avg score: ${avgScore} (Sheet expected: ${tab.scoresTabExpectedAvg ?? 'N/A'})`);

      // 8. Ingest into Database (unless dry run)
      if (!isDryRun) {
        await db.transaction(async tx => {
          // Check if movie already exists by tmdbId
          const existing = await tx
            .select()
            .from(movies)
            .where(eq(movies.tmdbId, tmdbMovie.tmdbId))
            .limit(1);

          let movieId: number;

          if (existing.length > 0) {
            movieId = existing[0].id;
            await tx
              .update(movies)
              .set({
                title: tmdbMovie.title,
                releaseYear: tmdbMovie.releaseYear,
                runtimeMinutes: tmdbMovie.runtimeMinutes,
                overview: tmdbMovie.overview,
                posterPath: tmdbMovie.posterPath,
                status: 'watched',
                watchedAt: watchDateIso,
                suggestedByUserId: suggester.userId,
                suggestedByUsername: suggester.userName,
              })
              .where(eq(movies.id, movieId));
          } else {
            const [inserted] = await tx
              .insert(movies)
              .values({
                tmdbId: tmdbMovie.tmdbId,
                title: tmdbMovie.title,
                releaseYear: tmdbMovie.releaseYear,
                runtimeMinutes: tmdbMovie.runtimeMinutes,
                overview: tmdbMovie.overview,
                posterPath: tmdbMovie.posterPath,
                status: 'watched',
                watchedAt: watchDateIso,
                suggestedByUserId: suggester.userId,
                suggestedByUsername: suggester.userName,
              })
              .returning();
            movieId = inserted.id;
          }

          // Ingest Attendance & Ratings
          for (const sub of deduplicated) {
            const submitTimeIso = sub.timestamp ? sub.timestamp.toISOString() : watchDateIso;

            // Attendance: unique on (movieId, userId)
            await tx
              .insert(attendance)
              .values({
                movieId,
                userId: sub.userId,
                userName: sub.userName,
                createdAt: watchDateIso,
              })
              .onConflictDoNothing();

            // Rating: unique on (movieId, userId)
            await tx
              .insert(ratings)
              .values({
                movieId,
                userId: sub.userId,
                userName: sub.userName,
                rating: sub.score,
                reviewText: null,
                submittedAt: submitTimeIso,
                updatedAt: submitTimeIso,
              })
              .onConflictDoUpdate({
                target: [ratings.movieId, ratings.userId],
                set: {
                  rating: sub.score,
                  userName: sub.userName,
                  submittedAt: submitTimeIso,
                  updatedAt: submitTimeIso,
                },
              });
          }
        });
        console.log(`   ✓ Ingested movie #${tmdbMovie.tmdbId} and ${deduplicated.length} ratings into SQLite.`);
      }

      summaryStats.push({
        title: tmdbMovie.title,
        tmdbId: tmdbMovie.tmdbId,
        watchDate: new Date(watchDateIso).toLocaleDateString(),
        suggester: suggester.userName,
        attendanceCount: deduplicated.length,
        ratingsCount: deduplicated.length,
        computedAvg: avgScore,
        expectedAvg: tab.scoresTabExpectedAvg,
        status: isDryRun ? 'Previewed' : 'Ingested',
      });
    }

    // Print summary table
    console.log(`\n======================================================`);
    console.log(`📊 MIGRATION SUMMARY (${isDryRun ? 'DRY RUN' : 'COMPLETED'})`);
    console.log(`======================================================`);
    console.table(summaryStats);

    if (isDryRun) {
      console.log(`\n💡 To execute this migration and persist to SQLite, run:`);
      console.log(`   npm run migrate:historical\n`);
    } else {
      console.log(`\n🎉 Success! All ${summaryStats.length} historical movie nights have been migrated to the database.`);
    }
  } finally {
    if (rl) {
      rl.close();
    }
  }
}

// Run directly if invoked via CLI
if (process.argv[1] && process.argv[1].endsWith('migrateHistorical.ts')) {
  runMigration().catch(err => {
    console.error('[Migration Error]:', err);
    process.exit(1);
  });
}
