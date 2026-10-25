export type TransakConfig = {
  available: boolean;
  environment: "staging" | "production";
  fiatCurrencies: string[];
  assets: string[];
  networkLabel: string;
  message: string;
};

export function validateTransakUrl(value: unknown, environment: TransakConfig["environment"]): string {
  if (typeof value !== "string") throw new Error("The server returned an invalid checkout URL.");
  const url = new URL(value);
  const origin = environment === "staging" ? "https://global-stg.transak.com" : "https://global.transak.com";
  if (url.origin !== origin || url.username || url.password || url.pathname !== "/" || url.hash
      || url.searchParams.getAll("sessionId").length !== 1 || !url.searchParams.get("sessionId")) {
    throw new Error("Unexpected Transak checkout URL. Please try again.");
  }
  return value; // Do not reorder or rewrite the provider's opaque, single-use URL.
}
