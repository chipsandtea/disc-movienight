# 🎬 Discord Movie Night Bot

A tailored Discord bot designed for a friend group's weekly movie nights, built with **Node.js, TypeScript, discord.js, Drizzle ORM, and SQLite**, and fully integrated with the **TMDB (The Movie Database) API**. 

Engineered to run 24/7 on a **Raspberry Pi Zero 2 W** (consuming only ~40 MB RAM) alongside Pi-hole, with zero cloud hosting costs.

---

## 🌟 Key Features

1. **Weekly Availability Scheduling & Event Sync**:
   - `/schedule start [days] [time]`: Posts an interactive message with candidate days (defaults to Friday, Saturday, Sunday @ 8:00 PM). **Requires a movie to be locked in first** (`/movie set`).
   - Displays the planned movie's poster, overview, and runtime so friends know how long the movie runs.
   - **Reboot-Proof**: Buttons use stateless SQLite lookups (`sched:toggle:<sessionId>:<day>`), surviving bot restarts or Pi updates.
   - `/schedule finalize day: <day> [time]`: Declares the winning slot, locks poll buttons, and automatically creates a native **Discord Scheduled Event** on your server.
   - `/schedule modify day: <day> [time]`: Easily change the date or time anytime—even after finalization. Automatically updates the Discord Scheduled Event!
   - `/schedule cancel`: Cancels the schedule and automatically removes the Discord Scheduled Event from the server.
   - **Automatic Sync**: When `/movie set` is used to change or update the planned film, any linked Discord Scheduled Event and active availability poll are automatically updated with the new title, description, poster, and runtime.

