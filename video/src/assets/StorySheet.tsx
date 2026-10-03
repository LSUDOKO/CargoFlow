import React from "react";
import { AbsoluteFill } from "remotion";
import { F } from "../theme";
import { ConflictGauge, DeviceBadges, EpochTray, FusionMeter, LedgerStrip, ProofEnvelope, Ratchet, ScoreDial } from "./Mechanisms";
import { P } from "./palette";
import { ReeferContainer } from "./Reefer";
import { CalendarStrip, CashGauge, DocumentPortal, ExpenseTag, LaptopFrame, NameCard, NotificationCard, OfficeWindow, PolicyCard } from "./Story";
import { TrancheVault, Waterfall } from "./Vault";
import { BLToken } from "./Documents";
import { DataLogger } from "./Devices";

const Cell: React.FC<{ label: string; note?: string; children: React.ReactNode; style?: React.CSSProperties }> = ({ label, note, children, style }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 14, ...style }}>
    <div style={{ flex: 1, display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 24 }}>{children}</div>
    <div style={{ borderTop: `1px solid ${P.line}`, paddingTop: 10, display: "flex", gap: 12, alignItems: "baseline" }}>
      <span style={{ fontFamily: F.mono, fontSize: 15, fontWeight: 700, color: P.ink }}>{label}</span>
      {note ? <span style={{ fontFamily: F.body, fontSize: 15, color: P.slate }}>{note}</span> : null}
    </div>
  </div>
);

export const STORY_SHEET = { w: 1920, h: 3000 };

