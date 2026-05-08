const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "m4v", "webm", "mkv"]);
const JPEG_MIME = "image/jpeg";
const PNG_MIME = "image/png";
const WEBP_MIME = "image/webp";
const FFMPEG_CORE_URL = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd";
const FFMPEG_PACKAGE_URL = "https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.15/dist/esm/index.js";
const FFMPEG_UTIL_URL = "https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.2/dist/esm/index.js";

let ffmpegInstance = null;
let ffmpegLoadPromise = null;

export function isSupportedImage(file) {
  const extension = getExtension(file.name);
  return IMAGE_EXTENSIONS.has(extension) || imageMimeToType(file.type) !== null;
}

export function isSupportedVideo(file) {
  const extension = getExtension(file.name);
  return VIDEO_EXTENSIONS.has(extension) || (file.type || "").toLowerCase().startsWith("video/");
}

export function cleanImageBytes(input, mimeType = "", fileName = "") {
  const bytes = toUint8Array(input);
  const type = detectImageType(bytes, mimeType, fileName);

  if (type === JPEG_MIME) {
    return { bytes: cleanJpeg(bytes), type: JPEG_MIME, extension: "jpg" };
  }

  if (type === PNG_MIME) {
    return { bytes: cleanPng(bytes), type: PNG_MIME, extension: "png" };
  }

  if (type === WEBP_MIME) {
    return { bytes: cleanWebp(bytes), type: WEBP_MIME, extension: "webp" };
  }

  throw new Error("Desteklenmeyen fotoğraf formatı.");
}

export function createSyntheticTestMetadata(date = new Date()) {
  return {
    make: "Synthetic Test Fixture",
    model: "Mustafa",
    software: "Android 15",
    dateTimeOriginal: formatExifDate(date),
    userComment: "SYNTHETIC TEST METADATA - NOT ORIGINAL CAMERA CAPTURE",
  };
}

export function addSyntheticTestImageMetadata(input, mimeType = "", fileName = "", date = new Date()) {
  const cleaned = cleanImageBytes(input, mimeType, fileName);
  const metadata = createSyntheticTestMetadata(date);

  if (cleaned.type === JPEG_MIME) {
    return {
      ...cleaned,
      bytes: addJpegSyntheticMetadata(cleaned.bytes, metadata),
    };
  }

  if (cleaned.type === PNG_MIME) {
    return {
      ...cleaned,
      bytes: addPngSyntheticMetadata(cleaned.bytes, metadata),
    };
  }

  if (cleaned.type === WEBP_MIME) {
    return {
      ...cleaned,
      bytes: addWebpSyntheticMetadata(cleaned.bytes, metadata),
    };
  }

  throw new Error("Test metadata bu fotoğraf formatına eklenemedi.");
}

export function sanitizeZipFileName(fileName) {
  const parts = String(fileName || "")
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.replace(/[\x00-\x1f\x7f]/g, "").trim())
    .filter((part) => part && part !== "." && part !== "..");

  return parts.join("/") || "dosya";
}

