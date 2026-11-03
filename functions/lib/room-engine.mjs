import { speakingPatch, readyPatch, votePatch, tallyPatch, speakingNextPatch } from './game-state.mjs';
import { WORD_LIBRARY, AVATARS } from './words.mjs';
import { validateWordPair } from './validation.mjs';

const hostActions = new Set(['ADD_LOCAL','REMOVE_PLAYER','SETTING','START','SPEAK','AUTO_VOTE','TALLY','LOBBY','COMMENT']);
const phaseActions = new Set(['START','READY','SPEAK','FINISH','VOTE','AUTO_VOTE','TALLY','LOBBY','COMMENT']);
function requireValue(ok, message) { if (!ok) throw new Error(message); }
function player(id, name, avatar, seat, simulated=false) {
  requireValue(typeof name==='string' && name.trim().length>0 && name.trim().length<=20, '昵称请填写 1—20 个字。');
  return {id,name:name.trim(),avatar:AVATARS.includes(avatar)?avatar:AVATARS[0],seat,isSimulated:simulated,role:null,word:null,isAlive:true,hasReadySeenCard:false,notes:[]};
}
export function createRoom(uid, code, data, now=Date.now()) {
  return {
    roomCode:code,hostId:uid,status:'LOBBY',round:1,revision:1,phaseId:1,dealId:0,
    settings:{undercoverCount:1,hasBlank:false,category:'daily',speakTime:30,aiStyle:'幽默毒舌'},
    wordPair:{civilian:'',undercover:'',hint:'',source:''},players:[player(uid,data.name,data.avatar,1)],
    speakingOrder:[],currentSpeakerId:null,pkPlayers:[],votes:{},lastEliminated:null,winner:null,
    aiReferee:{message:`欢迎来到 ${code} 号聚会房间！大家在各自手机输入房号落座，凑齐 4 人就能发牌！`,mood:'welcome',timestamp:now},
    updatedAt:now,expiresAt:now+24*60*60*1000
  };
}

export function authorizeAction(room, uid, data, now=Date.now()) {
  requireValue(room && room.expiresAt>now, '房间不存在或已过期，请重新创建。');
  if (data.type==='JOIN') return;
  requireValue(room.players.some(p=>p.id===uid&&!p.isSimulated), '你尚未加入这个房间。');
  if(hostActions.has(data.type)) requireValue(room.hostId===uid,'只有房主可以执行这个操作。');
  if(phaseActions.has(data.type)) requireValue(data.phaseId===room.phaseId,'游戏阶段已变化，请根据最新画面重新操作。');
  if(data.type==='START') requireValue(['LOBBY','GAME_OVER'].includes(room.status)&&room.players.length>=4,'需要在准备阶段凑齐至少 4 人后发牌。');
  if(data.type==='COMMENT') requireValue(['DEALING','SPEAKING','VOTING','RESULT'].includes(room.status),'请在本局游戏中请求点评。');
}

