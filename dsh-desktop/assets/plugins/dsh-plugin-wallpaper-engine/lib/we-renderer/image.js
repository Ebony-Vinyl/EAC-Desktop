// WE 渲染引擎 — image (从 core.js 拆分, 逻辑不变)
import path from 'path';
import { parseVec3, parseVec2, getVal, rgb2hsv, hsv2rgb, smoothstepFn } from './math.js';

// ── image mixin (从 core.js 拆分, 逻辑零改动) ──
export function installImage(proto) {
  Object.assign(proto, {
    _renderFullscreenShader(o, mat, pass, shaderName, t) {
        const uniforms = this._materialUniforms(mat, pass);
        const textures = (pass && pass.textures || []).map((p) => this.loadTexture(p));
        const tex = textures[0] || null;
        const tex1 = textures[1] || null;
        const tex2 = textures[2] || null;
        const tex3 = textures[3] || null;
        const W = this.W, H = this.H;
        const positions = [[-1, -1, 0], [1, -1, 0], [-1, 1, 0], [1, 1, 0]];
        const uvs = [[0, 0], [1, 0], [0, 1], [1, 1]];
        const indices = [0, 2, 1, 2, 3, 1]; // CCW (屏幕空间)
        const n = 4;
        const vp = new Float64Array(n * 6);
        const shadeData = new Float64Array(n * 8);
        for (let i = 0; i < n; i++) {
          const sx = (positions[i][0] * 0.5 + 0.5) * W;
          const sy = (0.5 - positions[i][1] * 0.5) * H;
          vp[i * 6] = sx; vp[i * 6 + 1] = sy; vp[i * 6 + 2] = 1; vp[i * 6 + 3] = 0.5;
          vp[i * 6 + 4] = uvs[i][0]; vp[i * 6 + 5] = uvs[i][1];
          shadeData[i * 8 + 2] = 1; // 法线 +z
        }
        const vs = { shaderName, uniforms, tex, tex1, tex2, tex3, textures, textureNames: (pass && pass.textures) || [], t, combos: (pass && pass.combos) || {} };
        const blending = pass && pass.blending ? pass.blending : 'opaque';
        const depthWrite = !(pass && pass.depthwrite === 'disabled');
        this._rasterizeMesh3D(indices, vp, shadeData, vs, blending, depthWrite);
      }
    
      // 材质 uniforms: usershadervalues (如 schemecolor→tint) 解析
,
    _materialUniforms(mat, pass) {
        const out = {};
        const usv = pass && pass.usershadervalues;
        if (usv) for (const [prop, uniform] of Object.entries(usv)) {
          const v = this.userProps[prop];
          if (v != null) {
            if (typeof v === 'string' && v.trim().split(/\s+/).length > 1) out[uniform] = parseVec3(v, [1, 1, 1]);
            else out[uniform] = typeof v === 'number' ? v : parseFloat(v);
          }
        }
        const csv = pass && pass.constantshadervalues;
        if (csv) for (const [k, v] of Object.entries(csv)) out[k] = v;
        return out;
      }
    
      // 官方视图平移 (标准 LookAt): view = LookAt(eye, center, up); 2D 场景相机
      // eye=(ex,ey,0) center=(ex,ey,-1) up=(0,1,0) → 朝向 -z, view 平移行 = (-ex,-ey)
      // (纯数学推导, 与 wallpaper64 定位矩阵 M=World×View×Proj 一致)。
      // 画布坐标: x 同向 → vs[0]=(-ex)×ps_x; 场景 y 向上/画布 y 向下 → vs[1]=(+ey)×ps_y。
      // 前景对象平移 (-eye.x, +eye.y)×ps; 背景跳过视图 (官方: 背景 size=场景正交尺寸不随相机平移)。
      // 相机 eye → 画布平移 (-eye.x, +eye.y)×ps (右移/上移对应场景单位;
      //  x 方向经用户实测证实; y 方向此前误判"不平移", 标准 LookAt 数学
      //  要求 y 同步 — 修复后组件垂直位置对齐官方)。
,
    renderImage(o, t) {
        const model = this.readJsonAny(o.image);
        if (!model) return;
        const tr = this.resolveTransform(o);
        // puppet 模型 → MDL 网格渲染
        if (model.puppet) {
          this.renderPuppet(o, model, tr, t);
          return;
        }
        // 自定义 shader 材质 (cloudsbg 等程序化全屏效果) → 全屏 quad 走 3D 光栅化
        const mat = model.material ? this.readJsonAny(model.material) : null;
        const pass = mat && mat.passes && mat.passes[0] ? mat.passes[0] : null;
        const shaderName = pass ? pass.shader : '';
        if (shaderName && this._customShaders.has(shaderName)) {
          this._renderFullscreenShader(o, mat, pass, shaderName, t);
          return;
        }
        // passthrough 后处理层 (fullscreenlayer 等): 纹理是 _rt_ 渲染目标 → 读取当前画布内容
        const passthrough = model.passthrough === true
          || (pass && pass.textures && pass.textures[0] && String(pass.textures[0]).startsWith('_rt_'));
        if (passthrough) {
          this._renderPassthroughLayer(o, model, pass, t);
          return;
        }
        // solidlayer (纯色层): 无纹理, 用对象 color 填充矩形 (flat shader)
        if (model.solidlayer === true || shaderName === 'flat' || shaderName === 'flatalpha') {
          this._renderSolidLayer(o, model, tr, t);
          return;
        }
        let tex = this.loadModelTexture(o.image);
        if (!tex) { this.log('跳过 image ' + (o.name || o.id) + ': 无纹理'); return; }
        // swayimage 摆动 (beach/palms): 纹理级预处理 — swayMask 正弦位移采样
        if (shaderName === 'swayimage') {
          const swayTex = pass && pass.textures && pass.textures[1] ? this.loadTexture(pass.textures[1]) : null;
          tex = this._swayImage(tex, swayTex, this._materialUniforms(mat, pass), t);
        }
        // flag 旗帜飘动: 法线贴图扰动 + 光照
        if (shaderName === 'flag') {
          const nTex = pass && pass.textures && pass.textures[1] ? this.loadTexture(pass.textures[1]) : null;
          const cTex = pass && pass.textures && pass.textures[2] ? this.loadTexture(pass.textures[2]) : null;
          tex = this._flagImage(tex, nTex, cTex, this._materialUniforms(mat, pass), pass, t);
        }
        // retro 霓虹 (retro): HSV 色调 + grunge + DOTS
        if (shaderName === 'retro') {
          const gTex = pass && pass.textures && pass.textures[1] ? this.loadTexture(pass.textures[1]) : null;
          tex = this._retroImage(tex, gTex, this._materialUniforms(mat, pass), pass, t, this.W, this.H);
        }
        // spritesheet 动画: 按时间选帧, 裁剪帧子区域 (引擎 TEXS 帧元数据)
        if (pass && pass.combos && (pass.combos.spritesheet || pass.combos.SPRITESHEET) && tex.frames && tex.frames.count > 1) {
          const fr = tex.frames;
          const frameIdx = Math.floor(t / fr.duration) % fr.count;
          const f = fr.items[frameIdx];
          if (f) {
            // 裁剪帧区域 (帧坐标是像素, 相对纹理)
            const fw = f.width || Math.floor(tex.width / fr.count);
            const fh = f.height || tex.height;
            const fx = f.x || frameIdx * fw;
            const fy = f.y || 0;
            const cropped = new Uint8Array(fw * fh * 4);
            for (let y = 0; y < fh && fy + y < tex.height; y++) {
              cropped.set(tex.rgba.subarray(((fy + y) * tex.width + fx) * 4, ((fy + y) * tex.width + fx + fw) * 4), y * fw * 4);
            }
            tex = { width: fw, height: fh, rgba: cropped };
          }
        }
        // 尺寸: scene size 或纹理尺寸
        let size = parseVec2(getVal(o, 'size'), [0, 0]);
        if ((size[0] === 0 || size[1] === 0) && tex) size = [tex.width, tex.height];
        // model fullscreen → 全屏
        if (model.fullscreen) { size = [this.W, this.H]; }
        const alpha = getVal(o, 'alpha', 1);
        const brightness = getVal(o, 'brightness', 1);
        // 正交投影缩放: 场景单位(ortho width/height) → 画布像素
        const ortho = this.scene.general && this.scene.general.orthogonalprojection;
        const ps = ortho && ortho.width ? [this.W / ortho.width, this.H / (ortho.height || 1080)] : null;
        const vs = this._viewShift(o, size, ps);
        const ox = (ps ? tr.origin[0] * ps[0] : tr.origin[0]) + vs[0];
        const sc = tr.scale;
        // CImage 坐标: 像素左上角 = (origin.x - dw/2, H - origin.y - dh/2), y 向下
        // viewShift 的 vs[1] = 画布 y 偏移 (直接加, 与 renderPuppet 一致):
        // 官方 view 平移 +eye.y 场景单位 → 画布上移; 旧实现把 vs[1] 放进 oy
        // (减号前) 导致 image 与 puppet 的 y 平移方向相反 (差 2×eye.y×ps) —
        // image 组件与 puppet 的 y 平移方向相反 (差 2×eye.y×ps) — 组件相对错位 = "位置相反"
        const dw = size[0] * sc[0] * (ps ? ps[0] : 1), dh = size[1] * sc[1] * (ps ? ps[1] : 1);
        let dx = ox - dw / 2, dy = this.H - (ps ? tr.origin[1] * ps[1] : tr.origin[1]) - dh / 2 + vs[1];
        // alignment 调整 (CImage.cpp:242-256): 默认中心; top/bottom/left/right 使对应边锚定 origin
        // lwe: top → 顶边下移到 origin (矩形在 origin 下方展开); bottom → 底边上移到 origin。
        // 画布 y 向下: top = dy 增大 dh/2, bottom = dy 减小 dh/2 (方向已按 lwe 原文核对)
        const align = String(getVal(o, 'alignment', '')).toLowerCase();
        if (align.includes('top')) dy += dh / 2;
        else if (align.includes('bottom')) dy -= dh / 2;
        // CImage.cpp:250-256: left → m_pos.x += size.x/2 (对象右移, 左边锚定 origin), right → 左移
        if (align.includes('left')) dx += dw / 2;
        else if (align.includes('right')) dx -= dw / 2;
        // 效果链: 先应用 shader 效果到纹理副本 (CPU), 再绘制。
        // 性能 (逆向 lwe 官方): 官方效果是 fragment shader 在 GPU 数千线程并行
        // 处理全分辨率 (4K) 纹理 — CPU 实现逐像素串行, 4K 纹理上每帧 2.7s。
        // CPU 近似: 效果是低频扰动/波浪, 先等比降采样到显示尺寸 (blit 目标
        // dw/dh) 再计算 → 提速 (纹理像素/显示像素) 倍 (4K→显示尺寸 40-400 倍),
        // 效果 UV 数学不变 (等比 aspect 保持)。
        let img = tex;
        if (o.effects && o.effects.length) {
          // 性能 (逆向 lwe 官方): 官方效果 GPU 数千线程并行处理全分辨率 (4K) — CPU
          // 实现逐像素串行, 4K 纹理上每帧 2.7s。CPU 近似: 效果是低频扰动/波浪, 先
          // 等比降采样到显示尺寸再计算。**仅动画多帧启用** (staticFrame=false);
          // 静态帧全分辨率渲染保证细腻 (4K 壁纸降采样会马赛克)。
          const maxDisp = Math.max(1, Math.ceil(Math.max(Math.abs(dw), Math.abs(dh))));
          if (!this.staticFrame && maxDisp < Math.max(tex.width, tex.height)) {
            img = this._downsample(tex, maxDisp);
          }
          img = this.applyEffects(o, img, t);
        }
        if (img && tr.angle !== 0) {
          // 旋转: 以对象中心 (dx+dw/2, dy+dh/2) 旋转 tr.angle 弧度 (引擎 CImage 角度语义)
          const rotated = img.rotated || img;
          this.canvas.blitRotated(rotated, dx + dw / 2, dy + dh / 2, dw, dh, tr.angle, alpha * brightness);
          return;
        }
        // 视差: (depth + amount) * displacement * referenceSize (lwe-CImage.cpp:1111)
        let pdx = 0, pdy = 0;
        if (this.parallaxDisp[0] !== 0 || this.parallaxDisp[1] !== 0) {
          const pd = parseVec2(getVal(o, 'parallaxDepth', '1 1'), [1, 1]);
          const parAmount = getVal((this.scene.camera || {}).parallax, 'amount', 1);
          const ref = this.W;
          pdx = (pd[0] + parAmount) * this.parallaxDisp[0] * ref;
          pdy = (pd[1] + parAmount) * this.parallaxDisp[1] * ref;
        }
        // colorBlendMode: 官方 ApplyBlending(mode, 画布, 对象色, alpha) 颜色混合
        // (lwe CImage.cpp:751 colorBlendMode > 0 → effectpassthrough BLENDMODE pass)
        const cbm = getVal(o, 'colorBlendMode', 0);
        if (img) this.canvas.blitScaled(img, dx + pdx, dy + pdy, dw, dh, alpha * brightness, cbm > 0 ? cbm : 0);
      }
    
      // solidlayer (flat shader): 无纹理纯色填充, 颜色来自对象 color (引擎 flat.frag: uniform color)
,
    _renderSolidLayer(o, model, tr, t) {
        // 带音频条类程序化效果 (未实现) → 跳过, 避免白色占位块覆盖画面
        if (o.effects && o.effects.some((ef) => {
          const n = ef.file ? path.basename(path.dirname(ef.file)) : '';
          return /audio.?bar|audio_bar/i.test(n) || n === 'Simple_Audio_Bars' || n === 'enhanced_simple_audio_bars';
        })) return;
        let size = parseVec2(getVal(o, 'size'), [0, 0]);
        if (size[0] === 0 || size[1] === 0) size = [256, 256];
        if (model.fullscreen) size = [this.W, this.H];
        const alpha = getVal(o, 'alpha', 1);
        const brightness = getVal(o, 'brightness', 1);
        const ortho = this.scene.general && this.scene.general.orthogonalprojection;
        const ps = ortho && ortho.width ? [this.W / ortho.width, this.H / (ortho.height || 1080)] : null;
        const vs = this._viewShift(o, size, ps);
        const ox = (ps ? tr.origin[0] * ps[0] : tr.origin[0]) + vs[0];
        const sc = tr.scale;
        const dw = size[0] * sc[0] * (ps ? ps[0] : 1), dh = size[1] * sc[1] * (ps ? ps[1] : 1);
        // vs[1] 直接加 (与 renderPuppet 一致): 官方 view 平移 y 画布上移
        let dx = ox - dw / 2, dy = this.H - (ps ? tr.origin[1] * ps[1] : tr.origin[1]) - dh / 2 + vs[1];
        const align = String(getVal(o, 'alignment', '')).toLowerCase();
        // lwe CImage.cpp:242-248: top → 顶边下移到 origin; bottom → 底边上移到 origin
        if (align.includes('top')) dy += dh / 2;
        else if (align.includes('bottom')) dy -= dh / 2;
        if (align.includes('left')) dx += dw / 2;
        else if (align.includes('right')) dx -= dw / 2;
        // 颜色: 对象 color (或 model material 无 → 白); flat.frag 直接输出 color
        const col = parseVec3(getVal(o, 'color', '1 1 1'), [1, 1, 1]);
        let img = { width: 1, height: 1, rgba: new Uint8Array([col[0] * 255, col[1] * 255, col[2] * 255, 255]) };
        if (o.effects && o.effects.length) {
          img = this.applyEffects(o, img, t);
        }
        if (img && tr.angle !== 0) {
          // 旋转 (lwe CImage.cpp:1101-1105: quad 绕中心旋转 -angle; 90° 时 blitRotated 等价)
          this.canvas.blitRotated(img, dx + dw / 2, dy + dh / 2, dw, dh, tr.angle, alpha * brightness);
        } else if (img) {
          // colorBlendMode: 官方 ApplyBlending(mode, 画布, 对象色, alpha) (solidlayer 同样支持)
          const cbm = getVal(o, 'colorBlendMode', 0);
          this.canvas.blitScaled(img, dx, dy, dw, dh, alpha * brightness, cbm > 0 ? cbm : 0);
        }
      }
    
    
,
    _renderPassthroughLayer(o, model, pass, t) {
        const W = this.W, H = this.H;
        // 后处理层 (fullscreenlayer: fullscreen=true, 无 origin/size) → 全屏后处理:
        // 读全帧缓冲 → 效果链 → 全屏 blit。不能按对象定位 (origin 默认 0 → dx=-W/2
        // 偏移 → 全壁纸画面错位/"裁切")。
        if (model.fullscreen) {
          const frame = new Uint8Array(this.canvas.data);
          const tex = { width: W, height: H, rgba: frame };
          let img = tex;
          if (o.effects && o.effects.length) img = this.applyEffects(o, tex, t);
          if (!img) return;
          this.canvas.blit(img, 0, 0, getVal(o, 'alpha', 1));
          return;
        }
        // 组合层 (composelayer) → 按对象 origin/size 渲染到局部区域
        // (官方: 读 _rt_FullFrameBuffer + 效果链 → 层区域 blit)
        const tr = this.resolveTransform(o);
        let size = parseVec2(getVal(o, 'size'), [0, 0]);
        if (size[0] === 0 || size[1] === 0) size = [W, H];
        const ortho = this.scene.general && this.scene.general.orthogonalprojection;
        const ps = ortho && ortho.width ? [W / ortho.width, H / (ortho.height || 1080)] : null;
        const vs = this._viewShift(o, size, ps);
        const ox = (ps ? tr.origin[0] * ps[0] : tr.origin[0]) + vs[0];
        const sc = tr.scale;
        const dw = size[0] * sc[0] * (ps ? ps[0] : 1), dh = size[1] * sc[1] * (ps ? ps[1] : 1);
        let dx = ox - dw / 2, dy = H - (ps ? tr.origin[1] * ps[1] : tr.origin[1]) - dh / 2 + vs[1];
        // 效果链输入 = 当前全屏帧缓冲 (官方 _rt_FullFrameBuffer, 效果 UV 全屏语义)
        const frame = new Uint8Array(this.canvas.data);
        const tex = { width: W, height: H, rgba: frame };
        let img = tex;
        if (o.effects && o.effects.length) {
          // 组合层上的 blur 效果官方不生效 (blur 需 FBO 链, 组合层上退化输出原画布;
          // 用户实测官方 Mutsumi 无模糊) → 跳过 blur, 其他效果保留
          const effs = (o.effects || []).filter((ef) => {
            const n = ef && ef.file ? path.basename(path.dirname(ef.file)) : '';
            return n !== 'blur';
          });
          if (effs.length) {
            const saved = o.effects;
            o.effects = effs;
            try { img = this.applyEffects(o, tex, t); } finally { o.effects = saved; }
          }
        }
        if (!img) return;
        // 只把对象区域从效果结果中裁剪 → blit 回画布 (局部应用; 不能把全屏结果
        // blitScaled 缩放到局部 — 那会把整屏内容压缩到该区域, 视觉像"裁下中部放大")
        const cx = Math.max(0, Math.floor(dx)), cy = Math.max(0, Math.floor(dy));
        const cx1 = Math.min(W, Math.ceil(dx + dw)), cy1 = Math.min(H, Math.ceil(dy + dh));
        const cw = cx1 - cx, ch = cy1 - cy;
        if (cw <= 0 || ch <= 0) return;
        const alpha = getVal(o, 'alpha', 1);
        const rsrc = img.rgba;
        const region = new Uint8Array(cw * ch * 4);
        for (let y = 0; y < ch; y++) {
          const si = ((cy + y) * W + cx) * 4;
          region.set(rsrc.subarray(si, si + cw * 4), y * cw * 4);
        }
        this.canvas.blit({ width: cw, height: ch, rgba: region }, cx, cy, alpha);
      }
    
      // swayimage (beach/palms): swayMask 纹理正弦位移采样 (引擎 swayimage.frag)
,
    _swayImage(tex, swayMask, uniforms, t) {
        if (!swayMask) return tex;
        const w = tex.width, h = tex.height;
        const src = tex.rgba;
        const out = new Uint8Array(src.length);
        const speed = uniforms.Speed != null ? uniforms.Speed : 1;
        const amp = uniforms.Amount != null ? uniforms.Amount : 1;
        const bright = uniforms.Bright != null ? uniforms.Bright : 1;
        const t30 = t * 30 * speed, t27 = t * 27 * speed, t21 = t * 21 * speed, t7 = t * 7 * speed;
        // 步进 2 (性能): 摆动是低频, 1/2 分辨率计算后平滑
        const step = 2;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const u = (x + 0.5) / w, v = (y + 0.5) / h;
            const sm = this._texSample(swayMask, u, v);
            const phase = u * 10 + sm[2]; // swayMask.b
            const amt = Math.sin(t30 + phase) + Math.sin(t27 + phase) + Math.sin(t21 + phase) + Math.sin(t7 + phase);
            const offU = sm[0] * amt * amp * 0.01;
            const offV = sm[1] * amt * amp * 0.01;
            const s = this._texSample(tex, u + offU, v + offV);
            const di = (y * w + x) * 4;
            out[di] = Math.min(255, Math.round(s[0] * 255 * bright));
            out[di + 1] = Math.min(255, Math.round(s[1] * 255 * bright));
            out[di + 2] = Math.min(255, Math.round(s[2] * 255 * bright));
            out[di + 3] = Math.round(s[3] * 255);
          }
        }
        return { width: w, height: h, rgba: out };
      }
    
      // flag 旗帜: 法线贴图双采样扰动 + cloth + TINT + 光照 (引擎 flag.frag)
,
    _flagImage(tex, nTex, clothTex, uniforms, pass, t) {
        if (!nTex) return tex;
        const w = tex.width, h = tex.height;
        const src = tex.rgba;
        const out = new Uint8Array(src.length);
        const waveSpeed = uniforms.Speed != null ? uniforms.Speed : 0.4;
        const waveStrength = uniforms.Strength != null ? uniforms.Strength : 0.5;
        const combos = (pass && pass.combos) || {};
        const tint = !!(combos.TINT || combos.tint);
        const c1 = parseVec3(uniforms.color1, [0, 0, 0]);
        const c2 = parseVec3(uniforms.color2, [0, 0, 0]);
        const c3 = parseVec3(uniforms.color3, [1, 1, 1]);
        const decompress = (s) => [s[0] * 2 - 1, s[1] * 2 - 1, s[2] * 2 - 1];
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const u = (x + 0.5) / w, v = (y + 0.5) / h;
            // v_NormalCoord (vert): xy = uv*(1,0.3)*0.7, x -= t*speed; zw = uv*(1,0.7)*0.3, z -= t*speed*0.5
            let n1x = u * 0.7 - t * waveSpeed;
            let n1y = v * 0.3 * 0.7;
            let n2x = u * 0.3 - t * waveSpeed * 0.5;
            let n2y = v * 0.7 * 0.3;
            // frag 修正
            n1x -= ((0.5 - u) * (1 - v)) * 3;
            n1x += 2 * Math.pow(v - 0.1, 3) * Math.pow(u, 2);
            n2x -= ((1 - u) * (1 - v)) * 2;
            const nm1 = decompress(this._texSample(nTex, n1x, n1y));
            const nm2 = decompress(this._texSample(nTex, n2x, n2y));
            let n = [nm1[0] * nm2[0], nm1[1] * nm2[1], nm1[2] * nm2[2]];
            // mix((0,0,1), n, strength)
            n = [n[0] * waveStrength, n[1] * waveStrength, 1 + (n[2] - 1) * waveStrength];
            const nl = Math.sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]) || 1;
            n = [n[0] / nl, n[1] / nl, n[2] / nl];
            const bu = u + n[0] * 0.02, bv = v + n[1] * 0.02;
            const albedo = this._texSample(tex, bu, bv);
            const cloth = clothTex ? this._texSample(clothTex, bu * 4, bv * 4)[0] : 1;
            let color;
            if (tint) {
              let col = [
                c1[0] + (c2[0] - c1[0]) * albedo[0],
                c1[1] + (c2[1] - c1[1]) * albedo[0],
                c1[2] + (c2[2] - c1[2]) * albedo[0],
              ];
              col = [
                col[0] + (c3[0] - col[0]) * albedo[1],
                col[1] + (c3[1] - col[1]) * albedo[1],
                col[2] + (c3[2] - col[2]) * albedo[1],
              ];
              col = [col[0] * albedo[2] * cloth, col[1] * albedo[2] * cloth, col[2] * albedo[2] * cloth];
              col = [col[0] + cloth * 0.1, col[1] + cloth * 0.1, col[2] + cloth * 0.1];
              color = col;
            } else {
              color = [albedo[0], albedo[1], albedo[2]];
            }
            // light = 0.2 + dot((0.707,0.707,0), n)*0.5+0.5; +pow(light,5)*0.5
            let light = 0.2 + (0.707 * n[0] + 0.707 * n[1]) * 0.5 + 0.5;
            light += Math.pow(light, 5) * 0.5;
            const lightMul = light + light * Math.max(0, Math.min(1, cloth * 2 - 1));
            const di = (y * w + x) * 4;
            out[di] = Math.min(255, Math.round(color[0] * lightMul * 255));
            out[di + 1] = Math.min(255, Math.round(color[1] * lightMul * 255));
            out[di + 2] = Math.min(255, Math.round(color[2] * lightMul * 255));
            out[di + 3] = 255;
          }
        }
        return { width: w, height: h, rgba: out };
      }
    
      // retro (retro): HSV 色调映射 + grunge + DOTS 霓虹 (引擎 retro.frag)
