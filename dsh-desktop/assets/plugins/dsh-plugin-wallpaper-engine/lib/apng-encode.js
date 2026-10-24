// APNG 编码器: 把多帧 RGBA 缓冲打包为 APNG (浏览器原生动画支持)
// 帧结构: 每帧独立 PNG IDAT (filter 0 逐行), acTL/fcTL/fdAT 块
import zlib from 'node:zlib';

function crc32(b) {
  let t = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < b.length; i++) crc = t[(crc ^ b[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}

// 单帧 RGBA → 压缩的 IDAT 数据 (filter 0)
export function encodeIdat(w, h, rgba) {
  const stride = w * 4 + 1;
  const raw = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength).copy(raw, y * stride + 1, y * w * 4, (y + 1) * w * 4);
  }
  return zlib.deflateSync(raw, { level: 6 });
}

/**
 * 编码 APNG
 * @param {number} w 宽
 * @param {number} h 高
 * @param {Array<{rgba: Uint8Array, delayMs: number}>} frames
 * @returns {Buffer}
 */
export function encodeApng(w, h, frames) {
  if (!frames || !frames.length) return null;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // acTL: num_frames, num_plays (0 = infinite)
  const actl = Buffer.alloc(8);
  actl.writeUInt32BE(frames.length, 0);
  actl.writeUInt32BE(0, 4);
  const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('acTL', actl)];
  // 第一帧: 默认图像 (IDAT) + fcTL
  let seq = 0;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const delay = Math.max(1, Math.round((f.delayMs || 100) / 10)); // 1/100 秒单位
    // fcTL: seq, w, h, x, y, delay_num, delay_den, dispose, blend
    const fctl = Buffer.alloc(26);
    fctl.writeUInt32BE(seq++, 0); // sequence number (fcTL 与 fdAT 共享递增)
    fctl.writeUInt32BE(w, 4);
    fctl.writeUInt32BE(h, 8);
    fctl.writeUInt32BE(0, 12); // x offset
    fctl.writeUInt32BE(0, 16); // y offset
    fctl.writeUInt16BE(delay, 20); // delay_num
    fctl.writeUInt16BE(100, 22); // delay_den
    fctl[24] = 0; // dispose: none
    fctl[25] = 0; // blend: source
    // 支持预压缩帧 (f.idat): 大场景多帧时逐帧压缩释放原始 rgba, 降低内存峰值
    const idat = f.idat || encodeIdat(w, h, f.rgba);
    if (i === 0) {
      parts.push(chunk('fcTL', fctl), chunk('IDAT', idat));
    } else {
      // 后续帧: fdAT (含 4 字节序列号)
      const seqB = Buffer.alloc(4);
      seqB.writeUInt32BE(seq++, 0);
      parts.push(chunk('fcTL', fctl), chunk('fdAT', Buffer.concat([seqB, idat])));
    }
  }
  parts.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}
