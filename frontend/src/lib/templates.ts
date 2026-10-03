// Cargo templates for the wizard's policy step: sensible starting limits per kind of cargo. Picking one fills the
// form; every field stays editable. Pharma matches defaultPolicyForm, so the wizard's default is unchanged.

import { defaultPolicyForm, type PolicyForm } from "./exporter";

export type CargoTemplate = { id: string; label: string; band: string; note: string; form: PolicyForm };

export const TEMPLATES: CargoTemplate[] = [
  {
    id: "pharma",
    label: "Pharma",
    band: "2 to 8 °C",
    note: "Vaccines, biologics and insulin under GDP: tight band, fresh evidence, strict scoring.",
    form: defaultPolicyForm,
  },
  {
    id: "frozen",
    label: "Frozen",
    band: "−25 to −15 °C",
    note: "Frozen meat, fish and ready meals. Hourly evidence is enough; sensors may disagree a little more.",
    form: { minTemp: "-25", maxTemp: "-15", maxAgeMin: "60", maxDeviationKm: "50", minScore: "70", maxConflictPct: "30", maxRiskPct: "40", maxHumidityPct: "90", maxShockG: "4" },
  },
  {
    id: "chilled",
    label: "Chilled produce",
    band: "0 to 4 °C",
    note: "Leafy greens, berries, dairy and fresh meat: cold and close to freezing.",
    form: { minTemp: "0", maxTemp: "4", maxAgeMin: "45", maxDeviationKm: "50", minScore: "70", maxConflictPct: "35", maxRiskPct: "40", maxHumidityPct: "95", maxShockG: "2" },
  },
  {
    id: "bananas",
    label: "Bananas",
    band: "13 to 15 °C",
    note: "Below 13 °C bananas chill-damage; above 15 °C they ripen in the box.",
    form: { minTemp: "13", maxTemp: "15", maxAgeMin: "60", maxDeviationKm: "50", minScore: "70", maxConflictPct: "35", maxRiskPct: "40", maxHumidityPct: "95", maxShockG: "2" },
  },
  {
    id: "electronics",
    label: "Ambient electronics",
    band: "5 to 35 °C",
    note: "Consumer electronics and batteries: wide band, evidence every two hours, a wider route corridor.",
    form: { minTemp: "5", maxTemp: "35", maxAgeMin: "120", maxDeviationKm: "100", minScore: "60", maxConflictPct: "40", maxRiskPct: "50", maxHumidityPct: "70", maxShockG: "5" },
  },
];

// an empty field (a humidity or shock "no limit") equals only another empty field
const norm = (s: string) => (s.trim() === "" ? "none" : Number(s));

/** The template a form still matches field for field (numerically), or undefined once it has been edited. */
export function matchTemplate(form: PolicyForm): CargoTemplate | undefined {
  const keys = Object.keys(defaultPolicyForm) as (keyof PolicyForm)[];
  return TEMPLATES.find((t) => keys.every((k) => norm(t.form[k]) === norm(form[k])));
}

/** "Humidity up to 85% · shock up to 3 g", with "no limit" for an empty field. */
export function limitsText(form: Pick<PolicyForm, "maxHumidityPct" | "maxShockG">): string {
  const h = form.maxHumidityPct.trim() ? `humidity up to ${form.maxHumidityPct.trim()}%` : "no humidity limit";
  const g = form.maxShockG.trim() ? `shock up to ${form.maxShockG.trim()} g` : "no shock limit";
  return `${h.charAt(0).toUpperCase()}${h.slice(1)} · ${g}`;
}
