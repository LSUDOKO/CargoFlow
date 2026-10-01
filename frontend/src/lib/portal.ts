/** What a wallet still needs before it can pay `required` USDG into the vault. */
export function fundingNeeds(balance: bigint | undefined, allowance: bigint | undefined, required: bigint) {
  const bal = balance ?? 0n;
  const allow = allowance ?? 0n;
  const shortfall = bal >= required ? 0n : required - bal;
  const needsApproval = allow < required;
  return { shortfall, needsApproval, ready: balance !== undefined && allowance !== undefined && shortfall === 0n && !needsApproval };
}
