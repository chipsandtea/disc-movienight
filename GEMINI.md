# Project Guardrails: Discord Movie Night Bot (`disc-movienight`)

## 1. Security & Secret Protection (Strict Invariant)
- **NEVER display, print, echo, or inspect values from `.env`**.
- Keep `.env`, `movienight.db*`, and `test.db*` strictly ignored in `.gitignore`.
- NEVER use force staging (`git add -f`) on any ignored files.
- Before proposing or executing git commits, ALWAYS verify `git status --ignored` to ensure `.env` and SQLite database files are not staged.
- In tests, fixtures, and documentation, always use fake placeholders (e.g. `mock_token_123`, `tt0000000`).

## 2. Resource-Conscious Command Execution
- Do NOT run heavy commands, large global npm installations, or CPU/memory-intensive tasks without prior user approval.
- Keep tests lightweight using `npm test` (Vitest with in-memory/temp SQLite).
- Verify compilation using `npm run build` (`tsc`).

## 3. Architecture & Code Quality Standards
- **Authorization**: All administrative subcommands and sensitive modal actions must verify caller permissions using `isUserAdmin(interaction)` from `src/utils/auth.ts`.
- **Database Durability**: All multi-step writes (attendance, scheduling) must run in `db.transaction()`. Concurrent updates (votes, ratings) must use atomic Drizzle `.onConflictDoUpdate()` or `.onConflictDoNothing()`.
- **Discord Interaction Response Time**: Any command performing external I/O (TMDB API, Discord Scheduled Event sync) must immediately call `await interaction.deferReply()`.
- **Embed Limits**: Fields must never exceed Discord's 1024-character limit; use the chunking helper in `src/utils/discordHelpers.ts`.
- **TypeScript Typing**: Maintain explicit interface annotations (`BotCommand`) on exported command collections to avoid `typescript-go` compiler panics on circular union inference.
