// WE 渲染引擎 — 效果 Blur (从 effects.js 拆分, 逻辑零改动)
import { parseVec3, parseVec2, getVal, applyBlending, _greyscale } from '../math.js';

export const fx = {
      // blur (官方 4-pass 链: blur_downsample4 → blur_gaussian_x → blur_gaussian_y
      // → blur_combine)。effect.json passes 顺序: [downsample4, gaussian_x,
      // gaussian_y, combine]; gaussian 的 KERNEL/VERTICAL 由 material combos 决定。
      //   downsample4: 目标像素中心 ±1 源texel 4 角采样, rgb=Σ(s·a)/Σa, a=Σ(a²)/4
      //   gaussian: 13/7/3-tap 核 (VERTICAL 决定 x/y 方向), 权重固定, scale vec2
      //   combine: ApplyComposite(原, blurred) × mask; BLURALPHA=0 时 a=原a
      //   uniform (combine pass): compositealpha/offset/color; combos: COMPOSITE/
      //     BLENDMODE/COMPOSITEMONO/MASK/BLURALPHA; scale (gaussian)
    effectBlur(tex, passes, c, t, pass) {
        // ── 从 passes 提取各阶段参数 (官方 effect.json 4 pass) ──
        const pG = (passes && passes[1]) || {}, pC = (passes && passes[3]) || {};
        const cG = pG.constantshadervalues || {}, cC = pC.constantshadervalues || {};
        const kG = pG.combos || {}, kC = pC.combos || {};
        // gaussian: KERNEL 0=13/1=7/2=3-tap; VERTICAL=1 → y 方向; scale 是 vec2
        const kernel = kG.KERNEL != null ? Number(kG.KERNEL) : 0;
        const vertical = kG.VERTICAL === '1' || kG.VERTICAL === 1;
        const scaleV = parseVec2(getVal(cG, 'scale', getVal(c, 'scale', '1 1')), [1, 1]);
        const composite = kC.COMPOSITE != null ? Number(kC.COMPOSITE) : 0;
        const blendMode = kC.BLENDMODE != null ? Number(kC.BLENDMODE) : 0;
        const compMono = kC.COMPOSITEMONO === '1' || kC.COMPOSITEMONO === 1;
        const keepAlpha = kC.BLURALPHA === '0' || kC.BLURALPHA === 0;
        // MASK: combo 显式开启, 或 combine textures[1] 绑定了 mask (引擎按纹理存在自动启用 combo)
        const pCt = (pC && pC.textures) || (pass && pass.textures) || [];
        const hasMask = (kC.MASK === '1' || kC.MASK === 1) || !!(pCt[1] && pCt[1] !== 'null');
        const maskTex = hasMask && pCt[1] && pCt[1] !== 'null' ? this.loadTexture(pCt[1]) : null;
        const compAlpha = getVal(cC, 'compositealpha', getVal(c, 'alpha', 1));
        const compOffset = parseVec2(getVal(cC, 'compositeoffset', getVal(c, 'offset', '0 0')), [0, 0]);
        const compColor = parseVec3(getVal(cC, 'compositecolor', getVal(c, 'color', '1 1 1')), [1, 1, 1]);
        const W = tex.width, H = tex.height;
        const src = tex.rgba;
        // ── pass 1: downsample4 (官方 blur_downsample4: 目标像素中心 ± 1 源texel) ──
        const dw = Math.max(2, Math.floor(W / 4)), dh = Math.max(2, Math.floor(H / 4));
        const down = new Uint8Array(dw * dh * 4);
        const ox = 1 / W, oy = 1 / H;
        for (let y = 0; y < dh; y++) {
          for (let x = 0; x < dw; x++) {
            const uc = (x + 0.5) / dw, vc = (y + 0.5) / dh;
            const corners = [[uc - ox, vc - oy], [uc + ox, vc - oy], [uc - ox, vc + oy], [uc + ox, vc + oy]];
            let rs = 0, gs = 0, bs = 0, asq = 0, wa = 0;
            for (let i = 0; i < 4; i++) {
              const s = this._texSample(tex, corners[i][0], corners[i][1], true);
              rs += s[0] * s[3]; gs += s[1] * s[3]; bs += s[2] * s[3];
              asq += s[3] * s[3]; wa += s[3];
            }
            // rgb = Σ(s·a)/max(0.001,Σa); a = Σ(a²)/4 (官方 frag 逐项乘 a)
            const di = (y * dw + x) * 4;
            const wNorm = Math.max(0.001, wa);
            down[di] = Math.round((rs / wNorm) * 255);
            down[di + 1] = Math.round((gs / wNorm) * 255);
            down[di + 2] = Math.round((bs / wNorm) * 255);
            down[di + 3] = Math.round((asq / 4) * 255);
          }
        }
        let img = { width: dw, height: dh, rgba: down };
        // ── pass 2-3: gaussian x/y (官方 blur_gaussian.frag 固定权重核) ──
        const KERNELS = {
          0: { w: [0.006299, 0.017298, 0.039533, 0.075189, 0.119007, 0.156756, 0.171834], off: [6, 5, 4, 3, 2, 1, 0] },
          1: { w: [0.071303, 0.131514, 0.189879, 0.214607], off: [3, 2, 1, 0] },
          2: { w: [0.25, 0.5], off: [1, 0] },
        };
        const K = KERNELS[kernel] || KERNELS[0];
        const gauss = (tex2, vertical2) => {
          const w2 = tex2.width, h2 = tex2.height;
          const out2 = new Uint8Array(w2 * h2 * 4);
          // blur_gaussian.vert: offset = g_Scale.x/y ÷ 纹理分辨率 (z/w)
          const step = vertical2 ? scaleV[1] / h2 : scaleV[0] / w2;
          for (let y = 0; y < h2; y++) {
            for (let x = 0; x < w2; x++) {
              const u = (x + 0.5) / w2, v = (y + 0.5) / h2;
              let r = 0, g = 0, b = 0, a = 0;
              // 对称核: 中心权重 + 两侧 (官方权重已含全部 13/7/3 项, 对称)
              const full = [];
              for (let i = 0; i < K.off.length; i++) full[K.off[i]] = K.w[i];
              // 构建 2n+1 项权重数组 (对称)
              const n = K.off[0];
              const weights = [];
              for (let i = -n; i <= n; i++) {
                const ai = Math.abs(i);
                weights.push(full[ai] != null ? full[ai] : 0);
              }
              for (let i = -n; i <= n; i++) {
                const s = this._texSample(tex2, vertical2 ? u : u + i * step, vertical2 ? v + i * step : v, true);
                const wgt = weights[i + n];
                r += s[0] * wgt; g += s[1] * wgt; b += s[2] * wgt; a += s[3] * wgt;
              }
              const di = (y * w2 + x) * 4;
              out2[di] = Math.round(Math.min(1, r) * 255);
              out2[di + 1] = Math.round(Math.min(1, g) * 255);
              out2[di + 2] = Math.round(Math.min(1, b) * 255);
              out2[di + 3] = Math.round(Math.min(1, a) * 255);
            }
          }
          return { width: w2, height: h2, rgba: out2 };
        };
        img = gauss(img, vertical);
        img = gauss(img, !vertical);
        // ── pass 4: combine (blurred 与 原图 按 COMPOSITE 混合) ──
        const out = new Uint8Array(src.length);
        const bw = img.width, bh = img.height;
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const u = (x + 0.5) / W, v = (y + 0.5) / H;
            // ApplyCompositeOffset: 像素offset ÷ g_Texture0Resolution.xy (= blurred 纹理分辨率)
            const bu = composite !== 0 ? u + compOffset[0] / bw : u;
            const bv = composite !== 0 ? v + compOffset[1] / bh : v;
            const bl = this._texSample(img, bu, bv, true);
            const old = this._texSample(tex, u, v);
            let mask = 1;
            if (maskTex) {
              // blur_combine.vert: v_TexCoord.zw = uv · maskRes/对象Res
              const mSx = maskTex.width / W, mSy = maskTex.height / H;
              mask = this._texSample(maskTex, u * mSx, v * mSy)[0];
            }
            // div = mix(blurred.a, 1, step(blurred.a, 0)) — a>0 时用 a 反预乘, 否则 1
            const div = bl[3] > 0 ? bl[3] : 1;
            let eff = [bl[0] / div, bl[1] / div, bl[2] / div, bl[3]];
            if (compMono) {
              const gv2 = _greyscale(eff);
              eff = [gv2, gv2, gv2, eff[3]];
            }
            eff = [eff[0] * compColor[0], eff[1] * compColor[1], eff[2] * compColor[2], eff[3]];
            // ApplyComposite(original, effect)
            let res;
            if (composite === 0) {
              res = eff; // 仅返回效果
            } else if (composite === 1) {
              const eb = applyBlending(blendMode, [old[0], old[1], old[2]], [eff[0], eff[1], eff[2]], eff[3] * compAlpha);
              res = [eb[0], eb[1], eb[2], Math.max(eff[3] * Math.min(1, compAlpha), old[3])];
            } else if (composite === 2) {
              const ea = eff[3] * Math.min(1, compAlpha);
              res = [
                eff[0] + (old[0] - eff[0]) * old[3],
                eff[1] + (old[1] - eff[1]) * old[3],
                eff[2] + (old[2] - eff[2]) * old[3],
                ea + old[3] * (1 - ea),
              ];
            } else {
              const ea = eff[3] * Math.min(1, compAlpha) * (1 - old[3]);
              res = [eff[0], eff[1], eff[2], ea];
            }
            // mix(original, composite, mask)
            res = [
              old[0] + (res[0] - old[0]) * mask,
              old[1] + (res[1] - old[1]) * mask,
              old[2] + (res[2] - old[2]) * mask,
              old[3] + (res[3] - old[3]) * mask,
            ];
            if (keepAlpha) res[3] = old[3];
            const di = (y * W + x) * 4;
            out[di] = Math.round(Math.min(1, Math.max(0, res[0])) * 255);
            out[di + 1] = Math.round(Math.min(1, Math.max(0, res[1])) * 255);
            out[di + 2] = Math.round(Math.min(1, Math.max(0, res[2])) * 255);
            out[di + 3] = Math.round(Math.min(1, Math.max(0, res[3])) * 255);
          }
        }
        return { width: W, height: H, rgba: out };
      }
};
