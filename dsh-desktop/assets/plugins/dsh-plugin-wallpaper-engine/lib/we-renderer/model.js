// WE 渲染引擎 — model (从 core.js 拆分, 逻辑不变)
import { v3sub, v3add, v3cross, v3dot, v3norm, mat4FromTRS, mat4TransformPoint, mat4TransformVec3, sat } from './math.js';

// ── model mixin (从 core.js 拆分, 逻辑零改动) ──
export function installModel(proto) {
  Object.assign(proto, {
    renderModel(o, t) {
        const mdlRaw = this.pkg.read(o.model);
        if (!mdlRaw) { this.log('跳过 model ' + (o.name || o.id) + ': 无 MDL'); return; }
        // MDL 静态网格解析缓存 (多帧渲染避免每帧重新解析)
        if (!this._mdlStaticCache) this._mdlStaticCache = new Map();
        let mesh = this._mdlStaticCache.get(o.model);
        if (!mesh) {
          mesh = this._parseMdlStatic(mdlRaw);
          if (!mesh) { this.log('跳过 model ' + (o.name || o.id) + ': MDL 解析失败'); return; }
          this._mdlStaticCache.set(o.model, mesh);
        }
        // 材质
        const mat = mesh.materialPath ? this.pkg.readJson(mesh.materialPath) : null;
        const pass = mat && mat.passes && mat.passes[0] ? mat.passes[0] : null;
        const shaderName = pass ? pass.shader : 'generic3';
        const uniforms = this._materialUniforms(mat, pass);
        const tex = pass && pass.textures && pass.textures.length ? this.loadTexture(pass.textures[0]) : null;
        const tex1 = pass && pass.textures[1] ? this.loadTexture(pass.textures[1]) : null;
        const tex2 = pass && pass.textures[2] ? this.loadTexture(pass.textures[2]) : null;
        const tex3 = pass && pass.textures[3] ? this.loadTexture(pass.textures[3]) : null;
        // 对象变换 → 世界
        const tr = this.resolveTransform(o);
        const worldM = mat4FromTRS(tr.origin, tr.angles || [tr.angleX || 0, tr.angleY || 0, tr.angleZ ?? tr.angle ?? 0], tr.scale);
        // 顶点变换 + 逐顶点着色
        const { positions, normals, uvs, uv2s, indices } = mesh;
        const n = positions.length;
        const vp = new Float64Array(n * 6); // x,y,w(ndc), depth(ndc.z), u, v
        const shadeData = new Float64Array(n * 8); // normal(r,g,b), lightScale, worldX, worldY, uv2(u,v)
        const vs = { shaderName, uniforms, tex, tex1, tex2, tex3, textures: (pass && pass.textures || []).map((p) => this.loadTexture(p)), textureNames: (pass && pass.textures) || [], t, combos: (pass && pass.combos) || {} };
        // 无法线网格: 用位移后顶点重算平滑法线 (neongrid 等)
        let meshNormals = normals;
        const displaced = new Array(n);
        if (!normals[0]) {
          meshNormals = new Array(n).fill(null).map(() => [0, 0, 0]);
          for (let i = 0; i < n; i++) {
            let local = positions[i];
            if (shaderName === 'core') local = this._coreVertex(local, uvs[i], t);
            else if (shaderName === 'dna') local = this._dnaVertex(local, t);
            else if (shaderName === 'neongrid') local = this._neonGridVertex(local, uvs[i], t, uniforms.mountainscale ?? 1);
            displaced[i] = local;
          }
          for (let k = 0; k + 2 < indices.length; k += 3) {
            const a = indices[k], b = indices[k + 1], c = indices[k + 2];
            const pa = displaced[a], pb = displaced[b], pc = displaced[c];
            const e1 = v3sub(pb, pa), e2 = v3sub(pc, pa);
            const fn = v3cross(e1, e2);
            meshNormals[a][0] += fn[0]; meshNormals[a][1] += fn[1]; meshNormals[a][2] += fn[2];
            meshNormals[b][0] += fn[0]; meshNormals[b][1] += fn[1]; meshNormals[b][2] += fn[2];
            meshNormals[c][0] += fn[0]; meshNormals[c][1] += fn[1]; meshNormals[c][2] += fn[2];
          }
          for (let i = 0; i < n; i++) meshNormals[i] = v3norm(meshNormals[i]);
        }
        for (let i = 0; i < n; i++) {
          let local = positions[i];
          if (shaderName === 'core') local = this._coreVertex(local, uvs[i], t);
          else if (shaderName === 'dna') local = this._dnaVertex(local, t);
          else if (shaderName === 'neongrid') local = this._neonGridVertex(local, uvs[i], t, uniforms.mountainscale ?? 1);
          let clip;
          if (shaderName === 'bg') {
            // bg.vert: gl_Position = vec4(uv*2-1, 0.5, 1) — 由 UV 生成, 忽略模型/相机
            clip = [uvs[i][0] * 2 - 1, uvs[i][1] * 2 - 1, 0.5, 1];
          } else if (shaderName === 'cloudsbg') {
            // cloudsbg.vert: gl_Position = vec4(a_Position, 1.0) — 网格位置即 clip 坐标
            clip = [local[0], local[1], 0.5, 1];
          } else {
            const wp = mat4TransformPoint(worldM, local);
            clip = mat4TransformPoint(this.camVP, wp); // 已做透视除法: [ndcX, ndcY, ndcZ, w]
            shadeData[i * 8 + 3] = wp[0]; shadeData[i * 8 + 4] = wp[1]; shadeData[i * 8 + 5] = wp[2];
          }
          const sx = (clip[0] * 0.5 + 0.5) * this.W;
          const sy = (0.5 - clip[1] * 0.5) * this.H;
          vp[i * 6] = sx; vp[i * 6 + 1] = sy; vp[i * 6 + 2] = clip[3]; vp[i * 6 + 3] = clip[2];
          vp[i * 6 + 4] = uvs[i][0]; vp[i * 6 + 5] = uvs[i][1];
          const srcN = meshNormals[i];
          const wn = srcN ? v3norm(mat4TransformVec3(worldM, srcN)) : [0, 0, 1];
          shadeData[i * 8] = wn[0]; shadeData[i * 8 + 1] = wn[1]; shadeData[i * 8 + 2] = wn[2];
          // 第 2 UV 通道 (lightmap) — 透视校正插值
          if (uv2s && uv2s[i]) {
            shadeData[i * 8 + 6] = uv2s[i][0]; shadeData[i * 8 + 7] = uv2s[i][1];
          }
        }
        // 光栅化 (z-buffer + 透视校正插值 + 每像素 shader)
        const blending = pass ? (pass.blending || 'opaque') : 'opaque';
        const depthWrite = !(pass && pass.depthwrite === 'disabled');
        this._rasterizeMesh3D(indices, vp, shadeData, vs, blending, depthWrite);
      }
    
      // core.vert 顶点位移 (audio=0, g_Time=t): localPos += localPos * step(0,uv.x) * anims.y * 0.5
,
    _coreVertex(local, uv, t) {
        const period = Math.PI * 4;
        const a = t * 0.4, cs = Math.cos(a), sn = Math.sin(a);
        const rx = cs * uv[0] - sn * uv[1], ry = sn * uv[0] + cs * uv[1];
        const animsY = sat(Math.sin((rx + ry) * period + t));
        const stepX = uv[0] >= 0 ? 1 : 0;
        return [local[0] + local[0] * stepX * animsY * 0.5, local[1] + local[1] * stepX * animsY * 0.5, local[2] + local[2] * stepX * animsY * 0.5];
      }
    
      // dna.vert: y 偏移 + xz 旋转 (螺旋动画)
,
    _dnaVertex(local, t) {
        const timeOffset = (t * 0.1) % 1;
        const y = local[1] + timeOffset * 0.5;
        const rot = timeOffset * Math.PI;
        const c = Math.cos(rot), s = Math.sin(rot);
        return [local[0] * c - local[2] * s, y, local[0] * s + local[2] * c];
      }
    
      // neongrid.vert: fbm 山体位移 (完全照搬 shader 数学)
,
    _neonGridVertex(local, uv, t, mountainScale) {
        const fract = (x) => x - Math.floor(x);
        const rand = (n0, n1) => {
          const d = n0 * 12.9898 + n1 * 4.1414;
          return fract(Math.sin(d) * 43758.5453);
        };
        const noise2 = (px, py) => {
          const ipx = Math.floor(px), ipy = Math.floor(py);
          let ux = px - ipx, uy = py - ipy;
          ux = ux * ux * (3 - 2 * ux);
          uy = uy * uy * (3 - 2 * uy);
          const a = rand(ipx, ipy) + (rand(ipx + 1, ipy) - rand(ipx, ipy)) * ux;
          const b = rand(ipx, ipy + 1) + (rand(ipx + 1, ipy + 1) - rand(ipx, ipy + 1)) * ux;
          const res = a + (b - a) * uy;
          return res * res;
        };
        const fbm = (x0, y0) => {
          let v = 0, a = 0.5, px = x0, py = y0;
          const c = Math.cos(0.5), s = Math.sin(0.5);
          for (let i = 0; i < 5; i++) {
            v += a * noise2(px, py);
            const nx = (c * px - s * py) * 2 + 100;
            const ny = (s * px + c * py) * 2 + 100;
            px = nx; py = ny;
            a *= 0.5;
          }
          return v;
        };
        const speed = t * 2;
        const gridPosX = Math.floor(uv[0] * 50);
        const gridPosY = Math.floor(uv[1] * 50 + speed);
        const dampenDistance = Math.abs(uv[0] * 2 - 1);
        const fallOffSides = Math.pow(1.05 - dampenDistance, 0.5);
        const fallOffCenter = 0.2 + 0.8 * Math.pow(dampenDistance, 2);
        const speedFrac = fract(speed) / 50;
        const dampenY = uv[1] - speedFrac;
        const clipCenter = sat(0.8 - dampenDistance);
        const ms = mountainScale != null ? mountainScale : 1;
        let offsetY = Math.max(0, fbm(gridPosX * 0.1, gridPosY * 0.1) * 2 - clipCenter) * fallOffCenter * ms;
        offsetY = offsetY * fallOffSides * dampenY + Math.pow(dampenDistance, 2) * 0.02;
        return [local[0], local[1] + offsetY, local[2] - speedFrac * 2];
      }
    
      // ── 3D 光栅化: 透视校正 UV/法线/世界坐标 + z-buffer + 每像素 CPU shader ──
,
    _rasterizeMesh3D(indices, vp, sd, vs, blending, depthWrite = true) {
        const W = this.W, H = this.H;
        const canvas = this.canvas;
        const zbuf = canvas.zbuf;
        const shade = this._makeShadeFn(vs);
        for (let tIdx = 0; tIdx + 2 < indices.length; tIdx += 3) {
          // vp 每顶点 6 值, sd 每顶点 8 值 — 分开索引
          const vi0 = indices[tIdx] * 6, vi1 = indices[tIdx + 1] * 6, vi2 = indices[tIdx + 2] * 6;
          const i0 = indices[tIdx] * 8, i1 = indices[tIdx + 1] * 8, i2 = indices[tIdx + 2] * 8;
          const x0 = vp[vi0], y0 = vp[vi0 + 1], w0 = vp[vi0 + 2], d0 = vp[vi0 + 3], u0 = vp[vi0 + 4], v0 = vp[vi0 + 5];
          const x1 = vp[vi1], y1 = vp[vi1 + 1], w1 = vp[vi1 + 2], d1 = vp[vi1 + 3], u1 = vp[vi1 + 4], v1 = vp[vi1 + 5];
          const x2 = vp[vi2], y2 = vp[vi2 + 1], w2 = vp[vi2 + 2], d2 = vp[vi2 + 3], u2 = vp[vi2 + 4], v2 = vp[vi2 + 5];
          // 双面渲染: 不按绕序剔除 (不同模型文件绕序约定不一致, 且引擎对无 cullmode
          // 材质默认不剔除); 背面三角的法线翻转以保证光照方向正确 (two-sided lighting)
          const e1x = x1 - x0, e1y = y1 - y0, e2x = x2 - x0, e2y = y2 - y0;
          const cross = e1x * e2y - e1y * e2x;
          if (Math.abs(cross) < 1e-9) continue;
          const backface = cross < 0;
          const bx0 = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
          const bx1 = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2)));
          const by0 = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
          const by1 = Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2)));
          if (bx1 < bx0 || by1 < by0) continue;
          // 顶点着色属性 (法线/世界坐标) 用于透视校正插值
          for (let py = by0; py <= by1; py++) {
            for (let px = bx0; px <= bx1; px++) {
              const pxc = px + 0.5, pyc = py + 0.5;
              const la = ((x1 - pxc) * (y2 - pyc) - (y1 - pyc) * (x2 - pxc)) / cross;
              const lb = ((x2 - pxc) * (y0 - pyc) - (y2 - pyc) * (x0 - pxc)) / cross;
              const lc = ((x0 - pxc) * (y1 - pyc) - (y0 - pyc) * (x1 - pxc)) / cross;
              if (la < -1e-4 || lb < -1e-4 || lc < -1e-4) continue;
              // 透视校正: 插值 1/w, u/w, v/w
              const iw0 = 1 / w0, iw1 = 1 / w1, iw2 = 1 / w2;
              const iw = la * iw0 + lb * iw1 + lc * iw2;
              const u = (la * u0 * iw0 + lb * u1 * iw1 + lc * u2 * iw2) / iw;
              const v = (la * v0 * iw0 + lb * v1 * iw1 + lc * v2 * iw2) / iw;
              const depth = la * d0 + lb * d1 + lc * d2;
              const di = py * W + px;
              if (depth >= zbuf[di]) continue;
              // 插值法线/世界坐标
              let nx = la * sd[i0] + lb * sd[i1] + lc * sd[i2];
              let ny = la * sd[i0 + 1] + lb * sd[i1 + 1] + lc * sd[i2 + 1];
              let nz = la * sd[i0 + 2] + lb * sd[i1 + 2] + lc * sd[i2 + 2];
              const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
              nx /= nl; ny /= nl; nz /= nl;
              if (backface) { nx = -nx; ny = -ny; nz = -nz; }
              const wx = la * sd[i0 + 3] + lb * sd[i1 + 3] + lc * sd[i2 + 3];
              const wy = la * sd[i0 + 4] + lb * sd[i1 + 4] + lc * sd[i2 + 4];
              const wz = la * sd[i0 + 5] + lb * sd[i1 + 5] + lc * sd[i2 + 5];
              // 第 2 UV (lightmap): 透视校正插值 (若 mesh 无 uv2, sd 为 0 → 用 uv1 兜底)
              const lmU0 = sd[i0 + 6] || 0, lmV0 = sd[i0 + 7] || 0;
              const lmU1 = sd[i1 + 6] || 0, lmV1 = sd[i1 + 7] || 0;
              const lmU2 = sd[i2 + 6] || 0, lmV2 = sd[i2 + 7] || 0;
              const hasUv2 = lmU0 !== 0 || lmU1 !== 0 || lmU2 !== 0 || lmV0 !== 0 || lmV1 !== 0 || lmV2 !== 0;
              const lmU = hasUv2 ? (la * lmU0 * iw0 + lb * lmU1 * iw1 + lc * lmU2 * iw2) / iw : u;
              const lmV = hasUv2 ? (la * lmV0 * iw0 + lb * lmV1 * iw1 + lc * lmV2 * iw2) / iw : v;
              const col = shade(u, v, [wx, wy, wz], [nx, ny, nz], this.camEye, lmU, lmV, px / W, py / H);
              if (!col || col[3] <= 0.003) continue;
              const di4 = di * 4;
              if (blending === 'opaque') {
                if (depthWrite) zbuf[di] = depth;
                canvas.data[di4] = Math.round(col[0] * 255);
                canvas.data[di4 + 1] = Math.round(col[1] * 255);
                canvas.data[di4 + 2] = Math.round(col[2] * 255);
                canvas.data[di4 + 3] = 255;
              } else if (blending === 'additive') {
                // additive: dst += src*srcA (D3D SRC_ALPHA / ONE), 不覆盖已有颜色
                if (depthWrite) zbuf[di] = depth;
                const sa = Math.min(1, col[3]);
                canvas.data[di4] = Math.min(255, canvas.data[di4] + Math.round(col[0] * 255 * sa));
                canvas.data[di4 + 1] = Math.min(255, canvas.data[di4 + 1] + Math.round(col[1] * 255 * sa));
                canvas.data[di4 + 2] = Math.min(255, canvas.data[di4 + 2] + Math.round(col[2] * 255 * sa));
                canvas.data[di4 + 3] = Math.max(canvas.data[di4 + 3], 255);
              } else {
                const a = Math.min(1, col[3]);
                const dstA = canvas.data[di4 + 3] / 255;
                const outA = a + dstA * (1 - a);
                if (outA <= 0) continue;
                if (depthWrite) zbuf[di] = depth;
                canvas.data[di4] = Math.round((col[0] * 255 * a + canvas.data[di4] * dstA * (1 - a)) / outA);
                canvas.data[di4 + 1] = Math.round((col[1] * 255 * a + canvas.data[di4 + 1] * dstA * (1 - a)) / outA);
                canvas.data[di4 + 2] = Math.round((col[2] * 255 * a + canvas.data[di4 + 2] * dstA * (1 - a)) / outA);
                canvas.data[di4 + 3] = Math.round(outA * 255);
              }
            }
          }
        }
      }
    
      // CPU shader 分派: 返回 (u, v, worldPos, normal, eye) => [r,g,b,a]
