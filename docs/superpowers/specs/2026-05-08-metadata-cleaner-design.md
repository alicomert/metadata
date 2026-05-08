# Metadata Cleaner Design

## Goal

Build a GitHub Pages-compatible metadata cleaner for photos and videos using only static HTML and JavaScript. Files must be processed locally in the browser and never uploaded to a server.

## Scope

Supported photo formats:

- JPEG and JPG
- PNG
- WebP

Supported video formats:

- MP4
- MOV
- M4V
- WebM
- MKV

PDF and office documents are out of scope.

## Architecture

The app is a static browser tool with `index.html` and `app.js`. `index.html` owns layout and styling. `app.js` owns file detection, metadata cleaning, download URL creation, and status updates.

Photo files are cleaned by parsing binary container structures and removing metadata containers while preserving image payload bytes. This avoids canvas-based re-encoding and prevents quality loss.

Video files are cleaned with `ffmpeg.wasm` loaded from a CDN at runtime. FFmpeg runs in the browser and remuxes the file with stream copy, so video and audio streams are not re-encoded.

## Photo Cleaning

JPEG cleaning removes EXIF/XMP APP1 segments, IPTC APP13 segments, and comment segments. It preserves JFIF, ICC color profiles, Adobe APP14, scan data, and the compressed image stream.

PNG cleaning removes metadata chunks such as `eXIf`, `tEXt`, `iTXt`, `zTXt`, and `tIME`. It preserves image chunks and color-management chunks such as `iCCP`, `sRGB`, `gAMA`, and `cHRM`.

WebP cleaning removes `EXIF` and `XMP ` chunks and clears their extended-header flags when a `VP8X` chunk is present. It preserves image, alpha, animation, and ICC chunks.

## Video Cleaning

Video cleaning uses FFmpeg with all streams mapped and copied:

```text
-i input -map 0 -map_metadata -1 -map_metadata:s -1 -map_chapters -1 -c copy output
```

This removes global metadata, stream metadata, and chapters without transcoding. Container bytes can change because the file is remuxed, but media quality is preserved.

## User Flow

The user selects files or drops them onto the page. Each file receives a queue row with its name, type, size, status, and output action. Image files are processed immediately. Video files trigger FFmpeg loading when first needed, then run one at a time to reduce memory pressure.

Cleaned outputs are downloaded individually. Original files remain untouched.

## Error Handling

Unsupported file types are rejected with a clear message. Corrupt or unparseable files fail per-file without stopping the rest of the queue. If FFmpeg cannot process a video with stream copy, the app reports that the container or codec may not support metadata-only remuxing in the browser.

## Testing

Automated Node tests cover the pure binary metadata cleaners for JPEG, PNG, and WebP. Browser behavior is verified with a static local server and page smoke test.
