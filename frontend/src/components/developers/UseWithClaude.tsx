"use client";

import { LinkButton, buttonClass } from "@/components/ui/Button";
import { CodeBlock } from "@/components/ui/CodeBlock";
import { CopyField } from "@/components/ui/CopyField";
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

const External = () => (
  <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 3.5h6.5V10M12.5 3.5 4 12" />
  </svg>
);

function useTryPrompts() {
  const latest = useShipments(1);
  const id = latest.data?.shipments[0]?.id;
  return id ? [...STARTER_PROMPTS, { label: "Explain the latest shipment", prompt: `Using the CargoFlow connector, explain shipment ${id}: where it is, why, and who should act next.` }] : STARTER_PROMPTS;
}

const STEPS = ["Open Claude → Settings → Connectors", "Choose “Add custom connector”", "Paste the URL above, name it CargoFlow", "Press Add, then enable it in a chat"];

/** A prompt that opens a new Claude chat with the text filled in. */
function PromptLink({ label, prompt, onDark }: { label: string; prompt: string; onDark?: boolean }) {
  return (
    <a
      href={claudeNewChat(prompt)}
      target="_blank"
      rel="noreferrer"
      className={
        onDark
          ? "group flex items-start gap-3 rounded-tile px-3.5 py-3 ring-1 ring-paper/12 ring-inset transition-colors duration-(--duration-fast) hover:bg-paper/6 hover:ring-paper/25"
          : "group flex items-start gap-3 rounded-tile px-3.5 py-3 ring-1 ring-border ring-inset transition-colors duration-(--duration-fast) hover:bg-paper hover:ring-border-strong"
      }
    >
      <span className="min-w-0 flex-1">
        <span className="block text-small font-semibold">{label}</span>
        <span className={onDark ? "line-clamp-2 block text-small text-paper/70" : "line-clamp-2 block text-small text-text-muted"}>{prompt}</span>
      </span>
      <span className={onDark ? "mt-0.5 shrink-0 text-paper/70 transition-transform group-hover:translate-x-0.5 group-hover:text-paper" : "mt-0.5 shrink-0 text-text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-ink"} aria-hidden="true">→</span>
      {ext}
    </a>
  );
}

/** The full "Use CargoFlow in Claude" section of /developers. Columns size to their content (items-start). */
export function UseWithClaude() {
  const prompts = useTryPrompts();
  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
      <div className="surface-ink flex min-w-0 flex-col gap-6 rounded-card bg-ink p-6 text-paper shadow-2 md:p-8 lg:col-span-7">
        <div>
          <p className="text-caption font-semibold tracking-[0.08em] text-signal uppercase">Remote MCP server · Streamable HTTP</p>
          <h3 className="mt-2 font-display text-h2">Add CargoFlow to Claude</h3>
          <p className="mt-2 max-w-reading text-paper/75">Read shipments, evidence, cover and the market, and prepare transactions for your own wallet to sign. The server holds no keys.</p>
        </div>
        <CopyField value={MCP_URL} label="MCP URL" kind="text" display="full" onDark className="w-full" />
        <ol className="grid gap-2 text-small text-paper/85 sm:grid-cols-2">
          {STEPS.map((s, i) => (
            <li key={s} className="flex gap-2.5 rounded-tile bg-paper/5 px-3 py-2.5">
              <span className="num grid h-5 w-5 shrink-0 place-items-center rounded-full bg-signal text-overline font-bold text-ink">{i + 1}</span>
              {s}
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-2">
          <LinkButton href={CLAUDE_CONNECTORS_URL} external variant="inverse" iconEnd={<External />}>
            Open Claude connector settings{ext}
          </LinkButton>
          <a href={cursorInstallLink()} className={buttonClass("inverse")}>
            Add to Cursor
          </a>
        </div>
        <p className="text-caption text-paper/70">claude.ai has no one-click link for adding a connector, so the steps above are the official route. Custom connectors need a Claude plan that supports them.</p>
      </div>

      <div className="flex min-w-0 flex-col gap-4 lg:col-span-5">
        <div className="rounded-card border border-border bg-surface p-5 shadow-1">
          <h3 className="font-display text-h3">Try it</h3>
          <p className="mt-1 text-small text-text-muted">Opens a new Claude chat with the prompt filled in. Enable the CargoFlow connector in that chat.</p>
          <ul className="mt-4 flex flex-col gap-2">
            {prompts.map((p) => (
              <li key={p.label}>
                <PromptLink label={p.label} prompt={p.prompt} />
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

/** The compact card for the landing page: the connector URL and three real prompts to try. */
export function UseWithClaudeCard() {
  return (
    <div className="surface-ink grid gap-8 overflow-hidden rounded-sheet bg-ink p-6 text-paper md:p-10 lg:grid-cols-12 lg:items-center lg:gap-12">
      <div className="min-w-0 lg:col-span-6">
        <p className="inline-flex items-center gap-2 text-caption font-semibold tracking-[0.08em] text-signal uppercase">
          <span className="h-1.5 w-1.5 rounded-full bg-signal" aria-hidden="true" />
          New · MCP connector
        </p>
        <h2 className="mt-3 font-display text-h1">Ask Claude about your cargo</h2>
        <p className="mt-3 max-w-xl text-body-lg text-paper/75">Add CargoFlow as a connector and ask why a shipment paused, what the fleet&apos;s risk is, or prepare a release for your wallet to sign.</p>
        <CopyField value={MCP_URL} label="MCP URL" kind="text" display="full" onDark className="mt-6 w-full max-w-xl" />
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <LinkButton href={claudeNewChat(STARTER_PROMPTS[0]!.prompt)} external size="lg">
            Try it in Claude{ext}
          </LinkButton>
          <LinkButton href="/developers#claude" size="lg" variant="inverse">Setup steps</LinkButton>
        </div>
      </div>
      <div className="min-w-0 lg:col-span-6">
        <p className="eyebrow">Try asking</p>
        <ul className="mt-3 flex flex-col gap-2">
          {STARTER_PROMPTS.map((p) => (
            <li key={p.label}>
              <PromptLink label={p.label} prompt={p.prompt} onDark />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
