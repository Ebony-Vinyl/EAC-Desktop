// WE 渲染引擎 — 效果 Waterripple (从 effects.js 拆分, 逻辑零改动)

export const fx = {
      // waterripple: 官方 shader 数学 (effects/waterripple.frag/vert, PERSPECTIVE=0)
      //   scroll = rotateVec2((0,1), dir) × scrollSpeed² × time
      //   ripple.xy = uv + time×animSpeed² + scroll
      //   ripple.zw = uv×1.333 − time×animSpeed² + scroll
      //   ripple ×= scale; ripple.xz ×= texW/texH; ripple.yw ×= ratio
      //   n1 = sample(normal, ripple.xy)×2−1; n2 = sample(normal, ripple.zw)×2−1
      //   normal = normalize(n1.xy+n2.xy, n1.z); texCoord += normal.xy×strength²×mask
      //   旧实现是"简化圆形波纹" (sin(r)×strength×3 径向位移) — 与官方完全不同,
      //   产生中心扩散的正弦环形波浪 (用户感知"诡异正弦"来源之一)。

    effectWaterripple(tex, c, t, ef, pass) {
        const strength = c.ripplestrength != null ? c.ripplestrength : 0.1;
        const animSpeed = c.animationspeed != null ? c.animationspeed : 0.15;
        const scale = c.scale != null ? c.scale : 1;
        const scrollSpeed = c.scrollspeed != null ? c.scrollspeed : 0;
        const direction = c.scrolldirection != null ? c.scrolldirection : 0;
        const ratio = c.ratio != null ? c.ratio : 1;
        const pt = (pass && pass.textures) || [];
        const normalRef = pt[2] && pt[2] !== 'null' ? pt[2] : 'effects/waterripplenormal';
        const normalTex = this.loadTexture(normalRef);
        // 官方 waterripple.frag MASK: mask = texSample(g_Texture1, v_TexCoord.zw),
        // 位移 ×mask — 旧实现忽略 pt[1] (mask) → 有 mask 的水面全区域波纹 (sf39h)
        const hasMask = !!pt[1] && pt[1] !== 'null';
        const maskTex = hasMask ? this.loadTexture(pt[1]) : null;
        const w = tex.width, h = tex.height;
        // 官方 waterripple.vert: v_TexCoord.zw mask UV 缩放 (maskRes/对象Res) (sf39i)
        const mSx = maskTex && maskTex.width > 0 ? maskTex.width / tex.width : 1;
        const mSy = maskTex && maskTex.height > 0 ? maskTex.height / tex.height : 1;
        const src = tex.rgba;
        const out = new Uint8Array(src.length);
        const s2 = strength * strength;
        const as2 = animSpeed * animSpeed;
        const ss2 = scrollSpeed * scrollSpeed;
        // scroll = rotateVec2((0,1), dir) × scrollSpeed² × time (官方 common.h rotateVec2)
        const scx = (-Math.sin(direction)) * ss2 * t;
        const scy = Math.cos(direction) * ss2 * t;
        const aspect = w / h;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const u = (x + 0.5) / w, v = (y + 0.5) / h;
            // ripple coords (PERSPECTIVE=0)
            let rx1 = (u + as2 * t + scx) * scale;
            let ry1 = (v + as2 * t + scy) * scale;
            let rx2 = (u * 1.333 - as2 * t + scx) * scale;
            let ry2 = (v * 1.333 - as2 * t + scy) * scale;
            rx1 *= aspect; rx2 *= aspect;
            ry1 *= ratio; ry2 *= ratio;
            let n1 = [0.5, 0.5, 1], n2 = [0.5, 0.5, 1];
            if (normalTex) n1 = this._texSample(normalTex, rx1, ry1);
            if (normalTex) n2 = this._texSample(normalTex, rx2, ry2);
            const nx1 = n1[0] * 2 - 1, ny1 = n1[1] * 2 - 1;
            const nx2 = n2[0] * 2 - 1, ny2 = n2[1] * 2 - 1;
            const nx = nx1 + nx2, ny = ny1 + ny2, nz = n1[2];
            const nl = Math.hypot(nx, ny, nz) || 1;
            // 官方: texCoord += normal.xy × strength² × mask (mask UV 乘缩放因子)
            let mfactor = 1;
            if (maskTex) mfactor = this._texSample(maskTex, u * mSx, v * mSy)[0];
            const uu = Math.max(0, Math.min(1, u + (nx / nl) * s2 * mfactor));
            const vv = Math.max(0, Math.min(1, v + (ny / nl) * s2 * mfactor));
            const s = this._texSample(tex, uu, vv);
            const di = (y * w + x) * 4;
            out[di] = Math.round(s[0] * 255); out[di + 1] = Math.round(s[1] * 255);
            out[di + 2] = Math.round(s[2] * 255); out[di + 3] = Math.round(s[3] * 255);
          }
        }
        return { width: w, height: h, rgba: out };
      }
};
