import {render, screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {it, expect} from "vitest";
import {displayBody} from "@ember/richtext/dom";
import {PulseReply} from "./pulse-reply";

it("shows three summary rows and independently reveals evidence and provenance",async()=>{
  const html="<p>【结构化查询模式，非 LLM 分析】project-pulse</p><p>负责人：JIAWEI WANG</p><p>进度：4/5 阶段记录完成，非业务验收</p><p>待办：多机验收</p><p>阶段证据：真实采集摘要</p><p>来源：http://192.168.16.70:4185/api/v1/dashboard?days=7</p>";
  render(<PulseReply nodes={displayBody(html,"","localhost")} text="" mentions={[]}/>);
  expect(screen.getByText("JIAWEI WANG")).toBeVisible();
  expect(screen.getByText("多机验收")).toBeVisible();
  expect(screen.queryByText(/真实采集摘要/)).not.toBeInTheDocument();
  expect(screen.queryByRole("link",{hidden:true})).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button",{name:"展开详情"}));
  expect(screen.getByText(/真实采集摘要/)).toBeVisible();
  expect(screen.queryByRole("link",{hidden:true})).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button",{name:"查看来源"}));
  expect(screen.getByRole("link")).toHaveAttribute("href","http://192.168.16.70:4185/api/v1/dashboard?days=7");
});
it("does not invent missing summary fields in an older owner-only reply",()=>{
  const text="【结构化查询模式，非 LLM 分析】jxaccount\n负责人（参与成员）：ZoeImport · 294adebd51c5 · 1 个采集会话";
  const html="<p>【结构化查询模式，非 LLM 分析】jxaccount</p><p>负责人（参与成员）：ZoeImport · 294adebd51c5 · 1 个采集会话</p>";
  render(<PulseReply nodes={displayBody(html,text,"localhost")} text={text} mentions={[]}/>);
  expect(screen.getByText("ZoeImport")).toBeVisible();
  expect(screen.queryByText("进度",{exact:true})).not.toBeInTheDocument();
  expect(screen.queryByText("待办",{exact:true})).not.toBeInTheDocument();
});
