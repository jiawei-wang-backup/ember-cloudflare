import { roomSocketQuery, type Message, type RoomId, type ServerFrame } from "@ember/protocol";
import { Conversation, type BotKey, type Ember, type Session } from "../seed/client.ts";

export const projectDeliveries = [
  { project: "直播监控平台", events: [
    ["PR128", "PR 合并", "修复断线重连后的旧快照覆盖", "梁沐", "PR #128 已合并（模拟）", "revision 比较与乱序事件用例已补齐。", "开发完成；仍需验证压测与长时间运行。"],
    ["MONITORCI", "CI 与回归", "断网恢复、重复事件与延迟回归", "林屿", "模拟测试通过", "测试样本 p95 从 820ms 回落到 180ms；数据见本频道 CSV。", "测试样本通过，不代表生产规模与业务验收通过。"],
    ["MONITORACCEPT", "验收跟进", "状态看板阶段交付检查", "顾远", "待业务验收", "最后同步时间与连接恢复状态已进入联调清单。", "压测、低端设备及长时稳定性完成后再确认验收。"],
  ] },
  { project: "智能剪辑工作台", events: [
    ["CLIPPR", "PR 评审", "高光区间扩展与重叠片段合并", "许言", "边界策略已确认（模拟）", "合成时间戳用于测试；示例视频仅演示播放能力。", "识别准确率尚未评估，不把播放器素材当作 AI 输出。"],
    ["CLIPCI", "字幕回归", "23.976 / 25 / 30 fps 时间轴检查", "许言", "模拟字幕回归通过", "统一毫秒时间戳，时间误差目标一帧。", "仍需人工复核口型对齐。"],
    ["CLIPDEPLOY", "部署通知", "智能剪辑工作台 v0.3.2", "苏禾", "测试环境部署成功（模拟）", "剪辑边界与失败反馈已进入演示版本。", "批量素材与导出验收未完成，不代表生产发布。"],
  ] },
  { project: "直播互动组件", events: [
    ["INTERACTIONPR", "修复交付", "eventId 去重与中文输入法保护", "周宁", "开发修复已提交评审（模拟）", "使用有界去重队列，发送前检查 isComposing。", "继续核对桌面和移动 Safari 的事件顺序。"],
    ["INTERACTIONCI", "CI 测试", "互动组件关键路径与兼容性", "罗安", "模拟自动化测试通过", "覆盖重复投递、快速重连、空 payload 与输入法分支。", "旧系统未测项保留在兼容性报告中。"],
    ["INTERACTIONRELEASE", "候选版本门禁", "互动组件灰度前检查", "顾远", "待长时压测与业务验证", "候选范围已冻结，本轮优先修阻塞缺陷。", "测试通过与灰度发布分别确认，背景进度仍为 75%。"],
  ] },
  { project: "AI接入网关", events: [
    ["GATEWAYPR142", "PR 合并", "按项目与模型统计 Token", "陈序", "PR #142 已合并（模拟）", "区分输入、输出及未知 usage，不把未知费用计为零。", "代码阶段完成；供应商账单对账未验收。"],
    ["GATEWAYCI", "契约测试", "费用字段与重试预算检查", "梁沐", "本地 fixture 验证（模拟）", "费用使用整数微单位；最多两次重试，共享总超时。", "未连接真实模型，不产生付费 API 调用。"],
    ["GATEWAYREVIEW", "交付范围评审", "模型路由与跨日汇总", "顾远", "待完整回归", "响应记录实际模型与降级标记，CSV 区分估算与核对结果。", "路由、跨日汇总和模型价格版本仍在后续计划中。"],
  ] },
  { project: "统一设计组件库", events: [
    ["UIPR", "变更交付", "统一 token 与组件状态规范", "罗安", "1.0 范围变更已完成（模拟）", "加载、空数据、失败、成功状态及迁移说明已归档。", "业务数据加载仍由业务页面负责。"],
    ["UICHECK", "可访问性回归", "焦点返回、Escape 与语义标签", "周宁", "模拟键盘走查与自动化通过", "关闭弹窗返回触发按钮；嵌套浮层不穿透关闭。", "新业务接入仍应按集成清单复核。"],
    ["UIACCEPT", "范围验收", "设计组件库 1.0 冻结清单", "沈青", "本次约定范围验收完成（模拟）", "按钮、输入框、对话框与表格按约定范围交付。", "背景进度 100% 仅对应 1.0 范围；图表组件另立版本。"],
  ] },
  { project: "内容策略中台", events: [
    ["CONTENTBRIEF", "需求产物", "运营访谈提纲与指标口径草案", "苏禾", "筹备资料已准备（模拟）", "曝光、点击、完播口径分开记录，访谈提纲见本频道附件。", "尚未冻结需求，不代表开发完成。"],
    ["CONTENTREVIEW", "方案评审", "草稿、审核、发布与历史策略", "沈青", "待评审", "目前仅讨论流程边界，布局探索不代表真实后台已实现。", "先确认使用方与样本基线，再评估实验和分析方案。"],
    ["CONTENTPLAN", "排期协调", "数据依赖与阶段交付边界", "顾远", "筹备中，未安排部署", "先对齐数据口径，不挤占直播监控平台修复时间。", "本项目没有 PR 合并、CI 或上线验收结论。"],
  ] },
] as const;

