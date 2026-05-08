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

  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    return JPEG_MIME;
  }
  if (readAscii(bytes, 1, 3) === "PNG") {
    return PNG_MIME;
  }
  if (readAscii(bytes, 0, 4) === "RIFF" && readAscii(bytes, 8, 4) === "WEBP") {
    return WEBP_MIME;
  }

  return null;
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

function readUint16BE(bytes, offset) {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint32BE(bytes, offset) {
  return (
    (bytes[offset] * 0x1000000) +
    ((bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3])
  );
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

async function cleanVideoFile(file, onStatus) {
  const ffmpeg = await loadFfmpeg(onStatus);
  const extension = getExtension(file.name) || videoMimeToExtension(file.type) || "mp4";
  const token = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const inputName = `input-${token}.${extension}`;
  const outputName = `output-${token}.${extension}`;

  ffmpeg.on("progress", ({ progress }) => {
    if (Number.isFinite(progress)) {
      onStatus?.(`Video işleniyor: ${Math.max(0, Math.min(100, Math.round(progress * 100)))}%`);
    }
  });

  try {
    await ffmpeg.writeFile(inputName, new Uint8Array(await file.arrayBuffer()));
    const exitCode = await ffmpeg.exec([
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
      outputName,
    ]);

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

function outputFileName(fileName, extensionOverride = "") {
  const fallback = "dosya";
  const cleanName = fileName || fallback;
  const dot = cleanName.lastIndexOf(".");
  const base = dot === -1 ? cleanName : cleanName.slice(0, dot);
  const extension = extensionOverride || (dot === -1 ? "" : cleanName.slice(dot + 1));
  return `${base}-temiz${extension ? `.${extension}` : ""}`;
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
  const dropZone = document.querySelector("[data-drop-zone]");
  const queue = document.querySelector("[data-queue]");
  const emptyState = document.querySelector("[data-empty]");
  const summary = document.querySelector("[data-summary]");
  const clearButton = document.querySelector("[data-clear]");
  const chooseButton = document.querySelector("[data-choose]");
  const items = [];
  let processing = false;

  chooseButton.addEventListener("click", () => picker.click());
  picker.addEventListener("change", () => {
    addFiles(Array.from(picker.files || []));
    picker.value = "";
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

  function addFiles(files) {
    for (const file of files) {
      const item = createQueueItem(file);
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
  }

  async function processItem(item) {
    const { file } = item;

    try {
      if (!isSupportedImage(file) && !isSupportedVideo(file)) {
        setItemStatus(item, "error", "Desteklenmeyen format");
        return;
      }

      setItemStatus(item, "working", "İşleniyor");

      if (isSupportedImage(file)) {
        const result = cleanImageBytes(await file.arrayBuffer(), file.type, file.name);
        const blob = new Blob([result.bytes], { type: result.type });
        setItemOutput(item, blob, outputFileName(file.name, result.extension));
        setItemStatus(item, "done", "Temizlendi");
        return;
      }

      const blob = await cleanVideoFile(file, (message) => setItemStatus(item, "working", message));
      setItemOutput(item, blob, outputFileName(file.name));
      setItemStatus(item, "done", "Temizlendi");
    } catch (error) {
      setItemStatus(item, "error", error instanceof Error ? error.message : "İşlem tamamlanamadı");
    }
  }

  function createQueueItem(file) {
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
    name.textContent = file.name;
    meta.textContent = `${formatBytes(file.size)} · ${file.type || getExtension(file.name).toUpperCase() || "dosya"}`;

    return {
      element: row,
      file,
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

  function setItemOutput(item, blob, name) {
    if (item.url) {
      URL.revokeObjectURL(item.url);
    }

    item.url = URL.createObjectURL(blob);
    const link = item.element.querySelector(".download");
    link.href = item.url;
    link.download = name;
    link.removeAttribute("aria-disabled");
    link.textContent = "İndir";
  }

  function renderSummary() {
    emptyState.hidden = items.length > 0;
    clearButton.disabled = items.length === 0;

    const done = items.filter((item) => item.state === "done").length;
    const failed = items.filter((item) => item.state === "error").length;
    const pending = items.filter((item) => item.state === "pending" || item.state === "working").length;
    summary.textContent = `${items.length} dosya · ${done} temiz · ${pending} bekliyor/işleniyor · ${failed} hata`;
  }
}

if (typeof document !== "undefined") {
  initApp();
}
