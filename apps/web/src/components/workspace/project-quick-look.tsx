import type {PulseSnapshot} from "@ember/protocol";
import {bodyFromPlainText, displayBody} from "@ember/richtext/dom";
import {MessageBody} from "./message-body";
import {PulseStatusBadge} from "./pulse-status";

const introductions: Record<string, {purpose: string}> = {
  "jiawei-wang-dev/project-pulse": {
    purpose: "把团队的开发进度和交付成果汇到一个看板，开会前一眼就能看清。",
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
  "juxon-ai/observer-bot": {
    purpose: "监控集群异常并向运维人员发送告警，方便及时定位问题。",
  },
  "juxon-ai/jxmcphub": {
    purpose: "把业务工具集中接入，让团队按权限使用和管理这些工具。",
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

function trialAddress(value: string) {
  if (/\s/.test(value) || !URL.canParse(value)) return undefined;
  const url = new URL(value);
  return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : undefined;
}

export function projectSnapshotSections(data: PulseSnapshot) {
  const notes = data.ember_snapshot ? data.activities.map(activity => activity.title || activity.summary || "") : [];
  const sections = new Map<string, string>();
  const details = notes.filter(note => {
    const row = /^(可用情况|最近交付|当前卡点|下一步|试用入口)[：:]\s*(.+)$/.exec(note);
    if (!row) return Boolean(note);
    if (!sections.has(row[1]!)) sections.set(row[1]!, row[2]!);
    return false;
  });
  return {sections, details};
}

export function ProjectQuickLook({data, onDiscussion}: {data: PulseSnapshot; onDiscussion: () => void}) {
  const projectKey = data.project.key?.toLowerCase() ?? "";
  const introduction = introductions[projectKey];
  const stageNames = new Map(data.business?.modules.flatMap(module => module.milestones.map(stage => [stage.sourceTitle, stage.title] as const)));
  const reported = data.milestone_progress?.basis === "reported";
  const accepted = data.milestones.filter(stage => stage.state === "accepted").map(stage => stageNames.get(stage.title) || stage.title);
  const pending = data.business?.modules.flatMap(module => module.blockers.map(title => title.replace(/^尚待验证：/, ""))) ?? [];
  const {sections, details} = projectSnapshotSections(data);
  const monitor = projectKey === "jiawei-wang-dev/project-pulse" ? data.monitor_url : undefined;
  const trial = trialAddress(sections.get("试用入口") ?? monitor ?? "");
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
          <dd className="mt-0.5 text-message-muted">{sections.get("可用情况") || "正式环境可用情况待确认"}</dd>
        </div>
        <div>
          <dt className="font-medium">最近交付</dt>
          <dd className="mt-0.5 text-message-muted">{sections.get("最近交付") || accepted.slice(0, 2).join("；") || "暂无已核实的交付摘要"}</dd>
        </div>
        <div>
          <dt className="font-medium">当前卡点</dt>
          <dd className="mt-0.5 text-message-muted">{sections.get("当前卡点") || pending[0] || "暂无已上报的卡点"}</dd>
        </div>
        <div>
          <dt className="font-medium">下一步</dt>
          <dd className="mt-0.5 text-message-muted">{sections.get("下一步") || "待负责人确认"}</dd>
        </div>
        <div>
          <dt className="font-medium">去哪试</dt>
          <dd className="mt-0.5 text-message-muted">{trial
            ? <a className="text-link hover:underline" href={trial} target="_blank" rel="noopener noreferrer">{sections.has("试用入口") ? "打开试用入口 ↗" : "打开局域网监控面板 ↗"}</a>
            : "试用入口待确认"}</dd>
        </div>
        <div>
          <dt className="font-medium">遇到问题找谁</dt>
          <dd className="mt-0.5 text-message-muted">
            {owner ? `可问负责人 ${displayName(owner)} · ` : participants.length ? `可先问参与成员 ${participants.slice(0, 2).join("、")} · ` : ""}
            <button type="button" className="text-link hover:underline" onClick={onDiscussion}>到项目讨论提问</button>
          </dd>
        </div>
      </dl>
      {data.fetched_at && <p className="mt-3 text-xs text-message-muted">{reported && "进度条统计阶段记录 · "}更新于 <time dateTime={data.fetched_at}>{new Date(data.fetched_at).toLocaleString("zh-CN", {month:"numeric", day:"numeric", hour:"2-digit", minute:"2-digit"})}</time></p>}
      {details.length > 0 && <details className="mt-3 border-t pt-2 text-sm">
        <summary className="cursor-pointer font-medium">详细记录</summary>
        <ul className="mt-1 list-inside list-disc space-y-1 text-message-muted">
          {details.map((note, index) => <li key={index}><MessageBody nodes={displayBody(bodyFromPlainText(note), note, location.hostname)} mentions={[]} className="inline"/></li>)}
        </ul>
      </details>}
    </section>
  );
}
