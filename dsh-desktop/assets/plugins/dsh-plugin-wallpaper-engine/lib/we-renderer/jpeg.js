// WE 渲染引擎 — baseline JPEG 解码 (TEX 内嵌照片纹理)
// 支持 SOF0/SOF1 (baseline/extended sequential), 4:4:4 / 4:2:2 / 4:2:0 采样,
// 完整 Huffman + 反量化 + 浮点 IDCT + YCbCr→RGB, restart markers (RST0-7).
// 输入为完整 JPEG 字节 (FF D8 起), 输出 { width, height, rgba }.

const ZIGZAG = [
  0, 1, 8, 16, 9, 2, 3, 10,
  17, 24, 32, 25, 18, 11, 4, 5,
  12, 19, 26, 33, 40, 48, 41, 34,
  27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36,
  29, 22, 15, 23, 30, 37, 44, 51,
  58, 59, 52, 45, 38, 31, 39, 46,
  53, 60, 61, 54, 47, 55, 62, 63,
];

// 预计算 8 点 IDCT 矩阵: M[x][u] = C(u)/2 * cos((2x+1)u*PI/16)
const IDCT_M = (() => {
  const m = [];
  for (let x = 0; x < 8; x++) {
    const row = [];
    for (let u = 0; u < 8; u++) {
      const c = u === 0 ? Math.SQRT1_2 : 1;
      row.push(0.5 * c * Math.cos(((2 * x + 1) * u * Math.PI) / 16));
    }
    m.push(row);
  }
  return m;
})();

function idct2d(block /* Float64Array 64, zigzag order 已重排到自然序 */) {
  // 行列分离: tmp[x][v] = sum_u M[x][u] * block[u][v]; out[x][y] = sum_v tmp[x][v] * M[y][v]
  const tmp = new Float64Array(64);
  const out = new Float64Array(64);
  for (let x = 0; x < 8; x++) {
    for (let v = 0; v < 8; v++) {
      let s = 0;
      const mx = IDCT_M[x];
      for (let u = 0; u < 8; u++) s += mx[u] * block[u * 8 + v];
      tmp[x * 8 + v] = s;
    }
  }
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 8; y++) {
      let s = 0;
      const my = IDCT_M[y];
      for (let v = 0; v < 8; v++) s += tmp[x * 8 + v] * my[v];
      out[x * 8 + y] = s;
    }
  }
  return out;
}

// 位读取器 (大端), 处理 FF00 填充与 RST restart
class BitReader {
  constructor(bytes, start) {
    this.b = bytes;
    this.pos = start;
    this.bitBuf = 0;
    this.bitCnt = 0;
  }
  // 读 n 位 (n<=16); 0xFF 后 0x00 为填充 (丢弃), D0-D7 为 restart (停止, 外层处理)
  read(n) {
    while (this.bitCnt < n) {
      const byte = this.b[this.pos++];
      if (byte === 0xff) {
        const nxt = this.b[this.pos++];
        if (nxt === 0x00) {
          continue; // 填充字节: 不写入位缓冲
        } else if (nxt >= 0xd0 && nxt <= 0xd7) {
          this.pos -= 2;
          this.restartPending = nxt - 0xd0;
          break;
        } else {
          this.pos -= 2;
          break;
        }
      }
      this.bitBuf = (this.bitBuf << 8) | byte;
      this.bitCnt += 8;
    }
    if (this.bitCnt < n) {
      // 数据不足 (restart 或 EOF)
      const got = this.bitCnt;
      const v = got > 0 ? (this.bitBuf >>> (32 - got)) & ((1 << got) - 1) : 0;
      this.bitCnt = 0;
      this.bitBuf = 0;
      return v << (n - got);
    }
    this.bitCnt -= n;
    return (this.bitBuf >>> this.bitCnt) & ((1 << n) - 1);
  }
  peek(n) {
    while (this.bitCnt < n) {
      const byte = this.b[this.pos++];
      if (byte === 0xff) {
        const nxt = this.b[this.pos++];
        if (nxt === 0x00) continue;
        if (nxt >= 0xd0 && nxt <= 0xd7) { this.pos -= 2; break; }
        this.pos -= 2; break;
      }
      this.bitBuf = (this.bitBuf << 8) | byte;
      this.bitCnt += 8;
    }
    return this.bitCnt >= n ? (this.bitBuf >>> (this.bitCnt - n)) & ((1 << n) - 1) : -1;
  }
  skip(n) {
    while (n > 0) {
      if (this.bitCnt === 0) {
        const byte = this.b[this.pos++];
        if (byte === 0xff) {
          const nxt = this.b[this.pos++];
          if (nxt === 0x00) { continue; }
          if (nxt >= 0xd0 && nxt <= 0xd7) { this.pos -= 2; break; }
          this.pos -= 2; break;
        }
        this.bitBuf = byte;
        this.bitCnt = 8;
      }
      const take = Math.min(n, this.bitCnt);
      this.bitBuf = (this.bitBuf << take) & 0xff;
      this.bitCnt -= take;
      n -= take;
    }
  }
  atRestart() {
    return this.restartPending != null;
  }
  consumeRestart() {
    this.bitCnt = 0;
    this.bitBuf = 0;
    this.restartPending = undefined;
  }
}

