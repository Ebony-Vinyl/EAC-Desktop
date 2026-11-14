import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// Optional browser regression, following shell-ui-compat.test.ts. The fixture
// reproduces the kernel's flex scrollport and sticky composer without a server,
// account, conversation, or third-party plugin installation.
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sourceRoot = process.env.EAC_BROWSER_TEST_SOURCE_ROOT || repo;
const require = createRequire(import.meta.url);
let playwright: any;
try {
  playwright = require(process.env.EAC_BROWSER_TEST_PLAYWRIGHT || 'playwright');
} catch (error) {
  if (process.env.EAC_BROWSER_TEST_PLAYWRIGHT) throw error;
}
const browserOptions = {
  skip: !playwright && 'Requires Playwright and an installed browser; set EAC_BROWSER_TEST_PLAYWRIGHT',
};
const client = readFileSync(join(sourceRoot, 'dsh-desktop/assets/plugins/dsh-viewport-lock/lib/client.js'), 'utf8');

async function fixture(t: any, popover: boolean, width = 1280, height = 800) {
  const browser = await playwright.chromium.launch({
    headless: true,
    channel: process.env.EAC_BROWSER_TEST_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined),
    executablePath: process.env.EAC_BROWSER_TEST_EXECUTABLE,
  });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width, height } });
  await page.setContent(`<!doctype html><html><head><style>
    html,body{margin:0;height:100%;font:14px system-ui;color:#183153;background:#f3f7fc}
    main{height:100%;display:flex;flex-direction:column}
    header{flex:none;padding:16px 24px;border-bottom:1px solid #cbd8e8;background:white}
    [data-conversation-scroll]{display:flex;flex:1 1 0%;flex-direction:column;min-height:0;overflow:auto}
    [data-slot="conversation.session"]{display:contents}
    #history{flex:1 0 auto;min-height:2000px;padding:24px;box-sizing:border-box}
    #history p{margin:0 0 120px}
    [data-composer-seat]{position:sticky;bottom:0;flex:none;display:flex;flex-direction:column;
      margin-top:auto;will-change:transform;background:#f3f7fc;padding:12px 24px}
    [data-composer-card]{border:1px solid #bbcde5;border-radius:18px;background:white;padding:12px}
    [data-input-scroll]{max-height:160px;overflow:auto}
    [data-composer-input]{min-height:36px;line-height:24px;outline:none;white-space:pre-wrap}
    #tools{height:40px;display:flex;align-items:end;justify-content:space-between}
    #panel{position:fixed;top:650px;left:900px;width:180px;height:60px;opacity:0;pointer-events:none}
  </style></head><body><main data-phase="active"><header>Composer scrolling regression</header>
    <div data-conversation-scroll><div data-slot="conversation.session"><div id="history">
      ${Array.from({ length: 12 }, (_, i) => `<p>History message ${i + 1}</p>`).join('')}
    </div></div><div data-composer-seat><div data-composer-card>
      <div data-input-scroll><div data-composer-input contenteditable="true" role="textbox" aria-label="Draft"></div></div>
      <div id="tools"><button type="button">More controls</button><span>Draft only</span></div>
      ${popover ? '<div id="panel">Hidden fixed popover</div>' : ''}
    </div></div></div></main></body></html>`);
  await page.evaluate(() => {
    (window as any).__ModuleLoader__ = {
      load(definition: any) {
        const plugin = definition.factory(() => { throw new Error('Unexpected dependency'); });
        (window as any).__disposeViewportLock = plugin.apply();
      },
    };
  });
  await page.addScriptTag({ content: client });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return page;
}

async function evidence(page: any, name: string) {
  const dir = process.env.EAC_BROWSER_TEST_EVIDENCE_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, name + '.png') });
}

