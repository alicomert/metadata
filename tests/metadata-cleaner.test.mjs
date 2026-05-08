import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanImageBytes,
  cleanJpeg,
  cleanPng,
  cleanWebp,
  isSupportedImage,
  isSupportedVideo,
} from "../app.js";

const encoder = new TextEncoder();

function ascii(value) {
  return Array.from(encoder.encode(value));
}

function bytes(...parts) {
  return new Uint8Array(parts.flatMap((part) => Array.from(part)));
}

function jpegSegment(marker, payload) {
  const length = payload.length + 2;
  return [0xff, marker, (length >> 8) & 0xff, length & 0xff, ...payload];
}

function makeJpeg() {
  return bytes(
    [0xff, 0xd8],
    jpegSegment(0xe0, ascii("JFIF\0keep")),
    jpegSegment(0xe1, ascii("Exif\0\0private")),
    jpegSegment(0xe1, ascii("http://ns.adobe.com/xap/1.0/\0private")),
    jpegSegment(0xe2, ascii("ICC_PROFILE\0keep")),
    jpegSegment(0xed, ascii("Photoshop 3.0\0private")),
    [0xff, 0xfe, 0x00, 0x09, ...ascii("secret!")],
    [0xff, 0xda, 0x00, 0x08, 0x01, 0x02, 0x03, 0x00, 0x3f, 0x00, 0x11, 0x22, 0xff, 0xd9],
  );
}

function crcBytes() {
  return [0, 0, 0, 0];
}

function pngChunk(type, payload = []) {
  const length = payload.length;
  return [
    (length >>> 24) & 0xff,
    (length >>> 16) & 0xff,
    (length >>> 8) & 0xff,
    length & 0xff,
    ...ascii(type),
    ...payload,
    ...crcBytes(),
  ];
}

function makePng() {
  return bytes(
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    pngChunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]),
    pngChunk("tEXt", ascii("Comment\0secret")),
    pngChunk("iCCP", ascii("profile\0keep")),
    pngChunk("eXIf", ascii("private")),
    pngChunk("IDAT", [1, 2, 3]),
    pngChunk("IEND"),
  );
}

function riffChunk(type, payload = []) {
  const padding = payload.length % 2 === 1 ? [0] : [];
  return [
    ...ascii(type),
    payload.length & 0xff,
    (payload.length >>> 8) & 0xff,
    (payload.length >>> 16) & 0xff,
    (payload.length >>> 24) & 0xff,
    ...payload,
    ...padding,
  ];
}

function makeWebp() {
  const chunks = bytes(
    riffChunk("VP8X", [0x0c, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    riffChunk("ICCP", ascii("keep")),
    riffChunk("EXIF", ascii("private")),
    riffChunk("XMP ", ascii("private")),
    riffChunk("VP8 ", [1, 2, 3, 4]),
  );
  const size = chunks.length + 4;
  return bytes(
    ascii("RIFF"),
    [size & 0xff, (size >>> 8) & 0xff, (size >>> 16) & 0xff, (size >>> 24) & 0xff],
    ascii("WEBP"),
    chunks,
  );
}

test("JPEG cleaner removes EXIF, XMP, IPTC, and comments without removing scan data or ICC", () => {
  const cleaned = cleanJpeg(makeJpeg());
  const text = new TextDecoder().decode(cleaned);

  assert.equal(cleaned[0], 0xff);
  assert.equal(cleaned[1], 0xd8);
  assert.match(text, /JFIF/);
  assert.match(text, /ICC_PROFILE/);
  assert.match(text, /\u0011"/);
  assert.doesNotMatch(text, /Exif/);
  assert.doesNotMatch(text, /xap/);
  assert.doesNotMatch(text, /Photoshop/);
  assert.doesNotMatch(text, /secret!/);
});

test("PNG cleaner removes metadata chunks and keeps image and color chunks", () => {
  const cleaned = cleanPng(makePng());
  const text = new TextDecoder().decode(cleaned);

  assert.match(text, /IHDR/);
  assert.match(text, /iCCP/);
  assert.match(text, /IDAT/);
  assert.match(text, /IEND/);
  assert.doesNotMatch(text, /tEXt/);
  assert.doesNotMatch(text, /eXIf/);
  assert.doesNotMatch(text, /secret/);
});

test("WebP cleaner removes EXIF and XMP chunks and clears metadata flags", () => {
  const cleaned = cleanWebp(makeWebp());
  const text = new TextDecoder().decode(cleaned);

  assert.match(text, /RIFF/);
  assert.match(text, /WEBP/);
  assert.match(text, /VP8X/);
  assert.match(text, /ICCP/);
  assert.match(text, /VP8 /);
  assert.doesNotMatch(text, /EXIF/);
  assert.doesNotMatch(text, /XMP /);
  assert.equal(cleaned[20] & 0x0c, 0);
});

test("cleanImageBytes dispatches by MIME type and file extension", () => {
  assert.equal(cleanImageBytes(makeJpeg(), "image/jpeg", "photo.jpg").type, "image/jpeg");
  assert.equal(cleanImageBytes(makePng(), "", "photo.png").type, "image/png");
  assert.equal(cleanImageBytes(makeWebp(), "image/webp", "photo.webp").type, "image/webp");
});

test("supported type checks accept intended images and videos only", () => {
  assert.equal(isSupportedImage({ type: "image/jpeg", name: "a.JPG" }), true);
  assert.equal(isSupportedImage({ type: "application/pdf", name: "a.pdf" }), false);
  assert.equal(isSupportedVideo({ type: "video/mp4", name: "a.mp4" }), true);
  assert.equal(isSupportedVideo({ type: "", name: "clip.mov" }), true);
  assert.equal(isSupportedVideo({ type: "application/pdf", name: "a.pdf" }), false);
});
