# 🎬 Discord Movie Night Bot — Command & User Guide

Welcome to the Movie Night Bot user guide! This reference covers all available commands, options, permissions, and best practices for server members and movie night organizers.

---

## 🛡️ Permission Roles

- **`[Everyone]`**: Any server member can use this command in allowed channels.
- **`[Admin Only]`**: Requires Discord **Administrator**, **Manage Server** permissions, or the configured **Admin Role**.
- **`[Owner / Admin]`**: Allowed for the original suggester of that specific movie or any admin.

---

## 🍿 1. Movie Watchlist & Suggestions

### `/movie suggest`
Suggest a new movie to the backlog.
- **Permissions**: `[Everyone]` *(Note: the `user` option is `[Admin Only]`)*
- **Options**:
  - `movie` *(Required)*: Start typing to search TMDB titles, or paste a full IMDb URL (e.g. `https://www.imdb.com/title/tt15239678/`) or IMDb ID (`tt15239678`).
  - `rewatch` *(Optional, default: False)*: Set to `True` if you want to suggest a film the group has already watched previously.
  - `user` *(Optional, `[Admin Only]`)*: Attribute the suggestion to another server member instead of yourself.
- **Example**:
  ```
  /movie suggest movie: Dune: Part Two
  /movie suggest movie: tt15239678 rewatch: True
  ```

### `/watchlist remove`
Remove a movie from the backlog.
- **Permissions**: `[Owner / Admin]` *(Can only be removed by the member who suggested it or an admin)*
- **Options**:
  - `movie` *(Required)*: Select the movie to remove via the autocomplete list.
- **Example**:
  ```
  /watchlist remove movie: [#4] The Matrix (1999)
  ```

### `/movie list`
Browse movies in the database with optional filters.
- **Permissions**: `[Everyone]`
- **Options**:
  - `status` *(Optional)*: Filter by `Backlog (To be watched)`, `Watched (Past history)`, `Planned (Next up)`, or `All Movies`. Defaults to `Backlog`.
  - `user` *(Optional)*: Filter to see movies suggested by a specific member.
- **Example**:
  ```
  /movie list status: Backlog
  /movie list status: Watched user: @Alex
  ```