export function applyAction(room, uid, data, options={}) {
  const now=options.now??Date.now(), random=options.random??Math.random;
  authorizeAction(room,uid,data,now);
  const r=structuredClone(room);
  const control=id=>requireValue(id===uid || uid===r.hostId && r.players.some(p=>p.id===id&&p.isSimulated),'只能操作自己或本机同屏玩家。');
  const lobby=()=>requireValue(r.status==='LOBBY','只能在准备阶段调整玩家和规则。');
  let patch={};
  switch(data.type) {
    case 'JOIN': {
      if(r.players.some(p=>p.id===uid)) return r;
      lobby();requireValue(r.players.length<12,'房间已满，最多 12 人。');
      const p=player(uid,data.name,data.avatar,r.players.length+1);
      patch={players:[...r.players,p],aiReferee:{message:`欢迎 ${p.seat} 号玩家【${p.name}】落座！`,mood:'excited',timestamp:now}};
      break;
    }
    case 'ADD_LOCAL': {
      lobby();requireValue(r.players.length<12,'房间已满，最多 12 人。');
      const seat=r.players.length+1;
      const names=['阿强(同屏)','小美(同屏)','卡卡(同屏)','老王(同屏)','萌萌(同屏)','大壮(同屏)','七七(同屏)'];
      const name=names.find(n=>!r.players.some(p=>p.name===n))||`好友${seat}号`;
      const p=player(`sim_${r.revision}_${seat}`,name,AVATARS[seat%AVATARS.length],seat,true);
      patch={players:[...r.players,p],settings:{...r.settings,undercoverCount:seat>=7?2:1}};
      break;
    }
    case 'REMOVE_PLAYER':
      lobby();requireValue(data.playerId!==r.hostId,'房主不能移出自己。');
      patch={players:r.players.filter(p=>p.id!==data.playerId).map((p,i)=>({...p,seat:i+1}))};break;
    case 'SETTING': {
      lobby();const {key,value}=data;
      const valid={undercoverCount:[1,2,3].includes(value),hasBlank:typeof value==='boolean',category:Object.hasOwn(WORD_LIBRARY,value),speakTime:[20,30,45,60].includes(value),aiStyle:['幽默毒舌','悬疑推理','欢乐气氛组'].includes(value)};
      requireValue(Object.hasOwn(valid,key)&&valid[key],'无效的游戏设置。');
      patch={settings:{...r.settings,[key]:value}};break;
    }
    case 'START': {
      let pair,opening;
      if(data.useAI) {
        const a=validateWordPair(options.aiPair);
        pair={civilian:a.civilianWord,undercover:a.undercoverWord,hint:a.subtleHint,source:'✨ AI 裁判实时命题'};
        opening=a.openingJoke;
      } else {
        const cat=WORD_LIBRARY[r.settings.category];const item=cat.pairs[Math.floor(random()*cat.pairs.length)];const flip=random()>.5;
        pair={civilian:flip?item.c:item.u,undercover:flip?item.u:item.c,hint:item.hint,source:cat.name};
        opening='底牌已秘密派发到各位手机！请长按屏幕偷看自己的词，注意表情管理，别第一秒就笑场暴露咯！';
      }
      const total=r.players.length, blank=r.settings.hasBlank&&total>=5?1:0;
      const undercover=Math.max(1,Math.min(r.settings.undercoverCount,Math.floor((total-1)/2)-blank));
      const roles=[...Array(total-undercover-blank).fill('CIVILIAN'),...Array(undercover).fill('UNDERCOVER'),...Array(blank).fill('BLANK')];
      for(let i=roles.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[roles[i],roles[j]]=[roles[j],roles[i]];}
      const players=r.players.map((p,i)=>({...p,role:roles[i],word:roles[i]==='BLANK'?'【白板（无词，靠演技盲猜）】':roles[i]==='UNDERCOVER'?pair.undercover:pair.civilian,isAlive:true,hasReadySeenCard:p.isSimulated,notes:[]}));
      patch={status:'DEALING',round:1,dealId:r.dealId+1,wordPair:pair,players,speakingOrder:[],currentSpeakerId:null,pkPlayers:[],votes:{},lastEliminated:null,winner:null,aiReferee:{message:opening,mood:'mystery',timestamp:now}};break;
    }
    case 'READY':control(data.playerId);patch=readyPatch(r,data.playerId,random,now);break;
    case 'SPEAK':
      requireValue(['DEALING','RESULT'].includes(r.status),'当前不能开启下一轮发言。');
      patch=speakingPatch(r,r.players,r.status==='DEALING'?1:r.round+1,[],random,now);break;
    case 'FINISH':
      requireValue(uid===r.hostId||uid===r.currentSpeakerId,'请等待当前玩家发言完毕。');
      requireValue(typeof (data.keyword??'')==='string','发言记录格式无效。');
      patch=speakingNextPatch(r,data.speakerId,data.keyword||'',now);break;
    case 'VOTE':control(data.playerId);patch=votePatch(r,data.playerId,data.targetId,random,now);break;
    case 'AUTO_VOTE': {
      requireValue(r.status==='VOTING','当前不是投票阶段。');
      const votes={...r.votes},alive=r.players.filter(p=>p.isAlive),candidates=alive.filter(p=>!r.pkPlayers.length||r.pkPlayers.includes(p.id));
      for(const p of alive)if(p.isSimulated&&votes[p.id]===undefined){const choices=candidates.filter(c=>c.id!==p.id);votes[p.id]=choices.length?choices[Math.floor(random()*choices.length)].id:'ABSTAIN';}
      patch=alive.every(p=>votes[p.id]!==undefined)?tallyPatch(r,votes,random,now):{votes};break;
    }
    case 'TALLY':patch=tallyPatch(r,r.votes,random,now);break;
    case 'LOBBY':
      patch={status:'LOBBY',round:1,dealId:r.dealId+1,wordPair:{civilian:'',undercover:'',hint:'',source:''},players:r.players.map(p=>({...p,role:null,word:null,isAlive:true,hasReadySeenCard:false,notes:[]})),speakingOrder:[],currentSpeakerId:null,votes:{},pkPlayers:[],lastEliminated:null,winner:null,aiReferee:{message:'新的一局准备就绪！房主可以更换词库或让 AI 裁判出题。',mood:'welcome',timestamp:now}};break;
    case 'COMMENT': {
      const comment=options.aiComment;
      requireValue(typeof comment==='string'&&comment.trim().length>0&&comment.length<=300,'AI 未返回有效点评，请重试。');
      requireValue(![r.wordPair.civilian,r.wordPair.undercover].filter(Boolean).some(word=>comment.includes(word)),'AI 点评包含底牌内容，已隐藏，请重试。');
      patch={aiReferee:{message:comment,mood:'mystery',timestamp:now}};break;
    }
    default:throw new Error('不支持的游戏操作。');
  }
  const next={...r,...patch,revision:r.revision+1,updatedAt:now};
  if(next.status!==r.status || data.type==='START'||data.type==='SPEAK'||data.type==='LOBBY')next.phaseId=r.phaseId+1;
  return next;
}

