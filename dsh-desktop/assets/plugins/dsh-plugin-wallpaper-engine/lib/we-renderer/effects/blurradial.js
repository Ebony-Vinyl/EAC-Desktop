// WE 渲染引擎 — 效果 Blurradial (从 effects.js 拆分, 逻辑零改动)
import { parseVec2, getVal } from '../math.js';

export const fx = {
      // blurradial (引擎 shader: effects/blur_radial_gaussian.frag + common_blur.h):
      // 径向旋转高斯模糊 (KERNEL 0=13 采样 / 1=7 / 2=3)
      //   delta = uv − center; amt = scale·0.025; r_i = rotate(delta, o_i·amt) − delta
      //   albedo = Σ w_i · sample(center ± r_i + delta)   (核/权重来自 common_blur.h)
      //   [MASK] albedo = mix(prev, albedo, mask.r); [BLURALPHA=0] albedo.a = prev.a
      //   uniform: scale/center; KERNEL/MASK/BLURALPHA combo

    effectBlurradial(tex, c, t, pass) {
        const scale = getVal(c, 'scale', 1);
        const center = parseVec2(getVal(c, 'center', '0.5 0.5'), [0.5, 0.5]);
        const combos = (pass && pass.combos) || {};
        const kernel = combos.KERNEL != null ? Number(combos.KERNEL) : 0;
        const hasMask = combos.MASK === '1' || combos.MASK === 1;
        const keepAlpha = combos.BLURALPHA === '0' || combos.BLURALPHA === 0 ? true : false;
        const pt = (pass && pass.textures) || [];
        const maskTex = hasMask && pt[1] && pt[1] !== 'null' ? this.loadTexture(pt[1]) : null;
        const W = tex.width, H = tex.height;
        const src = tex.rgba;
        const out = new Uint8Array(src.length);
        const amt = scale * 0.025;
        // 核参数 (common_blur.h): [o_i..., w_i...]
        const K0 = {
          o: [1.4091998770852122, 3.2979348079914822, 5.2062900776825969],
          w0: 0.1976406528809576,
          w: [0.2959855056006557, 0.0935333619980593, 0.0116608059608062],
        };
        const K1 = {
          o: [2.3515644035337887, 0.469433779698372, -1.4091998770852121, -3],
          w0: null,
          w: [0.2028175528299753, 0.4044856614512112, 0.3213933537319605, 0.0713034319868530],
        };
        const K2 = {
          o: [1],
          w0: 0.5,
          w: [0.25, 0.25],
        };
        const K = kernel === 1 ? K1 : kernel === 2 ? K2 : K0;
        const rotate = (x, y, r) => [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)];
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const u = (x + 0.5) / W, v = (y + 0.5) / H;
            const dx = u - center[0], dy = v - center[1];
            let r = [0, 0, 0, 0];
            // 中心项 (K0/K2)
            if (K.w0 != null) {
              const s0 = this._texSample(tex, u, v);
              r = [s0[0] * K.w0, s0[1] * K.w0, s0[2] * K.w0, s0[3] * K.w0];
            }
            for (let i = 0; i < K.o.length; i++) {
              const o = K.o[i] * amt;
              const rot = rotate(dx, dy, o);
              const r1x = rot[0] - dx, r1y = rot[1] - dy;
              const w = K.w[i];
              const sp = this._texSample(tex, center[0] + r1x + dx, center[1] + r1y + dy);
              const sm = this._texSample(tex, center[0] - r1x + dx, center[1] - r1y + dy);
              r[0] += (sp[0] + sm[0]) * w;
              r[1] += (sp[1] + sm[1]) * w;
              r[2] += (sp[2] + sm[2]) * w;
              r[3] += (sp[3] + sm[3]) * w;
            }
            // MASK / BLURALPHA
            const prev = this._texSample(tex, u, v);
            let or = r[0], og = r[1], ob = r[2], oa = r[3];
            if (hasMask) {
              const m = this._texSample(maskTex, u, v)[0];
              or = prev[0] + (r[0] - prev[0]) * m;
              og = prev[1] + (r[1] - prev[1]) * m;
              ob = prev[2] + (r[2] - prev[2]) * m;
              oa = prev[3] + (r[3] - prev[3]) * m;
            }
            if (keepAlpha) oa = prev[3];
            const di = (y * W + x) * 4;
            out[di] = Math.round(Math.min(1, or) * 255);
            out[di + 1] = Math.round(Math.min(1, og) * 255);
            out[di + 2] = Math.round(Math.min(1, ob) * 255);
            out[di + 3] = Math.round(Math.min(1, oa) * 255);
          }
        }
        return { width: W, height: H, rgba: out };
      }
};
