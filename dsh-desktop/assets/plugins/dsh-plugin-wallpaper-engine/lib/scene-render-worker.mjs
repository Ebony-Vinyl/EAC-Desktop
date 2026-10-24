// 场景帧渲染 worker: 把 SceneRenderer 的同步 CPU 渲染移到 worker 线程,
// 避免阻塞 DSH 主进程事件循环 (大型壁纸渲染数秒~数十秒).
// 支持单帧 (time) 与多帧动画 (times 数组 → APNG).
import { parentPort, workerData } from 'node:worker_threads';
import { SceneRenderer, encodePng } from './scene-renderer.js';
import { encodeApng, encodeIdat } from './apng-encode.js';

const { src, width, height, time, times, weAssetsDir, frameDelayMs, videoFrames } = workerData;

try {
  // 单帧模式 (静态帧缓存)
  if (!times || !times.length) {
    const renderer = new SceneRenderer(src, { width, height, time, weAssetsDir, videoFrames, log: () => {} });
    const canvas = renderer.render();
    // 空帧门禁统计: 与 clearcolor 差异 < 0.05% 视为空白
    const cc = renderer.scene && renderer.scene.general && renderer.scene.general.clearcolor;
    const ccv = typeof cc === 'string' && cc.trim() ? cc.trim().split(/\s+/).map(Number) : [0, 0, 0];
    const cr0 = (ccv[0] || 0) * 255, cg0 = (ccv[1] || 0) * 255, cb0 = (ccv[2] || 0) * 255;
    const step = 8;
    let diff = 0, checked = 0;
    for (let y = 0; y < canvas.h; y += step) {
      for (let x = 0; x < canvas.w; x += step) {
        const i = (y * canvas.w + x) * 4;
        checked++;
        if (Math.abs(canvas.data[i] - cr0) > 24 || Math.abs(canvas.data[i + 1] - cg0) > 24 || Math.abs(canvas.data[i + 2] - cb0) > 24) diff++;
      }
    }
    const png = encodePng(canvas.w, canvas.h, canvas.data);
    parentPort.postMessage({ ok: true, png, diff, checked }, [png.buffer]);
  } else {
    // 多帧模式: 复用单个 SceneRenderer (每帧只换 time), 避免每帧重读 pkg/重解码纹理
    // (大型 pkg 如 336MB 场景, 逐帧重建 = 每帧整包读取 + 全部纹理解码)
    // 传 times → staticFrame=false → 动画启用效果降采样加速 (sf38); 静态帧不降采样
    const renderer = new SceneRenderer(src, { width, height, time: times[0], times, weAssetsDir, videoFrames, log: () => {} });
    const frames = [];
    const total = times.length;
    for (let i = 0; i < total; i++) {
      renderer.setTime(times[i]);
      const canvas = renderer.render();
      // 立即压缩 → 释放原始帧 (4K 多帧峰值: 全帧 rgba 可达数 GB; 压缩后仅存 IDAT)
      frames.push({ idat: encodeIdat(width, height, canvas.data), delayMs: frameDelayMs || 100 });
      // 逐帧进度上报 (宿主 scene-anim 渲染进度条)
      parentPort.postMessage({ progress: true, done: i + 1, total });
    }
    const apng = encodeApng(width, height, frames);
    parentPort.postMessage({ ok: true, apng }, [apng.buffer]);
  }
} catch (e) {
  parentPort.postMessage({ ok: false, error: String(e && e.message ? e.message : e) });
}