,
    _makeShadeFn(vs) {
        const { shaderName, uniforms, tex, tex1, tex2, t } = vs;
        if (shaderName === 'core') return (u, v, wp, n, eye) => this._shadeCore(u, v, wp, n, eye, uniforms, t);
        if (shaderName === 'backgroundsphere') return (u, v, wp, n, eye) => this._shadeBgSphere(u, v, uniforms, tex, tex1, tex2, t);
        if (shaderName === 'dna') return (u, v, wp, n, eye) => this._shadeDna(u, v, wp, n, eye, uniforms, tex, t);
        if (shaderName === 'bg') return (u, v, wp, n, eye) => this._shadeBg(u, v, uniforms, tex, tex1, t, vs.combos);
        if (shaderName === 'curve') return (u, v, wp, n, eye) => this._shadeCurve(u, v, uniforms, tex, t);
        if (shaderName === 'neonsun') return (u, v, wp, n, eye) => this._shadeNeonSun(u, v, uniforms, t);
        if (shaderName === 'neongrid') return (u, v, wp, n, eye) => this._shadeNeonGrid(u, v, wp, n, uniforms, t);
        if (shaderName === 'cloudsbg') return (u, v, wp, n, eye) => this._shadeCloudsBg(u, v, uniforms, tex1, t);
        if (shaderName === 'flowimage') return (u, v, wp, n, eye) => this._shadeFlowImage(u, v, uniforms, vs.textures, vs.textureNames, t);
        return (u, v, wp, n, eye, u2, v2, su, sv) => this._shadeGeneric(u, v, wp, n, eye, uniforms, vs.textures, t, vs.combos, u2, v2, su, sv);
      }
    
      // flowimage.frag (官方 shader 源码): flowmask RG 方向 → 双相位循环偏移 → mix 两帧
      // 多层变体: textures = [flowmask, layer_2, layer_1, layer_0], 多层各自速度
