import type { AuthPrincipal, ObservabilityExporter, Run, TelemetryRecord } from "@lunar/adk";

const MAX_RUNS = 100;

export interface MonitorSpan {
  id: string;
  parentSpanId?: string;
  name: string;
  kind: Run["trace"][number]["kind"];
  status: Run["trace"][number]["status"];
  startedAt: number;
  endedAt?: number;
}

export interface MonitorRun {
  id: string;
  traceId?: string;
  agent?: string;
  model?: string;
  status: Run["status"];
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  inputTokens: number;
  outputTokens: number;
  spans: MonitorSpan[];
}

interface StoredRun {
  tenantId?: string;
  ownerId?: string;
  view: MonitorRun;
}

export interface TelemetryMonitor {
  exporter: ObservabilityExporter;
  list(principal?: AuthPrincipal, limit?: number): MonitorRun[];
}

/** Retains a small, redacted view of recent ADK run spans for the local monitor page. */
export function createTelemetryMonitor(maxRuns = MAX_RUNS): TelemetryMonitor {
  const runs = new Map<string, StoredRun>();
  const exporter: ObservabilityExporter = {
    export(record: TelemetryRecord) {
      if (record.type !== "run" || !record.run) return;
      const run = record.run;
      const spans = run.trace.map((span) => ({
        id: span.id,
        ...(span.parentSpanId ? { parentSpanId: span.parentSpanId } : {}),
        name: span.name,
        kind: span.kind,
        status: span.status,
        startedAt: span.startedAt,
        ...(span.endedAt === undefined ? {} : { endedAt: span.endedAt }),
      }));
      const view: MonitorRun = {
        id: run.id,
        ...(spans[0] ? { traceId: run.trace[0]!.traceId } : {}),
        ...(run.agent === undefined ? {} : { agent: run.agent }),
        ...(run.model === undefined ? {} : { model: run.model }),
        status: run.status,
        startedAt: run.startedAt,
        ...(run.endedAt === undefined ? {} : { endedAt: run.endedAt, durationMs: Math.max(0, run.endedAt - run.startedAt) }),
        inputTokens: run.usage.inputTokens,
        outputTokens: run.usage.outputTokens,
        spans,
      };
      runs.delete(run.id);
      runs.set(run.id, { tenantId: run.tenantId, ownerId: run.ownerId, view });
      while (runs.size > maxRuns) runs.delete(runs.keys().next().value!);
    },
  };

  return {
    exporter,
    list(principal, requestedLimit = MAX_RUNS) {
      const limit = Math.max(1, Math.min(Math.floor(requestedLimit), MAX_RUNS));
      return [...runs.values()]
        .filter((item) => !principal || (item.tenantId === principal.tenantId && item.ownerId === principal.subjectId))
        .slice(-limit)
        .reverse()
        .map((item) => item.view);
    },
  };
}

