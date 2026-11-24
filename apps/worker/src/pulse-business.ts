import type {BusinessOverview, PulseSnapshot} from "@ember/protocol";

interface ModuleDefinition {id: string; name: string; outcome: string; scenario: string; help: string; acceptance: string; stages: Array<[string, string]>}
interface Definition {audience: string; outcome: string; modules: ModuleDefinition[]}
const definitions: Record<string, Definition> = {
  "project-pulse": {audience: "项目负责人、业务协作者和开发成员", outcome: "从项目活动走到可核查的业务进展，让协作者知道哪里需要帮助。", modules: [
    {id: "collection", name: "开发活动自动归集", outcome: "开发者日常工作能自动进入对应项目，减少手工汇报。", scenario: "团队成员用不同电脑工作时，负责人可以检查有没有漏记。", help: "帮忙看看各台电脑有没有漏记或重复记录。", acceptance: "几台电脑都能按时自动上传，上传失败的记录稍后能补上。", stages: [["跨平台增量上报与失败续传", "不同系统的电脑都能上传记录"], ["客户端PR与项目状态结构化上报", "自动收集项目进度和开发成果"], ["多机定时同步持续验收", "确认多台电脑能一直按时上传"]]},
    {id: "overview", name: "项目进展与产出查看", outcome: "负责人能从项目总览找到文档与变更依据。", scenario: "开会前看项目进度，需要时打开原始文档核对。", help: "指出哪些描述看不懂、哪些业务问题还没有答案。", acceptance: "非开发协作者能找到阶段进展、相关成员与原始产出链接。", stages: [["项目文档折叠及成员关联修复", "文档能按组收起，并找到相关成员"]]},
    {id: "activity", name: "当前开发活动识别", outcome: "区分近期有活动的项目与需要进一步确认的状态。", scenario: "查看哪些项目仍在开发，结合上报时间判断信息是否过期。", help: "反馈运行状态与实际开发情况不一致的样本。", acceptance: "保留活动时间及判断范围，真实运行样本的表现经复核。", stages: [["放宽运行中的Agent识别", "能看出哪些自动开发任务还在运行"]]},
  ]},
  jxaccount: {audience: "各公司员工、业务系统维护者与身份管理员", outcome: "员工按所属公司使用统一登录与获准的业务服务。", modules: [
    {id: "login", name: "多公司员工登录", outcome: "员工从正确的公司入口完成飞书授权和登录。", scenario: "新公司接入或员工首次使用业务系统。", help: "协调各公司真实员工参与登录验收，反馈失败步骤。", acceptance: "各公司均有真实授权、登录与组织归属的验证记录。", stages: [["扩展多家公司飞书登录入口", "多家公司都能从自己的飞书入口登录"], ["完成各公司真实员工登录验收", "请各公司的员工实际试一次登录"]]},
    {id: "directory", name: "组织目录与业务访问", outcome: "业务系统能识别员工所在组织，并按范围开放服务。", scenario: "员工进入 MCPHub 等业务，核对能访问的资源。", help: "确认组织归属和业务访问范围是否符合实际使用。", acceptance: "目录信息正确，授权与未授权范围均经真实访问验证。", stages: [["同步公司组织目录", "员工和部门信息会自动更新"], ["配置业务访问范围并调整登录界面", "员工只能进入本公司获准使用的服务"]]},
    {id: "credentials", name: "应用凭证维护", outcome: "接入应用的凭证轮换有记录，避免影响业务使用。", scenario: "应用密钥到期或需要轮换时协调验证。", help: "协调轮换窗口与回归人员，不在聊天中提供真实密钥。", acceptance: "换好两把应用密钥后，用员工账号试一次，确认原来的服务照常可用。", stages: [["完成两项应用密钥轮换", "更换两把应用钥匙，确认服务照常使用"]]},
  ]},
  "mfa-approval": {audience: "受管账号使用者与审批人", outcome: "使用者经过审批后获得本次登录所需验证码。", modules: [
    {id: "approval", name: "申请到验证码投递", outcome: "能查到谁申请、谁审批，以及验证码是否发出。", scenario: "需要使用受管账号登录时发起申请。", help: "确认拒绝、超时和重复申请的预期处理方式。", acceptance: "获批后投递正确验证码，拒绝和异常路径均有验证。", stages: [["建立验证码审批申请与投递流程", "可以申请验证码，审批通过后发给申请人"]]},
    {id: "email", name: "登录邮件识别与提取", outcome: "从对应的目标登录邮件提取本次验证码。", scenario: "审批后等待新登录邮件并获取验证码。", help: "配合发出一封新邮件及新申请，核对脱敏回执。", acceptance: "最新修复后，以新邮件和新申请完成一次真实验证。", stages: [["增加OpenAI验证码邮件提取", "能从 OpenAI 登录邮件里找到验证码"], ["完成最新修复后的真实邮箱验收", "用真实邮箱再试一次，确认验证码正确"]]},
    {id: "release", name: "交付版本确认", outcome: "能确认修复是否进入计划使用的版本。", scenario: "验收前核对 PR 与实际部署版本的关系。", help: "提供合并与版本依据，避免拿草稿代码当正式交付。", acceptance: "交付 PR 的合并和使用版本均能核查。", stages: [["确认交付代码的合并状态", "确认修复已纳入要交付的版本"]]},
  ]},
  "wzwx-score": {audience: "赛事组织者、参赛选手和运营协作者", outcome: "完成赛事组织、参赛与赛果交付的完整流程。", modules: [
    {id: "tournament", name: "赛事报名与组织", outcome: "组织者管理名单与签到，选手完成账户认证和报名。", scenario: "举办比赛、导入名单或处理参赛者的登录与报名问题。", help: "由实际组织者与选手走一场比赛流程，指出报名和操作障碍。", acceptance: "真实角色能完成报名与组织流程，账户和旧会话的访问行为符合约定。", stages: [["完善赛事名单、签到和群友赛导入", "能导入群友赛名单并管理签到"], ["完成账户迁移、邮箱流程及认证限制", "已迁移旧账号并调整邮箱验证和登录限制"], ["核验历史会话与自动入组行为", "检查旧登录记录和自动入组是否正常"]]},
    {id: "results", name: "赛果核对与成绩交付", outcome: "组织者拿到可核对的赛果、成绩表和赛局展示。", scenario: "比赛结束后核对成绩、导出结果或提供赛局依据。", help: "确认缺失玩家身份、赛果字段和渲染图片是否满足实际使用；说明渲染图的数据来源。", acceptance: "成绩、玩家标识与原始数据可对照，图片展示与业务接受方式经确认。", stages: [["导出成绩表并补充ShowID", "能导出成绩表并附上玩家编号"], ["完成赛局截图渲染验收", "请赛事组织者核对赛局截图"], ["补齐无法确认的玩家ShowID", "补查还没找到编号的玩家"]]},
    {id: "data", name: "赛局采集与资料服务", outcome: "赛局和玩家资料能持续更新，业务读取有明确来源。", scenario: "查看历史战绩与玩家资料，跟进赛局更新。", help: "提供真实赛局和资料样本，核对缺失字段及更新情况。", acceptance: "正式环境持续采集，缓存、完整字段及玩家资料服务经业务验收。", stages: [["建立静态预签名缓存并跑通定时采集", "已试过定时收集赛果，并保存资料供重复查看"], ["完成PostgreSQL迁移及战斗数据语义整理", "已搬好旧数据并整理比赛数据的含义"], ["完成定时采集正式发布", "让正式系统开始自动收集赛果"], ["完成静态缓存正式发布与业务验收", "确认正式系统能正常打开保存的资料"], ["完成玩家资料与SDK整体验收", "确认玩家资料能查看，也能给其他工具使用"]]},
    {id: "experience", name: "手机与无障碍体验", outcome: "不同设备上的组织者和选手都能顺畅操作。", scenario: "在手机或键盘、辅助技术环境下使用表单和赛事页面。", help: "反馈具体设备、页面和复现步骤，优先解决核心流程阻碍。", acceptance: "手机布局、焦点、标签及核心页面性能完成走查。", stages: [["完成前端性能和无障碍优化", "让常用页面更快，也方便用键盘操作"]]},
  ]},
  "deltaforce-game-library": {audience: "玩家、资料维护者与使用查询能力的业务协作者", outcome: "通过网页或 Agent 查询有来源依据的游戏资料和战绩。", modules: [
    {id: "knowledge", name: "可追溯资料与查询", outcome: "玩家和 Agent 能找到有来源与版本说明的资料。", scenario: "查询装备、游戏条目或需要核对原始资源。", help: "指出缺失或待证字段，提供能核对的来源。", acceptance: "条目、来源、版本与查询结果能够逐项对应。", stages: [["基础资源提取与来源校验", "已整理基础游戏资料，并核对出处"], ["玩家网页与Agent查询交付", "已交付玩家网页和自动查询工具"]]},
    {id: "media", name: "图片与三维资料浏览", outcome: "查看条目对应的图片、模型与展示限制。", scenario: "浏览游戏资源及三维样本，了解支持范围。", help: "核对缺失的模型效果和数值语义，不将待证内容当作定论。", acceptance: "媒体可真实访问，材质、动画和数值限制有明确说明。", stages: [["图片与3D媒体阶段发布", "已发布部分游戏图片和三维模型"], ["完整数值语义与原生模型效果", "核对游戏数值的意思和模型显示效果"]]},
    {id: "matches", name: "战绩查看与更新", outcome: "查看获授权的战绩，并持续获取新增明细。", scenario: "查询历史战绩和新发生的一场对局。", help: "提供获授权的新对局样本，协助核对新增明细。", acceptance: "真实客户端新增数据能被获取并经完整核对。", stages: [["已授权战绩快照发布", "已发布一批获准公开的战绩"], ["自动战绩采集与新增明细验收", "确认新打的每场比赛都能自动更新"]]},
    {id: "access", name: "迁移后恢复使用", outcome: "用户能从真实入口访问网页、查询与媒体。", scenario: "迁移完成后重新使用资料库。", help: "协助核查入口、数据库及媒体访问，明确阻塞与恢复结果。", acceptance: "迁移后的真实入口、资源和查询均有访问回执。", stages: [["F盘迁移与真实入口恢复", "搬完资料后，确认原来的入口能重新打开"]]},
  ]},
  "xiaoxing-voice-changer": {audience: "直播运营、主播与客户端维护者", outcome: "完成首装、开播变声和后续更新维护的业务流程。", modules: [
    {id: "onboarding", name: "首装与开播配置", outcome: "业务用户能安装客户端，选好设备和音色并理解操作方式。", scenario: "新电脑第一次开播或需要调整设备路由。", help: "业务用户按手册走首装和开播检查，反馈不清楚的步骤。", acceptance: "主播照着说明就能装好软件、选对麦克风，并检查观众能否听到变声。", stages: [["实时变声客户端及三音色预设", "已交付实时变声软件和三种音色"], ["完整首装与业务手册交付", "已提供安装包和开播操作手册"]]},
    {id: "voice", name: "直播变声效果与稳定性", outcome: "在实际直播链路中获得稳定、完整且可接受的声音效果。", scenario: "多音色切换、长时间开播与轻声短句表达。", help: "参与真人试听，保留原声对照、版本、设备及直播端反馈。", acceptance: "新版多音色长测、完整声学链路与真人听感均有实际证据。", stages: [["已记录的两小时数字链路测试", "已用一种音色连续测试两小时"], ["整体低于200毫秒与声学验证", "确认说话到听见变声是否少于 0.2 秒"], ["新版多音色长测与直播端验收", "用多种音色长时间开播，检查新版效果"], ["轻声短句完整性与真人对照", "请人试听，确认轻声短句也听得完整"]]},
    {id: "updates", name: "在线更新与回退", outcome: "用户能更新版本，遇到问题时有可核查的回退方式。", scenario: "已有客户端升级新版本并保留配置。", help: "在约定环境中核对更新、配置保留和回退说明。", acceptance: "实际试过升级，也试过遇到问题时切回旧版。", stages: [["0.4.34在线更新和回退", "已验证可以在线升级，也能切回旧版"]]},
  ]},
};