export function createStoredZip(entries) {
  const encoder = new TextEncoder();
  const localChunks = [];
  const centralChunks = [];
  const usedNames = new Set();
  let offset = 0;

  for (const entry of entries) {
    const data = normalizeZipBytes(entry.bytes);
    const name = uniqueZipName(sanitizeZipFileName(entry.name), usedNames);
    const nameBytes = encoder.encode(name);
    const crc = crc32(data);
    const localHeader = new Uint8Array(30 + nameBytes.length);

    writeUint32LE(localHeader, 0, 0x04034b50);
    writeUint16LE(localHeader, 4, 20);
    writeUint16LE(localHeader, 6, 0x0800);
    writeUint16LE(localHeader, 8, 0);
    writeUint16LE(localHeader, 10, 0);
    writeUint16LE(localHeader, 12, 0);
    writeUint32LE(localHeader, 14, crc);
    writeUint32LE(localHeader, 18, data.length);
    writeUint32LE(localHeader, 22, data.length);
    writeUint16LE(localHeader, 26, nameBytes.length);
    writeUint16LE(localHeader, 28, 0);
    localHeader.set(nameBytes, 30);
    localChunks.push(localHeader, data);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    writeUint32LE(centralHeader, 0, 0x02014b50);
    writeUint16LE(centralHeader, 4, 20);
    writeUint16LE(centralHeader, 6, 20);
    writeUint16LE(centralHeader, 8, 0x0800);
    writeUint16LE(centralHeader, 10, 0);
    writeUint16LE(centralHeader, 12, 0);
    writeUint16LE(centralHeader, 14, 0);
    writeUint32LE(centralHeader, 16, crc);
    writeUint32LE(centralHeader, 20, data.length);
    writeUint32LE(centralHeader, 24, data.length);
    writeUint16LE(centralHeader, 28, nameBytes.length);
    writeUint16LE(centralHeader, 30, 0);
    writeUint16LE(centralHeader, 32, 0);
    writeUint16LE(centralHeader, 34, 0);
    writeUint16LE(centralHeader, 36, 0);
    writeUint32LE(centralHeader, 38, 0);
    writeUint32LE(centralHeader, 42, offset);
    centralHeader.set(nameBytes, 46);
    centralChunks.push(centralHeader);

    offset += localHeader.length + data.length;
  }

  const centralOffset = offset;
  const centralSize = centralChunks.reduce((total, chunk) => total + chunk.length, 0);
  const endRecord = new Uint8Array(22);
  writeUint32LE(endRecord, 0, 0x06054b50);
  writeUint16LE(endRecord, 4, 0);
  writeUint16LE(endRecord, 6, 0);
  writeUint16LE(endRecord, 8, entries.length);
  writeUint16LE(endRecord, 10, entries.length);
  writeUint32LE(endRecord, 12, centralSize);
  writeUint32LE(endRecord, 16, centralOffset);
  writeUint16LE(endRecord, 20, 0);

  return concatUint8([...localChunks, ...centralChunks, endRecord]);
}

export function cleanJpeg(input) {
  const bytes = toUint8Array(input);

  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error("Geçerli bir JPEG dosyası değil.");
  }

  const chunks = [bytes.slice(0, 2)];
  let offset = 2;

  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) {
      throw new Error("JPEG segment yapısı okunamadı.");
    }

    const markerStart = offset;

    while (offset < bytes.length && bytes[offset] === 0xff) {
      offset += 1;
    }

    if (offset >= bytes.length) {
      break;
    }

    const marker = bytes[offset];
    offset += 1;

    if (marker === 0x00) {
      throw new Error("JPEG metadata segmentleri okunamadı.");
    }

    if (marker === 0xda) {
      chunks.push(bytes.slice(markerStart));
      break;
    }

    if (marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      chunks.push(bytes.slice(markerStart, offset));
      continue;
    }

    if (offset + 2 > bytes.length) {
      throw new Error("JPEG segment uzunluğu eksik.");
    }

    const length = readUint16BE(bytes, offset);
    if (length < 2) {
      throw new Error("JPEG segment uzunluğu hatalı.");
    }

    const segmentEnd = offset + length;
    if (segmentEnd > bytes.length) {
      throw new Error("JPEG segmenti dosya sınırını aşıyor.");
    }

    if (!shouldRemoveJpegSegment(marker)) {
      chunks.push(bytes.slice(markerStart, segmentEnd));
    }

    offset = segmentEnd;
  }

  return concatUint8(chunks);
}

export function cleanPng(input) {
  const bytes = toUint8Array(input);
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

  if (bytes.length < signature.length || !signature.every((value, index) => bytes[index] === value)) {
    throw new Error("Geçerli bir PNG dosyası değil.");
  }

  const chunks = [bytes.slice(0, signature.length)];
  const removeTypes = new Set(["eXIf", "tEXt", "iTXt", "zTXt", "tIME"]);
  let offset = signature.length;

  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) {
      throw new Error("PNG chunk yapısı okunamadı.");
    }

    const length = readUint32BE(bytes, offset);
    const type = readAscii(bytes, offset + 4, 4);
    const chunkEnd = offset + 12 + length;

    if (chunkEnd > bytes.length) {
      throw new Error("PNG chunk dosya sınırını aşıyor.");
    }

    if (!removeTypes.has(type)) {
      chunks.push(bytes.slice(offset, chunkEnd));
    }

    offset = chunkEnd;

    if (type === "IEND") {
      break;
    }
  }

  return concatUint8(chunks);
}

