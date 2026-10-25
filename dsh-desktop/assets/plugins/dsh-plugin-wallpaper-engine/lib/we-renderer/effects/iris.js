// WE 渲染引擎 — 效果 Iris (从 effects.js 拆分, 逻辑零改动)
import { parseVec3, parseVec2, getVal } from '../math.js';

export const fx = {
      // iris (引擎 shader: effects/iris.frag/vert): 虹膜位移 (眼球呼吸运动)
      //   vert: time=t·speed+phase; lowDt=floor(time)
      //         moveStart = sin(1.9·lowDt) + sin(2.5·lowDt+(1,2)); moveEnd = sin(1.9·(lowDt+1)) + sin(2.5·(lowDt+1)+(1,2))
      //         da = mix(moveStart, moveEnd, smoothstep(1-rough, 1, cos(frac(time)·π)·(−0.5)+0.5))
      //         da += (sin(time), cos(time))·noiseAmount; da ×= scale·0.001
      //   frag: iris = sample(tex0, uv + da·mask)  [MASK: mask=tex1.r, irisMask 用于 BACKGROUND 混色]
      //   uniform: scale/speed/rough/noiseamount/phase/color; MASK/BACKGROUND combo

    effectIris(tex, c, t, pass) {
        const scale = parseVec2(getVal(c, 'scale', '1 1'), [1, 1]);
        const speed = getVal(c, 'speed', 1);
        const rough = getVal(c, 'rough', 0.2);
        const noiseAmount = getVal(c, 'noiseamount', 0.5);
        const phaseOffset = getVal(c, 'phase', 0);
        const eyeColor = parseVec3(getVal(c, 'color', '1 1 1'), [1, 1, 1]);
        const combos = (pass && pass.combos) || {};
        const hasMask = combos.MASK === '1' || combos.MASK === 1;
        const hasBg = combos.BACKGROUND === '1' || combos.BACKGROUND === 1;
        const pt = (pass && pass.textures) || [];
        const maskTex = hasMask && pt[1] && pt[1] !== 'null' ? this.loadTexture(pt[1]) : null;
        const W = tex.width, H = tex.height;
        const src = tex.rgba;
        const out = new Uint8Array(src.length);
        // vert 预计算 (虹膜位移量, UV 单位)
        const time = t * speed + phaseOffset;
        const lowDt = Math.floor(time);
        const s2 = (k) => Math.sin(1.9 * (lowDt + k));
        const s4 = (k, ph) => Math.sin(2.5 * (lowDt + k) + ph);
        const moveStart = [s2(0) + s4(0, 1), s2(0) + s4(1, 2)];
        const moveEnd = [s2(1) + s4(1, 1), s2(1) + s4(1, 2)];
        const cx = Math.cos((time - Math.floor(time)) * Math.PI) * -0.5 + 0.5;
        const ss = (a, b, x) => {
          const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
          return k * k * (3 - 2 * k);
        };
        const f = ss(1 - rough, 1, cx);
        let dx = moveStart[0] + (moveEnd[0] - moveStart[0]) * f;
        let dy = moveStart[1] + (moveEnd[1] - moveStart[1]) * f;
        dx += Math.sin(time) * noiseAmount;
        dy += Math.cos(time) * noiseAmount;
        dx *= scale[0] * 0.001;
        dy *= scale[1] * 0.001;
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const u = (x + 0.5) / W, v = (y + 0.5) / H;
            let s;
            if (maskTex) {
              const mask = this._texSample(maskTex, u, v)[0];
              const ox = dx * mask, oy = dy * mask;
              s = this._texSample(tex, u + ox, v + oy);
              if (hasBg) {
                const irisMask = this._texSample(maskTex, u + ox, v + oy)[0];
                s = [
                  eyeColor[0] + (s[0] - eyeColor[0]) * irisMask,
                  eyeColor[1] + (s[1] - eyeColor[1]) * irisMask,
                  eyeColor[2] + (s[2] - eyeColor[2]) * irisMask,
                  s[3],
                ];
              }
            } else {
              s = this._texSample(tex, u + dx, v + dy);
            }
            const di = (y * W + x) * 4;
            out[di] = Math.round(s[0] * 255); out[di + 1] = Math.round(s[1] * 255);
            out[di + 2] = Math.round(s[2] * 255); out[di + 3] = Math.round(s[3] * 255);
          }
        }
        return { width: W, height: H, rgba: out };
      }
};
