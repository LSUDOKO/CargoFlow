import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.fn();
const m = vi.hoisted(() => ({ switchChain: vi.fn(), writeContract: vi.fn(), waitForTransactionReceipt: vi.fn(), account: { chainId: 1 as number | undefined, isConnected: true } }));

vi.mock("wagmi", () => ({ useAccount: () => m.account }));
vi.mock("wagmi/actions", () => ({ switchChain: m.switchChain, writeContract: m.writeContract, waitForTransactionReceipt: m.waitForTransactionReceipt }));
vi.mock("./config", () => ({ wagmiConfig: {} }));
vi.mock("./contracts", () => ({ useContracts: () => ({ chainId: 46630, contracts: undefined }) }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ toast }) }));

import { useTx } from "./useTx";

const req = { address: "0x0000000000000000000000000000000000000001" as const, abi: [], functionName: "startTransit", label: "Start transit" };
const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;

describe("useTx", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.account = { chainId: 1, isConnected: true };
    m.writeContract.mockResolvedValue("0xhash");
    m.waitForTransactionReceipt.mockResolvedValue({ status: "success" });
  });

  it("holds the busy guard while the wallet switches network, so a double click sends once", async () => {
    let finishSwitch!: () => void;
    m.switchChain.mockReturnValue(new Promise<void>((r) => (finishSwitch = r)));
    const { result } = renderHook(() => useTx(), { wrapper });

    let first!: Promise<unknown>;
    let second!: Promise<unknown>;
    act(() => {
      first = result.current.send(req);
      second = result.current.send(req); // lands while the switch prompt is still open
    });
    expect(await second).toBeUndefined();
    expect(toast).toHaveBeenCalledWith({ tone: "alert", title: "A transaction is already in progress." });
    expect(m.switchChain).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishSwitch();
      expect(await first).toBe("0xhash");
    });
    expect(m.writeContract).toHaveBeenCalledTimes(1);
  });

  it("releases the guard when the wallet refuses to switch", async () => {
    m.switchChain.mockRejectedValue(new Error("rejected"));
    const { result } = renderHook(() => useTx(), { wrapper });
    await act(async () => {
      expect(await result.current.send(req)).toBeUndefined();
    });
    expect(toast).toHaveBeenCalledWith({ tone: "alert", title: "Switch your wallet to Robinhood Chain Testnet." });
    expect(m.writeContract).not.toHaveBeenCalled();
    expect(result.current.pending).toBe(false);

    // the next attempt is not blocked by a stale guard
    m.account = { chainId: 46630, isConnected: true };
    const { result: again } = renderHook(() => useTx(), { wrapper });
    await act(async () => {
      expect(await again.current.send(req)).toBe("0xhash");
    });
  });
});