export const MONITOR_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>Lunar ADK Monitor</title>
  <style>
    :root { color-scheme: dark; font: 14px/1.5 ui-sans-serif, system-ui, sans-serif; background: #090d16; color: #e6edf7; }
    * { box-sizing: border-box; }
    body { margin: 0; }
    main { max-width: 1180px; margin: 0 auto; padding: 36px 22px 56px; }
    header { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; margin-bottom: 26px; }
    h1 { margin: 0; font-size: 28px; letter-spacing: -.04em; }
    .subtle, .muted { color: #91a0b7; }
    .subtle { margin: 6px 0 0; }
    #updated { white-space: nowrap; font-size: 12px; color: #91a0b7; }
    .cards { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 20px; }
    .card, .panel { border: 1px solid #202a3b; background: #101725; border-radius: 12px; }
    .card { padding: 16px; }
    .label { font-size: 12px; color: #91a0b7; }
    .value { margin-top: 5px; font-size: 24px; font-weight: 650; }
    .panel { overflow: hidden; }
    .panel-head { display: flex; justify-content: space-between; padding: 15px 18px; border-bottom: 1px solid #202a3b; }
    .panel-head strong { font-size: 14px; }
    .table-wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; min-width: 720px; }
    th, td { text-align: left; padding: 12px 16px; border-bottom: 1px solid #1d2737; vertical-align: top; }
    th { color: #91a0b7; font-size: 11px; font-weight: 550; text-transform: uppercase; letter-spacing: .08em; }
    tr:last-child td { border-bottom: 0; }
    code { color: #b7c9e6; font-size: 12px; }
    .pill { display: inline-block; border-radius: 99px; padding: 2px 8px; font-size: 11px; background: #1c2940; color: #aacbff; }
    .pill.error { color: #ffb1b1; background: #3a2029; }
    .pill.running, .pill.waiting_approval { color: #f5d184; background: #3a3120; }
    details { margin-top: 7px; }
    summary { color: #91a0b7; font-size: 11px; cursor: pointer; }
    .span { display: flex; justify-content: space-between; gap: 18px; padding: 7px 0 0 10px; font-size: 12px; }
    .empty { padding: 42px 18px; text-align: center; color: #91a0b7; }
    @media (max-width: 700px) { main { padding: 24px 14px; } header { align-items: flex-start; flex-direction: column; } .cards { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  </style>
</head>
<body>
  <main>
    <header>
      <div><h1>Lunar ADK Monitor</h1><p class="subtle">Recent run traces captured through ADK observability. Refreshes every 5 seconds.</p></div>
      <div id="updated">Connecting…</div>
    </header>
    <section class="cards" aria-label="Run summary">
      <div class="card"><div class="label">Retained runs</div><div class="value" id="runs">—</div></div>
      <div class="card"><div class="label">Failed runs</div><div class="value" id="failed">—</div></div>
      <div class="card"><div class="label">Input tokens</div><div class="value" id="input">—</div></div>
      <div class="card"><div class="label">Output tokens</div><div class="value" id="output">—</div></div>
    </section>
    <section class="panel">
      <div class="panel-head"><strong>Recent runs</strong><span class="muted" id="count"></span></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Run</th><th>Agent / model</th><th>Status</th><th>Duration</th><th>Tokens</th><th>Trace spans</th></tr></thead>
        <tbody id="rows"><tr><td colspan="6" class="empty">Waiting for the first completed run…</td></tr></tbody>
      </table></div>
    </section>
  </main>
  <script>
    const escapeHtml = value => String(value ?? "—").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
    const formatDuration = ms => ms == null ? "—" : ms < 1000 ? Math.round(ms) + " ms" : (ms / 1000).toFixed(2) + " s";
    const formatTime = ms => new Date(ms).toLocaleString();
    async function refresh() {
      const updated = document.querySelector("#updated");
      try {
        const response = await fetch("/monitor/api/runs", { credentials: "same-origin", headers: { accept: "application/json" } });
        if (!response.ok) throw new Error("Monitor API returned " + response.status);
        const data = await response.json();
        const runs = data.runs;
        document.querySelector("#runs").textContent = runs.length;
        document.querySelector("#failed").textContent = runs.filter(run => run.status === "failed").length;
        document.querySelector("#input").textContent = runs.reduce((total, run) => total + run.inputTokens, 0).toLocaleString();
        document.querySelector("#output").textContent = runs.reduce((total, run) => total + run.outputTokens, 0).toLocaleString();
        document.querySelector("#count").textContent = runs.length + " shown";
        document.querySelector("#rows").innerHTML = runs.length ? runs.map(run => {
          const statusClass = run.status === "failed" ? "error" : ["running", "waiting_approval"].includes(run.status) ? run.status : "";
          const spans = run.spans.map(span => '<div class="span"><span><span class="pill ' + (span.status === "error" ? "error" : "") + '">' + escapeHtml(span.kind) + '</span> ' + escapeHtml(span.name) + '</span><span class="muted">' + escapeHtml(span.status) + ' · ' + escapeHtml(formatDuration(span.endedAt == null ? null : span.endedAt - span.startedAt)) + '</span></div>').join("");
          const trace = run.spans.length ? '<details><summary>View trace</summary>' + spans + '</details>' : "";
          return '<tr><td><code>' + escapeHtml(run.id.slice(0, 8)) + '</code><div class="muted">' + escapeHtml(formatTime(run.startedAt)) + '</div></td><td>' + escapeHtml(run.agent) + '<div class="muted">' + escapeHtml(run.model) + '</div></td><td><span class="pill ' + statusClass + '">' + escapeHtml(run.status) + '</span></td><td>' + escapeHtml(formatDuration(run.durationMs)) + '</td><td>' + run.inputTokens.toLocaleString() + ' in<br>' + run.outputTokens.toLocaleString() + ' out</td><td>' + run.spans.length + trace + '</td></tr>';
        }).join("") : '<tr><td colspan="6" class="empty">No runs yet. Start a run through the ADK API.</td></tr>';
        updated.textContent = "Updated " + new Date().toLocaleTimeString();
      } catch (error) {
        updated.textContent = error.message;
      }
    }
    refresh();
    setInterval(refresh, 5000);
  </script>
</body>
</html>`;
