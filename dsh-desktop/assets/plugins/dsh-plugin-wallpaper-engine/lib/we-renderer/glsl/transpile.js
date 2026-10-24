// WE GLSL AST → JS 转译器 (基于 @shaderfrog/glsl-parser AST)
// 输出: 一段 JS 代码字符串, 由 new Function('__u','__v','__a','__rt', code + '; return exports;') 装配。
//   __u: uniforms 对象; __v: varyings 对象; __a: attributes 对象; __rt: runtime 对象
// 约定:
//   - vecN 用 JS 数组 (Float32Array 兼容), 标量用 number
//   - 内置/引擎函数调用 → __rt.<name>(...)
//   - fragment: 输出 gl_FragColor (Float32Array, 逐分量写); vertex: varying 写回 __v

const VEC_SIZE = { vec2: 2, vec3: 3, vec4: 4, ivec2: 2, ivec3: 3, ivec4: 4, bvec2: 2, bvec3: 3, bvec4: 4 };
const MAT_SIZE = { mat2: 4, mat3: 9, mat4: 16 };
const SCALARS = new Set(['float', 'int', 'uint', 'bool', 'double']);
const BUILTIN = new Set([
  'mix', 'step', 'smoothstep', 'clamp', 'min', 'max', 'abs', 'floor', 'ceil',
  'fract', 'mod', 'pow', 'exp', 'log', 'sqrt', 'inversesqrt', 'sign', 'sin',
  'cos', 'tan', 'asin', 'acos', 'atan', 'radians', 'degrees', 'dot', 'cross',
  'length', 'distance', 'normalize', 'isnan', 'isinf', 'saturate', 'mul',
  'texSample2D', 'texture2D', 'texture2DLod', 'CAST2', 'CAST3', 'CAST4', 'CAST3X3',
  'floatBitsToInt', 'intBitsToFloat',
]);
const CONSTS = new Set(['M_PI', 'M_PI_HALF', 'M_PI_2', 'SQRT_2', 'SQRT_3']);
const SWZ = { x: 0, y: 1, z: 2, w: 3, r: 0, g: 1, b: 2, a: 3, s: 0, t: 1, p: 2, q: 3 };

export function transpile(ast, stage) {
  return new Transpiler(ast, stage).generate();
}
export { Transpiler };

class Transpiler {
  constructor(ast, stage) {
    this.ast = ast;
    this.stage = stage; // 'fragment' | 'vertex'
    this.globals = {}; // name -> { type, kind }
    this.functions = {}; // name -> { returnType, params: [{name, type}] }
    this.tmp = 0;
    this.collect();
  }

  typeOf(spec) {
    // fully_specified_type → type_specifier → keyword(token), 任意嵌套解包
    if (!spec) return null;
    let s = spec;
    while (s && typeof s === 'object' && !s.token && s.specifier) s = s.specifier;
    return s && s.token ? s.token : null;
  }

  collect() {
    for (const node of this.ast.program || []) {
      if (node.type === 'declaration_statement') {
        const dl = node.declaration;
        if (!dl || dl.type !== 'declarator_list') continue;
        const type = this.typeOf(dl.specified_type);
        const quals = (dl.specified_type.qualifiers || []).map((q) => q.token);
        const kind = quals.includes('uniform') ? 'uniform'
          : quals.includes('varying') ? 'varying'
          : quals.includes('attribute') ? 'attribute'
          : quals.includes('const') ? 'global'
          : 'global';
        for (const d of dl.declarations || []) {
          if (d.type !== 'declaration') continue;
          this.globals[d.identifier.identifier] = { type, kind };
        }
      } else if (node.type === 'function') {
        const proto = node.prototype;
        const h = proto.header;
        const name = h.name.identifier;
        const returnType = this.typeOf(h.returnType);
        const params = (proto.parameters || []).map((p) => ({
          name: p.identifier.identifier,
          type: this.typeOf(p.specifier),
          inout: (p.qualifier || []).some((q) => q.token === 'inout' || q.token === 'out'),
        }));
        this.functions[name] = { returnType, params };
      }
    }
  }