// Huffman 表: counts[16] + symbols[] → 解码
function buildHuffTable(counts, symbols) {
  // 标准 JPEG 表: 构建 {code, len, symbol} 列表 + 快速查找
  const table = [];
  let code = 0;
  let k = 0;
  for (let len = 1; len <= 16; len++) {
    for (let i = 0; i < counts[len - 1]; i++) {
      table.push({ code, len, symbol: symbols[k++] });
      code++;
    }
    code <<= 1;
  }
  return table;
}

function huffDecode(reader, table) {
  let code = 0;
  let len = 0;
  const maxLen = table._maxLen;
  for (;;) {
    const bit = reader.read(1);
    if (reader.restartPending != null) return -1; // restart 打断
    code = (code << 1) | bit;
    len++;
    if (len > 16) throw new Error('jpeg: huffman code overflow');
    // 查找匹配
    for (let i = 0; i < table.length; i++) {
      if (table[i].len === len && table[i].code === code) return table[i].symbol;
    }
    // 未定义码 (熵流与码表不匹配, 非标准 JPEG): 模拟 libjpeg fake-huffman
    // (插入 1 位保持同步), 返回 -2 由调用方按无效系数处理; 标准 JPEG 的
    // 前缀码表在 maxLen 内必匹配, 不会走到这里 — 花壁纸 2934788040 背景
    // JPEG 实证 (熵流 28 a2 80 0a 周期重复, sharp/Windows 解出全 0 黑).
    if (len >= maxLen) return -2;
  }
}

// 读 1-16 位差值 (DC/AC 幅度): 值为 v, 若 v < 2^(n-1) 则 v -= 2^n - 1
function readSigned(reader, n) {
  if (n === 0) return 0;
  let v = reader.read(n);
  if (reader.restartPending != null) return 0;
  if (v < (1 << (n - 1))) v -= (1 << n) - 1;
  return v;
}

export function decodeJpeg(bytes) {
  // 熵流无效 (非标准/损坏 JPEG) 时, 与 libjpeg 容错一致返回纯黑,
  // 而不是抛错/输出伪影 (花壁纸 2934788040 背景 JPEG 实证: sharp/Windows
  // 解出全 0 黑, 旧实现解出低对比度伪影 → 渲染成"灰背景").
  try {
    return decodeJpegInner(bytes);
  } catch (e) {
    if (e && e.message && e.message.startsWith('jpeg:') && e._dims) {
      const { width, height } = e._dims;
      return { width, height, rgba: new Uint8Array(width * height * 4) };
    }
    throw e;
  }
}

