import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoom, applyAction, projectRoom, projectHands } from '../functions/lib/room-engine.mjs';
import { mergeRoomView } from '../src/room-view.mjs';

const now=1000000;
const options={now,random:()=>0.1};
const act=(r,uid,type,args={},extra={})=>applyAction(r,uid,{type,phaseId:r.phaseId,...args},{...options,...extra});
function lobby(count=4) {
  let r=createRoom('p1','1234',{name:'房主',avatar:'🦊'},now);
  for(let i=2;i<=count;i++)r=act(r,`p${i}`,'JOIN',{name:`玩家${i}`,avatar:'🐼'});
  return r;
}
function dealing(count=4){return act(lobby(count),'p1','START');}
function voting(r=dealing()) {
  r=act(r,'p1','SPEAK');
  for(const id of r.speakingOrder)r=act(r,id,'FINISH',{speakerId:id,keyword:'发言'});
  return r;
}

test('complete original multiplayer flow: separate joins, secret cards, votes, win and restart',()=>{
  let r=dealing();
  assert.equal(r.status,'DEALING');
  for(const p of r.players)r=act(r,p.id,'READY',{playerId:p.id});
  assert.equal(r.status,'SPEAKING');
  for(const id of r.speakingOrder)r=act(r,id,'FINISH',{speakerId:id,keyword:'早餐'});
  const spy=r.players.find(p=>p.role==='UNDERCOVER').id;
  for(const p of r.players)r=act(r,p.id,'VOTE',{playerId:p.id,targetId:p.id===spy?'ABSTAIN':spy});
  assert.equal(r.status,'GAME_OVER');assert.equal(r.winner,'CIVILIAN');
  const result=projectRoom(r);assert.ok(result.wordPair.civilian);assert.ok(result.players.every(p=>p.role&&p.word));
  r=act(r,'p1','START');assert.equal(r.status,'DEALING');assert.equal(r.dealId,2);assert.ok(r.players.every(p=>p.isAlive));
});

test('public state never carries unrevealed words, identities, vote targets or unknown server fields',()=>{
  let r=voting();r.secretMarker='private';
  r=act(r,'p1','VOTE',{playerId:'p1',targetId:'p2'});
  const view=projectRoom(r),serialized=JSON.stringify(view);
  for(const word of [r.wordPair.civilian,r.wordPair.undercover])assert.ok(!serialized.includes(`"${word}"`));
  assert.equal(view.wordPair.civilian,undefined);assert.equal(view.players[0].role,null);
  assert.deepEqual(view.votes,{p1:true});assert.equal(view.secretMarker,undefined);
  const hands=projectHands(r);
  assert.deepEqual(Object.keys(hands.p1.words),['p1']);assert.deepEqual(hands.p1.votes,{p1:'p2'});
  assert.deepEqual(hands.p2.votes,{});assert.equal(hands.p1.role,undefined);
});

test('even the host only receives their own and same-screen cards, never other phones',()=>{
  let r=lobby();r=act(r,'p1','ADD_LOCAL');r=act(r,'p1','START');
  const sim=r.players.find(p=>p.isSimulated),hands=projectHands(r);
  assert.deepEqual(Object.keys(hands.p1.words),['p1',sim.id]);
  assert.deepEqual(Object.keys(hands.p2.words),['p2']);
  assert.equal(hands[sim.id],undefined);
  assert.throws(()=>act(r,'p2','READY',{playerId:sim.id}),/只能操作/);
  assert.throws(()=>act(r,'p1','READY',{playerId:'p2'}),/只能操作/);
});

test('server rejects outsiders, forged host controls and another player vote',()=>{
  let r=voting();
  assert.throws(()=>act(r,'outsider','VOTE',{playerId:'p1',targetId:'p2'}),/尚未加入/);
  assert.throws(()=>act(r,'p2','TALLY'),/只有房主/);
  assert.throws(()=>act(r,'p2','LOBBY'),/只有房主/);
  assert.throws(()=>act(r,'p1','VOTE',{playerId:'p2',targetId:'p3'}),/只能操作/);
  assert.throws(()=>act(lobby(),'p2','SETTING',{key:'category',value:'party'}),/只有房主/);
});