,
    _shadeFlowImage(u, v, uniforms, textures, texNames, t) {
        const bright = uniforms.Bright != null ? uniforms.Bright : 1;
        const amp = uniforms.Amount != null ? uniforms.Amount : 1;
        const power = uniforms.Power != null ? uniforms.Power : 1;
        const alpha = uniforms.Alpha != null ? uniforms.Alpha : 1;
        // flowmask 位置判断: 纹理名含 flowmask 的是方向图
        const names = texNames || [];
        const flowIdx = names.findIndex((n) => n && n.toLowerCase().includes('flowmask'));
        const flowTex = flowIdx >= 0 ? textures[flowIdx] : (textures[1] || textures[0]);
        const layers = textures.filter((t, i) => t && i !== flowIdx && i !== (flowIdx === 0 ? -1 : 0));
        if (!flowTex) return [0, 0, 0, 0];
        const f = this._texSample(flowTex, u, v);
        const maskX = (f[0] - 0.506) * 2, maskY = (f[1] - 0.482) * 2;
        const sampleFlow = (tex, speed) => {
          const cyc1 = ((t * speed) % 1 + 1) % 1, cyc2 = (((t * speed + 0.5) % 1) + 1) % 1;
          const blend = 2 * Math.abs(cyc1 - 0.5);
          const o1x = maskX * amp * 0.1 * cyc1, o1y = maskY * amp * 0.1 * cyc1;
          const o2x = maskX * amp * 0.1 * cyc2, o2y = maskY * amp * 0.1 * cyc2;
          const s1 = this._texSample(tex, u + o1x, v + o1y);
          const s2 = this._texSample(tex, u + o2x, v + o2y);
          return [
            s1[0] + (s2[0] - s1[0]) * blend,
            s1[1] + (s2[1] - s1[1]) * blend,
            s1[2] + (s2[2] - s1[2]) * blend,
          ];
        };
        let r, g, b;
        if (layers.length) {
          // 多层: 各自速度 (Speed0/1/2; 单层用 Speed)
          const speeds = [uniforms.Speed0, uniforms.Speed1, uniforms.Speed2, uniforms.Speed];
          r = 0; g = 0; b = 0;
          for (let i = 0; i < layers.length; i++) {
            const sp = speeds[i] != null ? speeds[i] : 0.01;
            const c = sampleFlow(layers[i], sp);
            const w = Math.pow(0.5 + 0.5 * Math.min(1, Math.abs(maskX) + Math.abs(maskY)), power);
            r += c[0] * w; g += c[1] * w; b += c[2] * w;
          }
          const inv = 1 / layers.length;
          r *= inv; g *= inv; b *= inv;
        } else {
          r = 0; g = 0; b = 0;
        }
        return [sat(r * bright), sat(g * bright), sat(b * bright), alpha];
      }
    
      // dna.frag: albedo = tint * tex; rimlight = 1 - dot(V,N); albedo *= 1 + rimlight