/** The script's mechanism assets (S00–S05g), each shown in a representative state. */
export const StorySheet: React.FC = () => (
  <AbsoluteFill style={{ background: P.paper, padding: "56px 64px" }}>
    <div style={{ display: "flex", alignItems: "baseline", gap: 24, marginBottom: 36 }}>
      <div style={{ fontFamily: F.display, fontSize: 48, fontWeight: 700, color: P.ink }}>Mechanisms</div>
      <div style={{ fontSize: 20, color: P.slate, fontFamily: F.body }}>Assets named in SCRIPT-v2, in the states each scene calls for</div>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "1.3fr 0.7fr", gap: 48, height: 420 }}>
      <Cell label='ReeferContainer view="cutaway"' note="S03 / S05d · probe-1 out of band, frost receding left, cargo warming">
        <ReeferContainer view="cutaway" width={1040} probes={[10.4, 4.6]} frost={[0.15, 1]} warm={0.3} pulse="fast" temp={10.4} status="excursion" />
      </Cell>
      <Cell label="DataLogger" note="white device · sig flick">
        <DataLogger width={190} value={5.2} signAt={-8} />
      </Cell>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 48, height: 330, marginTop: 48 }}>
      <Cell label="EpochTray" note="S05b · two rows of eight signed readings · probe-1 ends red (S05d)">
        <EpochTray
          width={1500}
          rows={[
            { sensor: "probe-1", values: [4.7, 4.8, 4.9, 5.2, 6.8, 8.9, 10.4, 11.7] },
            { sensor: "probe-2", values: [4.5, 4.6, 4.6, 4.7, 4.6, 4.6, 4.7, 4.6] },
          ]}
          filled={[8, 6.5]}
        />
      </Cell>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "0.75fr 0.55fr 1fr", gap: 40, height: 380, marginTop: 48 }}>
      <Cell label="EpochTray → fingerprint chip" note="compress = 1">
        <EpochTray width={560} compress={1} />
      </Cell>
      <Cell label="FusionMeter · ConflictGauge" note="74.8 % > 30 % notch">
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
          <FusionMeter
            width={400}
            height={140}
            steps={[
              { fine: 1, violated: 0 },
              { fine: 1, violated: 0 },
              { fine: 1, violated: 0 },
              { fine: 0.6, violated: 0.4 },
              { fine: 0.3, violated: 0.7 },
              { fine: 0.2, violated: 0.8 },
              { fine: 0.15, violated: 0.85 },
              { fine: 0.1, violated: 0.9 },
            ]}
          />
          <ConflictGauge value={0.748} width={220} />
        </div>
      </Cell>
      <Cell label="ScoreDial" note="physical + conflict chips dropped → 48">
        <ScoreDial width={640} penalties={{ physical: 30, conflict: 22 }} dropAt={-100} />
      </Cell>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "0.45fr 0.45fr 1fr", gap: 40, height: 470, marginTop: 48 }}>
      <Cell label="TrancheVault" note="M1–M2 released · M3 held">
        <TrancheVault width={300} drawers={["released", "released", "held", "filled", "filled"]} titleBound />
      </Cell>
      <Cell label="" note="paused · latch down">
        <TrancheVault width={300} drawers={["released", "released", "filled", "filled", "filled"]} latch={1} titleBound open={{}} />
      </Cell>
      <Cell label="LedgerStrip · DeviceBadges" note="the chain as ruled rows, never cubes">
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <LedgerStrip
            width={900}
            rows={[
              { block: 18402113, call: "registerShipment", hash: "0x4c1e…a90b", tone: "ink" },
              { block: 18402117, call: "commitEpoch", hash: "0x7e79…40c6", tone: "verified", tickAt: -40 },
              { block: 18402121, call: "pauseFinancing", hash: "0x0b6d…e4a7", tone: "alert" },
              { block: 18402130, call: "resumeWithProof", hash: "0xc582…1a82", tone: "verified", tickAt: -40 },
            ]}
          />
          <DeviceBadges active="software key" />
        </div>
      </Cell>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "0.6fr 0.5fr 0.9fr", gap: 40, height: 420, marginTop: 48 }}>
      <Cell label="ProofEnvelope" note="sealed · Groth16 · verified">
        <ProofEnvelope width={330} verified={1} bracket />
      </Cell>
      <Cell label="Ratchet" note="stricter only">
        <Ratchet width={280} clicks={1} nudgeAt={-40} />
      </Cell>
      <Cell label="NotificationCard · PolicyCard" note="channels light in sequence">
        <div style={{ display: "flex", gap: 24, alignItems: "flex-end" }}>
          <NotificationCard width={420} at={-30} channelsAt={-20} />
          <PolicyCard width={300} />
        </div>
      </Cell>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 0.55fr", gap: 40, height: 340, marginTop: 48 }}>
      <Cell label="Waterfall" note="S05f · 100,000 → residual · principal · fee">
        <Waterfall width={1000} split={1} />
      </Cell>
      <Cell label="BLToken + possession history" note="CFEBL #12">
        <BLToken width={330} status="SURRENDERED" holder="Wei Lin · Buyer" history={["Issued to Meera", "Bound into escrow", "Released to Wei Lin"]} />
      </Cell>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "0.6fr 0.5fr 0.9fr", gap: 40, height: 380, marginTop: 48 }}>
      <Cell label="OfficeWindow" note="frosted pane · BLIND stamp">
        <OfficeWindow width={460} height={330} frost={1} stamp="BLIND" />
      </Cell>
      <Cell label="LaptopFrame · DocumentPortal" note="S00 lender's view">
        <LaptopFrame width={440}>
          <DocumentPortal fan={0.5} />
        </LaptopFrame>
      </Cell>
      <Cell label="ExpenseTag · CashGauge · NameCard" note="S01">
        <div style={{ display: "flex", flexDirection: "column", gap: 18, alignItems: "flex-start" }}>
          <div style={{ display: "flex", gap: 8 }}>
            <ExpenseTag label="vials" stampAt={-20} width={160} />
            <ExpenseTag label="reefer" stampAt={-20} width={160} />
            <ExpenseTag label="freight" width={160} />
          </div>
          <CashGauge level={0.34} width={500} />
          <NameCard name="Meera" role="Exporter · vaccines, Pune" illustrative />
        </div>
      </Cell>
    </div>
    <div style={{ height: 130, marginTop: 40 }}>
      <Cell label="CalendarStrip" note="52 days">
        <CalendarStrip filled={52} width={1700} />
      </Cell>
    </div>
  </AbsoluteFill>
);
