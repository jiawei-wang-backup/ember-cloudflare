const el = id => document.getElementById(id);
const query = new URLSearchParams(location.search);
const room = query.get("room"), revision = query.get("revision");
const path = room && revision ? "/api/onboarding/receipt?" + new URLSearchParams({room, revision}) : null;
let identityFailure = "";

async function readReceipt(method = "GET") {
  const status = el("receipt-status"), confirm = el("confirm"), overview = el("overview");
  el("receipt").hidden = false;
  confirm.hidden = true;
  overview.hidden = true;
  el("receipt-checks").hidden = true;
  el("copy-receipt").hidden = true;
  el("receipt-copy-status").textContent = "";
  el("receipt-summary").textContent = "";
  try {
    const response = await fetch(path, {method, cache:"no-store"});
    if (response.status === 401) {status.textContent = "请登录本人账号再核验。"; return;}
    if (response.status === 404 || response.status === 400) {
      status.textContent = "当前账号无权访问，或这份回执已过期。请让上报人核对频道权限并重新发链接。";
      return;
    }
    if (!response.ok) throw new Error();
    const receipt = await response.json();
    status.textContent = receipt.peer_confirmed ? "已由另一位成员确认" :
      receipt.can_confirm ? "请核对项目总览后确认" : "等待另一位成员确认";
    el("receipt-room").textContent = receipt.room_name;
    el("receipt-checks").hidden = false;
    el("receipt-summary").textContent = receipt.summary;
    overview.href = "/rooms/" + encodeURIComponent(room) + "?view=overview";
    overview.hidden = false;
    el("copy-receipt").hidden = false;
    confirm.hidden = !receipt.can_confirm || receipt.peer_confirmed;
  } catch {
    status.textContent = "暂时无法核验，请刷新重试。";
  }
}

async function load() {
  const message = el("identity-message"), identity = el("identity-info"), refresh = el("refresh");
  if (refresh.disabled) return;
  refresh.disabled = true;
  el("diagnostics-status").textContent = "";
  identityFailure = "连接失败";
  try {
    const response = await fetch("/api/onboarding", {cache:"no-store"});
    identityFailure = "HTTP " + response.status;
    if (!response.ok) throw new Error();
    const info = await response.json();
    const signedIn = Boolean(info.member);
    el("workspace-name").textContent = info.workspace;
    el("member-name").textContent = info.member ? info.member.name : "未登录";
    el("member-name").dataset.signedIn = String(signedIn);
    el("client-release").textContent = info.client_release;
    message.hidden = true;
    identity.hidden = false;
    el("diagnostics").hidden = true;
    el("start-login").hidden = signedIn;
    el("client-download").classList.toggle("primary", signedIn);
    el("next-step").textContent = signedIn
      ? "下载并解压接入包，用 Codex 打开解压目录，再粘贴下方提示词。"
      : "先登录团队 Ember，再下载接入包。";
    const access = el("workspace-access");
    access.href = info.member ? "/" : "/session/new";
    access.target = info.member ? "_self" : "_blank";
    el("workspace-access-label").textContent = info.member ? "进入工作区" : "登录 Ember";
    el("workspace-access-arrow").textContent = info.member ? "→" : "↗";
    if (path) await readReceipt();
  } catch {
    identity.hidden = true;
    message.textContent = identityFailure === "连接失败"
      ? "连不上团队 Ember。请检查局域网连接，再重新核对。"
      : "团队 Ember 暂时无法核对账号。请稍后重试，持续失败可复制诊断信息发给管理员。";
    message.hidden = false;
    el("diagnostics").hidden = false;
  } finally {
    refresh.disabled = false;
  }
}

async function loadPrompt() {
  const prompt = el("prompt");
  try {
    const response = await fetch("/onboarding/prompt.txt", {cache:"no-store"});
    if (!response.ok) throw new Error();
    prompt.value = await response.text();
    el("prompt-preview").textContent = prompt.value.split("\n", 1)[0];
    el("prompt-details").hidden = false;
    el("copy-prompt").disabled = false;
  } catch {
    el("prompt-preview").textContent = "暂时无法加载提示词，请刷新页面或打开纯文本。";
  }
}

async function copyPrompt() {
  const prompt = el("prompt"), status = el("copy-status");
  try {
    await navigator.clipboard.writeText(prompt.value);
    status.textContent = "已复制";
  } catch {
    el("prompt-details").open = true;
    prompt.focus();
    prompt.select();
    status.textContent = "已选中全文，请按 Ctrl+C 或 ⌘C 复制。";
  }
}

async function copyText(text, status, label) {
  try {
    await navigator.clipboard.writeText(text);
    status.textContent = "已复制";
  } catch {
    window.prompt(label, text);
  }
}

function recheckOnReturn(event) {
  if (event.currentTarget.target === "_blank") window.addEventListener("focus", load, {once:true});
}

el("refresh").addEventListener("click", load);
el("workspace-access").addEventListener("click", recheckOnReturn);
el("start-login").addEventListener("click", recheckOnReturn);
el("confirm").addEventListener("click", () => readReceipt("POST"));
el("copy-prompt").addEventListener("click", copyPrompt);
el("prompt-details").addEventListener("toggle", event => {
  const expanded = event.currentTarget.open;
  el("prompt-toggle").textContent = expanded ? "收起完整提示词" : "查看完整提示词";
  el("prompt-preview").hidden = expanded;
});
el("copy-receipt").addEventListener("click", () => {
  const link = new URL("/onboarding", location.origin);
  link.search = new URLSearchParams({room, revision});
  void copyText(link.href, el("receipt-copy-status"), "手动复制核验链接");
});
el("copy-diagnostics").addEventListener("click", () => {
  const text = "Ember 团队接入\n步骤：核对团队工作区\n结果：" + identityFailure;
  void copyText(text, el("diagnostics-status"), "手动复制诊断信息");
});
void load();
void loadPrompt();
