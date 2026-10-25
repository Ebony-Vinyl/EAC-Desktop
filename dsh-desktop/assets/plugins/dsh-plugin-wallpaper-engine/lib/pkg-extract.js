/**
 * dsh-wallpaper-engine — scene.pkg / scene.json static-frame extractor.
 *
 * Extracts the MAIN texture of a Wallpaper Engine scene wallpaper as a
 * standalone static image the browser can show behind the GUI:
 *
 *   - Packed scenes (`scene.pkg`, magic PKGVxxxx): the PKG entry index is
 *     parsed, entries are decompressed (LZ4 block chains, the format WE uses
 *     inside PKG containers), then the TEX container of each candidate
 *     texture is decoded.
 *   - Loose scenes (`scene.json` + plain .tex/.json files, e.g. WE
 *     defaultprojects): the same pipeline runs over a path-fenced directory
 *     access layer.
 *   - TEX containers (magic TEXV0005/TEXI0001) are parsed for metadata,
 *     mipmaps (TEXB0001..4, LZ4 or raw) and animated GIF frame tables
 *     (TEXS0001..3). The first mipmap of the first image is decoded to
 *     RGBA8888 for RGBA8888 / R8 / RG88 / DXT1 / DXT3 / DXT5.
 *   - **Embedded JPEG textures**: Wallpaper Engine stores photographic
 *     textures as a complete JPEG payload inside the TEX container (the mip
 *     data starts with FFD8 JFIF). Those are returned as-is — zero decoding,
 *     the most faithful and cheapest path for photographic scene wallpapers
 *     (the skin-center's extractor misses this variant and silently falls
 *     back to a mask texture; this module fixes that).
 *
 * Candidate selection: the first scene.json object carrying an `image`
 * property wins (its direct .tex reference, or the textures listed by the
 * material / instance it points at), then remaining .tex files are ranked by
 * pixel area with `mask`/`normal` paths penalized (they are grayscale /
 * normal-map helpers, never the wallpaper art). The first candidate that
 * decodes cleanly is returned.
 *
 * Zero runtime dependencies (node:zlib only). Format knowledge mirrors the
 * public RePKG / lwe reverse-engineering of the Wallpaper Engine formats.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';
// jpeg-js is only needed by the multi-layer compositor (a JPEG-embedded layer
// must become pixels before it can be blended); the single-texture path still
// passes embedded JPEGs through untouched.
import { decode as decodeJpeg } from 'jpeg-js';

/** Wallpaper Engine texture format ids (TEXI0001 header), per RePKG/lwe. */
const TexFormat = {
  RGBA8888: 0,
  RGB888: 1,
  RGB565: 2,
  DXT5: 4,
  DXT3: 6,
  DXT1: 7,
  RG88: 8,
  R8: 9,
  RG1616F: 10,
  R16F: 11,
  BC7: 12,
  RGBA1010102: 13,
  RGBA16161616F: 14,
  RGB161616F: 15,
};
const TEX_FORMAT_NAMES = {
  0: 'RGBA8888',
  1: 'RGB888',
  2: 'RGB565',
  4: 'DXT5',
  6: 'DXT3',
  7: 'DXT1',
  8: 'RG88',
  9: 'R8',
  10: 'RG1616F',
  11: 'R16F',
  12: 'BC7',
  13: 'RGBA1010102',
  14: 'RGBA16161616F',
  15: 'RGB161616F',
};
/** TEXI0001 flags bit marking an animated (sprite-sheet / gif) texture. */
const TEX_FLAG_IS_GIF = 4;

const textDecoder = new TextDecoder('utf-8');

/**
 * Bounds-checked little-endian binary reader. Every failed read throws an
 * Error prefixed with the reader label.
 */
