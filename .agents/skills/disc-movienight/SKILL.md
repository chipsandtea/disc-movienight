---
name: disc-movienight
description: >-
  Development runbook, security guidelines, and architectural best practices for the
  Discord Movie Night Bot (disc-movienight). Use when modifying bot commands, services,
  database schemas, tests, or deploying changes in this repository.
---

# Discord Movie Night Bot Development Guide

This skill provides step-by-step procedures and design patterns for building, testing, and maintaining `disc-movienight`.

## 1. Secrets & Safe Git Commits

Before creating any commit:
1. Check git status and ignored files:
   ```powershell
   git status --ignored
   ```
2. Verify that `.env` is NOT staged:
   ```powershell
   git diff --cached --name-only | Select-String -Pattern "\.env$"
   ```
   *(Must return empty)*
3. Ensure no actual API keys or bot tokens are present in the staged diff:
   ```powershell
   git diff --cached | Select-String -Pattern "DISCORD_TOKEN=[^$]|TMDB_API_KEY=[^$]"
   ```

## 2. Development & Verification Workflow

Always verify both the compiler and the test suite after making modifications:

1. **TypeScript Build**:
   ```powershell
   npm run build
   ```
   Ensure exit code is 0. If `tsc` panics or reports type errors, ensure command objects implement the explicit `BotCommand` interface in `src/commands/index.ts`.

2. **Unit Test Suite**:
   ```powershell
   npm test
   ```
   Tests use Vitest and run against isolated SQLite tables. Keep execution under 5 seconds.

## 3. Key Design Patterns & Guidelines

### Authorization
- Always import and check `isUserAdmin(interaction)` from `src/utils/auth.ts` for operations modifying schedules, setting planned movies, nudging users, or managing attendance.

### Database Operations (Drizzle ORM + LibSQL)
- **PRAGMAs**: `configurePragmas()` in `src/db/client.ts` enables `WAL` mode and `busy_timeout = 5000`.
- **Atomic Upserts**: Use `.onConflictDoUpdate()` on unique keys (`(session_id, user_id)` or `(movie_id, user_id)`) to handle concurrent button clicks safely.
- **Transactions**: Multi-table operations must use `await db.transaction(async (tx) => { ... })`.

### Discord.js Interactions
- **3-Second Timeout**: Discord interactions expire in 3000ms. Call `await interaction.deferReply()` immediately if calling TMDB or Discord Event API.
- **Embed Limits**: Discord fields hard-fail at 1024 characters. Chunk long text (e.g., reviews in `buildRevealEmbed`).
- **Simplicity**: Do not overcomplicate small array operations (e.g. random backlog picks use simple `sort(() => Math.random() - 0.5)`).
