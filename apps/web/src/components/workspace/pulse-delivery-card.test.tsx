import {render, screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {it, expect} from "vitest";
import type {Card} from "@ember/protocol";
import {PulseDeliveryCard} from "./pulse-delivery-card";

const delivery:Card={source:"blocks",parts:[
  {kind:"header",text:"【真实 PR】PR #12 · 登录修复"},
  {kind:"section",fields:[{html:"<p><strong>项目</strong><br>jxaccount</p>",short:true},{html:"<p><strong>记录状态</strong><br>merged</p>",short:true},{html:"<p><strong>来源时间</strong><br>2026-11-16T01:00:00Z</p>",short:true}]},
  {kind:"section",html:"<p>来源仓库：JUXON-AI/jxmcphub<br>真实 PR：https://github.com/JUXON-AI/jxmcphub/pull/12<br>实际证据</p>"},
  {kind:"context",items:[{html:"<p>事件编号：PULSEPR12</p>"}]},
]};
it("prioritizes project, title, status and the actual PR link while folding evidence",async()=>{
  render(<PulseDeliveryCard card={delivery}/>);
  expect(await screen.findByRole("article",{name:"jxaccount · PR #12 · 登录修复"})).toBeVisible();
  expect(screen.getByText("已完成")).toBeVisible();
  expect(screen.getByRole("link",{name:"查看 PR"})).toHaveAttribute("href","https://github.com/JUXON-AI/jxmcphub/pull/12");
  expect(screen.queryByText(/实际证据/)).not.toBeInTheDocument();
  expect(screen.queryByText(/PULSEPR12/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button",{name:"查看交付记录"}));
  expect(screen.getByText(/实际证据/)).toBeVisible();
  expect(screen.getByText("代码变更 · 已合并")).toBeVisible();
});
it("does not add a fabricated PR link to milestone cards",async()=>{
  render(<PulseDeliveryCard card={{...delivery,parts:delivery.parts.filter(p=>p.kind!=="section"||!p.html)}}/>);
  await screen.findByRole("article",{name:"jxaccount · PR #12 · 登录修复"});
  expect(screen.queryByRole("link",{name:"查看 PR"})).not.toBeInTheDocument();
});