  // ── 局部类型收集 (函数体 DFS) ──
  collectLocals(body) {
    const locals = {};
    const visit = (n) => {
      if (!n || typeof n !== 'object') return;
      if (n.type === 'declaration_statement') {
        const dl = n.declaration;
        if (dl && dl.type === 'declarator_list') {
          const type = this.typeOf(dl.specified_type);
          for (const d of dl.declarations || []) {
            if (d.type === 'declaration') locals[d.identifier.identifier] = type;
          }
        }
      }
      for (const k of Object.keys(n)) {
        const v = n[k];
        if (Array.isArray(v)) for (const c of v) visit(c);
        else if (v && typeof v === 'object') visit(v);
      }
    };
    visit(body);
    return locals;
  }

  fresh() { return '__t' + this.tmp++; }

  // 类型查询
  typeOfName(name, locals) {
    if (locals && locals[name]) return locals[name];
    if (this.globals[name]) return this.globals[name].type;
    return null;
  }
  kindOfName(name) {
    return this.globals[name] ? this.globals[name].kind : null;
  }

  // ── 主生成 ──
  generate() {
    const lines = [];
    for (const [name, info] of Object.entries(this.globals)) {
      if (info.kind === 'uniform') {
        lines.push(`var ${name} = __u.${name};`);
      } else if (info.kind === 'varying') {
        // varying 动态读 __v (每像素更新), 不声明快照
      } else if (info.kind === 'attribute') {
        lines.push(`var ${name} = __a.${name};`);
      } else {
        // 全局变量 (初始化器在下方 AST 扫描时补充)
        lines.push(`var ${name} = ${this.defaultValue(info.type)};`);
      }
    }
    // 全局变量声明带初始化器 (非 uniform/varying/attribute)
    for (const node of this.ast.program || []) {
      if (node.type !== 'declaration_statement') continue;
      const dl = node.declaration;
      if (!dl || dl.type !== 'declarator_list') continue;
      const quals = (dl.specified_type.qualifiers || []).map((q) => q.token);
      if (quals.includes('uniform') || quals.includes('varying') || quals.includes('attribute')) continue;
      const type = this.typeOf(dl.specified_type);
      for (const d of dl.declarations || []) {
        if (d.type !== 'declaration') continue;
        const nm = d.identifier.identifier;
        if (d.initializer) {
          const e = this.expr(d.initializer, { locals: {}, fnName: null });
          const isVec = VEC_SIZE[type] !== undefined || MAT_SIZE[type] !== undefined;
          lines.push(`var ${nm} = ${isVec ? e.code : e.code};`);
        }
      }
    }
    for (const node of this.ast.program || []) {
      if (node.type === 'function') {
        lines.push(this.functionCode(node));
      }
    }
    if (this.stage === 'fragment') {
      lines.push('var gl_FragColor = new Float32Array(4);');
      lines.push('return { main: main, gl_FragColor: gl_FragColor };');
    } else {
      lines.push('return { main: main };');
    }
    return lines.join('\n');
  }

  defaultValue(type) {
    if (SCALARS.has(type)) return '0';
    const n = VEC_SIZE[type] || MAT_SIZE[type];
    return n ? `new Float32Array(${n})` : 'null';
  }

  // ── 函数转译 ──
  functionCode(node) {
    const proto = node.prototype;
    const name = proto.header.name.identifier;
    const params = proto.parameters || [];
    const body = node.body;
    const locals = this.collectLocals(body);
    for (const p of params) locals[p.identifier.identifier] = this.typeOf(p.specifier);
    // vec/mat 参数按值复制 (GLSL in 语义)
    const copies = params
      .filter((p) => {
        const t = this.typeOf(p.specifier);
        return (VEC_SIZE[t] || MAT_SIZE[t]) && !(p.qualifier || []).some((q) => q.token === 'inout' || q.token === 'out');
      })
      .map((p) => `  ${p.identifier.identifier} = ${p.identifier.identifier}.slice(0);`)
      .join('\n');
    const bodyCode = this.stmt(body, { locals, fnName: name });
    const paramNames = params.map((p) => p.identifier.identifier).join(', ');
    return `function ${name}(${paramNames}) {\n${copies}${bodyCode}\n}`;
  }

