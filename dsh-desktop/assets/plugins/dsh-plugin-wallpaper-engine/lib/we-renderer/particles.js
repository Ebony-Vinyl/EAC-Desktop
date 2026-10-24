// WE 渲染引擎 — particles (从 core.js 拆分, 逻辑不变)
import { parseVec3, getVal } from './math.js';

// ── particles mixin (从 core.js 拆分, 逻辑零改动) ──
export function installParticles(proto) {
  Object.assign(proto, {
    renderParticleSystem(o, t) {
        // 读取粒子定义 (文件或内联)
        let def = null;
        const particleVal = o.particle;
        if (typeof particleVal === 'string') {
          def = this.pkg.readJson(particleVal);
        } else if (typeof particleVal === 'object') {
          def = particleVal;
        }
        if (!def) return;
        const sys = this._buildParticleSystem(o, def);
        if (!sys) return;
        // 模拟期也使用确定性 RNG (发射/初始器), 保证同场景帧可复现
        const origRandom = Math.random;
        Math.random = sys.rng;
        try {
          this._simulateParticleSystem(sys, t);
          this._drawParticles(sys);
        } finally {
          Math.random = origRandom;
        }
      }
    
,
    _buildParticleSystem(o, def) {
        const tr = this.resolveTransform(o);
        const origin = tr.origin;
        const scale = tr.scale;
        const angle = tr.angle;
        const inst = o.instanceoverride || {};
        const alphaMul = getVal(inst, 'alpha', 1);
        const rateMul = getVal(inst, 'rate', 1);
        const maxCount = def.maxcount || 100;
        // 确定性伪随机: 粒子生成期间替换 Math.random, 保证同场景渲染可复现 (缓存一致)
        const rng = this._particleRng(o);
        const origRandom = Math.random;
        Math.random = rng;
        try {
          const sys = this._buildParticleSystemInner(o, def, { tr, origin, scale, angle, inst, alphaMul, rateMul, maxCount, rng });
          return sys;
        } finally {
          Math.random = origRandom;
        }
      }
    
,
    _buildParticleSystemInner(o, def, ctx) {
        const { tr, origin, scale, angle, inst, alphaMul, rateMul, maxCount, rng } = ctx;
        const emitters = (def.emitter || []).map((e) => this._parseEmitter(e, scale, angle));
        const initializers = (def.initializer || []).map((i) => this._parseInitializer(i)).filter(Boolean);
        const operators = (def.operator || []).map((op) => this._parseOperator(op)).filter(Boolean);
        // 纹理 + 材质属性 (blending / usershadervalues)
        let tex = null;
        let blending = 'translucent';
        let color1 = [1, 1, 1], color2 = [1, 1, 1];
        if (def.material) {
          const mat = this.pkg.readJson(def.material);
          const pass = mat && mat.passes && mat.passes[0] ? mat.passes[0] : null;
          if (pass) {
            if (pass.textures && pass.textures.length) tex = this.loadTexture(pass.textures[0]);
            if (pass.blending) blending = pass.blending;
            const usv = pass.usershadervalues;
            if (usv) for (const [prop, uniform] of Object.entries(usv)) {
              const v = this.userProps[prop];
              if (uniform === 'color1') color1 = typeof v === 'string' ? parseVec3(v, [1, 1, 1]) : color1;
              else if (uniform === 'color2') color2 = typeof v === 'string' ? parseVec3(v, [1, 1, 1]) : color2;
            }
          }
        }
        // 正交投影缩放: 场景单位 → 画布像素 (原生 ortho(-w/2,w/2,-h/2,h/2) 投影)
        let projScale = null;
        const ortho = this.scene.general && this.scene.general.orthogonalprojection;
        if (ortho && ortho.width) {
          projScale = [this.W / ortho.width, this.H / (ortho.height || 1080)];
        }
        return {
          o, origin, scale, angle, alphaMul, rateMul, maxCount,
          emitters, initializers, operators, tex, blending, color1, color2, projScale,
          animFrames: def.animationmode === 'sequence' ? (def.sequencemultiplier || 1) : 0,
          starttime: def.starttime || 0,
          particles: [],
          acc: 0, count: 0, t0: this.time,
          // 确定性伪随机 (mulberry32): 种子来自场景路径, 保证同场景渲染可复现 (缓存一致)
          rng: this._particleRng(o),
        };
      }
    
      // mulberry32 确定性 RNG (种子 = 对象 id + 场景路径 hash)
,
    _particleRng(o) {
        let seed = 0x9e3779b9;
        const str = String(this.pkgPath) + '|' + (o.id != null ? o.id : o.name || '') + '|' + (o.origin || '');
        for (let i = 0; i < str.length; i++) {
          seed = (seed ^ str.charCodeAt(i)) * 16777619 >>> 0;
        }
        return () => {
          seed = (seed + 0x6D2B79F5) >>> 0;
          let t = seed;
          t = Math.imul(t ^ (t >>> 15), t | 1);
          t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
      }
    
,
    _parseEmitter(e, scale, angle) {
        const name = e.name || 'boxrandom';
        const rate = (e.rate || 0) * (e.rate != null ? 1 : 1);
        return {
          name,
          rate: e.rate || 10,
          instantaneous: e.instantaneous || 0,
          delay: e.delay || 0,
          duration: e.duration || 0,
          origin: parseVec3(e.origin, [0, 0, 0]),
          directions: parseVec3(e.directions, [1, 1, 0]),
          distanceMin: parseVec3(e.distancemin, [0, 0, 0]),
          distanceMax: parseVec3(e.distancemax, [256, 256, 0]),
          sign: parseVec3(e.sign, [0, 0, 0]).map((x) => (typeof x === 'number' ? x : 0)),
          speedMin: e.speedmin || 0,
          speedMax: e.speedmax || 0,
          cone: e.cone || 0,
          controlPoint: e.controlpoint != null ? e.controlpoint : -1,
          flags: e.flags || 0,
          scale, angle,
        };
      }
    
,
    _parseInitializer(i) {
        const name = i.name || '';
        return { name, params: i };
      }
    
,
    _parseOperator(op) {
        const name = op.name || '';
        return { name, params: op };
      }
    
,
    _simulateParticleSystem(sys, t) {
        // 引擎 starttime: 粒子系统从 starttime 后启动 (t < starttime → 无粒子)
        const st = sys.starttime || 0;
        // 从 0 开始模拟到 t-starttime (静态帧渲染: 一次性推进)
        if (sys._simulatedTo == null) sys._simulatedTo = 0;
        let simT = sys._simulatedTo;
        const target = Math.max(0, t - st);
        let guard = 0;
        while (simT < target && guard < 2000) {
          const dt = Math.min(0.05, target - simT);
          this._stepParticles(sys, dt, simT);
          simT += dt;
          guard++;
        }
        sys._simulatedTo = target;
      }
    
,
    _stepParticles(sys, dt, simT) {
        // 发射
        for (const em of sys.emitters) {
          if (em.delay > 0 && simT < em.delay) continue;
          let toEmit = 0;
          if (em.instantaneous > 0 && !em._emitted) {
            toEmit = em.instantaneous;
            em._emitted = true;
          }
          sys.acc += dt * em.rate * sys.rateMul;
          toEmit += Math.floor(sys.acc);
          sys.acc -= Math.floor(sys.acc);
          const cap = em.flags & 2 ? 1 : toEmit;
          for (let k = 0; k < cap && sys.count < sys.maxCount; k++) {
            const p = this._spawnParticle(sys, em);
            sys.particles.push(p);
            sys.count++;
          }
        }
        // 更新
        for (const p of sys.particles) p.age += dt;
        for (const op of sys.operators) this._applyOperator(sys, op, dt, simT);
        // 移除死亡
        for (let i = sys.particles.length - 1; i >= 0; i--) {
          if (sys.particles[i].age >= sys.particles[i].lifetime) sys.particles.splice(i, 1);
        }
      }
    
,
    _spawnParticle(sys, em) {
        // 粒子系统: origin 是场景坐标 (y 向上), 像素中心 = (origin.x, H - origin.y)
        const ox = em.origin[0] * em.scale[0], oy = -em.origin[1] * em.scale[1];
        let px, py;
        if (em.name === 'sphererandom') {
          const angle = Math.random() * Math.PI * 2;
          const minR = em.distanceMin[0], maxR = em.distanceMax[0];
          const r = minR + Math.random() * (maxR - minR);
          px = Math.cos(angle) * r * em.directions[0];
          py = Math.sin(angle) * r * em.directions[1];
        } else {
          // boxrandom: 每轴在 [distancemin, distancemax] 范围内随机距离 + 随机翻转符号
          // (官方 emitter 字段 distancemin/max 实测; min>max 时交换容错)
          // speedmin/max (发射初速) 与 sign (每轴符号) 语义未从官方确认 → 暂不实现
          const randRange = (a, b) => (Math.min(a, b) + Math.random() * Math.abs(b - a));
          const rx = randRange(em.distanceMin[0], em.distanceMax[0]);
          const ry = randRange(em.distanceMin[1], em.distanceMax[1]);
          px = (Math.random() < 0.5 ? -rx : rx) * em.directions[0];
          py = (Math.random() < 0.5 ? -ry : ry) * em.directions[1];
        }
        // 应用系统缩放和旋转
        const cos = Math.cos(-em.angle), sin = Math.sin(-em.angle);
        const rx = px * cos - py * sin, ry = px * sin + py * cos;
        // 应用 initializers
        const p = {
          pos: [ox + rx * em.scale[0], oy + ry * em.scale[1], 0],
          // 纯场景坐标 (y 向上, 未翻转/未烘焙 H) — 正交投影场景用
          scenePos: [em.origin[0] * em.scale[0] + rx * em.scale[0], em.origin[1] * em.scale[1] + ry * em.scale[1], 0],
          vel: [0, 0, 0], angVel: 0, rot: 0,
          alpha: 1, size: 20, color: [1, 1, 1],
          life: 1, age: 0, alive: true,
          oscAlpha: null, oscSize: null, oscPos: null,
        };
        for (const init of sys.initializers) this._applyInitializer(p, init);
        // 像素坐标: 屏幕中心 = (origin.x, H - origin.y)
        const sx = sys.origin[0] + p.pos[0];
        const sy = this.H - sys.origin[1] + p.pos[1];
        p.pos = [sx, sy, 0];
        return p;
      }
    
,
    _applyInitializer(p, init) {
        const pr = init.params;
        switch (init.name) {
          case 'sizerandom': {
            const min = getVal(pr, 'min', 1), max = getVal(pr, 'max', 20);
            p.size = min + Math.random() * (max - min);
            p._initSize = p.size;
            break;
          }
          case 'alpharandom': {
            const min = getVal(pr, 'min', 0.05), max = getVal(pr, 'max', 1);
            p.alpha = min + Math.random() * (max - min);
            p._initAlpha = p.alpha;
            break;
          }
          case 'lifetimerandom': {
            const min = getVal(pr, 'min', 0), max = getVal(pr, 'max', 1);
            p.life = min + Math.random() * (max - min);
            break;
          }
          case 'velocityrandom': {
            const min = parseVec3(getVal(pr, 'min'), [-32, -32, -32]);
            const max = parseVec3(getVal(pr, 'max'), [32, 32, 32]);
            p.vel = [
              min[0] + Math.random() * (max[0] - min[0]),
              min[1] + Math.random() * (max[1] - min[1]),
              min[2] + Math.random() * (max[2] - min[2]),
            ];
            break;
          }
          case 'rotationrandom': {
            const min = parseVec3(getVal(pr, 'min'), [0, 0, 0]);
            const max = parseVec3(getVal(pr, 'max'), [0, 0, Math.PI * 2]);
            p.rot = min[2] + Math.random() * (max[2] - min[2]);
            break;
          }
          case 'angularvelocityrandom': {
            const min = parseVec3(getVal(pr, 'min'), [0, 0, -5]);
            const max = parseVec3(getVal(pr, 'max'), [0, 0, 5]);
            p.angVel = min[2] + Math.random() * (max[2] - min[2]);
            break;
          }
          case 'colorrandom': {
            const min = parseVec3(getVal(pr, 'min'), [0, 0, 0]);
            const max = parseVec3(getVal(pr, 'max'), [1, 1, 1]);
            // 引擎初始器值域 0-255, 着色器内归一化到 0..1 (v_Color.r 参与 mix)
            const k = (max[0] > 1 || max[1] > 1 || max[2] > 1 || min[0] > 1 || min[1] > 1 || min[2] > 1) ? 1 / 255 : 1;
            p.color = [
              (min[0] + Math.random() * (max[0] - min[0])) * k,
              (min[1] + Math.random() * (max[1] - min[1])) * k,
              (min[2] + Math.random() * (max[2] - min[2])) * k,
            ];
            break;
          }
        }
      }
    
,
    _applyOperator(sys, op, dt, t) {
        const pr = op.params;
        for (const p of sys.particles) {
          switch (op.name) {
            case 'movement': {
              const gravity = parseVec3(getVal(pr, 'gravity'), [0, 0, 0]);
              const drag = getVal(pr, 'drag', 0);
              p.pos[0] += p.vel[0] * dt;
              p.pos[1] += p.vel[1] * dt;
              p.vel[0] += gravity[0] * dt;
              p.vel[1] += -gravity[1] * dt; // Y flip
              const df = Math.max(0, 1 - drag * dt);
              p.vel[0] *= df; p.vel[1] *= df;
              if (p.scenePos) {
                // 场景坐标 (y 向上): x 同向, y 与画布 y-down 反向
                p.scenePos[0] += p.vel[0] * dt;
                p.scenePos[1] += -p.vel[1] * dt;
              }
              break;
            }
            case 'angularmovement': {
              const force = parseVec3(getVal(pr, 'force'), [0, 0, 0]);
              const drag = getVal(pr, 'drag', 0);
              p.rot += p.angVel * dt;
              p.angVel += force[2] * dt;
              p.angVel *= Math.max(0, 1 - drag * dt);
              break;
            }
            case 'alphafade': {
              const fadeIn = getVal(pr, 'fadeintime', 0.5);
              const fadeOut = getVal(pr, 'fadeouttime', 0.5);
              const lifePos = p.life > 0 ? p.age / p.life : 1;
              const base = p._initAlpha ?? 1;
              // 原生: fade = fadeValue(life, 0, fadeIn, 0, 1) = smoothstep
              let fade;
              if (lifePos <= fadeIn) {
                const tt = fadeIn > 0 ? Math.min(1, Math.max(0, lifePos / fadeIn)) : 1;
                fade = tt * tt * (3 - 2 * tt);
              } else if (lifePos > fadeOut) {
                const tt = 1 - fadeOut > 0 ? Math.min(1, Math.max(0, (lifePos - fadeOut) / (1 - fadeOut))) : 1;
                fade = 1 - tt * tt * (3 - 2 * tt);
              } else fade = 1;
              p.alpha = base * fade;
              // 原生每帧刷新振荡器基数 (oscillateAlpha 与 alphafade 组合的关键)
              if (p.oscAlpha) p.oscAlpha.base = p.alpha;
              break;
            }
            case 'sizechange': {
              const st = getVal(pr, 'starttime', 0), et = getVal(pr, 'endtime', 1);
              const sv = getVal(pr, 'startvalue', 1), ev = getVal(pr, 'endvalue', 0);
              const lifePos = p.life > 0 ? p.age / p.life : 1;
              const t01 = et > st ? Math.max(0, Math.min(1, (lifePos - st) / (et - st))) : 1;
              const tt = t01 * t01 * (3 - 2 * t01);
              p.size = (p._initSize ?? 20) * (sv + (ev - sv) * tt);
              if (p.oscSize) p.oscSize.base = p.size;
              break;
            }
            case 'alphachange': {
              const st = getVal(pr, 'starttime', 0), et = getVal(pr, 'endtime', 1);
              const sv = getVal(pr, 'startvalue', 1), ev = getVal(pr, 'endvalue', 0);
              const lifePos = p.life > 0 ? p.age / p.life : 1;
              const t01 = et > st ? Math.max(0, Math.min(1, (lifePos - st) / (et - st))) : 1;
              const tt = t01 * t01 * (3 - 2 * t01);
              p.alpha = (p._initAlpha ?? 1) * (sv + (ev - sv) * tt);
              if (p.oscAlpha) p.oscAlpha.base = p.alpha;
              break;
            }
            case 'turbulence': {
              const scale = getVal(pr, 'scale', 0.005);
              const speedMin = getVal(pr, 'speedmin', 500), speedMax = getVal(pr, 'speedmax', 1000);
              const mask = parseVec3(getVal(pr, 'mask'), [1, 1, 0]);
              const sp = speedMin + Math.random() * (speedMax - speedMin);
              const phase = Math.random() * Math.PI * 2;
              const nx = Math.sin(p.pos[0] * scale * 2 + phase + t * 0.1);
              const ny = Math.sin(p.pos[1] * scale * 2 + phase + t * 0.13);
              p.vel[0] += nx * sp * dt * mask[0];
              p.vel[1] += ny * sp * dt * mask[1];
              break;
            }
            case 'oscillatealpha': {
              const fMin = getVal(pr, 'frequencymin', 0), fMax = getVal(pr, 'frequencymax', 10);
              const sMin = getVal(pr, 'scalemin', 0), sMax = getVal(pr, 'scalemax', 1);
              if (!p.oscAlpha) {
                p.oscAlpha = { f: fMin + Math.random() * (fMax - fMin), ph: Math.random() * Math.PI * 2, base: p.alpha };
              }
              const cosVal = (Math.cos(p.oscAlpha.f * p.age + p.oscAlpha.ph) + 1) * 0.5;
              p.alpha = p.oscAlpha.base * (sMin + (sMax - sMin) * cosVal);
              break;
            }
            case 'oscillatesize': {
              const fMin = getVal(pr, 'frequencymin', 0), fMax = getVal(pr, 'frequencymax', 10);
              const sMin = getVal(pr, 'scalemin', 0.8), sMax = getVal(pr, 'scalemax', 1.2);
              if (!p.oscSize) {
                p.oscSize = { f: fMin + Math.random() * (fMax - fMin), ph: Math.random() * Math.PI * 2, base: p.size };
              }
              const cosVal = (Math.cos(p.oscSize.f * p.age + p.oscSize.ph) + 1) * 0.5;
              p.size = p.oscSize.base * (sMin + (sMax - sMin) * cosVal);
              break;
            }
            case 'oscillateposition': {
              const fMin = getVal(pr, 'frequencymin', 0), fMax = getVal(pr, 'frequencymax', 5);
              const sMin = getVal(pr, 'scalemin', 0), sMax = getVal(pr, 'scalemax', 10);
              const mask = parseVec3(getVal(pr, 'mask'), [1, 1, 0]);
              if (!p.oscPos) {
                p.oscPos = {
                  f: [0, 0, 0].map(() => fMin + Math.random() * (fMax - fMin)),
                  ph: [0, 0, 0].map(() => Math.random() * Math.PI * 2),
                  sc: [0, 0, 0].map(() => sMin + Math.random() * (sMax - sMin)),
                };
              }
              for (let a = 0; a < 2; a++) {
                const w = 2 * Math.PI * p.oscPos.f[a] / (2 * Math.PI);
                const move = -p.oscPos.sc[a] * w * Math.sin(w * p.age + p.oscPos.ph[a]) * dt;
                p.pos[a] += move * mask[a];
                if (p.scenePos) p.scenePos[a] += (a === 0 ? move : -move) * mask[a];
              }
              break;
            }
          }
        }
      }
    
,
    _drawParticles(sys) {
        const tex = sys.tex;
        const alphaMul = sys.alphaMul;
        const W = this.W, H = this.H;
        const canvas = this.canvas;
        const additive = sys.blending === 'additive';
        // 原生 genericparticle.vert: v_Color.a *= 0.5; v_Color.rgb = mix(color1, color2, v_Color.r)
        // (USERCOLORBLEND); 正交场景按投影缩放场景单位→像素
        const ps = sys.projScale;
        for (const p of sys.particles) {
          const lifePos = p.life > 0 ? p.age / p.life : 1;
          if (lifePos >= 1) continue;
          // 官方 genericparticle: v_Color = a_Color (alpha 来自 CPU 端 initializer),
          // 无固定 0.5 衰减 — 旧实现乘 0.5 使粒子普遍偏淡 (sf39g)。
          const a = Math.max(0, p.alpha) * alphaMul;
          if (a <= 0.002) continue;
          const sz = Math.max(0.5, p.size);
          // 正交场景: 用 scenePos (场景坐标, y 向上) 经投影缩放; 否则用画布坐标
          const x = ps ? (p.scenePos ? p.scenePos[0] * ps[0] : p.pos[0] * ps[0]) : p.pos[0];
          const y = ps ? (p.scenePos ? this.H - p.scenePos[1] * ps[1] : p.pos[1] * ps[1]) : p.pos[1];
          const halfX = (ps ? sz * ps[0] : sz) / 2;
          // 官方 genericparticle.vert: textureRatio = g_Texture0Resolution.y / x,
          // ComputeParticlePosition: up×(v-0.5)×textureRatio — 垂直尺寸乘纹理纵横比
          // (高/宽)。旧实现忽略 ratio → 非正方形粒子纹理 (流星 256×794/drop 32×128
          // 等 12 个) 被拉伸成正方形 (sf39g)。
          const ratio = tex && tex.width > 0 ? tex.height / tex.width : 1;
          const halfY = ((ps ? sz * ps[1] : sz) / 2) * ratio;
          if (tex) {
            // 官方 genericparticle.vert SPRITESHEET: currentFrame = floor(lifetime×numFrames),
            // 采样对应帧区域 (TEXS 帧元数据 x/y/width/height)。旧实现无 SPRITESHEET
            // → 精灵表粒子 (notes_sprite_sheet 41帧 等) 显示整张表 (sf39g)。
            let frameUV = null;
            if (tex.frames && tex.frames.count > 1 && tex.frames.items) {
              const fr = tex.frames;
              const lt = p.life > 0 ? p.age / p.life : 1;
              const idx = Math.min(fr.count - 1, Math.floor(lt * fr.count));
              const f = fr.items[idx];
              if (f) frameUV = { x: f.x, y: f.y, w: f.width || fr.count > 0 ? Math.floor(tex.width / fr.count) : tex.width, h: f.height || tex.height };
            }
            const tw = tex.width, th = tex.height;
            const colorR = sys.color1[0] + (sys.color2[0] - sys.color1[0]) * p.color[0];
            const colorG = sys.color1[1] + (sys.color2[1] - sys.color1[1]) * p.color[0];
            const colorB = sys.color1[2] + (sys.color2[2] - sys.color1[2]) * p.color[0];
            const x0 = Math.floor(x - halfX), y0 = Math.floor(y - halfY);
            const x1 = Math.ceil(x + halfX), y1 = Math.ceil(y + halfY);
            for (let py = y0; py <= y1; py++) {
              if (py < 0 || py >= H) continue;
              for (let px = x0; px <= x1; px++) {
                if (px < 0 || px >= W) continue;
                const nx = (px - x) / halfX, ny = (py - y) / halfY;
                if (nx < -1 || nx > 1 || ny < -1 || ny > 1) continue;
                const u = (nx + 1) / 2, v = (ny + 1) / 2;
                // SPRITESHEET: 帧内 UV (帧区域归一化)
                let tu = u, tv = v, si;
                if (frameUV) {
                  tu = frameUV.x / tw + u * (frameUV.w / tw);
                  tv = frameUV.y / th + v * (frameUV.h / th);
                }
                si = (Math.min(th - 1, Math.floor(tv * th)) * tw + Math.min(tw - 1, Math.floor(tu * tw))) * 4;
                // 官方 genericparticle.frag: color = v_Color × tex.r (red 通道即形状,
                // chromaticdot 的 red 是渐变软点 中心175→边缘0, alpha 全 255 无软边)。
                // 旧实现加 smoothstep(0.2,0.7) 二次削边 → 68% 像素被削成硬边 (sf39g)。
                // 直接采样 red (官方语义), 保留纹理自带渐变软边。
                const texR = tex.rgba[si] / 255;
                if (texR <= 0.004) continue;
                const sa = a * texR;
                const di = (py * W + px) * 4;
                const sr = colorR * sa * 255, sg = colorG * sa * 255, sb = colorB * sa * 255;
                if (additive) {
                  // additive: dst += src*srcA (clamp)
                  canvas.data[di] = Math.min(255, canvas.data[di] + sr);
                  canvas.data[di + 1] = Math.min(255, canvas.data[di + 1] + sg);
                  canvas.data[di + 2] = Math.min(255, canvas.data[di + 2] + sb);
                  canvas.data[di + 3] = 255;
                } else {
                  const dstA = canvas.data[di + 3] / 255;
                  const outA = sa + dstA * (1 - sa);
                  if (outA <= 0) continue;
                  canvas.data[di] = Math.round((sr + canvas.data[di] * dstA * (1 - sa)) / outA);
                  canvas.data[di + 1] = Math.round((sg + canvas.data[di + 1] * dstA * (1 - sa)) / outA);
                  canvas.data[di + 2] = Math.round((sb + canvas.data[di + 2] * dstA * (1 - sa)) / outA);
                  canvas.data[di + 3] = Math.round(outA * 255);
                }
              }
            }
          } else {
            // 无纹理: 圆形占位 (additive)
            const r = Math.max(1, (halfX + halfY) / 2);
            for (let py = Math.floor(y - r); py <= Math.ceil(y + r); py++) {
              for (let px = Math.floor(x - r); px <= Math.ceil(x + r); px++) {
                if (px < 0 || py < 0 || px >= W || py >= H) continue;
                if ((px - x) ** 2 + (py - y) ** 2 > r * r) continue;
                const di = (py * W + px) * 4;
                const sr = a * 255;
                if (additive) {
                  canvas.data[di] = Math.min(255, canvas.data[di] + sr);
                  canvas.data[di + 1] = Math.min(255, canvas.data[di + 1] + sr);
                  canvas.data[di + 2] = Math.min(255, canvas.data[di + 2] + sr);
                  canvas.data[di + 3] = 255;
                } else {
                  const dstA = canvas.data[di + 3] / 255;
                  const outA = a + dstA * (1 - a);
                  canvas.data[di] = Math.round((sr + canvas.data[di] * dstA * (1 - a)) / outA);
                  canvas.data[di + 1] = Math.round((sr + canvas.data[di + 1] * dstA * (1 - a)) / outA);
                  canvas.data[di + 2] = Math.round((sr + canvas.data[di + 2] * dstA * (1 - a)) / outA);
                  canvas.data[di + 3] = Math.round(outA * 255);
                }
              }
            }
          }
        }
      }
  });
}