,
    _shadeDna(u, v, wp, n, eye, uniforms, tex, t) {
        const tint = uniforms.tint ? (typeof uniforms.tint === 'number' ? [uniforms.tint, uniforms.tint, uniforms.tint] : uniforms.tint) : [0.5, 0.5, 0.5];
        let texRgb = [1, 1, 1];
        if (tex) {
          const x = ((u % 1) + 1) % 1, y = ((v % 1) + 1) % 1;
          const sx = Math.min(tex.width - 1, Math.max(0, Math.floor(x * tex.width)));
          const sy = Math.min(tex.height - 1, Math.max(0, Math.floor(y * tex.height)));
          const i = (sy * tex.width + sx) * 4;
          texRgb = [tex.rgba[i] / 255, tex.rgba[i + 1] / 255, tex.rgba[i + 2] / 255];
        }
        const viewDir = v3norm(v3sub(eye, wp));
        const rim = 1 - Math.max(-1, Math.min(1, v3dot(viewDir, v3norm(n))));
        const f = 1 + rim;
        return [sat(tint[0] * texRgb[0] * f), sat(tint[1] * texRgb[1] * f), sat(tint[2] * texRgb[2] * f), 1];
      }
    
      // bg.frag: 云 + 暗角 + 图案 (全屏背景)
,
    _shadeBg(u, v, uniforms, tex0, tex1, t, combos) {
        const tint = uniforms.tint ? (typeof uniforms.tint === 'number' ? [uniforms.tint, uniforms.tint, uniforms.tint] : uniforms.tint) : [0.5, 0.5, 0.5];
        const tint2 = uniforms.tint2 ? (typeof uniforms.tint2 === 'number' ? [uniforms.tint2, uniforms.tint2, uniforms.tint2] : uniforms.tint2) : [0.5, 0.5, 0.5];
        const sm = (e0, e1, x) => { const tx = sat((x - e0) / (e1 - e0)); return tx * tx * (3 - 2 * tx); };
        const cA = this._texA(tex0, u + t * 0.03, v + t * 0.03);
        const cB = this._texA(tex0, u * 2 - t * 0.0111, v * 2 - t * 0.0111);
        const clouds = Math.pow(cA * cB * 1.4, 2);
        // smoothstep(1.2, 0, d): HLSL/GLSL 实现 t=clamp((d-1.2)/(0-1.2)) → d=0 时 1 (递减 edge 的 clamp 语义)
        const vignette = sm(1.2, 0, Math.sqrt((u - 0.5) ** 2 + (v - 0.5) ** 2)) * 2;
        const aspect = tex0 ? tex0.height / tex0.width : 1;
        const pattern = this._texA(tex1, u * 50 * aspect, v * 50) * 0.1 * sm(0.1, 0.7, Math.sqrt((u - 0.5) ** 2 + (v - 0.5) ** 2));
        const mixF = v * v;
        const r = (tint[0] + (tint2[0] - tint[0]) * mixF) * (clouds + pattern) * vignette;
        const g = (tint[1] + (tint2[1] - tint[1]) * mixF) * (clouds + pattern) * vignette;
        const b = (tint[2] + (tint2[2] - tint[2]) * mixF) * (clouds + pattern) * vignette;
        // GRADIENT_FADE combo: alpha 随高度渐变 (bgfade 淡出层, 中部透明)
        let alpha = 1;
        if (combos && combos.GRADIENT_FADE) {
          alpha = sm(0.2, 0.45, Math.abs(v - 0.5));
        }
        return [sat(r), sat(g), sat(b), alpha];
      }
    
      // curve.frag: tint * tex.a (additive)
