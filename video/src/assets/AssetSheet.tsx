import React from "react";
import { AbsoluteFill } from "remotion";
import { F } from "../theme";
import { PortCrane } from "./Crane";
import { BlockChain, EvidenceEpochCard, Gauge, ProofVerified, SensorFusion } from "./Data";
import { DataLogger, PasskeyPhone, Thermometer, VialTray } from "./Devices";
import { BLHandoff, BLToken, Invoice, PaperworkStack } from "./Documents";
import { BrowserFrame, ChatWindow, SponsorRow, Toast } from "./Frames";
import { Coin, CoinFlow, CoinStack, EscrowVault, arcPoints } from "./Money";
import { P } from "./palette";
import { ReeferContainer } from "./Reefer";
import { ContainerShip } from "./Ship";

const Cell: React.FC<{ label: string; note?: string; children: React.ReactNode; style?: React.CSSProperties }> = ({ label, note, children, style }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 14, ...style }}>
    <div style={{ flex: 1, display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 24 }}>{children}</div>
    <div style={{ borderTop: `1px solid ${P.line}`, paddingTop: 10, display: "flex", gap: 12, alignItems: "baseline" }}>
      <span style={{ fontFamily: F.mono, fontSize: 15, fontWeight: 700, color: P.ink }}>{label}</span>
      {note ? <span style={{ fontFamily: F.body, fontSize: 15, color: P.slate }}>{note}</span> : null}
    </div>
  </div>
);

const Header: React.FC<{ title: string; sub: string }> = ({ title, sub }) => (
  <div style={{ display: "flex", alignItems: "baseline", gap: 24, marginBottom: 36 }}>
    <div style={{ fontFamily: F.display, fontSize: 48, fontWeight: 700, color: P.ink }}>{title}</div>
    <div style={{ fontSize: 20, color: P.slate, fontFamily: F.body }}>{sub}</div>
  </div>
);

export const ASSET_SHEET = { w: 1920, h: 2000 };

/** Physical objects: reefer, ship, crane, logger, vials, thermometer, money, documents. */
export const AssetSheet: React.FC = () => (
  <AbsoluteFill style={{ background: P.paper, padding: "56px 64px" }}>
    <Header title="Objects" sub="Orthographic elevations · strokeless flat · one shade tone · brand tints only" />
    <div style={{ display: "grid", gridTemplateColumns: "1.55fr 0.7fr 0.7fr", gap: 48, height: 420 }}>
      <Cell label="ReeferContainer" note='view="side" · temp ticks · lamp breathes'>
        <ReeferContainer width={800} temp={4.8} status="ok" />
      </Cell>
      <Cell label='view="doors"' note="doorOpen 0.55">
        <ReeferContainer view="doors" width={250} doorOpen={0.55} />
      </Cell>
      <Cell label='view="unit"' note='status="excursion"'>
        <ReeferContainer view="unit" width={250} temp={11.7} status="excursion" />
      </Cell>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "1.5fr 0.9fr 0.5fr", gap: 48, height: 400, marginTop: 48 }}>
      <Cell label="ContainerShip" note="bob · wake · waves">
        <ContainerShip width={820} />
      </Cell>
      <Cell label="PortCrane" note="trolley + spreader loop">
        <PortCrane width={380} at={0.42} />
      </Cell>
      <Cell label="DataLogger" note="double-beep flash">
        <DataLogger width={170} value={4.8} beepAt={-2} />
      </Cell>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 0.36fr 0.36fr 0.9fr", gap: 40, height: 400, marginTop: 48 }}>
      <Cell label="VialTray">
        <VialTray width={460} />
      </Cell>
      <Cell label="Thermometer" note="in band">
        <Thermometer height={340} value={4.8} />
      </Cell>
      <Cell label="" note="excursion">
        <Thermometer height={340} value={11.7} />
      </Cell>
      <Cell label="Coin · CoinStack · CoinFlow · EscrowVault" note="unlock 0 / 1">
        <div style={{ position: "relative", display: "flex", alignItems: "flex-end", gap: 18 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}>
            <Coin size={84} />
            <CoinStack count={7} size={110} label="8,000" />
          </div>
          <EscrowVault width={190} unlock={0} />
          <EscrowVault width={190} unlock={1} />
          <svg width={400} height={200} viewBox="0 0 400 200" style={{ position: "absolute", left: 40, top: -60, overflow: "visible" }}>
            <CoinFlow path={arcPoints({ x: 40, y: 150 }, { x: 260, y: 120 }, -120)} start={-20} duration={40} count={5} gap={6} r={14} />
          </svg>
        </div>
      </Cell>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "0.55fr 1.25fr 0.8fr", gap: 48, height: 470, marginTop: 48 }}>
      <Cell label="Invoice" note="stamp thumps on">
        <Invoice width={290} stamp="FINANCED" />
      </Cell>
      <Cell label="BLToken" note="ISSUED → BOUND → SURRENDERED">
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", gap: 16 }}>
            <BLToken width={330} status="ISSUED" />
            <BLToken width={330} status="BOUND" holder="Daniel · Financier" holderRole="PLEDGED TO" />
          </div>
          <BLToken width={330} status="SURRENDERED" holder="Wei Lin · Buyer" />
        </div>
      </Cell>
      <Cell label="PaperworkStack" note="the paperwork, not the container">
        <PaperworkStack width={400} />
      </Cell>
    </div>
  </AbsoluteFill>
);

