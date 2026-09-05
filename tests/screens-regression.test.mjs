import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { textWidth, wrapText, fitText } from '../js/lib/bitfont.js';
import { parseRoomCode, roomInviteURL } from '../js/net/net.js';
import { MINIGAMES, bindText } from '../js/mp/minigames.js';

// Exercise actual screen logic without booting WebGL or a peer connection.
// Drawing dependencies are replaced with canvas-compatible recording stubs.
const source = (await readFile(new URL('../js/lib/screens.js', import.meta.url), 'utf8'))
  .replace(/^import[\s\S]*?;\n/gm, '').replace(/^export /gm, '');
const drawn = [];
const timers = new Map();
let nextTimer = 0;
function context2D() {
  const saved = [];
  return new Proxy({
    globalAlpha: 1,
    save() { saved.push(this.globalAlpha); },
    restore() { this.globalAlpha = saved.pop(); },
    get savedCount() { return saved.length; },
    createImageData(w,h) { return { data: new Uint8ClampedArray(w*h*4) }; },
  }, { get: (target, key) => key in target ? target[key] : (() => {}) });
}
const context = vm.createContext({
  console, Math, performance, textWidth, wrapText, fitText, parseRoomCode, roomInviteURL,
  setTimeout(fn, ms) { const id = ++nextTimer; timers.set(id, { fn, ms }); return id; },
  clearTimeout(id) { timers.delete(id); },
  drawText(_ctx, text, opts = {}) { drawn.push({ text: String(text), ...opts }); },
  panel() {}, ditherRect() {}, drawRelicIcon() {}, drawShopIcon() {}, drawPoiIcon() {},
  POI_ICONS: {}, POI_ICON_W: 12, COLOURS: [{id:'gold',hex:0xffd24a}],
  SABOTAGE_DEFS: {}, MINIGAMES, bindText, DARTS: {}, STOCK: {}, FOOD: {}, DRINKS: {},
  shelf() { return []; }, VENDOR_IDS: [], SCHLARNA_N: 6, FEED_H: 10, FEED_W: 10, THUMB_H: 5, THUMB_W: 5,
  document: {createElement() { return {getContext: context2D}; }},
  localStorage: {getItem() { return ''; }}, location: {hash:''},
});
vm.runInContext(`${source}\nglobalThis.screensAPI = { SCREENS, ScreenStack };`, context);
const { SCREENS, ScreenStack } = context.screensAPI;
function game() {
  return {
    audio: {sfx() {}}, settings: {sens:1.4,invert:false,res:224,jitter:true,crt:true,density:1,walk:'weighted',audio:true},
    DAY_LEN:360, runTime:0, coins:1, mp:{active:false},
    journalEntries() { return [{found:true,title:'MY JOURNAL',text:'A LINE\n'.repeat(40)}]; },
    applySettings() {}, afterOverlayClose() {}, _clearHeldInput() {},
  };
}
function draw(name, s, g, W=320, H=180) {
  drawn.length=0;
  return SCREENS[name].draw(context2D(),W,H,s,g,10) || [];
}

test('reader reveals from the start and scrolls to every line without losing its exit callback', () => {
  const g=game(); let completed=0;
  const st=new ScreenStack(g);
  const s=st.push('reader',{head:'A HEADING',body:'A LINE\n'.repeat(40),onDone(){completed++;}});
  st.key('NumpadEnter');
  assert.equal(s.done,true);
  draw('reader',s,g);
  assert.equal(s.scroll,0);
  assert.ok(s.maxScroll>0);
  st.key('End'); assert.equal(s.scroll,s.maxScroll);
  st.wheel(-1); assert.equal(s.scroll,s.maxScroll-1);
  st.key('Home'); assert.equal(s.scroll,0);
  st.key('Escape'); assert.equal(st.open,false); assert.equal(completed,1);
});

test('journal keeps every long page reachable using keyboard and wheel', () => {
  const g=game(), st=new ScreenStack(g), s=st.push('journal');
  draw('journal',s,g,240,180);
  assert.ok(s.maxScroll>0);
  st.key('End'); assert.equal(s.scroll,s.maxScroll);
  st.wheel(-1); assert.equal(s.scroll,s.maxScroll-1);
  st.key('Home'); assert.equal(s.scroll,0);
  st.key('ArrowRight'); assert.equal(s.scroll,0);
});

