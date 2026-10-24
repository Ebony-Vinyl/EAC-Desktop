// WE GLSL 渲染集成 — 第三方 workshop 效果通用执行器 (mixin)
// applyEffects 的 else 分支调用 _applyGlslEffect: 从 pkg 读 shader → 编译缓存 →
// uniform 组装 → 逐像素渲染; 失败回退原图 (不崩溃)
import path from 'node:path';
import fs from 'node:fs';
import { compileGlsl, buildUniforms, renderGlsl } from './executor.js';

export function installGlsl(proto) {
  proto._glslCache = null;

  // 编译并缓存 (key = effect.file)
  proto._compileWorkshopEffect = function (ef) {
    const name = path.basename(path.dirname(ef.file));
    const id = String(ef.file).split('/')[2];
    const key = ef.file + '|' + (ef.passes && ef.passes[0] ? JSON.stringify(ef.passes[0].combos || {}) : '');
    if (!this._glslCache) this._glslCache = new Map();
    if (this._glslCache.has(key)) return this._glslCache.get(key);
    const stem = 'shaders/workshop/' + id + '/effects/' + name;
    let frag = '';
    try { frag = this.pkg.readText(stem + '.frag') || ''; } catch {}
    if (!frag) {
      // 尝试官方全局 shader (assets/effects/<name>/shaders/effects/<name>.frag)
      if (this.weAssetsDir) {
        const p = path.join(this.weAssetsDir, 'assets', 'effects', name, 'shaders', 'effects', name + '.frag');
        try { if (fs.existsSync(p)) frag = fs.readFileSync(p, 'utf8'); } catch {}
      }
    }
    if (!frag) { this._glslCache.set(key, null); return null; }
    let vert = '';
    try { vert = this.pkg.readText(stem + '.vert') || ''; } catch {}
    if (!vert && this.weAssetsDir) {
      const p = path.join(this.weAssetsDir, 'assets', 'effects', name, 'shaders', 'effects', name + '.vert');
      try { if (fs.existsSync(p)) vert = fs.readFileSync(p, 'utf8'); } catch {}
    }
    const combos = (ef.passes && ef.passes[0] && ef.passes[0].combos) || {};
    let compiled = null;
    try {
      compiled = compileGlsl({
        fragSource: frag,
        vertSource: vert || null,
        combos,
        resolveInclude: (inc) => this._resolveGlslInclude(inc),
      });
    } catch (e) {
      this.log('GLSL 编译失败 ' + name + ': ' + e.message);
    }
    this._glslCache.set(key, compiled);
    return compiled;
  };

  proto._resolveGlslInclude = function (inc) {
    if (this.weAssetsDir) {
      const p = path.join(this.weAssetsDir, 'assets', 'shaders', inc);
      try { if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8'); } catch {}
    }
    try { return this.pkg.readText('shaders/' + inc) || ''; } catch {}
    return '';
  };

  proto._glslSample = function (tex, u, v) {
    return this._texSample(tex, u, v, true); // clamp (GL 默认)
  };

  // 执行第三方/未实现效果: 返回新 RGBA 或原图 (失败回退)
  proto._applyGlslEffect = function (img, ef, name, t) {
    let compiled;
    try {
      compiled = this._compileWorkshopEffect(ef);
    } catch (e) {
      this.log('GLSL 效果 ' + name + ' 加载失败: ' + e.message);
      return img;
    }
    if (!compiled) return img;
    try {
      const pass = (ef.passes && ef.passes[0]) || {};
      const constants = pass.constantshadervalues || {};
      const texRefs = pass.textures || [];
      const textures = texRefs.map((p) => (p && p !== 'null' ? this.loadTexture(p) : null));
      const u = buildUniforms(compiled.uniforms, constants, {
        time: t || 0,
        textures,
        objW: img.width,
        objH: img.height,
        userAlpha: 1,
        parallaxPosition: this.optsMouse ? [this.optsMouse.x, this.optsMouse.y] : [0.5, 0.5],
      });
      // sampler2D uniform 绑定: g_Texture0 = 当前纹理 (img), g_TextureN (N>0) = textures[N]
      for (const [un, info] of Object.entries(compiled.uniforms)) {
        if (info.type === 'sampler2D' && u[un] === undefined) {
          const idx = Number((/g_Texture(\d+)/.exec(un) || [])[1] || 0);
          u[un] = idx === 0 ? img : (textures[idx - 1] || null);
        }
      }
      const out = renderGlsl(compiled, {
        width: img.width, height: img.height, u, textures,
        time: t || 0,
        sampler: this._glslSample.bind(this),
      });
      return out;
    } catch (e) {
      this.log('GLSL 效果 ' + name + ' 渲染失败: ' + e.message);
      return img;
    }
  };

  // 大对象降采样渲染: 超过阈值在小分辨率执行 GLSL 再放大 (静态帧近似, 防全屏效果过慢)
  const MAX_GLSL_PIXELS = 65536; // 256x256
  proto._applyGlslEffect = function (img, ef, name, t) {
    let compiled;
    try {
      compiled = this._compileWorkshopEffect(ef);
    } catch (e) {
      this.log('GLSL 效果 ' + name + ' 加载失败: ' + e.message);
      return img;
    }
    if (!compiled) return img;
    const totalPx = img.width * img.height;
    // 降采样仅动画多帧启用; 静态帧全分辨率 (用户要求: 静态帧不应用降低分辨率操作)
    if (!this.staticFrame && totalPx > MAX_GLSL_PIXELS) {
      const scale = Math.sqrt(MAX_GLSL_PIXELS / totalPx);
      const sw = Math.max(1, Math.round(img.width * scale));
      const sh = Math.max(1, Math.round(img.height * scale));
      const small = this._renderGlslEffect(compiled, img, ef, sw, sh, t);
      if (small && small !== img) return this._upsampleRgba(small, img.width, img.height);
      return img;
    }
    return this._renderGlslEffect(compiled, img, ef, img.width, img.height, t);
  };

  proto._renderGlslEffect = function (compiled, img, ef, w, h, t) {
    try {
      const pass = (ef.passes && ef.passes[0]) || {};
      const constants = pass.constantshadervalues || {};
      const texRefs = pass.textures || [];
      const textures = texRefs.map((p) => (p && p !== 'null' ? this.loadTexture(p) : null));
      const u = buildUniforms(compiled.uniforms, constants, {
        time: t || 0,
        textures,
        objW: img.width,
        objH: img.height,
        userAlpha: 1,
        parallaxPosition: this.optsMouse ? [this.optsMouse.x, this.optsMouse.y] : [0.5, 0.5],
      });
      // sampler2D uniform 绑定: g_Texture0 = 当前纹理 (img), g_TextureN (N>0) = textures[N]
      for (const [un, info] of Object.entries(compiled.uniforms)) {
        if (info.type === 'sampler2D' && u[un] === undefined) {
          const idx = Number((/g_Texture(\d+)/.exec(un) || [])[1] || 0);
          u[un] = idx === 0 ? img : (textures[idx - 1] || null);
        }
      }
      const out = renderGlsl(compiled, {
        width: w, height: h, u, textures,
        time: t || 0,
        sampler: this._glslSample.bind(this),
      });
      return out;
    } catch (e) {
      this.log('GLSL 效果 ' + name + ' 渲染失败: ' + e.message);
      return img;
    }
  };

  // 最近邻放大 (降采样结果 → 原始尺寸)
  proto._upsampleRgba = function (small, W, H) {
    const out = new Uint8Array(W * H * 4);
    const sw = small.width, sh = small.height;
    for (let y = 0; y < H; y++) {
      const sy = Math.min(sh - 1, Math.floor((y * sh) / H));
      const srcRow = sy * sw * 4;
      const dstRow = y * W * 4;
      for (let x = 0; x < W; x++) {
        const sx = Math.min(sw - 1, Math.floor((x * sw) / W));
        const si = srcRow + sx * 4;
        const di = dstRow + x * 4;
        out[di] = small.rgba[si];
        out[di + 1] = small.rgba[si + 1];
        out[di + 2] = small.rgba[si + 2];
        out[di + 3] = small.rgba[si + 3];
      }
    }
    return { width: W, height: H, rgba: out };
  };
}
