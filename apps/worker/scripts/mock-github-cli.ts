/** A GitHub CLI fixture that records commands and bodies without contacting GitHub. */
export const MOCK_GITHUB_CLI = String.raw`
import {appendFileSync, existsSync, readFileSync, writeFileSync} from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const [kind, verb] = args;
const env = process.env;
const file = name => path.join(env.GH_LOG, name);
const option = name => args[args.indexOf(name) + 1];
const save = (name, value) => writeFileSync(file(name), JSON.stringify(value));
const log = value => console.log(value);
const url = "https://github.com/" + env.GITHUB_REPOSITORY;
appendFileSync(file("calls"), args.join(" ") + "\n");
if (verb === "create" || verb === "edit") {
  writeFileSync(file(verb === "edit" ? "edit-body" : kind + "-body"), readFileSync(0));
}
if (kind === "pr" && verb === "create") {
  if (env.GH_PR_FAILS) { console.error(env.GH_PR_FAILS); process.exit(1); }
  const pull = url + "/pull/7";
  save("pulls", [{url:pull, state:"OPEN", headRefName:option("--head"), isCrossRepository:false}]);
  log(pull);
} else if (kind === "issue" && verb === "create") {
  const issue = url + "/issues/8";
  save("issues", [{url:issue, state:"OPEN", title:option("--title"), author:{is_bot:true, login:"app/github-actions"}}]);
  log(issue);
} else if (verb === "list") {
  const [override, name] = kind === "pr" ? [env.GH_PULLS, "pulls"] : [env.GH_ISSUES, "issues"];
  log(override || (existsSync(file(name)) ? readFileSync(file(name), "utf8") : "[]"));
}
`;