test('map accepts zoom and dragging immediately and balances canvas state without chart data', () => {
  const g=game(), st=new ScreenStack(g), s=st.push('chart');
  st.key('Equal'); assert.equal(s.zoom,2);
  st.pointer('down',20,20); st.pointer('move',30,40); st.pointer('up',30,40);
  assert.ok(Number.isFinite(s.cx)); assert.ok(Number.isFinite(s.cz));
  s.t=0.36;
  const ctx=context2D();
  SCREENS.chart.draw(ctx,320,180,s,g,10);
  assert.equal(ctx.savedCount,0); assert.equal(ctx.globalAlpha,1);
});

test('dial clicks choose and turn the clicked socket, and only confirm submits', () => {
  const g=game();g.dialSel=0;g.dialState=[0,0,0,0];g.knownGlyphHint=()=> 'I SUN  II MOON  III EYE  IV SPIRAL';
  let submissions=0;g.submitDials=()=>{submissions++;return true;};g.cycleDial=()=>{g.dialState[g.dialSel]++;};
  const st=new ScreenStack(g),s=st.push('dials');
  st.draw(context2D(),320,180);
  const socket=st._rows[2];
  st.click(socket.x+4,socket.y+4); assert.equal(g.dialSel,2);assert.equal(submissions,0);
  st.click(socket.x+4,socket.y+4); assert.equal(g.dialState[2],1);assert.equal(submissions,0);
  const confirm=st._rows.find(r=>r.confirm);
  st.click(confirm.x+3,confirm.y+3); assert.equal(submissions,1);
});

test('options labels select, and each value arrow changes in its indicated direction', () => {
  const g=game(),st=new ScreenStack(g);st.push('options');st.draw(context2D(),320,180);
  const [label,left,right]=st._rows;
  st.click(label.x+1,label.y+1);assert.equal(g.settings.sens,1.4);
  st.click(left.x+1,left.y+1);assert.equal(g.settings.sens,0.9);
  st.click(right.x+1,right.y+1);assert.equal(g.settings.sens,1.4);
});

test('opening and closing overlays releases gameplay input and clears stale hit targets', () => {
  const g=game();let clear=0;g._clearHeldInput=()=>clear++;
  const st=new ScreenStack(g); st.push('controls');st._rows=[{x:0,y:0,w:10,h:10}];st.setHeld('KeyW',true);
  st.push('options');assert.equal(st.held.size,0);assert.equal(st._rows.length,0);
  st.pop();st.clear();assert.equal(clear,4);
});

test('the title only exposes online play and its help; modifiers cannot start the removed story', () => {
  const g=game();let starts=0;g.beginGame=()=>starts++;
  const st=new ScreenStack(g);g.screens=st;const s=st.push('title');
  for(const [w,h] of [[240,180],[320,180],[320,224],[426,320]]){
    const rows=draw('title',s,g,w,h);assert.equal(rows.length,4);
    assert.ok(rows.every(r=>r.y>=0&&r.y+r.h<h-22));
    assert.ok(!drawn.some(r=>/STORY|ADVENTURE|LEGEND|IDOL/.test(r.text)));
  }
  assert.equal(SCREENS.lore,undefined);
  st.key('Enter',{shift:true});assert.equal(st.name,'mpMenu');assert.equal(starts,0);
  st.replace('title');st.key('ArrowDown');st.key('Enter');assert.equal(st.name,'mpGuide');
});

test('text fields repeat characters but do not repeatedly switch focus or submit', () => {
  const g=game(),st=new ScreenStack(g),s=st.push('mpMenu');
  st.key('Tab');assert.equal(s.field,1);
  st.key('Tab',{repeat:true});assert.equal(s.field,1);
  st.key('KeyE',{repeat:true,ch:'e'});assert.equal(s.code,'E');
});

test('round settings explanations remain scrollable and loss of the host does not trap Escape', () => {
  const g=game();g.mp={view:{players:new Map()},host:{settings:{agents:0,stranger:true,killCooldown:30,graceSeconds:45,councilSeconds:60,tasksPerPlayer:4,emergencyPerPlayer:1,revealOnExile:true,nightOnly:false}}};
  const st=new ScreenStack(g),s=st.push('mpSettings');draw('mpSettings',s,g,240,180);
  assert.ok(s.maxScroll>0);st.key('End');assert.equal(s.scroll,s.maxScroll);
  st.wheel(-1);assert.equal(s.scroll,s.maxScroll-1);
  g.mp.host=null;st.key('Escape');assert.equal(st.open,false);
});