export function cleanWebp(input) {
  const bytes = toUint8Array(input);

  if (bytes.length < 12 || readAscii(bytes, 0, 4) !== "RIFF" || readAscii(bytes, 8, 4) !== "WEBP") {
    throw new Error("Geçerli bir WebP dosyası değil.");
  }

  const chunks = [];
  let offset = 12;

  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) {
      throw new Error("WebP chunk yapısı okunamadı.");
    }

    const type = readAscii(bytes, offset, 4);
    const length = readUint32LE(bytes, offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const paddedEnd = dataEnd + (length % 2);

    if (dataEnd > bytes.length || paddedEnd > bytes.length) {
      throw new Error("WebP chunk dosya sınırını aşıyor.");
    }

    if (type !== "EXIF" && type !== "XMP ") {
      const chunk = bytes.slice(offset, paddedEnd);
      if (type === "VP8X" && length >= 10) {
        chunk[8] &= ~0x0c;
      }
      chunks.push(chunk);
    }

    offset = paddedEnd;
  }

  const riffSize = 4 + chunks.reduce((total, chunk) => total + chunk.length, 0);
  const output = new Uint8Array(12 + chunks.reduce((total, chunk) => total + chunk.length, 0));
  output.set(bytes.slice(0, 4), 0);
  writeUint32LE(output, 4, riffSize);
  output.set(bytes.slice(8, 12), 8);

  let writeOffset = 12;
  for (const chunk of chunks) {
    output.set(chunk, writeOffset);
    writeOffset += chunk.length;
  }

  return output;
}

function addJpegSyntheticMetadata(bytes, metadata) {
  const payload = concatUint8([asciiBytes("Exif\0\0"), buildExifTiff(metadata)]);
  const length = payload.length + 2;

  if (length > 0xffff) {
    throw new Error("EXIF test metadata JPEG segmenti için çok büyük.");
  }

  return concatUint8([
    bytes.slice(0, 2),
    Uint8Array.from([0xff, 0xe1, (length >> 8) & 0xff, length & 0xff]),
    payload,
    bytes.slice(2),
  ]);
}

function addPngSyntheticMetadata(bytes, metadata) {
  const chunks = [bytes.slice(0, 8)];
  let offset = 8;
  let inserted = false;

  while (offset < bytes.length) {
    const length = readUint32BE(bytes, offset);
    const type = readAscii(bytes, offset + 4, 4);
    const chunkEnd = offset + 12 + length;
    chunks.push(bytes.slice(offset, chunkEnd));
    offset = chunkEnd;

    if (!inserted && type === "IHDR") {
      chunks.push(
        buildPngChunk("eXIf", buildExifTiff(metadata)),
        buildPngTextChunk("SyntheticTestFixture", metadata.userComment),
        buildPngTextChunk("Make", metadata.make),
        buildPngTextChunk("Model", metadata.model),
        buildPngTextChunk("Software", metadata.software),
        buildPngTextChunk("DateTimeOriginal", metadata.dateTimeOriginal),
      );
      inserted = true;
    }

    if (type === "IEND") {
      break;
    }
  }

  return concatUint8(chunks);
}

function addWebpSyntheticMetadata(bytes, metadata) {
  const exifChunk = buildRiffChunk("EXIF", buildExifTiff(metadata));
  const xmpChunk = buildRiffChunk("XMP ", asciiBytes(buildSyntheticXmp(metadata)));
  const chunks = [];
  let offset = 12;
  let inserted = false;

  while (offset < bytes.length) {
    const type = readAscii(bytes, offset, 4);
    const length = readUint32LE(bytes, offset + 4);
    const dataEnd = offset + 8 + length;
    const paddedEnd = dataEnd + (length % 2);

    if (!inserted && (type === "VP8 " || type === "VP8L" || type === "ANIM")) {
      chunks.push(exifChunk, xmpChunk);
      inserted = true;
    }

    const chunk = bytes.slice(offset, paddedEnd);
    if (type === "VP8X" && length >= 10) {
      chunk[8] |= 0x0c;
    }
    chunks.push(chunk);
    offset = paddedEnd;
  }

  if (!inserted) {
    chunks.push(exifChunk, xmpChunk);
  }

  const riffSize = 4 + chunks.reduce((total, chunk) => total + chunk.length, 0);
  const output = new Uint8Array(12 + chunks.reduce((total, chunk) => total + chunk.length, 0));
  output.set(asciiBytes("RIFF"), 0);
  writeUint32LE(output, 4, riffSize);
  output.set(asciiBytes("WEBP"), 8);

  let writeOffset = 12;
  for (const chunk of chunks) {
    output.set(chunk, writeOffset);
    writeOffset += chunk.length;
  }

  return output;
}

