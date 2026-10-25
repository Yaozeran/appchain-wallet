export type MoonPayConfig = {
  available: boolean;
  environment: "sandbox" | "production";
  assetCode: string;
  assetName: string;
  networkLabel: string;
  fiatCurrencies: string[];
  message: string;
};

export function validateCheckoutUrl(value: unknown, address: string, environment: MoonPayConfig["environment"]): string {
  if (typeof value !== "string") throw new Error("The server returned an invalid checkout URL.");
  const url = new URL(value);
  const origin = environment === "sandbox" ? "https://buy-sandbox.moonpay.com" : "https://buy.moonpay.com";
  if (url.origin !== origin || url.username || url.password || url.pathname !== "/" || url.hash
      || url.searchParams.getAll("walletAddress").length !== 1
      || url.searchParams.get("walletAddress") !== address
      || url.searchParams.getAll("currencyCode").length !== 1
      || url.searchParams.get("currencyCode") !== "eth"
      || !url.searchParams.get("signature")) {
    throw new Error("Checkout does not match this wallet or network. Please try again.");
  }
  return url.href;
}