class Reader {
  constructor(data, label) {
    this.data = data;
    this.label = label;
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    this.pos = 0;
  }
  get remaining() {
    return this.view.byteLength - this.pos;
  }
  need(n) {
    if (n < 0 || this.pos + n > this.view.byteLength) {
      throw new Error(this.label + ': unexpected end of data');
    }
  }
  u8() {
    this.need(1);
    return this.view.getUint8(this.pos++);
  }
  i32() {
    this.need(4);
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }
  u32() {
    this.need(4);
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }
  /** Unsigned 64-bit integer; safe up to 2^53. */
  u64() {
    const lo = this.u32();
    return this.u32() * 4294967296 + lo;
  }
  f32() {
    this.need(4);
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }
  bytes(n) {
    this.need(n);
    const out = this.data.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
  /** int32-length-prefixed UTF-8 string (PKG magic and entry paths). */
  sizedString(maxLength) {
    const length = this.i32();
    if (length < 0 || length > maxLength) {
      throw new Error(this.label + ': invalid string length ' + length);
    }
    return textDecoder.decode(this.bytes(length));
  }
  /** NUL-terminated string (all TEX magics and the TEXB0004 json blob). */
  nstring(maxLength) {
    const start = this.pos;
    let end = start;
    const limit = Math.min(this.view.byteLength, start + maxLength);
    while (end < limit && this.view.getUint8(end) !== 0) end++;
    if (end >= limit) throw new Error(this.label + ': unterminated string');
    const out = textDecoder.decode(this.data.subarray(start, end));
    this.pos = end + 1;
    return out;
  }
}

/**
 * Decompress one raw LZ4 block (the format inside PKG entry chains and TEXB
 * mipmaps) following the official lz4 block format specification.
 *
 * @param src compressed block bytes
 * @param dstSize exact expected decompressed size
 */
function lz4DecompressBlock(src, dstSize) {
  const dst = new Uint8Array(dstSize);
  let ip = 0;
  let op = 0;
  while (ip < src.length) {
    const token = src[ip++];
    let literalLength = token >> 4;
    if (literalLength === 15) {
      let s = 0;
      do {
        if (ip >= src.length) throw new Error('lz4: truncated literal length');
        s = src[ip++];
        literalLength += s;
      } while (s === 255);
    }
    if (ip + literalLength > src.length || op + literalLength > dstSize) {
      throw new Error('lz4: literal run out of bounds');
    }
    dst.set(src.subarray(ip, ip + literalLength), op);
    ip += literalLength;
    op += literalLength;
    if (ip >= src.length) break;
    if (ip + 2 > src.length) throw new Error('lz4: truncated match offset');
    const offset = src[ip] | (src[ip + 1] << 8);
    ip += 2;
    if (offset === 0 || offset > op) throw new Error('lz4: invalid match offset ' + offset);
    let matchLength = token & 15;
    if (matchLength === 15) {
      let s = 0;
      do {
        if (ip >= src.length) throw new Error('lz4: truncated match length');
        s = src[ip++];
        matchLength += s;
      } while (s === 255);
    }
    matchLength += 4;
    if (op + matchLength > dstSize) throw new Error('lz4: match run out of bounds');
    for (let i = 0; i < matchLength; i++) {
      dst[op] = dst[op - offset];
      op++;
    }
  }
  if (op !== dstSize) {
    throw new Error('lz4: decompressed size mismatch (got ' + op + ', expected ' + dstSize + ')');
  }
  return dst;
}

/**
 * Probe whether the entry data at [abs, abs+length) is an LZ4 block chain:
 * int64 original size followed by [int32 uncomp][int32 comp][block] entries
 * that reconstruct exactly originalSize bytes while consuming the entry to
 * the byte. Returns the original size when the chain fits perfectly.
 */
function probeCompressedEntry(data, abs, length) {
  if (length < 8) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const originalSize = view.getUint32(abs, true) + view.getUint32(abs + 4, true) * 4294967296;
  if (originalSize <= length || originalSize > 2147483647) return null;
  let pos = abs + 8;
  let total = 0;
  while (total < originalSize) {
    if (pos + 8 > abs + length) return null;
    const uncomp = view.getInt32(pos, true);
    const comp = view.getInt32(pos + 4, true);
    if (uncomp <= 0 || comp <= 0 || pos + 8 + comp > abs + length) return null;
    total += uncomp;
    pos += 8 + comp;
  }
  return total === originalSize && pos === abs + length ? originalSize : null;
}

/**
 * Parse a PKG container (magic PKGVxxxx) and return its entry index.
 * Entry offsets in the returned list are absolute positions inside data.
 */
function parsePkg(data) {
  const r = new Reader(data, 'pkg');
  const magic = r.sizedString(32);
  if (!/^PKGV\d{4}$/.test(magic)) throw new Error("pkg: bad magic '" + magic + "'");
  const count = r.i32();
  if (count < 0 || count > 1048576) throw new Error('pkg: invalid entry count ' + count);
  const index = [];
  for (let i = 0; i < count; i++) {
    index.push({ path: r.sizedString(1024), offset: r.u32(), length: r.u32() });
  }
  const dataStart = r.pos;
  return index.map(({ path, offset, length }) => {
    const abs = dataStart + offset;
    if (abs + length > data.byteLength) throw new Error("pkg: entry '" + path + "' out of bounds");
    const originalSize = probeCompressedEntry(data, abs, length);
    return originalSize === null
      ? { path, offset: abs, compressedSize: length, size: length, flags: 0 }
      : { path, offset: abs, compressedSize: length, size: originalSize, flags: 1 };
  });
}

/**
 * Extract (and decompress, when the entry uses LZ4 block-chain storage) one
 * package entry. Returns a fresh buffer of exactly entry.size bytes.
 */
function readPkgEntry(data, entry) {
  const abs = entry.offset;
  if (abs < 0 || abs + entry.compressedSize > data.byteLength) {
    throw new Error("pkg: entry '" + entry.path + "' out of bounds");
  }
  if ((entry.flags & 1) === 0) return data.slice(abs, abs + entry.compressedSize);
  const r = new Reader(data.subarray(abs, abs + entry.compressedSize), 'pkg');
  if (r.u64() !== entry.size) throw new Error("pkg: entry '" + entry.path + "' size mismatch");
  const out = new Uint8Array(entry.size);
  let written = 0;
  while (written < entry.size) {
    const uncomp = r.i32();
    const comp = r.i32();
    if (uncomp <= 0 || comp <= 0 || written + uncomp > entry.size) {
      throw new Error("pkg: corrupt compressed entry '" + entry.path + "'");
    }
    out.set(lz4DecompressBlock(r.bytes(comp), uncomp), written);
    written += uncomp;
  }
  if (r.remaining !== 0) throw new Error("pkg: corrupt compressed entry '" + entry.path + "'");
  return out;
}

/** Read one mipmap record; containerVersion selects the TEXB layout. */
function readMipmap(r, containerVersion) {
  if (containerVersion === 4) {
    const param1 = r.i32();
    const param2 = r.i32();
    r.nstring(1 << 20);
    const param3 = r.i32();
    if (param1 !== 1 || param2 !== 2 || param3 !== 1) {
      throw new Error('tex: bad TEXB0004 mipmap params');
    }
  }
  const width = r.i32();
  const height = r.i32();
  if (width <= 0 || height <= 0 || width > 16384 || height > 16384) {
    throw new Error('tex: invalid mipmap dimensions ' + width + 'x' + height);
  }
  if (containerVersion === 1) {
    return { width, height, bytes: r.bytes(r.i32()) };
  }
  const isLz4 = r.i32() === 1;
  const decompressedCount = r.i32();
  const stored = r.bytes(r.i32());
  if (isLz4) {
    return { width, height, bytes: lz4DecompressBlock(stored, decompressedCount) };
  }
  return { width, height, bytes: stored };
}

/** Parse a TEX container into metadata plus the first image's mipmaps. */
function parseTexInternal(data) {
  const r = new Reader(data, 'tex');
  const magic1 = r.nstring(16);
  if (magic1 !== 'TEXV0005') throw new Error("tex: bad magic '" + magic1 + "'");
  const magic2 = r.nstring(16);
  if (magic2 !== 'TEXI0001') throw new Error("tex: bad image-info magic '" + magic2 + "'");
  const format = r.i32();
  const flags = r.i32();
  const textureWidth = r.i32();
  const textureHeight = r.i32();
  const imageWidth = r.i32();
  const imageHeight = r.i32();
  r.u32();
  if (TEX_FORMAT_NAMES[format] === undefined) throw new Error('tex: unsupported format ' + format);
  const containerMagic = r.nstring(16);
  const containerMatch = /^TEXB000([1-4])$/.exec(containerMagic);
  if (!containerMatch) throw new Error("tex: bad mipmap container magic '" + containerMagic + "'");
  let containerVersion = Number(containerMatch[1]);
  const imageCount = r.i32();
  if (imageCount <= 0 || imageCount > 256) throw new Error('tex: invalid image count ' + imageCount);
  let isVideoMp4 = false;
  if (containerVersion === 3) r.i32();
  else if (containerVersion === 4) {
    const freeImageFormat = r.i32();
    isVideoMp4 = r.i32() === 1;
    if (!(freeImageFormat === -1 && isVideoMp4)) containerVersion = 3;
  }
  let firstImage = null;
  for (let i = 0; i < imageCount; i++) {
    const mipmapCount = r.i32();
    if (mipmapCount <= 0 || mipmapCount > 32) throw new Error('tex: invalid mipmap count ' + mipmapCount);
    const mipmaps = [];
    for (let j = 0; j < mipmapCount; j++) mipmaps.push(readMipmap(r, containerVersion));
    if (firstImage === null) firstImage = mipmaps;
  }
  const isAnimatedGif = (flags & TEX_FLAG_IS_GIF) !== 0;
  const frames = [];
  if (isAnimatedGif) {
    const frameMagic = r.nstring(16);
    const frameMatch = /^TEXS000([1-3])$/.exec(frameMagic);
    if (!frameMatch) throw new Error("tex: bad frame container magic '" + frameMagic + "'");
    const frameVersion = Number(frameMatch[1]);
    const frameCount = r.i32();
    if (frameCount < 0 || frameCount > 4096) throw new Error('tex: invalid frame count ' + frameCount);
    if (frameVersion === 3) {
      r.i32();
      r.i32();
    }
    for (let i = 0; i < frameCount; i++) {
      const imageId = r.i32();
      const frametime = r.f32();
      if (frameVersion === 1) {
        const x = r.i32();
        const y = r.i32();
        const width = r.i32();
        r.i32();
        r.i32();
        const height = r.i32();
        frames.push({ imageId, frametime, x, y, width, height });
      } else {
        const x = r.f32();
        const y = r.f32();
        const width = r.f32();
        r.f32();
        r.f32();
        const height = r.f32();
        frames.push({ imageId, frametime, x, y, width, height });
      }
    }
  }
  const mip0 = firstImage[0];
  const embedded =
    mip0.bytes.length >= 2 && mip0.bytes[0] === 0xff && mip0.bytes[1] === 0xd8
      ? 'jpeg'
      : mip0.bytes.length >= 8 && mip0.bytes[0] === 0x89 && mip0.bytes[1] === 0x50 && mip0.bytes[2] === 0x4e && mip0.bytes[3] === 0x47
        ? 'png'
        : null;
  return {
    format,
    flags,
    width: imageWidth > 0 ? imageWidth : textureWidth > 0 ? textureWidth : mip0.width,
    height: imageHeight > 0 ? imageHeight : textureHeight > 0 ? textureHeight : mip0.height,
    isAnimatedGif,
    isVideoMp4,
    frames,
    imageCount,
    mipmaps: firstImage,
    embedded,
  };
}

/** Parse a TEX container and return its metadata (never throws on payload). */
function parseTex(data) {
  const parsed = parseTexInternal(data);
  const info = {
    width: parsed.width,
    height: parsed.height,
    format: parsed.format,
    formatName: TEX_FORMAT_NAMES[parsed.format] ?? 'unknown(' + parsed.format + ')',
    isAnimatedGif: parsed.isAnimatedGif,
    isVideoMp4: parsed.isVideoMp4,
    imageCount: parsed.imageCount,
    mipLevels: parsed.mipmaps.length,
    embedded: parsed.embedded,
  };
  if (parsed.isAnimatedGif) info.frames = parsed.frames;
  return info;
}

// ── Embedded JPEG support ───────────────────────────────────────────────────
// Wallpaper Engine stores photographic textures as a complete JPEG payload
// inside the TEX mip data (the JPEG starts right where raw pixels would).
// Detect by the FFD8 SOI marker and hand back the bytes untouched.

/**
 * Scan JPEG markers for the first SOF segment and return { width, height }.
 * Returns null when the payload is not a parseable JPEG.
 */
function jpegSofDims(bytes) {
  const len = bytes.length;
  let p = 2;
  while (p + 9 < len) {
    if (bytes[p] !== 0xff) { p++; continue; }
    const marker = bytes[p + 1];
    if (marker === 0xd8) { p += 2; continue; }
    if (marker === 0xd9 || marker === 0xda) return null; // EOI / SOS before SOF
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (p + 9 > len) return null;
      return {
        height: ((bytes[p + 5] << 8) | bytes[p + 6]) & 0xffff,
        width: ((bytes[p + 7] << 8) | bytes[p + 8]) & 0xffff,
      };
    }
    const segLen = ((bytes[p + 2] << 8) | bytes[p + 3]) & 0xffff;
    if (segLen < 2) return null;
    p += 2 + segLen;
  }
  return null;
}

