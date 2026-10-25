// WE 渲染引擎 — 相机 (lookAt/透视/正交 + camera paths + 视差)
import { parseVec3, parseVec2, getVal, mat4LookAt, mat4Perspective, mat4Ortho, mat4Mul, v3norm } from './math.js';

export function resolveCameraPose(cam, t, readJson) {
  const def = {
    eye: parseVec3(cam.eye, [0, 0, 1]),
    center: parseVec3(cam.center, [0, 0, 0]),
    up: parseVec3(cam.up, [0, 1, 0]),
    zoom: 1,
  };
  let paths = [];
  try {
    if (Array.isArray(cam.paths)) {
      for (const p of cam.paths) {
        if (typeof p === 'string') {
          const j = readJson(p);
          if (j && Array.isArray(j.paths)) paths = paths.concat(j.paths);
        } else if (p && Array.isArray(p.paths)) {
          paths = paths.concat(p.paths);
        } else if (p && Array.isArray(p.transforms)) {
          paths.push(p);
        }
      }
    }
  } catch { /* 解析失败 → 默认相机 */ }
  const eff = paths.map((p) => {
    const trs = (p.transforms || []).filter((x) => x && x.timestamp != null).sort((a, b) => a.timestamp - b.timestamp);
    const lastT = trs.length ? trs[trs.length - 1].timestamp : 0;
    return { p, trs, len: Math.max(lastT, p.duration != null ? p.duration : lastT) };
  });
  const total = eff.reduce((s, e) => s + e.len, 0);
  if (!eff.length || total <= 0) return def;
  let remain = ((t % total) + total) % total;
  let idx = 0;
  for (let i = 0; i < eff.length; i++) {
    if (remain < eff[i].len) { idx = i; break; }
    remain -= eff[i].len;
  }
  const cur = eff[idx];
  if (!cur.trs.length) return def;
  const pt = Math.min(remain, cur.trs[cur.trs.length - 1].timestamp);
  const pose = { ...def };
  let k = 0;
  while (k < cur.trs.length - 1 && pt > cur.trs[k + 1].timestamp) k++;
  const a = cur.trs[k], b = cur.trs[Math.min(k + 1, cur.trs.length - 1)];
  const span = b.timestamp - a.timestamp;
  const f = span > 0 ? Math.min(1, Math.max(0, (pt - a.timestamp) / span)) : 0;
  const lerp3 = (va, vb) => [va[0] + (vb[0] - va[0]) * f, va[1] + (vb[1] - va[1]) * f, va[2] + (vb[2] - va[2]) * f];
  pose.eye = lerp3(parseVec3(a.eye, def.eye), parseVec3(b.eye, def.eye));
  pose.center = lerp3(parseVec3(a.center, def.center), parseVec3(b.center, def.center));
  pose.up = v3norm(lerp3(parseVec3(a.up, def.up), parseVec3(b.up, def.up)));
  const za = a.zoom != null ? a.zoom : def.zoom, zb = b.zoom != null ? b.zoom : def.zoom;
  pose.zoom = za + (zb - za) * f;
  return pose;
}

export function computeParallaxDisplacement(cam, mouse) {
  const par = cam.parallax || {};
  const parEnabled = getVal(par, 'enabled', false) === true;
  if (!parEnabled) return [0, 0];
  const parAmount = getVal(par, 'amount', 1);
  const parInfluence = getVal(par, 'mouseinfluence', 0.1);
  const mx = mouse != null ? mouse[0] : 0.5;
  const my = mouse != null ? mouse[1] : 0.5;
  const centeredMouse = [mx - 0.5, my - 0.5];
  return [centeredMouse[0] * parAmount * parInfluence, centeredMouse[1] * parAmount * parInfluence];
}

