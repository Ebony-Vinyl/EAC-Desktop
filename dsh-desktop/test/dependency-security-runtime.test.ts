import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';

const desktop = join(import.meta.dirname, '..');
const target = process.env.EAC_SECURITY_TEST_ROOT || desktop;
const requireTarget = createRequire(join(target, 'package.json'));
const loadKernel = (name: string) => import(pathToFileURL(requireTarget.resolve(name)).href);

function rpcResponse(message: any): any {
  if (message.id === undefined) return undefined;
  let result: any;
  if (message.method === 'initialize') result = {
    protocolVersion: message.params.protocolVersion, capabilities: { tools: {} },
    serverInfo: { name: 'eac-security-fixture', version: '1.0.0' },
  };
  else if (message.method === 'tools/list') result = { tools: [{
    name: 'echo', description: 'Keyless audit echo',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  }] };
  else if (message.method === 'tools/call') result = {
    content: [{ type: 'text', text: JSON.stringify({ echo: message.params.arguments.text, pid: process.pid }) }],
  };
  else return { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'unsupported fixture method' } };
  return { jsonrpc: '2.0', id: message.id, result };
}

async function exerciseMcp(config: any): Promise<number> {
  const { Context } = await loadKernel('@deepseek-ai/cordis');
  const { default: SystemPrompt } = await loadKernel('@deepseek-ai/dsh-system-prompt');
  const { default: ToolRuntime } = await loadKernel('@deepseek-ai/dsh-tools');
  const mcp = await import(pathToFileURL(requireTarget.resolve('@deepseek-ai/dsh-mcp-client')).href);
  // 0.2.2 起工具执行器插件化（ctx.tools.setExecutor）：最小组合不再自带执行器，
  // ctx.tools.execute 会抛 TOOL_EXECUTOR_UNAVAILABLE。旧内核没有这个包，允许缺席。
  const nativeExecutor: any = await loadKernel('@deepseek-ai/dsh-tool-executor-native').catch(() => undefined);
  const ctx = new Context();
  try {
    await ctx.plugin(SystemPrompt);
    await ctx.plugin(ToolRuntime);
    if (nativeExecutor) await ctx.plugin(nativeExecutor);
    await mcp.apply(ctx, { ...config, serverName: 'audit', toolCallTimeoutMs: 3000, failOnStartupError: true,
      reconnect: { enabled: false, initialDelayMs: 10, maxDelayMs: 50, maxAttempts: 1 } });
    assert.ok(ctx.tools.schemas().some((s: { name: string }) => s.name === 'mcp__audit__echo'));
    const signal = new AbortController().signal;
    // 0.2.2 起 ctx.tools.execute 只收批次（calls + JSON 字符串 arguments），返回按
    // 调用顺序的 settlement；旧内核仍是单调用形状。
    const result = nativeExecutor
      ? (await ctx.tools.execute({ signal,
          calls: [{ id: 'eac-security-audit-call', name: 'mcp__audit__echo', arguments: JSON.stringify({ text: 'audit-no-model' }) }] })).results[0].result
      : await ctx.tools.execute({ signal, callId: 'eac-security-audit-call', name: 'mcp__audit__echo', arguments: { text: 'audit-no-model' } });
    assert.notEqual(result.isError, true);
    const actual = JSON.parse(result.content[0].text);
    assert.equal(actual.echo, 'audit-no-model');
    return actual.pid;
  } finally { await ctx.fiber.dispose(); }
}

