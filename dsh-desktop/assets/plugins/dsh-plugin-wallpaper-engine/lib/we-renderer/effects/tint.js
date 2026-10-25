// WE 渲染引擎 — 效果 Tint (从 effects.js 拆分, 逻辑零改动)
import { parseVec3, getVal, applyBlending } from '../math.js';

export const fx = {
    effectTint(tex, c, t, combos, pass) {
        // 官方 tint.frag: BLENDMODE 默认 30 (注释), mask = alpha × maskTex.r (MASK)
        // 旧实现默认 2(multiply) + 缺 mask (sf39i)
        const mode = combos.BLENDMODE != null ? Number(combos.BLENDMODE) : 30;
        const alpha = getVal(c, 'alpha', 1);
        const color = parseVec3(getVal(c, 'color', '1 1 1'), [1, 1, 1]);
        const hasMask = combos.MASK === '1' || combos.MASK === 1;
        const pt = (pass && pass.textures) || [];
        const maskTex = hasMask && pt[1] && pt[1] !== 'null' ? this.loadTexture(pt[1]) : null;
        const w = tex.width, h = tex.height;
        const mSx = maskTex && maskTex.width > 0 ? maskTex.width / tex.width : 1;
        const mSy = maskTex && maskTex.height > 0 ? maskTex.height / tex.height : 1;
        const src = tex.rgba;
        const out = new Uint8Array(src.length);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const u = (x + 0.5) / w, v = (y + 0.5) / h;
            const s = this._texSample(tex, u, v);
            let a = alpha;
            if (maskTex) a *= this._texSample(maskTex, u * mSx, v * mSy)[0];
            const rgb = applyBlending(mode, [s[0], s[1], s[2]], color, a);
            const di = (y * w + x) * 4;
            out[di] = Math.round(rgb[0] * 255); out[di + 1] = Math.round(rgb[1] * 255);
            out[di + 2] = Math.round(rgb[2] * 255); out[di + 3] = Math.round(s[3] * 255);
          }
        }
        return { width: w, height: h, rgba: out };
      }
};
