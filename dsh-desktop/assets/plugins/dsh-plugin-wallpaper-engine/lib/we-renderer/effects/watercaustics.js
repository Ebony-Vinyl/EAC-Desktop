// WE 渲染引擎 — 效果 WaterCaustics (从 effects.js 拆分, 逻辑零改动)
import { parseVec3, getVal, applyBlending, smoothstepFn } from '../math.js';

export const fx = {
      // watercaustics (官方 effects/watercaustics/caustics.frag):
      //   4 组噪声/图案坐标 (perlin/uniform/voronoi) 按时间卷动 + distortion 扰动
      //   3 通道 chromatic 采样 voronoi_local → caustics; MODE 0: smoothstep 阈值
      //   MODE 1: 阈值+粒子; rgb = ApplyBlending(BLENDMODE, albedo, causticsColor, mask·causticsSample)
      //   uniform: brightness/glow/granularity/speed/time_offset/distortion/chromatic/blur/color1/color2
      //   MODE/BLENDMODE/MASK combo
    effectWaterCaustics(tex, c, t, pass) {
        const combos = (pass && pass.combos) || {};
        const blendMode = combos.BLENDMODE != null ? Number(combos.BLENDMODE) : 32;
        const mode = combos.MODE != null ? Number(combos.MODE) : 0;
        const hasMask = combos.MASK === '1' || combos.MASK === 1;
        const brightness = getVal(c, 'ui_editor_properties_brightness', 1);
        const glow = getVal(c, 'ui_editor_properties_glow', 0.5);
        const uScale = getVal(c, 'ui_editor_properties_granularity', 2);
        const speed = getVal(c, 'ui_editor_properties_speed', 1);
        const timeOffset = getVal(c, 'ui_editor_properties_time_offset', 0);
        const distortion = getVal(c, 'ui_editor_properties_distortion', 1);
        const chromatic = getVal(c, 'ui_editor_properties_chromatic_aberration', 1);
        const uBlur = getVal(c, 'ui_editor_properties_blur', 0);
        const color1 = parseVec3(getVal(c, 'ui_editor_properties_color_start', '0.7 0.9 1'), [0.7, 0.9, 1]);
        const color2 = parseVec3(getVal(c, 'ui_editor_properties_color_end', '0.4 0.6 1'), [0.4, 0.6, 1]);
        const pt = (pass && pass.textures) || [];
        const maskTex = hasMask && pt[1] && pt[1] !== 'null' ? this.loadTexture(pt[1]) : null;
        const voronoiLocal = this.loadTexture(pt[2] && pt[2] !== 'null' ? pt[2] : 'pattern/voronoi_local');
        const voronoi = this.loadTexture(pt[5] && pt[5] !== 'null' ? pt[5] : 'pattern/voronoi');
        const uniform256 = this.loadTexture(pt[3] && pt[3] !== 'null' ? pt[3] : 'util/uniform_256');
        const perlin256 = this.loadTexture(pt[4] && pt[4] !== 'null' ? pt[4] : 'util/perlin_256');
        const W = tex.width, H = tex.height;
        const src = tex.rgba;
        const out = new Uint8Array(src.length);
        const ratio = W / H;
        const time = t * speed + timeOffset;
        const mSx = maskTex ? maskTex.width / W : 1, mSy = maskTex ? maskTex.height / H : 1;
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const u = (x + 0.5) / W, v = (y + 0.5) / H;
            const albedo = this._texSample(tex, u, v);
            let mask = 1;
            if (maskTex) mask = this._texSample(maskTex, u * mSx, v * mSy)[0];
            // causticsCoords = uv·(ratio,1)·granularity
            let cx = u * ratio * uScale, cy = v * uScale;
            const noiseCoords = [cx * 0.02 + time * 0.005, cy * 0.02];
            const noiseCoords2 = [cx * 0.0333, cy * 0.0333 + time * 0.004111];
            const blendCoords = [cx * 0.01333 + time * 0.003777, cy * 0.01333 + time * 0.003777];
            const shiftCoords = [cx * 0.05 + time * 0.01, cy * 0.05 + time * 0.01];
            const shiftC = this._texSample(perlin256, shiftCoords[0], shiftCoords[1]);
            const shift = [shiftC[0] * 2 - 1, shiftC[1] * 2 - 1];
            const n1 = this._texSample(uniform256, noiseCoords[0], noiseCoords[1]);
            const n2 = this._texSample(uniform256, noiseCoords2[0], noiseCoords2[1]);
            cx += (n1[0] * 2 - 1) * 0.025 * distortion + (n2[0] * 2 - 1) * 0.025 * distortion + shift[0] * distortion;
            cy += (n1[1] * 2 - 1) * 0.025 * distortion + (n2[1] * 2 - 1) * 0.025 * distortion + shift[1] * distortion;
            // chromatic 3 通道采样
            const caustics = [
              this._texSample(voronoiLocal, cx - 0.01 * chromatic, cy)[0],
              this._texSample(voronoiLocal, cx, cy)[0],
              this._texSample(voronoiLocal, cx + 0.01 * chromatic, cy)[0],
            ];
            const glowSample = this._texSample(voronoi, cx, cy)[0];
            const blendColor = this._texSample(uniform256, blendCoords[0], blendCoords[1]);
            // caustics = mix(caustics, vec3(glowSample), u_blur)
            const cb = [
              caustics[0] + (glowSample - caustics[0]) * uBlur,
              caustics[1] + (glowSample - caustics[1]) * uBlur,
              caustics[2] + (glowSample - caustics[2]) * uBlur,
            ];
            let causticsSample, causticsColor;
            if (mode === 1) {
              const cs = cb[1];
              const blendThreshold = Math.max(0.3, blendColor[0] - shift[0]);
              const particleNoise = this._texSample(uniform256, shiftCoords[0], shiftCoords[1])[0];
              const particleSample = smoothstepFn(blendThreshold, blendThreshold - 0.001, cs) * (particleNoise * cs >= 0.3 ? 1 : 0);
              causticsSample = smoothstepFn(blendThreshold, blendThreshold + 0.001, cs) + particleSample;
              causticsSample = Math.min(1, Math.max(0, causticsSample + glowSample * glow));
              const cmix = smoothstepFn(0, 0.5, blendColor[0]);
              causticsColor = [
                brightness * (color1[0] + (color2[0] - color1[0]) * cmix),
                brightness * (color1[1] + (color2[1] - color1[1]) * cmix),
                brightness * (color1[2] + (color2[2] - color1[2]) * cmix),
              ];
            } else {
              causticsSample = (cb[0] + cb[1] + cb[2]) / 3;
              causticsSample = smoothstepFn(blendColor[0] * 0.8, 1.0 - blendColor[1] * 0.2, causticsSample + glowSample * glow);
              causticsColor = [
                brightness * (color1[0] + (color2[0] - color1[0]) * blendColor[0]) * cb[0],
                brightness * (color1[1] + (color2[1] - color1[1]) * blendColor[1]) * cb[1],
                brightness * (color1[2] + (color2[2] - color1[2]) * blendColor[2]) * cb[2],
              ];
            }
            const rgb = applyBlending(blendMode, [albedo[0], albedo[1], albedo[2]], causticsColor, mask * causticsSample);
            const di = (y * W + x) * 4;
            out[di] = Math.round(Math.min(1, Math.max(0, rgb[0])) * 255);
            out[di + 1] = Math.round(Math.min(1, Math.max(0, rgb[1])) * 255);
            out[di + 2] = Math.round(Math.min(1, Math.max(0, rgb[2])) * 255);
            out[di + 3] = Math.round(albedo[3] * 255);
          }
        }
        return { width: W, height: H, rgba: out };
      }
};