function publicPlayer(p,gameOver) {
  const {word,role,...safe}=p;
  return {...safe,role:gameOver||!p.isAlive?role:null,word:gameOver?word:null};
}
export function projectRoom(state) {
  const over=state.status==='GAME_OVER';
  // Explicit allowlist: adding a server-only field never accidentally exposes it.
  const out=Object.fromEntries(['roomCode','hostId','status','round','revision','phaseId','dealId','settings','speakingOrder','currentSpeakerId','pkPlayers','winner','aiReferee','updatedAt','expiresAt','turnStartedAt'].filter(k=>state[k]!==undefined).map(k=>[k,state[k]]));
  out.memberIds=state.players.filter(p=>!p.isSimulated).map(p=>p.id);
  out.players=state.players.map(p=>publicPlayer(p,over));
  out.wordPair=over?state.wordPair:{source:state.wordPair.source,hint:state.wordPair.hint};
  out.votes=Object.fromEntries(Object.keys(state.votes).map(id=>[id,true]));
  out.lastEliminated=state.lastEliminated?.player?{...state.lastEliminated,player:publicPlayer(state.lastEliminated.player,over)}:state.lastEliminated;
  out.aliveUndercoverCount=state.players.filter(p=>p.isAlive&&['UNDERCOVER','BLANK'].includes(p.role)).length;
  return out;
}
export function projectHands(state) {
  return Object.fromEntries(state.players.filter(p=>!p.isSimulated).map(viewer=>{
    const controlled=state.players.filter(p=>p.id===viewer.id||viewer.id===state.hostId&&p.isSimulated);
    return [viewer.id,{dealId:state.dealId,phaseId:state.phaseId,revision:state.revision,
      words:Object.fromEntries(controlled.map(p=>[p.id,p.word])),
      votes:Object.fromEntries(controlled.filter(p=>state.votes[p.id]!==undefined).map(p=>[p.id,state.votes[p.id]]))}];
  }));
}
