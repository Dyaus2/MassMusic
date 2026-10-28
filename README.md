<p align="center">
  <img src="docs/banner.png" alt="MassMusic: your own Spotify-style music player" width="100%">
</p>

<p align="center">
  <img alt="Node.js 22.13+" src="https://img.shields.io/badge/node-%E2%89%A522.13-3c873a?logo=node.js&logoColor=white">
  <img alt="React 18" src="https://img.shields.io/badge/react-18-61dafb?logo=react&logoColor=black">
  <img alt="Vite 6" src="https://img.shields.io/badge/vite-6-646cff?logo=vite&logoColor=white">
  <img alt="SQLite" src="https://img.shields.io/badge/sqlite-built--in-003b57?logo=sqlite&logoColor=white">
  <img alt="Platform: Windows and Linux" src="https://img.shields.io/badge/platform-windows%20%7C%20linux-0078d4">
  <img alt="Electron 45" src="https://img.shields.io/badge/electron-45-47848f?logo=electron&logoColor=white">
  <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-2ee68a">
</p>

<p align="center">
  A personal Spotify-style music player that runs on your own PC.<br>
  It plays the music files you own, fills in the rest from YouTube, and imports your playlists straight from Spotify.
</p>

---

## Highlights

- **One library, two sources.** Your MP3, FLAC, M4A, OGG, OPUS and WAV files play straight from disk. Anything you don't own plays through YouTube's official embedded player.
- **Bring your Spotify playlists.** Paste a link, connect your account, or drop in a CSV. Songs you already have as files are matched automatically; the rest are found on YouTube the first time you play them.
- **Feels like the real thing.** Home with recently played and "on repeat", search, Liked Songs, playlists with drag-to-reorder, a queue, shuffle, repeat, a Now Playing panel with the video, and a mini player you can close.
- **Your daily 3, learned from you.** A small reinforcement-learning model (a contextual bandit) picks 3 new songs a day that you don't have yet. It learns only from your star ratings, never from skipped picks, and runs on the CPU in milliseconds.
- **A real desktop app.** Runs in its own window on Windows and Linux, with a Desktop shortcut and media-key support.
- **Yours only.** No account or cloud. Everything is stored in one local SQLite file, and the server only listens on your own machine.

## Screenshots

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/home.png" alt="Home screen with playlists and recently played songs"><p align="center"><sub><b>Home</b>: your playlists, recently played and on repeat</sub></p></td>
    <td width="50%"><img src="docs/screenshots/playlist.png" alt="Playlist view with the Now Playing panel"><p align="center"><sub><b>Playlists</b>: imported from Spotify, with the Now Playing panel</sub></p></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/import.png" alt="Import preview of a Spotify playlist"><p align="center"><sub><b>Import</b>: preview a Spotify playlist before adding it</sub></p></td>
    <td width="50%"><img src="docs/screenshots/search.png" alt="Search results from your library and YouTube"><p align="center"><sub><b>Search</b>: your library and YouTube in one place</sub></p></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/for-you.png" alt="For You page with the daily 3 picks and what the model has learned"><p align="center"><sub><b>For You</b>: your daily 3 and what the model has learned</sub></p></td>
    <td width="50%"><img src="docs/screenshots/liked-queue.png" alt="Liked Songs with the queue panel open"><p align="center"><sub><b>Liked Songs and the queue</b></sub></p></td>
  </tr>
</table>

## Getting started

