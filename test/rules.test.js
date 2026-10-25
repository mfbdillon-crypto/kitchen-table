require('../site/cards.js'); require('../site/rules.js'); const R = globalThis.Rules; const assert = require('assert');
const s = R.newState(); const ok = (pid,a)=>{const r=R.apply(s,pid,a); if(!r.ok) throw new Error(a.type+': '+r.err); return r;};
const bad = (pid,a)=>{const r=R.apply(s,pid,a); assert(!r.ok, a.type+' should fail'); return r.err;};
const D=(n,t,extra)=>({n,faces:[Object.assign({n,t,img:'https://cards.scryfall.io/x.jpg',p:'',tg:''},extra||{})]});
ok('A',{type:'join',name:'Marissa'}); ok('B',{type:'join',name:'Alex'});
ok('A',{type:'enter',zone:'battlefield',cards:[{id:'A-1',d:D('Grizzly Bears','Creature — Bear',{p:'2',tg:'2'})},{id:'A-2',d:D('Forest','Basic Land — Forest')},{id:'A-3',d:D('Rancor','Enchantment — Aura')},{id:'A-4',d:D('Jace','Legendary Planeswalker — Jace',{loy:'3'})}],msg:'played {cards}'});
assert.equal(s.cards['A-1'].row,'creatures'); assert.equal(s.cards['A-2'].row,'lands'); assert.equal(s.cards['A-3'].row,'other');
assert.equal(s.cards['A-4'].counters.loyalty,3);
bad('B',{type:'tap',ids:['A-1'],tapped:true});
ok('A',{type:'tap',ids:['A-1'],tapped:true});
ok('A',{type:'counter',id:'A-1',kind:'+1/+1',delta:3}); ok('A',{type:'counter',id:'A-1',kind:'-1/-1',delta:1});
assert.deepEqual(s.cards['A-1'].counters,{'+1/+1':2}); assert.deepEqual(R.ptOf(s.cards['A-1']),[4,4]);
ok('A',{type:'attach',id:'A-3',to:'A-1'});
ok('A',{type:'control',ids:['A-1'],to:'B'}); assert.equal(s.cards['A-1'].ctrl,'B'); assert.equal(s.cards['A-1'].owner,'A');
bad('A',{type:'tap',ids:['A-1'],tapped:false});
ok('B',{type:'move',ids:['A-1'],to:'graveyard'});
const c1=s.cards['A-1']; assert.equal(c1.zone,'graveyard'); assert.equal(c1.ctrl,'A'); assert.deepEqual(c1.counters,{}); assert.equal(c1.tapped,false);
assert.equal(s.cards['A-3'].zone,'graveyard','aura falls off');
ok('A',{type:'move',ids:['A-1'],to:'hand'}); assert(!s.cards['A-1']); assert.equal(s.inbox.A[0].card.id,'A-1');
ok('A',{type:'inboxAck',ids:['A-1']}); assert.equal(s.inbox.A.length,0);
ok('B',{type:'token',d:D('Treasure','Token Artifact — Treasure'),count:2});
const tok=Object.values(s.cards).filter(c=>c.token); assert.equal(tok.length,2);
ok('B',{type:'move',ids:[tok[0].id],to:'graveyard'}); assert(s.cards[tok[0].id].zone === 'ghost' && s.cards[tok[0].id].ghostZone === 'graveyard','token shows in the graveyard for a moment'); s.cards[tok[0].id].ghostAt = 0; R.fixUp(s); assert(!s.cards[tok[0].id],'token ceased');
ok('A',{type:'enter',zone:'command',cards:[{id:'A-9',cmdr:true,d:D('Alesha','Legendary Creature',{p:'3',tg:'2'})}]});
ok('A',{type:'move',ids:['A-9'],to:'battlefield'}); assert.equal(s.tax['A-9']||0,0,'no tax when put onto battlefield'); ok('A',{type:'move',ids:['A-9'],to:'command'}); ok('A',{type:'move',ids:['A-9'],to:'stack'}); assert.equal(s.tax['A-9'],1,'tax when cast');
assert.equal(s.prio.holder,'B','B gets priority'); bad('A',{type:'phase'}); ok('B',{type:'pass'}); assert.equal(s.cards['A-9'].zone,'battlefield','resolved after everyone passed'); assert(!s.prio);
ok('A',{type:'start'}); const first=s.turn.active; ok(first,{type:'phase'}); 
bad(first==='A'?'B':'A',{type:'phase'});
ok('A',{type:'tap',ids:['A-2'],tapped:true});
// pass until A's turn
for(let i=0;i<3 && !(s.turn.active==='A'&&s.turn.n>1);i++) ok(s.turn.active,{type:'phase',dir:'pass'});
assert.equal(s.cards['A-2'].tapped,false,'untap step');
ok('B',{type:'player',patch:{cmdDmg:{'A-9':21}}}); assert(s.log.some(l=>l.k==='alert'));
ok('A',{type:'enter',zone:'battlefield',cards:[{id:'A-5',faceDown:true,d:D('Secret','Creature',{p:'5',tg:'5'})}]});
assert.equal(s.cards['A-5'].d,null); assert.equal(R.cardName(s.cards['A-5']),'a face-down card'); assert(!JSON.stringify(s.log).includes('Secret'));
ok('A',{type:'move',ids:['A-5'],to:'exile'}); assert(s.cards['A-5'].needsId);
for(let i=0;i<4;i++) ok('X'+i,{type:'join',name:'x'}); bad('X9',{type:'join',name:'x'}); 
console.log('rules ok', s.log.length, 'log lines; last:', s.log.slice(-3).map(l=>l.text));
// --- state-based actions ---
{
  const s2 = R.newState(); const ok2=(pid,a)=>{const r=R.apply(s2,pid,a); if(!r.ok) throw new Error(a.type+': '+r.err);};
  ok2('A',{type:'join',name:'A'});
  ok2('A',{type:'enter',zone:'battlefield',cards:[{id:'c1',d:D('Bear','Creature — Bear',{p:'2',tg:'2'})},{id:'p1',d:D('Jace','Legendary Planeswalker — Jace',{loy:'2'})},{id:'l1',d:D('Isamaru','Legendary Creature — Dog',{p:'2',tg:'2'})},{id:'l2',d:D('Isamaru','Legendary Creature — Dog',{p:'2',tg:'2'})}]});
  assert(s2.log.some(l=>/legend rule/.test(l.text)),'legend rule alert');
  ok2('A',{type:'counter',id:'c1',kind:'-1/-1',delta:2}); assert.equal(s2.cards.c1.zone,'battlefield'); assert(s2.cards.c1.zeroT,'0 toughness flagged');
  ok2('A',{type:'counter',id:'p1',kind:'loyalty',delta:-2}); assert.equal(s2.cards.p1.zone,'graveyard','0 loyalty dies');
  ok2('A',{type:'enter',zone:'command',cards:[{id:'k1',cmdr:true,d:D('K1','Legendary Creature',{p:'1',tg:'1'})},{id:'k2',cmdr:true,d:D('K2','Legendary Creature',{p:'1',tg:'1'})}]});
  assert(!R.apply(s2,'A',{type:'enter',zone:'command',cards:[{id:'k3',cmdr:true,d:D('K3','Legendary Creature')}]}).ok,'max 2 commanders');
  ok2('A',{type:'newGame',rematch:true}); assert(s2.rematch && s2.turn.active==='A');
  console.log('sba ok');
}

