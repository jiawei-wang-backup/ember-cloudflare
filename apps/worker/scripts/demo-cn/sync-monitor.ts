import {readFileSync,writeFileSync,existsSync} from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import type {RoomId} from "@ember/protocol";
import type {Bots,BotAnswer} from "@ember/protocol/bots";
import {botMessageSlackPath} from "@ember/protocol/bots";
import {Conversation,RoomSocket,type Said} from "../seed/client.ts";
import {html,mention} from "../seed/markup.ts";
import {localEmber,signIn,state,origin} from "./local.ts";
import {roomHistory} from "./project-cards.ts";
import {readMonitorSnapshot} from "./monitor-source.ts";
import {textFile,original} from "./files.ts";

interface SyncState {rooms:Record<string,RoomId>;summaryRoom:RoomId;sourceProjects:string[];capturedAt:string}
async function main(){
  const ember=await localEmber();
  // Fetch and persist the real source snapshot before mutating the Ember demo.
  const snapshot=await readMonitorSnapshot();
  writeFileSync(path.join(state,"monitor-snapshot.json"),JSON.stringify(snapshot,null,2),{mode:0o600});
  console.log("已读取监控面板项目："+snapshot.projects.map(p=>p.name).join("、"));
  const accounts=JSON.parse(readFileSync(path.join(state,"accounts.json"),"utf8"));
  const sessions=[];
  for(const account of accounts.accounts)sessions.push(await signIn(ember,account.emailAddress,accounts.password));
  const admin=sessions[0]!;
  const botList=await(await ember.request("/api/account/bots",{session:admin})).json() as Bots;
  const existing=botList.bots.find(b=>b.name==="Pulse 产出同步");
  const form=new FormData();const image=original("deploy-bot.png","image/png");
  const blob=new Blob([image.bytes as Uint8Array<ArrayBuffer>],{type:image.type});
  form.set("user",JSON.stringify({name:"Pulse 产出同步"}));form.set("avatar",blob,image.name);form.set("variant",blob,image.name);
  const bot=(await(await ember.request(existing?`/api/account/bots/${existing.id}`:"/api/account/bots",{method:existing?"PATCH":"POST",session:admin,body:form,expected:existing?[200]:[201]})).json() as BotAnswer).bot;
  const stateFile=path.join(state,"monitor-sync.json");
  const previous:SyncState|null=existsSync(stateFile)?JSON.parse(readFileSync(stateFile,"utf8")):null;
  const legacy=JSON.parse(readFileSync(path.join(state,"manifest.json"),"utf8"));
  const pulseLink=JSON.parse(readFileSync(path.join(state,"pulse-link.json"),"utf8"));
  const legacyPulseRoom=pulseLink.legacyRoomId||pulseLink.roomId;
  const sync:SyncState=previous||{rooms:{},summaryRoom:"" as RoomId,sourceProjects:[],capturedAt:snapshot.capturedAt};
  if(previous&&Object.keys(previous.rooms).some(key=>key.startsWith("workspace:")))throw new Error("发现旧错误数据的同步清单，请先运行 rollback:demo-pulse；不会在错误映射上继续写入。");
  const save=()=>writeFileSync(stateFile,JSON.stringify(sync,null,2),{mode:0o600});
  const memberIds=[...sessions.map(s=>s.user.id),bot.id];
  for(const project of snapshot.projects){
    if(!sync.rooms[project.key])sync.rooms[project.key]=pulseLink.source!=="dashboard"&&project.repositoryId===pulseLink.project?.repository_id?pulseLink.roomId:(await ember.createRoom(admin,{name:project.name,kind:"closed",memberIds})).id;
    save();
    const roomId=sync.rooms[project.key]!;
    if(roomId===pulseLink.roomId){
      const settings=await(await ember.request(`/api/rooms/${roomId}/settings`,{session:admin})).json() as {people:Array<{id:string;member:boolean}>};
      const ids=[...new Set([...settings.people.filter(p=>p.member).map(p=>p.id),bot.id])];
      await ember.json(`/api/rooms/${roomId}`,"PATCH",{name:project.name,kind:"closed",memberIds:ids},{session:admin});
      const binding=pulseLink.bindings[roomId];
      binding.memberIds=[...new Set([...binding.memberIds,bot.id])];
      writeFileSync(path.join(state,"pulse-link.json"),JSON.stringify(pulseLink,null,2),{mode:0o600});
    }
  }
  if(!sync.summaryRoom){sync.summaryRoom=(await ember.createRoom(admin,{name:"交付与验收 · Pulse",kind:"closed",memberIds})).id;save();}
  const summary=new Conversation(ember,sync.summaryRoom);await summary.watch(admin);
  const summaryHistory=await roomHistory(ember,admin,sync.summaryRoom);
  let added=0,cards=0,threads=0;
  try{
    for(const [index,project] of snapshot.projects.entries()){
      const roomId=sync.rooms[project.key]!;
      const history=await roomHistory(ember,admin,roomId);
      const conversation=new Conversation(ember,roomId);await conversation.watch(admin);
      const author=sessions[(index+1)%sessions.length]!,reviewer=sessions[(index+4)%sessions.length]!,tester=sessions[(index+7)%sessions.length]!;
      const source={...project};
      const version=createHash("sha256").update(JSON.stringify(source)).digest("hex").slice(0,12);
      const base=`PULSEBACKGROUND${createHash("sha256").update(project.key).digest("hex").slice(0,10)}${version}`;
      const say=async(person:typeof admin,token:string,text:string)=>{
        const found=history.find(m=>m.plainText.includes(token));
        const markup=html`<p><strong>【生成的演示讨论 · 依据监控快照】</strong></p><p>${text}</p><p>${token}</p>`;
        if(found){
          const said={message:found,markup:{body:found.body,quoted:found.body},author:found.creator} satisfies Said;
          if(!found.plainText.includes(text)&&found.creator.id===person.user.id){
            // Open the author's socket before editing a previously generated root.
            const socket=await RoomSocket.open(ember,person,roomId,false);
            try{return {message:await socket.edit(found.id,markup.body),markup,author:person.user};}finally{socket.close();}
          }
          return said;
        }
        const result=await conversation.say(person,markup);added++;return result;
      };
      const card=async(token:string,title:string,status:string,evidence:string,when:string,kind:string,repository?:string)=>{
        if(repository)evidence=`来源仓库：${repository}\n${evidence}`;
        const payload={text:`${project.name} · ${title} · ${token}`,blocks:[
          {type:"header",text:{type:"plain_text",text:`【${kind}】${title}`}},
          {type:"section",fields:[{type:"mrkdwn",text:`*项目*\n${project.name}`},{type:"mrkdwn",text:`*记录状态*\n${status}`},{type:"mrkdwn",text:`*来源时间*\n${when}`},{type:"mrkdwn",text:"*证据类型*\n"+kind}]},
          {type:"section",text:{type:"mrkdwn",text:evidence}},
          {type:"context",elements:[{type:"mrkdwn",text:`来自监控面板的只读快照。事件编号：${token}`}]},
        ]};
        const existing=history.find(m=>m.plainText.includes(token));
        if(!existing){await conversation.post(bot,payload);added++;cards++;}
        else if(repository&&!existing.plainText.includes(`来源仓库：${repository}`))await ember.json(botMessageSlackPath(roomId,bot.key,existing.id),"PATCH",payload);
        const existingSummary=summaryHistory.find(m=>m.plainText.includes(token));
        if(!existingSummary){await summary.post(bot,payload);added++;cards++;}
        else if(repository&&!existingSummary.plainText.includes(`来源仓库：${repository}`))await ember.json(botMessageSlackPath(sync.summaryRoom,bot.key,existingSummary.id),"PATCH",payload);
      };
      try{
        const intro=await say(author,`${base}INTRO`,`本频道对应监控面板项目「${project.name}」。${project.report?.goal||"面板暂未提供项目目标；先按已有采集记录沟通，不擅自补写完成率。"} 当前快照包含 ${project.sessions.length} 个会话、${project.pulls.length} 个 PR。下列成员发言是据此编写的演示讨论，不是原始真实聊天或实际贡献者记录。`);
        if(!history.some(m=>m.plainText.includes(`${base}INTRO`))){
          await conversation.replyInThread(reviewer,intro,"先把产出证据与生成的讨论分开：PR 状态按面板原记录，采集摘要只表示当时观察，不自动视作验收。后续问题就在这个 Thread 继续。");added++;threads++;
          await conversation.react(tester,intro,"👀");
        }
        if(project.report){
          await card(`${base}GOAL`,"项目目标与阶段产出","采集总结，非验收结论",project.report.goal,project.report.observed_at,"采集摘要");
          for(const [mi,milestone] of project.report.milestones.entries()){
            const token=`${base}M${mi}`;
            const root=await say(sessions[(index+mi+2)%9]!,token,`面板列出的事项：${milestone.title}。记录状态为「${milestone.state}」，原证据：${milestone.evidence}`);
            if(!history.some(m=>m.plainText.includes(token))){
              await conversation.replyInThread(reviewer,root,milestone.state==="completed"?"这项可以作为已有阶段产出的讨论依据，但不能扩展为整个项目已经交付；演示时保留原证据和时间。":"这项仍是待确认或未完成事项。先补验证记录，再由实际负责人确认，不把计划当结果。");added++;threads++;
              await conversation.reply(tester,root,milestone.state==="completed"?"收到，相关卡片标注为采集记录；最终验收仍看独立确认。":"我会在演示里说明这项缺少哪类证据，不填虚构的测试通过或上线状态。");added++;
              await conversation.react(author,root,milestone.state==="completed"?"✅":"🔍");
            }
            await card(`${token}CARD`,milestone.title,"已完成",milestone.evidence,project.report.observed_at,"阶段证据");
          }
        }
        for(const [si,session] of project.sessions.slice(0,3).entries()){
          await say(sessions[(index+si+3)%9]!,`${base}S${si}`,`最近可见的采集活动（原时间 ${session.last_activity_at}）：${session.title||"未命名会话"}。${session.summary||"面板尚无工作摘要；不根据会话存在推断开发完成。"} 来源记录人为 ${session.display_name}；本条是团队演示转述。`);
        }
        const newest=project.sessions[0];
        await card(`${base}ACTIVITY`,"研发活动记录",newest?.project_state||"状态未知",newest?.summary||newest?.title||"暂无可核实工作摘要；不能生成完成结论。",newest?.last_activity_at||snapshot.capturedAt,"会话摘要");
        for(const pull of project.pulls){
          const repository=new URL(pull.url).pathname.split("/").slice(1,3).join("/");
          const token=`PULSEPR${project.key.replace(/-/g,"")}${pull.number}${createHash("sha256").update(JSON.stringify(pull)).digest("hex").slice(0,10)}`;
          await card(token,`PR #${pull.number} · ${pull.title}`,`${pull.state}${pull.is_draft?" · 草稿":""}`,`真实 PR：${pull.url}`,pull.updated_at,"真实 PR",repository);
          const boundary=pull.state==="merged"?"合并状态可以如实展示，但合并不代表已经上线或业务验收通过。":pull.state==="closed"?"已关闭不代表已合并，更不代表业务验收。":"尚未合并，不展示已合并或验收通过的虚构结论。";
          await say(reviewer,`${token}DISCUSSION`,`演示时可以打开真实 PR #${pull.number} 核对「${pull.title}」。面板状态为 ${pull.state}${pull.is_draft?"，且仍是草稿":""}。${boundary}`);
        }
        if(!project.pulls.length)await say(tester,`${base}NOPR`,"目前面板没有这个项目的 PR 产出文档，因此这里只展示会话/目标证据，不虚构 GitHub 编号。等真实 PR 被采集后再追加对应交付卡片。");
        if(!history.some(m=>m.attachment?.name===`${project.name}-监控来源-${version}.json`)){
          await ember.upload(admin,roomId,textFile(`${project.name}-监控来源-${version}.json`,"application/json",JSON.stringify({project,source:snapshot.source,notice:"原始采集快照；本频道对话为生成的演示讨论，不是真实团队原话。"},null,2)));added++;
        }
        await say(author,`${base}NEXT`,`下一步演示重点：${project.report?.milestones.find(m=>m.state!=="completed")?.title||"核对数据来源、最近更新时间和明确的后续验证范围"}。${pulseLink.source==="dashboard"?"顶部统计和项目助手已按本频道的完整项目标识接入正确监控服务；点击展开统计或 @项目助手 可查询最新数据。":project.repositoryId?"本频道展示正确监控服务的项目快照及产出卡片，尚未绑定顶部实时统计。":"这是面板中的本地工作区项目，尚无可靠仓库 UUID；不把它绑定到其他仓库冒充真实统计。"}`);
        await ember.star(admin,roomId);
        console.log(`${project.name}：频道与背景已同步，${project.report?.milestones.length||0} 条阶段证据，${project.pulls.length} 个真实 PR。`);
      }finally{conversation.close();}
    }
  }finally{summary.close();}
  // Preserve earlier material while keeping the current sidebar focused on dashboard projects.
  const names=["直播监控平台","智能剪辑工作台","直播互动组件","AI接入网关","统一设计组件库","内容策略中台","交付与验收","项目进度"];
  for(const name of names){
    const id=legacy.rooms[name];if(!id||Object.values(sync.rooms).includes(id))continue;
    await ember.json(`/api/rooms/${id}`,"PATCH",{name:`历史演示 · ${name}`},{session:admin});
    for(const session of sessions)await ember.json(`/api/rooms/${id}/involvement`,"PUT",{involvement:"invisible"},{session});
  }
  if(legacyPulseRoom&&!Object.values(sync.rooms).includes(legacyPulseRoom)){
    for(const session of sessions)await ember.json(`/api/rooms/${legacyPulseRoom}/involvement`,"PUT",{involvement:"invisible"},{session});
  }
  sync.sourceProjects=snapshot.projects.map(p=>p.key);sync.capturedAt=snapshot.capturedAt;save();
  const configFile=path.join(state,"pulse.wrangler.json"),config=JSON.parse(readFileSync(configFile,"utf8"));
  const bindings=JSON.stringify(pulseLink.bindings);
  if(config.vars.PULSE_ROOMS!==bindings){config.vars.PULSE_ROOMS=bindings;writeFileSync(configFile,JSON.stringify(config,null,2),{mode:0o600});}
  console.log(`完成：${snapshot.projects.length} 个监控项目；本次新增 ${added} 条消息（含 ${cards} 张卡片）、${threads} 个 Thread。原中文旧项目历史保留，Fernwood 未修改。`);
  console.log(`交付汇总：${origin}/rooms/${sync.summaryRoom}`);
}
main().catch(error=>{console.error(error instanceof Error?error.message:"同步失败");process.exitCode=1;});