MassMusic runs as a **desktop app** in its own window (built with [Electron](https://www.electronjs.org)), so no browser is needed.

### Build and install the desktop app

You need [Node.js](https://nodejs.org) 22.13 or newer.

```bash
git clone https://github.com/Dyaus2/MassMusic.git
cd MassMusic
npm install
```

| System | Command | Result |
| --- | --- | --- |
| **Windows** | `npm run dist:win` | `release/MassMusic-Setup-<version>.exe`. Run it to install MassMusic for your user (no admin rights needed) with a Desktop and Start-menu shortcut. |
| **Linux** | `npm run dist:linux` (run on Linux) | `release/MassMusic-<version>.AppImage` and a `.deb` package. |

To try it without packaging, run `npm run desktop`.

Then:

1. Open **Settings** and add the folders where you keep music. They are scanned automatically.
2. Open **Import playlists** and paste a Spotify playlist link.
3. Press play.

The desktop app keeps your library in your user data folder (`%APPDATA%\MassMusic\data` on Windows, `~/.config/MassMusic/data` on Linux), so it survives reinstalls.

### Run it in a browser instead

```bash
npm run app          # builds the UI and opens http://localhost:4545
```

On Windows you can also double-click **`MassMusic.bat`**. This mode keeps its library in the project's `data/` folder.

> [!IMPORTANT]
> In browser mode, always open `http://localhost:4545`, not `http://127.0.0.1:4545`. YouTube blocks most music in players embedded on pages served from a raw IP address. MassMusic redirects you automatically, and the desktop app always uses `localhost`.

## Importing from Spotify

| Method | Login | Best for |
| --- | --- | --- |
| **Paste a link** | None | Public playlists, albums and songs. Spotify only exposes the first 100 songs of a playlist this way. |
| **Connect your account** | One-time setup | Private and large playlists, and your Liked Songs. |
| **CSV or text list** | None | [Exportify](https://exportify.app) CSVs, or plain `Artist - Title` lines. Exports from Apple Music, YouTube Music or Deezer work too. |

<details>
<summary><b>Connecting your Spotify account (about 2 minutes)</b></summary>

1. Go to the [Spotify developer dashboard](https://developer.spotify.com/dashboard) and create an app. Any name works; tick **Web API**.
2. Add this Redirect URI: `http://127.0.0.1:4545/api/spotify/callback`
3. Copy the app's **Client ID** into MassMusic → **Import playlists** → **Spotify account**, then click **Connect Spotify**.

MassMusic uses the PKCE login flow, so no client secret is needed. It only asks to read your playlists and Liked Songs, and the login stays on your PC.

</details>

## How playback works

```mermaid
flowchart LR
    A[Song in a playlist] --> B{Matching file<br>on this PC?}
    B -- yes --> C[Play the file<br>from disk]
    B -- no --> D[Search YouTube<br>score by title, artist, length]
    D --> E[Play in the embedded<br>YouTube player]
    E -- owner blocks embedding --> F[Remember it and try<br>another upload]
    F --> E
```

Matches are saved, so each song is only looked up once. If a match is wrong, pick another version from the song's `…` menu.

## Your daily 3: how the recommendation model works

Every day MassMusic picks **3 songs you don't have yet**: two confident picks and one **wildcard** from outside your comfort zone. Rate them with 1–5 stars to teach the model, or ignore them. An ignored pick is treated as *missing data*, never as a dislike. **"I already know this"** removes a pick without counting it as a rating.

```mermaid
flowchart LR
    L[Your library<br>likes, playlists, plays] -- starting belief --> M
    L -- your artists --> C[Candidates<br>related artists' top songs<br>via Deezer]
    C --> F[Features<br>genre tags via MusicBrainz,<br>popularity, year, tempo,<br>closeness to your artists]
    F --> M[Bayesian linear bandit<br>Thompson sampling]
    M --> P[2 confident picks<br>+ 1 wildcard]
    P -- your star ratings only --> M
```

**Why a bandit, not deep RL.** Picking songs is a *contextual bandit* problem, the simplest form of reinforcement learning: today's pick doesn't change tomorrow's world, it only teaches the model. At 3 songs a day you'll rate at most ~1,000 songs a year, far too little for a neural network, but plenty for a Bayesian linear model that tracks how *uncertain* it is about your taste.

| Part | What it does |
| --- | --- |
| **Features** (64 numbers per song) | Genre tags and decade, feature-hashed into 56 slots, plus closeness to your artists, track and artist popularity, release year, length, tempo and explicit lyrics. |
| **Prior** | Built from your library: your artists' genres start as "probably good". This fixes the cold start without treating anything as a rating. |
| **Learning** | Each rating (1★ = −1 … 5★ = +1) is one observation in a Bayesian linear regression. The posterior is recomputed from the ratings log each day, so the model has no stored weights to corrupt. |
| **Exploration** | Thompson sampling draws a plausible "you" from the posterior each day. The wildcard draws with 2.5× wider uncertainty, among songs far from your usual artists. |
| **Following you over time** | Ratings fade by 0.5% a day (half-life ≈ 4.5 months), so the model follows your taste as it changes. |
| **Fair evaluation later** | Each pick stores the probability the model had of choosing it, so a future model version can be evaluated offline on your past ratings (inverse propensity scoring). |
| **Cost** | About 33 KB of state, CPU only, milliseconds per update. The first day's picks take about a minute and a half to gather; after that most data comes from a local cache. |

The **For You** page shows what it has learned: genres it thinks you lean towards and away from, hit rate of confident picks vs wildcards, and your average rating per week.

`npm test` runs the model tests, including a simulated listener with a hidden taste who ignores 40% of the picks: over two months the picks go from barely better than random to clearly matching that taste.

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| <kbd>Space</kbd> | Play / pause |
| <kbd>Ctrl</kbd> + <kbd>→</kbd> / <kbd>←</kbd> | Next / previous song |
| <kbd>Shift</kbd> + <kbd>→</kbd> / <kbd>←</kbd> | Seek 5 seconds |
| <kbd>Ctrl</kbd> + <kbd>↑</kbd> / <kbd>↓</kbd> | Volume |
| <kbd>Ctrl</kbd> + <kbd>K</kbd> | Search |
| <kbd>M</kbd> · <kbd>S</kbd> · <kbd>R</kbd> | Mute · shuffle · repeat |
| <kbd>F11</kbd> | Full screen (desktop app) |

Your keyboard's media keys work too.

## Project layout

```text
electron/     Desktop app wrapper (window, starts the server)
server/       Express API: library scanner, SQLite, YouTube search, Spotify import
server/recs/  Daily recommendations: features, bandit model, data sources, engine
tests/        Model tests and the simulated-listener test
client/src/   React app: pages, components, and the player engine (lib/player.js)
docs/         README images
data/         Browser mode only: database and cover art (git-ignored)
```

| Command | What it does |
| --- | --- |
| `npm run desktop` | Build the UI and open the desktop app |
| `npm run dist:win` / `dist:linux` | Package the desktop app (installer / AppImage + deb) |
| `npm run app` | Build the UI and open MassMusic in your browser |
| `npm start` | Start the server (serves the last build) |
| `npm run dev` | Hot-reload development on <http://localhost:5173> |
| `npm test` | Run the recommendation model tests |

## Notes and limits

- YouTube search and Spotify link import read the sites' public pages, so a big redesign on their side may need an update here.
- Some official music videos only play on youtube.com. MassMusic remembers those and switches to another upload, usually a lyric video.
- Your music files are only ever read, never changed. Delete the `data/` folder to start fresh.

## Disclaimer

MassMusic is a personal hobby project. It is not affiliated with, endorsed by, or connected to Spotify, YouTube, Deezer or MusicBrainz. YouTube content plays through YouTube's official embedded player, Spotify data is read only for playlists you choose to import, and recommendation data comes from the public Deezer and MusicBrainz APIs (with a once-a-day, cached, rate-limited batch).

## License

[MIT](LICENSE) © Dyaus2
