// WE 渲染引擎 — 资源读取 (scene.pkg / 松散目录) 与纹理加载
import fs from 'node:fs';
import path from 'node:path';
import { decodePngBuffer } from './canvas.js';
import { parseTex, decodeTex } from '../pkg-extract.js';
import { decodeJpeg } from './jpeg.js';

// ── 松散 scene.json 目录访问器 ──────────────────────────────────
export function readPkgDir(dir) {
  const exists = (p) => fs.existsSync(path.join(dir, p));
  const read = (p) => {
    const f = path.join(dir, p);
    if (!fs.existsSync(f)) return null;
    return fs.readFileSync(f); // Buffer (兼容 toString('ascii') 等)
  };
  const readJson = (p) => { const b = read(p); return b ? JSON.parse(b.toString('utf8')) : null; };
  return {
    has: exists,
    entries: () => [],
    read,
    readJson,
    readText: (p) => { const b = read(p); return b ? b.toString('utf8') : null; },
  };
}

// ── scene.pkg 容器 ──────────────────────────────────────────────
export function readPkg(pkgPath) {
  const buf = fs.readFileSync(pkgPath);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let pos = 0;
  // PKGV 容器: 支持两种头部布局
  // 旧: "PKGV" + u32 version + u32 count
  // 新: u32 ? + "PKGV0022" + u32 count (magic 在 offset 4)
  const magicAt0 = buf.toString('latin1', 0, 4);
  const magicAt4 = buf.toString('latin1', 4, 8);
  let count;
  let oldFormat = false;
  if (magicAt0 === 'PKGV') {
    oldFormat = true;
    pos = 4;
    pos += 4; // version
    count = dv.getInt32(pos, true); pos += 4;
  } else if (magicAt4 === 'PKGV') {
    // 新格式: [u32?][PKGV + 4 字符版本][u32 count] — magic 8 字节 (4-11), count @ 12
    pos = 12;
    count = dv.getInt32(pos, true); pos += 4;
  } else {
    throw new Error('not a PKGV container');
  }
  if (count <= 0 || count > 100000) throw new Error('invalid entry count ' + count);
  const entries = [];
  for (let i = 0; i < count; i++) {
    // name: u32 长度 + 字符串 (不 4 对齐; 字节级验证: nameLen@16=10, name@20-29, 直接接字段)
    const nameLen = dv.getInt32(pos, true); pos += 4;
    if (nameLen <= 0 || nameLen > 500) throw new Error('invalid name length ' + nameLen);
    const name = buf.toString('utf8', pos, pos + nameLen);
    pos += nameLen;
    // 条目字段: u32 offset + u32 size (小端)
    // 字节级验证 (PKGV0018, 2934788040): scene.json offset@30-33=0 size@34-37=3840;
    // materials/图层 2.tex offset@64-67=3840 size@68-71=2377110
    const offset = dv.getUint32(pos, true);
    const size = dv.getUint32(pos + 4, true);
    entries.push({ name, offset, size });
    pos += 8;
  }
  // 数据区起点 = 描述区结束 (新格式 offset 相对数据区)
  const dataStart = pos;
  const map = new Map(entries.map((e) => [e.name, e]));
  const read = (p) => {
    const e = map.get(p);
    if (!e) return null;
    // 新格式 (PKGV@4): offset 一律相对 dataStart; 旧格式 (PKGV@0): 绝对偏移
    const abs = oldFormat ? e.offset : dataStart + e.offset;
    if (abs + e.size > buf.length) return null;
    return Buffer.from(buf.buffer, buf.byteOffset + abs, e.size);
  };
  const readJson = (p) => {
    const b = read(p);
    return b ? JSON.parse(b.toString('utf8')) : null;
  };
  return {
    has: (p) => map.has(p),
    entries: () => entries,
    read,
    readJson,
    readText: (p) => { const b = read(p); return b ? b.toString('utf8') : null; },
  };
}

// ── 纹理解码 (TEXV 容器 → {width, height, rgba, frames?}) ──────
export function loadTexImage(raw) {
  try {
    const info = parseTex(raw);
    const dec = decodeTex(raw);
    let width, height, rgba;
    if (dec.kind === 'png-pass') {
      const img = decodePngBuffer(Buffer.from(dec.bytes));
      width = img.width; height = img.height; rgba = img.rgba;
    } else if (dec.kind === 'jpeg') {
      const img = decodeJpeg(dec.bytes);
      width = img.width; height = img.height; rgba = img.rgba;
    } else {
      ({ width, height, rgba } = dec);
    }
    // 逻辑尺寸裁剪 (DXT padding)
    if (width !== info.width || height !== info.height) {
      const srcW = width;
      width = info.width; height = info.height;
      const cropped = new Uint8Array(width * height * 4);
      for (let y = 0; y < height; y++) cropped.set(rgba.subarray(y * srcW * 4, y * srcW * 4 + width * 4), y * width * 4);
      rgba = cropped;
    }
    // 精灵图帧元数据 (TEXS: 帧数/时长/布局) — spritesheet 动画用
    let frames = null;
    if (info.frames && info.frames.length > 1) {
      frames = {
        count: info.frames.length,
        duration: info.frames[0].frametime || 0.1,
        items: info.frames,
      };
    }
    return { width, height, rgba, frames };
  } catch (e) {
    throw e;
  }
}

export function loadPngFile(p) {
  const b = fs.readFileSync(p);
  return decodePngBuffer(b);
}