export const ASSET_SHEET_DATA = { w: 1920, h: 2520 };

/** Data + UI: proof, evidence epoch, fusion, gauges, passkey, blocks, toasts, frames, sponsors. */
export const AssetSheetData: React.FC = () => (
  <AbsoluteFill style={{ background: P.paper, padding: "56px 64px" }}>
    <Header title="Data & interface" sub="Proof, evidence, chain and the frames that hold screen recordings" />
    <div style={{ display: "grid", gridTemplateColumns: "0.85fr 1fr", gap: 48, height: 480 }}>
      <Cell label="ProofVerified" note="8 sealed readings → verifier sweep → shield">
        <ProofVerified width={760} start={-120} />
      </Cell>
      <Cell label="EvidenceEpochCard" note="8 readings → Merkle root → score">
        <EvidenceEpochCard width={860} start={-120} />
      </Cell>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 48, height: 440, marginTop: 48 }}>
      <Cell label="SensorFusion" note="two probes · conflict meter">
        <SensorFusion width={420} a={4.9} b={5.2} />
        <SensorFusion width={420} a={4.9} b={7.4} />
      </Cell>
      <Cell label="Gauge" note='mode="score" | "conflict" | "risk"'>
        <Gauge value={0.92} label="score" width={230} />
        <Gauge value={0.62} mode="conflict" label="conflict" width={230} />
        <Gauge value={0.18} mode="risk" label="risk" width={230} />
      </Cell>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "0.35fr 1fr", gap: 48, height: 560, marginTop: 48 }}>
      <Cell label="PasskeyPhone" note="Face ID scan → signed in">
        <PasskeyPhone width={250} start={-100} />
      </Cell>
      <Cell label="BlockChain · Toast" note="blocks slide in · toasts by tone">
        <div style={{ display: "flex", flexDirection: "column", gap: 28, alignItems: "flex-start" }}>
          <BlockChain
            width={1180}
            start={-200}
            blocks={[
              { n: 18402113, tx: "0x4c1e…a90b", label: "createFacility" },
              { n: 18402114, tx: "0x77d0…12fe", label: "deposit" },
              { n: 18402117, tx: "0x9f3a…c21e", label: "commitEpoch" },
              { n: 18402121, tx: "0x0b6d…e4a7", label: "pause", tone: "alert" },
              { n: 18402130, tx: "0xc582…1a82", label: "resumeWithProof" },
            ]}
          />
          <div style={{ display: "flex", gap: 20 }}>
            <Toast tone="danger" title="Excursion · 11.7 °C" body="Epoch 7 failed policy. Facility paused." at={-30} width={370} />
            <Toast tone="alert" title="Facility paused" body="Arbiter notified." at={-30} width={370} />
            <Toast tone="verified" title="Tranche released" body="8,000 USDG to the exporter." at={-30} width={370} />
          </div>
        </div>
      </Cell>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 0.8fr", gap: 48, height: 480, marginTop: 48 }}>
      <Cell label="BrowserFrame" note="url prop · children = screen recording">
        <BrowserFrame url="https://cargoflow.adoranto737.workers.dev/shipments/CF-0412" width={900} height={430}>
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: F.mono, fontSize: 16, color: P.slate }}>
            {"<OffthreadVideo /> goes here"}
          </div>
        </BrowserFrame>
      </Cell>
      <Cell label="ChatWindow" note='assistant named "Claude" in plain text'>
        <ChatWindow
          width={700}
          height={430}
          messages={[
            { role: "user", text: "Is shipment CF-0412 still inside 2–8 °C?", at: -200 },
            { role: "tool", name: "get_shipment", detail: "CF-0412", at: -180, doneAt: -170 },
            { role: "assistant", text: "Yes. Epoch 7 passed with 8 signed readings, max 5.0 °C. Tranche 3 of 5 is released.", at: -160 },
          ]}
        />
      </Cell>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 48, height: 420, marginTop: 48 }}>
      <Cell label="BLHandoff" note="token moves between holders">
        <BLHandoff
          width={820}
          cardWidth={240}
          position={1.5}
          holders={[
            { name: "Meera", role: "Exporter", status: "ISSUED" },
            { name: "Daniel", role: "Financier", status: "BOUND" },
            { name: "Wei Lin", role: "Buyer", status: "SURRENDERED" },
          ]}
        />
      </Cell>
      <Cell label="SponsorRow" note="names as plain wordmarks, never logos">
        <SponsorRow
          slotWidth={250}
          items={[
            { name: "Robinhood Chain", caption: "settlement" },
            { name: "Alchemy", caption: "webhooks" },
            { name: "ZeroDev", caption: "passkeys" },
            { name: "Dune", caption: "analytics" },
            { name: "Fhenix", caption: "encrypted" },
            { name: "GMX", caption: "hedging" },
          ]}
        />
      </Cell>
    </div>
  </AbsoluteFill>
);
