// WE 渲染引擎 — 效果 Waterflow (从 effects.js 拆分, 逻辑零改动)
import { getVal } from '../math.js';

export const fx = {
      // waterflow (引擎 shader: effects/waterflow.frag/vert): flow map 位移 +
      // 双周期循环混合 (flowmask RG → 位移方向, 两相 0/0.5 与 0.25/0.75 混合)
      //   vert: cycles = (frac(t·s), frac(t·s+0.5), frac(0.25+t·s), frac(0.25+t·s+0.5))
      //         blend = smoothstep(0.5−f, 0.5+f, 2·|cycle−0.5|); cycles −= 0.5
      //   frag: flowMask = (flowColor.rg − 0.498)·2; amount = length(flowMask)
      //         off = flowMask·amp·0.1·cycle; fa = mix(样2, blend); fa2 = mix(样2, blend2)
      //         fa = mix(fa, fa2, smoothstep(0.2,0.8, phase)); out = mix(原, fa, amount)
      //   uniform: speed/feather/strength/phasescale; textures=[主, flowmap(util/noflow), timeoffset]
      //   flow map UV (v_TexCoord.zw 按 tex1 分辨率缩放): flow map 通常与主纹理
      //   同尺寸 → 简化用对象 uv

    effectWaterflow(tex, c, t, pass) {
        const W = tex.width, H = tex.height;
        const speed = getVal(c, 'speed', 1);
        const feather = getVal(c, 'feather', 0.4);
        const amp = getVal(c, 'strength', 1);
        const phaseScale = getVal(c, 'phasescale', 2);
        const pt = (pass && pass.textures) || [];
        const flowTex = pt[1] && pt[1] !== 'null' ? this.loadTexture(pt[1]) : this.loadTexture('util/noflow');
        const phaseTex = pt[2] && pt[2] !== 'null' ? this.loadTexture(pt[2]) : null;
        const src = tex.rgba;
        const out = new Uint8Array(src.length);
        const frac = (x) => x - Math.floor(x);
        const smoothstep = (a, b, x) => {
          const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
          return k * k * (3 - 2 * k);
        };
        // vert 预计算
        const st = t * speed;
        const cy = [frac(st), frac(st + 0.5), frac(0.25 + st), frac(0.25 + st + 0.5)];
        const lo = 0.5 - feather, hi = 0.5 + feather;
        const blend = smoothstep(lo, hi, 2 * Math.abs(cy[0] - 0.5));
        const blend2 = smoothstep(lo, hi, 2 * Math.abs(cy[2] - 0.5));
        const cycles = cy.map((x) => x - 0.5);
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const u = (x + 0.5) / W, v = (y + 0.5) / H;
            // frag
            const flowPhase = phaseTex ? this._texSample(phaseTex, u * phaseScale, v * phaseScale)[0] : 0;
            const fc = this._texSample(flowTex, u, v);
            const fx = (fc[0] - 0.498) * 2, fy = (fc[1] - 0.498) * 2;
            const flowAmount = Math.sqrt(fx * fx + fy * fy);
            const k = amp * 0.1;
            const o1x = fx * k * cycles[0], o1y = fy * k * cycles[0];
            const o2x = fx * k * cycles[1], o2y = fy * k * cycles[1];
            const o3x = fx * k * cycles[2], o3y = fy * k * cycles[2];
            const o4x = fx * k * cycles[3], o4y = fy * k * cycles[3];
            const s0 = this._texSample(tex, u, v);
            const s1 = this._texSample(tex, u + o1x, v + o1y);
            const s2 = this._texSample(tex, u + o2x, v + o2y);
            const s3 = this._texSample(tex, u + o3x, v + o3y);
            const s4 = this._texSample(tex, u + o4x, v + o4y);
            const mix2 = (a, b, f) => [
              a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f,
              a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f,
            ];
            let fa = mix2(s1, s2, blend);
            const fa2 = mix2(s3, s4, blend2);
            fa = mix2(fa, fa2, smoothstep(0.2, 0.8, flowPhase));
            const o = mix2(s0, fa, Math.min(1, flowAmount));
            const di = (y * W + x) * 4;
            out[di] = Math.round(o[0] * 255); out[di + 1] = Math.round(o[1] * 255);
            out[di + 2] = Math.round(o[2] * 255); out[di + 3] = Math.round(o[3] * 255);
          }
        }
        return { width: W, height: H, rgba: out };
      }
};