2. **Movie Watchlist & Suggestions**:
   - `/movie suggest <movie> [user]`: Live autocomplete search powered by TMDB showing `Title (Year)`. Also supports pasting an IMDb URL or IMDb ID (`tt0111161`). Admins can pass `user: @member` to suggest on behalf of another user.
   - `/movie set-suggester <movie> <user>`: Admins can reassign who suggested any movie across backlog, planned, or watched status.
   - **Duplicate Detection**: Alerts you if a movie is already in the backlog or was previously watched (shows past watch date and score, with optional `--rewatch` override).
   - `/movie list [status] [user]`: Browse movies filtered by status (`backlog`, `watched`, `planned`, `all`) or filter by the friend who suggested them.
   - `/watchlist wheel-export`: Generates a clean list of titles and a **pre-populated direct link to [Picker Wheel](https://pickerwheel.com)**.

3. **Typo-Proof Movie Selection**:
   - `/movie set <movie>`: Uses Discord Autocomplete filtered to your backlog (e.g. `[#12] The Matrix (1999)`), passing the exact internal database ID without spelling mistakes.

4. **Voice Channel Attendance with 10-Second Pre-Check**:
   - `/movie finish`: Automatically scans who is in the movie voice channel and cross-references scheduling RSVPs.
   - Prompts the Admin with a **10-second confirmation window** with a user checklist to quickly uncheck anyone who just popped in to chat or add anyone who watched on screen-share.
   - Dispatches rating requests upon confirmation (or automatically after 10 seconds).

5. **Dual-Channel Private Rating Collection**:
   - Sends attendees a direct message with a `[⭐ Submit Your Rating & Review]` button.
   - **Solves the Discord DM Block**: Also posts an in-channel fallback in `#shows-n-movies`. Clicking the button opens an **Ephemeral Modal** visible *only* to that user.
   - **Forgiving Rating Parser**: Accepts `8`, `8.5`, `8,5`, `8/10`, and allows editing before finalization.
   - Ratings and reviews remain 100% secret until the grand reveal!

6. **The Grand Reveal & Hall of Fame**:
   - `/movie status`: Shows live submission progress (e.g., `4/5 submitted — Waiting on: @Eve`).
   - `/movie nudge`: Pings pending reviewers.
   - `/movie finalize-ratings`: Reveals the official results embed in `#shows-n-movies`:
     - **Group Average Score** (e.g. `⭐ 8.42 / 10`)
     - **Critic's Choice** (Highest score) & **The Tough Crowd** (Lowest score)
     - Individual member scores with their full written reviews in quotes.
   - `/movie leaderboard`: Ranks all watched films in the server Hall of Fame.
   - `/movie stats [user]`: Tracks attendance, personal average score, and the **group reception average for their recommendations**!

---

## 📋 Slash Command Reference

| Command | Subcommands / Options | Description |
| :--- | :--- | :--- |
| `/movie` | `suggest movie: <title/URL> [rewatch] [user]` | Suggest a movie with TMDB search (admins can attribute to another user) |
| | `set-suggester movie: <selection> user: <user>` | Reassign who suggested a movie across backlog/watched (Admin only) |
| | `list [status] [user]` | Browse movies filtered by status (`backlog`, `watched`, `planned`, `all`) or suggester |
| | `set movie: <selection>` | Lock in the planned movie for the upcoming movie night |
| | `current` | View details and runtime of this week's planned movie |
| | `random [count: 1-5]` | Draw random movie candidates from the backlog |
| | `finish` | Trigger 10-second attendance confirmation & send rating forms |
| | `status` | View live rating submission progress |
| | `nudge` | Ping members who haven't submitted their reviews |
| | `finalize-ratings` | Reveal the Grand Results card in `#shows-n-movies` |
| | `leaderboard` | View all watched movies ranked by group score |
| | `stats [user]` | View attendance, personal scores, and recommendation track record |
| `/watchlist` | `remove movie: <selection>` | Remove an entry (original suggester or admin) |
| | `wheel-export` | Export titles formatted for Picker Wheel |
| `/schedule` | `start [days] [time]` | Start weekly availability poll (requires planned movie) |
| | `finalize day: <day> [time]` | Finalize winning slot and create/update Discord Scheduled Event |
| | `modify day: <day> [time]` | Modify schedule date or time and update Discord Scheduled Event |
| | `cancel` | Cancel schedule and delete the Discord Scheduled Event |
| | `current` | View current schedule status and Discord event link |

---

## 🚀 Quick Setup & Configuration

### 1. Prerequisites
- **Node.js**: v20 or v22+
- **Discord Bot Token**: From the [Discord Developer Portal](https://discord.com/developers/applications)
- **TMDB API Key**: Free API key from [The Movie Database (TMDB)](https://www.themoviedb.org/settings/api)

### 2. Configure Discord Developer Portal
1. Create a **New Application** at [discord.com/developers/applications](https://discord.com/developers/applications).
2. Go to the **Bot** tab:
   - Click **Reset Token** and copy your token (`DISCORD_TOKEN`).
   - Under **Privileged Gateway Intents**, enable **Server Members Intent**.
3. Go to the **OAuth2 > URL Generator** tab:
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions:
     - `Send Messages`, `Embed Links`, `Attach Files`
     - `Manage Events` (for Discord Scheduled Events)
     - `View Channels`, `Connect` (for voice attendance detection)
   - Copy and open the generated invite link to add the bot to your Discord server.

### 3. Environment Variables
Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

```ini
DISCORD_TOKEN=your_bot_token_here
DISCORD_CLIENT_ID=your_discord_application_id_here
DISCORD_GUILD_ID=your_server_id_here

# Channel where announcements and polls should appear
MOVIE_CHANNEL_NAME=shows-n-movies

# TMDB API Key (v3)
TMDB_API_KEY=your_tmdb_api_key_here

# SQLite Database Location
DATABASE_URL=file:movienight.db
```

*(Note: Specifying `DISCORD_GUILD_ID` registers slash commands instantly for your server without the 1-hour global Discord cache delay).*

---

## 💻 Running the Bot

### Local Development
```bash
# Install dependencies
npm install

# Run in development mode (with hot-reloading)
npm run dev

# Run test suite
npm test

# Build TypeScript to dist/
npm run build

# Run compiled production build
npm start
```

---

## 🍓 24/7 Hosting on Raspberry Pi Zero 2 W

Because the bot uses **Drizzle ORM + SQLite with LibSQL**, it has no background database daemons and operates comfortably at **~35–50 MB RAM**, running smoothly alongside Pi-hole.

### MicroSD Durability
SQLite is automatically configured with Write-Ahead Logging (WAL) and synchronous normal mode:
```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
```
This minimizes flash write cycles and prevents file locking.

### Run as a `systemd` Service
To ensure the bot starts automatically on boot and auto-restarts on unexpected crashes:

1. Create a service file:
   ```bash
   sudo nano /etc/systemd/system/movienight.service
   ```
2. Paste the following configuration (adjusting paths for your user):
   ```ini
   [Unit]
   Description=Discord Movie Night Bot
   After=network.target

   [Service]
   Type=simple
   User=pi
   WorkingDirectory=/home/pi/disc-movienight
   ExecStart=/usr/bin/node dist/index.js
   Restart=on-failure
   RestartSec=10
   Environment=NODE_ENV=production

   [Install]
   WantedBy=multi-user.target
   ```
3. Enable and start the service:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable movienight
   sudo systemctl start movienight
   ```
4. View live logs:
   ```bash
   journalctl -u movienight -f
   ```

### Database Backups
All movie data, attendance, and ratings live in a single file: `movienight.db`. You can safely back it up while the bot is running:
```bash
sqlite3 movienight.db ".backup 'movienight-backup.db'"
```

---

## 🧪 Testing

The project includes unit and integration tests covering:
- Rating parser (handling half-points, commas, fractions, and invalid bounds)
- Picker Wheel URL encoding and title formatting
- Full movie lifecycle (backlog insertion, duplicate handling, attendance, ratings, user recommendation stats, and leaderboard rankings)

Run tests anytime with:
```bash
npm test
```