/** Read persisted timeline pages, rather than a search index that may still be catching up. */
export async function roomHistory(ember: Ember, session: Session, id: RoomId): Promise<Message[]> {
  const Socket = WebSocket as unknown as new (url: string, init: { headers: Record<string, string> }) => WebSocket;
  return new Promise((resolve, reject) => {
    const socket = new Socket(`${ember.origin.replace("http:", "ws:")}/api/rooms/${id}/socket${roomSocketQuery({ visible: false })}`, { headers: { Cookie: session.cookie, Origin: ember.origin } });
    const messages: Message[] = [];
    const finish = (error?: Error) => { clearTimeout(timer); socket.close(); if (error) reject(error); else resolve(messages); };
    const timer = setTimeout(() => finish(new Error(`读取项目卡片超时：${id}`)), 30000);
    socket.addEventListener("error", () => finish(new Error(`项目频道连接失败：${id}`)));
    socket.addEventListener("message", event => {
      const frame = JSON.parse(String(event.data)) as ServerFrame;
      if (frame.type === "error") finish(new Error(frame.message));
      if (frame.type !== "welcome" && frame.type !== "history") return;
      messages.push(...frame.messages);
      if (frame.hasMore && frame.messages.length) socket.send(JSON.stringify({ type: "history.before", before: frame.messages[0]!.id, limit: 100 }));
      else finish();
    });
  });
}

export async function addProjectCards(ember: Ember, admin: Session, bot: BotKey, rooms: Record<string, RoomId>) {
  let added = 0;
  const date = new Intl.DateTimeFormat("sv-SE", { timeZone: "Australia/Melbourne" }).format(new Date());
  for (const { project, events } of projectDeliveries) {
    const id = rooms[project];
    if (!id) throw new Error(`缺少项目频道：${project}`);
    const history = await roomHistory(ember, admin, id);
    const conversation = new Conversation(ember, id);
    let inProject = 0;
    try {
      await conversation.watch(admin);
      for (const [key, event, title, owner, status, evidence, next] of events) {
        const marker = `DEMOCNDELIVERY${key}V1`;
        if (history.some(message => message.creator.id === bot.id && message.plainText.includes(marker))) continue;
        await conversation.post(bot, {
          text: `【演示数据】${project} · ${event} · ${title} · ${status} · ${marker}`,
          blocks: [
            { type: "header", text: { type: "plain_text", text: `【演示数据】${event}` } },
            { type: "section", text: { type: "mrkdwn", text: `*${title}*\n项目：${project}` } },
            { type: "section", fields: [
              { type: "mrkdwn", text: `*状态*\n${status}` },
              { type: "mrkdwn", text: `*负责人*\n${owner}` },
              { type: "mrkdwn", text: "*环境*\n独立本地演示" },
              { type: "mrkdwn", text: `*记录日期*\n${date}` },
            ] },
            { type: "section", text: { type: "mrkdwn", text: `*交付依据*\n${evidence}\n*下一步 / 验收边界*\n${next}` } },
            { type: "context", elements: [{ type: "mrkdwn", text: `模拟事件，不连接真实 GitHub。事件编号：${marker}` }] },
          ],
        });
        inProject++; added++;
      }
    } finally { conversation.close(); }
    console.log(`${project}：新增 ${inProject} 张，目标 ${events.length} 张项目交付卡片。`);
  }
  return added;
}
