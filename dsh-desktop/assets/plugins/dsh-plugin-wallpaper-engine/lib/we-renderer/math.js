// WE 渲染引擎 — 数学与值解析工具 (纯函数, 无状态)
// mat4 列主序 (gl-matrix 约定: v' = M * v)

// ── 值解析 (scene.json 字符串形式) ─────────────────────────────
export function parseVec3(s, def = [0, 0, 0]) {
  if (s == null) return def;
  if (typeof s === 'number') return [s, s, s];
  if (Array.isArray(s)) return [s[0] ?? def[0], s[1] ?? def[1], s[2] ?? def[2]];
  const p = String(s).trim().split(/\s+/).map(Number);
  return [p[0] ?? def[0], p[1] ?? def[1], p[2] ?? def[2]];
}
export function parseVec2(s, def = [0, 0]) {
  if (s == null) return def;
  if (typeof s === 'number') return [s, s];
  if (Array.isArray(s)) return [s[0] ?? def[0], s[1] ?? def[1]];
  const p = String(s).trim().split(/\s+/).map(Number);
  return [p[0] ?? def[0], p[1] ?? def[1]];
}
export function getVal(o, key, def) {
  const v = o && o[key];
  if (v == null) return def;
  if (typeof v === 'object' && v !== null && 'value' in v) return v.value;
  return v;
}