,
    _shadeCurve(u, v, uniforms, tex, t) {
        const tint = uniforms.tint ? (typeof uniforms.tint === 'number' ? [uniforms.tint, uniforms.tint, uniforms.tint] : uniforms.tint) : [0.5, 0.5, 0.5];
        const freq = uniforms.Freq != null ? uniforms.Freq : 1;
        const speed = uniforms['Scroll speed'] != null ? uniforms['Scroll speed'] : 0;
        const op = this._texA(tex, u, v * freq + t * speed * 0.1);
        return [tint[0] * op, tint[1] * op, tint[2] * op, 1];
      }
    
      // neonsun.frag: 程序化霓虹太阳 (渐变 + 滚动切条 + 光晕)
,
    _shadeNeonSun(u, v, uniforms, t) {
        const top = uniforms.colorsuntop ? (typeof uniforms.colorsuntop === 'number' ? [uniforms.colorsuntop, uniforms.colorsuntop, uniforms.colorsuntop] : uniforms.colorsuntop) : [1, 0.85, 0.05];
        const bot = uniforms.colorsunbottom ? (typeof uniforms.colorsunbottom === 'number' ? [uniforms.colorsunbottom, uniforms.colorsunbottom, uniforms.colorsunbottom] : uniforms.colorsunbottom) : [1, 0, 0.35];
        const sm = (e0, e1, x) => { const tx = sat((x - e0) / (e1 - e0)); return tx * tx * (3 - 2 * tx); };
        const vx = (u * 2 - 1) * 0.3, vy = (v * 2 - 1) * 0.3;
        const sunSize = 0.05, sunSizeSqrt = Math.sqrt(sunSize);
        const blendSunColor = (vy + sunSize * 2.5) / sunSizeSqrt;
        const colorSunR = top[0] + (bot[0] - top[0]) * blendSunColor;
        const colorSunG = top[1] + (bot[1] - top[1]) * blendSunColor;
        const colorSunB = top[2] + (bot[2] - top[2]) * blendSunColor;
        const sunRadius = vx * vx + vy * vy;
        const colorSunA = 1 - (sunRadius >= 0.05 ? 1 : 0);
        const glowAlpha = Math.pow(sm(0.08, 0.045, sunRadius), 2);
        const barPos = vy + 0.1;
        const sunCutOut = 1 - sat(sm(0, 0.005, barPos) * sm(1 - barPos * 9, 1 - barPos * 8, Math.sin(barPos * 200 + t)));
        const sunCutOutSmooth = 1 - sat(sm(0, 0.05, barPos) * sm(-1 - barPos * 8, 1 - barPos * 8, Math.sin(barPos * 200 + t)));
        const mixA = colorSunA * sunCutOut;
        const r = bot[0] + (colorSunR - bot[0]) * mixA;
        const g = bot[1] + (colorSunG - bot[1]) * mixA;
        const b = bot[2] + (colorSunB - bot[2]) * mixA;
        const a = Math.max(glowAlpha * sunCutOutSmooth, mixA);
        return [sat(r), sat(g), sat(b), a];
      }
    
      // neongrid.frag: 程序化霓虹网格 (格线 + 山体着色)
,
    _shadeNeonGrid(u, v, wp, n, uniforms, t) {
        const cNear = uniforms.gridnear ? (typeof uniforms.gridnear === 'number' ? [uniforms.gridnear, uniforms.gridnear, uniforms.gridnear] : uniforms.gridnear) : [1, 0, 0.49];
        const cFar = uniforms.gridfar ? (typeof uniforms.gridfar === 'number' ? [uniforms.gridfar, uniforms.gridfar, uniforms.gridfar] : uniforms.gridfar) : [0, 0.7, 1];
        const cBg = uniforms.gridbackground ? (typeof uniforms.gridbackground === 'number' ? [uniforms.gridbackground, uniforms.gridbackground, uniforms.gridbackground] : uniforms.gridbackground) : [0.102, 0, 0.102];
        const shadingAmt = uniforms.shading != null ? uniforms.shading : 1;
        const sm = (e0, e1, x) => { const tx = sat((x - e0) / (e1 - e0)); return tx * tx * (3 - 2 * tx); };
        const fract = (x) => x - Math.floor(x);
        const grid = [Math.abs(fract(u * 50) - 0.5), Math.abs(fract(v * 50) - 0.5)];
        // v_Vars.yz (近似, maskUVSmoothing≈0): 0.45 - uv.y * vec2(0.05, 0.75 - dampen*0.7)
        const dampenDist = Math.abs(u * 2 - 1);
        const dampenUVSmoothing = sat(Math.abs(u - 0.5) * 2);
        const varsY = 0.45 - v * 0.05;
        const varsZ = 0.45 - v * (0.75 - dampenUVSmoothing * 0.7);
        let gridAlpha = sm(varsY, 0.5, grid[0]) + sm(varsZ, 0.5, grid[1]);
        gridAlpha += (sm(0, 1, grid[0]) + sm(0, 1, grid[1])) * sat(0.3 - v);
        const alphaDistanceFade = sm(1.0, 0.9, v);
        const colorDistanceBlend = Math.pow(Math.max(0, v), 0.8);
        const nn = v3norm(n);
        const lightDir = v3norm([0 - wp[0], -0.15 - wp[1], -2 - wp[2]]);
        const shadingNear = Math.max(0, nn[2]);
        const shadingFar = Math.max(0, v3dot(lightDir, nn));
        const shadingColor = [
          shadingNear * cNear[0] * (1 - colorDistanceBlend) + shadingFar * cFar[0],
          shadingNear * cNear[1] * (1 - colorDistanceBlend) + shadingFar * cFar[1],
          shadingNear * cNear[2] * (1 - colorDistanceBlend) + shadingFar * cFar[2],
        ];
        const colorGrid = [
          cBg[0] + shadingColor[0] * shadingAmt,
          cBg[1] + shadingColor[1] * shadingAmt,
          cBg[2] + shadingColor[2] * shadingAmt,
        ];
        const mixNear = [
          cNear[0] + (cFar[0] - cNear[0]) * colorDistanceBlend,
          cNear[1] + (cFar[1] - cNear[1]) * colorDistanceBlend,
          cNear[2] + (cFar[2] - cNear[2]) * colorDistanceBlend,
        ];
        const ga = sat(gridAlpha * alphaDistanceFade);
        const res = [
          colorGrid[0] + (mixNear[0] - colorGrid[0]) * ga,
          colorGrid[1] + (mixNear[1] - colorGrid[1]) * ga,
          colorGrid[2] + (mixNear[2] - colorGrid[2]) * ga,
        ];
        return [sat(res[0]), sat(res[1]), sat(res[2]), alphaDistanceFade];
      }
    
      // cloudsbg.frag: 程序化云层背景 (云 + 水平线光晕)
