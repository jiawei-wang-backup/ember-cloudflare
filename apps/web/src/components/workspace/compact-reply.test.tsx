import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { displayBody } from "@ember/richtext/dom";
import { CompactReply } from "./compact-reply";

function show(html: string) {
  render(<CompactReply nodes={displayBody(html, "", location.hostname)} mentions={[]}/>);
}

describe("compact automated replies", () => {
  it("keeps a short answer fully visible", () => {
    show("<p>导出已修好，可以在项目页重试。</p>");
    expect(screen.getByText("导出已修好，可以在项目页重试。")).toBeVisible();
    expect(screen.queryByText("详情和链接")).not.toBeInTheDocument();
  });

  it("only shows the lead by default and expands the original details and links", async () => {
    show('<p>导出已修好，等业务验收。</p><ul><li>回归确认零条和多条数据。</li></ul><p><a href="https://example.org/reports/123">验收记录</a></p>');
    expect(screen.getByText("导出已修好，等业务验收。")).toBeVisible();
    expect(screen.queryByText("回归确认零条和多条数据。")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", {name:"验收记录"})).not.toBeInTheDocument();
    await userEvent.click(screen.getByText("详情和链接"));
    expect(screen.getByRole("link", {name:"验收记录"})).toHaveAttribute("href", "https://example.org/reports/123");
    expect(screen.getByText("回归确认零条和多条数据。")).toBeVisible();
    await userEvent.click(screen.getByRole("button", {name:"收起详情"}));
    expect(screen.queryByRole("link", {name:"验收记录"})).not.toBeInTheDocument();
  });

  it("shows the answer before the question in a shared reply preview", () => {
    show('<p><strong>项目助手 · 什么时候能上线？</strong></p><p>先等业务确认。</p><p><a href="https://example.org">上线记录</a></p>');
    expect(screen.getByText("先等业务确认。")).toBeVisible();
    expect(screen.queryByText("项目助手 · 什么时候能上线？")).not.toBeInTheDocument();
  });

  it("preserves the full text of a long single paragraph", () => {
    const text = "先补验收回执。" + "详细检查环境与版本。".repeat(25);
    show(`<p>${text}</p>`);
    expect(screen.getByText("先补验收回执。")).toBeVisible();
    expect(screen.queryByText(text)).not.toBeInTheDocument();
  });
});
