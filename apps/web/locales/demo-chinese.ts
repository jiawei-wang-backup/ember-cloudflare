import {readFileSync} from "node:fs";
import ts from "typescript";
import type {Plugin} from "vite";

const messages: Record<string,string> = JSON.parse(readFileSync(new URL("./zh-CN.json", import.meta.url), "utf8"));
const labelFields = new Set(["aria-label","aria-description","title","label","placeholder","alt","heading","description","name","tooltip","message"]);
function isLabel(node: ts.Node): boolean {
  const parent = node.parent;
  if (ts.isJsxAttribute(parent) || ts.isPropertyAssignment(parent)) {
    const key = parent.name.getText();
    const group = parent.parent.parent;
    return labelFields.has(key) || key.endsWith("Label") || key === "link" ||
      (ts.isVariableDeclaration(group) && /(?:_LABELS$|^FORMATTING_NAMES$)/.test(group.name.getText()));
  }
  if (ts.isJsxExpression(parent)) return !ts.isJsxAttribute(parent.parent) || labelFields.has(parent.parent.name.getText());
  if (ts.isConditionalExpression(parent)) return parent.condition !== node;
  if (ts.isCallExpression(parent)) return ["confirm","alert","useTitle","setError","flash"].includes(parent.expression.getText());
  if (ts.isVariableDeclaration(parent)) return /label|placeholder|title|^CONFIRM_/i.test(parent.name.getText());
  return false;
}

/** Localize authored UI strings before JSX compilation. Message bodies and API values stay data. */
export function demoChinese(): Plugin {
  return {
    name:"ember-demo-chinese",
    enforce:"pre",
    apply:(_, env) => env.mode === "demo-cn",
    transformIndexHtml: html => html.replace('lang="en"', 'lang="zh-CN"'),
    transform(source,id) {
      if (!id.includes("/apps/web/src/") || (!id.endsWith(".tsx") && !id.endsWith("/lib/involvement.ts") && !id.endsWith("/lib/formatting.ts"))) return;
      const file = ts.createSourceFile(id,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
      const changes: Array<{start:number; end:number; value:string}> = [];
      function visit(node: ts.Node) {
        if (ts.isJsxText(node)) {
          const value = messages[node.text.trim()];
          if (value) changes.push({start:node.pos,end:node.end,value:node.text.replace(node.text.trim(),value)});
        } else if (ts.isStringLiteral(node) && isLabel(node) && messages[node.text]) {
          changes.push({start:node.getStart(file),end:node.end,value:JSON.stringify(messages[node.text])});
        } else if (ts.isTemplateExpression(node) && (isLabel(node) || id.endsWith("/composer.tsx"))) {
          const prefixes: Record<string,string> = {"Message ":"发消息给 ","Remove ":"移除 ","Choose ":"选择","Use ":"使用 ","Delete ":"删除 ","Move ":"移动 ","Settings for ":"设置："};
          const prefix = prefixes[node.head.text];
          if (prefix) {
            changes.push({start:node.head.getStart(file)+1,end:node.head.end-2,value:prefix});
            const tail = node.templateSpans.at(-1)!.literal;
            if (tail.text === " icon") changes.push({start:tail.getStart(file)+1,end:tail.end-1,value:"图标"});
          }
        }
        ts.forEachChild(node,visit);
      }
      visit(file);
      for (const {start,end,value} of changes.reverse()) source=source.slice(0,start)+value+source.slice(end);
      return source;
    },
  };
}