,
    _shadeCloudsBg(u, v, uniforms, tex1, t) {
        const c1 = uniforms.clouds ? (typeof uniforms.clouds === 'number' ? [uniforms.clouds, uniforms.clouds, uniforms.clouds] : uniforms.clouds) : [0.027, 0.066, 0.086];
        const cH = uniforms.horizon ? (typeof uniforms.horizon === 'number' ? [uniforms.horizon, uniforms.horizon, uniforms.horizon] : uniforms.horizon) : [0.055, 0.306, 0.42];
        const sm = (e0, e1, x) => { const tx = sat((x - e0) / (e1 - e0)); return tx * tx * (3 - 2 * tx); };
        const aspect = tex1 ? tex1.height / tex1.width : 1;
        // v_TexCoordClouds: xy = (uv + t*sp0)*sc0; zw = (uv + t*sp1)*sc1; xz *= aspect; zw = (-w, z)
        const cxy0 = ((u + t * 0.0007) % 1 + 1) % 1 * 1.1;
        const cxy1 = ((v + t * 0.0007) % 1 + 1) % 1 * 1.1;
        let cz0 = ((u + t * -0.0011) % 1 + 1) % 1 * 0.7 * aspect;
        let cw0 = ((v + t * -0.0011) % 1 + 1) % 1 * 0.7;
        const cloud0 = this._texR(tex1, cxy0, cxy1);
        const cloud1 = this._texR(tex1, -cw0, cz0);
        const cloudBlend = cloud0 * cloud1;
        const lift = Math.pow(sm(0.5, 0.0, v), 2) * 2.0;
        const horizonBend = 1 - Math.cos(sat(u * 2.0 - 0.5) * 2 * Math.PI);
        const hdx = (u - 0.5) * 0.5;
        const hdy = (v - 0.6) * (1.5 - horizonBend * 0.3);
        const distanceToCenter = Math.sqrt(hdx * hdx + hdy * hdy);
        const horizonGlow = Math.pow(sm(0.5, 0.0, distanceToCenter), 2) * 2.0;
        const r = c1[0] * cloudBlend + (c1[0] * 0.5 + c1[0] * cloudBlend) * lift + cH[0] * horizonGlow;
        const g = c1[1] * cloudBlend + (c1[1] * 0.5 + c1[1] * cloudBlend) * lift + cH[1] * horizonGlow;
        const b = c1[2] * cloudBlend + (c1[2] * 0.5 + c1[2] * cloudBlend) * lift + cH[2] * horizonGlow;
        return [sat(r), sat(g), sat(b), 1];
      }
    
      // core.frag: albedo=tint, 光照 = ComputeLightSpecular(light[0]) + ambient 混合, 乘 v_LightScale
,
    _shadeCore(u, v, wp, n, eye, uniforms, t) {
        const tint = uniforms.tint ? (typeof uniforms.tint === 'number' ? [uniforms.tint, uniforms.tint, uniforms.tint] : uniforms.tint) : [1, 1, 1];
        const roughness = uniforms.Rough != null ? uniforms.Rough : 0;
        const metallic = uniforms.Metal != null ? uniforms.Metal : 0;
        const gLight = uniforms.Light != null ? uniforms.Light : 0;
        const specPower = (1.01 - roughness) * (400 + (250 - 400) * metallic);
        const specStrength = (0.5 + metallic * 0.5) * (1.0 - roughness * 0.9);
        const viewDir = v3norm(v3sub(eye, wp));
        // v_LightScale (core.vert, audio=0)
        const period = Math.PI * 4;
        const a = t * 0.4, cs = Math.cos(a), sn = Math.sin(a);
        const rx = cs * u - sn * v, ry = sn * u + cs * v;
        const animsZ = sat(Math.sin((u + v + 1) * period + t));
        const stepX = u >= 0 ? 1 : 0;
        let audioAvg = 1.0 - (u <= 0 ? 1 : 0) * animsZ * 0.4;
        const lightScale = sat(stepX + audioAvg);
        let light = [0, 0, 0];
        let spec = [0, 0, 0];
        const lights = this.lights;
        for (let li = 0; li < Math.min(lights.length, 4); li++) {
          const L = lights[li];
          const lv = v3sub(L.origin, wp);
          const dist = Math.sqrt(v3dot(lv, lv)) || 1;
          const ldir = [lv[0] / dist, lv[1] / dist, lv[2] / dist];
          const attn = sat((L.radius - dist) / L.radius);
          const h = v3norm(v3add(viewDir, ldir));
          const specDot = Math.max(0, v3dot(h, n));
          const c = [L.color[0] * L.intensity, L.color[1] * L.intensity, L.color[2] * L.intensity];
          const specTerm = Math.pow(specDot, specPower) * specStrength * attn;
          spec = [spec[0] + specTerm * c[0], spec[1] + specTerm * c[1], spec[2] + specTerm * c[2]];
          const lightDot = v3dot(ldir, n);
          const hl = lightDot * 0.5 + 0.5;
          const ld = lightDot + (hl - lightDot) * gLight;
          const a2 = attn * attn;
          light = [light[0] + c[0] * sat(ld) * a2, light[1] + c[1] * sat(ld) * a2, light[2] + c[2] * sat(ld) * a2];
        }
        const upMix = v3dot(n, [0, 1, 0]) * 0.5 + 0.5;
        const amb = [
          this.skylightColor[0] + (this.ambientColor[0] - this.skylightColor[0]) * upMix,
          this.skylightColor[1] + (this.ambientColor[1] - this.skylightColor[1]) * upMix,
          this.skylightColor[2] + (this.ambientColor[2] - this.skylightColor[2]) * upMix,
        ];
        const total = [
          tint[0] * (light[0] + amb[0]) * lightScale + spec[0],
          tint[1] * (light[1] + amb[1]) * lightScale + spec[1],
          tint[2] * (light[2] + amb[2]) * lightScale + spec[2],
        ];
        return [sat(total[0]), sat(total[1]), sat(total[2]), 1];
      }
    
      // backgroundsphere.frag: 程序化钻石+噪点+云 (完全照搬 shader 数学)
