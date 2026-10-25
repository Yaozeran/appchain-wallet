"use client";

import { useEffect, useState, type FormEvent } from "react";
import { validateTransakUrl, type TransakConfig } from "@/lib/transak";

export default function BuyCrypto({ address }: { address: string }) {
  const [config, setConfig] = useState<TransakConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [fiat, setFiat] = useState("GBP");
  const [amount, setAmount] = useState("50");
  const [asset, setAsset] = useState("USDC");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/transak/config", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("Transak server is unavailable. Start the backend and retry.");
        const data: TransakConfig = await response.json();
        if (!["staging", "production"].includes(data.environment) || !Array.isArray(data.assets) || !Array.isArray(data.fiatCurrencies)) throw new Error("Invalid checkout settings.");
        setConfig(data);
      })
      .catch(cause => { if (!controller.signal.aborted) { setConfig(null); setError(cause.message || "Unable to load checkout."); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [retry]);

  async function checkout(event: FormEvent) {
    event.preventDefault();
    if (!config?.available || busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/transak/checkout", {
        method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ walletAddress: address, fiatCurrency: fiat, fiatAmount: Number(amount), asset }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Unable to create Transak checkout.");
      window.location.assign(validateTransakUrl(data.url, config.environment));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to reach checkout. Retry to create a new session.");
      setBusy(false);
    }
  }

  return <section className="buy-crypto" aria-labelledby="buy-title" aria-busy={loading || busy}>
    <div className="buy-heading"><div><span className="eyebrow">ADD FUNDS</span><h3 id="buy-title">Buy crypto with Transak</h3></div><span className="provider-mark" aria-hidden="true">↗</span></div>
    <p className="muted">Buy on Ethereum with fiat. Your Ethereum address is prefilled and locked in checkout.</p>
    {loading && <p className="field-help" role="status">Loading purchase settings…</p>}
    {!loading && config && !config.available && <p className="notice" role="status">{config.message}</p>}
    {!loading && (!config || !config.available) && <button className="secondary" onClick={() => setRetry(value => value + 1)}>Retry Transak setup</button>}
    {config?.available && !expanded && <button className="primary" onClick={() => setExpanded(true)}>{config.environment === "staging" ? "Try a staging purchase" : "Buy crypto"}<span>→</span></button>}
    {config?.available && expanded && <form onSubmit={checkout}>
      <p className="notice">{config.networkLabel}. The balance selector above does not change this purchase network.</p>
      <label htmlFor="transak-address">Ethereum delivery address</label>
      <textarea id="transak-address" className="delivery-address" value={address} readOnly rows={2} onFocus={event => event.target.select()} />
      <label htmlFor="transak-asset">Asset to buy</label>
      <select id="transak-asset" value={asset} onChange={event => setAsset(event.target.value)} disabled={busy}>{config.assets.map(value => <option key={value}>{value}</option>)}</select>
      <div className="purchase-fields">
        <div><label htmlFor="transak-amount">You spend</label><input id="transak-amount" type="number" min="1" max="100000" step="0.01" value={amount} onChange={event => setAmount(event.target.value)} required disabled={busy} /></div>
        <div><label htmlFor="transak-fiat">Currency</label><select id="transak-fiat" value={fiat} onChange={event => setFiat(event.target.value)} disabled={busy}>{config.fiatCurrencies.map(value => <option key={value}>{value}</option>)}</select></div>
      </div>
      {config.environment === "staging" && <p className="notice">Staging uses test payments. USDC purchases deliver TRNSK test tokens on Sepolia, not USDC. Native ETH purchases are simulated and do not deliver Sepolia ETH. Select Sepolia → TRNSK above to check a test-token deposit.</p>}
      {config.environment === "production" && <p className="notice">This uses real money on Ethereum mainnet. It does not fund our custom OP Stack chain.</p>}
      <p className="field-help">Transak shows its final quote, fees, purchase limits, and identity checks before payment.</p>
      <button className="primary" type="submit" disabled={busy}>{busy ? "Creating checkout…" : "Continue to Transak"}<span>↗</span></button>
      <button className="secondary" type="button" disabled={busy} onClick={() => setExpanded(false)}>Close purchase details</button>
    </form>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