function getExtension(fileName = "") {
  const cleanName = String(fileName).split("?")[0].split("#")[0];
  const index = cleanName.lastIndexOf(".");
  return index === -1 ? "" : cleanName.slice(index + 1).toLowerCase();
}

function toUint8Array(input) {
  if (input instanceof Uint8Array) {
    return input;
  }

  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input);
  }

  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }

  throw new Error("Dosya verisi okunamadı.");
}

function detectImageType(bytes, mimeType, fileName) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    return JPEG_MIME;
  }
  if (isPngSignature(bytes)) {
    return PNG_MIME;
  }
  if (readAscii(bytes, 0, 4) === "RIFF" && readAscii(bytes, 8, 4) === "WEBP") {
    return WEBP_MIME;
  }

  const mimeMatch = imageMimeToType(mimeType);
  if (mimeMatch) {
    return mimeMatch;
  }

  const extension = getExtension(fileName);
  if (extension === "jpg" || extension === "jpeg") {
    return JPEG_MIME;
  }
  if (extension === "png") {
    return PNG_MIME;
  }
  if (extension === "webp") {
    return WEBP_MIME;
  }

  return null;
}

function isPngSignature(bytes) {
  return (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  );
}

function imageMimeToType(mimeType = "") {
  const type = mimeType.toLowerCase();
  if (type === "image/jpeg" || type === "image/jpg") {
    return JPEG_MIME;
  }
  if (type === "image/png") {
    return PNG_MIME;
  }
  if (type === "image/webp") {
    return WEBP_MIME;
  }
  return null;
}

function shouldRemoveJpegSegment(marker) {
  return marker === 0xe1 || marker === 0xed || marker === 0xec || marker === 0xfe;
}

function readAscii(bytes, offset, length) {
  if (offset < 0 || offset + length > bytes.length) {
    return "";
  }

  let value = "";
  for (let index = 0; index < length; index += 1) {
    value += String.fromCharCode(bytes[offset + index]);
  }
  return value;
}

function asciiBytes(value) {
  return new TextEncoder().encode(value);
}