test('an abandoned connection completion does not cancel a newer connection', async () => {
  const g=game();let resolve,cancellations=0;
  g.hostGame=()=>new Promise(done=>{resolve=done;});g.cancelConnect=()=>cancellations++;
  context.localStorage.setItem=()=>{};
  const st=new ScreenStack(g);st.push('mpMenu');st.key('Enter');st.key('Escape');
  assert.equal(cancellations,1);resolve();await Promise.resolve();await Promise.resolve();
  assert.equal(cancellations,1);assert.equal(st.name,'title');
});

test('compact lobbies retain all ten player names above the host controls', () => {
  const g=game();g.isHost=true;
  g.mp={room:'ABCD',view:{players:new Map(Array.from({length:10},(_,i)=>[i?'peer'+i:'host',{id:i?'peer'+i:'host',name:'PERSON'+i,colour:'gold'}])),selfId:'host'},host:{settings:{agents:0}}};
  const st=new ScreenStack(g),s=st.push('mpLobby');
  for(const width of [240,320]){
    draw('mpLobby',s,g,width,180);
    assert.equal(drawn.filter(r=>r.text.startsWith('PERSON')).length,10);
    assert.ok(drawn.filter(r=>r.text.startsWith('PERSON')).every(r=>r.y+7<115));
  }
});

function onlineGame(n=10, host=true) {
  const g=game();g.isHost=host;g.amAlive=true;
  const players = new Map(Array.from({length:n},(_,i)=>[i?'peer'+i:'host',{
    id:i?'peer'+i:'host',name:'PERSON'+i,colour:'gold',alive:true,
  }]));
  const settings={agents:0,stranger:true,killCooldown:30,graceSeconds:45,councilSeconds:60,tasksPerPlayer:4,emergencyPerPlayer:1,revealOnExile:true,nightOnly:false};
  g.mp={active:true,started:false,room:'ABCD',chat:[],host:host?{settings}:null,
    view:{players,settings,selfId:host?'host':'peer1',phaseTotal:60,phaseEndsAt:performance.now()/1000+60,votes:{counts:{},voted:[]}},
    net:{health:{state:'connected',rtt:45,broker:'online'}}};
  return g;
}

function assertVisible(W,H) {
  for (const r of drawn) {
    if (!r.text) continue;
    const w=textWidth(r.text,r.scale||1,r.tracking??1);
    const left=r.x-(r.align==='center'?w/2:r.align==='right'?w:0);
    assert.ok(left>=0 && left+w<=W, `${W}x${H}: ${r.text} runs from ${left} to ${left+w}`);
    assert.ok(r.y>=0 && r.y+7*(r.scale||1)<=H, `${W}x${H}: ${r.text} at y=${r.y}`);
  }
}

test('online guidance and controls are usable from the title at every supported small resolution', () => {
  const g=game(),st=new ScreenStack(g);
  for (const screen of ['controls','mpGuide']) {
    const s=st.replace(screen);
    const count=screen==='controls'?3:5;
    for(let page=0;page<count;page++){
      for(const [w,h] of [[240,180],[320,180],[320,224],[426,320]]){
        draw(screen,s,g,w,h);assertVisible(w,h);
        if(s.maxScroll){st.key('End');assert.equal(s.scroll,s.maxScroll);draw(screen,s,g,w,h);assertVisible(w,h);}
      }
      st.key('ArrowRight');assert.equal(s.scroll,0);
    }
    assert.equal(s.page,0);
  }
  st.replace('controls');draw('controls',st.top,g,240,180);
  assert.ok(drawn.some(r=>r.text==='MAP + JOBS'));
  assert.ok(!drawn.some(r=>/COCONUT|JOURNAL/.test(r.text)));
});

