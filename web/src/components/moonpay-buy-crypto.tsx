"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { validateCheckoutUrl, type MoonPayConfig } from "@/lib/moonpay";

export default function MoonPayBuyCrypto({ address }: { address: string }) {
  const [expanded, setExpanded] = useState(false);
  const [config, setConfig] = useState<MoonPayConfig | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [retry, setRetry] = useState(0);
  const [fiatCurrency, setFiatCurrency] = useState("usd");
  const [fiatAmount, setFiatAmount] = useState("50");
  const [busy, setBusy] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const [error, setError] = useState("");
  const addressField = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function loadConfig() {
      setLoadingConfig(true);
      setError("");
      try {
        const response = await fetch("/api/moonpay/config", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("MoonPay server is unavailable. Start the wallet backend and try again.");
        const data: MoonPayConfig = await response.json();
        if (!Array.isArray(data.fiatCurrencies) || !["sandbox", "production"].includes(data.environment)) {
          throw new Error("Unable to load MoonPay checkout settings. Try again.");
        }
        setConfig(data);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setConfig(null);
          setError(cause instanceof Error ? cause.message : "Unable to load MoonPay checkout.");
        }
      } finally {
        if (!controller.signal.aborted) setLoadingConfig(false);
      }
    }
    void loadConfig();
    return () => controller.abort();
  }, [retry]);

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(address);
      setCopyStatus("Address copied.");
    } catch {
      addressField.current?.focus();
      addressField.current?.select();
      setCopyStatus("Copy the selected address manually.");
    }
  }

  async function startCheckout(event: FormEvent) {
    event.preventDefault();
    if (!config?.available || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/moonpay/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ walletAddress: address, fiatCurrency, fiatAmount: Number(fiatAmount) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.message === "string" ? data.message : "Unable to prepare MoonPay checkout.");
      const url = validateCheckoutUrl(data.url, address, config.environment);
      // Same-tab navigation avoids popup blockers after the asynchronous signing request.
      // Returning here never counts as payment success: MoonPay owns order status.
      window.location.assign(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to prepare checkout. Check the server and try again.");
      setBusy(false);
    }
  }

  return (
    <section className="buy-crypto" aria-labelledby="buy-crypto-title" aria-busy={busy || loadingConfig}>
      <div className="buy-heading">
        <div>
          <span className="eyebrow">ADD FUNDS</span>
          <h3 id="buy-crypto-title">Buy crypto with MoonPay</h3>
        </div>
        <span className="provider-mark" aria-hidden="true">◕</span>
      </div>
      <p className="muted">Pay with fiat in MoonPay checkout. Your wallet address is filled in automatically for delivery.</p>
      {loadingConfig && <p className="field-help" role="status">Loading checkout…</p>}
      {!loadingConfig && config && !config.available && <p className="notice" role="status">{config.message}</p>}
      {!loadingConfig && (!config || !config.available) && (
        <button type="button" className="secondary" onClick={() => setRetry(value => value + 1)}>Retry checkout setup</button>
      )}
      {config?.available && !expanded && (
        <button className="primary" onClick={() => setExpanded(true)} aria-expanded={false}>
          {config.environment === "sandbox" ? "Try a sandbox purchase" : "Buy ETH"} <span aria-hidden="true">→</span>
        </button>
      )}
      {config?.available && expanded && (
        <form onSubmit={startCheckout}>
          <dl className="purchase-network">
            <div><dt>You buy</dt><dd>{config.assetName}</dd></div>
            <div><dt>Delivery network</dt><dd>{config.networkLabel}</dd></div>
          </dl>
          <label htmlFor="delivery-address">Delivery address</label>
          <textarea ref={addressField} id="delivery-address" className="delivery-address" value={address}
            readOnly rows={2} spellCheck={false} onFocus={event => event.target.select()} />
          <button type="button" className="secondary" onClick={copyAddress}>Copy wallet address</button>
          {copyStatus && <p className="copy-status" role="status">{copyStatus}</p>}
          <div className="purchase-fields">
            <div>
              <label htmlFor="fiat-amount">You spend</label>
              <input id="fiat-amount" type="number" inputMode="numeric" min="1" max="100000" step="1"
                value={fiatAmount} onChange={event => setFiatAmount(event.target.value)} required disabled={busy} />
            </div>
            <div>
              <label htmlFor="fiat-currency">Currency</label>
              <select id="fiat-currency" value={fiatCurrency} onChange={event => setFiatCurrency(event.target.value)} disabled={busy}>
                {config.fiatCurrencies.map(currency => <option key={currency} value={currency}>{currency.toUpperCase()}</option>)}
              </select>
            </div>
          </div>
          <p className="field-help">MoonPay shows the final exchange rate, fees, available payment methods, and purchase limits before you pay.</p>
          <p className="notice">
            {config.environment === "sandbox"
              ? "Sandbox checkout: test purchases only. No real money or crypto is transferred."
              : "Live checkout uses real money and delivers ETH on Ethereum mainnet. It does not fund our OP Stack appchain."}
          </p>
          <button className="primary" type="submit" disabled={busy}>
            {busy ? "Preparing secure checkout…" : "Continue to MoonPay"} <span aria-hidden="true">↗</span>
          </button>
          <p className="field-help">You’ll continue on MoonPay to review your purchase and complete any identity checks. Your recovery phrase and private key stay here.</p>
          <button type="button" className="secondary" disabled={busy} onClick={() => setExpanded(false)}>Close purchase details</button>
        </form>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