{
  const s3 = R.newState(); const ok3=(pid,a)=>{const r=R.apply(s3,pid,a); if(!r.ok) throw new Error(a.type+': '+r.err); return r;};
  ok3('A',{type:'join',name:'A'}); ok3('B',{type:'join',name:'B'}); ok3('C',{type:'join',name:'C'});
  const dfc={n:'Delver',faces:[{n:'Delver',t:'Creature',img:'https://cards.scryfall.io/a.jpg',p:'1',tg:'1'},{n:'Insect',t:'Creature',img:'https://cards.scryfall.io/b.jpg',p:'3',tg:'2'}]};
  ok3('A',{type:'enter',zone:'battlefield',cards:[{id:'d1',d:dfc}]}); ok3('A',{type:'flip',id:'d1'}); assert.equal(R.cardName(s3.cards.d1),'Insect');
  ok3('A',{type:'move',ids:['d1'],to:'graveyard'}); assert.equal(s3.cards.d1.face,0,'front face in graveyard');
  ok3('A',{type:'enter',zone:'exile',cards:[{id:'f1',faceDown:true,d:D('Secret','Instant')}]}); assert(s3.cards.f1.faceDown && !s3.cards.f1.d);
  ok3('A',{type:'move',ids:['f1'],to:'stack'}); assert(!s3.cards.f1.faceDown && s3.cards.f1.needsId,'revealed when cast from face-down exile');
  ok3('A',{type:'move',ids:['f1'],to:'graveyard'}); assert(!s3.prio,'stack empty clears priority');
  ok3('A',{type:'enter',zone:'battlefield',cards:[{id:'s1',d:D('Stunned','Creature',{p:'2',tg:'2'})}]}); ok3('A',{type:'tap',ids:['s1'],tapped:true}); ok3('A',{type:'counter',id:'s1',kind:'stun',delta:1});
  ok3('A',{type:'start'}); s3.turn.active = 'C'; ok3('C',{type:'phase',dir:'pass'}); // passes to next seat after C
  const at = s3.turn.active; if (at==='A') { assert(s3.cards.s1.tapped && !s3.cards.s1.counters.stun,'stun removed instead of untap'); }
  ok3('B',{type:'enter',zone:'graveyard',cards:[{id:'g1',d:D('Big','Creature',{p:'5',tg:'5'})}]});
  s3.dev = true; s3.hostPid = 'A'; ok3('A',{type:'move',ids:['g1'],to:'battlefield',dev:true}); s3.dev = false; assert.equal(s3.cards.g1.ctrl,'A'); assert.equal(s3.cards.g1.owner,'B');
  ok3('C',{type:'take',ids:['g1']}); assert.equal(s3.cards.g1.ctrl,'C');
  ok3('C',{type:'enter',zone:'battlefield',cards:[{id:'au',d:D('Pacifism','Enchantment — Aura')}]}); ok3('C',{type:'attach',id:'au',to:'s1'});
  ok3('A',{type:'table',key:'monarch',value:'A'});
  ok3('A',{type:'leave'}); assert.equal(s3.cards.au.zone,'graveyard','aura falls off when host owner leaves'); assert(s3.table.monarch && s3.table.monarch!=='A','monarch passes on');
  assert(!R.apply(s3,'B',{type:'removeToken',ids:['g1']}).ok,'removeToken on non-token errors');
  console.log('review fixes ok');
}