test('stale actions cannot run after a phase change or in the next deal',()=>{
  let r=dealing();const phase=r.phaseId;r=act(r,'p1','SPEAK');
  assert.throws(()=>act(r,'p1','READY',{playerId:'p1',phaseId:phase}),/阶段已变化/);
  r=act(r,'p1','LOBBY');r=act(r,'p1','START');
  assert.throws(()=>act(r,'p1','READY',{playerId:'p1',phaseId:phase}),/阶段已变化/);
});

test('settings, room capacity, player removal and AI input are validated on the server',()=>{
  let r=lobby(12);
  assert.throws(()=>act(r,'p1','ADD_LOCAL'),/房间已满/);
  assert.throws(()=>act(r,'p13','JOIN',{name:'满员',avatar:'🦊'}),/房间已满/);
  assert.throws(()=>act(r,'p1','SETTING',{key:'hostId',value:'p2'}),/无效/);
  assert.throws(()=>act(r,'p1','SETTING',{key:'undercoverCount',value:99}),/无效/);
  r=act(r,'p1','REMOVE_PLAYER',{playerId:'p2'});assert.equal(r.players.length,11);
  assert.ok(!projectRoom(r).memberIds.includes('p2'));assert.equal(projectHands(r).p2,undefined);
  assert.throws(()=>act(r,'p1','START',{useAI:true},{aiPair:{civilianWord:'火锅'}}),/不完整/);
});

test('five players with whiteboard never start at undercover parity',()=>{
  let r=lobby(5);r=act(r,'p1','SETTING',{key:'undercoverCount',value:3});r=act(r,'p1','SETTING',{key:'hasBlank',value:true});r=act(r,'p1','START');
  assert.equal(r.players.filter(p=>p.role==='CIVILIAN').length,3);
  assert.equal(r.players.filter(p=>p.role==='BLANK').length,1);
});

test('elimination reveals only the public role; words stay hidden until game over',()=>{
  let r=voting(dealing(6));const civilian=r.players.find(p=>p.role==='CIVILIAN').id;
  const voter=r.players.find(p=>p.id!==civilian).id;
  r=act(r,voter,'VOTE',{playerId:voter,targetId:civilian});r=act(r,'p1','TALLY');
  assert.equal(r.status,'RESULT');const view=projectRoom(r);
  assert.equal(view.lastEliminated.player.word,null);assert.equal(view.lastEliminated.player.role,'CIVILIAN');
  assert.equal(view.wordPair.civilian,undefined);
});

test('private/public snapshots from different deals or phases never mix old cards or votes',()=>{
  let r=voting();r=act(r,'p1','VOTE',{playerId:'p1',targetId:'p2'});
  const oldHand=projectHands(r).p1;
  const view=mergeRoomView(projectRoom(r),oldHand);assert.equal(view.votes.p1,'p2');assert.ok(view.players[0].word);
  r=act(r,'p1','LOBBY');r=act(r,'p1','START');
  const next=mergeRoomView(projectRoom(r),oldHand);assert.equal(next.players[0].word,null);assert.deepEqual(next.votes,{});
});

test('AI words and commentary are validated without returning answers to the requesting host',()=>{
  const pair={civilianWord:'火锅',undercoverWord:'麻辣烫',subtleHint:'热乎乎的晚餐',openingJoke:'请各位查看底牌！'};
  let r=act(lobby(),'p1','START',{useAI:true},{aiPair:pair});
  assert.equal(projectRoom(r).wordPair.source,'✨ AI 裁判实时命题');
  assert.equal(projectRoom(r).wordPair.civilian,undefined);
  assert.throws(()=>act(r,'p1','COMMENT',{}, {aiComment:'答案是火锅'}),/已隐藏/);
  r=act(r,'p1','COMMENT',{}, {aiComment:'谁的描述最可疑？'});assert.equal(r.aiReferee.message,'谁的描述最可疑？');
});

test('expired rooms reject actions and duplicate join does not duplicate a member',()=>{
  let r=lobby();const again=act(r,'p2','JOIN',{name:'改名',avatar:'🐸'});assert.equal(again.players.length,4);
  assert.throws(()=>act(r,'p1','START',{}, {now:r.expiresAt+1}),/已过期/);
});
