import { randomInt } from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { createRoom, authorizeAction, applyAction, projectRoom, projectHands } from './lib/room-engine.mjs';
import { generateAI } from './ai.mjs';

initializeApp();
const db=getFirestore();
const appId=process.env.GAME_APP_ID||'undercover-party-app';
const rng=()=>randomInt(0,0x1000000)/0x1000000;

function writeRoom(tx,ref,before,after) {
  tx.set(ref.collection('server').doc('state'),after);
  tx.set(ref,projectRoom(after));
  const hands=projectHands(after);
  for(const [uid,hand] of Object.entries(hands))tx.set(ref.collection('hands').doc(uid),hand);
  for(const p of before?.players||[])if(!p.isSimulated&&!Object.hasOwn(hands,p.id))tx.delete(ref.collection('hands').doc(p.id));
}

export const roomAction=onCall({
  region:'us-central1',enforceAppCheck:process.env.FUNCTIONS_EMULATOR!=='true',
  timeoutSeconds:60,memory:'256MiB',maxInstances:2
},async request=>{
  if(!request.auth?.uid)throw new HttpsError('unauthenticated','请先连接联机服务。');
  const uid=request.auth.uid,data=request.data;
  if(!data||typeof data!=='object'||data.appId!==appId||typeof data.type!=='string')throw new HttpsError('invalid-argument','游戏请求格式无效。');
  if(JSON.stringify(data).length>2048)throw new HttpsError('invalid-argument','请求内容过长。');
  const now=Date.now();
  const quotaRef=db.collection('gameLimits').doc(uid);
  // Limits are server-side and do not trust client clocks or client-supplied IDs.
  await db.runTransaction(async tx=>{
    const snap=await tx.get(quotaRef);const q=snap.data()||{};
    const recent=(q.calls||[]).filter(t=>now-t<10000);
    if(recent.length>=30)throw new HttpsError('resource-exhausted','操作太快，请稍等几秒。');
    const creates=(q.creates||[]).filter(t=>now-t<3600000);
    if(data.type==='CREATE'&&creates.length>=10)throw new HttpsError('resource-exhausted','创建房间过于频繁，请稍后再试。');
    tx.set(quotaRef,{calls:[...recent,now],creates:data.type==='CREATE'?[...creates,now]:creates});
  });
  try {
    if(data.type==='CREATE') {
      for(let attempt=0;attempt<12;attempt++) {
        const code=String(randomInt(1000,10000));
        const ref=db.collection('games').doc(appId).collection('rooms').doc(code);
        const created=await db.runTransaction(async tx=>{
          const old=await tx.get(ref.collection('server').doc('state'));
          if(old.exists&&old.data().expiresAt>now)return false;
          writeRoom(tx,ref,old.data(),createRoom(uid,code,data,now));return true;
        });
        if(created)return {roomCode:code};
      }
      throw new Error('房号暂时繁忙，请重试。');
    }
    if(typeof data.roomCode!=='string'||!/^\d{4}$/.test(data.roomCode))throw new Error('请输入正确的 4 位数字房间号。');
    const ref=db.collection('games').doc(appId).collection('rooms').doc(data.roomCode);
    const stateRef=ref.collection('server').doc('state');
    let aiOptions={},aiRevision;
    if(data.type==='COMMENT'||data.type==='START'&&data.useAI===true) {
      const state=await db.runTransaction(async tx=>{
        const snap=await tx.get(stateRef);const current=snap.data();
        authorizeAction(current,uid,data,Date.now());
        if(Date.now()-(current.lastAIAt||0)<15000)throw new Error('AI 正在处理或刚刚回复，请稍等片刻。');
        tx.update(stateRef,{lastAIAt:Date.now()});return current;
      });
      aiRevision=state.revision;aiOptions=await generateAI(state,data);
    }
    await db.runTransaction(async tx=>{
      const snap=await tx.get(stateRef);const current=snap.data();
      if(aiRevision!==undefined&&current?.revision!==aiRevision)throw new Error('等待 AI 期间房间状态发生变化，请重新操作。');
      const next=applyAction(current,uid,data,{...aiOptions,now:Date.now(),random:rng});
      writeRoom(tx,ref,current,next);
    });
    return {roomCode:data.roomCode};
  } catch(error) {
    if(error instanceof HttpsError)throw error;
    // Never return raw SDK errors, tokens, state, or generated secret words.
    const message=error instanceof Error&&/[\u3400-\u9fff]/.test(error.message)?error.message:'操作失败，请检查网络并重试。';
    throw new HttpsError('failed-precondition',message);
  }
});
