# Destopian Pirate Codebase Structure

This document outlines the architecture, directories, and files of the Destopian Pirate project suite. It serves as a comprehensive reference to reduce context token usage by explicitly mapping the workspace.

## 📁 Root Workspace (`destopianpirate/complaint/`)
This is the master directory orchestrating the various sub-projects. The root folder itself tracks the AdBlocker project via git, while other folders maintain their own git repositories or are ignored.

- **`.git/`**: The primary git repository, tracking the AdBlocker extension and the Server project.
- **`.gitignore`**: Ignores the nested repositories (`destopian-home/`, `video-grabber/`), the codebase structure docs, and the `.pem` key.
- **`adblocker.pem`**: The private key file used for packaging the Chrome/Edge extension. Crucial for maintaining the same extension ID on the store. (Ignored from git).
- **`codebase_graph.md`**: An auto-generated visual graph of the codebase layout.
- **`CODEBASE_STRUCTURE.md`**: This file. A detailed textual map of the workspace.

---

## 📁 1. `adblocker/`
Contains the **SilentSurf AdBlocker Pro** browser extension. Built using Manifest V3 and the `declarativeNetRequest` API for high-performance, network-level tracking and ad blocking.

- **`manifest.json`**: The V3 extension manifest declaring permissions, background scripts, and declarative net request rules.
- **`background.js`**: The service worker handling extension lifecycle, dynamic rules, and network intercept events.
- **`rules.json`**: The static DNR (Declarative Net Request) ruleset containing the URLs and patterns to be blocked.
- **`popup.html` / `popup.js` / `popup.css`**: The user interface of the extension, featuring live statistics, toggle switches, and whitelisting functionality.
- **`extension.zip`**: The packaged build artifact ready for upload to the Chrome Web Store / Edge Add-ons.
- **`generate_icons.py`**: A utility script for generating the necessary icon sizes.
- **`icons/`** & **`store_assets/`**: Images, logos, and promotional assets for the extension store listing.

---

## 📁 2. `video-grabber/`
Contains the **Destopian Video Grabber** browser extension. Features a built-in media sniffer and real-time CSS-filter video enhancer.
*Note: This directory operates as its own separate Git repository (`.git/`).*

- **`manifest.json`**: The V3 extension manifest.
- **`background.js`**: Service worker that listens for active video streams or user actions and relays them to the server/frontend.
- **`content.js` / `content.css`**: Injected into webpages to manipulate the DOM, extract video sources, and apply real-time enhancement filters (brightness, contrast, etc.).
- **`popup.html` / `popup.js` / `popup.css`**: The extension's user interface, allowing users to select cinema presets, grab thumbnails, and trigger downloads.
- **`extension.zip`**: Packaged build artifact.
- **`icons/`**: Extension logos and UI assets.

---

## 📁 3. `destopian-server/`
The backend API server for the Video Grabber ecosystem. Acts as a proxy, extractor, and media format converter leveraging Node.js and Puppeteer.

- **`server.js`**: The core Express.js application. Handles REST API routes (`/api/json`, `/api/formats`, `/api/audio`, `/api/image`) and integrates `youtube-dl-exec` for extraction and `puppeteer` for headless scraping of cloud storage links.
- **`Dockerfile`**: Containerization instructions for deploying the Node.js server.
- **`package.json` / `package-lock.json`**: Node dependencies (Express, Puppeteer, Cors, Youtube-dl-exec, Ffmpeg-static).
- **`YOUTUBE_DOWNLOAD_GUIDE.md`**: Developer reference documentation for YouTube specific extraction logic.

---

## 📁 4. `destopian-home/`
Contains the entire web presence for the Destopian Pirate network. This serves as the centralized hub and static site.
*Note: This directory operates as its own separate Git repository (`.git/`).*

- **`docs/`**: The root directory for GitHub Pages hosting.
  - **`index.html` / `style.css` / `script.js`**: The main Destopian Pirate website. Includes the manifesto, the "Arsenal" of tools, and dynamic radar/matrix UI animations.
  - **`assets/`**: Images and fonts used by the main website.
  - **`grabber/`**: The frontend web application for the Video Grabber tool.
    - `index.html`, `app.js`, `style.css`: Allows users to paste links and interact with the backend API (`destopian-server`). `app.js` handles API requests to the configured `API_BASE` server URL.
  - **`adblock-legacy/`**: An archived/older version of the single-page site dedicated purely to the AdBlocker.
  - **`diskwala-reference/`**: Captured DOM structures and UI references used during the reverse-engineering of DiskWala's streaming player. Includes `diskwala_desktop.html` and various debug PNGs.
