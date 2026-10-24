// WE 渲染引擎 — 效果 Shimmer (从 effects.js 拆分, 逻辑零改动)
import { parseVec3, getVal, applyBlending } from '../math.js';

export const fx = {
      // shimmer (引擎 shader: effects/shimmer.frag/vert): 扫光渐变 (旋转 UV + 时间扫过)
      //   vert: v_TexCoord = uv.xyxy; v_TexCoord2 = uv (OFFSET 纹理)
      //   frag: shimmerCoord = rotate(uv, −dir+π/2)·scale
      //         MODE=0 线性: x += offset + speed·(t+off); MODE=1 镜像: x += offset + width·sin(speed·t+off)
      //         x = saturate(frac(x/(scale·delay))·scale·delay); 采样 gradient → ApplyBlending → mix
      //   uniform: direction/scale/speed/delay/width/amount/offset/timeoffsetScale/color
      //     MASK/OFFSET/MODE/BLENDMODE combo; gradient 默认 gradient_ferro_fluid

    effectShimmer(tex, c, t, pass) {
        const direction = getVal(c, 'direction', Math.PI / 2);
        const scale = getVal(c, 'scale', 1);
        const speed = getVal(c, 'speed', 1);
        const delay = getVal(c, 'delay', 2);
        const width = getVal(c, 'width', 1);
        const amount = getVal(c, 'amount', 1);
        const offset = getVal(c, 'offset', 0);
        const timeoffsetScale = getVal(c, 'timeoffsetScale', 0.05);
        const color = parseVec3(getVal(c, 'color', '1 1 1'), [1, 1, 1]);
        const combos = (pass && pass.combos) || {};
        const hasMask = combos.MASK === '1' || combos.MASK === 1;
        const hasOffset = combos.OFFSET === '1' || combos.OFFSET === 1;
        const mode = combos.MODE === '1' || combos.MODE === 1 ? 1 : 0;
        const blendMode = combos.BLENDMODE != null ? Number(combos.BLENDMODE) : 32;
        const pt = (pass && pass.textures) || [];
        const maskTex = hasMask && pt[1] && pt[1] !== 'null' ? this.loadTexture(pt[1]) : null;
        const offsetTex = hasOffset && pt[2] && pt[2] !== 'null' ? this.loadTexture(pt[2]) : null;
        const gradTex = pt[3] && pt[3] !== 'null' ? this.loadTexture(pt[3]) : this.loadTexture('gradient/gradient_ferro_fluid');
        const W = tex.width, H = tex.height;
        const src = tex.rgba;
        const out = new Uint8Array(src.length);
        const cosD = Math.cos(-direction + Math.PI / 2), sinD = Math.sin(-direction + Math.PI / 2);
        const frac = (x) => x - Math.floor(x);
        const sat = (x) => Math.min(1, Math.max(0, x));
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const u = (x + 0.5) / W, v = (y + 0.5) / H;
            const albedo = this._texSample(tex, u, v);
            let mask = 1;
            if (maskTex) mask = this._texSample(maskTex, u, v)[0];
            let off = 0;
            if (offsetTex) off = this._texSample(offsetTex, u, v)[0] * timeoffsetScale;
            // rotateVec2(uv, −dir+π/2) · scale
            let sx = (u * cosD - v * sinD) * scale;
            const sy = (u * sinD + v * cosD) * scale;
            if (mode === 1) sx += offset + width * Math.sin(speed * t + off);
            else sx += offset + speed * (t + off);
            sx = sat(frac(sx / (scale * delay)) * scale * delay);
            const shimmerColor = this._texSample(gradTex, frac(sx), frac(sy));
            const eff = [
              shimmerColor[0] * color[0], shimmerColor[1] * color[1], shimmerColor[2] * color[2],
            ];
            const blended = applyBlending(blendMode, [albedo[0], albedo[1], albedo[2]], eff, 1);
            // mix 因子 = mask·shimmerColor·amount (vec3 逐通道)
            const f = mask * amount;
            const rgb = [
              albedo[0] + (blended[0] - albedo[0]) * (shimmerColor[0] * f),
              albedo[1] + (blended[1] - albedo[1]) * (shimmerColor[1] * f),
              albedo[2] + (blended[2] - albedo[2]) * (shimmerColor[2] * f),
            ];
            const di = (y * W + x) * 4;
            out[di] = Math.round(rgb[0] * 255);
            out[di + 1] = Math.round(rgb[1] * 255);
            out[di + 2] = Math.round(rgb[2] * 255);
            out[di + 3] = Math.round(albedo[3] * 255);
          }
        }
        return { width: W, height: H, rgba: out };
      }
};
