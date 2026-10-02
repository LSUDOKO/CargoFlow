import { ImageResponse } from "next/og";

export const alt = "CargoFlow — capital that moves with your cargo";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#0B1B2B", padding: 72, color: "#F7F9F4", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ width: 64, height: 64, borderRadius: 14, border: "8px solid #C6F432", borderRight: "8px solid transparent", display: "flex" }} />
          <div style={{ display: "flex", fontSize: 48, fontWeight: 700, letterSpacing: -1 }}>
            <span>Cargo</span>
            <span style={{ color: "#C6F432" }}>Flow</span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", fontSize: 76, fontWeight: 700, lineHeight: 1.02, letterSpacing: -2 }}>
          <div style={{ display: "flex" }}>Capital that</div>
          <div style={{ display: "flex" }}>
            <span style={{ background: "#C6F432", color: "#0B1B2B", padding: "0 14px" }}>moves</span>
            <span style={{ marginLeft: 20 }}>with your cargo.</span>
          </div>
        </div>
        <div style={{ display: "flex", fontSize: 28, color: "#9FB3C4" }}>USDG escrow released on verified shipment evidence · Robinhood Chain</div>
      </div>
    ),
    size,
  );
}
