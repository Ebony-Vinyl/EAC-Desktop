// WE 渲染引擎 — MDL 网格解析 (puppet 80B + 静态 MDLV0004/0014)
// 静态 MDL 结构: "MDLVxxxx" + 头部 + "materials/....json\0" + u32 标志 + u32 顶点字节数
//       + 顶点流 (stride 32: pos/normal/uv; stride 56: +tangent+uv2) + u32 索引字节数 + u16 索引
import { v3sub, v3cross, v3norm, v3dot } from './math.js';

// ── puppet MDL (80 字节 stride, 含骨骼蒙皮) ─────────────────────
export function parseMdlPuppet(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let mdlsOffset = buf.length;
  for (let off = 9; off + 4 < buf.length; off++) {
    if (buf[off] === 0x4d && buf[off+1] === 0x44 && buf[off+2] === 0x4c && buf[off+3] === 0x53) { mdlsOffset = off; break; }
  }
  let found = null;
  for (let offset = 9; offset + 12 < mdlsOffset; offset++) {
    const vertexBytes = dv.getUint32(offset + 4, true);
    const verticesOffset = offset + 8;
    if (vertexBytes === 0 || vertexBytes % 80 !== 0) continue;
    const indexLenOffset = verticesOffset + vertexBytes;
    if (indexLenOffset + 4 > mdlsOffset) continue;
    const indexBytes = dv.getUint32(indexLenOffset, true);
    const indicesOffset = indexLenOffset + 4;
    if (indexBytes === 0 || indexBytes % 2 !== 0 || indicesOffset + indexBytes > mdlsOffset) continue;
    found = { verticesOffset, vertexBytes, indicesOffset, indexBytes };
    break;
  }
  if (!found) return null;
  const vertexCount = found.vertexBytes / 80;
  const indexCount = found.indexBytes / 2;
  const positions = [], uvs = [];
  for (let i = 0; i < vertexCount; i++) {
    const vo = found.verticesOffset + i * 80;
    positions.push([dv.getFloat32(vo, true), dv.getFloat32(vo + 4, true), dv.getFloat32(vo + 8, true)]);
    uvs.push([dv.getFloat32(vo + 72, true), dv.getFloat32(vo + 76, true)]);
  }
  const indices = [];
  for (let i = 0; i < indexCount; i++) indices.push(dv.getUint16(found.indicesOffset + i * 2, true));
  return { positions, uvs, indices, vertexCount, indexCount };
}

function _indexOfBytes(buf, str, from) {
  const needle = Buffer.from(str, 'ascii');
  for (let i = from; i + needle.length <= buf.length; i++) {
    let ok = true;
    for (let k = 0; k < needle.length; k++) if (buf[i + k] !== needle[k]) { ok = false; break; }
    if (ok) return i;
  }
  return -1;
}

