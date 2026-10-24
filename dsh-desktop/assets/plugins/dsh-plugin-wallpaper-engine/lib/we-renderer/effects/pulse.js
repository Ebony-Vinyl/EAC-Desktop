// WE 渲染引擎 — 效果 Pulse (从 effects.js 拆分, 逻辑零改动)
import { parseVec3, parseVec2, getVal, applyBlending } from '../math.js';

export const fx = {
      // pulse: 官方 shader 数学 (effects/pulse.frag/vert)
      //   vert (AUDIOPROCESSING=0): v_Pulse = smoothstep(bounds.x, bounds.y,
      //     sin(time×speed + (phase−0.25)×2π)×0.5+0.5) × amount
      //   frag: pulse += sample(noise, time×0.0833, time×0.0278 ×noiseSpeed).r × noiseAmount;
      //         pulse = pow(pulse, power);
      //   PULSECOLOR: albedo.rgb = ApplyBlending(BLENDMODE, albedo.rgb×tintLow,
      //     albedo.rgb×tintHigh, pulse)
      //   PULSEALPHA: albedo.a *= pulse; MASK: mix(sample, albedo, mask.r)
      //   旧实现缺时间正弦脉冲 (非音频分支 pulse=1) → 效果不工作。

    effectPulse(tex, c, t, combos, pass) {
        const mode = combos.BLENDMODE || 9;
        const speed = getVal(c, 'speed', 3);
        const phase = getVal(c, 'phase', 0);
        const amount = getVal(c, 'amount', 1);
        const bounds = parseVec2(getVal(c, 'bounds', '0 1'), [0, 1]);
        const noiseSpeed = getVal(c, 'noisespeed', 0.5);
        const noiseAmount = getVal(c, 'noiseamount', 0);
        const power = getVal(c, 'power', 1);
        const tintLow = parseVec3(getVal(c, 'tintlow', '1 1 1'), [1, 1, 1]);
        const tintHigh = parseVec3(getVal(c, 'tinthigh', '1 1 1'), [1, 1, 1]);
        const pulseAlpha = combos.PULSEALPHA === '1' || combos.PULSEALPHA === 1;
        const pulseColor = combos.PULSECOLOR !== '0' && combos.PULSECOLOR !== 0;
        const hasMask = combos.MASK === '1' || combos.MASK === 1;
        const pt = (pass && pass.textures) || [];
        const maskTex = hasMask && pt[2] && pt[2] !== 'null' ? this.loadTexture(pt[2]) : null;
        const noiseTex = this.loadTexture('util/noise');
        const w = tex.width, h = tex.height;
        const src = tex.rgba;
        const out = new Uint8Array(src.length);
        // 音频响应 (引擎 pulse.vert AUDIOPROCESSING): v_Pulse = CreateAudioResponse(...)
        let pulse = 1;
        const audioMode = combos.AUDIOPROCESSING || 0;
        if (audioMode > 0) {
          pulse = this.audioSpectrum ? this._createAudioResponse(this.audioSpectrum, c, audioMode) : 0;
        } else {
          // 官方非音频: smoothstep(bounds, sin(time×speed + (phase − π/2))×0.5+0.5) × amount
          // g_PulsePhase range [0,6.282] 弧度 — 旧实现 (phase−0.25)×2π 把 phase 当
          // 0-1 归一化再乘 2π → phase=3(弧度) 时错算成 17.3 (sf39h)
          const sv = Math.sin(t * speed + (phase - 1.57079632679)) * 0.5 + 0.5;
          const k = Math.max(0, Math.min(1, (sv - bounds[0]) / Math.max(1e-6, bounds[1] - bounds[0])));
          pulse = (k * k * (3 - 2 * k)) * amount;
          // noise 调制
          if (noiseAmount > 0 && noiseTex) {
            const n = this._texSample(noiseTex, t * 0.08333333 * noiseSpeed, t * 0.02777777 * noiseSpeed)[0] * noiseAmount;
            pulse += n;
          }
          pulse = Math.pow(Math.max(0, pulse), power);
        }
        const pulseC = Math.max(0, Math.min(1, pulse));
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const u = (x + 0.5) / w, v = (y + 0.5) / h;
            const s = this._texSample(tex, u, v);
            let rgb = [s[0], s[1], s[2]], a = s[3];
            if (pulseColor) {
              // ApplyBlending(BLENDMODE, albedo.rgb×tintLow, albedo.rgb×tintHigh, pulse)
              const A = [s[0] * tintLow[0], s[1] * tintLow[1], s[2] * tintLow[2]];
              const B = [s[0] * tintHigh[0], s[1] * tintHigh[1], s[2] * tintHigh[2]];
              rgb = applyBlending(mode, A, B, pulseC);
            }
            if (pulseAlpha) a = s[3] * pulseC;
            if (maskTex) {
              const mk = this._texSample(maskTex, u, v)[0];
              rgb = [rgb[0] * mk + s[0] * (1 - mk), rgb[1] * mk + s[1] * (1 - mk), rgb[2] * mk + s[2] * (1 - mk)];
              a = a * mk + s[3] * (1 - mk);
            }
            const di = (y * w + x) * 4;
            out[di] = Math.round(Math.max(0, rgb[0]) * 255); out[di + 1] = Math.round(Math.max(0, rgb[1]) * 255);
            out[di + 2] = Math.round(Math.max(0, rgb[2]) * 255); out[di + 3] = Math.round(a * 255);
          }
        }
        return { width: w, height: h, rgba: out };
      }
};