function formatExifDate(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join(":") + ` ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function buildExifTiff(metadata) {
  const make = exifAscii(metadata.make);
  const model = exifAscii(metadata.model);
  const software = exifAscii(metadata.software);
  const dateTime = exifAscii(metadata.dateTimeOriginal);
  const userComment = concatUint8([asciiBytes("ASCII\0\0\0"), asciiBytes(metadata.userComment)]);
  const ifd0EntryCount = 5;
  const exifEntryCount = 2;
  const ifd0Offset = 8;
  const ifd0DirLength = 2 + ifd0EntryCount * 12 + 4;
  let ifd0DataOffset = ifd0Offset + ifd0DirLength;
  const ifd0DataLength = [make, model, software, dateTime]
    .reduce((total, value) => total + (value.length > 4 ? value.length : 0), 0);
  const exifIfdOffset = ifd0DataOffset + ifd0DataLength;
  const exifDirLength = 2 + exifEntryCount * 12 + 4;
  let exifDataOffset = exifIfdOffset + exifDirLength;
  const exifDataLength = [dateTime, userComment]
    .reduce((total, value) => total + (value.length > 4 ? value.length : 0), 0);
  const output = new Uint8Array(exifDataOffset + exifDataLength);

  output.set(asciiBytes("II"), 0);
  writeUint16LE(output, 2, 42);
  writeUint32LE(output, 4, ifd0Offset);

  writeUint16LE(output, ifd0Offset, ifd0EntryCount);
  let entryOffset = ifd0Offset + 2;
  ifd0DataOffset = writeExifValueEntry(output, entryOffset, 0x010f, 2, make, ifd0DataOffset);
  entryOffset += 12;
  ifd0DataOffset = writeExifValueEntry(output, entryOffset, 0x0110, 2, model, ifd0DataOffset);
  entryOffset += 12;
  ifd0DataOffset = writeExifValueEntry(output, entryOffset, 0x0131, 2, software, ifd0DataOffset);
  entryOffset += 12;
  ifd0DataOffset = writeExifValueEntry(output, entryOffset, 0x0132, 2, dateTime, ifd0DataOffset);
  entryOffset += 12;
  writeExifLongEntry(output, entryOffset, 0x8769, exifIfdOffset);
  writeUint32LE(output, ifd0Offset + 2 + ifd0EntryCount * 12, 0);

  writeUint16LE(output, exifIfdOffset, exifEntryCount);
  entryOffset = exifIfdOffset + 2;
  exifDataOffset = writeExifValueEntry(output, entryOffset, 0x9003, 2, dateTime, exifDataOffset);
  entryOffset += 12;
  writeExifValueEntry(output, entryOffset, 0x9286, 7, userComment, exifDataOffset);
  writeUint32LE(output, exifIfdOffset + 2 + exifEntryCount * 12, 0);

  return output;
}

function exifAscii(value) {
  return asciiBytes(`${value}\0`);
}

function writeExifValueEntry(output, entryOffset, tag, type, value, dataOffset) {
  writeUint16LE(output, entryOffset, tag);
  writeUint16LE(output, entryOffset + 2, type);
  writeUint32LE(output, entryOffset + 4, value.length);

  if (value.length <= 4) {
    output.set(value, entryOffset + 8);
    return dataOffset;
  }

  writeUint32LE(output, entryOffset + 8, dataOffset);
  output.set(value, dataOffset);
  return dataOffset + value.length;
}

function writeExifLongEntry(output, entryOffset, tag, value) {
  writeUint16LE(output, entryOffset, tag);
  writeUint16LE(output, entryOffset + 2, 4);
  writeUint32LE(output, entryOffset + 4, 1);
  writeUint32LE(output, entryOffset + 8, value);
}

function buildPngChunk(type, payload) {
  const typeBytes = asciiBytes(type);
  const output = new Uint8Array(12 + payload.length);
  writeUint32BE(output, 0, payload.length);
  output.set(typeBytes, 4);
  output.set(payload, 8);
  writeUint32BE(output, 8 + payload.length, crc32(concatUint8([typeBytes, payload])));
  return output;
}

function buildPngTextChunk(keyword, value) {
  return buildPngChunk("tEXt", concatUint8([asciiBytes(keyword), Uint8Array.of(0), asciiBytes(value)]));
}

function buildRiffChunk(type, payload) {
  const padding = payload.length % 2 === 1 ? 1 : 0;
  const output = new Uint8Array(8 + payload.length + padding);
  output.set(asciiBytes(type), 0);
  writeUint32LE(output, 4, payload.length);
  output.set(payload, 8);
  return output;
}

function buildSyntheticXmp(metadata) {
  return [
    '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>',
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    '<rdf:Description rdf:about=""',
    ` tiff:Make="${escapeXml(metadata.make)}"`,
    ` tiff:Model="${escapeXml(metadata.model)}"`,
    ` xmp:CreatorTool="${escapeXml(metadata.software)}"`,
    ' xmlns:tiff="http://ns.adobe.com/tiff/1.0/"',
    ' xmlns:xmp="http://ns.adobe.com/xap/1.0/">',
    `<xmp:CreateDate>${escapeXml(metadata.dateTimeOriginal)}</xmp:CreateDate>`,
    `<xmp:Label>${escapeXml(metadata.userComment)}</xmp:Label>`,
    "</rdf:Description>",
    "</rdf:RDF>",
    "</x:xmpmeta>",
    "<?xpacket end=\"w\"?>",
  ].join("");
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function readUint16BE(bytes, offset) {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint32BE(bytes, offset) {
  return (
    (bytes[offset] * 0x1000000) +
    ((bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3])
  );
}

function writeUint32BE(bytes, offset, value) {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function readUint32LE(bytes, offset) {
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] * 0x1000000)
  ) >>> 0;
}

function writeUint32LE(bytes, offset, value) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

function writeUint16LE(bytes, offset, value) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
}

function concatUint8(chunks) {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;

  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }

  return output;
}

function normalizeZipBytes(input) {
  if (input instanceof Uint8Array) {
    return input;
  }

  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input);
  }

  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }

  if (Array.isArray(input)) {
    return Uint8Array.from(input);
  }

  throw new Error("ZIP girdisi okunamadı.");
}

function uniqueZipName(name, usedNames) {
  let candidate = name;
  let index = 2;

  while (usedNames.has(candidate)) {
    candidate = appendNameSuffix(name, index);
    index += 1;
  }

  usedNames.add(candidate);
  return candidate;
}

function appendNameSuffix(name, index) {
  const slashIndex = name.lastIndexOf("/");
  const dotIndex = name.lastIndexOf(".");

  if (dotIndex > slashIndex) {
    return `${name.slice(0, dotIndex)}-${index}${name.slice(dotIndex)}`;
  }

  return `${name}-${index}`;
}

function crc32(bytes) {
  let crc = 0xffffffff;

  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

async function loadFfmpeg(onStatus) {
  if (ffmpegInstance) {
    return ffmpegInstance;
  }

  if (ffmpegLoadPromise) {
    return ffmpegLoadPromise;
  }

  ffmpegLoadPromise = (async () => {
    onStatus?.("Video motoru yükleniyor. Bu işlem ilk seferde biraz sürebilir.");
    const [{ FFmpeg }, { toBlobURL }] = await Promise.all([
      import(FFMPEG_PACKAGE_URL),
      import(FFMPEG_UTIL_URL),
    ]);

    const ffmpeg = new FFmpeg();
    ffmpeg.on("log", ({ message }) => {
      if (message) {
        console.debug("[ffmpeg]", message);
      }
    });

    await ffmpeg.load({
      coreURL: await toBlobURL(`${FFMPEG_CORE_URL}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${FFMPEG_CORE_URL}/ffmpeg-core.wasm`, "application/wasm"),
    });

    ffmpegInstance = ffmpeg;
    onStatus?.("Video motoru hazır.");
    return ffmpeg;
  })();

  return ffmpegLoadPromise;
}

async function cleanVideoFile(file, onStatus, mode = "clean") {
  const ffmpeg = await loadFfmpeg(onStatus);
  const extension = getExtension(file.name) || videoMimeToExtension(file.type) || "mp4";
  const token = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const inputName = `input-${token}.${extension}`;
  const outputName = `output-${token}.${extension}`;
  const args = [
    "-i",
    inputName,
    "-map",
    "0",
    "-map_metadata",
    "-1",
    "-map_metadata:s",
    "-1",
    "-map_chapters",
    "-1",
    "-c",
    "copy",
  ];

  if (mode === "test") {
    args.push(...videoSyntheticMetadataArgs(createSyntheticTestMetadata(), extension));
  }

  args.push(outputName);

  ffmpeg.on("progress", ({ progress }) => {
    if (Number.isFinite(progress)) {
      onStatus?.(`Video işleniyor: ${Math.max(0, Math.min(100, Math.round(progress * 100)))}%`);
    }
  });

  try {
    await ffmpeg.writeFile(inputName, new Uint8Array(await file.arrayBuffer()));
    const exitCode = await ffmpeg.exec(args);

    if (exitCode !== 0) {
      throw new Error("FFmpeg video dosyasını stream-copy ile temizleyemedi.");
    }

    const output = await ffmpeg.readFile(outputName);
    return new Blob([output], { type: file.type || videoExtensionToMime(extension) });
  } finally {
    await deleteFfmpegFile(ffmpeg, inputName);
    await deleteFfmpegFile(ffmpeg, outputName);
  }
}

function videoSyntheticMetadataArgs(metadata, extension) {
  const args = [
    "-metadata",
    `make=${metadata.make}`,
    "-metadata",
    `model=${metadata.model}`,
    "-metadata",
    `software=${metadata.software}`,
    "-metadata",
    `DateTimeOriginal=${metadata.dateTimeOriginal}`,
    "-metadata",
    `comment=${metadata.userComment}`,
    "-metadata",
    `description=${metadata.userComment}`,
  ];

  if (extension === "mp4" || extension === "mov" || extension === "m4v") {
    args.push("-movflags", "use_metadata_tags");
  }

  return args;
}

async function deleteFfmpegFile(ffmpeg, fileName) {
  try {
    await ffmpeg.deleteFile(fileName);
  } catch {
    // The file may not exist when FFmpeg fails before writing output.
  }
}

function videoMimeToExtension(mimeType = "") {
  const type = mimeType.toLowerCase();
  if (type.includes("quicktime")) return "mov";
  if (type.includes("webm")) return "webm";
  if (type.includes("matroska") || type.includes("x-matroska")) return "mkv";
  if (type.includes("mp4")) return "mp4";
  return "";
}

function videoExtensionToMime(extension) {
  if (extension === "webm") return "video/webm";
  if (extension === "mov") return "video/quicktime";
  if (extension === "mkv") return "video/x-matroska";
  return "video/mp4";
}

function outputFileName(fileName, extensionOverride = "", suffix = "temiz") {
  const fallback = "dosya";
  const cleanName = fileName || fallback;
  const dot = cleanName.lastIndexOf(".");
  const base = dot === -1 ? cleanName : cleanName.slice(0, dot);
  const extension = extensionOverride || (dot === -1 ? "" : cleanName.slice(dot + 1));
  return `${base}-${suffix}${extension ? `.${extension}` : ""}`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

function initApp() {
  const picker = document.querySelector("[data-file-picker]");
  const folderPicker = document.querySelector("[data-folder-picker]");
  const dropZone = document.querySelector("[data-drop-zone]");
  const queue = document.querySelector("[data-queue]");
  const emptyState = document.querySelector("[data-empty]");
  const summary = document.querySelector("[data-summary]");
  const clearButton = document.querySelector("[data-clear]");
  const downloadAllButton = document.querySelector("[data-download-all]");
  const chooseButton = document.querySelector("[data-choose]");
  const chooseFolderButton = document.querySelector("[data-choose-folder]");
  const modeInputs = Array.from(document.querySelectorAll("[data-mode]"));
  const items = [];
  let processing = false;

  chooseButton.addEventListener("click", () => picker.click());
  chooseFolderButton.addEventListener("click", () => folderPicker.click());
  picker.addEventListener("change", () => {
    addFiles(Array.from(picker.files || []));
    picker.value = "";
  });
  folderPicker.addEventListener("change", () => {
    addFiles(Array.from(folderPicker.files || []));
    folderPicker.value = "";
  });

  dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropZone.classList.add("is-dragging");
  });

  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("is-dragging");
  });

  dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    dropZone.classList.remove("is-dragging");
    addFiles(Array.from(event.dataTransfer?.files || []));
  });

  clearButton.addEventListener("click", () => {
    for (const item of items.splice(0)) {
      if (item.url) {
        URL.revokeObjectURL(item.url);
      }
      item.element.remove();
    }
    renderSummary();
  });
  downloadAllButton.addEventListener("click", downloadCleanedZip);
  modeInputs.forEach((input) => {
    input.addEventListener("change", renderSummary);
  });

  function selectedMode() {
    return modeInputs.find((input) => input.checked)?.value || "clean";
  }

  function addFiles(files) {
    const mode = selectedMode();
    for (const file of files) {
      const item = createQueueItem(file, mode);
      items.push(item);
      queue.append(item.element);
    }
    renderSummary();
    processQueue();
  }

  async function processQueue() {
    if (processing) {
      return;
    }

    processing = true;

    while (items.some((item) => item.state === "pending")) {
      const item = items.find((candidate) => candidate.state === "pending");
      await processItem(item);
      renderSummary();
    }

    processing = false;
    renderSummary();
  }

  async function processItem(item) {
    const { file } = item;
    const mode = item.mode || "clean";
    const outputSuffix = mode === "test" ? "test-metadata" : "temiz";

    try {
      if (!isSupportedImage(file) && !isSupportedVideo(file)) {
        setItemStatus(item, "error", "Desteklenmeyen format");
        return;
      }

      setItemStatus(item, "working", "İşleniyor");

      if (isSupportedImage(file)) {
        const inputBytes = await file.arrayBuffer();
        const result = mode === "test"
          ? addSyntheticTestImageMetadata(inputBytes, file.type, file.name)
          : cleanImageBytes(inputBytes, file.type, file.name);
        const blob = new Blob([result.bytes], { type: result.type });
        setItemOutput(
          item,
          blob,
          outputFileName(file.name, result.extension, outputSuffix),
          outputFileName(file.webkitRelativePath || file.name, result.extension, outputSuffix),
        );
        setItemStatus(item, "done", mode === "test" ? "Test metadata eklendi" : "Temizlendi");
        return;
      }

      const blob = await cleanVideoFile(file, (message) => setItemStatus(item, "working", message), mode);
      setItemOutput(
        item,
        blob,
        outputFileName(file.name, "", outputSuffix),
        outputFileName(file.webkitRelativePath || file.name, "", outputSuffix),
      );
      setItemStatus(item, "done", mode === "test" ? "Test metadata eklendi" : "Temizlendi");
    } catch (error) {
      setItemStatus(item, "error", error instanceof Error ? error.message : "İşlem tamamlanamadı");
    }
  }

  function createQueueItem(file, mode) {
    const row = document.createElement("li");
    row.className = "file-row";
    row.innerHTML = `
      <div class="file-main">
        <span class="file-name"></span>
        <span class="file-meta"></span>
      </div>
      <span class="status status-pending">Bekliyor</span>
      <a class="download" aria-disabled="true">İndir</a>
    `;

    const name = row.querySelector(".file-name");
    const meta = row.querySelector(".file-meta");
    name.textContent = file.webkitRelativePath || file.name;
    meta.textContent = `${formatBytes(file.size)} · ${file.type || getExtension(file.name).toUpperCase() || "dosya"}`;

    return {
      element: row,
      file,
      mode,
      blob: null,
      outputName: "",
      outputPath: "",
      state: "pending",
      url: "",
    };
  }

  function setItemStatus(item, state, message) {
    item.state = state;
    const status = item.element.querySelector(".status");
    status.className = `status status-${state}`;
    status.textContent = message;
  }

  function setItemOutput(item, blob, name, pathName) {
    if (item.url) {
      URL.revokeObjectURL(item.url);
    }

    item.blob = blob;
    item.outputName = name;
    item.outputPath = pathName || name;
    item.url = URL.createObjectURL(blob);
    const link = item.element.querySelector(".download");
    link.href = item.url;
    link.download = name;
    link.removeAttribute("aria-disabled");
    link.textContent = "İndir";
  }

  async function downloadCleanedZip() {
    const hasActiveWork = items.some((item) => item.state === "pending" || item.state === "working");
    const doneItems = items.filter((item) => item.state === "done" && item.blob);

    if (hasActiveWork || doneItems.length === 0) {
      return;
    }

    const previousLabel = downloadAllButton.textContent;
    downloadAllButton.disabled = true;
    downloadAllButton.textContent = "ZIP hazırlanıyor";

    try {
      const entries = [];
      for (const item of doneItems) {
        entries.push({
          name: item.outputPath || item.outputName,
          bytes: new Uint8Array(await item.blob.arrayBuffer()),
        });
      }

      triggerDownload(new Blob([createStoredZip(entries)], { type: "application/zip" }), "metadata-temiz.zip");
    } finally {
      downloadAllButton.textContent = previousLabel;
      renderSummary();
    }
  }

  function renderSummary() {
    emptyState.hidden = items.length > 0;
    clearButton.disabled = items.length === 0;

    const done = items.filter((item) => item.state === "done").length;
    const failed = items.filter((item) => item.state === "error").length;
    const pending = items.filter((item) => item.state === "pending" || item.state === "working").length;
    downloadAllButton.disabled = done === 0 || pending > 0;
    const readyLabel = selectedMode() === "test" ? "test metadata" : "temiz";
    summary.textContent = `${items.length} dosya · ${done} ${readyLabel} · ${pending} bekliyor/işleniyor · ${failed} hata`;
  }
}

function triggerDownload(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

if (typeof document !== "undefined") {
  initApp();
}
