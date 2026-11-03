export function speakingPatch(room, players = room.players, round = room.round, pk = [], random = Math.random, now = Date.now()) {
  const eligible = players.filter(p=>p.isAlive && (!pk.length || pk.includes(p.id)));
  if (!eligible.length) throw new Error('没有可以发言的玩家。');
  const start = Math.floor(random()*eligible.length);
  const order = [...eligible.slice(start), ...eligible.slice(0,start)].map(p=>p.id);
  const first = players.find(p=>p.id===order[0]);
  return {
    players, status:'SPEAKING', round, speakingOrder:order, currentSpeakerId:order[0], pkPlayers:pk, votes:{}, turnStartedAt:now,
    aiReferee:{message: pk.length
      ? `平票加赛 PK！请平票玩家用最后 20 秒为自己辩解！首先请 ${first.seat} 号【${first.name}】线下开口发言！`
      : `第 ${round} 轮线下发言开始！本轮由 ${first.seat} 号【${first.name}】打头阵，大家竖起耳朵听TA怎么描述！`,mood:'speaking',timestamp:now}
  };
}

export function tallyPatch(room, votes, random = Math.random, now = Date.now()) {
  if (room.status!=='VOTING') throw new Error('当前不是投票阶段。');
  const alive=room.players.filter(p=>p.isAlive);
  const allowed=new Set(alive.filter(p=>!room.pkPlayers?.length||room.pkPlayers.includes(p.id)).map(p=>p.id));
  const validVotes={};
  for (const voter of alive) {
    const target=votes[voter.id];
    if(target==='ABSTAIN'||(target!==voter.id&&allowed.has(target))) validVotes[voter.id]=target;
  }
  const counts={};
  Object.values(validVotes).filter(id=>id!=='ABSTAIN').forEach(id=>{counts[id]=(counts[id]||0)+1;});
  const max=Math.max(0,...Object.values(counts));
  const top=Object.keys(counts).filter(id=>counts[id]===max);
  if(!max) return {votes:validVotes,status:'RESULT',lastEliminated:{type:'NONE',reason:'全员弃票，本轮平安夜无人出局！'},aiReferee:{message:'全员弃票！本轮平安夜无人出局！',mood:'shocked',timestamp:now}};
  if(top.length>1){
    if(!room.pkPlayers?.length)return speakingPatch(room,room.players,room.round,top,random,now);
    return {votes:validVotes,status:'RESULT',pkPlayers:[],lastEliminated:{type:'TIE_SAFE',reason:'PK 依然平票，本轮无人出局！'},aiReferee:{message:'二轮 PK 依然难分高下！本轮无人出局，悬念留到下一轮！',mood:'shocked',timestamp:now}};
  }
  const eliminated=room.players.find(p=>p.id===top[0]);
  const players=room.players.map(p=>p.id===eliminated.id?{...p,isAlive:false}:p);
  const survivors=players.filter(p=>p.isAlive);
  const u=survivors.filter(p=>p.role==='UNDERCOVER'||p.role==='BLANK').length;
  const c=survivors.filter(p=>p.role==='CIVILIAN').length;
  const winner=u===0?'CIVILIAN':c<=u||survivors.length<=2?'UNDERCOVER':null;
  const roleLabel=eliminated.role==='CIVILIAN'?'平民':eliminated.role==='UNDERCOVER'?'卧底':'白板';
  const message=winner
    ? `游戏结束！【${winner==='CIVILIAN'?'平民':'卧底'}阵营】获胜！${eliminated.seat}号【${eliminated.name}】出局，身份是【${roleLabel}】。`
    : `以 ${max} 票出局的 ${eliminated.seat}号【${eliminated.name}】是【${roleLabel}】！场上还有潜伏者，游戏继续！`;
  return {players,votes:validVotes,status:winner?'GAME_OVER':'RESULT',winner,pkPlayers:[],lastEliminated:{type:'ELIMINATED',player:{...eliminated,isAlive:false},votesCount:max,roleLabel},aiReferee:{message,mood:winner?'celebrate':'shocked',timestamp:now}};
}

export function votePatch(room, voterId, targetId, random = Math.random, now = Date.now()) {
  if(room.status!=='VOTING') throw new Error('当前不是投票阶段。');
  const voter=room.players.find(p=>p.id===voterId&&p.isAlive);
  const target=room.players.find(p=>p.id===targetId&&p.isAlive);
  if(!voter||targetId===voterId||targetId!=='ABSTAIN'&&(!target||room.pkPlayers?.length&&!room.pkPlayers.includes(targetId))) throw new Error('不能投给这位玩家。');
  const votes={...room.votes,[voterId]:targetId};
  return room.players.filter(p=>p.isAlive).every(p=>votes[p.id]!==undefined)?tallyPatch(room,votes,random,now):{votes};
}

export function readyPatch(room, playerId, random = Math.random, now = Date.now()) {
  if(room.status!=='DEALING'||!room.players.some(p=>p.id===playerId)) throw new Error('当前无法确认底牌。');
  const players=room.players.map(p=>p.id===playerId?{...p,hasReadySeenCard:true}:p);
  return players.every(p=>p.hasReadySeenCard)?speakingPatch(room,players,1,[],random,now):{players};
}

export function speakingNextPatch(room, expectedId, keyword='', now=Date.now()) {
  if(room.status!=='SPEAKING'||room.currentSpeakerId!==expectedId)throw new Error('发言人已切换，请确认当前轮次。');
  const players=room.players.map(p=>p.id===expectedId&&keyword.trim()?{...p,notes:[...(p.notes||[]).slice(-49),`R${room.round}: ${keyword.trim().slice(0,25)}`]}:p);
  const index=room.speakingOrder.indexOf(expectedId);
  const next=room.speakingOrder[index+1];
  if(next){const p=players.find(p=>p.id===next);return {players,currentSpeakerId:next,turnStartedAt:now,aiReferee:{message:`接下来请 ${p.seat}号【${p.name}】线下发言！`,mood:'speaking',timestamp:now}};}
  return {players,status:'VOTING',currentSpeakerId:null,votes:{},aiReferee:{message:'全员发言完毕！请拿起各自手机，点击你最怀疑的头像秘密投票！',mood:'voting',timestamp:now}};
}
