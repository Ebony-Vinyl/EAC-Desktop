// WE 渲染引擎 — 效果 FoliageSway (从 effects.js 拆分, 逻辑零改动)
import { getVal } from '../math.js';

export const fx = {
      // foliagesway (引擎 shader: effects/foliagesway.frag/vert, MODE=0 UV 模式):
      //   vert: aspect=(h/w)×ratio; rotDir=rotate([1/aspect, aspect], dir)
      //         noiseUV=uv×noiseScale; params=rotate(uv,dir); amp=strength²×0.005
      //   frag: noise=sample(noise, noiseUV).rgb (用 g 通道)
      //         phase=(noise.g×2π + params.x×10 + params.y×5)×g_Phase
      //         sines = sin(phase + speed×t×(1, -0.16161616, 0.0083333, -0.00019841))
      //         csines= sin(0.4 + phase + speed×t×(-0.5, 0.041666666, -0.0013888889, 0.000024801587))
      //         sines/csines = pow(|s|, power)×sign(s)
      //         offset = rotDir × amp × (Σsines, Σcsines); out = sample(tex, uv + offset)
      //   uniform 名 (真实场景 constantshadervalues): speeduv/power/phase/strength/
      //     scrolldirection/scale(noiseScale)/ratio; textures=[null, mask, noise?]
      //   mask 启用: 场景提供 textures[1] 即按 MASK 语义乘 mask.r (combos 通常不显式设)

    effectFoliageSway(tex, c, t, pass) {
        const W = tex.width, H = tex.height;
        const speed = getVal(c, 'speeduv', getVal(c, 'speed', 5));
        const power = getVal(c, 'power', 1);
        const phase = getVal(c, 'phase', 0.5);
        const strength = getVal(c, 'strength', 0.4);
        const direction = getVal(c, 'scrolldirection', getVal(c, 'direction', 0));
        const ratio = getVal(c, 'ratio', 0.3);
        const noiseScale = getVal(c, 'scale', 0.05);
        const pt = (pass && pass.textures) || [];
        const hasMask = !!pt[1] && pt[1] !== 'null';
        const maskTex = hasMask ? this.loadTexture(pt[1]) : null;
        // 官方 foliagesway.vert: v_TexCoord.zw mask UV 缩放 (maskRes/对象Res) (sf39i)
        const mSx = maskTex && maskTex.width > 0 ? maskTex.width / tex.width : 1;
        const mSy = maskTex && maskTex.height > 0 ? maskTex.height / tex.height : 1;
        const noiseTex = pt[2] && pt[2] !== 'null' ? this.loadTexture(pt[2]) : this.loadTexture('util/noise');
        const src = tex.rgba;
        const out = new Uint8Array(src.length);
        const cosD = Math.cos(direction), sinD = Math.sin(direction);
        const rotate = (x, y) => [x * cosD - y * sinD, x * sinD + y * cosD];
        // aspect = g_Texture0Resolution.z/w × ratio = (texW/texH) × ratio
        // (官方 foliagesway.vert: aspect = texW/texH×ratio; 本地曾用 H/W → 反了,
        //  rotDir 的 x/y 轴互换 → 摆动方向与官方垂直)
        const aspect = (W / H) * ratio;
        const rotDir = rotate(1 / aspect, aspect);
        const ampBase = strength * strength * 0.005;
        const TWO_PI = Math.PI * 2;
        const sW = [1, -0.16161616, 0.0083333, -0.00019841];
        const cW = [-0.5, 0.041666666, -0.0013888889, 0.000024801587];
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const u = (x + 0.5) / W, v = (y + 0.5) / H;
            const noise = this._texSample(noiseTex, u * noiseScale, v * noiseScale);
            const pr = rotate(u, v);
            let amp = ampBase;
            if (maskTex) amp *= this._texSample(maskTex, u * mSx, v * mSy)[0];
            const phaseV = (noise[1] * TWO_PI + pr[0] * 10 + pr[1] * 5) * phase;
            let so = 0, co = 0;
            for (let i = 0; i < 4; i++) {
              const sv = Math.sin(phaseV + speed * t * sW[i]);
              const cv = Math.sin(0.4 + phaseV + speed * t * cW[i]);
              so += Math.pow(Math.abs(sv), power) * Math.sign(sv);
              co += Math.pow(Math.abs(cv), power) * Math.sign(cv);
            }
            const s = this._texSample(tex, u + rotDir[0] * so * amp, v + rotDir[1] * co * amp);
            const di = (y * W + x) * 4;
            out[di] = Math.round(s[0] * 255); out[di + 1] = Math.round(s[1] * 255);
            out[di + 2] = Math.round(s[2] * 255); out[di + 3] = Math.round(s[3] * 255);
          }
        }
        return { width: W, height: H, rgba: out };
      }
};
