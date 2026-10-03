/**
 * Every number that appears on screen lives here, so figures can be swapped
 * without touching the scenes. Sources are listed in video/SCRIPT.md.
 */

// ---- S1 Problem: market stats -------------------------------------------
// Values and sources from video/SCRIPT.md ("Sources"), checked 2 Oct 2026.

// ADB Global Trade Finance Gap Survey 2025 (brief Dec 2025; news release 15 Jan 2026).
export const TRADE_FINANCE_GAP = "$2.5 trillion";
export const TRADE_FINANCE_GAP_LABEL = "global trade finance gap";
export const TRADE_FINANCE_GAP_SOURCE =
  "ADB Global Trade Finance Gap Survey 2025";

// Same ADB survey: 41% of SME trade-finance requests rejected.
export const SME_REJECTION = "41%";
export const SME_REJECTION_LABEL = "of SME trade-finance requests are rejected";

// IQVIA Institute (2019), reported by Air Cargo News, July 2019.
export const SPOILAGE_STAT = "$35 billion";
export const SPOILAGE_LABEL =
  "lost by biopharma every year to temperature-control failures";
export const SPOILAGE_SOURCE = "IQVIA Institute (2019), via Air Cargo News";
// Alternative card (not in the VO): "Up to 50% of vaccines wasted", WHO estimate via UNEP (2020).

// Atradius Payment Practices Barometer, India 2025: average B2B payment terms.
export const PAYMENT_TERMS_DAYS = 52;
export const PAYMENT_TERMS_LABEL = "52 days";
export const PAYMENT_TERMS_SOURCE =
  "Atradius Payment Practices Barometer, India 2025";

// The protagonist is an illustrative composite (SCRIPT.md).
export const PROTAGONIST = "Meera";

// ---- Story numbers (from the README "story in one picture") ----------------
export const FACILITY_USDG = 40_000;
export const MILESTONES = 5;
export const TRANCHE_USDG = 8_000;
export const INVOICE_USDG = 100_000;
export const FEE_USDG = 1_200; // 3%
export const RESIDUAL_USDG = 58_800;
export const TEMP_BAND_MAX_C = 8;

// ---- S5 Why Robinhood (measured) --------------------------------------------
export const CHAIN_ID = 46630;
export const FEE_PER_TX_ETH = "~0.000002 ETH"; // measured from receipts, 2 Oct 2026
export const BLOCK_INTERVAL = "~0.14 s"; // 10,000 testnet blocks in 1,439 s, measured 2 Oct 2026
export const LIVE_SHIPMENT = "CF-LIVE-1790936950736";
export const TESTNET_TRAIL_TXS = 22;

// ---- S6 Proof (measured) ----------------------------------------------------
export const CONTRACT_TESTS = 174;
export const CIRCUIT_TESTS = 25;
export const FRONTEND_UNIT_TESTS = 78;
export const BROWSER_E2E_TESTS = 18;

export const LIVE_TX = [
  {
    label: "Zero-knowledge proof by the exporter",
    hash: "0xc582417abd0ce8498bab0fa4937b0a8ec8dbfbe19c47646f79646fa70ede1a82",
  },
  {
    label: "Invoice paid, waterfall settled",
    hash: "0x78984fdfcefd2fa792c7170fff94b1f4b482986e96fad29193ff450251605041",
  },
] as const;

// ---- Links ------------------------------------------------------------------
export const APP_URL = "cargoflow.adoranto737.workers.dev";
export const REPO_URL = "github.com/LSUDOKO/CargoFlow";
