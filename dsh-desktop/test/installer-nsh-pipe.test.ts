import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const nsh = fs.readFileSync(join(root, 'tauri-shell', 'installer-hooks.nsh'), 'utf8');
test('installer hooks use direct path checks without a shell pipe or process termination', () => {
 assert.doesNotMatch(nsh,/cmd\s*\/c|nsProcess::|taskkill|KillProcess|ExecToLog/i);
 assert.doesNotMatch(nsh,/\|/);
 assert.match(nsh,/CreateFileW\(w "\$\{FILEPATH\}"/);
});
test('the inherited Tauri installer and uninstaller process macro is replaced with a refusal',()=>{
 assert.match(nsh,/!macroundef CheckIfAppIsRunning/);
 const macro=nsh.match(/!macro CheckIfAppIsRunning[^\n]*([\s\S]*?)!macroend/)[1];
 assert.match(macro,/DSH_RequireClosed "\$INSTDIR\\\$\{executableName\}"/);
 assert.match(nsh,/SetErrorLevel 2[\s\S]*?Quit/);
});