,
    _retroImage(tex, grungeTex, uniforms, pass, t, W, H) {
        const w = tex.width, h = tex.height;
        const src = tex.rgba;
        const out = new Uint8Array(src.length);
        const combos = (pass && pass.combos) || {};
        const dots = !!(combos.DOTS || combos.dots);
        // tint (usershadervalues accentcolor → tint)
        const tint = parseVec3(uniforms.tint, [0.95, 0.05, 0.1]);
        const baseHSV = rgb2hsv(tint);
        const aspect = grungeTex ? grungeTex.height / grungeTex.width : 1;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            let u = (x + 0.5) / w, v = (y + 0.5) / h;
            if (dots) u -= t * 0.02;
            const col = this._texSample(tex, u * 0.997, v * 0.997);
            // v_TexCoordGrunge = clip.xy/w * 0.75 * aspect (近似: uv 中心化)
            const gu = ((u - 0.5) * 2) * 0.75 * aspect;
            const gv = ((v - 0.5) * 2) * 0.75;
            const grunge = grungeTex ? this._texSample(grungeTex, gu, gv)[3] : 0;
            // HSV 色调
            const hsv = [baseHSV[0] + col[1] * 0.11, baseHSV[1], baseHSV[2] * col[2]];
            let rgb = hsv2rgb(hsv);
            // albedo.rgb -= saturate(grunge - albedo.rgb)
            for (let c = 0; c < 3; c++) {
              const g2 = Math.max(0, Math.min(1, grunge - rgb[c]));
              rgb[c] = Math.max(0, rgb[c] - g2);
            }
            let a = col[3];
            if (dots) {
              const stepOffset = Math.ceil(v * 4) * 0.24;
              a *= (u <= 1.1 + stepOffset ? 1 : 0);
              const kernelSize = smoothstepFn(0.1, 1.0, u - stepOffset) * 1.1;
              a *= smoothstepFn(kernelSize - 0.15, kernelSize, col[0]);
            }
            const di = (y * w + x) * 4;
            out[di] = Math.min(255, Math.round(rgb[0] * 255));
            out[di + 1] = Math.min(255, Math.round(rgb[1] * 255));
            out[di + 2] = Math.min(255, Math.round(rgb[2] * 255));
            out[di + 3] = Math.round(a * 255);
          }
        }
        return { width: w, height: h, rgba: out };
      }
    
      // ── Text 对象渲染: CFF 字体解析 + 位图光栅化 → 画布 blit ───────
  });
  Object.defineProperty(proto, '_customShaders', {
    get() {
          return new Set(['core', 'backgroundsphere', 'dna', 'bg', 'curve', 'neonsun', 'neongrid', 'cloudsbg', 'flowimage']);
    },
    configurable: true,
  });
}
