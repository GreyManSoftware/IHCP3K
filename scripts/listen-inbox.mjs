// Run only as a background task owned by the receiving native chat. No AI polling.
export async function listenInbox(client,{session_id,duration_ms=3600000},{invoke,now=Date.now,signal}={}) {
 if(!session_id||!Number.isInteger(duration_ms)||duration_ms<1||duration_ms>3600000)throw Error('INVALID_LISTENER_ARGUMENTS');
 const until=now()+duration_ms;let attendance_token,delivered=false;
 try {
  while(!signal?.aborted&&now()<until){
   const result=await invoke(client,'session.listen',{session_id,...(attendance_token?{attendance_token}:{}),timeout_ms:Math.min(25000,until-now())});
   attendance_token=result.attendance_token??attendance_token;
   if(signal?.aborted)return {status:'cancelled'};
   if(result.status==='pending'){
    delivered=true;
    // No bodies or claims. Native task completion wakes this same owner to claim mail.
    return {status:'pending',session_id,pending_count:result.pending_count,attendance_token};
   }
   if(result.status!=='timeout')return {status:result.status};
  }
  return {status:signal?.aborted?'cancelled':'timeout'};
 } finally {
  if(attendance_token&&!delivered)await invoke(client,'session.unattend',{session_id,attendance_token}).catch(()=>{});
  // On delivery the server retains only a 15s grace. Crashes expire within 120s.
 }
}