  // ── 语句转译 ──
  stmt(node, ctx) {
    if (!node) return '';
    switch (node.type) {
      case 'compound_statement':
        return (node.statements || []).map((s) => this.stmt(s, ctx)).filter((s) => s !== '').join('\n');
      case 'declaration_statement': {
        const dl = node.declaration;
        const type = this.typeOf(dl.specified_type);
        const out = [];
        for (const d of dl.declarations || []) {
          if (d.type !== 'declaration') continue;
          const nm = d.identifier.identifier;
          if (this.stage === 'vertex' && this.kindOfName(nm) === 'varying') {
            // vert 里对 varying 的声明一般不存在 (varying 在全局声明); 若局部声明同名, 忽略
            continue;
          }
          const isVec = VEC_SIZE[type] !== undefined || MAT_SIZE[type] !== undefined;
          if (d.initializer) {
            const e = this.expr(d.initializer, ctx);
            if (isVec && this.exprTypeIsVec(e.type)) {
              out.push(`var ${nm} = ${e.code};`);
            } else if (isVec) {
              // 标量初始化 vec (少见) → 广播
              out.push(`var ${nm} = ${this.broadcast(e.code, type)};`);
            } else {
              out.push(`var ${nm} = ${e.code};`);
            }
          } else {
            out.push(`var ${nm} = ${this.defaultValue(type)};`);
          }
        }
        return out.join('\n');
      }
      case 'expression_statement':
        return this.exprStmt(node.expression, ctx);
      case 'if_statement': {
        const cond = this.expr(node.condition, ctx);
        const thenB = this.stmt(node.body, ctx);
        let out = `if (${cond.code}) {\n${thenB}\n}`;
        if (node.else) {
          // else 是数组: [elseToken, bodyNode] — bodyNode 可能是 if_statement (else-if 链) 或 compound
          const elseArr = Array.isArray(node.else) ? node.else : [node.else];
          const elseBody = elseArr.filter((n) => n && n.type !== 'keyword' && n.type !== 'literal');
          if (elseBody.length > 0) {
            out += ` else {\n${elseBody.map((s) => this.stmt(s, ctx)).join('\n')}\n}`;
          }
        }
        return out;
      }
      case 'for_statement': {
        const init = node.init ? this.stmt(node.init, ctx) : '';
        const cond = node.condition ? this.expr(node.condition, ctx).code : 'true';
        const upd = node.operation ? this.exprStmt(node.operation, ctx, true) : '';
        return `for (${init.trim()}; ${cond}; ${upd}) {\n${this.stmt(node.body, ctx)}\n}`;
      }
      case 'while_statement': {
        const cond = this.expr(node.condition, ctx);
        return `while (${cond.code}) {\n${this.stmt(node.body, ctx)}\n}`;
      }
      case 'return_statement':
        if (!node.expression) return 'return;';
        return `return ${this.expr(node.expression, ctx).code};`;
      case 'break_statement':
        return 'break;';
      case 'continue_statement':
        return 'continue;';
      case 'discard_statement':
        return '/* discard */';
      case 'switch_statement':
        // 罕见; 退化为 if 链 (不完整)
        return '/* switch unsupported */';
      default:
        return '/* stmt ' + node.type + ' */';
    }
  }

  // 表达式语句 (赋值等)
  exprStmt(node, ctx, asExpr = false) {
    if (!node) return '';
    if (node.type === 'assignment') {
      return this.assignStmt(node, ctx);
    }
    const e = this.expr(node, ctx);
    return `${e.code};`;
  }

