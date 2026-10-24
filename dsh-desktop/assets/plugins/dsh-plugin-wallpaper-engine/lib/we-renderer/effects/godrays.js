// WE 渲染引擎 — 效果 Godrays (从 effects.js 拆分, 逻辑零改动)
import { parseVec3, parseVec2, getVal, applyBlending } from '../math.js';

export const fx = {
    effectGodrays(tex, passes, t) {
        const W = tex.width, H = tex.height;
        const hw = Math.max(2, W >> 1), hh = Math.max(2, H >> 1);
        const p0 = passes[0] || {}, p1 = passes[1] || {}, p2 = passes[2] || {}, p3 = passes[3] || {}, p4 = passes[4] || {};
        const c0 = p0.constantshadervalues || {}, c1 = p1.constantshadervalues || {}, c2 = p2.constantshadervalues || {}, c3 = p3.constantshadervalues || {};
        const k0 = p0.combos || {}, k1 = p1.combos || {}, k2 = p2.combos || {}, k3 = p3.combos || {}, k4 = p4.combos || {};
        const t0tex = (p0.textures || [])[0] ? this.loadTexture(p0.textures[0]) : null; // 通常 null (framebuffer)
        // g_Texture1: mask (默认 util/white), g_Texture2: albedo 噪声 (默认 util/clouds_256)
        const maskTex = (p0.textures || [])[1] ? this.loadTexture(p0.textures[1]) : this.loadTexture('util/white');
        const noiseTex = (p0.textures || [])[2] ? this.loadTexture(p0.textures[2]) : this.loadTexture('util/clouds_256');
        // 官方 godrays_downsample2.vert: v_TexCoord.zw mask UV 缩放 (maskRes/对象Res) (sf39j)
        const gdSx = maskTex && maskTex.width > 0 ? maskTex.width / tex.width : 1;
        const gdSy = maskTex && maskTex.height > 0 ? maskTex.height / tex.height : 1;
        const threshold = getVal(c0, 'raythreshold', 0.5);
        const noiseAmount = getVal(c0, 'noiseamount', 0.4);
        const noiseSmooth = getVal(c0, 'noisesmoothness', 0.2);
        const noiseSpeed = getVal(c0, 'noisespeed', 0.15);
        const noiseScale = getVal(c0, 'noisescale', 3);
        const center = parseVec2(getVal(c1, 'center', '0.5 0.5'), [0.5, 0.5]);
        const rayLength = getVal(c1, 'raylength', 0.5);
        const rayIntensity = getVal(c1, 'rayintensity', 1);
        const rayColor = parseVec3(getVal(c1, 'color', '1 1 1'), [1, 1, 1]);
        const blurScale = parseVec2(getVal(c2, 'blurscale', '1 1'), [1, 1]);
        const combineMode = k4.BLENDMODE != null ? k4.BLENDMODE : 9; // add
        const noSample = (x, y) => {
          const u = (x + 0.5) / hw, v = (y + 0.5) / hh;
          const n1 = this._texSample(noiseTex, (u + t * noiseSpeed) * noiseScale, (v + t * noiseSpeed) * noiseScale, true);
          const n2x = (v * 0.633 - t * 0.5 * noiseSpeed) * noiseScale;
          const n2y = (-u * 0.633 + t * 0.5 * noiseSpeed) * noiseScale;
          const n2 = this._texSample(noiseTex, n2x, n2y, true);
          return n1[0] * n2[0];
        };
        // ── pass 0: downsample2 (半分辨率) ──
        const half = new Uint8Array(hw * hh * 4);
        for (let y = 0; y < hh; y++) {
          for (let x = 0; x < hw; x++) {
            const u = (x + 0.5) / hw, v = (y + 0.5) / hh;
            const s = t0tex ? this._texSample(t0tex, u, v, true) : this._texSample(tex, u, v, true);
            const mask = maskTex ? this._texSample(maskTex, u * gdSx, v * gdSy, true)[0] : 1;
            // noiseSample = mix(sample.a, sample.a * noise, g_NoiseAmount);  (sample.a 在 premultiply 前)
            const rawNoise = noiseTex ? noSample(x, y) : 1;
            const noiseSample = s[3] + (s[3] * rawNoise - s[3]) * noiseAmount;
            // sample.rgb *= sample.a; sample.a = 1.0
            const pr = s[0] * s[3], pg = s[1] * s[3], pb = s[2] * s[3];
            const lum = pr * 0.11 + pg * 0.59 + pb * 0.3;
            const step = lum >= threshold ? 1 : 0;
            // smoothstep(0.5-smoothness, 0.5+smoothness, noiseSample)
            const sm = Math.min(1, Math.max(0, (noiseSample - (0.5 - noiseSmooth)) / (2 * noiseSmooth)));
            const ss = sm * sm * (3 - 2 * sm);
            const di = (y * hw + x) * 4;
            half[di] = Math.round(pr * 255 * mask * step);
            half[di + 1] = Math.round(pg * 255 * mask * step);
            half[di + 2] = Math.round(pb * 255 * mask * step);
            half[di + 3] = Math.round(255 * mask * step * ss);
          }
        }
        const halfTex = { width: hw, height: hh, rgba: half };
        // ── pass 1: cast (径向光线, 30 采样, 半分辨率) ──
        const cast = new Uint8Array(hw * hh * 4);
        const sampleCount = 30, sampleIntensity = 0.1;
        const sampleDrop = sampleCount - 1;
        for (let y = 0; y < hh; y++) {
          for (let x = 0; x < hw; x++) {
            const u = (x + 0.5) / hw, v = (y + 0.5) / hh;
            let dx = center[0] - u, dy = center[1] - v;
            let dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 1e-6) { dist = 1e-6; }
            dx /= dist; dy /= dist;
            dist = Math.min(dist, dist * rayLength);
            let tx = u + dx * dist, ty = v + dy * dist;
            const sx = dx * dist / sampleDrop, sy = dy * dist / sampleDrop;
            let ar = 0, ag = 0, ab = 0, aa = 0;
            for (let i = 0; i < sampleCount; i++) {
              const s = this._texSample(halfTex, tx, ty, true);
              const wgt = i / sampleDrop;
              ar += s[0] * wgt; ag += s[1] * wgt; ab += s[2] * wgt; aa += s[3] * wgt;
              tx -= sx; ty -= sy;
            }
            const di = (y * hw + x) * 4;
            const rr = rayIntensity * sampleIntensity * ar * rayColor[0];
            const rg = rayIntensity * sampleIntensity * ag * rayColor[1];
            const rb = rayIntensity * sampleIntensity * ab * rayColor[2];
            const ra = rayIntensity * sampleIntensity * aa;
            cast[di] = Math.round(Math.min(1, rr) * 255);
            cast[di + 1] = Math.round(Math.min(1, rg) * 255);
            cast[di + 2] = Math.round(Math.min(1, rb) * 255);
            cast[di + 3] = Math.round(Math.min(1, ra) * 255);
          }
        }
        const castTex = { width: hw, height: hh, rgba: cast };
        // ── pass 2/3: gaussian 7-tap 水平+垂直 (KERNEL=1) ──
        const gauss7 = [0.071303, 0.131514, 0.189879, 0.214607, 0.189879, 0.131514, 0.071303];
        const blurX = this._gaussPass(castTex, blurScale[0] / hw, 0, gauss7);
        const blurY = this._gaussPass(blurX, 0, blurScale[1] / hh, gauss7);
        // ── pass 4: combine (BLENDMODE add) ──
        const out = new Uint8Array(tex.rgba.length);
        const src = tex.rgba;
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const u = (x + 0.5) / W, v = (y + 0.5) / H;
            const di = (y * W + x) * 4;
            const a = [src[di] / 255, src[di + 1] / 255, src[di + 2] / 255];
            const r = this._texSample(blurY, u, v, true);
            // 引擎: albedo.rgb = ApplyBlending(BLENDMODE, albedo.rgb, rays.rgb, rays.a); albedo.a += rays.a
            const blend = applyBlending(combineMode, a, [r[0], r[1], r[2]], r[3]);
            out[di] = Math.round(blend[0] * 255);
            out[di + 1] = Math.round(blend[1] * 255);
            out[di + 2] = Math.round(blend[2] * 255);
            out[di + 3] = Math.round((src[di + 3] / 255 + r[3]) * 255);
          }
        }
        return { width: W, height: H, rgba: out };
      }
};
