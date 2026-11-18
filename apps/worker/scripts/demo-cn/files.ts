import { readFileSync } from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";
import type { SeedFile } from "../seed/client.ts";
import { agents, projects } from "./data.ts";

const originalFiles = path.resolve(import.meta.dirname, "../seed/files");
export function original(name: string, type: string, renamed = name): SeedFile {
  return { name: renamed, type, bytes: readFileSync(path.join(originalFiles, name)) };
}
export const textFile = (name: string, type: string, contents: string): SeedFile => ({ name, type, bytes: Buffer.from(contents) });

/** Locally drawn flat portraits, with distinct hair, glasses, skin and clothes. */
export function avatar(index: number): SeedFile {
  const palette = ["#315C88", "#258578", "#B55A77", "#B77A36", "#6654A1", "#307FA4", "#B6554D", "#688244", "#53677F", "#4755B8"];
  const rgb = (hex: string) => [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16));
  const shirt = rgb(palette[index % palette.length]!);
  const hair = rgb(["#2B2933", "#483229", "#332E3C", "#533728", "#252B36", "#402C35", "#663F2E", "#313344", "#362A27"][index % 9]!);
  const skin = rgb(["#E9B994", "#F0C6A5", "#D5A07D", "#EAB794", "#EDC5AA", "#DCAF8F", "#EBC2A5", "#D8A887", "#EDBB97"][index % 9]!);
  const size = 192, stride = 1 + size * 3;
  const raw = Buffer.alloc(size * stride);
  const ellipse = (x: number, y: number, cx: number, cy: number, rx: number, ry: number) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let color = shirt.map(c => Math.round(c * .18 + 246 * .82));
    if (ellipse(x, y, 96, 196, 78, 59)) color = shirt;
    if (x > 83 && x < 109 && y > 118 && y < 157) color = skin.map(c => Math.max(0, c - 9));
    if (index === 2 || index === 5 || index === 6) {
      if (ellipse(x, y, 96, 96, 51, 68)) color = hair;
    }
    if (index === 5 && (ellipse(x, y, 55, 49, 18, 19) || ellipse(x, y, 137, 49, 18, 19))) color = hair;
    if (ellipse(x, y, 50, 95, 8, 12) || ellipse(x, y, 142, 95, 8, 12)) color = skin;
    if (ellipse(x, y, 96, 89, 45, 54)) color = skin;
    if (ellipse(x, y, 96, 54, 47, 27) && y < 65 + (index % 3 === 0 ? (x - 55) * .24 : (140 - x) * .15)) color = hair;
    if ((x < 58 || x > 134) && y > 55 && y < 90 && ellipse(x, y, 96, 83, 47, 43)) color = hair;
    if (y >= 81 && y <= 84 && ((x >= 69 && x <= 82) || (x >= 110 && x <= 123))) color = hair;
    if (ellipse(x, y, 77, 94, 3, 4) || ellipse(x, y, 115, 94, 3, 4)) color = [36, 33, 40];
    if (ellipse(x, y, 95, 108, 4, 3)) color = skin.map(c => Math.max(0, c - 25));
    if (y >= 120 && y <= 123 && x >= 86 && x <= 105) color = [155, 82, 77];
    if (index === 0 || index === 3 || index === 8) {
      if ((ellipse(x, y, 77, 95, 16, 12) && !ellipse(x, y, 77, 95, 13, 9)) || (ellipse(x, y, 115, 95, 16, 12) && !ellipse(x, y, 115, 95, 13, 9)) || (y >= 93 && y <= 95 && x > 91 && x < 101)) color = hair;
    }
    if (index === 8 && y > 127 && ellipse(x, y, 96, 124, 27, 17)) color = hair;
    if (index === 9) {
      color = shirt.map(c => Math.round(c * .18 + 246 * .82));
      if (ellipse(x, y, 96, 196, 78, 59)) color = shirt;
      if (x > 48 && x < 144 && y > 48 && y < 137) color = shirt;
      if (x > 60 && x < 132 && y > 65 && y < 119) color = [239, 244, 255];
      if (ellipse(x, y, 78, 87, 7, 9) || ellipse(x, y, 114, 87, 7, 9)) color = shirt;
      if (x > 80 && x < 112 && y > 105 && y < 109) color = shirt;
      if (x > 93 && x < 99 && y > 28 && y < 49) color = shirt;
      if (ellipse(x, y, 96, 25, 8, 8)) color = [236, 145, 73];
    }
    for (let c = 0; c < 3; c++) raw[y * stride + 1 + x * 3 + c] = color[c]!;
  }
  const chunk = (name: string, data: Buffer) => {
    const value = Buffer.concat([Buffer.from(name), data]);
    let crc = 0xffffffff;
    for (const b of value) { crc ^= b; for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, value, checksum]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  return { name: `成员头像-${index}.png`, type: "image/png", bytes: Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]) };
}

