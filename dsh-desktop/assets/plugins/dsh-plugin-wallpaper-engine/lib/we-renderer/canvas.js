// WE 渲染引擎 — 画布 (RGBA 缓冲 + 合成操作) 与 PNG 编解码
import zlib from 'node:zlib';
import { applyBlending } from './math.js';

export class Canvas {
  constructor(w, h) { this.w = w; this.h = h; this.data = new Uint8Array(w * h * 4); this.zbuf = new Float32Array(w * h); this.zbuf.fill(Infinity); }
  clear(r = 0, g = 0, b = 0, a = 0) { this.data.fill(0); this.zbuf.fill(Infinity); }
  get(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return [0, 0, 0, 0];
    const i = (y * this.w + x) * 4;
    return [this.data[i], this.data[i+1], this.data[i+2], this.data[i+3]];
  }
  set(x, y, r, g, b, a) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.data[i] = r; this.data[i+1] = g; this.data[i+2] = b; this.data[i+3] = a;
  }
  // source-over 合成一个已解码纹理 (直接像素拷贝, 无缩放)
  blit(img, dx, dy, alpha = 1) {
    const x0 = Math.floor(dx), y0 = Math.floor(dy);
    for (let ty = y0; ty < y0 + img.height; ty++) {
      if (ty < 0 || ty >= this.h) continue;
      for (let tx = x0; tx < x0 + img.width; tx++) {
        if (tx < 0 || tx >= this.w) continue;
        const sx = tx - x0, sy = ty - y0;
        const si = (sy * img.width + sx) * 4;
        const a = img.rgba[si + 3] / 255 * alpha;
        if (a <= 0) continue;
        const di = (ty * this.w + tx) * 4;
        const dstA = this.data[di + 3] / 255;
        const outA = a + dstA * (1 - a);
        this.data[di] = Math.round((img.rgba[si] * a + this.data[di] * dstA * (1 - a)) / outA);
        this.data[di+1] = Math.round((img.rgba[si+1] * a + this.data[di+1] * dstA * (1 - a)) / outA);
        this.data[di+2] = Math.round((img.rgba[si+2] * a + this.data[di+2] * dstA * (1 - a)) / outA);
        this.data[di+3] = Math.round(outA * 255);
      }
    }
  }
  // 带缩放的 blit (bilinear, 从全尺寸图缩放绘制; 支持负 dw/dh = 水平/垂直镜像, scale.x<0)
  // blendMode > 0 → 用官方 ApplyBlending(mode, 画布色A, 源色B, 源alpha) 颜色混合 (colorBlendMode)
  blitScaled(img, dx, dy, dw, dh, alpha = 1, blendMode = 0) {
    if (dw === 0 || dh === 0) return;
    const flipX = dw < 0, flipY = dh < 0;
    const x0 = Math.floor(flipX ? dx + dw : dx), y0 = Math.floor(flipY ? dy + dh : dy);
    const x1 = Math.ceil(flipX ? dx : dx + dw), y1 = Math.ceil(flipY ? dy : dy + dh);
    const invDw = img.width / Math.abs(dw), invDh = img.height / Math.abs(dh);
    const srcOffX = (x0 - dx) * invDw, srcOffY = (y0 - dy) * invDh;
    for (let ty = y0; ty < y1; ty++) {
      if (ty < 0 || ty >= this.h) continue;
      const sy = Math.min(img.height - 1, Math.max(0, Math.round(srcOffY + (ty - y0) * invDh)));
      const rowBase = sy * img.width;
      for (let tx = x0; tx < x1; tx++) {
        if (tx < 0 || tx >= this.w) continue;
        let sx = Math.min(img.width - 1, Math.max(0, Math.round(srcOffX + (tx - x0) * invDw)));
        if (flipX) sx = img.width - 1 - sx;
        const si = (rowBase + sx) * 4;
        const a = img.rgba[si + 3] / 255 * alpha;
        if (a <= 0) continue;
        const di = (ty * this.w + tx) * 4;
        if (blendMode > 0) {
          // 官方 passthroughblend: ApplyBlending(mode, screen.rgb, albedo.rgb, albedo.a)
          const A = [this.data[di] / 255, this.data[di + 1] / 255, this.data[di + 2] / 255];
          const B = [img.rgba[si] / 255, img.rgba[si + 1] / 255, img.rgba[si + 2] / 255];
          const blended = applyBlending(blendMode, A, B, a);
          const dstA = this.data[di + 3] / 255;
          const outA = a + dstA * (1 - a);
          this.data[di] = Math.round(blended[0] * 255);
          this.data[di + 1] = Math.round(blended[1] * 255);
          this.data[di + 2] = Math.round(blended[2] * 255);
          this.data[di + 3] = Math.round(outA * 255);
          continue;
        }
        const dstA = this.data[di + 3] / 255;
        const outA = a + dstA * (1 - a);
        this.data[di] = Math.round((img.rgba[si] * a + this.data[di] * dstA * (1 - a)) / outA);
        this.data[di+1] = Math.round((img.rgba[si+1] * a + this.data[di+1] * dstA * (1 - a)) / outA);
        this.data[di+2] = Math.round((img.rgba[si+2] * a + this.data[di+2] * dstA * (1 - a)) / outA);
        this.data[di+3] = Math.round(outA * 255);
      }
    }
  }
  // 带缩放 + 旋转的 blit: 以中心 (cx, cy) 旋转 angle 弧度 (逆时针), 目标尺寸 dw×dh
  // 反向映射: 目标像素 → 逆旋转 → 源矩形 → 双线性采样 (引擎 CImage 角度语义)
  blitRotated(img, cx, cy, dw, dh, angle, alpha = 1) {
    // 负 dw/dh = 绕中心镜像 (负 scale 语义, 与 blitScaled 的 flipX/flipY 等价)。
    // 先把负尺寸归一化为正 + 镜像标记, 再旋转 — 避免负 invDw 导致源 UV 翻转
    // 且包围盒错误 (旧实现负尺寸完全不渲染: sx 越界被 continue 跳过)。
    const flipX = dw < 0, flipY = dh < 0;
    const adw = Math.abs(dw), adh = Math.abs(dh);
    const cos = Math.cos(-angle), sin = Math.sin(-angle);
    const halfW = adw / 2, halfH = adh / 2;
    // 旋转后包围盒 (保守扫描范围)
    const absC = Math.abs(cos), absS = Math.abs(sin);
    const rw = halfW * absC + halfH * absS, rh = halfW * absS + halfH * absC;
    const x0 = Math.floor(cx - rw), y0 = Math.floor(cy - rh);
    const x1 = Math.ceil(cx + rw), y1 = Math.ceil(cy + rh);
    const invDw = img.width / adw, invDh = img.height / adh;
    for (let ty = y0; ty < y1; ty++) {
      if (ty < 0 || ty >= this.h) continue;
      for (let tx = x0; tx < x1; tx++) {
        if (tx < 0 || tx >= this.w) continue;
        // 逆旋转到未旋转坐标 (相对中心)
        const ox = tx - cx, oy = ty - cy;
        const ux = ox * cos - oy * sin;
        const uy = ox * sin + oy * cos;
        // 未旋转矩形内 → 源 UV (负尺寸: 翻转 ux/uy 实现镜像)
        let sux = ux, suy = uy;
        if (flipX) sux = -sux;
        if (flipY) suy = -suy;
        const sx = (sux + halfW) * invDw;
        const sy = (suy + halfH) * invDh;
        if (sx < 0 || sy < 0 || sx >= img.width || sy >= img.height) continue;
        const si0 = Math.min(img.width - 1, sx | 0);
        const sj0 = Math.min(img.height - 1, sy | 0);
        const fx = sx - si0, fy = sy - sj0;
        const i0 = (sj0 * img.width + si0) * 4;
        const i1 = (sj0 * img.width + Math.min(img.width - 1, si0 + 1)) * 4;
        const i2 = (Math.min(img.height - 1, sj0 + 1) * img.width + si0) * 4;
        const i3 = (Math.min(img.height - 1, sj0 + 1) * img.width + Math.min(img.width - 1, si0 + 1)) * 4;
        const a = (img.rgba[i0 + 3] * (1 - fx) * (1 - fy) + img.rgba[i1 + 3] * fx * (1 - fy)
          + img.rgba[i2 + 3] * (1 - fx) * fy + img.rgba[i3 + 3] * fx * fy) / 255 * alpha;
        if (a <= 0) continue;
        const r = img.rgba[i0] * (1 - fx) * (1 - fy) + img.rgba[i1] * fx * (1 - fy)
          + img.rgba[i2] * (1 - fx) * fy + img.rgba[i3] * fx * fy;
        const g = img.rgba[i0 + 1] * (1 - fx) * (1 - fy) + img.rgba[i1 + 1] * fx * (1 - fy)
          + img.rgba[i2 + 1] * (1 - fx) * fy + img.rgba[i3 + 1] * fx * fy;
        const b = img.rgba[i0 + 2] * (1 - fx) * (1 - fy) + img.rgba[i1 + 2] * fx * (1 - fy)
          + img.rgba[i2 + 2] * (1 - fx) * fy + img.rgba[i3 + 2] * fx * fy;
        const di = (ty * this.w + tx) * 4;
        const dstA = this.data[di + 3] / 255;
        const outA = a + dstA * (1 - a);
        if (outA <= 0) continue;
        this.data[di] = Math.round((r * a + this.data[di] * dstA * (1 - a)) / outA);
        this.data[di + 1] = Math.round((g * a + this.data[di + 1] * dstA * (1 - a)) / outA);
        this.data[di + 2] = Math.round((b * a + this.data[di + 2] * dstA * (1 - a)) / outA);
        this.data[di + 3] = Math.round(outA * 255);
      }
    }
  }
}

