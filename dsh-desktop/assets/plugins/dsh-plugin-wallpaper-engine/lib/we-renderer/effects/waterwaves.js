// WE 渲染引擎 — 效果 Waterwaves (从 effects.js 拆分, 逻辑零改动)

export const fx = {
      // waterwaves: 双波 sin 位移 (shader 精确数学)
      // v_Direction = rotateVec2((0,1), direction) = (-sin(dir), cos(dir))
      // (官方 common.h rotateVec2 逆时针旋转; 本地曾用 (sin,cos) → x 分量反号
      //  → 波浪沿镜像方向传播, 与官方相反 = "诡异波浪"主因)

    effectWaterwaves(tex, c, t, pass) {
        const dir1 = c.direction != null ? c.direction : 0;
        const scale1 = c.scale != null ? c.scale : 200;
        const speed1 = c.speed != null ? c.speed : 5;
        const exp1 = c.exponent != null ? c.exponent : 1;
        const strength = c.strength != null ? c.strength : 0.1;
        const dual = c.direction2 != null || c.scale2 != null;
        const dir2 = c.direction2 != null ? c.direction2 : 0;
        const scale2 = c.scale2 != null ? c.scale2 : 66;
        const speed2 = c.speed2 != null ? c.speed2 : 3;
        const exp2 = c.exponent2 != null ? c.exponent2 : 1;
        const offset2 = c.offset2 != null ? c.offset2 : 0;
        // 官方 waterwaves.frag MASK: mask = texSample(g_Texture1, v_TexCoord.zw),
        // 位移 ×mask — 旧实现无 pass 参数忽略 mask → 波纹全图 (sf39h)
        const pt = (pass && pass.textures) || [];
        const hasMask = !!pt[1] && pt[1] !== 'null';
        const maskTex = hasMask ? this.loadTexture(pt[1]) : null;
        const w = tex.width, h = tex.height;
        // 官方 waterwaves.vert: v_TexCoord.z *= maskRes.z/x (mask宽/对象宽),
        // w *= maskRes.w/y — mask UV 缩放 (sf39i, 3460 的 mask 是对象 1/2 尺寸)
        const mSx = maskTex && maskTex.width > 0 ? maskTex.width / tex.width : 1;
        const mSy = maskTex && maskTex.height > 0 ? maskTex.height / tex.height : 1;
        const src = tex.rgba;
        const out = new Uint8Array(src.length);
        const vd1 = [-Math.sin(dir1), Math.cos(dir1)]; // rotateVec2((0,1), dir1)
        const vd2 = [-Math.sin(dir2), Math.cos(dir2)];
        const off1 = [vd1[1], -vd1[0]];
        const off2 = [vd2[1], -vd2[0]];
        const s = strength * strength;
        // 低分辨率加速: 每 2x2 计算一次
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const u = (x + 0.5) / w, v = (y + 0.5) / h;
            // 官方 MASK: 位移 × mask (mask UV 乘缩放因子)
            let mf = 1;
            if (maskTex) mf = this._texSample(maskTex, u * mSx, v * mSy)[0];
            let dist = t * speed1 + (u * vd1[0] + v * vd1[1]) * scale1;
            const val1 = Math.sin(dist);
            const s1 = Math.sign(val1);
            const p1 = Math.pow(Math.abs(val1), exp1);
            let uu = u, vv = v;
            if (dual) {
              let dist2 = (t + offset2) * speed2 + (u * vd2[0] + v * vd2[1]) * scale2;
              const val2 = Math.sin(dist2);
              const s2 = Math.sign(val2);
              const p2 = Math.pow(Math.abs(val2), exp2);
              uu += p1 * s1 * p2 * s2 * off1[0] * s * mf;
              vv += p1 * s1 * p2 * s2 * off1[1] * s * mf;
            } else {
              uu += p1 * s1 * off1[0] * s * mf;
              vv += p1 * s1 * off1[1] * s * mf;
            }
            const sx = Math.max(0, Math.min(w - 1, Math.floor(uu * w)));
            const sy = Math.max(0, Math.min(h - 1, Math.floor(vv * h)));
            const si = (sy * w + sx) * 4, di = (y * w + x) * 4;
            out[di] = src[si]; out[di+1] = src[si+1]; out[di+2] = src[si+2]; out[di+3] = src[si+3];
          }
        }
        return { width: w, height: h, rgba: out };
      }
};
