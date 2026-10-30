import test from 'node:test';
import assert from 'node:assert/strict';
import { sep } from 'node:path';
import { apply, inject } from '../node_modules/@deepseek-ai/dsh-tool-bash/lib/index.js';

test('0.2.1 bash uses the session directory and exposes the executed cwd', async () => {
  let tool: any;
  const requests: any[] = [];
  const ensured: any[] = [];
  const result = {
    exitCode: 0, signal: null, timedOut: false, aborted: false, timeoutMs: 1000,
    stdout: { text: 'ok', truncated: false }, stderr: { text: '', truncated: false },
  };
  apply({
    tools: { register(value: any) { tool = value; } },
    systemPrompt: { section() {}, getSectionOrder() { return 1; } },
    shellEnv: { collect() { return {}; } },
    workingDirectory: { async ensure(...args: any[]) { ensured.push(args); return 'session-root'; } },
    shell: {
      resolve(request: any) { requests.push(request); return request; },
      async execute() { return { result: async () => result }; },
    },
  }, { enableRunInBackground: false });
  assert.ok(inject.includes('workingDirectory'));
  const signal = new AbortController().signal;
  const agent = { id: 'test-agent', session: 'test-session' };
  const value = await tool.execute({ command: 'echo ok', description: 'test', workdir: 'subdir' }, { agent, signal });
  assert.deepEqual(ensured, [[agent, signal]]);
  assert.equal(requests[0].workdir, `session-root${sep}subdir`);
  assert.equal(requests[0].signal, signal);
  assert.equal(value.cwd, requests[0].workdir);
  assert.equal(value.stdout.text, 'ok');
  assert.deepEqual(tool.output.presentationMeta({}, value), { cwd: value.cwd });
  await tool.execute({ command: 'echo ok', description: 'test' }, { agent, signal });
  assert.equal(requests[1].workdir, 'session-root');
  await tool.execute({ command: 'echo ok', description: 'test' }, { signal });
  assert.equal(ensured.length, 2, 'agentless calls must not create a session directory');
  assert.equal(requests[2].workdir, undefined);
});
