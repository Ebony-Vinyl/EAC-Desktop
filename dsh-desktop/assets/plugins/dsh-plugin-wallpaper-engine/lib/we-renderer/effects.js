// WE 渲染引擎 — effects 聚合入口
// 各效果实现拆分在 effects/ 子目录 (按效果 1 文件), 此文件仅保留 applyEffects 分派
import path from 'path';
import { getVal } from './math.js';
import { fx as fxGodrays } from './effects/godrays.js';
import { fx as fxScroll } from './effects/scroll.js';
import { fx as fxTint } from './effects/tint.js';
import { fx as fxPulse } from './effects/pulse.js';
import { fx as fxFilmgrain } from './effects/filmgrain.js';
import { fx as fxOpacity } from './effects/opacity.js';
import { fx as fxSkew } from './effects/skew.js';
import { fx as fxIris } from './effects/iris.js';
import { fx as fxLightshafts } from './effects/lightshafts.js';
import { fx as fxCloudmotion } from './effects/cloudmotion.js';
import { fx as fxShimmer } from './effects/shimmer.js';
import { fx as fxBlurradial } from './effects/blurradial.js';
import { fx as fxBlur } from './effects/blur.js';
import { fx as fxDepthParallax } from './effects/depthparallax.js';
import { fx as fxWaterCaustics } from './effects/watercaustics.js';
import { fx as fxBlend } from './effects/blend.js';
import { fx as fxGlitter } from './effects/glitter.js';
import { fx as fxClouds } from './effects/clouds.js';
import { fx as fxSwing } from './effects/swing.js';
import { fx as fxWaterflow } from './effects/waterflow.js';
import { fx as fxFoliageSway } from './effects/foliagesway.js';
import { fx as fxWaterwaves } from './effects/waterwaves.js';
import { fx as fxWaterripple } from './effects/waterripple.js';
import { fx as fxShake } from './effects/shake.js';

const allFx = Object.assign({}, fxGodrays, fxScroll, fxTint, fxPulse, fxFilmgrain, fxOpacity, fxSkew, fxIris, fxLightshafts, fxCloudmotion, fxShimmer, fxBlurradial, fxBlur, fxDepthParallax, fxWaterCaustics, fxBlend, fxGlitter, fxClouds, fxSwing, fxWaterflow, fxFoliageSway, fxWaterwaves, fxWaterripple, fxShake);

export function installEffects(proto) {
  Object.assign(proto, {
    applyEffects(o, tex, t) {
        let img = tex;
        for (const ef of o.effects || []) {
          if (getVal(ef, 'visible', true) === false) continue;
          const file = ef.file || '';
          if (!file) continue;
          const name = path.basename(path.dirname(file)); // effects/waterwaves → waterwaves
          const passes = ef.passes || [];
          const pass = passes[0] || {};
          const c = pass.constantshadervalues || {};
          const combos = pass.combos || {};
          try {
            if (name === 'waterwaves') {
              img = this.effectWaterwaves(img, c, t, pass);
            } else if (name === 'waterflow') {
              img = this.effectWaterflow(img, c, t, pass);
            } else if (name === 'foliagesway') {
              img = this.effectFoliageSway(img, c, t, pass);
            } else if (name === 'skew') {
              img = this.effectSkew(img, c, t, pass);
            } else if (name === 'iris') {
              img = this.effectIris(img, c, t, pass);
            } else if (name === 'lightshafts') {
              img = this.effectLightshafts(img, c, t, pass);
            } else if (name === 'cloudmotion') {
              img = this.effectCloudmotion(img, c, t, pass);
            } else if (name === 'shimmer') {
              img = this.effectShimmer(img, c, t, pass);
            } else if (name === 'blurradial') {
              img = this.effectBlurradial(img, c, t, pass);
            } else if (name === 'clouds') {
              img = this.effectClouds(img, c, t, pass);
            } else if (name === 'swing') {
              img = this.effectSwing(img, c, t, pass);
            } else if (name === 'waterripple') {
              img = this.effectWaterripple(img, c, t, ef, pass);
            } else if (name === 'shake') {
              img = this.effectShake(img, c, t, pass);
            } else if (name === 'scroll') {
              img = this.effectScroll(img, c, t);
            } else if (name === 'tint') {
              img = this.effectTint(img, c, t, combos, pass);
            } else if (name === 'pulse') {
              img = this.effectPulse(img, c, t, combos, pass);
            } else if (name === 'filmgrain') {
              img = this.effectFilmgrain(img, c, t, combos, pass);
            } else if (name === 'godrays') {
              img = this.effectGodrays(img, passes, t);
            } else if (name === 'glitter') {
              img = this.effectGlitter(img, passes, t);
            } else if (name === 'opacity') {
              // 官方 shader (effects/opacity.frag): albedo.a *= mask.r
              // (g_Texture1 = mask, 默认 util/white); mask UV 按纹理比缩放 (简化用 uv)
              img = this.effectOpacity(img, c, t, pass);
            } else if (name === 'blur') {
              // 官方 4-pass 高斯模糊链 (downsample4 → gaussian_x → gaussian_y → combine)
              img = this.effectBlur(img, passes, c, t, pass);
            } else if (name === 'depthparallax') {
              // 官方交互式视差 (QUALITY 0/1/2; 静态帧鼠标居中 → 近似恒等)
              img = this.effectDepthParallax(img, c, t, pass);
            } else if (name === 'watercaustics') {
              // 官方水焦散 (4 噪声纹理卷动 + voronoi 图案 + chromatic)
              img = this.effectWaterCaustics(img, c, t, pass);
            } else if (name === 'blend') {
              // 官方 blend (blend 纹理按 BLENDMODE/WRITEALPHA 混合)
              img = this.effectBlend(img, passes, c, t, pass);
            } else if (name === 'blurprecise') {
              // 跳过 (性能)
            } else {
              // 第三方 workshop 效果 / 官方未实现 → GLSL 解释执行 (读 pkg/全局 shader)
              // 失败回退原图 (不崩溃)
              img = this._applyGlslEffect(img, ef, name, t);
            }
          } catch (e) {
            this.log('效果 ' + name + ' 失败: ' + e.message);
          }
        }
        return img;
      },
    ...allFx,
  });
}