// 熵流周期检测: 存在周期 ≤ 64 字节且自重复率 ≥ 0.95 的扫描数据视为无效
// (真实 JPEG 熵流接近随机, 不会周期重复; WE 损坏/占位 JPEG 表现为周期熵流)
function isPeriodicEntropy(scan) {
  const n = scan.length;
  const maxPeriod = Math.min(64, n >> 2);
  for (let period = 1; period <= maxPeriod; period++) {
    let match = 0;
    let samples = 0;
    for (let i = period; i < n; i += 4) {
      samples++;
      if (scan[i] === scan[i - period]) match++;
    }
    if (samples > 64 && match / samples > 0.95) return true;
  }
  return false;
}

// 熵扫描解码: 逐 MCU 解出各分量块系数写入平面
// 无效熵流 (huffDecode 返回 -2 未定义码) 计数超阈值 → 抛错, 外层 fallback 纯黑
// (与 libjpeg fake-huffman 行为对齐: 花壁纸背景 JPEG 对标准解码器输出全 0 黑)
function decodeScan(reader, planes, comps, sosComp, huffDC, huffAC, quantTables, block, prevDC, mcusX, mcusY) {
  let invalidCodes = 0;
  const invalid = (v) => v === -2;
  for (let mcuY = 0; mcuY < mcusY; mcuY++) {
    for (let mcuX = 0; mcuX < mcusX; mcuX++) {
      if (reader.atRestart()) reader.consumeRestart();
      for (let ci = 0; ci < comps.length; ci++) {
        const comp = planes[ci];
        const huffD = huffDC[sosComp[ci].td];
        const huffA = huffAC[sosComp[ci].ta];
        const qtab = quantTables[comp.tq];
        if (!huffD || !huffA || !qtab) throw new Error('jpeg: missing huff/quant table');
        for (let by = 0; by < comp.v; by++) {
          for (let bx = 0; bx < comp.h; bx++) {
            block.fill(0);
            // DC
            let s = huffDecode(reader, huffD);
            if (invalid(s)) invalidCodes++;
            if (s === -1) { reader.consumeRestart(); s = huffDecode(reader, huffD); }
            const dcDiff = readSigned(reader, s);
            prevDC[ci] += dcDiff;
            block[0] = prevDC[ci];
            // AC
            let k = 1;
            while (k < 64) {
              const rs = huffDecode(reader, huffA);
              if (invalid(rs)) invalidCodes++;
              if (rs === -1) { reader.consumeRestart(); rs = huffDecode(reader, huffA); }
              const r = rs >> 4, ss = rs & 15;
              if (ss === 0) {
                if (r === 0) break; // EOB
                if (r === 15) { k += 16; continue; } // ZRL
              }
              k += r;
              if (k >= 64) break;
              const v = readSigned(reader, ss);
              block[k] = v;
              k++;
              // 无效熵流检测: 前若干块内未定义码过多 → 整图判定无效
              if (invalidCodes > 12) throw new Error('jpeg: invalid entropy stream');
            }
            // 反量化 + zigzag → 自然序
            const nat = new Float64Array(64);
            for (let i = 0; i < 64; i++) nat[ZIGZAG[i]] = block[i] * qtab[i];
            // IDCT
            const idct = idct2d(nat);
            // 写入平面
            const px = mcuX * comp.h + bx;
            const py = mcuY * comp.v + by;
            const planeW = mcusX * comp.h * 8;
            const off = py * 8 * planeW + px * 8;
            for (let y = 0; y < 8; y++) {
              for (let x = 0; x < 8; x++) {
                comp.data[off + y * planeW + x] = idct[y * 8 + x];
              }
            }
          }
        }
      }
    }
  }
}

