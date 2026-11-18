import type { PulseIntroduction } from "@ember/protocol";

const contexts: Record<string, PulseIntroduction> = {
  "project-pulse": {background: "研发活动分散在多台电脑、Codex 会话和 GitHub，团队需要统一查看真实进展及产出依据。", pains: ["手工汇报滞后，难以核对数字来源", "多机定时采集需要持续验收", "代码产出与业务验收容易混淆"], value: "把会话、PR、Token 与阶段证据归到同一项目，降低研发汇报与核验成本。"},
  jxaccount: {background: "多个公司和业务入口需要共享飞书身份与组织目录，同时按公司限定访问范围。", pains: ["公司入口与权限配置分散", "组织同步不能替代真实员工登录验收", "密钥轮换需要协调并留证"], value: "统一身份与目录，减少重复接入和权限维护，让业务访问边界可核查。"},
  "mfa-approval": {background: "受管账号的验证码需要经过审批后，提取指定的 TOTP 或邮箱登录验证码并投递。", pains: ["人工转发验证码耗时且难追溯", "邮件发件地址变化会影响提取", "修复后仍需新邮件与审批回执验收"], value: "将申请、审批和投递串起来，使受管账号的登录协作有明确的流程和记录。"},
  "wzwx-score": {background: "王者万象棋赛事组织与玩家数据需要覆盖报名、赛果采集、成绩导出及账户认证。", pains: ["赛事名单与玩家身份需要核对", "手机表单、性能与无障碍仍待走查", "缓存、采集与正式业务验收需要分开确认"], value: "围绕完整赛事流程集中管理数据，减少人工整理与重复核对。"},
  "deltaforce-game-library": {background: "三角洲行动资料分散在资源文件、玩家页面、媒体和查询入口，需要可追溯的资料库。", pains: ["迁移期间真实入口恢复尚未闭环", "部分数值语义和材质动画仍待证", "历史发布成果不代表当前服务可用"], value: "让玩家页面与 Agent 查询共用有来源依据的资料，同时标明版本、限制和待证内容。"},
  "xiaoxing-voice-changer": {background: "直播运营需要稳定的实时 AI 变声、清晰的设备路由以及可回退的在线更新。", pains: ["软件估计延迟与完整声学链路不同", "新版多音色长测和真人听感仍需实测", "轻声短句完整性需要对照验证"], value: "降低开播配置与维护成本，用可回退交付和明确验收范围支撑业务体验。"},
};
export function pulseIntroduction(key: string): PulseIntroduction | undefined { return contexts[key.split("/").at(-1)!]; }