function rgb565(value) {
  const r = (value >> 11) & 31;
  const g = (value >> 5) & 63;
  const b = value & 31;
  return [r << 3 | r >> 2, g << 2 | g >> 4, b << 3 | b >> 2];
}

/** Build the 4-color BC palette; three-color + transparent when DXT1 c0 <= c1. */
function buildColorPalette(c0, c1, fourColor) {
  const palette = new Uint8Array(16);
  const [r0, g0, b0] = rgb565(c0);
  const [r1, g1, b1] = rgb565(c1);
  palette.set([r0, g0, b0, 255], 0);
  palette.set([r1, g1, b1, 255], 4);
  if (fourColor) {
    palette.set([((2 * r0 + r1) / 3) | 0, ((2 * g0 + g1) / 3) | 0, ((2 * b0 + b1) / 3) | 0, 255], 8);
    palette.set([((r0 + 2 * r1) / 3) | 0, ((g0 + 2 * g1) / 3) | 0, ((b0 + 2 * b1) / 3) | 0, 255], 12);
  } else {
    palette.set([((r0 + r1) / 2) | 0, ((g0 + g1) / 2) | 0, ((b0 + b1) / 2) | 0, 255], 8);
    palette.set([0, 0, 0, 0], 12);
  }
  return palette;
}

/** Shared BC1/BC2/BC3 block walker (blockStride 8 for BC1, 16 for BC2/BC3). */
function decodeColorBlocks(src, out, width, height, blockStride, colorOffset, dxt1Alpha) {
  const view = new DataView(src.buffer, src.byteOffset, src.byteLength);
  const blocksX = Math.ceil(width / 4);
  const blocksY = Math.ceil(height / 4);
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const base = (by * blocksX + bx) * blockStride;
      const c0 = view.getUint16(base + colorOffset, true);
      const c1 = view.getUint16(base + colorOffset + 2, true);
      const palette = buildColorPalette(c0, c1, dxt1Alpha ? c0 > c1 : true);
      const indices = view.getUint32(base + colorOffset + 4, true);
      for (let py = 0; py < 4; py++) {
        for (let px = 0; px < 4; px++) {
          const x = bx * 4 + px;
          const y = by * 4 + py;
          if (x >= width || y >= height) continue;
          const selector = (indices >> (2 * (py * 4 + px))) & 3;
          const dst = (y * width + x) * 4;
          out[dst] = palette[selector * 4];
          out[dst + 1] = palette[selector * 4 + 1];
          out[dst + 2] = palette[selector * 4 + 2];
          out[dst + 3] = palette[selector * 4 + 3];
        }
      }
    }
  }
}

/** BC1 (DXT1): 8-byte blocks, 4x4 pixels, optional 1-bit alpha. */
function decodeDxt1(src, width, height) {
  const out = new Uint8Array(width * height * 4);
  decodeColorBlocks(src, out, width, height, 8, 0, true);
  return out;
}

/** BC2 (DXT3): 16-byte blocks, 4-bit explicit alpha + BC1-style color. */
function decodeDxt3(src, width, height) {
  const out = new Uint8Array(width * height * 4);
  decodeColorBlocks(src, out, width, height, 16, 8, false);
  const view = new DataView(src.buffer, src.byteOffset, src.byteLength);
  const blocksX = Math.ceil(width / 4);
  const blocksY = Math.ceil(height / 4);
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const base = (by * blocksX + bx) * 16;
      const alphaLo = view.getUint32(base, true);
      const alphaHi = view.getUint32(base + 4, true);
      for (let i = 0; i < 16; i++) {
        const x = bx * 4 + (i % 4);
        const y = by * 4 + ((i / 4) | 0);
        if (x >= width || y >= height) continue;
        const nibble = i < 8 ? (alphaLo >> (4 * i)) & 15 : (alphaHi >> (4 * (i - 8))) & 15;
        out[(y * width + x) * 4 + 3] = nibble * 17;
      }
    }
  }
  return out;
}

/** BC3 (DXT5): 16-byte blocks, interpolated 3-bit alpha + BC1-style color. */
function decodeDxt5(src, width, height) {
  const out = new Uint8Array(width * height * 4);
  decodeColorBlocks(src, out, width, height, 16, 8, false);
  const blocksX = Math.ceil(width / 4);
  const blocksY = Math.ceil(height / 4);
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const base = (by * blocksX + bx) * 16;
      const a0 = src[base];
      const a1 = src[base + 1];
      const alphas = new Uint8Array(8);
      alphas[0] = a0;
      alphas[1] = a1;
      if (a0 > a1) {
        for (let k = 2; k < 8; k++) alphas[k] = (((8 - k) * a0 + (k - 1) * a1) / 7) | 0;
      } else {
        for (let k = 2; k < 6; k++) alphas[k] = (((6 - k) * a0 + (k - 2) * a1) / 5) | 0;
        alphas[6] = 0;
        alphas[7] = 255;
      }
      let bits =
        src[base + 2] +
        src[base + 3] * 256 +
        src[base + 4] * 65536 +
        src[base + 5] * 16777216 +
        src[base + 6] * 4294967296 +
        src[base + 7] * 1099511627776;
      for (let i = 0; i < 16; i++) {
        const x = bx * 4 + (i % 4);
        const y = by * 4 + ((i / 4) | 0);
        const index = bits % 8;
        bits = Math.floor(bits / 8);
        if (x >= width || y >= height) continue;
        out[(y * width + x) * 4 + 3] = alphas[index];
      }
    }
  }
  return out;
}

/**
 * When the declared mipmap size does not match the stored byte count, Wallpaper
 * Engine occasionally stores a downscaled mip while the container header keeps
 * the original dims. Derive the real dims from the data length when a clean
 * factorization exists; otherwise null.
 */
