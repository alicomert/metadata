# Metadata Cleaner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a static GitHub Pages app that removes metadata from photos and videos locally in the browser.

**Architecture:** `index.html` provides the interface and inline styling. `app.js` exposes pure binary cleaners for JPEG, PNG, and WebP, plus browser UI and `ffmpeg.wasm` video processing loaded only when needed.

**Tech Stack:** Plain HTML, plain JavaScript ES modules, Node built-in test runner, `ffmpeg.wasm` via CDN.

---

### Task 1: Binary Cleaner Tests

**Files:**
- Create: `tests/metadata-cleaner.test.mjs`
- Create: `app.js`

- [ ] Write tests that build minimal JPEG, PNG, and WebP byte arrays with metadata containers.
- [ ] Run `node --test tests/metadata-cleaner.test.mjs` and confirm it fails because `app.js` has not implemented the exports.
- [ ] Implement `cleanImageBytes`, `cleanJpeg`, `cleanPng`, and `cleanWebp`.
- [ ] Run `node --test tests/metadata-cleaner.test.mjs` and confirm all parser tests pass.

### Task 2: Static UI

**Files:**
- Create: `index.html`
- Modify: `app.js`

- [ ] Build a single-page UI with drop zone, file picker, queue rows, status text, and download buttons.
- [ ] Wire file selection to `cleanImageBytes` for photos.
- [ ] Add unsupported-file rejection messages.

### Task 3: Video Processing

**Files:**
- Modify: `app.js`

- [ ] Add lazy dynamic imports for `@ffmpeg/ffmpeg` and `@ffmpeg/util`.
- [ ] Load FFmpeg core from jsDelivr using `toBlobURL`.
- [ ] Process videos with `-map 0`, `-map_metadata -1`, `-map_metadata:s -1`, `-map_chapters -1`, and `-c copy`.
- [ ] Clean up FFmpeg virtual filesystem inputs and outputs after each file.

### Task 4: Verification

**Files:**
- Verify: `tests/metadata-cleaner.test.mjs`
- Verify: `index.html`
- Verify: `app.js`

- [ ] Run `node --test tests/metadata-cleaner.test.mjs`.
- [ ] Run a local static server with `python3 -m http.server`.
- [ ] Fetch `index.html` and `app.js` from the server to verify static serving works.
- [ ] Stop the local server before final response.
