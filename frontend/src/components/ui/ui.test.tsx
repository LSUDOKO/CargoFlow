import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { explorerAddress, explorerTx } from "@/lib/explorer";
import { statusTone } from "@/lib/status";
import { Accordion } from "./Accordion";
import { Button } from "./Button";
import { Drawer } from "./Drawer";
import { HashBadge } from "./HashBadge";
import { Tabs } from "./Tabs";
import { ToastProvider, useToast } from "./Toast";

describe("Tabs", () => {
  const tabs = [{ id: "a", label: "Active", count: 3 }, { id: "b", label: "Paused" }, { id: "c", label: "All" }];
  it("exposes the WAI-ARIA tab pattern with counts", () => {
    render(<Tabs tabs={tabs} value="a" onChange={() => {}} label="Fleet" />);
    expect(screen.getByRole("tablist", { name: "Fleet" })).toBeTruthy();
    const active = screen.getByRole("tab", { name: /Active/ });
    expect(active.getAttribute("aria-selected")).toBe("true");
    expect(active.textContent).toContain("3");
    expect(screen.getByRole("tab", { name: "Paused" }).getAttribute("tabindex")).toBe("-1");
  });
  it("moves selection with arrow keys, Home and End, wrapping", () => {
    const onChange = vi.fn();
    render(<Tabs tabs={tabs} value="a" onChange={onChange} label="Fleet" />);
    const first = screen.getByRole("tab", { name: /Active/ });
    fireEvent.keyDown(first, { key: "ArrowRight" });
    fireEvent.keyDown(first, { key: "ArrowLeft" });
    fireEvent.keyDown(first, { key: "End" });
    expect(onChange.mock.calls.map((c) => c[0])).toEqual(["b", "c", "c"]);
  });
});

describe("status and explorer helpers", () => {
  it("maps facility status to tone", () => {
    expect(statusTone("PAUSED")).toBe("alert");
    expect(statusTone("DISPUTED")).toBe("alert");
    expect(statusTone("ACTIVE")).toBe("verified");
    expect(statusTone("SETTLED")).toBe("ink");
    expect(statusTone("DEFAULTED")).toBe("danger");
    expect(statusTone("WHATEVER")).toBe("slate");
  });
  it("links testnet hashes to the explorer and leaves local ones unlinked", () => {
    expect(explorerTx(46630, "0xab")).toBe("https://explorer.testnet.chain.robinhood.com/tx/0xab");
    expect(explorerAddress(46630, "0xcd")).toBe("https://explorer.testnet.chain.robinhood.com/address/0xcd");
    expect(explorerTx(31337, "0xab")).toBeNull();
  });
});

describe("HashBadge", () => {
  it("shortens, links on testnet and offers copy", () => {
    const h = "0x20e25734defd7372261a73ff6e78fff990047bb6545d7eebe768fcfca1a84487";
    render(<HashBadge value={h} chainId={46630} kind="tx" />);
    expect(screen.getByText("0x20e257…4487")).toBeTruthy();
    expect(screen.getByRole("link").getAttribute("href")).toContain(h);
    expect(screen.getByRole("button", { name: /copy/i })).toBeTruthy();
  });
});

