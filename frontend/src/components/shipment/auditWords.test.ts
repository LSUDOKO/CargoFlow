import { describe, expect, it } from "vitest";
import { auditTitle, dayKey } from "./auditWords";

describe("auditTitle", () => {
  it("names contract events in plain words, with the milestone counted from one", () => {
    expect(auditTitle({ kind: "chain_event", title: "FinancingController.MilestoneAdvanceReleased", detail: { args: { milestoneIndex: 0, amount: "4000000" } } })).toEqual({ title: "Milestone 1 released", note: "4 USDG" });
    expect(auditTitle({ kind: "chain_event", title: "FinancingController.StatusChanged", detail: { args: { from: 0, to: 3 } } }).title).toBe("Status changed to Active");
    expect(auditTitle({ kind: "chain_event", title: "ReceivableVault.FacilitySettled" }).title).toBe("Invoice paid and settled");
    expect(auditTitle({ kind: "chain_event", title: "Foo.SomethingNewHappened" }).title).toBe("Something new happened");
  });
  it("words relayer actions, monitor decisions and evidence batches", () => {
    expect(auditTitle({ kind: "action", title: "COMMIT_EPOCH CONFIRMED" })).toEqual({ title: "Commit an evidence batch", note: "confirmed" });
    expect(auditTitle({ kind: "monitoring", title: "PAUSE_FACILITY SCORE_BELOW_THRESHOLD" })).toEqual({ title: "Monitor paused the facility", note: "evidence score below the threshold" });
    expect(auditTitle({ kind: "epoch", title: "Epoch M2#1 score 48 PAUSE_FACILITY" })).toEqual({ title: "Evidence batch for milestone 3 (#1)", note: "score 48" });
    expect(auditTitle({ kind: "epoch", title: "Epoch M255#4 score 100 OBSERVED" }).title).toBe("Observation batch #4");
  });
  it("groups by local day", () => {
    expect(dayKey("2026-10-03T12:07:20Z")).toMatch(/^2026-10-0[34]$/);
  });
});
