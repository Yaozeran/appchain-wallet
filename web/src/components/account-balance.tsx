"use client";

import { useEffect, useState } from "react";
import { CHAINS, formatBalance, type Chain, type ChainBalance } from "@/lib/chains";
import type { PublicAccount } from "@/lib/wallet";

export default function AccountBalance({ account }: { account: PublicAccount }) {
  const [chain, setChain] = useState<Chain>("sepolia");
  const [asset, setAsset] = useState("native");
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<{ key: string; data?: ChainBalance; error?: string } | null>(null);
  const [copyStatus, setCopyStatus] = useState("");
  const address = chain === "btc" ? account.bitcoinAddress : account.address;
  const key = `${chain}:${asset}:${address}:${refresh}`;
  const current = result?.key === key ? result : null;
  const selected = CHAINS.find(value => value.id === chain)!;

  useEffect(() => {
    if (!address) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ chain, address, asset });
    fetch(`/api/balances?${query}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || "Balance unavailable.");
        if (data.chain !== chain || data.address !== address || typeof data.observedAt !== "string"
            || !Number.isFinite(Date.parse(data.observedAt)) || data.symbol !== (asset === "trnsk" ? "TRNSK" : selected.symbol)) throw new Error("Unexpected balance response.");
        formatBalance(data.baseUnits, data.decimals);
        formatBalance(data.pendingBaseUnits, data.decimals);
        if (!controller.signal.aborted) setResult({ key, data });
      })
      .catch(cause => { if (!controller.signal.aborted) setResult({ key, error: cause.message || "Balance unavailable." }); });
    return () => controller.abort();
  }, [chain, asset, address, key, selected.symbol]);

  useEffect(() => {
    const timer = setInterval(() => { if (document.visibilityState === "visible") setRefresh(value => value + 1); }, 30000);
    return () => clearInterval(timer);
  }, []);

  const explorer = chain === "btc" ? "https://mempool.space/address/" : chain === "sepolia" ? "https://sepolia.etherscan.io/address/" : chain === "optimism" ? "https://optimistic.etherscan.io/address/" : "https://etherscan.io/address/";
  return <section className="balance-panel" aria-labelledby="balance-title">
    <div className="balance-heading"><h3 id="balance-title">On-chain balance</h3><span className={`chain-badge ${selected.testnet ? "testnet" : ""}`}>{selected.testnet ? "Testnet" : "Mainnet"}</span></div>
    <label htmlFor="balance-chain">Network</label>
    <select id="balance-chain" value={chain} onChange={event => { setChain(event.target.value as Chain); setAsset("native"); setCopyStatus(""); }}>{CHAINS.map(value => <option key={value.id} value={value.id}>{value.label}</option>)}</select>
    {chain === "sepolia" && <><label htmlFor="balance-asset">Asset</label><select id="balance-asset" value={asset} onChange={event => setAsset(event.target.value)}><option value="native">ETH · native Sepolia gas token</option><option value="trnsk">TRNSK · Transak staging test token</option></select></>}
    {!address ? <p className="notice">Bitcoin requires the original recovery phrase. Restore your phrase to enable its BIP-84 receive address.</p> : <>
      <div className="balance-amount" aria-live="polite">
        {current?.data ? <><strong>{formatBalance(current.data.baseUnits, current.data.decimals)}</strong><span>{current.data.symbol}</span></> : current?.error ? <strong>Unavailable</strong> : <span>Reading balance…</span>}
      </div>
      {current?.error && <p className="error" role="alert">{current.error}</p>}
      {current?.data && <>
        {chain === "btc" && current.data.pendingBaseUnits !== "0" && <p className="field-help">Unconfirmed change: {formatBalance(current.data.pendingBaseUnits, 8)} BTC</p>}
        <p className="field-help">Updated {new Date(current.data.observedAt).toLocaleTimeString()} · refreshes every 30 seconds</p>
      </>}
      <label htmlFor="balance-address">{chain === "btc" ? "Bitcoin receive address · native SegWit" : "Ethereum-compatible receive address"}</label>
      <textarea id="balance-address" className="delivery-address" value={address} readOnly rows={2} onFocus={event => event.target.select()} />
      <div className="balance-actions">
        <button type="button" className="secondary" onClick={async () => {
          try { await navigator.clipboard.writeText(address); setCopyStatus("Address copied."); }
          catch { (document.getElementById("balance-address") as HTMLTextAreaElement)?.select(); setCopyStatus("Copy the selected address manually."); }
        }}>Copy address</button>
        <button type="button" className="secondary" onClick={() => setRefresh(value => value + 1)}>Refresh balance</button>
      </div>
      {copyStatus && <p role="status" className="field-help">{copyStatus}</p>}
      {chain !== "appchain" && <a className="explorer-link" href={explorer + address} target="_blank" rel="noopener noreferrer">View on block explorer ↗</a>}
      {chain === "appchain" && <p className="field-help">Our separate OP Stack development chain. Requires the optional Docker services; no explorer is configured.</p>}
      <p className="field-help">{chain === "btc" ? "Shows this wallet's first BIP-84 receive address only, not the total across every Bitcoin address." : "Balances are separate on each network. Switching networks does not move funds."}</p>
    </>}
  </section>;
}