describe("Button", () => {
  it("is disabled and busy while loading", () => {
    const onClick = vi.fn();
    render(<Button loading onClick={onClick}>Deposit</Button>);
    const b = screen.getByRole("button", { name: /Deposit/ });
    expect(b.getAttribute("aria-busy")).toBe("true");
    expect((b as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("Accordion", () => {
  it("toggles a panel and reports aria-expanded", () => {
    render(<Accordion items={[{ id: "q", title: "What is it?", body: "An answer" }]} />);
    const btn = screen.getByRole("button", { name: "What is it?" });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("An answer")).toBeTruthy();
  });
});

describe("Drawer", () => {
  it("is a labelled dialog that closes on Escape", () => {
    const onClose = vi.fn();
    render(<Drawer open title="Container" onClose={onClose}><button>inside</button></Drawer>);
    expect(screen.getByRole("dialog", { name: "Container" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});

describe("Toast", () => {
  function Fire() {
    const { toast } = useToast();
    return <button onClick={() => toast({ tone: "verified", title: "Deposited" })}>go</button>;
  }
  it("announces in a polite live region", () => {
    render(<ToastProvider><Fire /></ToastProvider>);
    act(() => fireEvent.click(screen.getByText("go")));
    const region = screen.getByRole("status");
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.textContent).toContain("Deposited");
  });
});

describe("dialog focus", () => {
  it("keeps focus where the user put it when the parent re-renders", async () => {
    const { Modal } = await import("./Modal");
    const { useState } = await import("react");
    function Host() {
      const [q, setQ] = useState("");
      return (
        <Modal open title="Find" onClose={() => {}}>
          <input aria-label="query" value={q} onChange={(e) => setQ(e.target.value)} />
        </Modal>
      );
    }
    render(<Host />);
    const input = screen.getByLabelText("query") as HTMLInputElement;
    input.focus();
    fireEvent.change(input, { target: { value: "C" } });
    fireEvent.change(input, { target: { value: "CF" } });
    expect(document.activeElement).toBe(input);
  });
});

/* ── design system v2 ───────────────────────────────────────────────────── */

describe("Button v2", () => {
  it("swaps the label for loadingText and keeps the busy state", async () => {
    const { Button } = await import("./Button");
    render(<Button loading loadingText="Signing…">Sign</Button>);
    const b = screen.getByRole("button", { name: /Signing/ });
    expect(b.getAttribute("aria-busy")).toBe("true");
  });
  it("names an icon-only button from its label", async () => {
    const { IconButton } = await import("./Button");
    render(<IconButton label="Open menu"><svg /></IconButton>);
    expect(screen.getByRole("button", { name: "Open menu" })).toBeTruthy();
  });
});

describe("Badge and StatusPill", () => {
  it("keeps the status test id and maps tones to semantic variants", async () => {
    const { StatusPill, Badge } = await import("./Pill");
    render(<><StatusPill status="PAUSED" /><Badge variant="info">Info</Badge></>);
    const pill = screen.getByTestId("status-pill");
    expect(pill.textContent).toBe("Paused");
    expect(pill.closest("span.ring-1")?.className).toContain("bg-warning-bg");
    expect(screen.getByText("Info").closest("span.ring-1")?.className).toContain("text-info-fg");
  });
});

describe("Tabs v2", () => {
  it("prefixes ids and skips disabled tabs with the arrow keys", async () => {
    const { Tabs } = await import("./Tabs");
    const onChange = vi.fn();
    render(<Tabs idBase="audit-" label="Filter" value="a" onChange={onChange} tabs={[{ id: "a", label: "A" }, { id: "b", label: "B", disabled: true }, { id: "c", label: "C" }]} />);
    const a = screen.getByRole("tab", { name: "A" });
    expect(a.id).toBe("audit-tab-a");
    expect(a.getAttribute("aria-controls")).toBe("audit-panel-a");
    fireEvent.keyDown(a, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("c");
  });
});

describe("Modal v2 and Sheet", () => {
  it("describes the dialog and renders a footer", async () => {
    const { Modal } = await import("./Modal");
    render(<Modal open title="Close request?" description="Financiers will no longer see it." onClose={() => {}} footer={<button>Confirm</button>}>body</Modal>);
    const d = screen.getByRole("dialog", { name: "Close request?" });
    expect(document.getElementById(d.getAttribute("aria-describedby")!)?.textContent).toContain("Financiers");
    expect(screen.getByRole("button", { name: "Confirm" })).toBeTruthy();
  });
  it("opens a bottom sheet as a labelled dialog", async () => {
    const { Sheet } = await import("./Drawer");
    render(<Sheet open title="Choose a wallet" onClose={() => {}}>x</Sheet>);
    expect(screen.getByRole("dialog", { name: "Choose a wallet" })).toBeTruthy();
  });
});

describe("Field, Select and Textarea", () => {
  it("wires help and error to the control", async () => {
    const { Field, Select, Textarea } = await import("./Field");
    const { rerender } = render(<Field label="Invoice value (USDG)" help="Whole USDG" suffix="USDG" />);
    const input = screen.getByLabelText("Invoice value (USDG)");
    expect(document.getElementById(input.getAttribute("aria-describedby")!)?.textContent).toBe("Whole USDG");
    rerender(<Field label="Invoice value (USDG)" help="Whole USDG" error="Enter an amount" />);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(input.getAttribute("aria-describedby")!)?.textContent).toContain("Enter an amount");
    render(<><Select label="Sort"><option>Newest first</option></Select><Textarea label="What went wrong" optional /></>);
    expect(screen.getByRole("combobox", { name: "Sort" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: /What went wrong/ })).toBeTruthy();
  });
});

describe("DataTable", () => {
  type Row = { id: string; ref: string; amount: number };
  const rows: Row[] = [{ id: "1", ref: "CF-A", amount: 30 }, { id: "2", ref: "CF-B", amount: 120 }];
  it("renders a captioned table with right-aligned numbers and sorts by a column", async () => {
    const { DataTable } = await import("./DataTable");
    render(
      <DataTable<Row>
        caption="Shipments"
        rows={rows}
        rowKey={(r) => r.id}
        rowHref={(r) => `/track/${r.id}`}
        columns={[{ key: "ref", header: "Shipment", primary: true }, { key: "amount", header: "Amount", numeric: true, sortable: true }]}
      />,
    );
    const table = screen.getByRole("table", { name: "Shipments" });
    const amountHeader = within(table).getByRole("columnheader", { name: /Amount/ });
    expect(amountHeader.className).toContain("text-right");
    expect(amountHeader.getAttribute("aria-sort")).toBe("none");
    fireEvent.click(within(amountHeader).getByRole("button"));
    expect(amountHeader.getAttribute("aria-sort")).toBe("descending");
    const firstRowCells = within(table).getAllByRole("row")[1]!;
    expect(firstRowCells.textContent).toContain("CF-B");
    expect(within(table).getByRole("link", { name: "CF-A" }).getAttribute("href")).toBe("/track/1");
  });
  it("shows the empty state and the loading state", async () => {
    const { DataTable } = await import("./DataTable");
    const cols = [{ key: "ref", header: "Shipment" }];
    const { rerender } = render(<DataTable<Row> caption="Shipments" rows={[]} rowKey={(r) => r.id} columns={cols} empty={<p>No shipments yet</p>} cards={false} />);
    expect(screen.getByText("No shipments yet")).toBeTruthy();
    rerender(<DataTable<Row> caption="Shipments" rows={[]} rowKey={(r) => r.id} columns={cols} loading cards={false} />);
    expect(screen.getByRole("table").getAttribute("aria-busy")).toBe("true");
  });
});

describe("Stat, Sparkline and KeyValue", () => {
  it("gives the delta direction to screen readers", async () => {
    const { Stat } = await import("./Stat");
    const { Sparkline } = await import("./Sparkline");
    render(<Stat label="Capital drawn" value="40,000" unit="USDG" delta={{ value: "+4.2%", direction: "up", context: "since last week" }} chart={<Sparkline values={[1, 3, 2]} label="Drawn over 3 days" />} />);
    expect(screen.getByText("Capital drawn")).toBeTruthy();
    expect(screen.getByText(/up since last week/)).toBeTruthy();
    expect(screen.getByRole("img", { name: "Drawn over 3 days" })).toBeTruthy();
  });
  it("renders a description list", async () => {
    const { KeyValue } = await import("./KeyValue");
    render(<KeyValue items={[{ label: "Temperature", value: "2.0 °C to 8.0 °C" }, { label: "Fee", value: "3%", numeric: true }]} />);
    expect(screen.getByText("Temperature").tagName).toBe("DT");
    expect(screen.getByText("3%").tagName).toBe("DD");
  });
});

describe("Timeline", () => {
  it("marks the active step and tells screen readers each state", async () => {
    const { Timeline } = await import("./Timeline");
    render(<Timeline label="Journey" items={[{ id: "1", title: "Checkpoint 1", state: "done" }, { id: "2", title: "Checkpoint 2", state: "held" }, { id: "3", title: "Checkpoint 3", state: "pending" }]} />);
    const list = screen.getByRole("list", { name: "Journey" });
    const items = within(list).getAllByRole("listitem");
    expect(items[0]!.textContent).toContain("Done");
    expect(items[1]!.textContent).toContain("On hold");
    expect(items.filter((li) => li.getAttribute("aria-current") === "step")).toHaveLength(0);
  });
});

describe("Section, EmptyState, Kbd and Banner", () => {
  it("labels a section by its heading", async () => {
    const { Section } = await import("./Section");
    render(<Section title="Endpoints">x</Section>);
    expect(screen.getByRole("region", { name: "Endpoints" })).toBeTruthy();
  });
  it("renders an empty state with its action", async () => {
    const { EmptyState } = await import("./EmptyState");
    render(<EmptyState title="Nothing matches these filters" action={<button>Clear filters</button>} />);
    expect(screen.getByRole("heading", { name: "Nothing matches these filters" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeTruthy();
  });
  it("renders a key chord", async () => {
    const { Kbd } = await import("./Kbd");
    const { container } = render(<Kbd keys={["Ctrl", "K"]} />);
    expect(container.querySelectorAll("kbd")).toHaveLength(2);
  });
  it("announces assertive banners as alerts and can be dismissed", async () => {
    const { Banner, Callout } = await import("./Banner");
    const onDismiss = vi.fn();
    render(<><Banner variant="danger" live="assertive" title="The backend is not reachable" onDismiss={onDismiss} /><Callout variant="info">Static guidance</Callout></>);
    expect(screen.getByRole("alert").textContent).toContain("backend is not reachable");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalled();
    expect(screen.getByText("Static guidance").closest("[role]")).toBeNull();
  });
});

describe("CopyField", () => {
  it("copies the full value and links to the explorer", async () => {
    const { CopyField } = await import("./CopyField");
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const a = "0x8e6877a28d51a6c2b1699154cc17f3ebf682102f";
    render(<CopyField label="Exporter" value={a} chainId={46630} />);
    expect(screen.getByRole("link", { name: /explorer/ }).getAttribute("href")).toContain(a);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Copy Exporter/ })));
    expect(writeText).toHaveBeenCalledWith(a);
    expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
  });
});

describe("Tooltip", () => {
  it("opens on focus, describes the trigger and closes on Escape", async () => {
    const { Tooltip } = await import("./Tooltip");
    render(<Tooltip content="Needs 75 or more"><button>Evidence score</button></Tooltip>);
    const btn = screen.getByRole("button", { name: "Evidence score" });
    act(() => btn.focus());
    const tip = screen.getByRole("tooltip");
    expect(tip.textContent).toBe("Needs 75 or more");
    expect(btn.getAttribute("aria-describedby")).toBe(tip.id);
    act(() => { fireEvent.keyDown(document, { key: "Escape" }); });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});

/* ── kit cleanup: new props ─────────────────────────────────────────────── */

/** Stub window.matchMedia so viewport-dependent components pick one layout; returns a restore function. */
function mockViewport(width: number) {
  const prev = window.matchMedia;
  window.matchMedia = ((q: string) => {
    const min = Number(/min-width:\s*(\d+)px/.exec(q)?.[1] ?? 0);
    return { matches: width >= min, media: q, addEventListener: () => {}, removeEventListener: () => {}, onchange: null, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false } as MediaQueryList;
  }) as typeof window.matchMedia;
  return () => { window.matchMedia = prev; };
}

describe("CardHeader and EmptyState", () => {
  it("lets wide trailing content shrink and wrap", async () => {
    const { CardHeader } = await import("./Card");
    render(<CardHeader title="Parties"><span>trailing</span></CardHeader>);
    const trailing = screen.getByText("trailing").parentElement!;
    expect(trailing.className).toContain("min-w-0");
    expect(trailing.className).toContain("flex-wrap");
    expect(trailing.className).not.toContain("shrink-0");
  });
  it("can carry the page's h1", async () => {
    const { EmptyState } = await import("./EmptyState");
    render(<EmptyState as="h1" title="We couldn't find that shipment" />);
    expect(screen.getByRole("heading", { level: 1, name: "We couldn't find that shipment" })).toBeTruthy();
  });
});

describe("Stat value type", () => {
  it("sets amounts in Inter with tabular numerals, not the display face", async () => {
    const { Stat } = await import("./Stat");
    render(<Stat label="Released" value="17,111" unit="USDG" />);
    const p = screen.getByText("17,111").parentElement!;
    expect(p.className).toContain("num");
    expect(p.className).toContain("font-sans");
    expect(p.className).not.toContain("font-display");
  });
});

describe("Timeline fill", () => {
  it("shares the width between horizontal steps", async () => {
    const { Timeline } = await import("./Timeline");
    const items = Array.from({ length: 7 }, (_, i) => ({ id: `s${i}`, title: `Step ${i + 1}`, state: "pending" as const }));
    render(<Timeline orientation="horizontal" fill label="Journey" items={items} />);
    const lis = within(screen.getByRole("list", { name: "Journey" })).getAllByRole("listitem");
    expect(lis).toHaveLength(7);
    expect(lis.every((li) => li.className.includes("flex-1") && !li.className.includes("w-44"))).toBe(true);
  });
});

describe("DataTable row clicks, row classes and responsive columns", () => {
  type Row = { id: string; ref: string; amount: number };
  const rows: Row[] = [{ id: "1", ref: "CF-A", amount: 30 }, { id: "2", ref: "CF-B", amount: 120 }];
  it("calls onRowClick from the row and from the primary button, but not from controls inside the row", async () => {
    const { DataTable } = await import("./DataTable");
    const onRowClick = vi.fn();
    const action = vi.fn();
    render(
      <DataTable<Row>
        caption="Fleet"
        rows={rows}
        rowKey={(r) => r.id}
        cards={false}
        onRowClick={onRowClick}
        rowClassName={(r) => (r.id === "2" ? "is-picked" : undefined)}
        columns={[
          { key: "ref", header: "Shipment", primary: true },
          { key: "amount", header: "Amount", numeric: true, hideBelow: "md" },
          { key: "go", header: "Go", cell: (r) => <button type="button" onClick={() => action(r.id)}>Open {r.ref}</button> },
        ]}
      />,
    );
    const table = screen.getByRole("table", { name: "Fleet" });
    const [, first, second] = within(table).getAllByRole("row");
    fireEvent.click(within(first!).getByText("30"));
    expect(onRowClick).toHaveBeenLastCalledWith(rows[0]);
    fireEvent.click(within(table).getByRole("button", { name: "CF-B" }));
    expect(onRowClick).toHaveBeenLastCalledWith(rows[1]);
    expect(onRowClick).toHaveBeenCalledTimes(2);
    fireEvent.click(within(table).getByRole("button", { name: "Open CF-A" }));
    expect(action).toHaveBeenCalledWith("1");
    expect(onRowClick).toHaveBeenCalledTimes(2);
    expect(second!.className).toContain("is-picked");
    expect(second!.className).toContain("cursor-pointer");
    expect(within(table).getByRole("columnheader", { name: "Amount" }).className).toContain("max-md:hidden");
  });
  it("keeps only the variant that matches the viewport, so rows are never in the DOM twice", async () => {
    const { DataTable } = await import("./DataTable");
    const cols = [{ key: "ref", header: "Shipment", primary: true }, { key: "amount", header: "Amount", numeric: true }];
    let restore = mockViewport(1280);
    const { unmount } = render(<DataTable<Row> caption="Shipments" rows={rows} rowKey={(r) => r.id} columns={cols} />);
    expect(screen.getByRole("table", { name: "Shipments" })).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Shipments" })).toBeNull();
    expect(screen.getAllByText("CF-A")).toHaveLength(1);
    unmount();
    restore();
    restore = mockViewport(390);
    render(<DataTable<Row> caption="Shipments" rows={rows} rowKey={(r) => r.id} columns={cols} />);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("list", { name: "Shipments" })).toBeTruthy();
    expect(screen.getAllByText("CF-A")).toHaveLength(1);
    restore();
  });
});

describe("CopyField explorers", () => {
  const a = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
  it("links to an explorer the app does not know through explorerBase", async () => {
    const { CopyField } = await import("./CopyField");
    render(<CopyField value={a} explorerBase="https://sepolia.arbiscan.io/" srLabel="GMXHedgeVault" size="sm" />);
    const link = screen.getByRole("link", { name: "View GMXHedgeVault on the explorer (opens in a new tab)" });
    expect(link.getAttribute("href")).toBe(`https://sepolia.arbiscan.io/address/${a}`);
    expect(screen.getByRole("button", { name: `Copy GMXHedgeVault ${a}` })).toBeTruthy();
  });
  it("uses an explicit href over everything else", async () => {
    const { CopyField } = await import("./CopyField");
    render(<CopyField value={a} kind="tx" chainId={46630} href="https://example.org/tx/1" />);
    expect(screen.getByRole("link").getAttribute("href")).toBe("https://example.org/tx/1");
  });
});

describe("Stepper horizontal", () => {
  const steps = [{ id: "a", label: "Shipment", description: "Reference, buyer and invoice" }, { id: "b", label: "Cold-chain policy", description: "Temperature band" }, { id: "c", label: "Financing" }, { id: "d", label: "Sign" }];
  it("shows descriptions in one row on wide screens", async () => {
    const restore = mockViewport(1280);
    const { Stepper } = await import("./Stepper");
    render(<Stepper steps={steps} current={1} label="Registration steps" />);
    const list = screen.getByRole("list", { name: "Registration steps" });
    expect(list.className).not.toContain("flex-wrap");
    expect(within(list).getByText("Temperature band").className).toContain("truncate");
    expect(within(list).getAllByRole("listitem")[1]!.getAttribute("aria-current")).toBe("step");
    expect(screen.queryByText("Step 2 of 4")).toBeNull();
    restore();
  });
  it("collapses to “Step 2 of 4” on phones", async () => {
    const restore = mockViewport(390);
    const { Stepper } = await import("./Stepper");
    render(<Stepper steps={steps} current={1} label="Registration steps" />);
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByText("Step 2 of 4")).toBeTruthy();
    expect(screen.getByText("Cold-chain policy")).toBeTruthy();
    restore();
  });
});

describe("Field inputClassName", () => {
  it("styles the input, not the wrapper", async () => {
    const { Field } = await import("./Field");
    const { container } = render(<Field label="Buyer address" className="md:col-span-2" inputClassName="font-mono" />);
    const input = screen.getByLabelText("Buyer address");
    expect(input.className).toContain("font-mono");
    expect((container.firstChild as HTMLElement).className).toContain("md:col-span-2");
    expect((container.firstChild as HTMLElement).className).not.toContain("font-mono");
  });
});
