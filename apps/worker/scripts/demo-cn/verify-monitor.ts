import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";
import path from "node:path";
import type {RoomId,RoomSettings,PulseSnapshot} from "@ember/protocol";
import {EXPECTED_PROJECTS,MONITOR_URL,type MonitorSnapshot} from "./monitor-source.ts";
import {localEmber,signIn,state} from "./local.ts";
import {roomHistory} from "./project-cards.ts";

export async function verifyMonitor(){
  const ember=await localEmber();
  const accounts=JSON.parse(readFileSync(path.join(state,"accounts.json"),"utf8"));
  const sync=JSON.parse(readFileSync(path.join(state,"monitor-sync.json"),"utf8")) as {rooms:Record<string,RoomId>;summaryRoom:RoomId};
  const snapshot=JSON.parse(readFileSync(path.join(state,"monitor-snapshot.json"),"utf8")) as MonitorSnapshot;
  const old=JSON.parse(readFileSync(path.join(state,"manifest.json"),"utf8"));
  const link=JSON.parse(readFileSync(path.join(state,"pulse-link.json"),"utf8"));
  const admin=await signIn(ember,accounts.accounts[0].emailAddress,accounts.password);
  assert.deepEqual(snapshot.projects.map(p=>p.name),[...EXPECTED_PROJECTS]);
  assert(snapshot.source.includes(MONITOR_URL));
  assert.equal(Object.keys(sync.rooms).length,EXPECTED_PROJECTS.length);
  const receiptFile=path.join(state,"rollback-wrong-monitor/receipt.json");
  if(existsSync(receiptFile)){
    const receipt=JSON.parse(readFileSync(receiptFile,"utf8")) as {deletedRooms:RoomId[];deletedMessageIds:string[]};
    for(const id of receipt.deletedRooms)await ember.request(`/api/rooms/${id}/settings`,{session:admin,expected:[404]});
    const legacy=await roomHistory(ember,admin,(link.legacyRoomId||link.roomId) as RoomId);
    assert(!legacy.some(m=>receipt.deletedMessageIds.includes(m.id)||/PULSEBACKGROUND|PULSEPR/.test(m.plainText)||m.attachment?.name.includes("-监控来源-")),"旧联调频道仍有错误导入残留");
  }
  let cardCount=0,threads=0;
  for(const project of snapshot.projects){
    const id=sync.rooms[project.key]!;assert(id);
    const settings=await(await ember.request(`/api/rooms/${id}/settings`,{session:admin})).json() as RoomSettings;
    assert.equal(settings.room.name,project.name);assert.equal(settings.room.kind,"closed");
    if(link.source==="dashboard"){
      assert.equal(link.bindings[id]?.projectId,project.key);
      assert(settings.people.some(person=>person.member&&person.id===link.botId),`${project.name} 缺少项目助手`);
      const live=await(await ember.request(`/api/rooms/${id}/project?days=7&audience=room`,{session:admin})).json() as PulseSnapshot;
      assert.equal(live.project.key,project.key);
      assert.equal(live.source,MONITOR_URL);
      assert.equal(live.usage.cached_input_tokens,null);
      assert.deepEqual(live.models,[]);
      assert.equal(live.milestone_progress?.basis,"reported");
      assert.equal(live.project.owner_basis,"participants");
      assert.equal(live.project.owner?.display_name??null,live.members.length?live.members.map(member=>member.display_name).join("、"):null);
    }
    const messages=await roomHistory(ember,admin,id);
    assert(messages.some(m=>m.plainText.includes("生成的演示讨论")));
    const cards=messages.filter(m=>m.cards?.length&&m.plainText.includes("事件编号：PULSE"));
    assert(cards.length>=1,`${project.name} 缺少来源卡片`);
    const tokens=cards.map(m=>/事件编号：(PULSE\S+)/.exec(m.plainText)?.[1]);
    assert.equal(new Set(tokens).size,tokens.length,`${project.name} 出现重复卡片`);
    for(const pull of project.pulls){
      const card=cards.find(m=>m.plainText.includes(pull.url));assert(card);
      assert(card.plainText.includes(pull.state));
      const repository=new URL(pull.url).pathname.split("/").slice(1,3).join("/");
      assert(card.plainText.includes(`来源仓库：${repository}`));
      if(pull.is_draft)assert(card.plainText.includes("草稿"));
    }
    if(!project.pulls.length)assert(!cards.some(m=>m.plainText.includes("【真实 PR】")));
    const attachment=messages.find(m=>m.attachment?.name.startsWith(`${project.name}-监控来源-`))?.attachment;assert(attachment);
    const source=await(await ember.request(attachment.url,{session:admin})).json() as {project:{key:string}};
    assert.equal(source.project.key,project.key);
    cardCount+=cards.length;threads+=messages.filter(m=>m.thread).length;
  }
  const summary=await roomHistory(ember,admin,sync.summaryRoom);
  const summaryCards=summary.filter(m=>m.cards?.length&&m.plainText.includes("事件编号：PULSE"));
  assert.equal(summaryCards.length,cardCount);
  assert.equal(new Set(summaryCards.map(m=>/事件编号：(PULSE\S+)/.exec(m.plainText)?.[1])).size,summaryCards.length);
  for(const account of accounts.accounts){
    const session=await signIn(ember,account.emailAddress,accounts.password);
    const sidebar=await ember.sidebar(session);
    for(const [name,id] of Object.entries(old.rooms) as Array<[string,RoomId]>){
      if(["直播监控平台","智能剪辑工作台","直播互动组件","AI接入网关","统一设计组件库","内容策略中台","交付与验收","项目进度"].includes(name))assert(sidebar.rooms.find(r=>r.id===id)?.involvement==="invisible",`${account.name} 的旧演示频道未隐藏`);
    }
    for(const id of Object.values(sync.rooms))assert(sidebar.rooms.some(r=>r.id===id));
  }
  const english=await fetch("http://localhost:5173/api/bootstrap").then(r=>r.json()) as {account:{name:string}};
  assert.equal(english.account.name,"Fernwood");
  console.log(`验证通过：${snapshot.projects.length} 个来源项目、${threads} 个 Thread、${cardCount} 张项目卡片及 ${summaryCards.length} 张汇总卡片；来源附件、PR 状态、去重、九名成员的侧栏与 Fernwood 均正常。`);
}
