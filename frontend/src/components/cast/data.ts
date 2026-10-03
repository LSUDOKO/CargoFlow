import type { CharacterProps } from "./Person";

export type CharacterName = "meera" | "daniel" | "weilin" | "arbiter" | "insurer" | "carrier";

/** Who each person is, in plain words. `sentence` says what they do in CargoFlow. */
export const CAST: Record<CharacterName, { name: string; role: string; where: string; sentence: string; prop: NonNullable<CharacterProps["prop"]> }> = {
  meera: {
    name: "Meera",
    role: "Exporter",
    where: "Vaccines, Pune",
    sentence: "Ships temperature-sensitive vaccines and gets paid in stages while the container is still at sea, instead of waiting months.",
    prop: "tablet",
  },
  daniel: {
    name: "Daniel",
    role: "Financier",
    where: "Credit fund",
    sentence: "Puts up the working capital. His money sits in a locked vault and is released only when the cargo's own sensor readings say it is fine.",
    prop: "phone",
  },
  weilin: {
    name: "Wei Lin",
    role: "Buyer",
    where: "Pharma importer, Singapore",
    sentence: "Receives the cargo and pays the invoice once. That single payment repays Daniel and sends Meera the rest.",
    prop: "invoice",
  },
  arbiter: {
    name: "The Arbiter",
    role: "Dispute resolution",
    where: "Independent",
    sentence: "Steps in only when the parties disagree, decides with the full evidence trail in front of him, and every ruling is on the record.",
    prop: "folder",
  },
  insurer: {
    name: "The Insurer",
    role: "Parametric cover",
    where: "Cargo cover",
    sentence: "Sells cover that pays out automatically when the evidence shows the cargo spoiled, with no claim forms and no waiting.",
    prop: "umbrella",
  },
  carrier: {
    name: "The Carrier",
    role: "Ship's officer",
    where: "Bill of lading",
    sentence: "Issues the digital bill of lading. Whoever holds that token controls the goods, so it can be locked to the loan that finances them.",
    prop: "bol",
  },
};

export const CAST_ORDER: CharacterName[] = ["meera", "daniel", "weilin", "arbiter", "insurer", "carrier"];