export function setupCameraMatrices(scene, cam, gen, pose, W, H, fovOverride) {
  const view = mat4LookAt(pose.eye, pose.center, pose.up);
  const near = gen.nearz != null ? gen.nearz : 0.01;
  const far = gen.farz != null ? gen.farz : 10000;
  const ortho = gen.orthogonalprojection;
  let proj, isOrtho;
  if (ortho && ortho.width) {
    const hw = ortho.width / 2;
    const hh = (ortho.height || 1080) / 2;
    proj = mat4Ortho(-hw, hw, -hh, hh, near, far);
    isOrtho = true;
  } else {
    const fovDeg = fovOverride != null ? fovOverride : (gen.fov != null ? gen.fov : 50);
    const zoom = pose.zoom != null ? pose.zoom : (gen.zoom != null ? gen.zoom : 1);
    let fovy = fovDeg * Math.PI / 180;
    proj = mat4Perspective(fovy, W / H, near, far);
    if (zoom !== 1) {
      proj[0] *= zoom; proj[5] *= zoom;
    }
    isOrtho = false;
  }
  return { view, proj, vp: mat4Mul(proj, view), isOrtho };
}

import path from 'path';

// ── camera mixin (从 core.js 拆分, 逻辑零改动) ──
export function installCamera(proto) {
  Object.assign(proto, {
    _resolveCameraPose(cam, t) {
        const def = {
          eye: parseVec3(cam.eye, [0, 0, 1]),
          center: parseVec3(cam.center, [0, 0, 0]),
          up: parseVec3(cam.up, [0, 1, 0]),
          zoom: 1,
        };
        // 读取 paths: 每 path 的 transforms (timestamp 升序)
        let paths = [];
        try {
          if (Array.isArray(cam.paths)) {
            for (const p of cam.paths) {
              if (typeof p === 'string') {
                const j = this.pkg.readJson(p);
                if (j && Array.isArray(j.paths)) paths = paths.concat(j.paths);
              } else if (p && Array.isArray(p.paths)) {
                paths = paths.concat(p.paths);
              } else if (p && Array.isArray(p.transforms)) {
                paths.push(p);
              }
            }
          }
        } catch { /* paths 解析失败 → 用默认相机 */ }
        // 多 path 顺序循环: 每个 path 有效时长 = max(末帧 timestamp, duration)
        const eff = paths.map((p) => {
          const trs = (p.transforms || []).filter((x) => x && x.timestamp != null).sort((a, b) => a.timestamp - b.timestamp);
          const lastT = trs.length ? trs[trs.length - 1].timestamp : 0;
          return { p, trs, len: Math.max(lastT, p.duration != null ? p.duration : lastT) };
        });
        const total = eff.reduce((s, e) => s + e.len, 0);
        if (!eff.length || total <= 0) return def;
        // 全局时间定位 path
        let remain = ((t % total) + total) % total;
        let idx = 0;
        for (let i = 0; i < eff.length; i++) {
          if (remain < eff[i].len) { idx = i; break; }
          remain -= eff[i].len;
        }
        const cur = eff[idx];
        if (!cur.trs.length) return def;
        // path 内时间 → 关键帧插值 (clamp 到末帧)
        const pt = Math.min(remain, cur.trs[cur.trs.length - 1].timestamp);
        const pose = { ...def };
        let k = 0;
        while (k < cur.trs.length - 1 && pt > cur.trs[k + 1].timestamp) k++;
        const a = cur.trs[k], b = cur.trs[Math.min(k + 1, cur.trs.length - 1)];
        const span = b.timestamp - a.timestamp;
        const f = span > 0 ? Math.min(1, Math.max(0, (pt - a.timestamp) / span)) : 0;
        const lerp3 = (va, vb) => [va[0] + (vb[0] - va[0]) * f, va[1] + (vb[1] - va[1]) * f, va[2] + (vb[2] - va[2]) * f];
        pose.eye = lerp3(parseVec3(a.eye, def.eye), parseVec3(b.eye, def.eye));
        pose.center = lerp3(parseVec3(a.center, def.center), parseVec3(b.center, def.center));
        pose.up = v3norm(lerp3(parseVec3(a.up, def.up), parseVec3(b.up, def.up)));
        const za = a.zoom != null ? a.zoom : def.zoom, zb = b.zoom != null ? b.zoom : def.zoom;
        pose.zoom = za + (zb - za) * f;
        return pose;
      }
    
,
    _setupCamera() {
        const cam = this.scene.camera || {};
        const gen = this.scene.general || {};
        // camera paths: 多镜头顺序循环, 全局时间定位当前 path + 关键帧插值
        const camPose = this._resolveCameraPose(cam, this.time);
        let eye = camPose.eye;
        const center = camPose.center;
        const up = camPose.up;
        // 相机对象 (camera:"default"): 官方用其 origin 动画驱动运镜
        // (入场镜头 origin x:87→0, y:-229→478→0, z:2000→500 —
        //  入场"先上移再拉远": y 负 → 角色上移, y 正 → 下移 + zoom 拉远;
        //  origin 的 x/y 作 eye → 前景经 _viewShift **完整位移 (含 y)**
        //  背景不随相机移动; scene.camera.eye 为默认 (0,0,0) 时生效)
        // 从 this.objects (已烘焙) 取, 而非 scene.objects (原始动画定义)
        // 多相机对象选择: 取 origin 动画"值域跨度"最大的 (真运镜对象)。
        // 证据 (Mutsumi sf33): 两相机对象 — id 216 (无名, origin y 0→400→0
        // 摆动 + zoom 缩小 + scale 全 0 动画, 无入场特征) 与 id 1297271
        // ("入场镜头", origin x/y/z 大幅位移 + zoom 拉近)。取 216 时前景组件
        // 集体做其摆动 (用户反馈"组件的运动方式像另一个组件"); 1297271 的
        // 大幅位移+拉近才是官方入场运镜 (preview 相机固定无法反推, 数学上
        // 幅度显著者为真运镜对象)。
        const camObjs = (this.objects || []).filter((o) => o && o.camera === 'default');
        let camObj = camObjs[0];
        if (camObjs.length > 1) {
          // 动画定义读原始 scene.objects: 此时 origin 已被 _resolveAnimations
          // 烘焙为 {value}, .animation 已不在烘焙对象上 (this._animBackup 也按
          // 烘焙后对象索引) — 按 id 回查 scene.objects 的原始动画。
          const sceneObjs = this.scene.objects || [];
          const spanOf = (o) => {
            const so = sceneObjs.find((x) => x.id === o.id) || o;
            const ov = so.origin;
            if (!ov || !ov.animation) return 0;
            const span = (ch) => {
              const fr = (ov.animation[ch] || []).filter((f) => f && typeof f.frame === 'number' && f.value != null);
              if (!fr.length) return 0;
              const vs = fr.map((f) => Number(f.value));
              return Math.max(...vs) - Math.min(...vs);
            };
            return span('c0') + span('c1') + span('c2');
          };
          let best = camObjs[0], bestSpan = spanOf(camObjs[0]);
          for (const co of camObjs.slice(1)) {
            const s = spanOf(co);
            if (s > bestSpan) { best = co; bestSpan = s; }
          }
          camObj = best;
        }
        this._camObjDriven = false;
        if (camObj) {
          const co = parseVec3(getVal(camObj, 'origin', null), null);
          if (co && eye[0] === 0 && eye[1] === 0 && eye[2] === 0) {
            eye = co;
            // 相机对象驱动: 场景完整位移 (x+y), 区别于 scene.camera.eye 仅 x
            // (sf32 用户确认: scene.camera.eye 的 y 不产生前景平移;
            //  相机对象 origin 的 y 动画驱动"先上移再拉远"入场)
            this._camObjDriven = true;
          }
        }
        this.camEye = eye;
        this.camView = mat4LookAt(eye, center, up);
        const near = gen.nearz != null ? gen.nearz : 0.01;
        const far = gen.farz != null ? gen.farz : 10000;
        const ortho = gen.orthogonalprojection;
        // 相机对象 (camera:"default"): 官方用其 zoom/origin 动画驱动运镜
        // (zoom 2.15→1 / 1.58→1 + origin 三维动画; 入场镜头效果)
        //  zoom 在正交下 = 缩放正交范围 → 画面放大, 入场镜头效果)
        let camZoom = camPose.zoom != null ? camPose.zoom : (gen.zoom != null ? gen.zoom : 1);
        if (camObj) {
          const cz = getVal(camObj, 'zoom', camZoom);
          if (typeof cz === 'number' && cz > 0 && isFinite(cz)) camZoom = cz;
        }
        if (ortho && ortho.width) {
          const hw = ortho.width / 2 / camZoom;
          const hh = (ortho.height || 1080) / 2 / camZoom;
          // 正交: 场景坐标直接映射画布 (shimmering 等 2D 场景)
          this.camProj = mat4Ortho(-hw, hw, -hh, hh, near, far);
          this.camIsOrtho = true;
        } else {
          // opts.fov 覆盖 (诊断用); 默认取场景 fov, 缺失时 50
          const fovDeg = this.fovOverride != null ? this.fovOverride : (gen.fov != null ? gen.fov : 50);
          const zoom = camPose.zoom != null ? camPose.zoom : (gen.zoom != null ? gen.zoom : 1);
          let fovy = fovDeg * Math.PI / 180;
          this.camProj = mat4Perspective(fovy, this.W / this.H, near, far);
          if (zoom !== 1) { // zoom 缩放视野
            this.camProj[0] *= zoom; this.camProj[5] *= zoom;
          }
          this.camIsOrtho = false;
        }
        this.camVP = mat4Mul(this.camProj, this.camView); // Clip = Proj · View · World · p
        // 视差 (lwe-CScene.cpp:304): displacement = mix(disp, centeredMouse*amount*influence, delay)
        // 静态帧默认鼠标中心 (0.5,0.5) → 无位移; opts.mouse 可驱动 (跨平台能力)
        this.parallaxDisp = [0, 0];
        const par = cam.parallax || {};
        const parEnabled = getVal(par, 'enabled', false) === true;
        if (parEnabled) {
          const parAmount = getVal(par, 'amount', 1);
          const parInfluence = getVal(par, 'mouseinfluence', 0.1);
          const mx = this.optsMouse != null ? this.optsMouse[0] : 0.5;
          const my = this.optsMouse != null ? this.optsMouse[1] : 0.5;
          const centeredMouse = [mx - 0.5, my - 0.5];
          this.parallaxDisp = [centeredMouse[0] * parAmount * parInfluence, centeredMouse[1] * parAmount * parInfluence];
        }
        // 光照
        this.lights = (this.scene.objects || []).filter((o) => o.light).map((o) => ({
          type: String(o.light || 'point').toLowerCase(),
          origin: parseVec3(o.origin, [0, 0, 0]),
          color: parseVec3(o.color, [1, 1, 1]),
          intensity: o.intensity != null ? o.intensity : 1,
          radius: o.radius != null ? o.radius : 10,
        }));
        this.ambientColor = parseVec3(gen.ambientcolor, [0.3, 0.3, 0.3]);
        this.skylightColor = parseVec3(gen.skylightcolor, [0.3, 0.3, 0.3]);
        // 用户属性 (project.json general.properties 默认值, 供 material usershadervalues
        // 映射 + 脚本 scriptProperties)。构造时已读 (含外部 project.json, _readUserProps),
        // 这里不再覆盖 — 旧实现每帧重置为空 → 脚本属性默认值丢失。
        if (!this.userProps) this.userProps = {};
      }
    
      // 已实现 CPU 移植的 shader 集合 (model/image 材质分发用)
,
    _viewShift(o, size, ps) {
        const ortho = this.scene.general && this.scene.general.orthogonalprojection;
        const w = ortho && ortho.width ? ortho.width : this.W;
        const h = ortho && ortho.height ? ortho.height : this.H;
        const isBg = size && size[0] >= w - 1 && size[1] >= h - 1;
        if (isBg || !this.camEye) return [0, 0];
        // sf32/sf33: 场景位移来源区分 —
        //  scene.camera.eye (静态): 仅 x 平移 (-eye.x×ps), y 不产生
        //   前景平移 (用户与官方对比确认)。
        //  相机对象 camera:"default" (动画): origin 完整位移 (x+y),
        //   入场"先上移再拉远" (origin y -229→478→0 → 角色上移再下移)。
        if (this._camObjDriven) return [(-this.camEye[0]) * (ps ? ps[0] : 1), (this.camEye[1]) * (ps ? ps[1] : 1)];
        return [(-this.camEye[0]) * (ps ? ps[0] : 1), 0];
      }
    
      // ── Image 对象渲染 ────────────────────────────────────────────────
  });
}