export function attachments(): Array<{ room: string; file: SeedFile; preview?: SeedFile }> {
  return [
    { room: "直播监控平台", file: textFile("直播监控平台-状态同步接口说明.html", "text/html", '<!doctype html><html lang="zh"><meta charset="utf-8"><title>状态同步接口说明 · 演示</title><h1>直播监控平台：状态同步</h1><p>模拟 API，不连接真实服务。GET /demo/status?roomId=room-001</p><pre>{"revision":128,"status":"live","updatedAt":"运行日期"}</pre><p>先读快照，再订阅增量；拒绝旧 revision。PR #128 只表示模拟开发事件，尚需压测验收。</p></html>') },
    { room: "直播监控平台", file: textFile("直播监控平台-性能测试结果.csv", "text/csv", "场景,修复前p95毫秒,修复后p95毫秒,数据性质\n绘图阻塞,820,180,合成演示\n重连恢复,1200,230,合成演示\n") },
    { room: "直播监控平台", file: textFile("直播监控平台-阶段总结.md", "text/markdown", "# 阶段总结（演示数据）\n核心链路已联调，背景进度 60%。\n\n## PR #128\nrevision 解决旧快照覆盖；断网恢复用例通过。\n\n## 未完成\n生产规模压测、长时间运行、业务验收。\n") },
    { room: "智能剪辑工作台", file: textFile("智能剪辑工作台-高光片段测试报告.html", "text/html", '<!doctype html><meta charset="utf-8"><h1>高光片段测试报告（演示）</h1><p>合成区间 [12,18] 秒扩展为 [10,20] 秒；重叠区间合并。字幕误差目标一帧。</p><p>本地示例视频用于验证播放，不是 AI 识别产物；准确率尚未评估。</p>') },
    { room: "智能剪辑工作台", file: original("prototype.mp4", "video/mp4", "智能剪辑工作台-播放器测试素材.mp4"), preview: original("prototype-poster.jpg", "image/jpeg") },
    { room: "AI接入网关", file: textFile("AI接入网关-Token消耗统计.csv", "text/csv", "项目,模型,输入Token,输出Token,估算费用微单位,数据性质\n直播监控平台,demo-model-a,1600,400,2400,合成演示\n智能剪辑工作台,demo-model-b,3000,700,8500,合成演示\n") },
    { room: "AI接入网关", file: textFile("AI接入网关-响应示例.json", "application/json", JSON.stringify({ demo: true, model: "demo-model-a", inputTokens: 1600, outputTokens: 400, estimated: true, retryBudget: 2, providerConnected: false }, null, 2)) },
    { room: "直播互动组件", file: textFile("直播互动组件-兼容性测试报告.md", "text/markdown", "# 兼容性测试（合成演示）\n\n|场景|结果|\n|中文输入法|修复 isComposing 分支|\n|重连重复事件|eventId 去重通过|\n|旧系统|未测|\n\nCI 通过不等于业务验收，长时压力测试待执行。\n") },
    { room: "直播互动组件", file: textFile("直播互动组件-事件契约.json", "application/json", JSON.stringify({ demo: true, eventId: "demo-128", roomId: "room-001", kind: "comment", payload: { text: "组件联调成功" }, revision: 128 }, null, 2)) },
    { room: "统一设计组件库", file: textFile("统一设计组件库-页面布局示意.svg", "image/svg+xml", '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540"><rect width="960" height="540" fill="#eef2f7"/><rect x="20" y="20" width="220" height="500" rx="12" fill="#253858"/><rect x="260" y="20" width="680" height="80" rx="12" fill="white"/><rect x="260" y="120" width="680" height="400" rx="12" fill="white"/><text x="285" y="70" font-size="26">组件库 · 页面布局示意（模拟，非真实截图）</text><text x="285" y="180" font-size="22">加载 / 空数据 / 失败 / 成功</text><rect x="285" y="215" width="180" height="48" rx="8" fill="#2d5eaa"/><text x="305" y="247" fill="white" font-size="20">主要按钮</text></svg>') },
    { room: "内容策略中台", file: textFile("内容策略中台-需求访谈提纲.md", "text/markdown", "# 需求访谈（模拟）\n1. 策略配置解决哪类运营问题？\n2. 曝光、点击、完播如何定义？\n3. 谁负责确认数据口径？\n4. 历史版本与发布审核如何区分？\n\n阶段：筹备中，尚未排开发。\n") },
    { room: "项目进度", file: textFile("研发团队-项目需求说明.html", "text/html", `<!doctype html><meta charset="utf-8"><h1>Project Pulse 研发需求（演示）</h1>${projects.map(p => `<h2>${p.name} · ${p.progress}</h2><p>${p.description}</p>`).join("")}<p>所有进度为模拟背景，不关联真实公司系统。</p>`) },
    { room: "项目进度", file: textFile("研发团队-AI助手配置.json", "application/json", JSON.stringify({ status: "仅配置草案，未调用模型", agents }, null, 2)) },
    { room: "统一设计组件库", file: original("onboarding-v3.png", "image/png", "统一设计组件库-通用页面预览.png"), preview: original("onboarding-v3.png", "image/png") },
  ];
}
