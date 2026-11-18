import type {PulseSnapshot} from "@ember/protocol";
import {PulseStatusBadge} from "./pulse-status";

const introductions: Record<string, {
  purpose: string;
  trial?: {href: string; label: string};
}> = {
  "jiawei-wang-dev/project-pulse": {
    purpose: "把团队的开发进度和交付成果汇到一个看板，开会前一眼就能看清。",
    trial: {href: "http://192.168.20.189:4185/", label: "打开局域网监控面板"},
  },
  "juxon-ai/jxaccount": {
    purpose: "让不同公司的员工用自己的飞书账号登录公司授权的业务系统。",
  },
  "juxon-ai/mfa-approval": {
    purpose: "使用受管账号时，先在飞书申请，审批通过后再领取这次登录的验证码。",
  },
  "juxon-ai/wzwx-score": {
    purpose: "帮赛事组织者管理报名和签到，并在赛后整理、导出成绩。",
  },
  "juxon-ai/deltaforce-game-library": {
    purpose: "让玩家查《三角洲行动》的装备、游戏资料和战绩，并能核对来源。",
  },
  "juxon-ai/xiaoxing-voice-changer": {
    purpose: "让主播开播时实时变声，可以选麦克风和音色。",
  },
};

function displayName(name: string) {
  return name.replace(/\s*(?:[·•]\s*[a-f\d]{8,}|[（(][a-f\d]{8,}[）)])$/i, "").trim();
}

export function ProjectQuickLook({data, onDiscussion}: {data: PulseSnapshot; onDiscussion: () => void}) {
  const introduction = introductions[data.project.key?.toLowerCase() ?? ""];
  const stageNames = new Map(data.business?.modules.flatMap(module => module.milestones.map(stage => [stage.sourceTitle, stage.title] as const)));
  const delivered = data.milestones.filter(stage => ["accepted", "completed"].includes(stage.state)).map(stage => stageNames.get(stage.title) || stage.title);
  const owner = data.project.owner_basis !== "participants" && data.project.owner?.display_name;
  const participants = [...new Set(data.members.map(member => displayName(member.display_name)).filter(Boolean))];
  return (
    <section aria-label="项目速览" className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold">项目速览</h2>
        {["on_track", "blocked", "paused", "completed"].includes(data.project.status) && <PulseStatusBadge value={data.project.status}/>}
      </div>
      <dl className="mt-3 grid gap-x-6 gap-y-3 text-sm leading-relaxed sm:grid-cols-2">
        <div>
          <dt className="font-medium">这个项目做什么</dt>
          <dd className="mt-0.5 text-message-muted">{introduction?.purpose || data.introduction?.background || data.project.goal || "暂无项目介绍"}</dd>
        </div>
        <div>
          <dt className="font-medium">现在能用什么</dt>
          <dd className="mt-0.5 text-message-muted">{delivered.slice(0, 3).join("；") || "暂无已完成的功能记录"}</dd>
        </div>
        <div>
          <dt className="font-medium">去哪试</dt>
          <dd className="mt-0.5 text-message-muted">{introduction?.trial
            ? <a className="text-link hover:underline" href={introduction.trial.href} target="_blank" rel="noopener noreferrer">{introduction.trial.label} ↗</a>
            : "暂未开放试用"}</dd>
        </div>
        <div>
          <dt className="font-medium">遇到问题找谁</dt>
          <dd className="mt-0.5 text-message-muted">
            {owner ? `可问负责人 ${displayName(owner)} · ` : participants.length ? `可先问参与成员 ${participants.slice(0, 2).join("、")} · ` : ""}
            <button type="button" className="text-link hover:underline" onClick={onDiscussion}>到项目讨论提问</button>
          </dd>
        </div>
      </dl>
    </section>
  );
}
