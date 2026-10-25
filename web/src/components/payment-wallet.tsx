"use client";

import Link from "next/link";
import { isAddress } from "ethers";
import { useEffect, useState, type FormEvent } from "react";
import WalletMode from "@/components/wallet-mode";
import { ApiError, custodyApi, decimalUnits, formatUnits, purchasePreview } from "@/lib/custody";
import { bindSigner, createWallet, importLegacySigner, loadSigner, saveSigner, signPayments, vaultKey, walletFromPhrase, type History, type PaymentAccount, type Pending, type Run, type Signer } from "@/lib/payment-wallet";

export default function PaymentWallet() {
  const [account,setAccount]=useState<PaymentAccount|null>(null);
  const [signer,setSigner]=useState<Signer|null>(null);
  const [draft,setDraft]=useState<ReturnType<typeof createWallet>|null>(null);
  const [backup,setBackup]=useState(-1);
  const [words,setWords]=useState<Record<number,string>>({});
  const [email,setEmail]=useState("");const [password,setPassword]=useState("");
  const [registering,setRegistering]=useState(false);const [registerDraft,setRegisterDraft]=useState(false);
  const [restoring,setRestoring]=useState(false);const [phrase,setPhrase]=useState("");
  const [loading,setLoading]=useState(true);const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");const [notice,setNotice]=useState("");
  const [usd,setUsd]=useState("100.00");const [recipient,setRecipient]=useState("");const [amount,setAmount]=useState("0.0001");
  const [count,setCount]=useState(1);const [capacity,setCapacity]=useState(20);const [review,setReview]=useState(false);
  const [pending,setPending]=useState<Pending|null>(null);const [history,setHistory]=useState<History|null>(null);
  const [hasVault,setHasVault]=useState(false);
  const [legacyVault,setLegacyVault]=useState(false);

  async function refresh() {
    const current=await custodyApi<PaymentAccount>("wallet/me");setAccount(current);
    setHasVault(!!localStorage.getItem(vaultKey(current.email)));setLegacyVault(!!localStorage.getItem("wallet.vault.v1"));
    if(current.linked){setHistory(await custodyApi<History>("wallet/history"));const stored=sessionStorage.getItem(`payment.pending:${current.address}`);setPending(stored?JSON.parse(stored):null);}
    return current;
  }
  useEffect(()=>{let active=true;custodyApi<PaymentAccount>("wallet/me").then(current=>{if(active){setAccount(current);setHasVault(!!localStorage.getItem(vaultKey(current.email)));setLegacyVault(!!localStorage.getItem("wallet.vault.v1"));if(current.linked){const stored=sessionStorage.getItem(`payment.pending:${current.address}`);setPending(stored?JSON.parse(stored):null);return custodyApi<History>("wallet/history").then(data=>{if(active)setHistory(data);});}}}).catch(cause=>{if(active && !(cause instanceof ApiError && cause.status===401))setError(cause.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[]);

  async function authenticate(event:FormEvent) {
    event.preventDefault();setError("");setNotice("");
    if(registering){
      try {
        if(localStorage.getItem(vaultKey(email))){
          setBusy(true);
          const wallet=await loadSigner(email,password);
          try{await custodyApi("register",{email,password});}catch(cause){if(cause instanceof ApiError && cause.status===409)await custodyApi("login",{email,password});else throw cause;}
          const current=await custodyApi<PaymentAccount>("wallet/me");
          if(current.linked&&current.address.toLowerCase()!==wallet.address.toLowerCase())throw new Error("Restore the original phrase linked to this email in a fresh browser profile.");
          setAccount(current.linked?current:await bindSigner(wallet));setSigner(wallet);setPassword("");await refresh();
        }else{setDraft(createWallet());setRegisterDraft(true);setBackup(0);setWords({});}
      }catch(cause){setError((cause as Error).message);}finally{setBusy(false);}return;
    }
    setBusy(true);
    try {await custodyApi("login",{email,password});const current=await refresh();if(localStorage.getItem(vaultKey(current.email))){const wallet=await loadSigner(current.email,password,current.linked?current.address:undefined);setSigner(wallet);if(!current.linked)setAccount(await bindSigner(wallet));setPassword("");}else {setPassword("");setNotice("Sign-in complete. Restore your linked phrase, or create a wallet if this account has none.");}}
    catch(cause){setError((cause as Error).message);}finally{setBusy(false);}
  }
  async function finishBackup() {
    if(!draft)return;setBusy(true);setError("");
    try {
      const targetEmail=account?.email||email;
      await saveSigner(targetEmail,draft,password,account?.linked?account.address:undefined);
      if(registerDraft){
        try{await custodyApi("register",{email,password});}
        catch(cause){if(cause instanceof ApiError && cause.status===409)await custodyApi("login",{email,password});else throw cause;}
      }
      const current=await custodyApi<PaymentAccount>("wallet/me");
      if(current.linked && current.address.toLowerCase()!==draft.address.toLowerCase())throw new Error("This email already has another wallet. Restore its original phrase; your new vault has been kept on this device.");
      setAccount(current.linked?current:await bindSigner(draft));setSigner(draft);setDraft(null);setBackup(-1);setWords({});setPassword("");setRegisterDraft(false);await refresh();
    }catch(cause){setError((cause as Error).message);setNotice("If signup or linking was interrupted, your encrypted wallet remains saved. Cancel, sign in and unlock it to resume.");}
    finally{setBusy(false);}
  }
  function checkWords(event:FormEvent) {
    event.preventDefault();const recovery=draft?.mnemonic?.phrase.split(" ");
    if(!recovery||!recovery.every((word,index)=>index%2!==backup-1||words[index]?.trim().toLowerCase()===word)){setError("Some missing words are incorrect.");return;}
    setError("");setWords({});setBackup(backup+1);
  }
  async function unlockOrRestore(event:FormEvent) {
    event.preventDefault();if(!account)return;setBusy(true);setError("");
    try {
      let wallet:Signer;
      if(restoring){wallet=walletFromPhrase(phrase);await saveSigner(account.email,wallet,password,account.linked?account.address:undefined);}
      else wallet=await loadSigner(account.email,password,account.linked?account.address:undefined);
      if(!account.linked)setAccount(await bindSigner(wallet));
      setSigner(wallet);setPassword("");setPhrase("");setRestoring(false);await refresh();
    }catch(cause){setError((cause as Error).message);}finally{setBusy(false);}
  }
  async function importEarlierWallet() {
    if(!account)return;setBusy(true);setError("");
    try{const wallet=await importLegacySigner(account.email,password,account.linked?account.address:undefined);if(!account.linked)setAccount(await bindSigner(wallet));setSigner(wallet);setPassword("");await refresh();}
    catch(cause){setError((cause as Error).message);}finally{setBusy(false);}
  }
  async function logout() {setBusy(true);try{await custodyApi("logout",{});setSigner(null);setAccount(null);setHistory(null);setPassword("");setPhrase("");setDraft(null);setBackup(-1);setPending(null);setNotice("");setError("");}catch(cause){setError((cause as Error).message);}finally{setBusy(false);}}
  async function submit(operation:Pending) {
    if(!account)return;setBusy(true);setError("");setNotice("");
    const key=`payment.pending:${account.address}`;
    try {sessionStorage.setItem(key,JSON.stringify(operation));setPending(operation);
      const result=await custodyApi<Run|{id:string}>(`wallet/${operation.action}`,operation.body);
      sessionStorage.removeItem(key);setPending(null);setReview(false);
      setNotice(operation.action==="buy"?"Fake card converted directly to your wallet&apos;s test balance. No platform deposit or chain interaction.":`Signed payment included in the offline rollup model. Reference: ${result.id}. Nothing was submitted on-chain.`);
      await refresh();
    }catch(cause){if(cause instanceof ApiError && [400,403,409].includes(cause.status)){sessionStorage.removeItem(key);setPending(null);}setError((cause as Error).message);}finally{setBusy(false);}
  }
  const value=decimalUnits(amount,18);
  const fee=account?BigInt(account.gasLimit)*BigInt(account.gasPriceWei):BigInt(0);
  const validCount=Number.isInteger(count)&&count>=1&&count<=200;
  const total=value!==null&&validCount?(value+fee)*BigInt(count):null;
  function reviewPayment(event:FormEvent){event.preventDefault();setError("");if(!isAddress(recipient)||/^0x0{40}$/i.test(recipient)||recipient.toLowerCase()===account?.address){setError("Enter another wallet's valid, nonzero address.");return;}if(value===null||value<=BigInt(0)||!validCount||total===null){setError("Enter a positive amount and 1–200 payments.");return;}if(total>BigInt(account?.cryptoWei||"0")){setError("Insufficient wallet test ETH, including fees.");return;}setReview(true);}
  async function confirmPayment(){if(!signer||value===null)return;setBusy(true);setError("");try{const current=await custodyApi<PaymentAccount>("wallet/me");const rawTransactions=await signPayments(signer,current,recipient,value,count);await submit({action:"send",body:{requestKey:crypto.randomUUID(),rawTransactions,blockCapacity:capacity}});}catch(cause){setError((cause as Error).message);}finally{setBusy(false);}}

  const backupWords=draft?.mnemonic?.phrase.split(" ")||[];
  return <div className="wallet-shell custody-shell">
    <header className="brand"><span className="brand-symbol">W</span> wallet<nav className="custody-nav"><Link href="/">Payments</Link><Link href="/performance">Performance</Link><WalletMode /></nav></header>
    <div className="demo-banner"><strong>Test mode · offline rollup.</strong> Fake funds, signed wallet payments, simulated blocks and receipts. No L1 or L2 interaction.</div>
    {loading?<main className="onboarding"><p role="status">Loading your wallet…</p></main>:draft&&backup>=0?<main className="onboarding"><section className="card">
      <h1>{backup===0?"Save your recovery phrase.":backup<3?"Fill in the missing words.":"Secure your wallet."}</h1>
      <p className="muted">This randomly generated phrase controls your wallet. It is associated with your email, never derived from it. Keep a private backup.</p>
      {backup===0?<><ol className="phrase-grid">{backupWords.map((word,index)=><li key={index}><span>{index+1}</span>{word}</li>)}</ol><button className="primary" onClick={()=>{setBackup(1);setError("");}}>I saved my recovery phrase</button></>:backup<3?<form onSubmit={checkWords}><p>Round {backup} of 2</p><ol className="phrase-grid verification-grid">{backupWords.map((word,index)=><li key={index}><span>{index+1}</span>{index%2===backup-1?<input aria-label={`Recovery word ${index+1}`} autoComplete="off" spellCheck={false} value={words[index]||""} onChange={event=>setWords({...words,[index]:event.target.value})} required/>:word}</li>)}</ol><button className="primary">{backup===1?"Continue to round 2":"Confirm recovery phrase"}</button></form>:<form onSubmit={event=>{event.preventDefault();void finishBackup();}}><label htmlFor="backup-password">{registerDraft?"Account and device password":"Device password"}</label><input id="backup-password" type="password" minLength={12} maxLength={128} autoComplete="new-password" value={password} onChange={event=>setPassword(event.target.value)} required/><p className="field-help">The encrypted wallet stays on this browser. The server receives only your address and signatures.</p><button className="primary" disabled={busy}>{busy?"Saving…":"Finish creating wallet"}</button></form>}
      <button className="secondary" disabled={busy} onClick={()=>{setDraft(null);setBackup(-1);setWords({});setRegisterDraft(false);setError("");}}>Cancel</button>
      {error&&<p className="error" role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
    </section></main>:!account?<main className="onboarding"><section className="card"><span className="eyebrow">YOUR EMAIL · YOUR WALLET</span><h1>A wallet for everyday payments.</h1><p className="muted">Create an email account and a recovery-phrase wallet. Try a fake $1,000 card, pay any wallet address and inspect rollup test results.</p><form onSubmit={event=>void authenticate(event)}><label htmlFor="account-email">Email</label><input id="account-email" type="email" autoComplete="username" maxLength={254} value={email} onChange={event=>setEmail(event.target.value)} required/><label htmlFor="account-password">Password</label><input id="account-password" type="password" autoComplete={registering?"new-password":"current-password"} minLength={registering?12:undefined} maxLength={128} value={password} onChange={event=>setPassword(event.target.value)} required/><button className="primary" disabled={busy}>{busy?"Please wait…":registering?"Create account and wallet":"Sign in"}</button></form><button className="secondary" disabled={busy} onClick={()=>{setRegistering(!registering);setError("");}}>{registering?"Already registered? Sign in":"Create a test account"}</button><button className="secondary" onClick={()=>{setRegistering(true);setEmail(`test-${crypto.randomUUID().slice(0,8)}@wallet.test`);setPassword(crypto.randomUUID()+"!Test");setNotice("Fake credentials filled in. Save the email and password before continuing.");}}>Use fake account details</button>{error&&<p className="error" role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}</section></main>:!signer?<main className="onboarding"><section className="card"><h1>{account.linked?"Unlock your wallet.":"Connect your wallet to this account."}</h1><p className="muted">{account.email}</p><p className="field-help">Email signs you into the application. Your device password or recovery phrase unlocks payment signing.</p><form onSubmit={event=>void unlockOrRestore(event)}>{restoring&&<><label htmlFor="restore-phrase">Recovery phrase</label><textarea id="restore-phrase" autoComplete="off" spellCheck={false} value={phrase} onChange={event=>setPhrase(event.target.value)} required/></>}<label htmlFor="device-password">Device password</label><input id="device-password" type="password" minLength={12} autoComplete="current-password" value={password} onChange={event=>setPassword(event.target.value)} required/><button className="primary" disabled={busy||(!hasVault&&!restoring)}>{busy?"Unlocking…":restoring?"Restore and unlock":"Unlock wallet"}</button></form>{!hasVault&&<button className="secondary" onClick={()=>{setRestoring(!restoring);setError("");}}>{restoring?"Cancel restore":"Restore recovery phrase"}</button>}{!account.linked&&!hasVault&&<button className="secondary" onClick={()=>{setDraft(createWallet());setRegisterDraft(false);setBackup(0);setWords({});setError("");}}>Generate my recovery phrase</button>}{legacyVault&&!hasVault&&<button className="secondary" disabled={busy||password.length<12} onClick={()=>void importEarlierWallet()}>Use my earlier browser wallet</button>}<button className="secondary" disabled={busy} onClick={()=>void logout()}>Sign out</button>{error&&<p className="error" role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}</section></main>:<main className="custody-dashboard" aria-busy={busy}>
      <div className="dashboard-heading"><div><span className="eyebrow">YOUR PAYMENT WALLET</span><h1>Ready when you are.</h1><p>{account.email}</p></div><div><button className="secondary compact" disabled={busy} onClick={()=>{setSigner(null);setPassword("");setHasVault(true);}}>Lock wallet</button><button className="secondary compact" disabled={busy} onClick={()=>void logout()}>Sign out</button></div></div>
      <div className="custody-balances"><section className="card balance-tile"><span className="eyebrow">WALLET TEST BALANCE</span><p className="tile-value">{formatUnits(account.cryptoWei,18)} ETH</p><p className="field-help">At your phrase-derived address in the offline test state. No platform deposit.</p></section><section className="card balance-tile"><span className="eyebrow">FAKE CARD</span><p className="tile-value">${formatUnits(account.card.fiatCents,2)} USD</p><p className="field-help">•••• {account.card.lastFour} · fake funds only</p></section><section className="card balance-tile"><span className="eyebrow">PAYMENT FEE MODEL</span><p>{formatUnits(fee.toString(),18)} ETH / payment</p><p className="field-help">21,000 gas · 0.001 gwei · no L1 data fee in test mode</p></section></div>
      <section className="receiving-address"><div><span className="eyebrow">YOUR WALLET ADDRESS</span><p>{account.address}</p><p className="field-help">Controlled by your recovery phrase. Test balance is separate from every live network.</p></div><button className="secondary compact" onClick={()=>{void navigator.clipboard.writeText(account.address).then(()=>setNotice("Address copied.")).catch(()=>setError("Select and copy the address manually."));}}>Copy address</button></section>
      {error&&<p className="error" role="alert">{error}</p>}{notice&&<p className="copy-status" role="status">{notice}</p>}
      {pending&&<section className="notice"><strong>Pending request</strong><p>Retry the exact saved operation; it will not be applied twice.</p><button className="secondary" disabled={busy} onClick={()=>void submit(pending)}>Retry pending operation</button></section>}
      <div className="custody-actions"><section className="card"><h2>Buy test ETH</h2><p className="muted">Convert fake USD directly into your wallet&apos;s test balance at $2,500 / ETH.</p><form onSubmit={event=>{event.preventDefault();void submit({action:"buy",body:{requestKey:crypto.randomUUID(),cardId:account.card.id,fiatAmount:usd}});}}><label htmlFor="buy-usd">Spend fake USD</label><input id="buy-usd" inputMode="decimal" value={usd} onChange={event=>setUsd(event.target.value)} required/><p>You receive {purchasePreview(usd,account.usdPerEth)||"—"} test ETH</p><button className="primary" disabled={busy||!!pending}>Buy test ETH</button></form></section>
      <section className="card"><h2>Send payment</h2><p className="muted">Sign with your own wallet. Use one payment or repeated merchant traffic.</p>{review?<div className="payment-review"><h3>Review payment</h3><dl className="account-details"><dt>Recipient</dt><dd>{recipient}</dd><dt>Payments</dt><dd>{count} × {amount} ETH</dd><dt>Total including fees</dt><dd>{total===null?"—":formatUnits(total.toString(),18)} ETH</dd><dt>Block capacity</dt><dd>{capacity} payments</dd></dl><p className="notice">Offline test execution only. Your private key stays in this browser. Nothing is sent to a public chain.</p><button className="primary" disabled={busy||!!pending} onClick={()=>void confirmPayment()}>{busy?"Signing and processing…":"Sign and confirm payment"}</button><button className="secondary" disabled={busy} onClick={()=>setReview(false)}>Edit payment</button></div>:<form onSubmit={reviewPayment}><label htmlFor="send-address">Recipient wallet address</label><input id="send-address" value={recipient} onChange={event=>setRecipient(event.target.value)} required/><label htmlFor="send-eth">ETH per payment</label><input id="send-eth" inputMode="decimal" value={amount} onChange={event=>setAmount(event.target.value)} required/><label htmlFor="send-count">Number of payments</label><input id="send-count" type="number" min={1} max={200} step={1} value={count} onChange={event=>setCount(Number(event.target.value))} required/><label htmlFor="block-capacity">Payments per simulated block</label><input id="block-capacity" type="number" min={1} max={100} step={1} value={capacity} onChange={event=>setCapacity(Number(event.target.value))} required/><button className="primary" disabled={busy||!!pending}>Review payment</button></form>}</section></div>
      <section className="card"><div className="buy-heading"><h2>Payment activity</h2><button className="secondary compact" disabled={busy} onClick={()=>{void refresh().catch(cause=>setError(cause.message));}}>Refresh</button></div><p className="field-help">Signed transaction hashes and receipts below belong to the offline model. They have no public block explorer entry.</p>{history?.purchases.map(purchase=><p key={purchase.id}>Fake card conversion · +{formatUnits(purchase.wei,18)} ETH</p>)}{history?.receipts.map(receipt=><details key={receipt.transactionHash}><summary>{receipt.from===account.address?"Sent":"Received"} {formatUnits(receipt.value,18)} ETH · simulated block #{receipt.blockNumber}</summary><code className="simulation-address">{receipt.transactionHash}</code><p>From {receipt.from}</p><p>To {receipt.to}</p><p>Nonce {receipt.nonce} · fee {formatUnits(receipt.feeWei,18)} ETH · {receipt.status}</p></details>)}</section>
      <section className="card"><h2>Rollup test results</h2><p>{history?.runs.length||0} recent runs · sequence → native transfer model → blocks → singular batches → compressed channel → frames.</p><Link className="explorer-link" href="/performance">View TPS, latency, fees, blocks and batches →</Link></section>
    </main>}
    <footer className="page-footer">Your keys stay on your device<span>OP Stack payment prototype · Offline test mode</span></footer>
  </div>;
}