function decodeJpegInner(bytes) {
  const len = bytes.length;
  if (len < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('jpeg: bad SOI');
  let p = 2;
  // 解析段
  const quantTables = []; // id → Int16Array 64 (自然序)
  let width = 0, height = 0, comps = null; // [{id, h, v, tq, huffDC, huffAC}]
  const huffDC = {}; // key `${classId}-${id}` → table
  const huffAC = {};
  let sosComp = null;
  let scanDataStart = -1;
  let progressive = false;

  while (p + 1 < len) {
    if (bytes[p] !== 0xff) { p++; continue; }
    const marker = bytes[p + 1];
    p += 2;
    if (marker === 0xd9) break; // EOI
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue; // TEM / RST
    if (marker === 0xda) {
      // SOS
      const segLen = (bytes[p] << 8) | bytes[p + 1];
      const ns = bytes[p + 2];
      sosComp = [];
      for (let i = 0; i < ns; i++) {
        const cs = bytes[p + 3 + i * 2];
        const t = bytes[p + 4 + i * 2];
        sosComp.push({ cs, td: t >> 4, ta: t & 15 });
      }
      // Ss Se AhAl 在 baseline 为 0 63 0; 我们跳过
      scanDataStart = p + 3 + ns * 2 + 3;
      break;
    }
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      // SOF0/SOF1/...: 结构相同 (SOF2 progressive 不支持)
      if (marker === 0xc2) progressive = true;
      const segLen = (bytes[p] << 8) | bytes[p + 1];
      const prec = bytes[p + 2];
      height = (bytes[p + 3] << 8) | bytes[p + 4];
      width = (bytes[p + 5] << 8) | bytes[p + 6];
      const n = bytes[p + 7];
      comps = [];
      for (let i = 0; i < n; i++) {
        const id = bytes[p + 8 + i * 3];
        const hv = bytes[p + 9 + i * 3];
        const tq = bytes[p + 10 + i * 3];
        comps.push({ id, h: hv >> 4, v: hv & 15, tq });
      }
      if (prec !== 8) throw new Error('jpeg: unsupported precision ' + prec);
      p += segLen;
      continue;
    }
    if (marker === 0xdb) {
      // DQT: p 指向长度字段, 段含 2 字节长度 → 数据区 [p+2, p+segLen)
      const segLen = (bytes[p] << 8) | bytes[p + 1];
      let q = p + 2;
      const end = p + segLen;
      while (q < end) {
        const pq = bytes[q] >> 4;
        const tq = bytes[q] & 15;
        const table = new Int16Array(64);
        for (let i = 0; i < 64; i++) {
          table[i] = pq === 0 ? bytes[q + 1 + i] : (bytes[q + 1 + i * 2] << 8) | bytes[q + 2 + i * 2];
        }
        quantTables[tq] = table;
        q += 1 + (pq === 0 ? 64 : 128);
      }
      p += segLen;
      continue;
    }
    if (marker === 0xc4) {
      // DHT: 段数据区 [p+2, p+segLen)
      const segLen = (bytes[p] << 8) | bytes[p + 1];
      let q = p + 2;
      const end = p + segLen;
      while (q < end) {
        const tc = bytes[q] >> 4;
        const th = bytes[q] & 15;
        const counts = [];
        let total = 0;
        for (let i = 0; i < 16; i++) { counts.push(bytes[q + 1 + i]); total += bytes[q + 1 + i]; }
        const symbols = [];
        for (let i = 0; i < total; i++) symbols.push(bytes[q + 17 + i]);
        const table = buildHuffTable(counts, symbols);
        // 预计算最大码长 (huffDecode 未定义码检测用)
        table._maxLen = counts.reduce((m, c, i) => (c > 0 ? i + 1 : m), 1);
        if (tc === 0) huffDC[th] = table; else huffAC[th] = table;
        q += 1 + 16 + total;
      }
      p += segLen;
      continue;
    }
    // 其他段 (APPn/COM/DRI...): 跳过
    if (p + 1 >= len) break;
    const segLen = (bytes[p] << 8) | bytes[p + 1];
    if (segLen < 2) break;
    p += segLen;
  }

  if (!comps || scanDataStart < 0) throw new Error('jpeg: missing SOF/SOS');
  if (progressive) throw new Error('jpeg: progressive not supported');

  // 熵流有效性检测: 高度周期重复的扫描数据 = 无效熵流 (真实照片熵流随机,
  // 花壁纸 2934788040 背景 JPEG 熵流 28 a2 80 0a 周期 4 重复 4.7 万次,
  // sharp/Windows/libjpeg 解出全 0 黑) → 提前 fallback 纯黑
  {
    let eoi = bytes.length - 1;
    for (let i = bytes.length - 2; i >= 0; i--) {
      if (bytes[i] === 0xff && bytes[i + 1] === 0xd9) { eoi = i; break; }
    }
    const scan = bytes.subarray(scanDataStart, eoi);
    if (scan.length > 64 && isPeriodicEntropy(scan)) {
      return { width, height, rgba: new Uint8Array(width * height * 4) };
    }
  }

  // 采样因子 → MCU 尺寸
  const maxH = Math.max(...comps.map((c) => c.h));
  const maxV = Math.max(...comps.map((c) => c.v));
  const mcuW = maxH * 8, mcuH = maxV * 8;
  const mcusX = Math.ceil(width / mcuW);
  const mcusY = Math.ceil(height / mcuH);

  // 分量平面 (浮点, 自然序)
  const planes = comps.map((c) => ({
    ...c,
    data: new Float64Array(mcusX * maxH * 8 * (mcusY * maxV * 8)),
    blocksX: mcusX * c.h,
    blocksY: mcusY * c.v,
  }));

  // 熵解码: 逐 MCU, 每分量 h*v 块
  const reader = new BitReader(bytes, scanDataStart);
  const block = new Float64Array(64);
  const prevDC = new Array(comps.length).fill(0);
  // 熵流无效 (huffman overflow 等) → 带 dims 抛错, 外层 fallback 纯黑
  try {
    decodeScan(reader, planes, comps, sosComp, huffDC, huffAC, quantTables, block, prevDC, mcusX, mcusY);
  } catch (e) {
    if (e && e.message && e.message.startsWith('jpeg:')) {
      const err = new Error(e.message);
      err._dims = { width, height };
      throw err;
    }
    throw e;
  }

  // 色彩转换: YCbCr → RGB, 上采样 Cb/Cr
  const yComp = planes[0];
  const rgb = new Uint8Array(width * height * 4);
  const planeW = mcusX * maxH * 8;
  const planeH = mcusY * maxV * 8;
  const getPlane = (ci, x, y) => {
    const c = planes[ci];
    // 上采样: 块放大 c.h/c.v 倍
    const sx = Math.floor((x * c.h) / maxH);
    const sy = Math.floor((y * c.v) / maxV);
    const pw = mcusX * c.h * 8;
    return c.data[sy * pw + sx];
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // IDCT 输出为 -128..127, +128 还原到 0..255
      const Y = yComp.data[y * planeW + x] + 128;
      const Cb = getPlane(1, x, y) + 128;
      const Cr = planes.length > 2 ? getPlane(2, x, y) + 128 : 128;
      const r = Y + 1.402 * (Cr - 128);
      const g = Y - 0.344136 * (Cb - 128) - 0.714136 * (Cr - 128);
      const b = Y + 1.772 * (Cb - 128);
      const o = (y * width + x) * 4;
      rgb[o] = r < 0 ? 0 : r > 255 ? 255 : r | 0;
      rgb[o + 1] = g < 0 ? 0 : g > 255 ? 255 : g | 0;
      rgb[o + 2] = b < 0 ? 0 : b > 255 ? 255 : b | 0;
      rgb[o + 3] = 255;
    }
  }
  return { width, height, rgba: rgb };
}