function deriveDims(storedBytes, width, height, bpp) {
  for (let w = width; w >= 16; w = Math.floor(w / 2)) {
    const bytesPerRow = w * bpp;
    if (storedBytes % bytesPerRow !== 0) continue;
    const h = storedBytes / bytesPerRow;
    if (Number.isInteger(h) && h > 0 && h <= height * 2) return { width: w, height: h };
  }
  return null;
}

/**
 * Decode the first (largest) mipmap of a TEX container.
 *
 * Returns `{ kind: 'jpeg', bytes, width, height }` / `{ kind: 'png-pass',
 * bytes, width, height }` when the mip payload is an embedded JPEG / PNG
 * (Wallpaper Engine stores photographic textures as complete JPEG/PNG files
 * inside the TEX container — returned untouched, zero decode, best fidelity),
 * or `{ kind: 'rgba', width, height, rgba }` for RGBA8888 / R8 / RG88 /
 * DXT1 / DXT3 / DXT5. Embedded MP4 textures and unknown formats throw a
 * descriptive error instead of failing silently.
 */
function decodeTex(data) {
  const parsed = parseTexInternal(data);
  if (parsed.isVideoMp4) {
    throw new Error('tex: video mp4 textures cannot be decoded to a static frame');
  }
  const mip0 = parsed.mipmaps[0];
  // Embedded JPEG texture — pass the payload through untouched.
  if (mip0.bytes.length >= 2 && mip0.bytes[0] === 0xff && mip0.bytes[1] === 0xd8) {
    const dims = jpegSofDims(mip0.bytes);
    return {
      kind: 'jpeg',
      bytes: mip0.bytes,
      width: dims ? dims.width : parsed.width,
      height: dims ? dims.height : parsed.height,
    };
  }
  // Embedded PNG texture (newer WE scenes; photographic art, incl. transparent
  // PNG sprites) — pass the payload through untouched. IHDR dims are
  // big-endian at bytes 16-23.
  if (
    mip0.bytes.length >= 24 &&
    mip0.bytes[0] === 0x89 && mip0.bytes[1] === 0x50 &&
    mip0.bytes[2] === 0x4e && mip0.bytes[3] === 0x47
  ) {
    const ihdrW = (mip0.bytes[16] << 24) | (mip0.bytes[17] << 16) | (mip0.bytes[18] << 8) | mip0.bytes[19];
    const ihdrH = (mip0.bytes[20] << 24) | (mip0.bytes[21] << 16) | (mip0.bytes[22] << 8) | mip0.bytes[23];
    return {
      kind: 'png-pass',
      bytes: mip0.bytes,
      width: ihdrW > 0 ? ihdrW : parsed.width,
      height: ihdrH > 0 ? ihdrH : parsed.height,
    };
  }
  let { width, height, bytes } = mip0;
  // Embedded MP4 / QuickTime video texture (WE "sync" animations flag the TEX
  // as RGBA8888 but store an MP4 file; TEXI flags 0x2000/0x2200 mark them).
  // MP4 boxes start with [u32 big-endian size]['ftyp' ...]. The size sanity
  // check matters: raw RGBA textures can coincidentally start with bytes that
  // spell 'ftyp' in a pixel, but their leading u32 is pixel data, not a box
  // length (raw RGBA at w*h*4 is far larger than any small pixel value).
  if (bytes.length >= 12) {
    const boxSize = (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3];
    if (
      boxSize >= 12 && boxSize <= bytes.length &&
      bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70
    ) {
      throw new Error('tex: embedded mp4 video texture cannot be decoded to a static frame');
    }
  }
  switch (parsed.format) {
    case TexFormat.RGBA8888: {
      if (bytes.length < width * height * 4) {
        const derived = deriveDims(bytes.length, width, height, 4);
        if (!derived) throw new Error('tex: mipmap size mismatch for RGBA8888');
        width = derived.width;
        height = derived.height;
      }
      return { kind: 'rgba', width, height, rgba: bytes.slice(0, width * height * 4) };
    }
    case TexFormat.R8: {
      if (bytes.length < width * height) {
        const derived = deriveDims(bytes.length, width, height, 1);
        if (!derived) throw new Error('tex: mipmap size mismatch for R8');
        width = derived.width;
        height = derived.height;
      }
      const rgba = new Uint8Array(width * height * 4);
      for (let i = 0; i < width * height; i++) {
        rgba[i * 4] = bytes[i];
        rgba[i * 4 + 1] = bytes[i];
        rgba[i * 4 + 2] = bytes[i];
        rgba[i * 4 + 3] = 255;
      }
      return { kind: 'rgba', width, height, rgba };
    }
    case TexFormat.RG88: {
      if (bytes.length < width * height * 2) {
        const derived = deriveDims(bytes.length, width, height, 2);
        if (!derived) throw new Error('tex: mipmap size mismatch for RG88');
        width = derived.width;
        height = derived.height;
      }
      const rgba = new Uint8Array(width * height * 4);
      for (let i = 0; i < width * height; i++) {
        rgba[i * 4] = bytes[i * 2];
        rgba[i * 4 + 1] = bytes[i * 2 + 1];
        rgba[i * 4 + 2] = 0;
        rgba[i * 4 + 3] = 255;
      }
      return { kind: 'rgba', width, height, rgba };
    }
    case TexFormat.DXT1: {
      const expected = Math.ceil(width / 4) * Math.ceil(height / 4) * 8;
      if (bytes.length < expected) throw new Error('tex: mipmap size mismatch for DXT1');
      return { kind: 'rgba', width, height, rgba: decodeDxt1(bytes, width, height) };
    }
    case TexFormat.DXT3: {
      const expected = Math.ceil(width / 4) * Math.ceil(height / 4) * 16;
      if (bytes.length < expected) throw new Error('tex: mipmap size mismatch for DXT3');
      return { kind: 'rgba', width, height, rgba: decodeDxt3(bytes, width, height) };
    }
    case TexFormat.DXT5: {
      const expected = Math.ceil(width / 4) * Math.ceil(height / 4) * 16;
      if (bytes.length < expected) throw new Error('tex: mipmap size mismatch for DXT5');
      return { kind: 'rgba', width, height, rgba: decodeDxt5(bytes, width, height) };
    }
    default:
      throw new Error('tex: unsupported format ' + parsed.format);
  }
}

/**
 * Extract the embedded MP4 payload from a video-texture TEX container
 * (WE "sync" video textures: TEXI0001 flags it, or mip0 starts with an
 * MP4 ftyp box). Returns the raw MP4 bytes, or null when the TEX is not
 * a video texture. Used by the scene static-frame pipeline to feed the
 * embedded video to ffmpeg for a still frame.
 */
function extractTexVideoMp4(raw) {
  try {
    const parsed = parseTexInternal(raw);
    if (!parsed || !parsed.mipmaps || !parsed.mipmaps.length) return null;
    if (parsed.isVideoMp4) return Buffer.from(parsed.mipmaps[0].bytes);
    const bytes = parsed.mipmaps[0].bytes;
    if (bytes && bytes.length >= 12) {
      const boxSize = (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3];
      if (
        boxSize >= 12 && boxSize <= bytes.length &&
        bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70
      ) {
        return Buffer.from(bytes);
      }
    }
  } catch { /* not a video TEX / malformed */ }
  return null;
}

// ── PNG encoder (zero dependencies) ──────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 3988292384 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 4294967295;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 4294967295) >>> 0;
}

function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  out.set(data, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/**
 * Encode RGBA8888 pixels as a minimal PNG (8-bit RGBA, filter type 0) using
 * node:zlib deflate and a hand-rolled CRC32. Zero dependencies.
 */
function encodePng(width, height, rgba) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error('png: invalid dimensions ' + width + 'x' + height);
  }
  if (rgba.length !== width * height * 4) throw new Error('png: rgba buffer size mismatch');
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * stride + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Scene pipeline ───────────────────────────────────────────────────────────