// ── PNG 编码 (filter 0) ────────────────────────────────────────
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
export function encodePng(w, h, rgba) {
  const stride = w * 4 + 1;
  const raw = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) { raw[y * stride] = 0; Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength).copy(raw, y * stride + 1, y * w * 4, (y + 1) * w * 4); }
  const idat = zlib.deflateSync(raw, { level: 6 });
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ── PNG 解码 (最小: 支持 RGBA/RGB 8bit, filter 0-4) ─────────────
export function decodePngBuffer(b) {
  if (b.length < 8 || b[0] !== 0x89 || b[1] !== 0x50) throw new Error('not a png');
  let pos = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idatChunks = [];
  while (pos + 8 <= b.length) {
    const len = b.readUInt32BE(pos);
    const type = b.toString('ascii', pos + 4, pos + 8);
    const data = b.slice(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
      if (bitDepth !== 8) throw new Error('unsupported bit depth ' + bitDepth);
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    } else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 4;
  if (colorType === 3) throw new Error('palette png unsupported');
  const raw = zlib.inflateSync(Buffer.concat(idatChunks));
  const stride = width * channels;
  const rgba = new Uint8Array(width * height * 4);
  const prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = new Uint8Array(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[x - channels] : 0;
      const bb = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = row[x];
      if (filter === 1) v = (v + a) & 0xff;
      else if (filter === 2) v = (v + bb) & 0xff;
      else if (filter === 3) v = (v + ((a + bb) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = a + bb - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - bb), pc = Math.abs(p - c);
        const pr = pa <= pb && pa <= pc ? a : (pb <= pc ? bb : c);
        v = (v + pr) & 0xff;
      }
      out[x] = v;
    }
    for (let x = 0; x < width; x++) {
      const di = (y * width + x) * 4;
      if (channels === 4) {
        rgba[di] = out[x * 4]; rgba[di + 1] = out[x * 4 + 1]; rgba[di + 2] = out[x * 4 + 2]; rgba[di + 3] = out[x * 4 + 3];
      } else if (channels === 3) {
        rgba[di] = out[x * 3]; rgba[di + 1] = out[x * 3 + 1]; rgba[di + 2] = out[x * 3 + 2]; rgba[di + 3] = 255;
      } else {
        rgba[di] = out[x]; rgba[di + 1] = out[x]; rgba[di + 2] = out[x]; rgba[di + 3] = 255;
      }
    }
    prev.set(out);
  }
  return { width, height, rgba };
}
