// WE 渲染引擎 — 效果 Shake (从 effects.js 拆分, 逻辑零改动)
import { parseVec2 } from '../math.js';

export const fx = {
    effectShake(tex, c, t, pass) {
        const speed = c.speed != null ? c.speed : 1;
        const strength = c.strength != null ? c.strength : 0.1;
        const fr = parseVec2(c.friction, [1, 1]);
        const fx = fr[0] || 1, fy = fr[1] || 1;
        const bd = parseVec2(c.bounds, [0, 1]);
        const bx = bd[0] || 0, by = bd[1] || 1;
        const pt = (pass && pass.textures) || [];
        const flowTex = pt[1] && pt[1] !== 'null' ? this.loadTexture(pt[1]) : null;
        const w = tex.width, h = tex.height;
        // 官方 shake.vert: flow UV 缩放 (flowRes/对象Res) (sf39i)
        const mSx = flowTex && flowTex.width > 0 ? flowTex.width / tex.width : 1;
        const mSy = flowTex && flowTex.height > 0 ? flowTex.height / tex.height : 1;
        const src = tex.rgba;
        const out = new Uint8Array(src.length);
        const M_PI_2 = Math.PI / 2;
        const s2 = strength * strength;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const u = (x + 0.5) / w, v = (y + 0.5) / h;
            const time = speed * t;
            let offset = Math.sin((time / M_PI_2 - Math.floor(time / M_PI_2)) * M_PI_2);
            offset = offset * 0.498 + 0.5;
            const base = Math.cos(time) >= 0 ? 1 : 0;
            offset = base >= 0.5 ? Math.pow(offset, fy) : 1 - Math.pow(1 - offset, fx);
            offset = Math.max(0, Math.min(1, (offset - bx) / (by - bx || 1)));
            offset = offset * 2 - 1;
            // flowMask: 方向图 (无 → 0; 官方默认 util/noflow 中心灰 → 无位移)
            let fmx = 0, fmy = 0;
            if (flowTex) {
              const fm = this._texSample(flowTex, u * mSx, v * mSy);
              fmx = (fm[0] - 0.498) * 2;
              fmy = (fm[1] - 0.498) * 2;
            }
            const sx = Math.max(0, Math.min(w - 1, Math.round(u * w + offset * s2 * fmx)));
            const sy = Math.max(0, Math.min(h - 1, Math.round(v * h + offset * s2 * fmy)));
            const si = (sy * w + sx) * 4, di = (y * w + x) * 4;
            out[di] = src[si]; out[di+1] = src[si+1]; out[di+2] = src[si+2]; out[di+3] = src[si+3];
          }
        }
        return { width: w, height: h, rgba: out };
      }
};