/** Extract .tex candidate paths referenced by one scene.json image object. */
function collectImageObjectTextures(imageObject, readJson) {
  const out = [];
  const pushTextureList = (list) => {
    if (!Array.isArray(list)) return;
    for (const item of list) {
      const name =
        typeof item === 'string'
          ? item
          : item && typeof item === 'object' && typeof item.name === 'string'
            ? item.name
            : null;
      if (name && name.toLowerCase().endsWith('.tex')) out.push(name);
    }
  };
  const ref = imageObject.image;
  if (ref.toLowerCase().endsWith('.tex')) out.push(ref);
  else {
    const material = readJson(ref);
    if (material && Array.isArray(material.passes)) {
      for (const pass of material.passes) pushTextureList(pass && pass.textures);
    }
  }
  const instance = imageObject.instance;
  if (instance && typeof instance === 'object') pushTextureList(instance.textures);
  return out;
}

/** SceneAccess over a packed scene.pkg container (case-insensitive paths). */
function pkgSceneAccess(pkgData) {
  const entries = parsePkg(pkgData);
  const byPath = new Map(entries.map((entry) => [entry.path.toLowerCase(), entry]));
  const readFile = (path) => {
    const entry = byPath.get(path.toLowerCase());
    if (!entry) return null;
    return { path: entry.path, bytes: readPkgEntry(pkgData, entry) };
  };
  return {
    readJson: (path) => {
      const file = readFile(path);
      if (!file) return null;
      try {
        return JSON.parse(textDecoder.decode(file.bytes));
      } catch {
        return null;
      }
    },
    readFile,
    listTexPaths: () => entries.filter((entry) => entry.path.toLowerCase().endsWith('.tex')).map((entry) => entry.path),
  };
}

/**
 * SceneAccess over a loose scene project directory (scene.json plus loose
 * .tex/.json files, e.g. WE defaultprojects). Reads are fenced inside the
 * directory; texture references escaping it resolve to null.
 */
function dirSceneAccess(dir) {
  const readFile = (path) => {
    const abs = resolve(dir, path);
    if (abs !== dir && !abs.startsWith(dir + sep)) return null;
    try {
      if (!statSync(abs).isFile()) return null;
      return { path, bytes: new Uint8Array(readFileSync(abs)) };
    } catch {
      return null;
    }
  };
  const listTexPaths = () => {
    const out = [];
    const walk = (sub, depth) => {
      if (depth > 4) return;
      let names = [];
      try {
        names = readdirSync(sub === '' ? dir : join(dir, sub));
      } catch {
        return;
      }
      for (const name of names) {
        const rel = sub === '' ? name : sub + '/' + name;
        let isDir = false;
        let isFile = false;
        try {
          const stat = statSync(join(dir, rel));
          isDir = stat.isDirectory();
          isFile = stat.isFile();
        } catch {
          continue;
        }
        if (isDir) walk(rel, depth + 1);
        else if (isFile && name.toLowerCase().endsWith('.tex')) out.push(rel);
      }
    };
    walk('', 0);
    return out;
  };
  return {
    readJson: (path) => {
      const file = readFile(path);
      if (!file) return null;
      try {
        return JSON.parse(textDecoder.decode(file.bytes));
      } catch {
        return null;
      }
    },
    readFile,
    listTexPaths,
  };
}

/**
 * Shared scene pipeline over one access layer; label prefixes error text.
 *
 * Candidate order: textures referenced by the first scene object with an
 * `image` property first, then every other .tex ranked by a score that favors
 * wallpaper art — embedded JPEG/PNG payloads (WE only lossy-encodes
 * photographic art), full-color formats (RGBA8888/RGB888), and large areas —
 * while masks, depth/normal/effect helpers, R8/RG88 grayscale formats and
 * embedded workshop asset folders are heavily penalized.
 *
 * A post-decode quality gate rejects grayscale (>88% gray) and flat (near-zero
 * variance) frames — a mask/depth texture can never be the wallpaper — and
 * moves on to the next candidate. When nothing passes, the caller sees an
 * error and falls back to the project preview.
 *
 * Returns `{ mime, bytes, width, height, texturePath }`.
 */
const PATH_PENALTY_RE =
  /(^|[\\/])(masks?|effects?)([\\/]|$)|[\\/]workshop[\\/]|_mask|mask_|normal|depth|ripple|foliagesway|cloudmotion|shake|pulse|xray|opacity|lens|cursor|flow|grad|noise|particle|vignette|blur|sync|_anim|frame|seq/i;
/** Format → art-likelihood multiplier (embedded JPEG/PNG handled separately). */
const FORMAT_PENALTY = {
  0: 1, // RGBA8888
  1: 1, // RGB888
  7: 0.5, // DXT1
  6: 0.5, // DXT3
  4: 0.5, // DXT5
  8: 0.01, // RG88 — grayscale helper
  9: 0.01, // R8 — grayscale helper
  2: 0.1, // RGB565
  12: 0.05, // BC7
  13: 0.1, // RGBA1010102
  10: 0.05, 11: 0.05, 14: 0.05, 15: 0.05, // float formats
};

/** Sample the decoded frame: grayscale ratio + mean channel variance. */
function frameQuality(width, height, rgba) {
  const total = width * height;
  const n = Math.min(2000, total);
  const seen = new Set();
  let gray = 0, sr = 0, sg = 0, sb = 0;
  for (let i = 0; i < n; i++) {
    let idx;
    do { idx = (Math.random() * total) | 0; } while (seen.has(idx));
    seen.add(idx);
    const o = idx * 4;
    const r = rgba[o], g = rgba[o + 1], b = rgba[o + 2];
    sr += r; sg += g; sb += b;
    if (Math.max(r, g, b) - Math.min(r, g, b) <= 24) gray++;
  }
  const mr = sr / n, mg = sg / n, mb = sb / n;
  let v = 0;
  for (const idx of seen) {
    const o = idx * 4;
    v += Math.abs(rgba[o] - mr) + Math.abs(rgba[o + 1] - mg) + Math.abs(rgba[o + 2] - mb);
  }
  return { grayRatio: gray / n, meanVar: v / (n * 3) };
}

/** The quality gate: reject grayscale masks/depth and flat solid fills. */
function isAcceptableFrame(q) {
  if (q.grayRatio > 0.88) return false;
  if (q.meanVar < 3) return false;
  return true;
}

const PNG_GATE_MAX_PIXELS = 12 * 1024 * 1024;

/**
 * Decode an embedded-PNG payload (8-bit RGB/RGBA only) to raw RGBA8888.
 * Payloads larger than PNG_GATE_MAX_PIXELS are refused (bounding decode
 * memory); null is also returned on any parse failure.
 */
