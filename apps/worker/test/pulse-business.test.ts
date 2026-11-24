import {it, expect} from "vitest";
import {businessOverview, businessDefinition} from "../src/pulse-business";
import type {PulseSnapshot} from "@ember/protocol";
it("organises all six projects without treating source completion as live availability", () => {
  for (const name of ["project-pulse", "jxaccount", "mfa-approval", "wzwx-score", "deltaforce-game-library", "xiaoxing-voice-changer"]) {
    const definition = businessDefinition(`demo/${name}`)!;
    const milestones = definition.modules.flatMap(m => m.stages.map(([title]) => ({title, state: "completed", due_on: null, evidence: "仅为历史阶段交付"})));
    const data = {project: {full_name: `demo/${name}`, status: "unknown"}, milestones} as PulseSnapshot;
    const business = businessOverview(data)!;
    expect(business.modules.length).toBeGreaterThanOrEqual(3);
    expect(business.modules.flatMap(m => m.milestones)).toHaveLength(milestones.length);
    expect(business.modules.every(m => m.status === "recorded" && m.availability.includes("需"))).toBe(true);
    expect(business.journeys!.length).toBeGreaterThanOrEqual(2);
    expect(business.journeys!.every(j => j.state === "awaiting_acceptance")).toBe(true);
    expect(business.provenance).toContain("不等于");
  }
});
it("preserves new source stages rather than silently dropping unmapped work", () => {
  const data = {project: {full_name: "demo/project-pulse", status: "blocked"}, milestones: [
    {title: "新的待确认事项", state: "pending", evidence: "新证据"},
    {title: "已完成的验证", state: "completed", evidence: "历史回执"},
  ]} as PulseSnapshot;
  const business = businessOverview(data)!;
  expect(business.modules.at(-1)).toMatchObject({id: "other", status: "unknown"});
  expect(business.modules.at(-1)?.milestones[0]?.evidence).toBe("新证据");
  expect(business.modules.at(-1)?.blockers).toEqual(["新的待确认事项"]);
});