  assignStmt(node, ctx) {
    const left = node.left;
    const op = node.operator.literal; // '=', '*=', 等
    // 左值 = 多分量 swizzle?
    const swz = this.swizzleOf(left);
    if (swz && swz.length > 1) {
      // var __t = rhs; base[i0] op= __t[0]; ... (op 可为 += *= 等复合赋值)
      const base = this.lvalueBase(left, ctx);
      const rhs = this.expr(node.right, ctx);
      const tmp = this.fresh();
      const lines = [`var ${tmp} = ${rhs.code};`];
      const jsOp = { '*=': '*=', '+=': '+=', '-=': '-=', '/=': '/=', '=': '=' }[op] || '=';
      for (let i = 0; i < swz.length; i++) {
        lines.push(`${base}[${swz[i]}] ${jsOp} ${tmp}[${i}];`);
      }
      return lines.join('\n');
    }
    const lv = this.lvalue(left, ctx);
    // gl_FragColor 赋值 → 写内容 (模块 Float32Array 不重绑)
    if (this.stage === 'fragment' && left.type === 'identifier' && left.identifier === 'gl_FragColor') {
      const rhs = this.expr(node.right, ctx);
      return `gl_FragColor.set(${rhs.code});`;
    }
    if (op === '=') {
      const rhs = this.expr(node.right, ctx);
      return `${lv} = ${rhs.code};`;
    }
    // 复合赋值 *= -= += /=  (左值=vec → 辅助; 标量 → 直接)
    const lt = this.typeOfNode(left, ctx);
    const rhs = this.expr(node.right, ctx);
    if (VEC_SIZE[lt] || MAT_SIZE[lt]) {
      const fn = { '*=': '_vmulEq', '+=': '_vaddEq', '-=': '_vsubEq', '/=': '_vdivEq' }[op];
      return `${lv} = __rt.${fn}(${lv}, ${rhs.code});`;
    }
    const jsOp = { '*=': '*=', '+=': '+=', '-=': '-=', '/=': '/=', '%=': '%=' }[op] || '=';
    return `${lv} ${jsOp} ${rhs.code};`;
  }

  // 左值
  lvalue(node, ctx) {
    if (!node) return 'null';
    if (node.type === 'identifier') {
      // vert 的 varying 输出 → __v.name
      if (this.stage === 'vertex' && this.kindOfName(node.identifier) === 'varying') {
        return `__v.${node.identifier}`;
      }
      return node.identifier;
    }
    if (node.type === 'postfix') {
      const base = this.lvalueBase(node, ctx);
      const pf = node.postfix;
      if (pf.type === 'field_selection') {
        const sel = pf.selection.identifier;
        if (sel.length === 1) return `${base}[${SWZ[sel[0]]}]`;
        // 多分量 swizzle 已在 assignStmt 处理 (返回 base)
      }
      if (pf.type === 'index') {
        const idx = this.expr(pf.index, ctx);
        return `${base}[${idx.code}]`;
      }
    }
    return this.expr(node, ctx).code;
  }
  lvalueBase(node, ctx) {
    if (node.type === 'postfix') return this.lvalueBase(node.expression, ctx);
    if (node.type === 'identifier') {
      if (this.stage === 'vertex' && this.kindOfName(node.identifier) === 'varying') return `__v.${node.identifier}`;
      return node.identifier;
    }
    return this.expr(node, ctx).code;
  }
  // 多分量 swizzle 检测
  swizzleOf(node) {
    if (!node || node.type !== 'postfix') return null;
    const pf = node.postfix;
    if (pf && pf.type === 'field_selection') {
      const sel = pf.selection.identifier;
      if (sel.length > 1 && sel.split('').every((c) => SWZ[c] !== undefined)) {
        return sel.split('').map((c) => SWZ[c]);
      }
    }
    return null;
  }