,
    _shadeBgSphere(u, v, uniforms, tex0, tex1, tex2, t) {
        const tint = uniforms.tint ? (typeof uniforms.tint === 'number' ? [uniforms.tint, uniforms.tint, uniforms.tint] : uniforms.tint) : [1, 1, 1];
        const tint2 = uniforms.tint2 ? (typeof uniforms.tint2 === 'number' ? [uniforms.tint2, uniforms.tint2, uniforms.tint2] : uniforms.tint2) : [0, 0, 0];
        const sm = (edge0, edge1, x) => { const tx = sat((x - edge0) / (edge1 - edge0)); return tx * tx * (3 - 2 * tx); };
        const smRev = (e0, e1, x) => sm(e1, e0, x);
        const pux = u * 200 + t * 0.2, puy = v * 100;
        const diamond = this._texR(tex0, pux, puy);
        const nux1 = u * 2 + t * 0.007, nuy1 = v * 2 + t * 0.007;
        const nux2 = u * 4 - t * 0.005, nuy2 = v * 4 - t * 0.005;
        const noiseA = this._texR(tex1, nux1, nuy1);
        const noiseB = this._texR(tex1, nux2, nuy2);
        const diamondBlend0 = Math.abs(v - 0.5) * 0.8;
        const diamondBlend = sm(0.2, 0.0, diamondBlend0);
        const coreNoise = sm(noiseA, noiseB, 0.3);
        const noise = sm(0.25, 0.3, noiseA * noiseB) * smRev(0.25, 0.3, noiseA * noiseB);
        const noiseV = coreNoise * noise * 4;
        const cloudA = this._texR(tex1, u + t * 0.01, v + t * 0.01);
        const cloudB = this._texR(tex1, u - t * 0.005, v - t * 0.005);
        const cloudLevel = cloudA * cloudB * 1.1;
        const cl = cloudLevel * (0.5 - Math.abs(v - 0.5));
        const hash = this._texA(tex2, pux, puy);
        let albedoR = cl + tint2[0], albedoG = cl + tint2[1], albedoB = cl + tint2[2];
        const mixF = sm(0.2, 0.02, cl);
        const ar = albedoR + ((cl + 0.5) * tint[0] - albedoR) * mixF;
        const ag = albedoG + ((cl + 0.5) * tint[1] - albedoG) * mixF;
        const ab = albedoB + ((cl + 0.5) * tint[2] - albedoB) * mixF;
        const db = diamondBlend * diamond * noiseV + diamondBlend * noiseV * 0.2;
        const fr = ar + (db * tint[0] * 10 - ar) * db;
        const fg = ag + (db * tint[1] * 10 - ag) * db;
        const fb = ab + (db * tint[2] * 10 - ab) * db;
        const hf = sm(0.2, 0.02, cl) * sm(0.02, 0.2, cl);
        return [sat(fr + hash * 0.1), sat(fg + hash * 0.1), sat(fb + hash * 0.1), 1];
      }
    
      // 通用材质 (generic*): 纹理 * 环境 + 点光 (近似)
      // generic.frag 完整实现: 4 光源 ComputeLightSpecular + LIGHTMAP/NORMALMAP/DIFFUSETINT/DETAILINALPHA
,
    _shadeGeneric(u, v, wp, n, eye, uniforms, textures, t, combos, u2, v2, su, sv) {
        const tex0 = textures && textures[0];
        let albedo = this._texSample(tex0, u, v);
        if (!tex0) albedo = [1, 1, 1, 1];
        if (combos && combos.DIFFUSETINT) {
          const tint = uniforms.tint || uniforms.Color || [1, 1, 1];
          albedo[0] *= tint[0]; albedo[1] *= tint[1]; albedo[2] *= tint[2];
        }
        if (combos && combos.DETAILINALPHA && tex0) {
          const d = this._texA(tex0, u * 3, v * 3) * 2.0;
          albedo[0] *= d; albedo[1] *= d; albedo[2] *= d;
        }
        // 法线
        let normal;
        if (combos && (combos.NORMALMAP || combos.normalmap) && textures[1]) {
          const nm = this._texSample(textures[1], u, v);
          const nx = nm[0] * 2 - 1, ny = nm[1] * 2 - 1;
          const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
          normal = v3norm([nx, ny, nz]);
        } else {
          normal = v3norm(n);
        }
        const viewDir = v3norm(v3sub(eye, wp));
        const roughness = uniforms.Rough != null ? uniforms.Rough : 0.5;
        const metallic = uniforms.Metal != null ? uniforms.Metal : 0;
        const gLight = uniforms.Light != null ? uniforms.Light : 0;
        const specPower = (1.01 - roughness) * (400 + (250 - 400) * metallic);
        const specStrength = (0.5 + metallic * 0.5) * (1.0 - roughness * 0.9);
        let light = [0, 0, 0], spec = [0, 0, 0];
        const lights = this.lights;
        for (let li = 0; li < Math.min(lights.length, 4); li++) {
          const L = lights[li];
          const lv = v3sub(L.origin, wp);
          const dist = Math.sqrt(v3dot(lv, lv)) || 1;
          const ldir = [lv[0] / dist, lv[1] / dist, lv[2] / dist];
          const attn = sat((L.radius - dist) / L.radius);
          const h = v3norm(v3add(viewDir, ldir));
          const specDot = Math.max(0, v3dot(h, normal));
          const c = [L.color[0] * L.intensity, L.color[1] * L.intensity, L.color[2] * L.intensity];
          const st = Math.pow(specDot, specPower) * specStrength * attn;
          spec[0] += st * c[0]; spec[1] += st * c[1]; spec[2] += st * c[2];
          const lightDot = v3dot(ldir, normal);
          const hl = lightDot * 0.5 + 0.5;
          const ld = lightDot + (hl - lightDot) * gLight;
          const rim = metallic * 2;
          const rimTerm = Math.pow(Math.max(0, 1 - Math.max(0, v3dot(normal, viewDir))) * Math.pow(hl, 0.25), 6 - rim) * rim;
          const a2 = attn * attn;
          const dl = sat(ld) + rimTerm;
          light[0] += c[0] * dl * a2; light[1] += c[1] * dl * a2; light[2] += c[2] * dl * a2;
        }
        // 烘焙光照贴图 (generic.vert v_TexCoord.zw = 第二 UV 通道)
        if (combos && (combos.LIGHTMAP || combos.lightmap)) {
          const lmTex = textures[(combos.NORMALMAP || combos.normalmap) ? 2 : 1];
          if (lmTex) {
            // lightmap 用第 2 UV 通道 (引擎 v_TexCoord2); 无 uv2 时回退 uv1
            const lu = u2 != null ? u2 : u;
            const lv = v2 != null ? v2 : v;
            const lm = this._texSample(lmTex, lu, lv);
            light = [light[0] * lm[0], light[1] * lm[1], light[2] * lm[2]];
            spec = [spec[0] * lm[0], spec[1] * lm[1], spec[2] * lm[2]];
          }
        }
        // ambient (v_LightAmbientColor) + skylight (按法线·up 混合) + albedo*light + specular
        const upMix = v3dot(normal, [0, 1, 0]) * 0.5 + 0.5;
        const amb = [
          this.skylightColor[0] + (this.ambientColor[0] - this.skylightColor[0]) * upMix,
          this.skylightColor[1] + (this.ambientColor[1] - this.skylightColor[1]) * upMix,
          this.skylightColor[2] + (this.ambientColor[2] - this.skylightColor[2]) * upMix,
        ];
        light = [light[0] + amb[0], light[1] + amb[1], light[2] + amb[2]];
        let r = albedo[0] * light[0] + spec[0];
        let g = albedo[1] * light[1] + spec[1];
        let b = albedo[2] * light[2] + spec[2];
        // REFLECTION: screenUV = (screenPos.xy/z)*0.5+0.5; + tex3(screenUV + normal.xy*0.01) * 0.35
        if (combos && (combos.REFLECTION || combos.reflection) && textures[3]) {
          const suv = su != null ? su : u;
          const svv = sv != null ? sv : v;
          const ref = this._texSample(textures[3], suv + normal[0] * 0.01, svv + normal[1] * 0.01);
          r += ref[0] * 0.35;
          g += ref[1] * 0.35;
          b += ref[2] * 0.35;
        }
        return [sat(r), sat(g), sat(b), albedo[3]];
      }
    
      // 纹理采样 (wrap, 双线性 — 与 GPU texSample2D 默认一致)