test('room form validates before joining, retries synchronous failures, and pastes full invites safely', async () => {
  const g=game(),st=new ScreenStack(g),s=st.push('mpMenu');
  let joins=0,hosts=0;
  g.joinGame=()=>{joins++;return Promise.resolve();};
  g.hostGame=()=>{hosts++;throw new Error('NETWORK IS UNAVAILABLE');};
  s.code='AB';st.key('Enter');assert.equal(joins,0);assert.equal(s.busy,false);assert.equal(s.field,1);
  st.paste('https://example.com/game/?room=QWER');assert.equal(s.code,'QWER');assert.equal(s.err,'');
  s.field=0;st.paste('https://example.com/game/#ZXCV');assert.equal(s.code,'ZXCV');assert.equal(s.who,'');
  st.paste('https://example.com/game/?room=NO');assert.equal(s.code,'ZXCV');assert.ok(s.err);
  s.code='';st.key('Enter');assert.equal(hosts,1);assert.equal(s.busy,false);assert.match(s.err,/NETWORK/);
  s.field=1;st.paste('ABCD');st.key('Enter');assert.equal(joins,1);
  await new Promise(setImmediate);assert.equal(st.name,'mpLobby');
});

test('connection fields freeze while busy and both actions fit on compact screens', () => {
  const g=game(),st=new ScreenStack(g),s=st.push('mpMenu');
  g.hostGame=()=>new Promise(()=>{});
  s.who='SOMEONE';s.code='QWER';
  const rows=draw('mpMenu',s,g,240,180);
  assert.ok(rows.some(r=>r.create)&&rows.some(r=>r.join));assertVisible(240,180);
  SCREENS.mpMenu.click(rows.find(r=>r.create),0,s,g,st);
  assert.equal(s.busy,true);assert.equal(s.joining,false);
  st.paste('ABCD');st.key('KeyP',{ch:'p'});st.key('Tab');
  assert.equal(s.who,'SOMEONE');assert.equal(s.code,'QWER');assert.equal(s.field,0);
  st.update(12);assert.equal(s.elapsed,12);
  draw('mpMenu',s,g,240,180);assertVisible(240,180);
});

test('lobby start is guarded, guest settings are readable, and leaving does not reload', () => {
  const g=onlineGame(2),st=new ScreenStack(g),s=st.push('mpLobby');let starts=0,quits=0;
  g.startMatch=()=>starts++;g.quitToTitle=()=>quits++;
  st.key('Enter');assert.equal(starts,0);
  g.mp.view.players.set('peer2',{id:'peer2',name:'PERSON2'});
  st.key('Enter');assert.equal(starts,1);
  st.key('KeyH');assert.equal(st.name,'mpGuide');st.key('Escape');assert.equal(st.name,'mpLobby');
  st.key('Escape');assert.equal(quits,1);
  g.isHost=false;g.mp.host=null;
  st.key('Enter');assert.equal(st.name,'mpSettings');
  draw('mpSettings',st.top,g,240,180);
  const before=JSON.stringify(g.mp.view.settings);st.key('ArrowRight');st.key('ArrowDown');
  assert.equal(st.top.sel,1);assert.equal(JSON.stringify(g.mp.view.settings),before);
});

test('round setting labels select while arrows change in their displayed direction', () => {
  const g=onlineGame(3),st=new ScreenStack(g),s=st.push('mpSettings');s.sel=2;
  const rows=draw('mpSettings',s,g,240,180);
  const label=rows.find(r=>r.pick===2&&!r.step),left=rows.find(r=>r.pick===2&&r.step===-1),right=rows.find(r=>r.pick===2&&r.step===1);
  SCREENS.mpSettings.click(label,0,s,g);assert.equal(g.mp.host.settings.killCooldown,30);
  SCREENS.mpSettings.click(left,0,s,g);assert.equal(g.mp.host.settings.killCooldown,26);
  SCREENS.mpSettings.click(right,0,s,g);assert.equal(g.mp.host.settings.killCooldown,30);
});

test('a full lobby and results roster fit above controls for both host and guest', () => {
  for (const host of [true,false]) {
    const g=onlineGame(10,host),st=new ScreenStack(g);
    for(const [W,H] of [[240,180],[320,180],[320,224],[426,320]]){
      for(const name of ['mpLobby','mpEnd']){
        const s=st.replace(name,{winner:'castaways',agents:['peer1'],reason:'ALL THE CASTAWAYS FINISHED THEIR WORK AND GOT OFF THE ISLAND'});
        draw(name,s,g,W,H);assertVisible(W,H);
        const names=drawn.filter(r=>r.text.startsWith('PERSON'));
        assert.equal(names.length,10,`${name} ${W} ${H} host=${host}`);
        assert.ok(names.every(r=>r.y+7 < H-52),`${name} roster crosses controls`);
      }
    }
  }
});

