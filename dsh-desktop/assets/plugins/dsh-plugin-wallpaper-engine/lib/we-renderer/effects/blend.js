// WE 渲染引擎 — 效果 Blend (从 effects.js 拆分, 逻辑零改动)
import { getVal, applyBlending } from '../math.js';

export const fx = {
      // blend (官方 effects/blend, 单 pass):
      //   blendUV = v_TexCoord.zw (blend 纹理 UV 缩放); blend = OPACITYMASK·GetUVBlend
      //   PerformBlend: WRITEALPHA=1 时 alpha 合成 (premultiplied 数学);
      //     否则 blendAlpha·= blendColors.a; rgb = ApplyBlending(BLENDMODE, albedo, blendColors, blendAlpha)
      //   uniform: multiply/alpha; combos: BLENDMODE/WRITEALPHA/TRANSFORMUV/TRANSFORMREPEAT/
      //     NUMBLENDTEXTURES/OPACITYMASK; blend 纹理 = textures[1]
    effectBlend(tex, passes, c, t, pass) {
        const p = (passes && passes[0]) || {};
        const combos = p.combos || {};
        const c1 = p.constantshadervalues || {};
        const blendMode = combos.BLENDMODE != null ? Number(combos.BLENDMODE) : 2;
        const writeAlpha = combos.WRITEALPHA === '1' || combos.WRITEALPHA === 1;
        const numTextures = combos.NUMBLENDTEXTURES != null ? Number(combos.NUMBLENDTEXTURES) : 1;
        const opMask = combos.OPACITYMASK === '1' || combos.OPACITYMASK === 1;
        const transformUV = combos.TRANSFORMUV === '1' || combos.TRANSFORMUV === 1;
        const transformRepeat = combos.TRANSFORMREPEAT === '1' || combos.TRANSFORMREPEAT === 1;
        const multiply = getVal(c1, 'multiply', getVal(c, 'multiply', 1));
        const pt = p.textures || [];
        const blendTex = pt[1] && pt[1] !== 'null' ? this.loadTexture(pt[1]) : null;
        const opMaskTex = opMask && pt[7] && pt[7] !== 'null' ? this.loadTexture(pt[7]) : null;
        const W = tex.width, H = tex.height;
        const src = tex.rgba;
        const out = new Uint8Array(src.length);
        const bSx = blendTex ? blendTex.width / W : 1, bSy = blendTex ? blendTex.height / H : 1;
        const oSx = opMaskTex ? opMaskTex.width / W : 1, oSy = opMaskTex ? opMaskTex.height / H : 1;
        const step01 = (x) => (x >= 0.01 ? 1 : 0);
        const performBlend = (albedo, bc, blendAlpha) => {
          if (writeAlpha) {
            const newAlpha = albedo[3] * (1 - blendAlpha) + bc[3] * blendAlpha;
            const rgb = [
              albedo[0] * albedo[3] * (1 - blendAlpha) + bc[0] * bc[3] * blendAlpha,
              albedo[1] * albedo[3] * (1 - blendAlpha) + bc[1] * bc[3] * blendAlpha,
              albedo[2] * albedo[3] * (1 - blendAlpha) + bc[2] * bc[3] * blendAlpha,
            ];
            const s = step01(albedo[3]) * (1 - bc[3] * blendAlpha);
            const d = step01(bc[3] * (1 - albedo[3] * (1 - blendAlpha)));
            for (let i = 0; i < 3; i++) {
              const srcRgb = bc[i] + (albedo[i] - bc[i]) * s;
              const dstRgb = albedo[i] + (bc[i] - albedo[i]) * d;
              rgb[i] += (srcRgb + (dstRgb - srcRgb) * blendAlpha) * (1 - newAlpha);
            }
            return [rgb[0], rgb[1], rgb[2], newAlpha];
          }
          const ba = blendAlpha * bc[3];
          const rgb2 = applyBlending(blendMode, [albedo[0], albedo[1], albedo[2]], [bc[0], bc[1], bc[2]], ba);
          return [rgb2[0], rgb2[1], rgb2[2], albedo[3]];
        };
        const frac2 = (x) => x - Math.floor(x);
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const u = (x + 0.5) / W, v = (y + 0.5) / H;
            const albedo = this._texSample(tex, u, v);
            let blendUV = [u * bSx, v * bSy];
            if (transformUV && transformRepeat === 1) blendUV = [frac2(blendUV[0]), frac2(blendUV[1])];
            const bc = blendTex ? this._texSample(blendTex, blendUV[0], blendUV[1]) : [1, 1, 1, 1];
            let blend = 1;
            if (opMaskTex) blend *= this._texSample(opMaskTex, u * oSx, v * oSy)[0];
            // GetUVBlend: TRANSFORMUV+clip 时越界 UV 禁止混合
            if (transformUV && transformRepeat === 0) {
              const inside = blendUV[0] >= 0 && blendUV[0] <= 1 && blendUV[1] >= 0 && blendUV[1] <= 1;
              blend *= inside ? 1 : 0;
            }
            const res = performBlend(albedo, bc, blend * multiply);
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