// ── 静态 MDLV 解析 (多 UV 通道 + 法线对齐评分选 stride) ─────────
export function parseMdlStatic(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (buf.length < 16 || buf.toString('ascii', 0, 4) !== 'MDLV') return null;
  const matStart = _indexOfBytes(buf, 'materials/', 8);
  if (matStart < 0) return null;
  let matEnd = matStart;
  while (matEnd < buf.length && buf[matEnd] !== 0) matEnd++;
  const materialPath = buf.toString('utf8', matStart, matEnd);
  const f0 = dv.getUint32(matEnd + 1, true);
  const vertBytes = dv.getUint32(matEnd + 5, true);
  const vertStart = matEnd + 9;
  if (vertBytes <= 0 || vertBytes > buf.length || vertStart + vertBytes > buf.length) return null;
  const cands = [];
  for (const stride of [64, 48, 32, 40, 44, 56]) {
    if (vertBytes % stride !== 0) continue;
    const vc = vertBytes / stride;
    if (vc < 3 || vc > 100000) continue;
    let normOk = 0, n = 0;
    for (let i = 0; i < Math.min(vc, 300); i++) {
      const o = vertStart + i * stride;
      const nx = dv.getFloat32(o + 12, true), ny = dv.getFloat32(o + 16, true), nz = dv.getFloat32(o + 20, true);
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (Math.abs(l - 1) < 0.1) normOk++;
      n++;
    }
    if (normOk < n * 0.6) continue;
    const idxBytesPos = vertStart + vertBytes;
    const idxBytesT = dv.getUint32(idxBytesPos, true);
    const idxStartT = idxBytesPos + 4;
    let idxAllOk = false;
    if (idxBytesT > 0 && idxBytesT % 2 === 0 && idxStartT + idxBytesT <= buf.length + 1) {
      const ic = idxBytesT / 2;
      if (ic > 0 && ic % 3 === 0 && ic < 300000) {
        let ok = 0;
        for (let k = 0; k < Math.min(ic, 400); k++) {
          if (dv.getUint16(idxStartT + k * 2, true) < vc) ok++;
        }
        idxAllOk = ok > Math.min(ic, 400) * 0.98;
      }
    }
    let align = 0, an = 0;
    if (idxAllOk) {
      for (let k = 0; k + 2 < Math.min(idxBytesT / 2, 3000); k += 3) {
        const a = dv.getUint16(idxStartT + k * 2, true), b = dv.getUint16(idxStartT + k * 2 + 2, true), c = dv.getUint16(idxStartT + k * 2 + 4, true);
        if (a >= vc || b >= vc || c >= vc) continue;
        const pa = [dv.getFloat32(vertStart + a * stride, true), dv.getFloat32(vertStart + a * stride + 4, true), dv.getFloat32(vertStart + a * stride + 8, true)];
        const pb = [dv.getFloat32(vertStart + b * stride, true), dv.getFloat32(vertStart + b * stride + 4, true), dv.getFloat32(vertStart + b * stride + 8, true)];
        const pc = [dv.getFloat32(vertStart + c * stride, true), dv.getFloat32(vertStart + c * stride + 4, true), dv.getFloat32(vertStart + c * stride + 8, true)];
        const e1 = v3sub(pb, pa), e2 = v3sub(pc, pa);
        const fn = v3norm(v3cross(e1, e2));
        const vn = [dv.getFloat32(vertStart + a * stride + 12, true), dv.getFloat32(vertStart + a * stride + 16, true), dv.getFloat32(vertStart + a * stride + 20, true)];
        const vl = Math.sqrt(v3dot(vn, vn)) || 1;
        align += Math.abs(v3dot(fn, [vn[0] / vl, vn[1] / vl, vn[2] / vl]));
        an++;
      }
      if (an > 0) align /= an;
    }
    cands.push({ stride, vc, idxAllOk, align });
  }
  cands.sort((a, b) => (b.idxAllOk - a.idxAllOk) || (b.align - a.align));
  let chosen = cands[0];
  if (!chosen) {
    const idxBytesPos = vertStart + vertBytes;
    const idxBytesT = dv.getUint32(idxBytesPos, true);
    const idxStartT = idxBytesPos + 4;
    let ic = 0;
    if (idxBytesT > 0 && idxBytesT % 2 === 0 && idxStartT + idxBytesT <= buf.length + 1) ic = idxBytesT / 2;
    for (const stride of [20, 16, 24, 28, 36, 40, 44, 48, 56]) {
      if (vertBytes % stride !== 0) continue;
      const vc = vertBytes / stride;
      if (vc < 3 || vc > 100000) continue;
      if (ic === 0 || ic % 3 !== 0) continue;
      let idxOk = 0;
      for (let k = 0; k < Math.min(ic, 400); k++) if (dv.getUint16(idxStartT + k * 2, true) < vc) idxOk++;
      if (idxOk < Math.min(ic, 400) * 0.98) continue;
      const uvOff = stride - 8;
      let uvOk = 0, uvN = 0;
      let minX = 1e9, maxX = -1e9;
      for (let i = 0; i < Math.min(vc, 300); i++) {
        const o = vertStart + i * stride;
        const x = dv.getFloat32(o, true), y = dv.getFloat32(o + 4, true), z = dv.getFloat32(o + 8, true);
        if (!isFinite(x) || !isFinite(y) || !isFinite(z) || Math.abs(x) > 10000 || Math.abs(y) > 10000) continue;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        const u = dv.getFloat32(o + uvOff, true), v = dv.getFloat32(o + uvOff + 4, true);
        if (u >= -0.05 && u <= 1.05 && v >= -0.05 && v <= 1.05) uvOk++;
        uvN++;
      }
      if (uvN > 0 && uvOk > uvN * 0.6) { chosen = { stride, vc, hasNormals: false }; break; }
    }
  }
  if (!chosen) return null;
  const { stride, vc, hasNormals } = chosen;
  const positions = [], normals = [], uvs = [], uv2s = [];
  const hasN = hasNormals !== false;
  // UV 布局 (引擎 vertex): 主纹理 UV1 在 stride 末尾 (stride-8);
  // 第 2 UV (lightmap) 仅 stride 56 有 (uv2@stride-16)
  const uvOff = stride === 64 ? 36 : stride - 8;
  let uv2Off = -1;
  if (stride === 56) {
    const p = stride - 16;
    let ok = 0, n = 0;
    for (let i = 0; i < Math.min(vc, 150); i++) {
      const o = vertStart + i * stride;
      const u = dv.getFloat32(o + p, true), v = dv.getFloat32(o + p + 4, true);
      if (u >= -0.05 && u <= 1.05 && v >= -0.05 && v <= 1.05) ok++;
      n++;
    }
    if (ok / n > 0.7) uv2Off = p;
  }
  for (let i = 0; i < vc; i++) {
    const o = vertStart + i * stride;
    positions.push([dv.getFloat32(o, true), dv.getFloat32(o + 4, true), dv.getFloat32(o + 8, true)]);
    normals.push(hasN ? [dv.getFloat32(o + 12, true), dv.getFloat32(o + 16, true), dv.getFloat32(o + 20, true)] : null);
    uvs.push([dv.getFloat32(o + uvOff, true), dv.getFloat32(o + uvOff + 4, true)]);
    uv2s.push(uv2Off >= 0 ? [dv.getFloat32(o + uv2Off, true), dv.getFloat32(o + uv2Off + 4, true)] : null);
  }
  const idxBytesPos = vertStart + vertBytes;
  const idxBytes = dv.getUint32(idxBytesPos, true);
  const idxStart = idxBytesPos + 4;
  if (idxBytes <= 0 || idxBytes % 2 !== 0 || idxStart + idxBytes > buf.length + 1) return null;
  const indices = [];
  for (let i = 0; i < idxBytes / 2; i++) indices.push(dv.getUint16(idxStart + i * 2, true));
  return { positions, normals, uvs, uv2s, indices, materialPath, stride, vertexCount: vc, indexCount: indices.length };
}
