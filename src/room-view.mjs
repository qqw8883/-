export function mergeRoomView(room, hand) {
  if(!room)return null;
  const matches=hand?.dealId===room.dealId;
  return {...room,
    players:room.players.map(p=>({...p,word:p.word||(matches&&room.status!=='LOBBY'?hand.words?.[p.id]:null)||null})),
    votes:{...room.votes,...(matches&&hand.phaseId===room.phaseId?hand.votes:{})}
  };
}
