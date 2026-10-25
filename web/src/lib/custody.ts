export type Activity = {
  id: string; kind: "FUND" | "BUY" | "SEND" | "RECEIVE";
  status: string; fiatCents: string; cryptoWei: string;
  recipientAddress: string | null; senderAddress: string; createdAt: string;
};
export type CustodyAccount = {
  mode: "simulation"; email: string; address: string; cryptoWei: string;
  card: { id: string; label: string; lastFour: string; expires: string; fiatCents: string };
  usdPerEth: string; activity: Activity[];
};
export type PendingPayment = {
  action: "buy" | "send" | "traffic";
  body: { requestKey: string; cardId?: string; fiatAmount?: string; recipientAddress?: string; ethAmount?: string; count?: number };
};
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}
export async function custodyApi<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/custody/${path}`, {
    method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store",
    headers: body === undefined ? undefined : { "Content-Type": "application/json", "X-Wallet-Mode": "test" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(data?.message || "The wallet service is unavailable. Please retry.", response.status);
  return data as T;
}
export function decimalUnits(value: string, decimals: number): bigint | null {
  if (value.length > 60 || !new RegExp(`^[0-9]+(?:\\.[0-9]{1,${decimals}})?$`).test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole + fraction.padEnd(decimals, "0"));
}
export function formatUnits(value: string, decimals: number): string {
  const units = BigInt(value);
  const padded = units.toString().padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals);
  return decimals === 2 ? `${whole}.${fraction}` : `${whole}${fraction.replace(/0+$/, "") ? `.${fraction.replace(/0+$/, "")}` : ""}`;
}
export function purchasePreview(usd: string, usdPerEth: string): string | null {
  const cents = decimalUnits(usd, 2), price = decimalUnits(usdPerEth, 2);
  if (cents === null || price === null || cents <= BigInt(0) || price <= BigInt(0)) return null;
  return formatUnits((cents * BigInt("1000000000000000000") / price).toString(), 18);
}
export function activityLabel(status: string): string {
  return ({ DEMO_FUNDED: "Demo funds issued", DEMO_CONVERTED: "Demo conversion complete",
    INTERNAL_COMPLETED: "Internal transfer complete", EXTERNAL_SIMULATED: "External payment simulated" })[status] || "Demo activity";
}
