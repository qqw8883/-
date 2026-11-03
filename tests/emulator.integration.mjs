import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInAnonymously } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, doc, getDocFromServer, getDocs, collection, setDoc, terminate, onSnapshot } from 'firebase/firestore';
// Exercise the real handler in-process. Cloud transport/App Check is checked
// after deployment; Auth and Firestore below are real local emulators.
import { roomAction } from '../functions/index.mjs';

const appId='undercover-party-app',projectId='demo-undercover';
const clients=[];
async function phone(name) {
  const app=initializeApp({apiKey:'demo-key',projectId,appId:`demo-${name}`,authDomain:`${projectId}.firebaseapp.com`},name);
  const auth=getAuth(app);connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});
  const db=getFirestore(app);connectFirestoreEmulator(db,'127.0.0.1',8080);
  const user=(await signInAnonymously(auth)).user;
  const c={app,db,uid:user.uid,call:async data=>roomAction.run({data:{appId,...data},auth:{uid:user.uid,token:{}}})};
  clients.push(c);return c;
}
const roomRef=(c,code)=>doc(c.db,'games',appId,'rooms',code);
const read=async(c,code)=>(await getDocFromServer(roomRef(c,code))).data();
const denied=async operation=>assert.rejects(operation,e=>e.code==='permission-denied'||e.code==='failed-precondition');
function waitFor(ref,predicate) {
  return new Promise((resolve,reject)=>{
    let unsubscribe;
    const timeout=setTimeout(()=>{unsubscribe?.();reject(new Error('Realtime snapshot timed out'));},15000);
    unsubscribe=onSnapshot(ref,snap=>{if(snap.exists()&&predicate(snap.data())){clearTimeout(timeout);unsubscribe();resolve(snap.data());}},err=>{clearTimeout(timeout);reject(err);});
  });
}

test('real backend handler, Firebase Auth and Firestore security rules', {timeout:180000}, async t=>{
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST,'Run through npm run test:emulator; never against production.');
  const [host,a,b,c,outside]=await Promise.all(['host','a','b','c','outsider'].map(phone));
  let code,r,sim;
  const action=(client,type,args={})=>client.call({type,roomCode:code,phaseId:r.phaseId,...args});
  try {
    await t.test('four authenticated phones join concurrently without losing members',async()=>{
      code=(await host.call({type:'CREATE',name:'房主',avatar:'🦊'})).roomCode;
      const observed=waitFor(roomRef(host,code),room=>room.players.length===4);
      await Promise.all([a,b,c].map((p,i)=>p.call({type:'JOIN',roomCode:code,name:`玩家${i}`,avatar:'🐼'})));
      r=await observed;assert.equal(new Set(r.memberIds).size,4);
    });
    await t.test('outsiders cannot read or list rooms; guests cannot forge host settings',async()=>{
      await denied(()=>getDocFromServer(roomRef(outside,code)));
      await denied(()=>getDocs(collection(host.db,'games',appId,'rooms')));
      await denied(()=>action(a,'SETTING',{key:'undercoverCount',value:3}));
      await denied(()=>setDoc(roomRef(a,code),{hostId:a.uid},{merge:true}));
      await denied(()=>getDocFromServer(doc(roomRef(host,code),'server','state')));
    });
    await t.test('host sees same-screen supplement but cannot read another phone’s card',async()=>{
      await action(host,'ADD_LOCAL');r=await read(host,code);sim=r.players.find(p=>p.isSimulated).id;
      await action(host,'START');r=await read(host,code);
      assert.equal(r.status,'DEALING');assert.equal(r.wordPair.civilian,undefined);assert.ok(r.players.every(p=>p.word===null&&p.role===null));
      const hand=(await getDocFromServer(doc(roomRef(host,code),'hands',host.uid))).data();
      assert.deepEqual(new Set(Object.keys(hand.words)),new Set([host.uid,sim]));
      await denied(()=>getDocFromServer(doc(roomRef(host,code),'hands',a.uid)));
      await denied(()=>getDocFromServer(doc(roomRef(a,code),'hands',host.uid)));
      await denied(()=>setDoc(doc(roomRef(a,code),'hands',a.uid),{words:{[a.uid]:'作弊'}}));
      await denied(()=>action(host,'READY',{playerId:a.uid}));
    });
    await t.test('parallel confirmations and secret votes complete one round without dropped writes',async()=>{
      await Promise.all([host,a,b,c].map(p=>action(p,'READY',{playerId:p.uid})));
      r=await read(host,code);assert.equal(r.status,'SPEAKING');
      for(const id of r.speakingOrder){await action([host,a,b,c].find(p=>p.uid===id)||host,'FINISH',{speakerId:id,keyword:'现场描述'});r=await read(host,code);}
      assert.equal(r.status,'VOTING');
      await action(a,'VOTE',{playerId:a.uid,targetId:'ABSTAIN'});
      r=await read(host,code);assert.deepEqual(r.votes,{[a.uid]:true});
      await denied(()=>action(host,'VOTE',{playerId:a.uid,targetId:b.uid}));
      await Promise.all([host,b,c].map(p=>action(p,'VOTE',{playerId:p.uid,targetId:'ABSTAIN'})));
      await action(host,'VOTE',{playerId:sim,targetId:'ABSTAIN'});
      r=await read(host,code);assert.equal(r.status,'RESULT');assert.equal(r.lastEliminated.type,'NONE');assert.equal(Object.keys(r.votes).length,5);
    });
    await t.test('game runs to a winner and reveals all cards only at the end',async()=>{
      const byId=Object.fromEntries([host,a,b,c].map(p=>[p.uid,p]));
      for(let round=0;round<5&&r.status!=='GAME_OVER';round++) {
        await action(host,'SPEAK');r=await read(host,code);
        for(const id of r.speakingOrder){await action(byId[id]||host,'FINISH',{speakerId:id});r=await read(host,code);}
        const alive=r.players.filter(p=>p.isAlive),target=alive[0].id;
        for(const p of alive){await action(byId[p.id]||host,'VOTE',{playerId:p.id,targetId:p.id===target?'ABSTAIN':target});}
        r=await read(host,code);
        if(r.status!=='GAME_OVER'){assert.equal(r.status,'RESULT');assert.equal(r.wordPair.civilian,undefined);assert.equal(r.lastEliminated.player.word,null);}
      }
      assert.equal(r.status,'GAME_OVER');assert.ok(r.wordPair.civilian);assert.ok(r.players.every(p=>p.word&&p.role));
    });
    await t.test('return to lobby clears cards and removing a player revokes access',async()=>{
      await action(host,'LOBBY');r=await read(host,code);assert.equal(r.status,'LOBBY');
      const hand=(await getDocFromServer(doc(roomRef(a,code),'hands',a.uid))).data();assert.equal(hand.words[a.uid],null);
      await action(host,'REMOVE_PLAYER',{playerId:a.uid});r=await read(host,code);
      await denied(()=>getDocFromServer(roomRef(a,code)));
      await denied(()=>getDocFromServer(doc(roomRef(a,code),'hands',a.uid)));
    });
    await t.test('missing AI configuration fails explicitly and leaves the lobby intact',async()=>{
      await assert.rejects(()=>action(host,'START',{useAI:true,theme:'美食'}),e=>/AI 服务尚未接通/.test(e.message));
      assert.equal((await read(host,code)).status,'LOBBY');
    });
  } finally {
    await Promise.all(clients.map(async p=>{await terminate(p.db);await deleteApp(p.app);}));
  }
});
