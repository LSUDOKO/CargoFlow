"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useAccount } from "wagmi";
import { signMessage } from "wagmi/actions";
import { Button, LinkButton } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { Field } from "@/components/ui/Field";
import { Pill } from "@/components/ui/Pill";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { WalletButton } from "@/components/wallet/WalletButton";
import { ApiError, apiPost } from "@/lib/api/client";
import { useConfig } from "@/lib/api/hooks";
import { useContracts } from "@/lib/chain/contracts";
import {
  ALERT_EVENTS,
  COVER_ALERT_EVENTS,
  V3_ALERT_EVENTS,
  ALERT_EVENT_LABEL,
  SubscriptionCreated,
  alertsMessage,
  alertsOffMessage,
  apiDelete,
  isUnavailable,
  nowSec,
  rolesOf,
  targetError,
  useConfigExtras,
  useSubscriptions,
  type AlertChannel,
  type AlertEvent,
  type Subscription,
} from "@/lib/api/extras";
import type { ShipmentView } from "@/lib/api/schemas";
import { wagmiConfig } from "@/lib/chain/config";
import { signatureError } from "@/lib/chain/errors";
import { useHydrated } from "@/lib/useHydrated";

const CHANNELS: { id: AlertChannel; label: string; hint: string }[] = [
  { id: "webhook", label: "Webhook", hint: "Signed JSON POSTs to your system" },
  { id: "telegram", label: "Telegram", hint: "Messages from the CargoFlow bot" },
  { id: "email", label: "Email", hint: "A short email per event" },
  { id: "slack", label: "Slack", hint: "Posts to a Slack channel through an incoming webhook" },
];
const channelLabel = (c: string) => CHANNELS.find((x) => x.id === c)?.label ?? c;