test('hidden fixed composer popovers do not add blank space or lift the composer', browserOptions, async t => {
  const page = await fixture(t, true);
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => {
      const scroll = document.querySelector<HTMLElement>('[data-conversation-scroll]')!;
      const panel = document.getElementById('panel')!;
      panel.style.top = window.innerHeight - 180 + 'px';
      scroll.scrollTop = scroll.scrollHeight;
    });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  }
  const bounds = await page.evaluate(() => {
    const scroll = document.querySelector<HTMLElement>('[data-conversation-scroll]')!;
    const seat = document.querySelector<HTMLElement>('[data-composer-seat]')!;
    return { viewportBottom: scroll.getBoundingClientRect().bottom, seatBottom: seat.getBoundingClientRect().bottom,
      hiddenOverflow: seat.scrollHeight - seat.clientHeight,
      panelTop: document.getElementById('panel')!.getBoundingClientRect().top,
      panelStyle: document.getElementById('panel')!.style.top };
  });
  await evidence(page, 'fixed-popover');
  assert.ok(Math.abs(bounds.seatBottom - bounds.viewportBottom) <= 1, JSON.stringify(bounds));
  assert.equal(bounds.hiddenOverflow, 0, 'hidden popovers must not enlarge the composer scroll bounds');
  assert.ok(Math.abs(bounds.panelTop - parseFloat(bounds.panelStyle)) <= 1,
    'fixed popovers must use viewport coordinates: ' + JSON.stringify(bounds));
});

test('typing and IME composition keep history still while long drafts and wheel scrolling work', browserOptions, async t => {
  for (const size of [{ width: 1710, height: 937 }, { width: 1024, height: 720 }]) {
    const page = await fixture(t, false, size.width, size.height);
    const editor = page.getByRole('textbox', { name: 'Draft' });
    await editor.click();
    const before = await page.evaluate(() => {
      const scroll = document.querySelector<HTMLElement>('[data-conversation-scroll]')!;
      scroll.scrollTop = Math.round((scroll.scrollHeight - scroll.clientHeight) / 2);
      return scroll.scrollTop;
    });
    const top = () => page.locator('[data-conversation-scroll]').evaluate((el: HTMLElement) => el.scrollTop);
    await page.keyboard.type('Typing should keep history still', { delay: 15 });
    await evidence(page, 'typing-' + size.width);
    assert.equal(await top(), before, 'ordinary typing must preserve the reading position');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowRight');
    assert.equal(await top(), before, 'caret navigation must preserve the reading position');
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.imeSetComposition', { text: 'ni', selectionStart: 2, selectionEnd: 2 });
    assert.equal(await top(), before, 'IME preedit must preserve the reading position');
    await cdp.send('Input.insertText', { text: '你好' });
    assert.equal(await top(), before, 'IME commit must preserve the reading position');
    await cdp.detach();
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('Next line');
    assert.equal(await top(), before, 'newlines must preserve the reading position');
    await editor.fill(Array.from({ length: 30 }, (_, i) => 'Draft line ' + (i + 1)).join('\n'));
    await page.keyboard.press('Control+End');
    const draft = await page.locator('[data-input-scroll]').evaluate((el: HTMLElement) => {
      const caret = getSelection()!.getRangeAt(0).getBoundingClientRect();
      const rect = el.getBoundingClientRect();
      return { top: el.scrollTop, caretBottom: caret.bottom, bottom: rect.bottom };
    });
    assert.ok(draft.top > 0, 'the draft must still scroll internally');
    assert.ok(draft.caretBottom <= draft.bottom + 1, 'the caret must remain visible inside the draft');
    await page.mouse.move(size.width / 2, 150);
    await page.mouse.wheel(0, -150);
    await page.waitForFunction((position: number) => document.querySelector<HTMLElement>('[data-conversation-scroll]')!.scrollTop < position, before);
    await page.getByRole('button', { name: 'More controls' }).focus();
    assert.ok(await page.locator('[data-conversation-scroll]').evaluate((el: HTMLElement) => parseFloat(getComputedStyle(el).scrollPaddingBottom)) > 0,
      'blur must restore the reserve used by message navigation');
    await page.close();
  }
});
