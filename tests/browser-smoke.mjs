// Optional real-browser verification. LIVE_MULTIPLAYER=1 also uses the public
// signaling service and three real WebRTC clients. Every test browser is muted.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('..', import.meta.url));
const out = process.env.SMOKE_OUTPUT || await mkdtemp(path.join(os.tmpdir(), 'illic-isle-smoke-'));
await mkdir(out, { recursive: true });
const server = spawn(process.execPath, ['serve.mjs', '0'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let browser;
const openedPages = [];
try {
  const [ready] = await once(server.stdout, 'data');
  const port = String(ready).match(/localhost:(\d+)/)?.[1];
  assert.ok(port && port !== '0', 'Development server must report its assigned port');
  const base = `http://localhost:${port}/`;
  browser = await chromium.launch({
    headless: true,
    ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}),
    args: ['--mute-audio', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const errors = [];
  async function newPlayer(url = base) {
    const context = await browser.newContext({ viewport: { width: 960, height: 540 } });
    await context.addInitScript(() => localStorage.setItem('illicisle.settings', JSON.stringify({audio:false,res:180,density:.55})));
    const page = await context.newPage();
    openedPages.push(page);
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(url);
    await page.waitForFunction(() => window.__game?.state === 'title', null, { timeout: 90000 });
    await page.waitForFunction(() => document.getElementById('loading').classList.contains('hidden'));
    return page;
  }
  const page = await newPlayer();
  await page.screenshot({ path: path.join(out, 'title.png') });
  for (const viewport of [{width:960,height:720}, {width:1280,height:720}, {width:540,height:900}]) {
    await page.setViewportSize(viewport);
    for (const res of [180,224,320,0]) {
      const sizes = await page.evaluate(res => {
        const g = window.__game;
        g.settings.res = res; g.applySettings(); g._resize(); g.render(0);
        return { hud: {w:g.ui.hud.c.width,h:g.ui.hud.c.height}, screen:g.screens.name, alpha:g.ui.hud.x.globalAlpha };
      }, res);
      assert.ok(sizes.hud.w >= 240 && sizes.hud.h >= 180, JSON.stringify({viewport,res,sizes}));
      assert.equal(sizes.screen, 'title'); assert.equal(sizes.alpha, 1);
    }
  }
  await page.setViewportSize({width:960,height:540});
  await page.evaluate(() => { __game.settings.res=180; __game.applySettings(); __game._resize(); });

  const failures = await page.evaluate(async () => {
    const {ScreenStack} = await import('/js/lib/screens.js');
    const {recordText} = await import('/js/lib/bitfont.js');
    const failures=[];
    for (const [W,H] of [[240,180],[320,180],[320,224],[398,224],[426,320]]) {
      const c=document.createElement('canvas'); c.width=W;c.height=H;
      const x=c.getContext('2d');
      for (const name of ['title','controls','options','mpGuide','mpMenu']) {
        const stack = new ScreenStack(window.__game), s=stack.push(name,{});
        s.t=2;stack.t=3;
        const boxes=recordText(true);
        try {
          stack.draw(x,W,H);
          for (const b of boxes) if (b.x<0 || b.y<0 || b.x+b.w>W || b.y+b.h>H) failures.push({name,W,H,text:b.t});
          if (x.globalAlpha !== 1) failures.push({name,W,H,alpha:x.globalAlpha});
          if (name==='title' && boxes.some(b => /STORY|ADVENTURE|LEGEND/.test(b.t))) failures.push({name,legacy:true});
        } finally { recordText(false); }
      }
    }
    return failures;
  });
  assert.deepEqual(failures, [], 'Online screen text must fit at every supported layout');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => __game.screens.name), 'mpGuide');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.evaluate(() => __game.screens.top.page), 1);
  await page.screenshot({path:path.join(out,'how-to-play.png')});
  await page.keyboard.press('Escape');
  // The former solo shortcut now follows the ordinary online entry point.
  await page.evaluate(() => __game.screens.replace('title'));
  await page.keyboard.press('Shift+Enter');
  assert.equal(await page.evaluate(() => __game.screens.name), 'mpMenu');
  assert.equal(await page.evaluate(() => __game.state), 'title');
  await page.keyboard.type('TEST HOST');
  await page.keyboard.press('Tab'); await page.keyboard.type('ABC'); await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => __game.screens.top.busy), false);
  assert.match(await page.evaluate(() => __game.screens.top.err), /COMPLETE/);
  await page.keyboard.press('Delete');
  await page.screenshot({path:path.join(out,'online-menu.png')});

  if (process.env.LIVE_MULTIPLAYER === '1') {
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => __game.screens.name === 'mpLobby', null, { timeout: 30000 });
    const code = await page.evaluate(() => __game.mp.net.room);
    assert.match(code, /^[A-Z2-9]{4}$/);
    const pages = [page];
    for (let i=1;i<3;i++) {
      const guest = await newPlayer(`${base}?room=${code.toLowerCase()}`);
      assert.equal(await guest.evaluate(() => __game.screens.name), 'mpMenu');
      assert.equal(await guest.evaluate(() => __game.screens.top.code), code);
      await guest.keyboard.type(`TEST ${i}`); await guest.keyboard.press('Enter');
      await guest.waitForFunction(() => __game.screens.name === 'mpLobby', null, { timeout: 30000 });
      pages.push(guest);
    }
    const phase = async (name, timeout=30000) => Promise.all(pages.map(p => p.waitForFunction(name => __game.mp.view.phase===name, name, {timeout})));
    await Promise.all(pages.map(p => p.waitForFunction(() => __game.mp.view.players.size===3)));
    await Promise.all(pages.map(p => p.waitForFunction(() => Number.isFinite(__game.mp.net.health.rtt), null, {timeout:15000})));
    console.log('PASS: three public WebRTC connections, invite links, synchronized rosters and measured latency.');
    await page.screenshot({path:path.join(out,'lobby.png')});
    await page.keyboard.press('KeyH');
    assert.equal(await page.evaluate(() => __game.screens.name), 'mpGuide');
    await page.keyboard.press('Escape');
    await page.evaluate(() => __game.startMatch());
    await phase('roam', 60000);
    const roles = await Promise.all(pages.map(p => p.evaluate(() => __game.mp.view.role)));
    assert.equal(roles.filter(r=>r==='agent').length,1);
    assert.equal(roles.filter(r=>r==='castaway').length,2);
    await Promise.all(pages.map(p => p.waitForFunction(() => __game.state==='island' && !__game.screens.open)));
    await page.evaluate(() => { __game.ui.toast('A SHORT NOTICE THAT LEAVES THE ISLAND VISIBLE', 'jade', 4000); });
    await page.screenshot({path:path.join(out,'online-round.png')});
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => __game.screens.name), 'pause');
    await page.evaluate(() => __game.render(.016));
    assert.equal(await page.evaluate(() => !!__game.ui.hud._popupShown), false);
    await page.screenshot({path:path.join(out,'pause.png')});
    await page.keyboard.press('Escape');
    // Position a player at the actual bell, then use the real report intent.
    await page.evaluate(() => {
      const bell=__game.mp.host.hooks.siteOf('bell');
      __game.player.teleport(bell.x,__game.player.pos.y,bell.z);
      Object.assign(__game.mp.host.players.get('host'), {x:bell.x,z:bell.z,room:0});
      __game._send({t:'c.report',bodyId:null});
    });
    await phase('council');
    await Promise.all(pages.map(p => p.waitForFunction(() => __game.screens.name==='mpCouncil')));
    await pages[1].keyboard.press('KeyT');
    await pages[1].keyboard.type('All hands at the bell!'); await pages[1].keyboard.press('Enter');
    await Promise.all(pages.map(p => p.waitForFunction(() => __game.mp.chat.some(m=>m.text==='ALL HANDS AT THE BELL!'))));
    await page.screenshot({path:path.join(out,'council.png')});
    for (const p of pages) {
      // Fresh meetings default to NOBODY. Enter explicitly confirms the choice.
      assert.equal(await p.evaluate(() => __game.screens.top.selId), 'skip');
      await p.keyboard.press('Enter');
    }
    await phase('result');
    assert.equal(await page.evaluate(() => __game.mp.host.votes.size), 3);
    await page.screenshot({path:path.join(out,'vote-result.png')});
    await phase('roam', 20000);
    // Force the task counter at the finish line to exercise the actual win
    // transition; individual chores and their validation have Node regressions.
    await page.evaluate(() => { const h=__game.mp.host;h.tasksDone=h.tasksTotal;h._checkWin(); });
    await phase('over');
    assert.ok(await page.evaluate(() => __game.mp.view.over));
    await page.screenshot({path:path.join(out,'round-results.png')});
    await page.evaluate(() => __game.playAgain());
    await phase('lobby');
    for (const p of pages) {
      const state=await p.evaluate(()=>({role:__game.mp.view.role,over:__game.mp.view.over,players:__game.mp.view.players.size,screen:__game.screens.name}));
      assert.equal(state.role,null);assert.equal(state.over,null);assert.equal(state.players,3);assert.equal(state.screen,'mpLobby');
    }
    await pages[2].evaluate(() => __game.quitToTitle());
    await page.waitForFunction(() => __game.mp.host.players.size===2);
    await pages[2].evaluate(async code => { await __game.joinGame('TEST 2',code);__game.screens.replace('mpLobby'); },code);
    await Promise.all(pages.map(p => p.waitForFunction(() => __game.mp.view.players.size===3)));
    await page.evaluate(() => __game.startMatch()); await phase('reveal');
    await page.evaluate(() => __game.quitToTitle());
    await pages[1].waitForFunction(() => __game.mp.net?.health.state==='closed');
    await pages[1].waitForFunction(() => __game.screens.name==='mpEnd' && __game.screens.top.winner===null);
    await pages[1].screenshot({path:path.join(out,'host-disconnected.png')});
    console.log('PASS: role briefing, online HUD, pause, council chat and ballots, task victory, rematch, peer departure and host loss.');
    await pages[1].context().close(); await pages[2].context().close();
  } else {
    await page.keyboard.press('Escape');
  }
  assert.deepEqual(errors, [], 'Browser must have no uncaught errors or shader failures');
  await page.evaluate(() => {
    __game.input.fwd=true;__game.holdingE=true;
    document.getElementById('game').dispatchEvent(new Event('webglcontextlost',{cancelable:true}));
  });
  await page.waitForFunction(() => !document.pointerLockElement);
  assert.equal(await page.evaluate(() => __game.input.fwd || __game.holdingE),false);
  assert.equal(await page.locator('#load-retry').isVisible(),true);
  await page.screenshot({path:path.join(out,'graphics-recovery.png')});
  await page.locator('#load-retry').click();
  await page.waitForFunction(() => window.__game?.state==='title',null,{timeout:90000});
  await page.evaluate(() => document.getElementById('game').dispatchEvent(new Event('webglcontextlost',{cancelable:true})));
  await page.waitForTimeout(750);
  assert.equal(await page.locator('#load-retry').isVisible(),true,'Startup fade must not hide recovery');
  console.log(`PASS: resolution changes, 25 online screen layouts, guide navigation, room validation, and graphics recovery. Screenshots: ${out}`);
} catch (error) {
  for (const [i,p] of openedPages.entries()) if (!p.isClosed()) {
    console.error('BROWSER STATE', i, await p.evaluate(() => ({state:window.__game?.state, screen:window.__game?.screens.name, phase:window.__game?.mp.view?.phase, chat:window.__game?.mp.chat, error:window.__game?.screens.top?.err})).catch(() => null));
    await p.screenshot({path:path.join(out, `failure-${i}.png`)}).catch(() => {});
  }
  throw error;
} finally {
  await browser?.close();server.kill();
}
