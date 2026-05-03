# SonicFlow – Sound Effect Database

SonicFlow is a high-performance sound effect database manager built with Tauri v2, Rust, and Vanilla Web technologies. It allows for lightning-fast searching, previewing, and organizing of large audio libraries.

## Features

- **Multi-Platform**: Native support for macOS (Universal) and Windows.
- **Fast Indexing**: Scans thousands of files in seconds.
- **Waveform Preview**: High-quality waveform visualization.
- **Drag & Drop**: Direct drag-to-NLE support for professional workflows.
- **Cross-Platform Reveal**: "Open in Finder/Explorer" functionality.

## Development

### Prerequisites

- [Rust](https://www.rust-lang.org/tools/install)
- [Node.js](https://nodejs.org/) (for Tauri CLI)
- [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (Windows only, usually pre-installed)

### Setup

```bash
npm install
```

### Run (Development)

```bash
npm run tauri dev
```

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

## License

MIT
