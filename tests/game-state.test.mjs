import test from 'node:test';
import assert from 'node:assert/strict';
import { speakingPatch, readyPatch, votePatch, tallyPatch, speakingNextPatch } from '../src/game-state.mjs';
import { parseRuntimeConfig, validateWordPair } from '../src/config.mjs';

function room() {
  return {status:'DEALING',round:1,hostId:'p1',votes:{},pkPlayers:[],settings:{speakTime:30},players:[1,2,3,4].map(i=>({id:`p${i}`,name:`玩家${i}`,seat:i,role:i===4?'UNDERCOVER':'CIVILIAN',isAlive:true,isSimulated:false,hasReadySeenCard:false,notes:[]}))};
}
const apply=(state,patch)=>({...state,...patch});

test('missing or malformed config is an explicit error, not a mock online room',()=>{
  assert.match(parseRuntimeConfig({}).error,/尚未配置/);
  assert.match(parseRuntimeConfig({__firebase_config:'{oops'}).error,/格式有误/);
  const c=parseRuntimeConfig({UNDERCOVER_CONFIG:{firebase:{apiKey:'public',appId:'web-app',projectId:'project',authDomain:'project.firebaseapp.com'}}});
  assert.equal(c.error,'');assert.equal(c.ai.enabled,false);
});
test('AI responses require two distinct words and cannot disclose either in the opening',()=>{
  const pair={civilianWord:'火锅',undercoverWord:'麻辣烫',subtleHint:'适合热着吃',openingJoke:'底牌来了，请看好！'};
  assert.equal(validateWordPair(pair).civilianWord,'火锅');
  assert.throws(()=>validateWordPair({...pair,undercoverWord:'火锅'}));
  assert.throws(()=>validateWordPair({...pair,openingJoke:'本轮词是火锅'}));
  assert.throws(()=>validateWordPair({civilianWord:'火锅'}));
});
test('real players each confirm before the speaking round can start',()=>{
  let r=room();for(const id of ['p1','p2','p3'])r=apply(r,readyPatch(r,id,()=>0,100));
  assert.equal(r.status,'DEALING');r=apply(r,readyPatch(r,'p4',()=>0,100));
  assert.equal(r.status,'SPEAKING');assert.equal(r.speakingOrder.length,4);assert.equal(r.turnStartedAt,100);
});
test('original same-screen simulation still allows its ready status',()=>{
  const r=room();r.players.slice(1).forEach(p=>{p.isSimulated=true;p.hasReadySeenCard=true;});
  assert.equal(readyPatch(r,'p1').status,'SPEAKING');
});
test('fresh vote patches retain all earlier voters and resolve only on the last vote',()=>{
  let r={...room(),status:'VOTING'};
  for(const id of ['p1','p2','p3']){r=apply(r,votePatch(r,id,'p4'));assert.equal(r.status,'VOTING');}
  r=apply(r,votePatch(r,'p4','ABSTAIN'));
  assert.equal(Object.keys(r.votes).length,4);assert.equal(r.status,'GAME_OVER');assert.equal(r.winner,'CIVILIAN');
});
test('self votes, dead targets and out-of-phase votes are rejected',()=>{
  let r={...room(),status:'VOTING'};
  assert.throws(()=>votePatch(r,'p1','p1'));assert.throws(()=>votePatch(r,'p1','unknown'));
  r.players[1].isAlive=false;assert.throws(()=>votePatch(r,'p1','p2'));
  assert.throws(()=>votePatch({...r,status:'SPEAKING'},'p1','p3'));
});
test('ties go to PK, restrict targets, and a second tie is safe',()=>{
  let r={...room(),status:'VOTING'};const votes={p1:'p2',p2:'p1',p3:'p2',p4:'p1'};
  r=apply(r,tallyPatch(r,votes,()=>0,100));assert.equal(r.status,'SPEAKING');assert.deepEqual(new Set(r.pkPlayers),new Set(['p1','p2']));
  r.status='VOTING';assert.throws(()=>votePatch(r,'p1','p3'));
  r=apply(r,tallyPatch(r,votes));assert.equal(r.status,'RESULT');assert.equal(r.lastEliminated.type,'TIE_SAFE');
});
test('all abstentions preserve every player',()=>{
  const r={...room(),status:'VOTING'};const patch=tallyPatch(r,{p1:'ABSTAIN',p2:'ABSTAIN',p3:'ABSTAIN',p4:'ABSTAIN'});
  assert.equal(patch.status,'RESULT');assert.equal(patch.lastEliminated.type,'NONE');
});
test('host early tally can resolve a partially voted round',()=>{
  const patch=tallyPatch({...room(),status:'VOTING'},{p1:'p4'});
  assert.equal(patch.winner,'CIVILIAN');assert.equal(patch.lastEliminated.votesCount,1);
});
test('undercover wins parity and the eliminated player remains public in results',()=>{
  const r={...room(),status:'VOTING'};r.players[0].isAlive=false;
  const patch=tallyPatch(r,{p2:'p3',p3:'p2',p4:'p3'});
  assert.equal(patch.winner,'UNDERCOVER');assert.equal(patch.lastEliminated.player.id,'p3');
});
test('speaker notes and deadline advance once, stale double clicks are rejected',()=>{
  let r=room();r=apply(r,speakingPatch(r,r.players,1,[],()=>0,100));
  r=apply(r,speakingNextPatch(r,'p1','早餐',5000));
  assert.equal(r.currentSpeakerId,'p2');assert.equal(r.turnStartedAt,5000);assert.equal(r.players[0].notes[0],'R1: 早餐');
  assert.throws(()=>speakingNextPatch(r,'p1','重复',6000));
  for(const id of ['p2','p3','p4'])r=apply(r,speakingNextPatch(r,id));
  assert.equal(r.status,'VOTING');assert.deepEqual(r.votes,{});
});
