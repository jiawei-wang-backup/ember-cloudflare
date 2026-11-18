import {it,expect} from "vitest";
import {normalizeMonitor,EXPECTED_PROJECTS,MONITOR_URL} from "./monitor-source.ts";
const names=["jiawei-wang-dev/project-pulse","JUXON-AI/jxaccount","JUXON-AI/mfa-approval","JUXON-AI/wzwx-score","juxon-ai/deltaforce-game-library","juxon-ai/xiaoxing-voice-changer"];
const data=()=>({projects:names.slice(0,4).map((full_name,i)=>({repository_id:`repo-${i}`,full_name,status:"unknown"})),sessions:[],pulls:[],project_reports:names.map(project_key=>({project_key,goal:"目标证据",observed_at:"2026-11-16T00:00:00Z",milestones:[]}))});
it("requires all six screenshot identities and never falls back to old local projects",()=>{
  const wrong=data();wrong.project_reports=wrong.project_reports.slice(0,4);
  expect(()=>normalizeMonitor(wrong)).toThrow("deltaforce-game-library");
  expect(normalizeMonitor(data()).projects.map(p=>p.name)).toEqual([...EXPECTED_PROJECTS]);
  expect(normalizeMonitor(data()).source).toContain(MONITOR_URL);
});
it("assigns only exact repository identifiers, preserving PR state and draft",()=>{
  const source:Parameters<typeof normalizeMonitor>[0]=data();
  source.pulls=[{repository_id:"repo-1",full_name:"juxon-ai/JXACCOUNT",number:"116",title:"登录修复",url:"https://github.com/JUXON-AI/jxaccount/pull/116",state:"open",is_draft:true,updated_at:"2026-11-16"},{repository_id:"other",full_name:"other/jxaccount",number:"999",title:"其他项目",url:"https://example.com",state:"merged",is_draft:false,updated_at:"2026-11-16"}];
  const snapshot=normalizeMonitor(source);
  expect(snapshot.projects[1]!.pulls).toHaveLength(1);
  expect(snapshot.projects[1]!.pulls[0]).toMatchObject({number:"116",state:"open",is_draft:true});
  expect(snapshot.projects[0]!.pulls).toEqual([]);
});
it("keeps the dashboard's business grouping and the actual child repository PR URL",()=>{
  const source:Parameters<typeof normalizeMonitor>[0]=data();
  source.pulls=[{repository_id:"mcphub-repository",full_name:"JUXON-AI/jxaccount",number:"8",title:"MCPHub 接入",url:"https://github.com/JUXON-AI/jxmcphub/pull/8",state:"merged",is_draft:false,updated_at:"2026-11-16"}];
  const snapshot=normalizeMonitor(source);
  expect(snapshot.projects).toHaveLength(6);
  expect(snapshot.projects[1]!.pulls[0]).toMatchObject({repository_id:"mcphub-repository",url:"https://github.com/JUXON-AI/jxmcphub/pull/8",state:"merged"});
});
