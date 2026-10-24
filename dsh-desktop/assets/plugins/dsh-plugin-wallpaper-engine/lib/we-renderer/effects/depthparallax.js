// WE 渲染引擎 — 效果 DepthParallax (从 effects.js 拆分, 逻辑零改动)
import { parseVec2, getVal } from '../math.js';

export const fx = {
      // depthparallax (官方 effects/depthparallax, 单 pass 交互式视差):
      //   vert: v_TexCoord.zw = depthUV (uv·depthRes/objRes); v_TexCoordMask = maskUV;
      //         v_ParallaxOffset = (projectedDirX·prlx.x + projectedDirY·prlx.y)·0.5+0.5
      //         (g_EffectTextureProjectionMatrixInverse 对 2D 近似单位 → = g_ParallaxPosition)
      //   frag QUALITY 0: pointer=(zw,1−w)−prlx · vec2(2,−2)·scale·−0.04; offset=(depth·2−1)·pointer·mask
      //        QUALITY 1/2: ctrlSign/ctrlPerspOrtho 透视修正 + 24/64 层 ParallaxMapping (ray march)
      //   uniform: scale/sens/center; QUALITY/MASK combo; depth=textures[1]
    effectDepthParallax(tex, c, t, pass) {
        const combos = (pass && pass.combos) || {};
        const quality = combos.QUALITY != null ? Number(combos.QUALITY) : 1;
        const hasMask = combos.MASK === '1' || combos.MASK === 1;
        const scale = parseVec2(getVal(c, 'scale', '1 1'), [1, 1]);
        const sens = getVal(c, 'sens', 1);
        const center = getVal(c, 'center', 0.3);
        const pt = (pass && pass.textures) || [];
        const depthTex = pt[1] && pt[1] !== 'null' ? this.loadTexture(pt[1]) : null;
        const maskTex = hasMask && pt[2] && pt[2] !== 'null' ? this.loadTexture(pt[2]) : null;
        // 指针位置 (静态帧默认屏幕中心; 交互场景由引擎注入 g_ParallaxPosition)
        const prlxPos = parseVec2(getVal(c, 'parallaxposition', '0.5 0.5'), [0.5, 0.5]);
        const W = tex.width, H = tex.height;
        const src = tex.rgba;
        const out = new Uint8Array(src.length);
        const dSx = depthTex ? depthTex.width / W : 1, dSy = depthTex ? depthTex.height / H : 1;
        const mSx = maskTex ? maskTex.width / W : 1, mSy = maskTex ? maskTex.height / H : 1;
        const ctrlSign = sens >= 0 ? 1 : 0;
        const negPerspective = -sens;
        const ctrlPerspOrtho = Math.min(1, Math.max(0, sens)) + (negPerspective > 0.0001 ? 1 : 0);
        const prlx = ctrlSign ? [1 - prlxPos[0], 1 - prlxPos[1]] : [prlxPos[0], prlxPos[1]];
        const perspMix = -1 + (negPerspective + 1) * ctrlPerspOrtho; // mix(-1, negPerspective, ctrlPerspOrtho)
        const numLayers = quality === 2 ? 64 : 24;
        const layerDepth = 1 / numLayers;
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const u = (x + 0.5) / W, v = (y + 0.5) / H;
            const dz = u * dSx, dw = v * dSy;
            const depth = depthTex ? this._texSample(depthTex, dz, dw)[0] : 0;
            let mask = 1;
            if (maskTex) mask = this._texSample(maskTex, u * mSx, v * mSy)[0];
            let sampleU, sampleV;
            if (quality === 0) {
              // vec2(v_TexCoord.z, 1−v_TexCoord.w) 为指针输入 (y 翻转)
              let pointer = [dz - prlxPos[0], (1 - dw) - prlxPos[1]];
              pointer = [pointer[0] * 2 * scale[0] * -0.04, pointer[1] * -2 * scale[1] * -0.04];
              const offsetX = (depth * 2 - 1) * pointer[0] * mask;
              const offsetY = (depth * 2 - 1) * pointer[1] * mask;
              sampleU = u + offsetX; sampleV = v + offsetY;
            } else {
              // coords: sens≥0 时透视压缩, sens<0 时原样
              let coords = ctrlSign
                ? [(u - 0.5) / (1 + sens * 0.2) + 0.5, (v - 0.5) / (1 + sens * 0.2) + 0.5]
                : [u, v];
              coords[0] -= (prlx[0] * 2 - 1) * center * (-0.05) * scale[0] * perspMix;
              coords[1] -= (prlx[1] * 2 - 1) * center * (0.05) * scale[1] * perspMix;
              const pointer = [1 - dz, dw]; // vec2(1−v_TexCoord.z, v_TexCoord.w)
              let ctrlDir = [pointer[0] - prlx[0], pointer[1] - prlx[1]];
              // mix(vec2(1−prlx.x, prlx.y)−0.5, ctrlDir·vec2(−neg, neg), ctrlPerspOrtho)
              const altX = 1 - prlx[0] - 0.5, altY = prlx[1] - 0.5;
              const dirX = altX + (ctrlDir[0] * (-negPerspective) - altX) * ctrlPerspOrtho;
              const dirY = altY + (ctrlDir[1] * negPerspective - altY) * ctrlPerspOrtho;
              const fakeViewdir = [dirX * mask, dirY * mask];
              // ParallaxMapping (ray march 分层)
              const P = [fakeViewdir[0] * scale[0] * 0.1, fakeViewdir[1] * scale[1] * 0.1];
              const delta = [P[0] / numLayers, P[1] / numLayers];
              let cur = [coords[0], coords[1]];
              let curDepth = depthTex ? this._texSample(depthTex, cur[0] * dSx, cur[1] * dSy)[0] : 0;
              let currentLayerDepth = 1;
              let i = 0;
              while (currentLayerDepth > curDepth && i < numLayers) {
                cur = [cur[0] - delta[0], cur[1] - delta[1]];
                curDepth = depthTex ? this._texSample(depthTex, cur[0] * dSx, cur[1] * dSy)[0] : 0;
                currentLayerDepth -= layerDepth;
                i++;
              }
              const prev = [cur[0] + delta[0], cur[1] + delta[1]];
              const afterDepth = curDepth - currentLayerDepth;
              const beforeDepth = (depthTex ? this._texSample(depthTex, prev[0] * dSx, prev[1] * dSy)[0] : 0) - currentLayerDepth - layerDepth;
              const weight = afterDepth / (afterDepth - beforeDepth);
              sampleU = prev[0] * weight + cur[0] * (1 - weight);
              sampleV = prev[1] * weight + cur[1] * (1 - weight);
            }
            const s = this._texSample(tex, sampleU, sampleV);
            const di = (y * W + x) * 4;
            out[di] = Math.round(Math.min(1, Math.max(0, s[0])) * 255);
            out[di + 1] = Math.round(Math.min(1, Math.max(0, s[1])) * 255);
            out[di + 2] = Math.round(Math.min(1, Math.max(0, s[2])) * 255);
            out[di + 3] = Math.round(Math.min(1, Math.max(0, s[3])) * 255);
          }
        }
        return { width: W, height: H, rgba: out };
      }
};