function decodePngPayload(bytes) {
  const b = Buffer.from(bytes);
  if (!(b.length >= 33 && b[0] === 0x89 && b.toString('ascii', 1, 4) === 'PNG')) return null;
  const w = b.readUInt32BE(16);
  const h = b.readUInt32BE(20);
  const ct = b[25];
  const channels = ct === 6 ? 4 : ct === 2 ? 3 : 0;
  if (w <= 0 || h <= 0 || w > 16384 || h > 16384 || !channels || w * h > PNG_GATE_MAX_PIXELS) return null;
  const idats = [];
  let p = 8;
  while (p < b.length) {
    if (p + 12 > b.length) return null;
    const len = b.readUInt32BE(p);
    const type = b.toString('ascii', p + 4, p + 8);
    if (p + 12 + len > b.length) return null;
    if (type === 'IDAT') idats.push(b.subarray(p + 8, p + 8 + len));
    if (type === 'IEND') break;
    p += 12 + len;
  }
  if (!idats.length) return null;
  let raw;
  try {
    raw = inflateSync(Buffer.concat(idats));
  } catch {
    return null;
  }
  const stride = w * channels + 1;
  if (raw.length < stride * h) return null;
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const f = raw[y * stride];
    const line = raw.subarray(y * stride + 1, (y + 1) * stride);
    for (let x = 0; x < w * channels; x++) {
      const a = x >= channels ? rgba[y * w * 4 + x - channels] : 0;
      const pr = y > 0 ? rgba[(y - 1) * w * 4 + x] : 0;
      const pc = y > 0 && x >= channels ? rgba[(y - 1) * w * 4 + x - channels] : 0;
      let v = line[x];
      if (f === 1) v = (v + a) & 255;
      else if (f === 2) v = (v + pr) & 255;
      else if (f === 3) v = (v + ((a + pr) >> 1)) & 255;
      else if (f === 4) {
        const q = a + pr - pc;
        const pa = Math.abs(q - a);
        const pb = Math.abs(q - pr);
        const pcv = Math.abs(q - pc);
        v = (v + (pa <= pb && pa <= pcv ? a : pb <= pcv ? pr : pc)) & 255;
      }
      rgba[y * w * 4 + x] = v;
    }
  }
  return { width: w, height: h, rgba };
}

/**
 * Quality-check an embedded-PNG payload WITHOUT committing to it: decode
 * and run the same grayscale/flat gate. Payloads larger than
 * PNG_GATE_MAX_PIXELS are trusted (bounding decode memory); returns null
 * then, or on any parse failure — the caller treats null as "accept".
 */
function pngQuality(bytes) {
  const d = decodePngPayload(bytes);
  return d ? frameQuality(d.width, d.height, d.rgba) : null;
}

// ── Multi-layer scene compositing ────────────────────────────────────────────
// A scene with several image objects (e.g. multi-panel layouts like workshop
// 3615954176 守岸人 — three 1664×2432 portrait panels side by side at
// x≈612/1910/3229) must be composited WITH the scene transforms. The
// single-texture path otherwise returns only ONE panel, and the client's
// cover fit then shows just the middle slice of the composition (the reported
// "只显示中间部分" bug).
//
// Geometry mirrors the manifest builder (lib/scene-manifest.js): the object
// origin is the layer CENTER in scene space (y from the top); size comes from
// the image json's width/height, then the object size, then the decoded
// texture; object scale multiplies; alignment anchors an edge; parent chains
// fold root-down. Rotation is not resampled (the quad is placed unrotated —
// rotating a bitmap would need full affine sampling and rotated 2D layers are
// rare in practice).

/** Parse a "x y z" scene-vector string; def when missing/malformed. */
function parseSceneVec3(val, def) {
  if (typeof val === 'string') {
    const parts = val.trim().split(/\s+/).map(parseFloat);
    if (parts.length >= 3 && !parts.some(isNaN)) return [parts[0], parts[1], parts[2]];
  }
  return def;
}

/** The scene's declared projection (authoring viewport), or null. */
function sceneProjectionSize(scene) {
  const general = scene && scene.general;
  const proj = general && general.orthogonalprojection;
  const rawW = proj && proj.width;
  const rawH = proj && proj.height;
  const width = typeof rawW === 'number' && Number.isFinite(rawW) && rawW > 0 ? Math.floor(rawW) : 0;
  const height = typeof rawH === 'number' && Number.isFinite(rawH) && rawH > 0 ? Math.floor(rawH) : 0;
  return width > 0 && height > 0 ? { width, height } : null;
}

/**
 * Fold the parent transform chain (linux-wallpaperengine
 * CImage::resolveTransform): a child's origin/scale are relative to the
 * already-resolved parent, so grouped objects only land correctly after
 * folding. Walk leaf-first with a visited check + depth cap against cycles,
 * then accumulate root-down: offset = rotate(childOrigin * parentScale,
 * parentAngle).
 */
function resolveObjectTransform(sceneObjects, obj, defOrigin) {
  const chain = [obj];
  let cur = obj;
  while (cur.parent != null && chain.length <= 32) {
    const parent = sceneObjects.find((o) => o && o.id === cur.parent);
    if (!parent || chain.includes(parent)) break;
    chain.push(parent);
    cur = parent;
  }
  const root = chain[chain.length - 1];
  let origin = parseSceneVec3(root.origin, defOrigin);
  let scale = parseSceneVec3(root.scale, [1, 1, 1]);
  let angle = parseSceneVec3(root.angles, [0, 0, 0])[2];
  for (let i = chain.length - 2; i >= 0; i--) {
    const localOrigin = parseSceneVec3(chain[i].origin, [0, 0, 0]);
    const localScale = parseSceneVec3(chain[i].scale, [1, 1, 1]);
    const localAngle = parseSceneVec3(chain[i].angles, [0, 0, 0])[2];
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    origin = [
      origin[0] + localOrigin[0] * scale[0] * c - localOrigin[1] * scale[1] * s,
      origin[1] + localOrigin[0] * scale[0] * s + localOrigin[1] * scale[1] * c,
      origin[2] + localOrigin[2] * scale[2],
    ];
    scale = [scale[0] * localScale[0], scale[1] * localScale[1], scale[2] * localScale[2]];
    angle += localAngle;
  }
  return { origin, scale, angle };
}

/** Resolve a WE material texture reference ('ricepod/jet') to a tex path. */
function resolveSceneTexPath(access, ref) {
  const want = String(ref).toLowerCase().replace(/\.tex$/i, '');
  if (!want) return null;
  return access.listTexPaths().find((p) => {
    const lower = p.toLowerCase();
    return lower === want + '.tex'
      || lower === 'materials/' + want + '.tex'
      || lower.endsWith('/' + want + '.tex')
      || lower.endsWith('/' + want);
  }) || null;
}

/** First non-render-target texture reference of a material pass. */
function firstPassTextureRef(pass) {
  const list = pass && Array.isArray(pass.textures) ? pass.textures : null;
  if (!list) return null;
  for (const item of list) {
    const ref = typeof item === 'string'
      ? item
      : item && typeof item === 'object' && typeof item.name === 'string'
        ? item.name
        : null;
    if (ref && !ref.startsWith('_rt_')) return ref;
  }
  return null;
}

/** Decode a TEX container to raw RGBA pixels, whatever the payload kind. */
function decodeTexToRgba(bytes) {
  const decoded = decodeTex(bytes);
  if (decoded.kind === 'rgba') return decoded;
  if (decoded.kind === 'jpeg') {
    const jpg = decodeJpeg(Buffer.from(decoded.bytes), { useTArray: true, maxResolutionInMP: 64 });
    return { width: jpg.width, height: jpg.height, rgba: jpg.data };
  }
  if (decoded.kind === 'png-pass') return decodePngPayload(decoded.bytes);
  return null;
}

/** Bilinear RGBA resize (only used when the layer's scene size differs from
 *  the texture's native size). */
function resizeBilinear(rgba, w, h, outW, outH) {
  const out = new Uint8Array(outW * outH * 4);
  const xRatio = w / outW;
  const yRatio = h / outH;
  for (let y = 0; y < outH; y++) {
    const sy = (y + 0.5) * yRatio - 0.5;
    const y0 = Math.max(0, Math.min(h - 1, Math.floor(sy)));
    const y1 = Math.min(h - 1, y0 + 1);
    const fy = Math.min(Math.max(sy - y0, 0), 1);
    for (let x = 0; x < outW; x++) {
      const sx = (x + 0.5) * xRatio - 0.5;
      const x0 = Math.max(0, Math.min(w - 1, Math.floor(sx)));
      const x1 = Math.min(w - 1, x0 + 1);
      const fx = Math.min(Math.max(sx - x0, 0), 1);
      const di = (y * outW + x) * 4;
      for (let c = 0; c < 4; c++) {
        const p00 = rgba[(y0 * w + x0) * 4 + c];
        const p10 = rgba[(y0 * w + x1) * 4 + c];
        const p01 = rgba[(y1 * w + x0) * 4 + c];
        const p11 = rgba[(y1 * w + x1) * 4 + c];
        out[di + c] = Math.round(
          p00 * (1 - fx) * (1 - fy) + p10 * fx * (1 - fy)
          + p01 * (1 - fx) * fy + p11 * fx * fy,
        );
      }
    }
  }
  return out;
}