// ── vec3 ───────────────────────────────────────────────────────
export const v3sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const v3add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const v3cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const v3dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const v3norm = (a) => { const l = Math.sqrt(v3dot(a, a)) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// ── mat4 ───────────────────────────────────────────────────────
export function mat4Identity() { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
export function mat4Mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
    o[c * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    o[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    o[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    o[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  return o;
}
export function mat4Perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
}
export function mat4Ortho(l, r, b, t, near, far) {
  const w = r - l, h = t - b, d = far - near;
  return [2 / w, 0, 0, 0, 0, 2 / h, 0, 0, 0, 0, -2 / d, 0, -(r + l) / w, -(t + b) / h, -(far + near) / d, 1];
}
export function mat4LookAt(eye, center, up) {
  const z = v3norm(v3sub(eye, center));
  const x = v3norm(v3cross(up, z));
  const y = v3cross(z, x);
  return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -v3dot(x, eye), -v3dot(y, eye), -v3dot(z, eye), 1];
}
export function mat4FromTRS(t, r, s) {
  // 引擎事实 (lwe-CParticle.cpp:1836): m = T * Rz(-z) * Ry(y) * Rx(-x) * S
  // X/Z 角取负 (Y-flip 坐标系); 列主序
  const rx = -r[0], ry = r[1], rz = -r[2];
  const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
  const mx = [1, 0, 0, 0, 0, cx, sx, 0, 0, -sx, cx, 0, 0, 0, 0, 1];
  const my = [cy, 0, -sy, 0, 0, 1, 0, 0, sy, 0, cy, 0, 0, 0, 0, 1];
  const mz = [cz, sz, 0, 0, -sz, cz, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const rot = mat4Mul(mat4Mul(mz, my), mx);
  const m = mat4Identity();
  m[0] = rot[0] * s[0]; m[1] = rot[1] * s[0]; m[2] = rot[2] * s[0];
  m[4] = rot[4] * s[1]; m[5] = rot[5] * s[1]; m[6] = rot[6] * s[1];
  m[8] = rot[8] * s[2]; m[9] = rot[9] * s[2]; m[10] = rot[10] * s[2];
  m[12] = t[0]; m[13] = t[1]; m[14] = t[2];
  return m;
}
export function mat4TransformPoint(m, p) {
  const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
  const iw = w !== 0 ? 1 / w : 0;
  return [
    (m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12]) * iw,
    (m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13]) * iw,
    (m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]) * iw,
    w,
  ];
}
export function mat4TransformVec3(m, v) {
  return [m[0] * v[0] + m[4] * v[1] + m[8] * v[2], m[1] * v[0] + m[5] * v[1] + m[9] * v[2], m[2] * v[0] + m[6] * v[1] + m[10] * v[2]];
}
export const sat = (x) => Math.max(0, Math.min(1, x));

// ── common_blending.h ApplyBlending 的 CPU 复刻 ──────────────────
export const _c3 = (x) => [x, x, x];
export const _sat3 = (v) => [sat(v[0]), sat(v[1]), sat(v[2])];
function _rgbToHsl(c) {
  const r = c[0], g = c[1], b = c[2];
  const fmin = Math.min(r, g, b), fmax = Math.max(r, g, b);
  const delta = fmax - fmin;
  const hsl = [0, 0, (fmax + fmin) / 2];
  if (delta === 0) return hsl;
  hsl[1] = hsl[2] < 0.5 ? delta / (fmax + fmin) : delta / (2 - fmax - fmin);
  const deltaR = (((fmax - r) / 6) + delta / 2) / delta;
  const deltaG = (((fmax - g) / 6) + delta / 2) / delta;
  const deltaB = (((fmax - b) / 6) + delta / 2) / delta;
  if (r === fmax) hsl[0] = deltaB - deltaG;
  else if (g === fmax) hsl[0] = 1 / 3 + deltaR - deltaB;
  else hsl[0] = 2 / 3 + deltaG - deltaR;
  if (hsl[0] < 0) hsl[0] += 1; else if (hsl[0] > 1) hsl[0] -= 1;
  return hsl;
}
function _hueToRgb(f1, f2, hue) {
  let h = hue;
  if (h < 0) h += 1; else if (h > 1) h -= 1;
  if (6 * h < 1) return f1 + (f2 - f1) * 6 * h;
  if (2 * h < 1) return f2;
  if (3 * h < 2) return f1 + (f2 - f1) * ((2 / 3) - h) * 6;
  return f1;
}
function _hslToRgb(hsl) {
  if (hsl[1] === 0) return _c3(hsl[2]);
  const f2 = hsl[2] < 0.5 ? hsl[2] * (1 + hsl[1]) : (hsl[2] + hsl[1]) - (hsl[1] * hsl[2]);
  const f1 = 2 * hsl[2] - f2;
  return [_hueToRgb(f1, f2, hsl[0] + 1 / 3), _hueToRgb(f1, f2, hsl[0]), _hueToRgb(f1, f2, hsl[0] - 1 / 3)];
}
const _bDarken = (A, B) => [Math.min(A[0], B[0]), Math.min(A[1], B[1]), Math.min(A[2], B[2])];
const _bLighten = (A, B) => [Math.max(A[0], B[0]), Math.max(A[1], B[1]), Math.max(A[2], B[2])];
const _bScreen = (A, B) => [1 - (1 - A[0]) * (1 - B[0]), 1 - (1 - A[1]) * (1 - B[1]), 1 - (1 - A[2]) * (1 - B[2])];
const _bOverlay = (A, B) => A.map((a, i) => (a < 0.5 ? 2 * a * B[i] : 1 - 2 * (1 - a) * (1 - B[i])));
const _bSoftLight = (A, B) => A.map((a, i) => { const b = B[i]; return b < 0.5 ? 2 * a * b + a * a * (1 - 2 * b) : Math.sqrt(a) * (2 * b - 1) + 2 * a * (1 - b); });
const _bColorDodge = (A, B) => A.map((a, i) => { const b = B[i]; return b === 1 ? b : Math.min(a / (1 - b), 1); });
const _bColorBurn = (A, B) => A.map((a, i) => { const b = B[i]; return b === 0 ? b : Math.max(1 - (1 - a) / b, 0); });
const _bVividLight = (A, B) => A.map((a, i) => { const b = B[i]; return b < 0.5 ? _bColorBurn([a], [2 * b])[0] : _bColorDodge([a], [2 * (b - 0.5)])[0]; });
const _bLinearLight = (A, B) => A.map((a, i) => { const b = B[i]; return b < 0.5 ? Math.max(a + 2 * b - 1, 0) : Math.min(a + 2 * (b - 0.5), 1); });
const _bPinLight = (A, B) => A.map((a, i) => { const b = B[i]; return b < 0.5 ? Math.min(a, 2 * b) : Math.max(a, 2 * (b - 0.5)); });
const _bHardMix = (A, B) => _bVividLight(A, B).map((v) => (v < 0.5 ? 0 : 1));
const _bReflect = (A, B) => A.map((a, i) => { const b = B[i]; return b === 1 ? b : Math.min(a * a / (1 - b), 1); });
const _bPhoenix = (A, B) => A.map((a, i) => Math.min(a, B[i]) - Math.max(a, B[i]) + 1);
// ApplyBlending: A=base(原图), B=blend(效果层), opacity=混合强度
// 输出 clamp [0,1] — 官方 shader 写 framebuffer 时自动 clamp; CPU 若不 clamp,
// 负值/超限写入 Uint8Array 会模 256 回绕 (如 lightshafts mask 负 → 蓝黑色斑)
export function applyBlending(mode, A, B, opacity) {
  const mix = (a, b, o) => a.map((v, i) => v * (1 - o) + b[i] * o);
  let out;
  switch (mode) {
    case 1: out = mix(A, _bDarken(A, B), opacity); break;
    case 2: out = mix(A, A.map((v, i) => v * B[i]), opacity); break;
    case 3: out = mix(A, _bColorBurn(A, B), opacity); break;
    case 4: out = mix(A, A.map((v, i) => Math.max(v + B[i] - 1, 0)), opacity); break;
    case 5: out = _bDarken(A, B); break;
    case 6: out = mix(A, _bLighten(A, B), opacity); break;
    case 7: out = mix(A, _bScreen(A, B), opacity); break;
    case 8: out = mix(A, _bColorDodge(A, B), opacity); break;
    case 9: out = mix(A, A.map((v, i) => Math.min(v + B[i], 1)), opacity); break;
    case 10: out = _bLighten(A, B); break;
    case 11: out = mix(A, _bOverlay(A, B), opacity); break;
    case 12: out = mix(A, _bSoftLight(A, B), opacity); break;
    case 13: out = mix(A, _bOverlay(B, A), opacity); break;
    case 14: out = mix(A, _bVividLight(A, B), opacity); break;
    case 15: out = mix(A, _bLinearLight(A, B), opacity); break;
    case 16: out = mix(A, _bPinLight(A, B), opacity); break;
    case 17: out = mix(A, _bHardMix(A, B), opacity); break;
    case 18: out = mix(A, A.map((v, i) => Math.abs(v - B[i])), opacity); break;
    case 19: out = mix(A, A.map((v, i) => v + B[i] - 2 * v * B[i]), opacity); break;
    case 20: out = mix(A, A.map((v, i) => Math.max(v + B[i] - 1, 0)), opacity); break;
    case 21: out = mix(A, _bReflect(A, B), opacity); break;
    case 22: out = mix(A, _bReflect(B, A), opacity); break;
    case 23: out = mix(A, _bPhoenix(A, B), opacity); break;
    case 24: out = mix(A, A.map((v, i) => (v + B[i]) / 2), opacity); break;
    case 25: out = mix(A, A.map((v, i) => 1 - Math.abs(1 - v - B[i])), opacity); break;
    case 26: { const bs = _rgbToHsl(B), as = _rgbToHsl(A); out = mix(A, _hslToRgb([bs[0], as[1], as[2]]), opacity); break; }
    case 27: { const bs = _rgbToHsl(B), as = _rgbToHsl(A); out = mix(A, _hslToRgb([as[0], bs[1], as[2]]), opacity); break; }
    case 28: { const bs = _rgbToHsl(B), as = _rgbToHsl(A); out = mix(A, _hslToRgb([bs[0], bs[1], as[2]]), opacity); break; }
    case 29: { const bs = _rgbToHsl(B), as = _rgbToHsl(A); out = mix(A, _hslToRgb([as[0], as[1], bs[2]]), opacity); break; }
    case 30: { const t = Math.max(A[0], Math.max(A[1], A[2])); out = mix(A, _c3(t).map((v, i) => v * B[i]), opacity); break; }
    case 31: out = A.map((v, i) => v + B[i] * opacity); break;
    case 32: out = mix(A, A.map((v, i) => v + v * B[i]), opacity); break;
    default: out = mix(A, B, opacity); break;
  }
  return out.map((v) => (v < 0 ? 0 : v > 1 ? 1 : v));
}
export function _greyscale(c) { return c[0] * 0.11 + c[1] * 0.59 + c[2] * 0.3; }
export function _frac(x) { return x - Math.floor(x); }

// HSV ↔ RGB (引擎 common.h rgb2hsv/hsv2rgb)
export function rgb2hsv(c) {
  const r = c[0], g = c[1], b = c[2];
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let hsv = [0, 0, mx];
  if (d !== 0) {
    if (mx === r) hsv[0] = ((g - b) / d) % 6;
    else if (mx === g) hsv[0] = (b - r) / d + 2;
    else hsv[0] = (r - g) / d + 4;
    hsv[0] = ((hsv[0] / 6) % 1 + 1) % 1;
    hsv[1] = d / mx;
  }
  return hsv;
}
export function hsv2rgb(hsv) {
  const h = ((hsv[0] % 1) + 1) % 1, s = hsv[1], v = hsv[2];
  const i = Math.floor(h * 6), f = h * 6 - i;
  const p = v * (1 - s), q = v * (1 - f * s), tt = v * (1 - (1 - f) * s);
  const table = [[v, tt, p], [q, v, p], [p, v, tt], [p, q, v], [tt, p, v], [v, p, q]];
  return table[i % 6];
}
export function smoothstepFn(e0, e1, x) {
  const tx = sat((x - e0) / (e1 - e0));
  return tx * tx * (3 - 2 * tx);
}