export function businessDefinition(key: string | undefined): Definition | undefined {return key ? definitions[key.split("/").at(-1)!] : undefined;}
const journeys: Record<string, Array<[string, string[]]>> = {
  "project-pulse": [["一次开发活动走到可核查的项目汇报", ["collection", "overview"]], ["多台设备持续同步，运行状态可复核", ["collection", "activity"]]],
  jxaccount: [["员工从公司入口进入获准的业务", ["login", "directory"]], ["凭证维护后，员工仍能使用业务", ["credentials", "login"]]],
  "mfa-approval": [["一笔申请走到本次登录验证码投递", ["approval", "email"]], ["修复版本与真实邮箱验证对应起来", ["release", "email"]]],
  "wzwx-score": [["组织者建赛，选手完成报名", ["tournament", "experience"]], ["赛后核对结果，交付可用成绩", ["results", "data"]], ["正式服务持续更新并方便使用", ["data", "experience"]]],
  "deltaforce-game-library": [["打开真实入口，查询资料并浏览媒体", ["access", "knowledge", "media"]], ["查看历史战绩并获取新增对局", ["access", "matches"]]],
  "xiaoxing-voice-changer": [["业务用户从首装走到实际开播", ["onboarding", "voice"]], ["已有客户端升级，必要时可回退", ["onboarding", "updates"]]],
};
export function businessJourneys(key: string) {return (journeys[key.split("/").at(-1)!] || []).map(([title, moduleIds], index) => ({id: `journey-${index}`, title, moduleIds}));}
export function businessOverview(data: PulseSnapshot): BusinessOverview | undefined {
  const definition = businessDefinition(data.project.key || data.project.full_name);
  if (!definition) {
    const milestones = data.milestones.map((stage, index) => ({
      id: `reported-${index}`, title: stage.title, sourceTitle: stage.title, state: stage.state, evidence: stage.evidence || ""
    }));
    const done = milestones.filter(stage => stage.state === "completed" || stage.state === "accepted");
    const pending = milestones.filter(stage => !done.includes(stage));
    return {
      audience: "", outcome: data.project.goal || "项目目标暂未上报",
      modules: [{id: "reported", name: "项目阶段", outcome: "项目上报的里程碑", scenario: "", help: "",
        acceptance: "", availability: "", milestones, available: done.map(stage => stage.title),
        blockers: pending.map(stage => stage.title), status: data.project.status === "blocked" ? "blocked" :
          pending.length ? "pending" : done.length ? "recorded" : "unknown"}],
      provenance: data.ember_snapshot ? "来自 Ember 项目快照" : "来自 Project Pulse 项目报告"
    };
  }
  const used = new Set<string>();
  const modules = definition.modules.map(module => {
    const milestones = module.stages.flatMap(([sourceTitle, title]) => {
      const source = data.milestones.find(m => m.title === sourceTitle);
      if (!source) return [];
      used.add(sourceTitle);
      return [{id: `${module.id}-${module.stages.findIndex(s => s[0] === sourceTitle)}`, title, sourceTitle, state: source.state, evidence: source.evidence || "来源未提供说明"}];
    });
    const done = milestones.filter(m => ["completed", "accepted"].includes(m.state));
    const pending = milestones.filter(m => !["completed", "accepted"].includes(m.state));
    return {...module, milestones, stages: undefined, status: data.project.status === "blocked" && pending.length ? "blocked" as const : !milestones.length ? "unknown" as const : pending.length ? "pending" as const : "recorded" as const,
      available: done.map(m => m.title), blockers: pending.map(m => `尚待验证：${m.title}`),
      availability: data.project.status === "blocked" ? "项目存在阻塞，历史交付不代表当前入口已恢复" : "以下为已有交付记录，当前完整使用仍需按验收条件确认"};
  });
  const extra = data.milestones.filter(m => !used.has(m.title));
  if (extra.length) modules.push({id: "other", name: "其他阶段记录", outcome: "保留新出现、尚未归入业务模块的阶段证据。", scenario: "来源更新后核对新增事项。", help: "请负责人确认这些事项的业务归属。", acceptance: "明确业务归属后按原始证据复核。", stages: undefined, milestones: extra.map((m, i) => ({id: `other-${i}`, title: m.title, sourceTitle: m.title, state: m.state, evidence: m.evidence || "未提供"})), available: [], blockers: extra.map(m => m.title), status: "unknown", availability: "业务归属待确认"});
  const delivery = businessJourneys(data.project.key || data.project.full_name).map(journey => {
    const involved = modules.filter(m => journey.moduleIds.includes(m.id));
    const stages = involved.flatMap(m => m.milestones), recorded = stages.filter(m => ["completed", "accepted"].includes(m.state)).length;
    return {...journey, acceptance: involved.map(m => m.acceptance).join(" "), recorded, total: stages.length, state: involved.some(m => m.status === "blocked") ? "blocked" as const : involved.length > 0 && involved.every(m => m.status === "recorded") ? "awaiting_acceptance" as const : "pending" as const};
  });
  return {audience: definition.audience, outcome: definition.outcome, modules, journeys: delivery, provenance: data.ember_snapshot
    ? "阶段状态和证据来自 Ember 项目快照。项目可用性与业务验收独立记录。"
    : "业务模块与交付闭环依据项目目标整理；阶段状态与证据逐项引用监控来源。记录完成不等于当前可用或业务验收。"};
}