/** Parties subscribe to the shipment's events by webhook, Telegram, email or Slack, each request signed by their wallet. */
export function AlertsPanel({ view }: { view: ShipmentView }) {
  const hydrated = useHydrated();
  const { address, isConnected } = useAccount();
  const extras = useConfigExtras();
  const roles = hydrated ? rolesOf(view, address) : [];
  const subs = useSubscriptions(roles.length ? view.shipment.id : undefined, address);
  const [created, setCreated] = useState<SubscriptionCreated | null>(null);
  const alerts = extras.data?.alerts ?? null;

  if (extras.isPending) return <Skeleton className="h-32" />;
  if (!alerts) {
    return <p className="rounded-2xl bg-mist px-4 py-3 text-sm text-slate">Alerts are not available on this deployment yet.</p>;
  }
  const available: Record<AlertChannel, boolean> = { webhook: alerts.webhook, telegram: alerts.telegram, email: alerts.email, slack: alerts.slack };

  if (!hydrated || !isConnected || roles.length === 0) {
    return (
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-slate">The exporter, financier and buyer can be alerted the moment this shipment pauses, releases, settles or is disputed.</p>
        <ChannelList available={available} />
        {hydrated && isConnected ? <p className="text-slate">This wallet is not a party to the shipment.</p> : <div><WalletButton compact /></div>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {created ? (
        <Created created={created} onDone={() => setCreated(null)} />
      ) : (
        <SubscribeForm view={view} available={available} telegramBot={alerts.telegramBot} onCreated={setCreated} />
      )}
      <section aria-labelledby="my-alerts">
        <h3 id="my-alerts" className="text-xs font-semibold tracking-wide text-slate uppercase">Your alerts</h3>
        {subs.isPending ? (
          <Skeleton className="mt-2 h-12" />
        ) : subs.isError ? (
          <p className="mt-2 text-sm text-slate">{isUnavailable(subs.error) ? "Your alerts can't be listed on this deployment yet." : "Your alerts could not be loaded."}</p>
        ) : subs.data.subscriptions.length === 0 ? (
          <p className="mt-2 text-sm text-slate">None yet.</p>
        ) : (
          <ul className="mt-1 divide-y divide-line">
            {subs.data.subscriptions.map((s) => (
              <SubscriptionRow key={s.id} s={s} shipmentId={view.shipment.id} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ChannelList({ available }: { available: Record<AlertChannel, boolean> }) {
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Alert channels">
      {CHANNELS.map((c) => (
        <li key={c.id}>
          <Pill tone={available[c.id] ? "verified" : "slate"} dot>
            {c.label}
            {!available[c.id] && <span className="font-normal">· not configured</span>}
          </Pill>
        </li>
      ))}
    </ul>
  );
}

function SubscribeForm({ view, available, telegramBot, onCreated }: { view: ShipmentView; available: Record<AlertChannel, boolean>; telegramBot: string; onCreated: (c: SubscriptionCreated) => void }) {
  const { address } = useAccount();
  const qc = useQueryClient();
  const first = CHANNELS.find((c) => available[c.id])?.id ?? "webhook";
  const [channel, setChannel] = useState<AlertChannel>(first);
  const [target, setTarget] = useState("");
  const { contracts } = useContracts();
  // cover events exist only on a deployment with a CoverPool (contracts v2)
  // and the v3 events (cancellation, parametric trigger) only on a v3 deployment (it configures the v3 registries)
  const v3 = !!(contracts?.deviceRegistry || contracts?.eblRegistry);
  const offered = ALERT_EVENTS.filter((e) => (contracts?.coverPool || !COVER_ALERT_EVENTS.includes(e)) && (v3 || !V3_ALERT_EVENTS.includes(e)));
  const [events, setEvents] = useState<AlertEvent[]>([...offered]);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState<"sign" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { data: cfg } = useConfig();
  const tErr = targetError(channel, target, cfg?.chainId === 31337);
  const id = view.shipment.id;

  async function subscribe() {
    setTouched(true);
    if (!address || tErr || events.length === 0 || !available[channel]) return;
    setError(null);
    const t = channel === "telegram" ? "" : target.trim();
    const issuedAt = nowSec();
    let signature: string;
    try {
      setBusy("sign");
      signature = await signMessage(wagmiConfig, { account: address, message: alertsMessage(id, channel, t, issuedAt) });
    } catch (err) {
      setError(signatureError(err));
      setBusy(null);
      return;
    }
    try {
      setBusy("save");
      const ordered = offered.filter((e) => events.includes(e));
      const res = await apiPost(`/v1/shipments/${id}/subscriptions`, { channel, target: t, events: ordered, issuedAt, signature }, SubscriptionCreated);
      await qc.invalidateQueries({ queryKey: ["subscriptions", id] });
      setTarget("");
      setTouched(false);
      onCreated(res);
    } catch (err) {
      if (err instanceof ApiError && err.code === "channel_unavailable") setError(`${channelLabel(channel)} alerts are not configured on this deployment.`);
      else setError(isUnavailable(err) ? "Alerts are not available on this deployment yet." : err instanceof ApiError ? err.message : "The alert could not be created.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void subscribe();
      }}
    >
      <fieldset>
        <legend className="mb-1.5 text-sm font-semibold">Channel</legend>
        <div className="grid grid-cols-2 gap-1 rounded-2xl bg-mist p-1 sm:grid-cols-4">
          {CHANNELS.map((c) => {
            const on = channel === c.id;
            const off = !available[c.id];
            return (
              <label
                key={c.id}
                title={off ? `${c.label} is not configured on this deployment` : undefined}
                className={cx(
                  "relative flex h-9 cursor-pointer items-center justify-center rounded-xl px-2 text-center text-sm font-semibold transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink",
                  on ? "bg-ink text-paper" : off ? "cursor-not-allowed text-ink/40 line-through decoration-ink/30" : "text-ink/75 hover:bg-ink/6",
                )}
              >
                <input type="radio" name="alert-channel" value={c.id} checked={on} disabled={off} onChange={() => setChannel(c.id)} className="sr-only" />
                {c.label}
                {off && <span className="sr-only"> (not configured)</span>}
              </label>
            );
          })}
        </div>
        <p className="mt-1.5 text-sm text-slate">
          {CHANNELS.find((c) => c.id === channel)!.hint}.
          {CHANNELS.some((c) => !available[c.id]) && ` ${CHANNELS.filter((c) => !available[c.id]).map((c) => c.label).join(" and ")} ${CHANNELS.filter((c) => !available[c.id]).length > 1 ? "are" : "is"} not configured on this deployment.`}
        </p>
      </fieldset>

      {channel === "webhook" && (
        <Field label="Webhook URL" type="url" inputMode="url" autoComplete="off" placeholder="https://ops.example.com/cargoflow" value={target} onChange={(e) => setTarget(e.target.value)} onBlur={() => setTouched(true)} error={touched ? tErr : null} />
      )}
      {channel === "slack" && (
        <Field
          label="Slack webhook URL"
          type="url"
          inputMode="url"
          autoComplete="off"
          placeholder="https://hooks.slack.com/services/T000/B000/XXXX"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          onBlur={() => setTouched(true)}
          error={touched ? tErr : null}
          hint="In Slack: Apps → Incoming Webhooks → Add to a channel, then copy the URL."
        />
      )}
      {channel === "email" && (
        <Field label="Email address" type="email" autoComplete="email" placeholder="ops@exporter.example" value={target} onChange={(e) => setTarget(e.target.value)} onBlur={() => setTouched(true)} error={touched ? tErr : null} />
      )}
      {channel === "telegram" && (
        <p className="rounded-2xl bg-mist px-4 py-3 text-sm text-slate">
          After you sign, open {telegramBot ? <span className="font-semibold text-ink">@{telegramBot.replace(/^@/, "")}</span> : "the CargoFlow bot"} and press Start to finish.
        </p>
      )}

      <fieldset>
        <legend className="mb-1.5 text-sm font-semibold">Events</legend>
        <div className="flex flex-wrap gap-1.5">
          {offered.map((ev) => {
            const on = events.includes(ev);
            return (
              <label
                key={ev}
                className={cx(
                  "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors select-none has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink",
                  on ? "border-ink/60 bg-signal/30 text-ink" : "border-line bg-white text-slate hover:border-ink/40",
                )}
              >
                <input type="checkbox" className="sr-only" checked={on} onChange={() => setEvents((xs) => (on ? xs.filter((x) => x !== ev) : [...xs, ev]))} />
                <span aria-hidden="true" className={cx("grid h-3.5 w-3.5 place-items-center rounded-full text-[0.5625rem] leading-none", on ? "bg-ink text-signal" : "border border-ink/25")}>{on ? "✓" : ""}</span>
                {ALERT_EVENT_LABEL[ev]}
              </label>
            );
          })}
        </div>
        {events.length === 0 && <p className="mt-1.5 text-sm font-medium text-danger">Pick at least one event.</p>}
      </fieldset>

      {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}
      <Button type="submit" size="sm" className="self-start" loading={busy !== null} disabled={!available[channel] || events.length === 0}>
        {busy === "sign" ? "Waiting for your signature…" : busy === "save" ? "Subscribing…" : "Sign and subscribe"}
      </Button>
    </form>
  );
}

function Created({ created, onDone }: { created: SubscriptionCreated; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* the secret stays selectable */
    }
  };
  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-ink p-4 text-paper surface-ink" role="status">
      <p className="font-display text-base font-semibold text-signal">{channelLabel(created.channel)} alert created</p>
      {created.channel === "telegram" && created.linkUrl ? (
        <>
          <p className="text-sm text-paper/80">One more step: open the bot and press Start. Alerts begin once Telegram confirms.</p>
          <LinkButton href={created.linkUrl} external size="sm" className="self-start">Open Telegram to finish</LinkButton>
        </>
      ) : created.secret ? (
        <>
          <p className="text-sm text-paper/80">
            Every delivery carries <code className="font-mono text-[0.8125rem] text-paper">X-CargoFlow-Signature</code>, the hex HMAC-SHA256 of the body with this secret. It is shown only once.
          </p>
          <div className="flex items-center gap-2 rounded-xl bg-paper/10 py-1.5 pr-1.5 pl-3">
            <code className="min-w-0 flex-1 font-mono text-[0.8125rem] break-all select-all">{created.secret}</code>
            <Button size="sm" variant="primary" onClick={() => void copy(created.secret!)}>{copied ? "Copied" : "Copy"}</Button>
          </div>
        </>
      ) : (
        <p className="text-sm text-paper/80">Alerts go to {created.targetMasked || "your address"}.</p>
      )}
      <Button size="sm" variant="inverse" className="self-start" onClick={onDone}>{created.secret ? "I've saved it" : "Done"}</Button>
    </div>
  );
}

function SubscriptionRow({ s, shipmentId }: { s: Subscription; shipmentId: string }) {
  const { address } = useAccount();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (!address) return;
    setError(null);
    setBusy(true);
    try {
      const issuedAt = nowSec();
      let signature: string;
      try {
        signature = await signMessage(wagmiConfig, { account: address, message: alertsOffMessage(s.id, issuedAt) });
      } catch (err) {
        setError(signatureError(err));
        return;
      }
      await apiDelete(`/v1/shipments/${shipmentId}/subscriptions/${s.id}`, { issuedAt, signature });
      await qc.invalidateQueries({ queryKey: ["subscriptions", shipmentId] });
      toast({ tone: "slate", title: `${channelLabel(s.channel)} alert removed` });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The alert could not be removed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="py-2.5">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            {channelLabel(s.channel)}
            {!s.active && <Pill tone="alert">{s.channel === "telegram" ? "Waiting for Start" : "Inactive"}</Pill>}
          </p>
          {s.targetMasked && <p className={`truncate text-xs text-ink/80 ${s.channel === "telegram" ? "" : "font-mono"}`} title={s.targetMasked}>{s.targetMasked}</p>}
          <p className="text-xs text-slate">{ALERT_EVENTS.filter((e) => !COVER_ALERT_EVENTS.includes(e) && !V3_ALERT_EVENTS.includes(e)).every((e) => s.events.includes(e)) ? "Every event" : s.events.map((e) => ALERT_EVENT_LABEL[e as AlertEvent] ?? e).join(", ")}</p>
        </div>
        <Button size="sm" variant="ghost" loading={busy} onClick={() => void remove()} aria-label={`Remove ${channelLabel(s.channel)} alert`}>Remove</Button>
      </div>
      {error && <p role="alert" className="mt-1 text-sm font-medium text-danger">{error}</p>}
    </li>
  );
}
