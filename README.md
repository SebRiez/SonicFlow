# SonicFlow – Sound Effect Database

SonicFlow is a high-performance sound effect database manager built with Tauri v2, Rust, and Vanilla Web technologies. Designed for professional post-production workflows, it enables lightning-fast searching, previewing, and organizing of large audio libraries — locally or across a network.

---

## Features

### 📚 Library Management
- **Multiple Libraries** — add and manage any number of local or network-mounted folders as independent libraries
- **Recursive Scan** — all subdirectories are indexed automatically
- **Re-Scan / Refresh** — re-index a library with one click when files are added or changed
- **Folder Tree Navigation** — hierarchical sidebar tree; click any subfolder to filter results to that path
- **File Statistics** — total indexed file count displayed per library

---

### 🔍 Search & Filters
- **Full-Text Search** — SQLite FTS5 across filename, title, artist, genre, comment, keywords, and description
- **Filter: File Format** — WAV, AIFF, MP3, FLAC, OGG, OPUS, M4A, CAF, BWF and more
- **Filter: Channel Configuration** — Mono / Stereo
- **Filter: Sample Rate** — 44.1 / 48 / 88.2 / 96 / 192 kHz
- **Filter: Bit Depth** — 16 / 24 / 32-bit
- **Filter: UCS Category** — all ~90 official CatIDs (Universal Category System v8.2.1)
- **Filter: Library** — scope results to a specific library
- **Clear All Filters** — one-click reset of all active filters
- **Live Search** — debounced, triggers 200ms after the last keystroke

---

### 📋 Results Table
- **Columns** — filename, mini-waveform, duration, format, sample rate, bit depth, channels, tags, UCS category, file size
- **Sortable** — click any column header to sort ascending or descending
- **Resizable Columns** — drag column dividers to resize; double-click for auto-fit to content
- **Reorderable Columns** — drag-to-reorder column positions
- **Mini Waveforms** — lazy-rendered waveform thumbnail in each row (Intersection Observer)
- **Tag Pills** — colour-coded pills for title, genre, artist, and comment
- **UCS Pill** — violet CatID badge; non-categorised files show a `+ UCS` button on hover
- **Playing Row Highlight** — the active track is visually marked in the table

---

### 🎵 Audio Player
- **Play / Pause** — keyboard shortcut: `Space`
- **Stop** — resets playback position to the beginning
- **Progress Bar** — click anywhere on the bar to seek
- **Time Display** — shows `current / total` in monospace
- **Volume Slider** — 0–100%
- **Gain Slider** — pre-amplification from 0 to +6 dB with dB readout
- **Reverse Playback** — keyboard shortcut: `R`; reverses audio data in memory and plays back in reverse; all player controls (play/pause, stop, seek, progress bar) remain fully functional
- **Audio Output Selection** — choose playback device (where supported by the OS)
- **Reveal in Finder / Explorer** — opens the containing folder in the system file browser
- **Resizable Player Bar** — drag the top edge to adjust the player area height

---

### 📊 Waveform View
- **Three Render Modes:**
  - **Classic** — symmetric amplitude waveform
  - **Histogram** — bar-chart waveform
  - **Symmetric X-Ray** — mirrored, translucent view
- **Zoom** — scroll wheel on the waveform canvas
- **Pan** — drag on the waveform canvas
- **Playhead** — white line tracks playback position in real time
- **Click to Seek** — click anywhere on the canvas to jump to that position
- **Reversed Waveform** — waveform display mirrors when Reverse Playback is active

---

### 🏷️ UCS Support (Universal Category System v8.2.1)

SonicFlow supports the industry-standard Universal Category System for professional sound library organisation.

- **Automatic Detection from Filename** — parses the `CatID_FXName_CreatorID_SourceID.wav` format
- **bext Chunk Parsing** — reads Broadcast Wave Format metadata (EBU TECH-3285); extracts `Originator` and `OriginatorReference`
- **iXML Chunk Parsing** — reads `UCS_CATEGORYID`, `UCS_FXNAME`, `UCS_CREATORID`, `UCS_SOURCEID` from embedded XML
- **Priority Order:** iXML > bext > Filename
- **Manual Tagging** — click the `+ UCS` button on any row to open a dropdown with all official CatIDs; the assignment is saved to the local database
- **Persistent Manual Tags** — manually assigned categories are never overwritten by a re-scan