/** Source-over blend one layer onto the canvas, with a layer alpha multiplier. */
function blitLayer(canvas, cw, ch, rgba, w, h, x0, y0, alpha) {
  for (let y = 0; y < h; y++) {
    const cy = y0 + y;
    if (cy < 0 || cy >= ch) continue;
    for (let x = 0; x < w; x++) {
      const cx = x0 + x;
      if (cx < 0 || cx >= cw) continue;
      const si = (y * w + x) * 4;
      const sa = (rgba[si + 3] / 255) * alpha;
      if (sa <= 0) continue;
      const di = (cy * cw + cx) * 4;
      const da = canvas[di + 3] / 255;
      const outA = sa + da * (1 - sa);
      if (outA <= 0) continue;
      canvas[di] = Math.round((rgba[si] * sa + canvas[di] * da * (1 - sa)) / outA);
      canvas[di + 1] = Math.round((rgba[si + 1] * sa + canvas[di + 1] * da * (1 - sa)) / outA);
      canvas[di + 2] = Math.round((rgba[si + 2] * sa + canvas[di + 2] * da * (1 - sa)) / outA);
      canvas[di + 3] = Math.round(outA * 255);
    }
  }
}

/** Hard cap for the composite canvas (8K UHD). Beyond this we fall back to
 *  the single-texture path rather than risk a huge allocation. */
const COMPOSITE_MAX_PIXELS = 7680 * 4320;

/**
 * Composite every visible image object of a 2D scene into one frame.
 * Returns null when the scene is not a multi-layer 2D scene (single image,
 * 3D models present, too few decodable layers) — the caller then keeps using
 * the single-texture path.
 */
function tryCompositeSceneLayers(scene, access, label) {
  const objects = scene.objects;
  // 3D model scenes use UV maps on meshes, not 2D desktop quads.
  if (objects.some((o) => o && typeof o.model === 'string' && o.model.length > 0)) return null;
  const isHelperName = (n) => {
    const l = String(n || '').toLowerCase();
    return l.includes('black') || l.includes('len') || l.includes('util')
      || l.includes('flare') || l.includes('blend') || l === 'sun' || l === 'sun2';
  };
  const imageObjects = objects.filter((o) =>
    o && typeof o.image === 'string'
    && !o.image.startsWith('models/util/')
    && o.visible !== false
    && !(o.visible && typeof o.visible === 'object' && o.visible.value === false)
    && !isHelperName(o.name)
    && !PATH_PENALTY_RE.test(o.image));
  if (imageObjects.length < 2) return null;

  const projection = sceneProjectionSize(scene);
  const defOrigin = projection
    ? [projection.width / 2, projection.height / 2, 0]
    : [1920, 1080, 0];

  // Pass 1: resolve + decode every layer.
  const layers = [];
  for (const obj of imageObjects) {
    let modelJson = null;
    let texRef = null;
    if (obj.image.toLowerCase().endsWith('.tex')) {
      texRef = obj.image;
    } else {
      modelJson = access.readJson(obj.image);
      if (!modelJson || typeof modelJson.material !== 'string') continue;
      const matJson = access.readJson(modelJson.material)
        || access.readJson('materials/' + modelJson.material);
      const pass0 = matJson && Array.isArray(matJson.passes) ? matJson.passes[0] : null;
      texRef = firstPassTextureRef(pass0);
    }
    if (!texRef || PATH_PENALTY_RE.test(String(texRef))) continue;
    const texPath = resolveSceneTexPath(access, texRef);
    if (!texPath) continue;
    const file = access.readFile(texPath);
    if (!file) continue;
    let img = null;
    try { img = decodeTexToRgba(file.bytes); } catch { img = null; }
    if (!img || img.width < 16 || img.height < 16) continue;

    // Layer size: image json width/height, then the object size, then the
    // decoded texture; object scale multiplies on top.
    const tr = resolveObjectTransform(objects, obj, defOrigin);
    let lw = 0;
    let lh = 0;
    const declaredW = modelJson && typeof modelJson.width === 'number' ? modelJson.width : 0;
    const declaredH = modelJson && typeof modelJson.height === 'number' ? modelJson.height : 0;
    if (declaredW > 0 && declaredH > 0) {
      lw = declaredW;
      lh = declaredH;
    } else if (typeof obj.size === 'string') {
      const parts = obj.size.trim().split(/\s+/).map(parseFloat);
      if (parts.length >= 2 && !parts.some(isNaN)) { lw = parts[0]; lh = parts[1]; }
    }
    if (!lw || !lh) { lw = img.width; lh = img.height; }

    // cropoffset: the image json samples a sub-rect of the texture.
    if (declaredW > 0 && declaredH > 0 && modelJson && typeof modelJson.cropoffset === 'string') {
      const parts = modelJson.cropoffset.trim().split(/\s+/).map(parseFloat);
      const ox = parts.length >= 2 && !parts.some(isNaN) ? parts[0] : 0;
      const oy = parts.length >= 2 && !parts.some(isNaN) ? parts[1] : 0;
      const cx0 = Math.max(0, Math.min(Math.round(ox), img.width - 1));
      const cy0 = Math.max(0, Math.min(Math.round(oy), img.height - 1));
      const cwCrop = Math.max(1, Math.min(Math.round(declaredW), img.width - cx0));
      const chCrop = Math.max(1, Math.min(Math.round(declaredH), img.height - cy0));
      if (cx0 !== 0 || cy0 !== 0 || cwCrop !== img.width || chCrop !== img.height) {
        const cropped = new Uint8Array(cwCrop * chCrop * 4);
        for (let y = 0; y < chCrop; y++) {
          cropped.set(
            img.rgba.subarray(((cy0 + y) * img.width + cx0) * 4, ((cy0 + y) * img.width + cx0 + cwCrop) * 4),
            y * cwCrop * 4,
          );
        }
        img = { width: cwCrop, height: chCrop, rgba: cropped };
      }
    }

    lw *= Math.abs(tr.scale[0]) || 1;
    lh *= Math.abs(tr.scale[1]) || 1;
    let cx = tr.origin[0];
    let cy = tr.origin[1];
    if (modelJson && modelJson.fullscreen === true && projection) {
      lw = projection.width;
      lh = projection.height;
      cx = projection.width / 2;
      cy = projection.height / 2;
    }
    // alignment anchors the quad by half its scaled size per side (default
    // 'center' leaves the origin at the quad center).
    const alignment = typeof obj.alignment === 'string' ? obj.alignment.toLowerCase() : '';
    if (alignment.includes('left')) cx += lw / 2;
    else if (alignment.includes('right')) cx -= lw / 2;
    if (alignment.includes('top')) cy -= lh / 2;
    else if (alignment.includes('bottom')) cy += lh / 2;
    const alpha = typeof obj.alpha === 'number' && Number.isFinite(obj.alpha)
      ? Math.min(1, Math.max(0, obj.alpha))
      : 1;
    layers.push({ img, cx, cy, lw: Math.round(lw), lh: Math.round(lh), alpha });
  }
  // A single surviving layer is served better by the passthrough path
  // (embedded JPEG/PNG keep their original bytes there).
  if (layers.length < 2) return null;

  // Pass 2: canvas. The declared projection is authoritative; without one,
  // the canvas is the layers' bounding box (multi-panel scenes usually omit
  // the projection and simply span their panels).
  let cw;
  let ch;
  let offX = 0;
  let offY = 0;
  if (projection) {
    cw = projection.width;
    ch = projection.height;
  } else {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const L of layers) {
      minX = Math.min(minX, L.cx - L.lw / 2);
      maxX = Math.max(maxX, L.cx + L.lw / 2);
      minY = Math.min(minY, L.cy - L.lh / 2);
      maxY = Math.max(maxY, L.cy + L.lh / 2);
    }
    offX = -Math.floor(minX);
    offY = -Math.floor(minY);
    cw = Math.ceil(maxX - minX);
    ch = Math.ceil(maxY - minY);
  }
  if (cw <= 0 || ch <= 0 || cw * ch > COMPOSITE_MAX_PIXELS) return null;

  const canvas = new Uint8Array(cw * ch * 4);
  // WE clears the scene with its clear color. scene.json general.clearcolor is
  // the authoritative source and — crucially — lives INSIDE scene.pkg, while
  // the author's schemecolor property sits in project.json, which a packed
  // scene.pkg does NOT contain (so pkg scenes never saw the fill). Without
  // this fill, areas outside the layers stay transparent and render as a
  // black band over the dark GUI background (reported on 3615954176 守岸人:
  // black strip below the panels).
  const general = scene.general;
  const clearRaw = general && typeof general.clearcolor === 'string' ? general.clearcolor : null;
  const project = access.readJson('project.json');
  const schemeRaw = project && project.general && project.general.properties
    && project.general.properties.schemecolor && project.general.properties.schemecolor.value;
  const scheme = (general && general.clearenabled === false)
    ? null
    : parseSceneVec3(clearRaw, null) || parseSceneVec3(schemeRaw, null);
  if (scheme) {
    const r = Math.round(Math.min(1, Math.max(0, scheme[0])) * 255);
    const g = Math.round(Math.min(1, Math.max(0, scheme[1])) * 255);
    const b = Math.round(Math.min(1, Math.max(0, scheme[2])) * 255);
    for (let i = 0; i < cw * ch; i++) {
      canvas[i * 4] = r;
      canvas[i * 4 + 1] = g;
      canvas[i * 4 + 2] = b;
      canvas[i * 4 + 3] = 255;
    }
  }

  for (const L of layers) {
    if (L.lw <= 0 || L.lh <= 0 || L.lw * L.lh > COMPOSITE_MAX_PIXELS) continue;
    const pixels = (L.lw === L.img.width && L.lh === L.img.height)
      ? L.img.rgba
      : resizeBilinear(L.img.rgba, L.img.width, L.img.height, L.lw, L.lh);
    blitLayer(
      canvas, cw, ch, pixels, L.lw, L.lh,
      Math.round(L.cx - L.lw / 2) + offX,
      Math.round(L.cy - L.lh / 2) + offY,
      L.alpha,
    );
  }

  // Same quality gate as the single-texture path: never emit a gray/flat frame.
  const q = frameQuality(cw, ch, canvas);
  if (!isAcceptableFrame(q)) return null;
  return {
    mime: 'image/png',
    bytes: encodePng(cw, ch, canvas),
    width: cw,
    height: ch,
    texturePath: 'composite(' + layers.length + ' layers)',
  };
}

