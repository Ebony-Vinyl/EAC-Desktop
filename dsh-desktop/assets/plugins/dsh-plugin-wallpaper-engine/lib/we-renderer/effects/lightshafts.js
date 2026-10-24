// WE 渲染引擎 — 效果 Lightshafts (从 effects.js 拆分, 逻辑零改动)
import { parseVec3, parseVec2, getVal, applyBlending } from '../math.js';

export const fx = {
      // lightshafts (引擎 shader: effects/lightshafts.frag/vert, RAYMODE=0 线性 +
      // RENDERING=0 颜色, 无 MASK): 透视光柱 (squareToQuad 逆变换 → fx 坐标)
      //   vert: xform = inverse(squareToQuad(p0..p3)); fx = xform × [uv,1]
      //   frag: fx = fx.xy/fx.z; mask = step(0,fx.z) × smoothstep 中心遮罩 × grad
      //         噪声双采样 → pow(exponent) → smoothstep 阈值 → fxColor 渐变
      //         albedo.rgb = ApplyBlending(BLENDMODE, albedo.rgb, fxColor·intensity, fx)
      //         albedo.a = max(albedo.a, fx)
      //   uniform: rayspeed/rayscale/raysmoothness/rayfeather/colorwintensity/
      //     colorwexponent/colorastart/colorend/point0-3; BLENDMODE combo 默认 31

    effectLightshafts(tex, c, t, pass) {
        const W = tex.width, H = tex.height;
        // ── vert: squareToQuad → inverse3 (common_perspective.h 官方数学) ──
        const sq2q = (p0, p1, p2, p3) => {
          const dx0 = p0[0], dy0 = p0[1], dx1 = p1[0], dy1 = p1[1];
          const dx2 = p3[0], dy2 = p3[1], dx3 = p2[0], dy3 = p2[1];
          const diffx1 = dx1 - dx3, diffy1 = dy1 - dy3;
          const diffx2 = dx2 - dx3, diffy2 = dy2 - dy3;
          const det = diffx1 * diffy2 - diffx2 * diffy1;
          const sumx = dx0 - dx1 + dx3 - dx2, sumy = dy0 - dy1 + dy3 - dy2;
          if (det === 0 || (sumx === 0 && sumy === 0)) {
            return [
              [dx1 - dx0, dy1 - dy0, 0],
              [dx3 - dx1, dy3 - dy1, 0],
              [dx0, dy0, 1],
            ];
          }
          const ovdet = 1 / det;
          const g = (sumx * diffy2 - diffx2 * sumy) * ovdet;
          const h = (diffx1 * sumy - sumx * diffy1) * ovdet;
          return [
            [dx1 - dx0 + g * dx1, dy1 - dy0 + g * dy1, g],
            [dx2 - dx0 + h * dx2, dy2 - dy0 + h * dy2, h],
            [dx0, dy0, 1],
          ];
        };
        const inv3 = (m) => {
          const a00 = m[0][0], a01 = m[0][1], a02 = m[0][2];
          const a10 = m[1][0], a11 = m[1][1], a12 = m[1][2];
          const a20 = m[2][0], a21 = m[2][1], a22 = m[2][2];
          const b01 = a22 * a11 - a12 * a21;
          const b11 = -a22 * a10 + a12 * a20;
          const b21 = a21 * a10 - a11 * a20;
          const det = a00 * b01 + a01 * b11 + a02 * b21;
          const d = 1 / det;
          return [
            [b01 * d, (-a22 * a01 + a02 * a21) * d, (a12 * a01 - a02 * a11) * d],
            [b11 * d, (a22 * a00 - a02 * a20) * d, (-a12 * a00 + a02 * a10) * d],
            [b21 * d, (-a21 * a00 + a01 * a20) * d, (a11 * a00 - a01 * a10) * d],
          ];
        };
        const p0 = parseVec2(getVal(c, 'point0', '0.67728 0.01297'), [0.67728, 0.01297]);
        const p1 = parseVec2(getVal(c, 'point1', '0.76007 0.14043'), [0.76007, 0.14043]);
        const p2 = parseVec2(getVal(c, 'point2', '0.46654 1.09592'), [0.46654, 1.09592]);
        const p3 = parseVec2(getVal(c, 'point3', '0.16363 0.44881'), [0.16363, 0.44881]);
        const xform = inv3(sq2q(p0, p1, p2, p3));
        // ── uniforms ──
        const speed = getVal(c, 'rayspeed', 0.2);
        const scale = parseVec2(getVal(c, 'rayscale', '0.5 0.1'), [0.5, 0.1]);
        const smoothness = getVal(c, 'raysmoothness', 0.75);
        const feather = parseVec2(getVal(c, 'rayfeather', '0.05 0.2'), [0.05, 0.2]);
        const exponent = getVal(c, 'colorwexponent', 1);
        const intensity = getVal(c, 'colorwintensity', 1);
        const cStart = parseVec3(getVal(c, 'colorastart', '1 1 1'), [1, 1, 1]);
        const cEnd = parseVec3(getVal(c, 'colorend', '0.5 0.8 1'), [0.5, 0.8, 1]);
        const combos = (pass && pass.combos) || {};
        const blendMode = combos.BLENDMODE != null ? Number(combos.BLENDMODE) : 31;
        const pt = (pass && pass.textures) || [];
        const noiseTex = pt[1] && pt[1] !== 'null' ? this.loadTexture(pt[1]) : this.loadTexture('util/noise');
        const src = tex.rgba;
        const out = new Uint8Array(src.length);
        const ss = (a, b, x) => {
          const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
          return k * k * (3 - 2 * k);
        };
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const u = (x + 0.5) / W, v = (y + 0.5) / H;
            // fx = xform × [u,v,1] (行向量 mul)
            const f0 = u * xform[0][0] + v * xform[1][0] + xform[2][0];
            const f1 = u * xform[0][1] + v * xform[1][1] + xform[2][1];
            const f2 = u * xform[0][2] + v * xform[1][2] + xform[2][2];
            const fx = f0 / f2, fy = f1 / f2;
            let mask = f2 >= 0 ? 1 : 0; // step(0, fx.z)
            const fxRefY = fy;
            // RAYMODE=0 线性: 中心遮罩 + 渐变
            mask *= ss(0.50001, 0.5 - feather[0], Math.abs(fx - 0.5));
            mask *= ss(0.50001, 0.5 - feather[1], Math.abs(fy - 0.5));
            mask *= 1 - fy;
            // 噪声双采样 (两套频率/速度)
            const n1x = fx * 0.054111 * scale[0] + t * speed * 0.003;
            const n1y = fy * 0.003111 * scale[1] + t * speed * 0.000375111;
            const n2x = fx * 0.07333 * scale[0] - t * speed * 0.0047111;
            const n2y = fy * 0.005967111 * scale[1] - t * speed * 0.0007399;
            let fxv = this._texSample(noiseTex, n1x, n1y)[0] * this._texSample(noiseTex, n2x, n2y)[0];
            fxv = Math.pow(fxv, exponent);
            fxv = ss((1 - smoothness) * 0.29999, 0.3 + smoothness * 0.7, fxv);
            // 透视溢出 (fx/fy 巨大或 NaN) → 采样 NaN → NaN×mask=NaN → 输出黑斑;
            // GPU 侧 NaN 输出为 0/undefined, CPU 需显式归零
            if (!isFinite(fxv)) fxv = 0;
            // RENDERING=0: 颜色渐变 (起点→终点 按 fxRef.y)。
            // fxRef.y 可负 (透视点含负 y 时逆变换溢出) → fc 负色 → applyBlending
            // 输出黑斑 (实测 col=-1 → 结果 ~18)。GPU 输出时颜色自然 clamp, CPU
            // 需显式 clamp 到 [0,1]。
            const fc = [
              Math.max(0, Math.min(1, cStart[0] + (cEnd[0] - cStart[0]) * fxRefY)),
              Math.max(0, Math.min(1, cStart[1] + (cEnd[1] - cStart[1]) * fxRefY)),
              Math.max(0, Math.min(1, cStart[2] + (cEnd[2] - cStart[2]) * fxRefY)),
            ];
            fxv *= mask;
            const a = this._texSample(tex, u, v);
            const srcRgb = [a[0], a[1], a[2]];
            const col = [fc[0] * intensity, fc[1] * intensity, fc[2] * intensity];
            const rgb = applyBlending(blendMode, srcRgb, col, fxv);
            const di = (y * W + x) * 4;
            out[di] = Math.round(rgb[0] * 255);
            out[di + 1] = Math.round(rgb[1] * 255);
            out[di + 2] = Math.round(rgb[2] * 255);
            out[di + 3] = Math.round(Math.max(a[3], fxv) * 255);
          }
        }
        return { width: W, height: H, rgba: out };
      }
};