test('fixed SDK remains compatible with the real pinned kernel MCP HTTP plugin', { timeout: 15_000 }, async () => {
  const methods: string[] = [];
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST') { res.writeHead(req.method === 'DELETE' ? 200 : 405).end(); return; }
    let body = '';
    for await (const part of req) body += part;
    const message = JSON.parse(body);
    methods.push(message.method);
    const response = rpcResponse(message);
    if (!response) { res.writeHead(202).end(); return; }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(response));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    await exerciseMcp({ transport: 'streamable-http', url: 'http://127.0.0.1:' + address.port + '/mcp', headers: {} });
    assert.ok(methods.includes('initialize') && methods.includes('tools/list') && methods.includes('tools/call'));
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('fixed SDK remains compatible with pinned kernel stdio transport and child cleanup', { timeout: 15_000 }, async () => {
  const fixture = 'const rpcResponse=' + rpcResponse.toString() + ';' +
    'require("node:readline").createInterface({input:process.stdin}).on("line",line=>{const response=rpcResponse(JSON.parse(line));if(response)process.stdout.write(JSON.stringify(response)+"\\n")});process.stdin.on("end",()=>process.exit(0));';
  const childPid = await exerciseMcp({ transport: 'stdio', command: process.execPath, args: ['-e', fixture], env: {}, cwd: target });
  assert.notEqual(childPid, process.pid);
  let alive = true;
  for (let i = 0; i < 20; i++) {
    try { process.kill(childPid, 0); } catch { alive = false; break; }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(alive, false, 'SDK child must settle during plugin disposal');
});

test('issuer-bound MCP credentials never reach another authorization server', async () => {
  const sdk = requireTarget('@modelcontextprotocol/client');
  const provider = new sdk.ClientCredentialsProvider({ clientId: 'audit-client',
    clientSecret: 'audit-fixture-not-a-real-secret', expectedIssuer: 'https://issuer-a.invalid' });
  let requests = 0;
  await assert.rejects(sdk.fetchToken(provider, 'https://issuer-b.invalid', {
    metadata: { issuer: 'https://issuer-b.invalid', token_endpoint: 'https://issuer-b.invalid/token',
      token_endpoint_auth_methods_supported: ['client_secret_basic'] },
    fetchFn: async () => { requests++; return new Response(JSON.stringify({ access_token: 'audit-token', token_type: 'Bearer' }),
      { headers: { 'content-type': 'application/json' } }); },
  }), /mismatch|bound|issuer/i);
  assert.equal(requests, 0);
});

test('native sharp renders SVG and roundtrips PNG on the current Node ABI', async () => {
  const sharp = requireTarget('sharp');
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="3" height="2"><rect width="3" height="2" fill="#123456"/></svg>');
  const png = await sharp(svg).png().toBuffer();
  const metadata = await sharp(png).metadata();
  assert.equal(metadata.format, 'png');
  assert.equal(metadata.width, 3); assert.equal(metadata.height, 2);
  const raw = await sharp(png).removeAlpha().raw().toBuffer();
  assert.deepEqual([...raw.subarray(0, 3)], [0x12, 0x34, 0x56]);
  assert.ok(sharp.versions.vips && sharp.versions.rsvg);
});

test('brace expansion keeps normal patterns and bounds deeply nested input', () => {
  const expansion = requireTarget('brace-expansion');
  assert.deepEqual(expansion('file-{a,b}-{1..2}'), ['file-a-1', 'file-a-2', 'file-b-1', 'file-b-2']);
  const script = 'const expand=require(' + JSON.stringify(requireTarget.resolve('brace-expansion')) + ');' +
    'const result=expand("{".repeat(4000)+"a,b"+"}".repeat(4000));if(!Array.isArray(result))process.exit(2);';
  const result = spawnSync(process.execPath, ['--max-old-space-size=96', '-e', script], { encoding: 'utf8', timeout: 3000 });
  assert.equal(result.status, 0, result.error?.message || result.stderr);
});

test('LibreOffice resolves the shared fixed fflate rather than a nested vulnerable copy', () => {
  const libreoffice = createRequire(requireTarget.resolve('@deepseek-ai/libreoffice-kit'));
  assert.equal(libreoffice.resolve('fflate'), requireTarget.resolve('fflate'));
});

test('actual LibreOffice fflate rejects malformed ZIP64 without hanging', () => {
  const libreoffice = createRequire(requireTarget.resolve('@deepseek-ai/libreoffice-kit'));
  const fflate = libreoffice('fflate');
  const zip = Buffer.from(fflate.zipSync({ 'audit.txt': fflate.strToU8('fixture') }));
  assert.equal(fflate.strFromU8(fflate.unzipSync(zip)['audit.txt']), 'fixture');
  const end = zip.length - 22, central = zip.readUInt32LE(end + 16);
  assert.equal(zip.readUInt16LE(central + 30), 0, 'fixture has no ZIP64 extra field');
  const malformed = Buffer.alloc(zip.length + 76);
  zip.copy(malformed, 0, 0, end);
  malformed.writeUInt32LE(0x06064b50, end); malformed.writeBigUInt64LE(44n, end + 4);
  malformed.writeUInt32LE(1, end + 32); malformed.writeUInt32LE(central, end + 48);
  malformed.writeUInt32LE(0x07064b50, end + 56); malformed.writeUInt32LE(end, end + 64);
  zip.copy(malformed, end + 76, end);
  malformed.writeUInt16LE(65535, end + 76 + 8); malformed.writeUInt32LE(0xffffffff, end + 76 + 16);
  malformed.writeUInt32LE(0xffffffff, central + 20);
  const script = 'const unzip=require(' + JSON.stringify(libreoffice.resolve('fflate')) + ').unzipSync;' +
    'try{unzip(Buffer.from(' + JSON.stringify(malformed.toString('base64')) + ',"base64"));process.exit(2)}catch(error){if(error.code!==13)throw error;}';
  const result = spawnSync(process.execPath, ['--max-old-space-size=96', '-e', script], { encoding: 'utf8', timeout: 2000 });
  assert.equal(result.status, 0, result.error?.message || result.stderr);
});

test('fixed development source-map package preserves ordinary mapping behavior', () => {
  const { SourceMapGenerator, SourceMapConsumer } = requireTarget('source-map-js');
  const map = new SourceMapGenerator({ file: 'out.js' });
  map.addMapping({ generated: { line: 1, column: 0 }, original: { line: 2, column: 3 }, source: 'input.ts' });
  const consumer = new SourceMapConsumer(map.toJSON());
  assert.deepEqual(consumer.originalPositionFor({ line: 1, column: 0 }), { source: 'input.ts', line: 2, column: 3, name: null });
});
