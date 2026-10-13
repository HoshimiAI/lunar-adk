export const PLAYGROUND_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>Lunar ADK Playground</title>
  <style>
    :root { color-scheme: dark; font: 14px/1.5 ui-sans-serif, system-ui, sans-serif; background: #090d16; color: #e6edf7; }
    * { box-sizing: border-box; }
    body { margin: 0; }
    main { max-width: 1040px; margin: 0 auto; padding: 32px 20px 56px; }
    h1 { margin: 0; font-size: 25px; letter-spacing: -.04em; }
    p { color: #91a0b7; margin: 5px 0 22px; }
    label { display: block; color: #aab7ca; font-size: 12px; margin: 0 0 6px; }
    input, textarea, button { font: inherit; }
    input, textarea { width: 100%; border: 1px solid #2a3548; border-radius: 8px; color: #e6edf7; background: #0d1421; padding: 10px 12px; outline: none; }
    input:focus, textarea:focus { border-color: #7198dc; box-shadow: 0 0 0 3px #4267a333; }
    textarea { resize: vertical; min-height: 88px; }
    button { color: #e6edf7; background: #233b61; border: 1px solid #395782; border-radius: 8px; padding: 9px 14px; cursor: pointer; }
    button:hover:not(:disabled) { background: #2b4a76; }
    button:disabled { opacity: .55; cursor: wait; }
    button.secondary { background: #151e2c; border-color: #2a3548; }
    button.danger { color: #ffc3c3; background: #351e27; border-color: #60303d; }
    .toolbar { display: grid; grid-template-columns: 1fr auto auto; align-items: end; gap: 10px; margin-bottom: 14px; }
    .token { margin-bottom: 18px; }
    .composer { display: grid; grid-template-columns: 1fr auto; gap: 10px; align-items: end; }
    .panel { border: 1px solid #202a3b; background: #101725; border-radius: 12px; overflow: hidden; }
    .panel-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 13px 16px; border-bottom: 1px solid #202a3b; }
    .panel-head strong { font-size: 13px; }
    .muted, #status { color: #91a0b7; font-size: 12px; }
    #messages { display: flex; flex-direction: column; gap: 12px; min-height: 240px; max-height: 55vh; overflow: auto; padding: 16px; }
    .message { max-width: 90%; white-space: pre-wrap; overflow-wrap: anywhere; border: 1px solid #263247; background: #121c2b; border-radius: 10px; padding: 11px 13px; }
    .message.user { align-self: flex-end; background: #172a45; border-color: #2c4a72; }
    .message.assistant, .message.tool { align-self: flex-start; }
    .message.tool { color: #b7c5d8; background: #0c131e; }
    .role { margin-bottom: 4px; color: #91a0b7; font-size: 10px; text-transform: uppercase; letter-spacing: .08em; }
    .empty { margin: auto; text-align: center; color: #91a0b7; }
    #approval { display: none; margin-top: 14px; padding: 14px; border: 1px solid #594b2c; border-radius: 10px; background: #211e16; }
    #approval p { margin: 4px 0 10px; }
    .approval-actions { display: flex; gap: 8px; }
    #error { min-height: 20px; color: #ffaaaa; margin-top: 10px; white-space: pre-wrap; }
    @media (max-width: 650px) { main { padding: 22px 12px; } .toolbar { grid-template-columns: 1fr 1fr; } .toolbar > div:first-child { grid-column: 1 / -1; } .composer { grid-template-columns: 1fr; } .composer button { justify-self: end; } #messages { max-height: 60vh; } }
  </style>
</head>
<body>
  <main>
    <h1>Lunar ADK Playground</h1>
    <p>Run the default assistant, continue a session, and review tool approvals. Requests use this app's normal authentication and authorization.</p>
    <div class="toolbar">
      <div><label for="session">Session ID</label><input id="session" autocomplete="off" placeholder="New session on first run"></div>
      <button class="secondary" id="load">Load session</button>
      <button class="secondary" id="new">New session</button>
    </div>
    <div class="token"><label for="token">Bearer token <span class="muted">(optional; kept only in this page)</span></label><input id="token" type="password" autocomplete="off" placeholder="Leave blank to use cookie authentication"></div>
    <section class="panel">
      <div class="panel-head"><strong>Conversation</strong><span id="status">Ready</span></div>
      <div id="messages" aria-live="polite"><div class="empty">Send a message to start testing.</div></div>
    </section>
    <div id="approval" role="status">
      <strong>Tool approval required</strong><p id="approval-detail"></p>
      <div class="approval-actions"><button id="approve">Approve and continue</button><button id="reject" class="danger">Reject</button></div>
    </div>
    <form id="form" class="composer" style="margin-top:14px">
      <div><label for="input">Message</label><textarea id="input" required maxlength="32000" placeholder="Ask the assistant to do something…"></textarea></div>
      <button id="send" type="submit">Run</button>
    </form>
    <div id="error" role="alert"></div>
  </main>
  <script>
    const $ = selector => document.querySelector(selector);
    const session = $("#session"), input = $("#input"), messages = $("#messages"), status = $("#status"), errorBox = $("#error");
    let pending = null;
    function setBusy(busy, label) { $("#send").disabled = busy; $("#load").disabled = busy; status.textContent = label || (busy ? "Working…" : "Ready"); }
    function addMessage(role, content) {
      if (messages.querySelector(".empty")) messages.replaceChildren();
      const item = document.createElement("div"); item.className = "message " + role;
      const heading = document.createElement("div"); heading.className = "role"; heading.textContent = role;
      const body = document.createElement("div"); body.textContent = content || "";
      item.append(heading, body); messages.append(item); messages.scrollTop = messages.scrollHeight;
    }
    function showEmpty(text) { messages.replaceChildren(); const item = document.createElement("div"); item.className = "empty"; item.textContent = text; messages.append(item); }
    function headers(json = false) {
      const result = { accept: "application/json" };
      if (json) result["content-type"] = "application/json";
      const token = $("#token").value.trim(); if (token) result.authorization = "Bearer " + token;
      return result;
    }
    async function request(url, options = {}) {
      const response = await fetch(url, { credentials: "same-origin", ...options, headers: { ...headers(Boolean(options.body)), ...(options.headers || {}) } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Request failed (" + response.status + ")");
      return data;
    }
    async function loadSession() {
      const id = session.value.trim(); if (!id) return;
      setBusy(true, "Loading session…"); errorBox.textContent = "";
      try {
        const data = await request("/sessions/" + encodeURIComponent(id));
        messages.replaceChildren();
        for (const item of data.history || []) {
          if (["user", "assistant", "tool"].includes(item.role)) addMessage(item.role, item.content || (item.toolCalls ? "Requested tools: " + item.toolCalls.map(call => call.name).join(", ") : ""));
        }
        if (!messages.children.length) showEmpty("This session has no conversation messages yet.");
        status.textContent = "Loaded " + id.slice(0, 8);
      } catch (error) { errorBox.textContent = error.message; status.textContent = "Load failed"; }
      finally { setBusy(false); }
    }
    function setApproval(approval, runId) {
      pending = approval ? { approvalId: approval.id, runId } : null;
      $("#approval").style.display = pending ? "block" : "none";
      if (pending) $("#approval-detail").textContent = approval.toolName + " · " + JSON.stringify(approval.input);
    }
    async function refreshSession(id) {
      if (!id) return;
      const data = await request("/sessions/" + encodeURIComponent(id));
      messages.replaceChildren();
      for (const item of data.history || []) {
        if (["user", "assistant", "tool"].includes(item.role)) addMessage(item.role, item.content || (item.toolCalls ? "Requested tools: " + item.toolCalls.map(call => call.name).join(", ") : ""));
      }
      if (!messages.children.length) showEmpty("No conversation messages yet.");
    }
    $("#form").addEventListener("submit", async event => {
      event.preventDefault(); const text = input.value.trim(); if (!text) return;
      errorBox.textContent = ""; setApproval(null); setBusy(true, "Running agent…");
      try {
        const data = await request("/run", { method: "POST", headers: headers(true), body: JSON.stringify({ input: text, ...(session.value.trim() ? { sessionId: session.value.trim() } : {}) }) });
        session.value = data.sessionId || session.value; input.value = "";
        if (data.pendingApproval) setApproval(data.pendingApproval, data.runId);
        await refreshSession(session.value);
        status.textContent = data.status === "waiting_approval" ? "Waiting for approval" : "Run " + data.status;
      } catch (error) { errorBox.textContent = error.message; status.textContent = "Run failed"; }
      finally { setBusy(false); }
    });
    async function decide(approve) {
      if (!pending) return;
      const current = pending; setBusy(true, approve ? "Approving tool…" : "Rejecting tool…"); errorBox.textContent = "";
      try {
        const data = await request("/runs/" + encodeURIComponent(current.runId) + "/" + (approve ? "approve" : "reject"), { method: "POST", headers: headers(true), body: JSON.stringify({ approvalId: current.approvalId }) });
        setApproval(data.pendingApproval, data.runId || current.runId);
        await refreshSession(session.value);
        status.textContent = data.status === "waiting_approval" ? "Waiting for approval" : "Run " + data.status;
      } catch (error) { errorBox.textContent = error.message; status.textContent = "Decision failed"; }
      finally { setBusy(false); }
    }
    $("#approve").addEventListener("click", () => decide(true));
    $("#reject").addEventListener("click", () => decide(false));
    $("#load").addEventListener("click", loadSession);
    $("#new").addEventListener("click", () => { session.value = ""; setApproval(null); errorBox.textContent = ""; showEmpty("Send a message to start a new session."); status.textContent = "New session"; });
  </script>
</body>
</html>`;
