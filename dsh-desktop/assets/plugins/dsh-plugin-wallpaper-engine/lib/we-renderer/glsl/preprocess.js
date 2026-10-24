// WE GLSL 预处理: #include 展开 + combo 宏注入 + uniform material 映射解析
import preprocess from '@shaderfrog/glsl-parser/preprocessor/index.js';

// 解析 shader 源码里的元注释:
//   // [COMBO] {"material":"...","combo":"KERNEL","default":0,...}  → combos 默认值
//   uniform <type> <name>; // {"material":"xxx",...}              → material→uniform 映射
export function parseMeta(source) {
  const combos = {}; // combo 名 → 默认值 (string)
  const uniforms = {}; // uniform 名 → { material, type }
  const comboRe = /\/\/\s*\[COMBO\]\s*(\{[\s\S]*?\})/g;
  let m;
  while ((m = comboRe.exec(source))) {
    try {
      const meta = JSON.parse(m[1]);
      if (meta.combo && meta.default !== undefined) combos[meta.combo] = String(meta.default);
    } catch {}
  }
  const unifRe = /uniform\s+([\w]+)\s+(\w+)\s*;\s*\/\/\s*(\{[\s\S]*?\})/g;
  while ((m = unifRe.exec(source))) {
    try {
      const meta = JSON.parse(m[3]);
      if (meta.material) uniforms[m[2]] = { material: meta.material, type: m[1] };
    } catch {}
  }
  // 无注释的 uniform 也收集 (引擎注入类, material=null)
  const unifPlain = /uniform\s+([\w]+)\s+(\w+)\s*;/g;
  while ((m = unifPlain.exec(source))) {
    if (!uniforms[m[2]]) uniforms[m[2]] = { material: null, type: m[1] };
  }
  return { combos, uniforms };
}

// include 展开: resolveInclude(rel) → 源码字符串
export function expandIncludes(source, resolveInclude, seen = new Set()) {
  const re = /#include\s+"([^"]+)"/g;
  let out = source;
  let m;
  while ((m = re.exec(source))) {
    const inc = m[1];
    if (seen.has(inc)) { out = out.replace(m[0], ''); continue; }
    seen.add(inc);
    let src = '';
    try { src = resolveInclude(inc); } catch {}
    if (!src) { out = out.replace(m[0], ''); continue; }
    src = expandIncludes(src, resolveInclude, seen);
    out = out.replace(m[0], '\n' + src + '\n');
  }
  return out;
}

// 完整预处理: include 展开 → combo defines 注入 → shaderfrog preprocess
export function preprocessShader(source, { defines = {}, resolveInclude = null } = {}) {
  let src = source;
  if (resolveInclude) src = expandIncludes(src, resolveInclude);
  // 若 combo 无默认且未注入 → 显式补 0 避免 #if 未定义报错
  const meta = parseMeta(src);
  const allDefines = {};
  for (const [k, v] of Object.entries(meta.combos)) {
    if (defines[k] === undefined) allDefines[k] = v;
  }
  Object.assign(allDefines, defines);
  return preprocess(src, { defines: allDefines });
}