### `/watchlist wheel-export`
Export the entire backlog formatted for [Picker Wheel](https://pickerwheel.com) or plain text copy-pasting.
- **Permissions**: `[Everyone]`
- **Output**: Generates a one-click clickable Picker Wheel link with all backlog movies pre-loaded, plus a copyable plain-text list.

### `/movie random`
Draw random movie candidates from the backlog for inspiration or manual voting.
- **Permissions**: `[Everyone]`
- **Options**:
  - `count` *(Optional, 1–5, default: 3)*: Number of random movies to select.
- **Example**:
  ```
  /movie random count: 3
  ```

---

## 📅 2. Scheduling & Availability

### `/schedule current`
View the active scheduling poll or the confirmed movie night time slot.
- **Permissions**: `[Everyone]`
- **Interactive**: Displays the live poll embed where members can click buttons (`[Friday]`, `[Saturday]`, etc.) to toggle their availability.

### `/schedule start`
Start a new scheduling poll for the upcoming movie night. *(Requires a movie to be planned first with `/movie set`)*.
- **Permissions**: `[Admin Only]`
- **Options**:
  - `days` *(Optional, default: "Friday, Saturday, Sunday")*: Comma-separated list of candidate days to poll.
  - `time` *(Optional, default: "8:00 PM")*: Proposed starting time.
- **Example**:
  ```
  /schedule start days: Friday, Saturday, Sunday time: 8:00 PM
  ```

### `/schedule finalize`
Declare the winning day/time, close voting, and automatically create a native **Discord Scheduled Event**.
- **Permissions**: `[Admin Only]`
- **Options**:
  - `day` *(Required)*: The winning day (e.g. `Friday`, `Saturday`, `Tomorrow`, `Oct 16`).
  - `time` *(Optional, default: "8:00 PM")*: Confirmed start time (e.g. `8:30 PM`, `20:00`).
- **Example**:
  ```
  /schedule finalize day: Saturday time: 8:30 PM
  ```

### `/schedule modify`
Change the day or time of an active or already-finalized movie night. Automatically updates the linked Discord Scheduled Event.
- **Permissions**: `[Admin Only]`
- **Options**:
  - `day` *(Required)*: The new day or date.
  - `time` *(Optional)*: The new starting time.
- **Example**:
  ```
  /schedule modify day: Sunday time: 7:00 PM
  ```

### `/schedule cancel`
Cancel the current scheduling session and remove the linked Discord Scheduled Event.
- **Permissions**: `[Admin Only]`

---

## 🎬 3. Movie Night Event & Planning

### `/movie current`
View details, poster, runtime, and overview of the movie currently planned for movie night.
- **Permissions**: `[Everyone]`

### `/movie set`
Set the planned movie for the upcoming movie night. If a schedule already exists, this automatically updates the Discord Scheduled Event title and description.
- **Permissions**: `[Admin Only]`
- **Options**:
  - `movie` *(Required)*: Select a film from the backlog via autocomplete, or paste an IMDb ID/URL.
- **Example**:
  ```
  /movie set movie: [#12] Spirited Away (2001)
  ```

### `/movie set-suggester`
Reassign who suggested a movie in the backlog or watch history.
- **Permissions**: `[Admin Only]`
- **Options**:
  - `movie` *(Required)*: Select the movie to reassign via autocomplete.
  - `user` *(Required)*: The server member to attribute the suggestion to.
- **Example**:
  ```
  /movie set-suggester movie: [#12] Spirited Away (2001) user: @Sam
  ```

### `/movie delete`
Permanently delete a movie entry from the database (backlog, planned, or watched). Cascades cleanup across ratings, attendance records, and active scheduling sessions.
- **Permissions**: `[Admin Only]`
- **Options**:
  - `movie` *(Required)*: Select the movie to delete via autocomplete (displays `[#ID] Title (Year) [STATUS]`) or by typing the exact title.
- **Example**:
  ```
  /movie delete movie: [#12] Test Sci-Fi Feature (2025) [WATCHED]
  ```

---

## 🏆 4. Attendance, Rating & Finalization

### `/movie finish`
Marks the movie as finished, automatically scans the voice channel to record attendance, and posts the **Live Rating Status Card**.
- **Permissions**: `[Admin Only]`
- **Interactive Features**:
  - **⭐ Rate & Review Button**: Clickable by any attendee to submit a rating (0.0 to 10.0) and optional review.
  - **👥 Manage Attendance Button**: `[Admin Only]` — Add or remove attendees using a user selector menu.

### `/movie status`
Check current rating submission progress for the active movie (who has submitted, who is pending).
- **Permissions**: `[Everyone]`

### `/movie nudge`
Send a friendly reminder mention in the movie channel to attendees who haven't submitted their rating yet.
- **Permissions**: `[Admin Only]`

### `/movie finalize-ratings`
Closes rating submissions, computes group average score, and posts the **Grand Reveal Card** with reviews to `#shows-n-movies`.
- **Permissions**: `[Admin Only]`

---

## 📊 5. Stats & Leaderboards

### `/movie leaderboard`
View the ranked leaderboard of all watched movies sorted by group average rating.
- **Permissions**: `[Everyone]`

### `/movie stats`
View movie night stats for yourself or another member.
- **Permissions**: `[Everyone]`
- **Options**:
  - `user` *(Optional)*: Member to inspect (defaults to yourself).
- **Stats Shown**:
  - Total movie nights attended.
  - Total ratings submitted.
  - Personal average score given, highest rated, and lowest rated films.
  - Recommendation record: movies suggested, how many were watched, and your **Group Score Average**!
- **Example**:
  ```
  /movie stats
  /movie stats user: @Jordan
  ```

---

## 💡 Quick Tips & Formatting

- **Rating Formats**: When submitting ratings in the rating modal or via chat, you can type whole numbers, decimals, or fractions:
  - `8`, `8.5`, `9.2`, `8,5`, `8/10`, `8.5 / 10`.
- **Time Parsing**: You can write natural times like `8pm`, `8:30 PM`, `20:00`, or `7:30` (times between 1:00 and 11:00 default to evening for movie nights).
- **IMDb Links**: Any time you are prompted for a movie, you can paste full IMDb URLs like `https://www.imdb.com/title/tt0133093/` or IDs like `tt0133093` to instantly match the exact title.
