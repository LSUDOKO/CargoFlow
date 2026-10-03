import { describe, expect, it } from "vitest";
import { buildPolicy, defaultPolicyForm, validatePolicy } from "./exporter";
import { limitsText, matchTemplate, TEMPLATES } from "./templates";

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
  it("set the documented humidity and shock limits", () => {
    const limits = (id: string) => {
      const p = buildPolicy(TEMPLATES.find((t) => t.id === id)!.form);
      return [p.maxHumidityX100 / 100, p.maxShockX100 / 100];
    };
    expect(limits("pharma")).toEqual([85, 3]);
    expect(limits("frozen")).toEqual([90, 4]);
    expect(limits("chilled")).toEqual([95, 2]);
    expect(limits("bananas")).toEqual([95, 2]);
    expect(limits("electronics")).toEqual([70, 5]);
    expect(limitsText(defaultPolicyForm)).toBe("Humidity up to 85% · shock up to 3 g");
    expect(limitsText({ maxHumidityPct: "", maxShockG: "" })).toBe("No humidity limit · no shock limit");
  });
  it("treat 'no limit' as an edit (it differs from every template)", () => {
    expect(matchTemplate({ ...defaultPolicyForm, maxShockG: "" })).toBeUndefined();
  });
  it("stop matching once a field is edited, and match again numerically", () => {
    expect(matchTemplate({ ...defaultPolicyForm, maxTemp: "9" })).toBeUndefined();
    expect(matchTemplate({ ...defaultPolicyForm, maxTemp: "8.0" })?.id).toBe("pharma");
  });
});