test('council clicks only select; confirm uses stable identities and cannot vote for departed players', () => {
  const g=onlineGame(3),st=new ScreenStack(g),s=st.push('mpCouncil'),votes=[];
  g.sendVote=id=>votes.push(id);
  let rows=draw('mpCouncil',s,g,240,180);assert.equal(s.selId,'skip');
  const target=rows.find(r=>r.targetId==='peer1');
  SCREENS.mpCouncil.click(target,0,s,g);SCREENS.mpCouncil.click(target,0,s,g);
  assert.equal(s.selId,'peer1');assert.equal(votes.length,0);
  g.mp.view.players.delete('peer1');st.key('Enter');assert.equal(votes.length,0);assert.equal(s.cast,null);assert.equal(s.selId,'skip');
  draw('mpCouncil',s,g,240,180);st.key('Enter');st.key('Enter');assert.deepEqual(votes,['skip']);
});

test('council chat preserves drafts, respects keyboard punctuation, and scrolls without moving the vote', () => {
  const g=onlineGame(10),st=new ScreenStack(g),s=st.push('mpCouncil'),sent=[];
  g.sendChat=txt=>sent.push(txt);
  g.mp.chat=Array.from({length:20},(_,i)=>({from:'LONG PLAYER NAME',colour:'gold',text:`MESSAGE ${i} HAS SOMETHING TO SAY`}));
  draw('mpCouncil',s,g,240,180);assertVisible(240,180);assert.ok(s.chatMax>0);
  st.wheel(-1);assert.equal(s.chatScroll,1);const selected=s.selId;
  g.mp.chat.push({from:'NEW PERSON',text:'NEW MESSAGE'});draw('mpCouncil',s,g,240,180);assert.ok(s.chatScroll>1);assert.equal(s.selId,selected);
  st.key('Home');assert.equal(s.chatScroll,s.chatMax);st.key('End');assert.equal(s.chatScroll,0);
  st.key('KeyT');st.key('KeyM',{ch:','});assert.equal(s.typing,',');
  st.key('Escape');assert.equal(s.typing,',');st.key('KeyT');st.paste(' hello');st.key('Enter');
  assert.deepEqual(sent,[', HELLO']);assert.equal(s.typing,'');assert.equal(s.talking,false);
});

test('council, ghost chat and closed-room results fit and offer only valid actions', () => {
  const g=onlineGame(10),st=new ScreenStack(g);let votes=0,quits=0;
  g.sendVote=()=>votes++;g.quitToTitle=()=>quits++;
  const s=st.push('mpCouncil');
  for(const alive of [true,false]){
    g.amAlive=alive;s.cast=null;
    for(const W of [240,320]){draw('mpCouncil',s,g,W,180);assertVisible(W,180);}
  }
  st.key('Enter');assert.equal(votes,0);
  g.amAlive=true;g.mp.view.phaseEndsAt=performance.now()/1000-1;st.key('Enter');assert.equal(votes,0);
  const end=st.replace('mpEnd',{winner:null,reason:'THE HOST LEFT THE ISLAND. CREATE A NEW ROOM TO PLAY AGAIN.'});
  const rows=draw('mpEnd',end,g,240,180);assertVisible(240,180);assert.equal(rows.length,1);
  assert.ok(!drawn.some(r=>r.text==='CASTAWAY'||r.text==='CREW'||r.text==='ROGUE'));
  st.key('Escape');assert.equal(quits,1);
});

test('minigame completion is banked once and stale callbacks cannot close the next task', () => {
  timers.clear();const g=game(),st=new ScreenStack(g);let completed=0;
  g.finishMinigame=()=>completed++;
  const s=st.push('mpMinigame',{game:'test',taskId:'first'});
  SCREENS.mpMinigame._win(s,g,st);SCREENS.mpMinigame._win(s,g,st);assert.equal(completed,1);
  const close=[...timers.values()].find(t=>t.ms===620).fn;
  st.replace('mpMinigame',{game:'test',taskId:'second'});assert.equal(timers.size,0);
  close();assert.equal(st.name,'mpMinigame');assert.equal(st.top.taskId,'second');
});


test('every real chore presents usable controls and stays inside compact buffers', () => {
  const g=game(),st=new ScreenStack(g);
  for(const name of Object.keys(MINIGAMES)){
    for(const hard of [false,true]){
      for(const [W,H] of [[240,180],[320,180],[320,224]]){
        const s=st.replace('mpMinigame',{game:name,hard,seed:7});
        draw('mpMinigame',s,g,W,H);assertVisible(W,H);
        st.update(0.025);draw('mpMinigame',s,g,W,H);assertVisible(W,H);
        st.key('Escape');assert.equal(st.open,false);
      }
    }
  }
});


