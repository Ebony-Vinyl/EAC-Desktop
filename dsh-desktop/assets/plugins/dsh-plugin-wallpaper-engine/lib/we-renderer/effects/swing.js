// WE 渲染引擎 — 效果 Swing (从 effects.js 拆分, 逻辑零改动)
import { parseVec2, getVal } from '../math.js';

export const fx = {
      // swing (引擎 shader: effects/swing.frag/vert): 翻页旋转 (p0-p1 轴 + UV 扭曲)
      //   vert: aspect=w/h; anim = sin(t·speed + phase·2π)·amount
      //   frag: 轴/中心 (aspect 修正); uvDelta → 沿轴/正交距离
      //         uvDistort = axis·anim·dOrtho·dAlong + axisOrtho·anim²·dOrtho
      //         mask = 翻页区域 (p0-p1 夹逼 + sizeMod 边缘 feather) [DOUBLESIDED 双面]
      //         out = mix(uv, uv+distort, mask) 采样
      //   uniform: point0/point1/size/center/feather/amount/speed/phase/
      //     noisespeed/noiseamount; DOUBLESIDED/MASK/NOISE combo

    effectSwing(tex, c, t, pass) {
        const point0 = parseVec2(getVal(c, 'point0', '0.25 0.5'), [0.25, 0.5]);
        const point1 = parseVec2(getVal(c, 'point1', '0.75 0.5'), [0.75, 0.5]);
        const size = getVal(c, 'size', 0.4);
        const centerPos = getVal(c, 'center', 0.5);
        const feather = getVal(c, 'feather', 0.01);
        const amount = getVal(c, 'amount', 0.2);
        const speed = getVal(c, 'speed', 2.0);
        const phase = getVal(c, 'phase', 0);
        const noiseSpeed = getVal(c, 'noisespeed', 0.15);
        const noiseAmount = getVal(c, 'noiseamount', 0.2);
        const combos = (pass && pass.combos) || {};
        const doubleSided = combos.DOUBLESIDED === '1' || combos.DOUBLESIDED === 1;
        const hasMask = combos.MASK === '1' || combos.MASK === 1;
        const hasNoise = combos.NOISE === '1' || combos.NOISE === 1;
        const pt = (pass && pass.textures) || [];
        const maskTex = hasMask && pt[1] && pt[1] !== 'null' ? this.loadTexture(pt[1]) : null;
        const noiseTex = hasNoise && pt[2] && pt[2] !== 'null' ? this.loadTexture(pt[2]) : this.loadTexture('util/noise');
        const W = tex.width, H = tex.height;
        // 官方 swing.vert: v_TexCoordMask mask UV 缩放 (maskRes/对象Res) (sf39i)
        const mSx = maskTex && maskTex.width > 0 ? maskTex.width / tex.width : 1;
        const mSy = maskTex && maskTex.height > 0 ? maskTex.height / tex.height : 1;
        const src = tex.rgba;
        const out = new Uint8Array(src.length);
        const aspect = W / H;
        const ss = (a, b, x) => {
          const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
          return k * k * (3 - 2 * k);
        };
        // vert 预计算
        let anim = Math.sin(t * speed + phase * 6.28318530718) * amount;
        if (hasNoise) {
          const n = this._texSample(noiseTex, t * 0.08333333 * noiseSpeed, t * 0.02777777 * noiseSpeed)[0] * 6.28318530718;
          anim = Math.min(1, Math.max(-1, anim + Math.sin(n) * noiseAmount));
        }
        // 轴 (aspect 修正)
        const ax0 = point0[0] * aspect, ay0 = point0[1];
        const ax1 = point1[0] * aspect, ay1 = point1[1];
        let adx = ax1 - ax0, ady = ay1 - ay0;
        const alen = Math.hypot(adx, ady) || 1;
        adx /= alen; ady /= alen;
        const cx = ax0 + (ax1 - ax0) * centerPos, cy = ay0 + (ay1 - ay0) * centerPos;
        const ox = -ady, oy = adx;
        const feather2 = Math.max(feather, 0.00001);
        const sizeMod = size * (1 - Math.abs(anim) * amount * 0.5);
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const u = (x + 0.5) / W, v = (y + 0.5) / H;
            const tx = u * aspect, ty = v;
            const dx0 = tx - cx, dy0 = ty - cy;
            const dAlong = adx * dx0 + ady * dy0;
            const dOrtho = ox * dx0 + oy * dy0;
            const dd = anim * dOrtho;
            const tx2 = tx + adx * dd * dAlong + ox * anim * dOrtho * anim;
            const ty2 = ty + ady * dd * dAlong + oy * anim * dOrtho * anim;
            // mask
            let mask = 1;
            const dRx = tx2 - ax1, dRy = ty2 - ay1;
            const dLx = tx2 - ax0, dLy = ty2 - ay0;
            mask *= ss(feather2, 0, adx * dRx + ady * dRy);
            mask *= ss(-feather2, 0, adx * dLx + ady * dLy);
            mask *= ss(sizeMod + feather2, sizeMod - feather2, dOrtho);
            if (doubleSided) mask *= ss(sizeMod + feather2, sizeMod - feather2, -dOrtho);
            else mask *= dOrtho >= 0 ? 1 : 0;
            if (maskTex) mask *= this._texSample(maskTex, u * mSx, v * mSy)[0];
            const uu = u + (tx2 / aspect - u) * mask;
            const vv = v + (ty2 - v) * mask;
            const s = this._texSample(tex, uu, vv);
            const di = (y * W + x) * 4;
            out[di] = Math.round(s[0] * 255); out[di + 1] = Math.round(s[1] * 255);
            out[di + 2] = Math.round(s[2] * 255); out[di + 3] = Math.round(s[3] * 255);
          }
        }
        return { width: W, height: H, rgba: out };
      }
};
