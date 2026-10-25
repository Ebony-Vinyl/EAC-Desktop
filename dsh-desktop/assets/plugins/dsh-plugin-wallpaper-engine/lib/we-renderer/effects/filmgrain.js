// WE 渲染引擎 — 效果 Filmgrain (从 effects.js 拆分, 逻辑零改动)
import { getVal, applyBlending, _greyscale, _sat3 } from '../math.js';

export const fx = {
    effectFilmgrain(tex, c, t, combos, pass) {
        const mode = combos.BLENDMODE || 12; // 默认 softlight
        const greyscale = combos.GREYSCALE != null ? combos.GREYSCALE : 1;
        const noiseAlpha = getVal(c, 'ui_editor_properties_strength', 2);
        const noisePower = getVal(c, 'ui_editor_properties_power', 0.5);
        const noiseScale = getVal(c, 'ui_editor_properties_scale', 10);
        const tex1 = pass.textures && pass.textures[1] ? this.loadTexture(pass.textures[1]) : this.loadTexture('util/noise');
        const hasMask = combos.MASK === 1;
        const tex2 = hasMask && pass.textures && pass.textures[2] ? this.loadTexture(pass.textures[2]) : null;
        const aspect = tex.width / tex.height;
        const w = tex.width, h = tex.height;
        // 官方 filmgrain.vert: v_TexCoord.zw mask UV 缩放 (maskRes/对象Res) (sf39i)
        const mSx = tex2 && tex2.width > 0 ? tex2.width / tex.width : 1;
        const mSy = tex2 && tex2.height > 0 ? tex2.height / tex.height : 1;
        const out = new Uint8Array(tex.rgba.length);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const u = (x + 0.5) / w, v = (y + 0.5) / h;
            const s = this._texSample(tex, u, v);
            // v_TexCoordNoise.xy = (uv + t) * scale * (aspect,1); .zw = (uv - t*2.5) * scale * 0.52 * (aspect,1)
            // 官方 vert: t = frac(g_Time) (sf39i)
            const tf = t - Math.floor(t);
            const n1 = tex1 ? this._texSample(tex1, (u + tf) * noiseScale * aspect, (v + tf) * noiseScale) : [1, 1, 1, 1];
            const n2 = tex1 ? this._texSample(tex1, (u - tf * 2.5) * noiseScale * 0.52 * aspect, (v - tf * 2.5) * noiseScale * 0.52) : [1, 1, 1, 1];
            let noise = [n1[0], n1[1], n1[2]];
            let noise2 = [n2[1], n2[2], n2[0]]; // .gbr
            if (greyscale === 1) {
              const g1 = _greyscale(noise), g2 = _greyscale(noise2);
              noise = [g1, g1, g1]; noise2 = [g2, g2, g2];
            }
            const mul = _sat3([noise[0] * noise2[0], noise[1] * noise2[1], noise[2] * noise2[2]]);
            const np = mul.map((v) => Math.pow(v, noisePower));
            let blend = noiseAlpha;
            if (tex2) blend *= this._texSample(tex2, u * mSx, v * mSy)[0];
            const rgb = applyBlending(mode, [s[0], s[1], s[2]], np, blend);
            const di = (y * w + x) * 4;
            out[di] = Math.round(rgb[0] * 255); out[di + 1] = Math.round(rgb[1] * 255);
            out[di + 2] = Math.round(rgb[2] * 255); out[di + 3] = Math.round(s[3] * 255);
          }
        }
        return { width: w, height: h, rgba: out };
      }
};
