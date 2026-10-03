import { describe, expect, it } from "vitest";
import { buildPolicy, defaultPolicyForm, validatePolicy } from "./exporter";
import { matchTemplate, TEMPLATES } from "./templates";

describe("cargo templates", () => {
  it("are all valid policies, and pharma is the wizard's default", () => {
    for (const t of TEMPLATES) expect(validatePolicy(t.form)).toEqual({});
    expect(matchTemplate(defaultPolicyForm)?.id).toBe("pharma");
  });
  it("set the documented bands", () => {
    const band = (id: string) => {
      const p = buildPolicy(TEMPLATES.find((t) => t.id === id)!.form);
      return [p.minTempX100 / 100, p.maxTempX100 / 100];
    };
    expect(band("pharma")).toEqual([2, 8]);
    expect(band("frozen")).toEqual([-25, -15]);
    expect(band("chilled")).toEqual([0, 4]);
    expect(band("bananas")).toEqual([13, 15]);
    expect(band("electronics")).toEqual([5, 35]);
  });
  it("stop matching once a field is edited, and match again numerically", () => {
    expect(matchTemplate({ ...defaultPolicyForm, maxTemp: "9" })).toBeUndefined();
    expect(matchTemplate({ ...defaultPolicyForm, maxTemp: "8.0" })?.id).toBe("pharma");
  });
});
