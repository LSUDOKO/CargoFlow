import React from "react";
import { Sequence, useCurrentFrame } from "remotion";
import { P } from "../assets/palette";
import { F } from "../theme";
import { At, Stage, env } from "./kit";
import { Footage } from "./Footage";
import { beats } from "./timing";

/**
 * S08 · Developer platform: a four-up grid on white, each tile animating in on its word, then a
 * ribbon. Tile 1 is the R3 recording of /docs; tiles 2-4 are typeset from the package READMEs
 * (JetBrains Mono, ink on mist, keywords in teal only).
 */

const KEYWORDS = new Set(["const", "await", "import", "from", "def", "return"]);

const Code: React.FC<{ lines: string[]; size?: number }> = ({
  lines,
  size = 20,
}) => (
  <div
    style={{
      fontFamily: F.mono,
      fontSize: size,
      lineHeight: 1.65,
      color: P.ink,
      background: P.mist,
      borderRadius: 14,
      padding: "16px 20px",
      whiteSpace: "pre",
    }}
  >
    {lines.map((l, i) => (
      <div key={i}>
        {l.split(/(\s+)/).map((tok, j) => (
          <span
            key={j}
            style={{
              color: KEYWORDS.has(tok)
                ? P.teal
                : l.trim().startsWith("$") || l.trim().startsWith("#")
                  ? P.slate
                  : P.ink,
              fontWeight: KEYWORDS.has(tok) ? 700 : 400,
            }}
          >
            {tok}
          </span>
        ))}
      </div>
    ))}
  </div>
);

const Tile: React.FC<{
  x: number;
  y: number;
  k: number;
  name: string;
  what: string;
  children: React.ReactNode;
  tag?: string;
}> = ({ x, y, k, name, what, children, tag }) => (
  <div
    style={{
      position: "absolute",
      left: x,
      top: y,
      width: 820,
      height: 330,
      borderRadius: 24,
      background: P.white,
      border: `1px solid ${P.line}`,
      boxShadow:
        "0 1px 0 rgba(11,27,43,0.05), 0 24px 48px -30px rgba(11,27,43,0.3)",
      padding: 24,
      boxSizing: "border-box",
      overflow: "hidden",
    }}
  >
    <div
      style={{
        opacity: Math.min(1, k * 1.4),
        transform: `translateY(${(1 - k) * 24}px)`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 14,
          marginBottom: 14,
        }}
      >
        <span
          style={{
            fontFamily: F.mono,
            fontWeight: 700,
            fontSize: 24,
            color: P.ink,
          }}
        >
          {name}
        </span>
        <span
          style={{
            fontFamily: F.body,
            fontWeight: 500,
            fontSize: 19,
            color: P.slate,
          }}
        >
          {what}
        </span>
        {tag ? (
          <span
            style={{
              marginLeft: "auto",
              fontFamily: F.body,
              fontSize: 13,
              color: P.slate,
              background: P.mist,
              borderRadius: 999,
              padding: "3px 10px",
            }}
          >
            {tag}
          </span>
        ) : null}
      </div>
      {children}
    </div>
  </div>
);

export const S08Developers: React.FC = () => {
  const frame = useCurrentFrame();
  const at = beats("S08");
  const openapi = at("c087", "OpenAPI");
  const ts = at("c087", "TypeScript");
  const gateway = at("c088", "gateway");
  const python = at("c089", "Python");
  const gs1 = at("c089", "GS1");
  const k = (f: number) => env(frame, f - 6, undefined, 14);

  return (
    <Stage tone="white">
      <Tile
        x={120}
        y={90}
        k={k(openapi)}
        name="API reference"
        what="OpenAPI 3.1 · /docs"
      >
        <div
          style={{
            position: "relative",
            width: 772,
            height: 246,
            borderRadius: 12,
            overflow: "hidden",
            border: `1px solid ${P.line}`,
          }}
        >
          <Sequence from={openapi - 6} layout="none">
            <div style={{ position: "absolute", inset: 0 }}>
              <Footage
                shot="R3-02"
                frames={300}
                cardScale={0.42}
                punches={[]}
              />
            </div>
          </Sequence>
        </div>
      </Tile>
      <Tile
        x={980}
        y={90}
        k={k(ts)}
        name="@cargoflow/sdk"
        what="TypeScript SDK"
      >
        <Code
          lines={[
            "const cf = createClient();",
            "const why = await cf.shipments.explanation(id);",
            "const fee = await cf.pricing.suggest(id);",
          ]}
        />
      </Tile>
      <Tile
        x={120}
        y={450}
        k={k(gateway)}
        name="@cargoflow/gateway"
        what="gateway agent for data loggers"
        tag="illustrative output"
      >
        <Code
          lines={[
            "$ cargoflow-gateway watch ./logger-exports",
            "queued 32 readings",
            "sent · signed Ed25519",
          ]}
        />
      </Tile>
      <Tile
        x={980}
        y={450}
        k={k(python)}
        name="cargoflow"
        what="Python SDK · portfolio risk"
      >
        <Code
          lines={[
            "mc = cfa.simulate_default_recovery(pf, n_sims=20_000, seed=2026)",
            "mc.summary()",
          ]}
          size={18}
        />
      </Tile>
      <At
        x={120}
        y={812}
        style={{
          opacity: k(gs1),
          transform: `translateY(${(1 - k(gs1)) * 20}px)`,
        }}
      >
        <div
          style={{
            width: 1680,
            height: 64,
            borderRadius: 18,
            background: P.ink,
            display: "flex",
            alignItems: "center",
            gap: 18,
            padding: "0 28px",
            boxSizing: "border-box",
          }}
        >
          <span
            style={{
              fontFamily: F.mono,
              fontWeight: 700,
              fontSize: 22,
              color: P.signal,
            }}
          >
            GS1 EPCIS 2.0
          </span>
          <span
            style={{
              fontFamily: F.body,
              fontWeight: 500,
              fontSize: 22,
              color: P.white,
            }}
          >
            export and import · validated against the official 2.0.1 schema
          </span>
        </div>
      </At>
      <At x={120} y={892} style={{ opacity: env(frame, 10, undefined, 14) }}>
        <div
          style={{
            fontFamily: F.body,
            fontWeight: 500,
            fontSize: 17,
            color: "rgba(11,27,43,0.6)",
          }}
        >
          Packages build and pass their tests in the repository; not yet
          published to npm or PyPI.
        </div>
      </At>
    </Stage>
  );
};