function extractSceneMainImageVia(access, label) {
  const scene = access.readJson('scene.json');
  if (!scene || !Array.isArray(scene.objects)) {
    throw new Error(label + ': scene.json not found or invalid');
  }
  // Multi-layer 2D scenes first: composite every visible image object with
  // its scene transform. The single-texture path below would otherwise pick
  // ONE layer and the client's cover fit would show only the middle slice.
  try {
    const composite = tryCompositeSceneLayers(scene, access, label);
    if (composite) return composite;
  } catch { /* fall through to the single-texture path */ }
  const candidates = [];
  const imageObject = scene.objects.find(
    (o) => !!o && typeof o === 'object' && typeof o.image === 'string'
  );
  if (imageObject) candidates.push(...collectImageObjectTextures(imageObject, access.readJson));

  // Rank the rest of the package's textures by art-likelihood score.
  const ranked = [];
  for (const path of access.listTexPaths()) {
    let score = 0;
    try {
      const file = access.readFile(path);
      const info = file ? parseTex(file.bytes) : null;
      if (info && !info.isVideoMp4) {
        const area = info.width * info.height;
        const embedded = info.embedded === 'jpeg' || info.embedded === 'png' ? 1 : FORMAT_PENALTY[info.format] ?? 0.05;
        const pathPenalty = PATH_PENALTY_RE.test(path) ? 0.02 : 1;
        score = area * embedded * pathPenalty;
      }
    } catch {
      score = 0;
    }
    ranked.push({ path, score });
  }
  ranked.sort((a, b) => b.score - a.score);
  for (const { path } of ranked) {
    if (!candidates.some((c) => c.toLowerCase() === path.toLowerCase())) candidates.push(path);
  }
  if (candidates.length === 0) throw new Error(label + ': no texture candidates found');

  let lastError = null;
  for (const path of candidates) {
    const file = access.readFile(path);
    if (!file) {
      lastError = new Error(label + ": texture '" + path + "' not found in " + (label === 'pkg' ? 'package' : 'directory'));
      continue;
    }
    try {
      const decoded = decodeTex(file.bytes);
      if (decoded.kind === 'jpeg') {
        // Embedded JPEG payloads are photographic art by construction — WE
        // never stores masks/helpers as JPEG. Pass through untouched.
        return {
          mime: 'image/jpeg',
          bytes: decoded.bytes,
          width: decoded.width,
          height: decoded.height,
          texturePath: file.path,
        };
      }
      if (decoded.kind === 'png-pass') {
        // Embedded PNGs are usually art, but some scenes store grayscale
        // variants (b/w edits, gray backgrounds) — quality-gate when cheap.
        const q = pngQuality(decoded.bytes);
        if (q && !isAcceptableFrame(q)) {
          lastError = new Error(
            label + ': frame rejected (' + file.path + '): gray=' + Math.round(q.grayRatio * 100) + '% var=' + q.meanVar.toFixed(1)
          );
          continue;
        }
        return {
          mime: 'image/png',
          bytes: decoded.bytes,
          width: decoded.width,
          height: decoded.height,
          texturePath: file.path,
        };
      }
      // Raw RGBA — apply the quality gate before committing to it.
      const q = frameQuality(decoded.width, decoded.height, decoded.rgba);
      if (!isAcceptableFrame(q)) {
        lastError = new Error(
          label + ': frame rejected (' + file.path + '): gray=' + Math.round(q.grayRatio * 100) + '% var=' + q.meanVar.toFixed(1)
        );
        continue;
      }
      return {
        mime: 'image/png',
        bytes: encodePng(decoded.width, decoded.height, decoded.rgba),
        width: decoded.width,
        height: decoded.height,
        texturePath: file.path,
      };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(label + ': no decodable texture found');
}

/** Extract the main static frame of a packed scene.pkg (Uint8Array/Buffer). */
function extractSceneMainImage(pkgData) {
  return extractSceneMainImageVia(pkgSceneAccess(pkgData), 'pkg');
}

/**
 * Loose-scene variant: decode the main texture of a scene project directory
 * that ships scene.json and textures as plain files instead of a packed
 * scene.pkg.
 */
function extractSceneMainImageFromDir(dir) {
  return extractSceneMainImageVia(dirSceneAccess(dir), 'scene');
}

export { extractSceneMainImage, extractSceneMainImageFromDir, parseTex, decodeTex, parsePkg, readPkgEntry, extractTexVideoMp4 };