  // ── 表达式转译 (返回 {code, type, simple}; simple=无副作用可安全内联) ──
  expr(node, ctx) {
    if (!node) return { code: '0', type: 'float', simple: true };
    switch (node.type) {
      case 'identifier':
        return {
          code: this.kindOfName(node.identifier) === 'varying' ? `__v.${node.identifier}` : node.identifier,
          type: this.typeOfName(node.identifier, ctx.locals),
          simple: true,
        };
      case 'int_constant':
        return { code: node.token, type: 'int', simple: true };
      case 'float_constant':
        return { code: node.token, type: 'float', simple: true };
      case 'bool_constant':
        return { code: node.token, type: 'bool', simple: true };
      case 'literal': {
        // 数字 token (罕见)
        if (/^[0-9.eE+-]+$/.test(node.literal)) return { code: node.literal, type: /\./.test(node.literal) ? 'float' : 'int', simple: true };
        return { code: '0', type: 'float', simple: true };
      }
      case 'binary':
        return this.binaryExpr(node, ctx);
      case 'unary': {
        const inner = this.expr(node.expression, ctx);
        if (node.operator.literal === '-') {
          if (VEC_SIZE[inner.type]) {
            if (inner.simple) {
              const n = VEC_SIZE[inner.type];
              const parts = [];
              for (let i = 0; i < n; i++) parts.push(`(-${inner.code}[${i}])`);
              return { code: `[${parts.join(', ')}]`, type: inner.type, simple: true };
            }
            return { code: `__rt._vneg(${inner.code})`, type: inner.type, simple: false };
          }
          return { code: `(-${inner.code})`, type: inner.type, simple: true };
        }
        if (node.operator.literal === '!') return { code: `(!${inner.code})`, type: 'bool', simple: true };
        return { code: `(${node.operator.literal}${inner.code})`, type: inner.type, simple: inner.simple };
      }
      case 'ternary': {
        const c = this.expr(node.expression, ctx);
        const a = this.expr(node.left, ctx);
        const b = this.expr(node.right, ctx);
        return { code: `(${c.code} ? ${a.code} : ${b.code})`, type: a.type || b.type, simple: false };
      }
      case 'group':
        return this.expr(node.expression, ctx);
      case 'function_call':
        return this.callExpr(node, ctx);
      case 'postfix':
        return this.postfixExpr(node, ctx);
      case 'index': {
        // AST index 节点: expression + index? (罕见结构)
        const base = this.expr(node.expression, ctx);
        const idx = this.expr(node.index, ctx);
        return { code: `${base.code}[${idx.code}]`, type: 'float', simple: true };
      }
      default:
        return { code: '0', type: 'float' };
    }
  }

  binaryExpr(node, ctx) {
    const l = this.expr(node.left, ctx);
    const r = this.expr(node.right, ctx);
    const op = node.operator.literal;
    const lvec = VEC_SIZE[l.type];
    const rvec = VEC_SIZE[r.type];
    const lmat = MAT_SIZE[l.type];
    const rmat = MAT_SIZE[r.type];
    if (op === '+' || op === '-' || op === '*' || op === '/') {
      if (lvec || rvec) {
        // vec 运算: 操作数简单 → 内联数组字面量 (避免 __rt 调用 + 分配)
        if (l.simple && r.simple) {
          const n = lvec || rvec;
          const parts = [];
          for (let i = 0; i < n; i++) {
            const li = lvec ? `${l.code}[${i}]` : l.code;
            const ri = rvec ? `${r.code}[${i}]` : r.code;
            parts.push(`(${li} ${op} ${ri})`);
          }
          return { code: `[${parts.join(', ')}]`, type: lvec ? l.type : r.type, simple: true };
        }
        const fn = { '+': '_vadd', '-': '_vsub', '*': '_vmul', '/': '_vdiv' }[op];
        return { code: `__rt.${fn}(${l.code}, ${r.code})`, type: lvec ? l.type : r.type, simple: false };
      }
      if (lmat || rmat) {
        // mat 运算 (矩阵语义特殊, 保持辅助)
        const fn = { '+': '_vadd', '-': '_vsub', '*': '_vmul', '/': '_vdiv' }[op];
        return { code: `__rt.${fn}(${l.code}, ${r.code})`, type: lmat ? l.type : r.type, simple: false };
      }
      return { code: `(${l.code} ${op} ${r.code})`, type: 'float', simple: true };
    }
    if (op === '<' || op === '>' || op === '<=' || op === '>=') {
      return { code: `(${l.code} ${op} ${r.code})`, type: 'bool', simple: true };
    }
    if (op === '==' || op === '!=') {
      return { code: `(${l.code} ${op === '==' ? '===' : '!=='} ${r.code})`, type: 'bool', simple: true };
    }
    if (op === '&&' || op === '||') {
      return { code: `(${l.code} ${op} ${r.code})`, type: 'bool', simple: true };
    }
    return { code: `(${l.code} ${op} ${r.code})`, type: 'float', simple: true };
  }