---

### 🖱️ Drag & Drop to NLEs
- **Multi-Tab Workflow** — run multiple independent search sessions simultaneously
- **Shuffle Results** — randomize search results for inspiration
- **Freesound.org Integration** — cloud search (requires API key)
- **Full Tab State** — search query, all filters, sort order, and scroll position are saved per tab and restored on switch
- **New Tab** — add a tab via button

---

### 📂 Sammlungen (Collections)
- **Virtual Folders** — organize sounds into collections without moving them on disk
- **Add via Context Menu** — right-click any sound to add it to one or more collections
- **Persistent Storage** — collections are saved in the local database

---

### 📊 Waveform & Spectrogram
- **Spectrogram View** — switch to a frequency-over-time visualization
- **Three Waveform Render Modes:**
  - **Classic** — symmetric amplitude waveform
  - **Histogram** — bar-chart waveform
  - **Symmetric X-Ray** — mirrored, translucent view

---

### 🖥️ Dock Mode
- **Compact Player View** — shrink the UI to a minimal player bar for single-monitor setups
- **Always on Top** — keep SonicFlow visible while working in your DAW

---

### 🖱️ Drag & Drop & Context Menu
- **Native OS Drag** — drag any file directly from the results table into Avid Media Composer, DaVinci Resolve, Premiere Pro, Reaper, and other NLEs
- **Context Menu** — right-click for "Open in Default App", "Reveal in Finder", or "Add to Collection"

---

### 🌐 Network & Multi-Client Support

SonicFlow is designed for professional post-production environments where audio assets are stored centrally on a media server and accessed from multiple workstations.

- **Network Mount Compatible** — works with any server share mounted as a local volume (SMB, NFS, AFP)
- **Local Index, Remote Files** — the search index is stored locally on each client (SQLite); queries run entirely offline with no network load per search
- **Independent Client Workflows** — each workstation searches, filters, and assigns UCS tags independently without affecting other clients
- **Audio Preview over Network** — playback streams the file directly from the server via the mount path
- **Direct NLE Transfer** — Drag & Drop passes the original server path to the NLE; all clients reference the same source files
- **Re-Scan on Update** — when new files are added to the server, a one-click re-scan updates the index; existing UCS tags are preserved

---

### 🔧 Metadata Indexed on Scan

| Category | Fields |
|---|---|
| Audio Properties | Duration, Sample Rate, Bit Depth, Channels, Bitrate |
| File | Filename, Full Path, Relative Folder, File Size, Extension |
| Standard Tags | Title, Artist, Album, Genre, Comment, Track Number, BPM, Keywords, Description |
| UCS | Category ID, FX Name, Creator ID, Source ID, User Category |

---

## Installation Notes

### macOS
Since the app is currently self-signed, macOS Gatekeeper will show a warning on first launch.
- **Solution**: Right-click the SonicFlow icon → **Open** → click **Open** again in the dialog. This is only required once.

### Windows
Windows SmartScreen may show a warning. Click **"More info"** → **"Run anyway"**.

---

## Development

### Prerequisites

- [Rust](https://www.rust-lang.org/tools/install)
- [Node.js](https://nodejs.org/) (for Tauri CLI)
- [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (Windows only — usually pre-installed)

### Setup

```bash
npm install
```

### Run (Development)

```bash
npm run tauri dev
```

---

## Build & Release

The project uses GitHub Actions for automated releases.

### How to create a Release

1. Update the version in `src-tauri/tauri.conf.json`.
2. Push a version tag to GitHub:
   ```bash
   git tag -a v0.1.1 -m "Release v0.1.1"
   git push origin v0.1.1
   ```
3. GitHub Actions will automatically:
   - Build a **Universal macOS DMG** (Apple Silicon + Intel).
   - Build **Windows MSI and EXE** installers.
   - Create a draft release on GitHub.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Application Framework | Tauri 2 |
| Backend | Rust |
| Database | SQLite (FTS5) |
| Audio Metadata | lofty, manual RIFF/bext/iXML parser |
| Frontend | Vanilla HTML / CSS / JavaScript |
| Audio Playback | HTML Audio Element + Web Audio API |
| CI/CD | GitHub Actions |

---

## License

MIT
