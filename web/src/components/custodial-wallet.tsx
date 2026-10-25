"use client";

import Link from "next/link";
import WalletMode from "@/components/wallet-mode";
import PaymentPerformance from "@/components/payment-performance";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { activityLabel, ApiError, custodyApi, decimalUnits, formatUnits, purchasePreview, type CustodyAccount, type PendingPayment } from "@/lib/custody";

export default function CustodialWallet() {
  const [account, setAccount] = useState<CustodyAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [usd, setUsd] = useState("100.00");
  const [recipient, setRecipient] = useState("");
  const [eth, setEth] = useState("0.01");
  const [review, setReview] = useState(false);
  const [count, setCount] = useState(1);
  const [pending, setPending] = useState<PendingPayment | null>(null);
  const loadSequence = useRef(0);

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    try {
      const next = await custodyApi<CustodyAccount>("me");
      if (sequence !== loadSequence.current) return;
      setAccount(next);
      const stored = sessionStorage.getItem(`custody.pending.${next.address}`);
      setPending(stored ? JSON.parse(stored) : null);
    } catch (cause) {
      if (sequence !== loadSequence.current) return;
      if (cause instanceof ApiError && cause.status === 401) setAccount(null);
      else setError(cause instanceof Error ? cause.message : "Unable to load your account.");
    } finally { if (sequence === loadSequence.current) setLoading(false); }
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => { void load(); }, 0);
    return () => { clearTimeout(timer); };
  }, [load]);
  useEffect(() => {
    if (!account || busy) return;
    // Refresh incoming transfers without exposing database credentials to the browser.
    const timer = setInterval(() => { void load(); }, 15000);
    return () => clearInterval(timer);
  }, [account?.address, busy, load]); // eslint-disable-line react-hooks/exhaustive-deps

  async function authenticate(event?: FormEvent, demo = false) {
    event?.preventDefault(); setBusy(true); setError(""); setNotice("");
    ++loadSequence.current;
    try {
      const next = await custodyApi<CustodyAccount>(demo ? "demo" : registering ? "register" : "login", demo ? {} : { email, password });
      setAccount(next); setPassword("");
      const stored = sessionStorage.getItem(`custody.pending.${next.address}`);
      setPending(stored ? JSON.parse(stored) : null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Sign-in failed."); }
    finally { setBusy(false); }
  }
  async function logout() {
    ++loadSequence.current;
    setBusy(true); setError("");
    try { await custodyApi("logout", {}); setAccount(null); setPending(null); setNotice(""); setReview(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to sign out."); }
    finally { setBusy(false); }
  }
  async function submit(payment: PendingPayment) {
    if (!account || busy) return;
    ++loadSequence.current;
    setBusy(true); setError(""); setNotice("");
    const storageKey = `custody.pending.${account.address}`;
    try {
      // Persist the key before sending. A timeout/reload can retry the same operation safely.
      sessionStorage.setItem(storageKey, JSON.stringify(payment)); setPending(payment);
      const receipt = await custodyApi<{ id: string; status: string }>(payment.action, payment.body);
      sessionStorage.removeItem(storageKey); setPending(null); setReview(false);
      setNotice(`${payment.action === "traffic" ? "Test payment batch completed" : activityLabel(receipt.status)}. Reference: ${receipt.id}. No blockchain transaction was sent.`);
      await load();
    } catch (cause) {
      if (cause instanceof ApiError && [400, 403, 409].includes(cause.status)) {
        sessionStorage.removeItem(storageKey); setPending(null);
      }
      if (cause instanceof ApiError && cause.status === 401) setAccount(null);
      setError(cause instanceof Error ? cause.message : "Connection interrupted. Retry the pending operation with its original request key.");
    } finally { setBusy(false); }
  }
  function buy(event: FormEvent) {
    event.preventDefault();
    if (!account || pending) return;
    void submit({ action: "buy", body: { requestKey: crypto.randomUUID(), cardId: account.card.id, fiatAmount: usd } });
  }
  function reviewPayment(event: FormEvent) {
    event.preventDefault(); setError("");
    if (!/^0x[0-9a-fA-F]{40}$/.test(recipient.trim()) || /^0x0{40}$/.test(recipient.trim())) { setError("Enter a nonzero Ethereum address."); return; }
    if (recipient.trim().toLowerCase() === account?.address) { setError("Choose another account's address."); return; }
    const amount = decimalUnits(eth,18);
    if (amount === null || amount <= BigInt(0)) { setError("Enter a positive ETH amount with up to 18 decimal places."); return; }
    if (!Number.isInteger(count) || count < 1 || count > 200) { setError("Choose 1–200 payments."); return; }
    if (amount * BigInt(count) > BigInt(account?.cryptoWei || "0")) { setError("Insufficient demo ETH for the full payment run."); return; }
    setReview(true);
  }
  async function copyAddress() {
    try { await navigator.clipboard.writeText(account!.address); setNotice("Demo receiving address copied."); }
    catch { setError("Could not copy. Select the receiving address and copy it manually."); }
  }
  const preview = account ? purchasePreview(usd, account.usdPerEth) : null;

  return <div className="wallet-shell custody-shell">
    <header className="brand"><span className="brand-symbol" aria-hidden="true">W</span> wallet
      <nav className="custody-nav"><Link href="/self-custody">On-chain wallet</Link><WalletMode /></nav>
    </header>
    <div className="demo-banner"><strong>Simulation only.</strong> Fake USD and demo ETH have no monetary value. Payments here do not move funds on Ethereum.</div>
    {loading ? <main className="onboarding"><p role="status">Connecting to your wallet…</p></main> : !account ?
      <main className="onboarding"><section className="card" aria-busy={busy}>
        <div className="card-top"><span className="eyebrow">CUSTODIAL WALLET</span><span className="step-label">POSTGRESQL DEMO</span></div>
        <h1 className="auth-title">A wallet for everyday payments.</h1>
        <p className="muted">Try a fake card with $1,000, convert USD to demo ETH, and send a payment. Your account and balances are saved on the server.</p>
        <button className="primary" disabled={busy} onClick={() => void authenticate(undefined,true)}>Try the demo account <span>→</span></button>
        <p className="field-help">The demo account is shared. Create your own test account for a separate balance.</p>
        <div className="auth-divider">{registering ? "Create your test account" : "Sign in to your test account"}</div>
        <form onSubmit={event => void authenticate(event)}>
          <label htmlFor="custody-email">Email</label><input id="custody-email" type="email" autoComplete="username" maxLength={254} placeholder="you@wallet.test" value={email} onChange={e => setEmail(e.target.value)} required disabled={busy} />
          <label htmlFor="custody-password">Password</label><input id="custody-password" type="password" autoComplete={registering ? "new-password" : "current-password"} minLength={registering ? 12 : undefined} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} required disabled={busy} />
          {registering && <p className="field-help">Use 12–128 characters and test details only. No real card information is needed.</p>}
          <button className="primary" type="submit" disabled={busy}>{busy ? "Please wait…" : registering ? "Create test account" : "Sign in"}<span>→</span></button>
        </form>
        <button className="secondary" disabled={busy} onClick={() => { setRegistering(!registering); setError(""); }}>{registering ? "Already registered? Sign in" : "Create a separate test account"}</button>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="card-footer">No external payment provider. No real bank or card charges.</div>
      </section></main> :
      <main className="custody-dashboard" aria-busy={busy}>
        <div className="dashboard-heading"><div><span className="eyebrow">YOUR DEMO ACCOUNT</span><h1>Ready when you are.</h1><p className="muted">{account.email}</p></div><button className="secondary compact" disabled={busy} onClick={() => void logout()}>Sign out</button></div>
        <div className="custody-balances">
          <section className="card balance-tile"><span className="eyebrow">DEMO CRYPTO BALANCE</span><p className="tile-value">{formatUnits(account.cryptoWei,18)} <span>ETH</span></p><span className="field-help">Held in the platform&apos;s simulated ledger</span></section>
          <section className="card balance-tile"><span className="eyebrow">FAKE CARD BALANCE</span><p className="tile-value">${formatUnits(account.card.fiatCents,2)} <span>USD</span></p><span className="field-help">Issued with $1,000 once per account</span></section>
          <section className="card balance-tile"><span className="eyebrow">FIXED DEMO RATE</span><p className="tile-value">${account.usdPerEth}</p><span className="field-help">Per 1 ETH · no fees · no live price feed</span></section>
        </div>
        <section className="receiving-address"><div><span className="eyebrow">DEMO RECEIVING ADDRESS</span><p>{account.address}</p><span className="field-help">Share with another test account to receive an internal transfer. Do not send real crypto here.</span></div><button className="secondary compact" onClick={() => void copyAddress()}>Copy address</button></section>
        {notice && <p className="copy-status" role="status">{notice}</p>}
        {error && <p className="error" role="alert">{error}</p>}
        {pending && <section className="notice" role="status"><strong>A payment is awaiting confirmation.</strong><p>Retry this {pending.action === "buy" ? "purchase" : "payment"} with its original request key. The server will apply it at most once.</p><button className="secondary" disabled={busy} onClick={() => void submit(pending)}>Retry pending operation</button></section>}
        <div className="custody-actions">
          <section className="card"><div className="buy-heading"><div><span className="eyebrow">01 · CONVERT</span><h2>Buy demo ETH</h2></div><span className="chain-badge testnet">Simulated</span></div>
            <div className="fake-card"><div><strong>{account.card.label}</strong><span>FAKE CARD</span></div><p>•••• •••• •••• {account.card.lastFour}</p><small>Expires {account.card.expires} · No real payment network</small></div>
            <form onSubmit={buy}>
              <label htmlFor="buy-usd">Spend fake USD</label><input id="buy-usd" inputMode="decimal" value={usd} onChange={e => setUsd(e.target.value)} required disabled={busy || !!pending} />
              <p className="conversion-preview">You receive <strong>{preview ?? "—"} demo ETH</strong></p>
              <button className="primary" type="submit" disabled={busy || !!pending || !preview}>Buy demo ETH <span>→</span></button>
            </form><p className="field-help">Debits your fake card and credits your custodial demo balance.</p>
          </section>
          <section className="card"><div className="buy-heading"><div><span className="eyebrow">02 · PAY</span><h2>Send demo ETH</h2></div><span className="chain-badge testnet">Simulated</span></div>
            <p className="muted">Another demo account receives a ledger credit. Any other Ethereum address gets a simulated external payment record.</p>
            {review ? <div className="payment-review"><h3>Review demo payment</h3><dl className="account-details"><dt>Recipient</dt><dd>{recipient.trim()}</dd><dt>Amount per payment</dt><dd>{eth} demo ETH</dd><dt>Payments</dt><dd>{count}</dd><dt>Total</dt><dd>{formatUnits(((decimalUnits(eth,18) || BigInt(0)) * BigInt(count)).toString(),18)} demo ETH</dd></dl><p className="notice">This updates the demo ledger only. It cannot deliver ETH to a real address on-chain. Repeated payments commit together; a failure rolls back the whole run.</p>
              <button className="primary" disabled={busy || !!pending} onClick={() => void submit({ action: count > 1 ? "traffic" : "send", body: { requestKey: crypto.randomUUID(), recipientAddress: recipient.trim(), ethAmount: eth, ...(count > 1 ? {count} : {}) } })}>Confirm demo payment <span>→</span></button>
              <button className="secondary" disabled={busy || !!pending} onClick={() => setReview(false)}>Edit payment</button>
            </div> : <form onSubmit={reviewPayment}>
              <label htmlFor="send-address">Recipient Ethereum address</label><input id="send-address" placeholder="0x…" autoComplete="off" spellCheck={false} value={recipient} onChange={e => setRecipient(e.target.value)} required disabled={busy || !!pending} />
              <label htmlFor="send-eth">Amount in demo ETH</label><input id="send-eth" inputMode="decimal" value={eth} onChange={e => setEth(e.target.value)} required disabled={busy || !!pending} />
              <label htmlFor="send-count">Number of payments · merchant traffic test</label><input id="send-count" type="number" min={1} max={200} step={1} value={count} onChange={e => setCount(Number(e.target.value))} disabled={busy || !!pending} required />
              <button className="primary" type="submit" disabled={busy || !!pending}>Review payment <span>→</span></button>
            </form>}
          </section>
        </div>
        <PaymentPerformance revision={`${account.address}:${account.activity[0]?.id || ""}`} />
        <section className="card activity-panel"><div className="buy-heading"><div><span className="eyebrow">ACTIVITY</span><h2>Your latest transactions</h2></div><button className="secondary compact" disabled={busy} onClick={() => void load()}>Refresh</button></div>
          <p className="field-help">Latest 50 entries. References identify database records, not blockchain transaction hashes.</p>
          <ul className="activity-list">{account.activity.map(item => <li key={item.id}>
            <div className="activity-icon" aria-hidden="true">{item.kind === "SEND" ? "↗" : item.kind === "RECEIVE" ? "↙" : item.kind === "BUY" ? "⇄" : "+"}</div>
            <div className="activity-info"><strong>{activityLabel(item.status)}{item.kind === "RECEIVE" ? " · received" : ""}</strong><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time>
              {(item.recipientAddress || item.kind === "RECEIVE") && <p>{item.kind === "RECEIVE" ? `From ${item.senderAddress}` : `To ${item.recipientAddress}`}</p>}
              <details><summary>Reference</summary><code>{item.id}</code></details></div>
            <div className="activity-amount">{item.kind === "FUND" ? `+$${formatUnits(item.fiatCents,2)} USD` : `${item.kind === "SEND" ? "−" : "+"}${formatUnits(item.cryptoWei,18)} ETH`}{item.kind === "BUY" && <small>−${formatUnits(item.fiatCents,2)} USD</small>}</div>
          </li>)}</ul>
        </section>
      </main>}
    <footer className="page-footer">Custodial wallet prototype<span>PostgreSQL ledger · Fake cards · No real money</span></footer>
  </div>;
}