,
    _texR(tex, u, v) {
        if (!tex) return 0.5;
        const x = ((u % 1) + 1) % 1, y = ((v % 1) + 1) % 1;
        const fx = x * tex.width - 0.5, fy = y * tex.height - 0.5;
        const x0 = Math.max(0, Math.min(tex.width - 1, Math.floor(fx)));
        const y0 = Math.max(0, Math.min(tex.height - 1, Math.floor(fy)));
        const x1 = Math.min(tex.width - 1, x0 + 1), y1 = Math.min(tex.height - 1, y0 + 1);
        const tx = fx - x0, ty = fy - y0;
        const i00 = (y0 * tex.width + x0) * 4, i10 = (y0 * tex.width + x1) * 4;
        const i01 = (y1 * tex.width + x0) * 4, i11 = (y1 * tex.width + x1) * 4;
        const top = tex.rgba[i00] * (1 - tx) + tex.rgba[i10] * tx;
        const bot = tex.rgba[i01] * (1 - tx) + tex.rgba[i11] * tx;
        return (top * (1 - ty) + bot * ty) / 255;
      }
,
    _texA(tex, u, v) {
        if (!tex) return 0;
        const x = ((u % 1) + 1) % 1, y = ((v % 1) + 1) % 1;
        const fx = x * tex.width - 0.5, fy = y * tex.height - 0.5;
        const x0 = Math.max(0, Math.min(tex.width - 1, Math.floor(fx)));
        const y0 = Math.max(0, Math.min(tex.height - 1, Math.floor(fy)));
        const x1 = Math.min(tex.width - 1, x0 + 1), y1 = Math.min(tex.height - 1, y0 + 1);
        const tx = fx - x0, ty = fy - y0;
        const i00 = (y0 * tex.width + x0) * 4 + 3, i10 = (y0 * tex.width + x1) * 4 + 3;
        const i01 = (y1 * tex.width + x0) * 4 + 3, i11 = (y1 * tex.width + x1) * 4 + 3;
        const top = tex.rgba[i00] * (1 - tx) + tex.rgba[i10] * tx;
        const bot = tex.rgba[i01] * (1 - tx) + tex.rgba[i11] * tx;
        return (top * (1 - ty) + bot * ty) / 255;
      }
,
    _texSample(tex, u, v, clamp = false) {
        if (!tex) return [1, 1, 1, 1];
        // 非有限坐标 (效果数学透视溢出等) → 返回 0, 避免 NaN 传播到输出 (黑斑)
        if (!isFinite(u) || !isFinite(v)) return [0, 0, 0, 0];
        let x, y;
        if (clamp) {
          x = Math.min(0.999999, Math.max(0, u));
          y = Math.min(0.999999, Math.max(0, v));
        } else {
          x = ((u % 1) + 1) % 1;
          y = ((v % 1) + 1) % 1;
        }
        const fx = x * tex.width - 0.5, fy = y * tex.height - 0.5;
        const x0 = Math.max(0, Math.min(tex.width - 1, Math.floor(fx)));
        const y0 = Math.max(0, Math.min(tex.height - 1, Math.floor(fy)));
        const x1 = Math.min(tex.width - 1, x0 + 1), y1 = Math.min(tex.height - 1, y0 + 1);
        const tx = fx - x0, ty = fy - y0;
        const i00 = (y0 * tex.width + x0) * 4, i10 = (y0 * tex.width + x1) * 4;
        const i01 = (y1 * tex.width + x0) * 4, i11 = (y1 * tex.width + x1) * 4;
        const out = [0, 0, 0, 0];
        for (let c = 0; c < 4; c++) {
          const top = tex.rgba[i00 + c] * (1 - tx) + tex.rgba[i10 + c] * tx;
          const bot = tex.rgba[i01 + c] * (1 - tx) + tex.rgba[i11 + c] * tx;
          out[c] = (top * (1 - ty) + bot * ty) / 255;
        }
        return out;
      }
    
  });
}
