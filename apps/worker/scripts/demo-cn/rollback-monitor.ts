import {readFileSync,writeFileSync,mkdirSync,existsSync,renameSync} from "node:fs";
import path from "node:path";
import {roomSocketQuery,type Message,type RoomId,type ServerFrame,type ClientFrame} from "@ember/protocol";
import type {BotAnswer,Bots} from "@ember/protocol/bots";
import {botMessagesPath} from "@ember/protocol/bots";
import {localEmber,signIn,state} from "./local.ts";
import {readMonitorSnapshot} from "./monitor-source.ts";
import {roomHistory} from "./project-cards.ts";
import type {Session} from "../seed/client.ts";

async function exchange(session:Session,roomId:RoomId,frame:ClientFrame,done:(frame:ServerFrame)=>boolean):Promise<ServerFrame>{
  const Socket=WebSocket as unknown as new(url:string,init:{headers:Record<string,string>})=>WebSocket;
  return new Promise((resolve,reject)=>{
    const socket=new Socket(`ws://localhost:5174/api/rooms/${roomId}/socket${roomSocketQuery({visible:false})}`,{headers:{Cookie:session.cookie,Origin:"http://localhost:5174"}});
    const timer=setTimeout(()=>{socket.close();reject(new Error("回退消息操作超时"));},15000);
    socket.addEventListener("error",()=>{clearTimeout(timer);socket.close();reject(new Error("回退连接失败"));});
    socket.addEventListener("message",event=>{
      const value=JSON.parse(String(event.data)) as ServerFrame;
      if(value.type==="welcome"){socket.send(JSON.stringify(frame));return;}
      if(value.type==="error"||done(value)){clearTimeout(timer);socket.close();value.type==="error"?reject(new Error(value.message)):resolve(value);}
    });
  });
}
async function main(){
  const source=await readMonitorSnapshot();
  const ember=await localEmber();
  const file=path.join(state,"monitor-sync.json");
  if(!existsSync(file)){console.log("没有错误同步清单，未执行回退。");return;}
  const old=JSON.parse(readFileSync(file,"utf8")) as {rooms:Record<string,RoomId>;summaryRoom:RoomId};
  if(Object.keys(old.rooms).includes("juxon-ai/jxaccount")){console.log("当前已是正确六项目映射，未重复回退。");return;}
  const accounts=JSON.parse(readFileSync(path.join(state,"accounts.json"),"utf8"));
  const sessions:Session[]=[];for(const account of accounts.accounts)sessions.push(await signIn(ember,account.emailAddress,accounts.password));
  const admin=sessions[0]!;
  const link=JSON.parse(readFileSync(path.join(state,"pulse-link.json"),"utf8"));
  const legacy=JSON.parse(readFileSync(path.join(state,"manifest.json"),"utf8"));
  const backup=path.join(state,"rollback-wrong-monitor");mkdirSync(backup,{recursive:true,mode:0o700});
  writeFileSync(path.join(backup,"correct-source.json"),JSON.stringify(source,null,2),{mode:0o600});
  writeFileSync(path.join(backup,"wrong-sync.json"),JSON.stringify(old,null,2),{mode:0o600});
  const pulseRoom=link.roomId as RoomId;
  const history=await roomHistory(ember,admin,pulseRoom);
  const wrong=history.filter(m=>/PULSEBACKGROUND|PULSEPR/.test(m.plainText)||m.attachment?.name.includes("-监控来源-"));
  const replies:Message[]=[];
  for(const parent of wrong.filter(m=>m.thread)){
    const result=await exchange(admin,pulseRoom,{type:"thread.open",parentId:parent.id},f=>f.type==="thread.opened"&&f.parentId===parent.id);
    if(result.type==="thread.opened")replies.push(...result.messages);
  }
  const targets=[...new Map([...replies,...wrong].map(m=>[m.id,m])).values()];
  writeFileSync(path.join(backup,"mixed-room-messages.json"),JSON.stringify({roomId:pulseRoom,messages:targets},null,2),{mode:0o600});
  for(const message of targets.filter(m=>m.attachment)){
    const response=await ember.request(message.attachment!.url,{session:admin});
    writeFileSync(path.join(backup,`attachment-${message.id}.bin`),Buffer.from(await response.arrayBuffer()),{mode:0o600});
  }
  const bots=(await(await ember.request("/api/account/bots",{session:admin})).json() as Bots).bots;
  const botKeys=new Map<string,string>();
  for(const message of targets){
    const session=sessions.find(s=>s.user.id===message.creator.id);
    if(session)await exchange(session,pulseRoom,{type:"message.delete",messageId:message.id},f=>f.type==="message.deleted"&&f.messageId===message.id);
    else{
      if(!bots.some(b=>b.id===message.creator.id))throw new Error("无法确认待回退消息作者，停止删除。");
      if(!botKeys.has(message.creator.id))botKeys.set(message.creator.id,((await(await ember.request(`/api/account/bots/${message.creator.id}`,{session:admin})).json()) as BotAnswer).bot.key);
      await ember.request(`${botMessagesPath(pulseRoom,botKeys.get(message.creator.id)!)}/${message.id}`,{method:"DELETE",expected:[204,404]});
    }
  }
  const created=[...Object.values(old.rooms).filter(id=>id!==pulseRoom),old.summaryRoom];
  const protectedIds=new Set([...Object.values(legacy.rooms),pulseRoom]);
  for(const id of created){
    if(protectedIds.has(id))throw new Error("回退清单包含原有频道，拒绝删除。");
    const response=await ember.request(`/api/rooms/${id}/settings`,{session:admin,expected:[200,404]});
    if(response.status===404)continue;
    const settings=await response.json();
    const messages=await roomHistory(ember,admin,id);
    const threadMessages:Message[]=[];
    for(const parent of messages.filter(m=>m.thread)){
      const thread=await exchange(admin,id,{type:"thread.open",parentId:parent.id},f=>f.type==="thread.opened"&&f.parentId===parent.id);
      if(thread.type==="thread.opened")threadMessages.push(...thread.messages);
    }
    writeFileSync(path.join(backup,`room-${id}.json`),JSON.stringify({settings,messages,threadMessages},null,2),{mode:0o600});
    await ember.request(`/api/rooms/${id}`,{method:"DELETE",session:admin,expected:[204,200]});
  }
  await ember.json(`/api/rooms/${pulseRoom}`,"PATCH",{name:"Project Pulse · 实际研发"},{session:admin});
  for(const name of ["直播监控平台","智能剪辑工作台","直播互动组件","AI接入网关","统一设计组件库","内容策略中台","交付与验收","项目进度"]){
    const id=legacy.rooms[name];if(!id)continue;
    await ember.json(`/api/rooms/${id}`,"PATCH",{name},{session:admin});
    for(const session of sessions)await ember.json(`/api/rooms/${id}/involvement`,"PUT",{involvement:"everything"},{session});
  }
  renameSync(file,path.join(backup,"completed-sync.json"));
  const snapshotFile=path.join(state,"monitor-snapshot.json");if(existsSync(snapshotFile))renameSync(snapshotFile,path.join(backup,"wrong-snapshot.json"));
  writeFileSync(path.join(backup,"receipt.json"),JSON.stringify({completedAt:new Date().toISOString(),deletedRooms:created,deletedMessageIds:targets.map(m=>m.id),notes:"只回退误建的五项目频道、汇总频道及混入原联调频道的带标识新增消息；旧演示频道恢复原名称和默认可见偏好。Fernwood 未修改。"},null,2),{mode:0o600});
  const remaining=await roomHistory(ember,admin,pulseRoom);
  if(remaining.some(m=>/PULSEBACKGROUND|PULSEPR/.test(m.plainText)||m.attachment?.name.includes("-监控来源-")))throw new Error("原联调频道仍有错误同步残留。");
  console.log(`回退完成：删除 ${created.length} 个误建频道、${targets.length} 条混入原频道的新增消息；备份位于 ${backup}。旧演示已恢复，Fernwood 未修改。`);
}
main().catch(error=>{console.error(error instanceof Error?error.message:"回退失败");process.exitCode=1;});