  callExpr(node, ctx) {
    // callee: node.identifier — identifier 节点 (函数名) 或 type_specifier 节点 (vec2/3/4/mat 构造)
    let name = null;
    if (node.identifier) {
      if (node.identifier.type === 'identifier') {
        name = node.identifier.identifier;
      } else if (node.identifier.type === 'type_specifier') {
        // specifier 可能是 keyword {token} 或 type_name {identifier} (如 CAST2)
        const sp = node.identifier.specifier;
        if (sp) {
          if (sp.token) name = sp.token;
          else if (sp.identifier) name = sp.identifier;
          else if (sp.specifier) name = sp.specifier.token || (sp.specifier.specifier && sp.specifier.specifier.token);
        }
      }
    }
    if (name) {
      const args = (node.args || []).filter((a) => a.type !== 'literal');
      if (VEC_SIZE[name]) {
        return { code: this.constructVec(VEC_SIZE[name], args, ctx), type: name, simple: true };
      }
      if (MAT_SIZE[name]) {
        return { code: this.constructMat(name, args, ctx), type: name, simple: true };
      }
      if (name === 'float') return { code: `(+(${args.map((a) => this.expr(a, ctx).code).join(', ')}))`, type: 'float', simple: true };
      if (name === 'int') return { code: `(Math.trunc(${args.map((a) => this.expr(a, ctx).code).join(', ')}))`, type: 'int', simple: true };
      if (name === 'bool') return { code: `(!!(${args.map((a) => this.expr(a, ctx).code).join(', ')}))`, type: 'bool', simple: true };
      // mix: a/b vec + t 标量/vec → 内联 (避免 __rt.mix 分配); 否则回退
      if (name === 'mix' && args.length === 3) {
        const a = this.expr(args[0], ctx);
        const b = this.expr(args[1], ctx);
        const t = this.expr(args[2], ctx);
        const n = VEC_SIZE[a.type];
        if (n && VEC_SIZE[b.type] && a.simple && b.simple && t.simple) {
          const tVec = VEC_SIZE[t.type];
          if (tVec || t.type === 'float') {
            const parts = [];
            for (let i = 0; i < n; i++) {
              const ti = tVec ? `${t.code}[${i}]` : t.code;
              parts.push(`(${a.code}[${i}] + (${b.code}[${i}] - ${a.code}[${i}]) * ${ti})`);
            }
            return { code: `[${parts.join(', ')}]`, type: a.type, simple: true };
          }
        }
      }
      if (BUILTIN.has(name) || CONSTS.has(name)) {
        const a = args.map((a) => this.expr(a, ctx).code).join(', ');
        return { code: `__rt.${name}(${a})`, type: this.builtinReturnType(name, args, ctx), simple: false };
      }
      // 自定义函数
      const fn = this.functions[name];
      const a = args.map((a) => this.expr(a, ctx).code).join(', ');
      return { code: `${name}(${a})`, type: fn ? fn.returnType : 'float', simple: false };
    }
    // 其它 callee (罕见)
    return { code: '0', type: 'float', simple: true };
  }

  builtinReturnType(name, args, ctx) {
    switch (name) {
      case 'dot': case 'length': case 'distance': return 'float';
      case 'mix': case 'step': case 'smoothstep': case 'clamp': case 'min': case 'max':
        return args.length ? this.expr(args[0], ctx).type : 'float';
      case 'normalize': return args.length ? this.expr(args[0], ctx).type : 'vec3';
      case 'cross': return 'vec3';
      case 'mul': return args.length ? this.expr(args[0], ctx).type : 'vec4';
      case 'texSample2D': case 'texture2D': return 'vec4';
      case 'CAST2': return 'vec2';
      case 'CAST3': return 'vec3';
      case 'CAST4': return 'vec4';
      case 'CAST3X3': return 'mat3';
      case 'saturate': case 'abs': case 'floor': case 'ceil': case 'fract': case 'mod':
      case 'pow': case 'exp': case 'log': case 'sqrt': case 'inversesqrt': case 'sign':
      case 'sin': case 'cos': case 'tan': case 'asin': case 'acos': case 'atan':
      case 'radians': case 'degrees':
        return args.length ? this.expr(args[0], ctx).type : 'float';
      default: return 'float';
    }
  }

