// WE 渲染引擎 — text (从 core.js 拆分, 逻辑不变)
import path from 'path';
import { parseVec3, getVal } from './math.js';
import { parseCffFont, renderText } from '../font-render.js';

// ── text mixin (从 core.js 拆分, 逻辑零改动) ──
export function installText(proto) {
  Object.assign(proto, {
    // 字体解析缓存 + 文本位图缓存: 多 text 对象 (Clock/Date 等) 共用同字体,
    // 旧实现每对象每帧重新 parseCffFont + renderText → 20+ 文本对象每帧数十秒。
    // 字体缓存: fontPath → 解析结果; 位图缓存: key=font|text|px|color → 光栅化结果
    // (时钟等动态文本每秒新 key, 缓存上限 256 条 FIFO 清理)。
    _fontCache: new Map(),
    _textBitmapCache: new Map(),
    _renderTextCached(fontPath, text, px, color, alpha) {
      const key = fontPath + '|' + px + '|' + text + '|' + color.join(',');
      const hit = this._textBitmapCache.get(key);
      if (hit) return hit;
      const raw = this.readAny(fontPath) || this.readAny('fonts/' + path.basename(fontPath));
      if (!raw) return null;
      let font = this._fontCache.get(fontPath);
      if (!font) {
        font = parseCffFont(raw);
        if (!font) return null;
        this._fontCache.set(fontPath, font);
      }
      const img = renderText(font, text, px, color);
      if (this._textBitmapCache.size >= 256) {
        const first = this._textBitmapCache.keys().next().value;
        if (first !== undefined) this._textBitmapCache.delete(first);
      }
      this._textBitmapCache.set(key, img);
      return img;
    },
    // 即时文本检测: 时钟/日期/FPS 等脚本每帧读真实时间/引擎帧率, 与静态帧
    // 缓存直接冲突 — 缓存的 PNG 里时钟冻结在渲染时刻 (错误时间), 且 scene-anim
    // 视频循环时同样冻结。策略 (用户决策): 短期放弃渲染这类文本 (识别即跳过),
    // 避免缓存输出错误时间; "拆出文本层单独实时渲染" 方案写入 TODO 延后。
    // 识别: text 是 {script, value} 且脚本源码含时间/帧率依赖 (new Date / Date.*
    // / getHours 等 / engine.frametime / performance.now)。
    _isLiveText(o) {
      const t = o && o.text;
      if (!t || typeof t !== 'object' || typeof t.script !== 'string') return false;
      return /new\s+Date\b|Date\.now|getHours\(|getMinutes\(|getSeconds\(|getFullYear\(|getMonth\(|getDate\(|getDay\(|engine\.frametime|performance\.now|Date\(\)/.test(t.script);
    },
    // 作者水印/可关闭声明检测: 静态文本 (无脚本) + visible 绑定用户属性
    // (可关闭) — 如伊蕾娜系列 "Bilibili/抖音 夜莺Night"、"（可自定义文字）"
    // (visible.user="newproperty50")。用户决策: 壁纸不渲染作者水印, 一并跳过。
    // 与 _isLiveText 互补: 脚本文本 (时钟/媒体信息等) 不在水印范围 (media
    // 信息类脚本组件保留); 仅纯静态文本 + visible.user 判定为水印。
    _isWatermarkText(o) {
      const t = o && o.text;
      if (!t || typeof t !== 'object' || typeof t.script === 'string') return false;
      const v = o && o.visible;
      if (v && typeof v === 'object' && v !== null && 'user' in v) {
        return typeof v.user === 'string' && v.user.length > 0;
      }
      return false;
    },
    renderTextObject(o, t) {
        // 即时文本 (时钟/日期/FPS): 放弃渲染 (静态帧缓存会冻结错误时间)
        if (this._isLiveText(o)) return;
        // 作者水印/可关闭声明 (静态文本 + visible.user): 一并放弃渲染
        if (this._isWatermarkText(o)) return;
        const text = String(getVal(o, 'text', ''));
        if (!text) return;
        const color = parseVec3(getVal(o, 'color', '1 1 1'), [1, 1, 1]);
        const pointsize = getVal(o, 'pointsize', 32);
        const scale = parseVec3(getVal(o, 'scale'), [1, 1, 1]);
        const tr = this.resolveTransform(o);
        const ortho = this.scene.general && this.scene.general.orthogonalprojection;
        const ps = ortho && ortho.width ? [this.W / ortho.width, this.H / (ortho.height || 1080)] : [1, 1];
        // 字体: 场景 fonts/ 或全局 assets/fonts/; systemfont_* = WE 系统字体标识
        // (引擎用系统字体; 跨平台用内置 NotoSans 替代)
        let fontPath = getVal(o, 'font', '');
        if (String(fontPath).startsWith('systemfont_')) {
          fontPath = 'fonts/NotoSans-Regular.ttf';
        }
        if (fontPath) {
          try {
            // 官方 CText 语义 (lwe CText.cpp:204-213): 栅格化高分辨率补偿 —
            // WE 文本 scale 常 ~0.09, 直接 pointsize×scale 会栅格化到 ~2px
            // 不可见。栅格化 px = pointsize × compensate (compensate =
            // min(1/avgScale, 32) 当 scale<1), 显示时 model scale 应用 →
            // 屏幕尺寸 = pointsize 场景单位 (再 × ps 到画布)。
            const avgScale = (scale[0] + scale[1]) / 2;
            const compensate = avgScale > 0 && avgScale < 1 ? Math.min(1 / avgScale, 32) : 1;
            const px = Math.max(4, Math.round(pointsize * compensate));
            const img = this._renderTextCached(fontPath, text, px, color, getVal(o, 'alpha', 1));
            if (!img || !img.width) return;
            // 显示尺寸 = 栅格化 × scale (官方 quad×model scale) × ps (场景→画布)
            const dw = Math.max(1, Math.round(img.width * scale[0] * ps[0]));
            const dh = Math.max(1, Math.round(img.height * scale[1] * ps[1]));
            // 定位: origin 是场景坐标 (y 向上); 官方 CText quad 中心 = origin
            // (lwe CText.cpp:344 quad 中心, 无 alignment 偏移; horizontalalign 默认 center)
            const vs = this._viewShift(o, [img.width, img.height], ps);
            // 文本坐标系: 与 image 同用 Y-up (origin.y 场景坐标, 底部为 0)。
            // 验证 (sf39e): 3655429099 音频壁纸 — 音频条 image y=275 → 画布底部
            // (Y-up 正确), 时钟文本 y≈2000 → 画布顶部 (Y-up 正确); lwe CText 的
            // Y-down 是 Linux 移植转置, 官方 WE 场景文本与 image 同约定。
            const ox = tr.origin[0] * ps[0] + vs[0];
            const oy = this.H - tr.origin[1] * ps[1] + vs[1];
            // horizontalalign: left → 左边缘在 origin, right → 右边缘, center(默认) → 中心
            const align = String(getVal(o, 'horizontalalign', 'center'));
            const dx = align === 'right' ? ox - dw : (align === 'left' ? ox : ox - dw / 2);
            // verticalalign (sf39e): 与 image alignment 同语义 (官方统一锚定约定,
            // 参照 image.js top→顶边锚定 origin 向下展开, bottom→底边锚定 origin
            // 向上展开): top → dy=oy (顶边在 origin), bottom → dy=oy-dh (底边在
            // origin), center(默认) → dy=oy-dh/2。之前完全忽略 verticalalign
            // (231 文本 center 默认不受影响, 1 个 bottom 文本位置错误已修复)。
            const valign = String(getVal(o, 'verticalalign', 'center'));
            const dy = valign === 'top' ? oy : (valign === 'bottom' ? oy - dh : oy - dh / 2);
            this.canvas.blitScaled(img, dx, dy, dw, dh, getVal(o, 'alpha', 1));
          } catch (e) {
            this.log('text ' + (o.name || o.id) + ' 渲染失败: ' + e.message);
          }
        }
      }
    
      // ── Puppet (MDL 网格) 渲染: 解析 mesh → 蒙皮(骨骼动画) → 光栅化 ────
  });
}
