"use client";

import Link from "next/link";
import { CodeBlock, CopyButton } from "@/components/ui/CodeBlock";
import { useShipments } from "@/lib/api/hooks";
import {
  CLAUDE_CODE_LOCAL,
  CLAUDE_CODE_REMOTE,
  CLAUDE_CONNECTORS_URL,
  CLAUDE_DESKTOP_JSON,
  MCP_URL,
  STARTER_PROMPTS,
  claudeNewChat,
  cursorInstallLink,
} from "@/lib/developer";

const ext = <span className="sr-only"> (opens in a new tab)</span>;

function useTryPrompts() {
  const latest = useShipments(1);
  const id = latest.data?.shipments[0]?.id;
  return id ? [...STARTER_PROMPTS, { label: "Explain the latest shipment", prompt: `Using the CargoFlow connector, explain shipment ${id}: where it is, why, and who should act next.` }] : STARTER_PROMPTS;
}

/** The full "Use CargoFlow in Claude" section of /developers. */
export function UseWithClaude() {
  const prompts = useTryPrompts();
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <div className="surface-ink flex min-w-0 flex-col gap-5 rounded-[var(--radius-card)] bg-ink p-6 text-paper md:p-8">
        <div>
          <p className="text-xs font-semibold tracking-[0.12em] text-signal uppercase">Remote MCP server · Streamable HTTP</p>
          <h3 className="mt-2 font-display text-2xl font-semibold">Add CargoFlow to Claude</h3>
          <p className="mt-2 text-paper/75">Read shipments, evidence, cover and the market, and prepare transactions for your own wallet to sign. The server holds no keys.</p>
        </div>
        <div className="flex flex-col gap-3 rounded-2xl bg-paper/8 p-4 sm:flex-row sm:items-center">
          <code className="min-w-0 flex-1 font-mono text-sm break-all text-paper select-all">{MCP_URL}</code>
          <CopyButton text={MCP_URL} label="Copy URL" big />
        </div>
        <ol className="grid gap-2 text-sm text-paper/85 sm:grid-cols-2">
          {["Open Claude → Settings → Connectors", "Choose “Add custom connector”", "Paste the URL above, name it CargoFlow", "Press Add, then enable it in a chat"].map((s, i) => (
            <li key={s} className="flex gap-2.5 rounded-xl bg-paper/5 px-3 py-2.5">
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-signal font-mono text-[0.6875rem] font-bold text-ink">{i + 1}</span>
              {s}
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-2">
          <a href={CLAUDE_CONNECTORS_URL} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center gap-2 rounded-full border-2 border-paper/40 px-5 text-sm font-semibold hover:border-paper hover:bg-paper/8">
            Open Claude connector settings{ext}
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 3.5h6.5V10M12.5 3.5 4 12" /></svg>
          </a>
          <a href={cursorInstallLink()} className="inline-flex h-11 items-center gap-2 rounded-full border-2 border-paper/40 px-5 text-sm font-semibold hover:border-paper hover:bg-paper/8">
            Add to Cursor
          </a>
        </div>
        <p className="text-xs text-paper/55">claude.ai has no one-click link for adding a connector, so the steps above are the official route. Custom connectors need a Claude plan that supports them.</p>
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <div className="rounded-[var(--radius-card)] border border-line bg-white p-5">
          <h3 className="font-display text-lg font-semibold">Try it</h3>
          <p className="mt-1 text-sm text-slate">Opens a new Claude chat with the prompt filled in. Enable the CargoFlow connector in that chat.</p>
          <ul className="mt-3 flex flex-col gap-2">
            {prompts.map((p) => (
              <li key={p.label}>
                <a href={claudeNewChat(p.prompt)} target="_blank" rel="noreferrer" className="group flex items-start gap-3 rounded-2xl border border-line px-3.5 py-2.5 text-sm transition-colors hover:border-ink/40 hover:bg-paper">
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{p.label}</span>
                    <span className="line-clamp-2 block text-slate">{p.prompt}</span>
                  </span>
                  <span className="mt-0.5 shrink-0 font-semibold text-ink/60 group-hover:text-ink" aria-hidden="true">→</span>
                  {ext}
                </a>
              </li>
            ))}
          </ul>
        </div>
        <CodeBlock label="Claude Code · remote" code={CLAUDE_CODE_REMOTE} />
        <CodeBlock label="Claude Code · local (stdio)" code={CLAUDE_CODE_LOCAL} />
        <CodeBlock label="Claude Desktop · claude_desktop_config.json" code={CLAUDE_DESKTOP_JSON} />
      </div>
    </div>
  );
}

/** The compact card for the landing page. */
export function UseWithClaudeCard() {
  return (
    <div className="surface-ink flex flex-col gap-5 rounded-[var(--radius-card)] bg-ink p-6 text-paper md:flex-row md:items-center md:p-8">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold tracking-[0.12em] text-signal uppercase">New · MCP connector</p>
        <h2 className="mt-2 font-display text-2xl font-semibold md:text-3xl">Ask Claude about your cargo</h2>
        <p className="mt-2 max-w-xl text-paper/75">Add CargoFlow as a connector and ask why a shipment paused, what the fleet&apos;s risk is, or prepare a release for your wallet to sign.</p>
        <div className="mt-4 flex max-w-xl items-center gap-2 rounded-2xl bg-paper/8 py-1.5 pr-1.5 pl-4">
          <code className="min-w-0 flex-1 truncate font-mono text-sm">{MCP_URL}</code>
          <CopyButton text={MCP_URL} label="Copy URL" className="text-paper" />
        </div>
      </div>
      <div className="flex shrink-0 flex-col gap-2 sm:flex-row md:flex-col">
        <a href={claudeNewChat(STARTER_PROMPTS[0]!.prompt)} target="_blank" rel="noreferrer" className="inline-flex h-12 items-center justify-center rounded-full bg-signal px-6 font-semibold text-ink hover:bg-signal-2">
          Try it in Claude{ext}
        </a>
        <Link href="/developers#claude" className="inline-flex h-12 items-center justify-center rounded-full border-2 border-paper/40 px-6 font-semibold hover:border-paper">
          Setup steps
        </Link>
      </div>
    </div>
  );
}