  // vec 构造: GLSL 规则 — 单标量广播; 多参数按分量拼接/截取
  constructVec(size, args, ctx) {
    if (args.length === 0) return `new Float32Array(${size})`;
    const exprs = args.map((a) => this.expr(a, ctx));
    // 单参数
    if (args.length === 1) {
      const e = exprs[0];
      if (SCALARS.has(e.type)) {
        return this.broadcast(e.code, size);
      }
      // vec 参数 → 截取/填充
      const parts = [];
      for (let i = 0; i < size; i++) parts.push(`${e.code}[${i}]`);
      return `[${parts.join(', ')}]`;
    }
    // 多参数: 拼接
    const parts = [];
    for (const e of exprs) {
      if (SCALARS.has(e.type)) parts.push(e.code);
      else {
        const n = VEC_SIZE[e.type] || 1;
        for (let i = 0; i < n; i++) parts.push(`${e.code}[${i}]`);
      }
    }
    // 截取到 size
    return `[${parts.slice(0, size).join(', ')}]`;
  }

  broadcast(code, sizeOrType) {
    const n = typeof sizeOrType === 'number' ? sizeOrType : VEC_SIZE[sizeOrType];
    return `[${Array(n).fill(code).join(', ')}]`;
  }

  constructMat(type, args, ctx) {
    // 简化: 对角线广播 (单标量) 或前 N 分量
    if (args.length === 1) {
      const e = this.expr(args[0], ctx);
      if (SCALARS.has(e.type)) {
        const n = MAT_SIZE[type];
        const arr = new Array(n).fill(0);
        const d = Math.sqrt(n);
        for (let i = 0; i < d; i++) arr[i * d + i] = e.code;
        return `[${arr.join(', ')}]`;
      }
    }
    const parts = [];
    const n = MAT_SIZE[type];
    for (const a of args) {
      const e = this.expr(a, ctx);
      const vn = VEC_SIZE[e.type];
      if (vn) for (let i = 0; i < vn; i++) parts.push(`${e.code}[${i}]`);
      else parts.push(e.code);
    }
    return `[${parts.slice(0, n).join(', ')}]`;
  }

  postfixExpr(node, ctx) {
    const base = this.expr(node.expression, ctx);
    const pf = node.postfix;
    if (pf.type === 'field_selection') {
      const sel = pf.selection.identifier;
      if (sel.length === 1 && SWZ[sel[0]] !== undefined) {
        return { code: `${base.code}[${SWZ[sel[0]]}]`, type: 'float', simple: true };
      }
      if (sel.split('').every((c) => SWZ[c] !== undefined)) {
        const idx = sel.split('').map((c) => SWZ[c]);
        const parts = idx.map((i) => `${base.code}[${i}]`);
        return { code: `[${parts.join(', ')}]`, type: base.type, simple: true };
      }
    }
    if (pf.type === 'index') {
      const idx = this.expr(pf.index, ctx);
      // mat 的 [i] 返回列向量 (GLSL 列主序): m.subarray(i*rows, i*rows+rows)
      if (MAT_SIZE[base.type]) {
        const rows = Math.round(Math.sqrt(MAT_SIZE[base.type]));
        return {
          code: `${base.code}.subarray((${idx.code}) * ${rows}, (${idx.code}) * ${rows} + ${rows})`,
          type: 'vec' + rows,
          simple: true,
        };
      }
      return { code: `${base.code}[${idx.code}]`, type: 'float', simple: true };
    }
    return { code: base.code, type: base.type, simple: base.simple };
  }

  exprTypeIsVec(t) {
    return VEC_SIZE[t] !== undefined || MAT_SIZE[t] !== undefined;
  }

  typeOfNode(node, ctx) {
    if (node.type === 'identifier') return this.typeOfName(node.identifier, ctx.locals);
    if (node.type === 'postfix') {
      const base = this.typeOfNode(node.expression, ctx);
      const pf = node.postfix;
      if (pf.type === 'field_selection' && pf.selection.identifier.length === 1) return 'float';
      return base;
    }
    const e = this.expr(node, ctx);
    return e.type;
  }
}
