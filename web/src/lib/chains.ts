export const CHAINS = [
  { id: "appchain", label: "ETH · Our OP Stack appchain", symbol: "ETH", testnet: true },
  { id: "sepolia", label: "ETH · Sepolia testnet", symbol: "ETH", testnet: true },
  { id: "eth", label: "ETH · Ethereum mainnet", symbol: "ETH", testnet: false },
  { id: "btc", label: "BTC · Bitcoin mainnet", symbol: "BTC", testnet: false },
  { id: "optimism", label: "ETH · OP Mainnet", symbol: "ETH", testnet: false },
] as const;
export type Chain = typeof CHAINS[number]["id"];
export type ChainBalance = {
  chain: Chain; address: string; symbol: string; baseUnits: string; pendingBaseUnits: string;
  decimals: number; observedAt: string; explorerUrl: string;
};

export function formatBalance(units: string, decimals: number): string {
  if (!/^-?[0-9]+$/.test(units) || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new Error("Invalid balance data.");
  const negative = units.startsWith("-");
  const digits = (negative ? units.slice(1) : units).padStart(decimals + 1, "0");
  const whole = decimals ? digits.slice(0, -decimals) : digits;
  const fraction = decimals ? digits.slice(-decimals).replace(/0+$/, "") : "";
  return (negative && BigInt(units) !== BigInt(0) ? "-" : "") + whole + (fraction ? "." + fraction : "");
}
