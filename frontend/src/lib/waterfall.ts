/**
 * The settlement waterfall exactly as ReceivableVault.settle computes it (integer base units):
 * the buyer's invoice pays the financier the drawn principal, the fee on that principal and any undrawn
 * commitment back; the exporter receives the residual.
 */
export function waterfall(drawn: string | bigint, invoice: string | bigint, feeBps: number, committed?: string | bigint) {
  const principal = BigInt(drawn);
  const inv = BigInt(invoice);
  const fee = (principal * BigInt(feeBps)) / 10_000n;
  const undrawn = committed === undefined ? 0n : BigInt(committed) - principal;
  return { principal, fee, undrawn, financier: principal + fee + undrawn, residual: inv - principal - fee };
}
