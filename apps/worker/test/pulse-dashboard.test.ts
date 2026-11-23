import {it, expect} from "vitest";
import {dashboardProject, type PulseDashboard} from "../src/pulse-dashboard";

function dashboard(): PulseDashboard {
  return {
    projects: [{repository_id: "identity-repo", owner_name: "首次上报人", full_name: "JUXON-AI/jxaccount", repositories: ["JUXON-AI/jxaccount", "JUXON-AI/jxmcphub"], status: "unknown", milestones: []}],
    project_reports: [{project_key: "juxon-ai/jxaccount", goal: "多公司身份", observed_at: "2026-11-16T00:00:00Z", milestones: [{title: "组织同步", state: "completed", evidence: "目录记录"}, {title: "真实员工验收", state: "pending", evidence: "未验证"}]}, {project_key: "juxon-ai/deltaforce-game-library", goal: "游戏资料库", observed_at: "2026-11-16T00:00:00Z", milestones: []}],
    workspace_states: [{workspace_name: "juxon-ai/deltaforce-game-library", status: "blocked"}],
    project_usage: [{project_key: "JUXON-AI/jxaccount", input_tokens: "9007199254740993", output_tokens: "10"}, {project_key: "JUXON-AI/jxmcphub", input_tokens: "7", output_tokens: "2"}, {project_key: "other/jxaccount", input_tokens: "999999", output_tokens: "999"}],
    memberships: [{display_name: "真实参与者", full_name: "JUXON-AI/jxmcphub", workspace_name: null, session_count: 2, last_activity_at: "2026-11-16"}, {display_name: "其他项目成员", full_name: "other/jxaccount", workspace_name: null, session_count: 9, last_activity_at: "2026-11-16"}],
    sessions: [{full_name: "other/jxaccount", workspace_name: "JUXON-AI/jxaccount", display_name: "其他人", title: "其他记录", summary: "其他项目秘密", last_activity_at: "2026-11-16"}, {full_name: null, workspace_name: "juxon-ai/deltaforce-game-library", display_name: "游戏开发者", title: "迁移", summary: "恢复入口", last_activity_at: "2026-11-16"}],
    pulls: [{full_name: "JUXON-AI/jxaccount", repository_full_name: "JUXON-AI/jxmcphub", number: "8", title: "入口", url: "https://github.com/JUXON-AI/jxmcphub/pull/8", state: "open", is_draft: true, updated_at: "2026-11-16"}, {full_name: "other/jxaccount", number: "9", title: "其他", url: "https://github.com/other/jxaccount/pull/9", state: "merged", updated_at: "2026-11-16"}],
  };
}
it("scopes aggregates to explicit business repositories without leaking global or similarly named projects", () => {
  const data = dashboardProject(dashboard(), "juxon-ai/jxaccount", 7, "LAN", new Date("2026-11-16T09:00:00Z"));
  expect(data.usage).toMatchObject({input_tokens: "9007199254741000", output_tokens: "12", cached_input_tokens: null, events: null, updated_at: null});
  expect(data.members.map(m => m.display_name)).toEqual(["真实参与者"]);
  expect(data.project.owner).toEqual({display_name:"首次上报人"});
  expect(data.project.owner_basis).toBeUndefined();
  expect(data.activities).toEqual([]);
  expect(data.models).toEqual([]);
  expect(data.pulls).toHaveLength(1);
  expect(data.pulls[0]).toMatchObject({repository_full_name: "JUXON-AI/jxmcphub", is_draft: true});
  expect(data.milestone_progress).toMatchObject({accepted: 0, completed: 1, total: 2, basis: "reported"});
  expect(data.window.since).toBe("2026-11-09T16:00:00.000Z");
  expect(JSON.stringify(data)).not.toContain("其他项目秘密");
});
it("keeps the first reporter as owner when participants change", () => {
  const source=dashboard();
  source.memberships.push({...source.memberships[0]!,full_name:"JUXON-AI/jxaccount",session_count:1});
  source.memberships.push({...source.memberships[0]!,display_name:"第二位参与者"});
  const data=dashboardProject(source,"juxon-ai/jxaccount",7,"LAN");
  expect(data.project.owner?.display_name).toBe("首次上报人");
  expect(data.members[0]?.sessions).toBe(3);
  source.memberships=[];
  expect(dashboardProject(source,"juxon-ai/jxaccount",7,"LAN").project.owner?.display_name).toBe("首次上报人");
  delete source.projects[0]!.owner_name;
  expect(dashboardProject(source,"juxon-ai/jxaccount",7,"LAN").project.owner).toBeNull();
});
it("supports workspace-only projects without inventing repository UUIDs or zero usage", () => {
  const data = dashboardProject(dashboard(), "juxon-ai/deltaforce-game-library", 1, "LAN");
  expect(data.project).toMatchObject({repository_id: null, status: "blocked"});
  expect(data.activities[0]?.summary).toBe("恢复入口");
  expect(data.usage.input_tokens).toBeNull();
  expect(data.pulls).toEqual([]);
  expect(() => dashboardProject(dashboard(), "other/absent", 7, "LAN")).toThrow("身份不匹配");
});
