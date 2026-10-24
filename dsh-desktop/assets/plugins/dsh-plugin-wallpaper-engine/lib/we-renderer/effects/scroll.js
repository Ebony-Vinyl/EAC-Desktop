// WE 渲染引擎 — 效果 Scroll (从 effects.js 拆分, 逻辑零改动)
import { parseVec2, getVal, _frac } from '../math.js';

export const fx = {
    effectScroll(tex, c, t) {
        const rep = parseVec2(getVal(c, 'repeat', '1 1'), [1, 1]);
        const sx = getVal(c, 'speedx', 0.2);
        const sy = getVal(c, 'speedy', 0.2);
        const scrollX = Math.sign(sx) * sx * sx * t;
        const scrollY = Math.sign(sy) * sy * sy * t;
        const w = tex.width, h = tex.height;
        const src = tex.rgba;
        const out = new Uint8Array(src.length);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const u = (x + 0.5) / w, v = (y + 0.5) / h;
            const nu = _frac((u + scrollX) * rep[0]);
            const nv = _frac((v + scrollY) * rep[1]);
            const s = this._texSample(tex, nu, nv);
            const di = (y * w + x) * 4;
            out[di] = Math.round(s[0] * 255); out[di + 1] = Math.round(s[1] * 255);
            out[di + 2] = Math.round(s[2] * 255); out[di + 3] = Math.round(s[3] * 255);
          }
        }
        return { width: w, height: h, rgba: out };
      }
};