test('live and ghost chat preserve bitmap punctuation and ignore unsupported layout characters', () => {
  for (const alive of [true,false]) {
    const g=onlineGame(3),st=new ScreenStack(g),s=st.push('mpCouncil'),sent=[];
    g.amAlive=alive;g.sendChat=text=>sent.push(text);st.key('KeyT');
    st.paste('all hands at the bell');st.key('Digit1',{ch:'!',shift:true});st.key('Enter');
    assert.deepEqual(sent,['ALL HANDS AT THE BELL!']);
    st.key('KeyT');st.key('Digit2',{ch:'@',shift:true});st.key('Semicolon',{ch:':',shift:true});st.key('Semicolon',{ch:';'});
    assert.equal(s.typing,'@:;');
    st.key('Digit6',{ch:'^',shift:true});st.key('KeyE',{ch:'Dead'});st.key('Digit2',{ch:'é'});
    assert.equal(s.typing,'@:;');
    st.paste(' !:;@^');assert.equal(s.typing,'@:; !:;@');
    st.key('KeyA');assert.equal(s.typing,'@:; !:;@A');
  }
  const g=game(),st=new ScreenStack(g),s=st.push('mpMenu');
  st.key('Digit2',{ch:'@',shift:true});st.key('KeyE',{ch:'Dead'});assert.equal(s.who,'');
  st.key('Tab');st.key('Digit1',{ch:'!',shift:true});assert.equal(s.code,'');
  st.key('Digit2');assert.equal(s.code,'2');
});


test('result roster columns keep six pixels between names, roles and life status', () => {
  for(const count of [3,10]){
    const g=onlineGame(count),st=new ScreenStack(g);
    for(const p of g.mp.view.players.values()) p.name='LONGPLAYER12';
    g.mp.view.players.get('peer1').alive=false;
    for(const [W,H] of [[240,180],[320,180],[320,224],[426,320]]){
      const s=st.replace('mpEnd',{winner:'castaways',agents:['peer2'],reason:'ALL WORK COMPLETE'});
      draw('mpEnd',s,g,W,H);assertVisible(W,H);
      const roster=drawn.filter(r=>r.y>=80&&r.y<H-52).map(r=>{
        const width=textWidth(r.text,r.scale||1,r.tracking??1);
        const left=r.x-(r.align==='center'?width/2:r.align==='right'?width:0);
        return {...r,left,right:left+width,bottom:r.y+7*(r.scale||1)};
      });
      assert.ok(roster.some(r=>r.text==='ROGUE AGENT'||r.text==='ROGUE'));
      for(let i=0;i<roster.length;i++)for(let j=i+1;j<roster.length;j++){
        const a=roster[i],b=roster[j];
        if(a.bottom<=b.y||b.bottom<=a.y) continue;
        const gap=a.left<=b.left?b.left-a.right:a.left-b.right;
        assert.ok(gap>=6,`${W}x${H} ${count} players: ${a.text} / ${b.text} gap=${gap}`);
      }
    }
  }
});

test('host loss after the result preserves known roles but cannot offer an impossible rematch', () => {
  const g=onlineGame(3,false),st=new ScreenStack(g);let quits=0,rematches=0;
  g.quitToTitle=()=>quits++;g.playAgain=()=>rematches++;
  const s=st.push('mpEnd',{winner:'castaways',agents:['peer2'],reason:'ALL WORK COMPLETE'});
  for(const mode of ['closed','health']){
    g.mp.net.closed=mode==='closed';g.mp.net.health.state=mode==='health'?'closed':'connected';
    const rows=draw('mpEnd',s,g,320,180);assertVisible(320,180);assert.equal(rows.length,1);
    assert.ok(drawn.some(r=>r.text==='THE CASTAWAYS'));
    assert.ok(drawn.some(r=>r.text==='ROGUE AGENT'));
    assert.ok(drawn.some(r=>r.text==='HOST LEFT - ROOM CLOSED'));
    assert.ok(!drawn.some(r=>r.text.includes('ANOTHER ROUND')));
    st.key('Enter');
  }
  assert.equal(quits,2);assert.equal(rematches,0);
});
