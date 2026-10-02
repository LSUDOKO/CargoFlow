import { act, fireEvent, render, screen } from "@testing-library/react";
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
