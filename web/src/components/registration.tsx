"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { HDNodeWallet } from "ethers";
import AccountBalance from "@/components/account-balance";
import { createWallet, DERIVATION_PATH, encryptWallet, normalizePhrase, VAULT_KEY, walletFromPhrase, unlockWallet, publicAccount, type PublicAccount } from "@/lib/wallet";

type Account = PublicAccount;
type Step = "loading" | "welcome" | "backup" | "verify" | "secure" | "unlock" | "account";

export default function Registration() {
  const [step, setStep] = useState<Step>("loading");
  const [wallet, setWallet] = useState<HDNodeWallet | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [phrase, setPhrase] = useState("");
  const [restoring, setRestoring] = useState(false);
  const [confirmation, setConfirmation] = useState<Record<number, string>>({});
  const [verificationRound, setVerificationRound] = useState(0);
  const [password, setPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    try {
      // Read browser-only storage after hydration; the server cannot determine this step.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStep(localStorage.getItem(VAULT_KEY) ? "unlock" : "welcome");
    } catch {
      setError("Browser storage is unavailable. Enable local storage to save your encrypted wallet.");
      setStep("welcome");
    }
  }, []);

  function reset() {
    setWallet(null); setPhrase(""); setPassword(""); setRepeatPassword("");
    setConfirmation({}); setVerificationRound(0); setRestoring(false); setError("");
  }

  function generate() {
    try {
      reset(); setWallet(createWallet()); setStep("backup");
    } catch {
      setError("Could not generate a secure wallet. Use a browser with secure random number support.");
    }
  }

  function restore(event: FormEvent) {
    event.preventDefault(); setError("");
    try {
      setWallet(walletFromPhrase(phrase)); setPhrase(""); setStep("secure");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Invalid recovery phrase.");
    }
  }

  function confirmBackup(event: FormEvent) {
    event.preventDefault(); setError("");
    const words = wallet?.mnemonic?.phrase.split(" ");
    if (!words || !words.every((word, index) =>
      index % 2 !== verificationRound || normalizePhrase(confirmation[index] ?? "") === word
    )) {
      setError("Some missing words are incorrect. Check your saved phrase and try again.");
      return;
    }
    setConfirmation({});
    if (verificationRound === 0) {
      setVerificationRound(1);
    } else {
      setStep("secure");
    }
  }

  async function register(event: FormEvent) {
    event.preventDefault(); setError("");
    if (!wallet) return;
    if (password !== repeatPassword) { setError("Passwords do not match."); return; }
    setBusy(true);
    try {
      const encrypted = await encryptWallet(wallet, password);
      // Avoid replacing a wallet created in another tab while this form was open.
      if (localStorage.getItem(VAULT_KEY)) throw new Error("A wallet already exists in this browser. Reload to unlock it.");
      localStorage.setItem(VAULT_KEY, encrypted);
      setAccount(publicAccount(wallet));
      reset(); setStep("account");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save wallet. Check browser storage and try again.");
    } finally { setBusy(false); }
  }

  async function unlock(event: FormEvent) {
    event.preventDefault(); setError(""); setBusy(true);
    try {
      const vault = localStorage.getItem(VAULT_KEY);
      if (!vault) { reset(); setStep("welcome"); return; }
      const unlocked = await unlockWallet(vault, password);
      setAccount(publicAccount(unlocked));
      reset(); setStep("account");
    } catch {
      setError("Unable to unlock. Check your password and try again. Restore a damaged wallet in a fresh browser profile using its recovery phrase.");
    } finally { setBusy(false); }
  }

  return (
    <div className="wallet-shell">
      <header className="brand"><span className="brand-symbol" aria-hidden="true">W</span> wallet <span className="network">Self-custody wallet</span></header>
      <main className="onboarding">
        <section className="card" aria-label="Wallet registration" aria-busy={busy}>
          <div className="card-top"><span className="eyebrow">GET STARTED</span><span className="step-label">{step === "backup" ? "01 / 03" : step === "verify" ? "02 / 03" : step === "secure" ? "03 / 03" : "SELF-CUSTODY"}</span></div>
          {step === "loading" && <p role="status">Checking this browser…</p>}
          {step === "welcome" && <>
            <h2>{restoring ? "Restore your wallet" : "Your account, without a sign-up."}</h2>
            <p className="muted">{restoring ? "Enter your existing English recovery phrase. It stays in this browser." : "A recovery phrase creates your wallet and gives you control of its keys."}</p>
            {restoring ? <form onSubmit={restore}>
              <label htmlFor="phrase">Recovery phrase</label>
              <textarea id="phrase" value={phrase} onChange={e => setPhrase(e.target.value)} autoComplete="off" spellCheck={false} autoCapitalize="none" rows={4} required />
              <button className="primary" type="submit">Restore wallet <span>→</span></button>
              <button className="secondary" type="button" onClick={reset}>Back</button>
            </form> : <>
              <div className="feature"><span>01</span><div><strong>Generate a recovery phrase</strong><p>A secure, randomly generated set of 12 words.</p></div></div>
              <div className="feature"><span>02</span><div><strong>Keep your keys private</strong><p>Encrypted on this device with your password.</p></div></div>
              <button className="primary" onClick={generate}>Create a new wallet <span>→</span></button>
              <button className="secondary" onClick={() => { setError(""); setRestoring(true); }}>I already have a recovery phrase</button>
            </>}
          </>}
          {step === "backup" && <>
            <h2>Save your recovery phrase.</h2>
            <p className="muted">Write these words down in order and keep them somewhere private. Anyone with this phrase can control your wallet.</p>
            <ol className="phrase-grid">{wallet?.mnemonic?.phrase.split(" ").map((word, i) => <li key={i}><span>{i + 1}</span>{word}</li>)}</ol>
            <p className="notice">We cannot recover this phrase for you. Never share it or enter it on an unfamiliar website.</p>
            <button className="primary" onClick={() => { setVerificationRound(0); setConfirmation({}); setError(""); setStep("verify"); }}>I saved my recovery phrase <span>→</span></button>
            <button className="secondary" onClick={() => { reset(); setStep("welcome"); }}>Cancel</button>
          </>}
          {step === "verify" && <>
            <h2>Fill in the missing words.</h2>
            <p className="muted" id="verification-help">
              Use your saved recovery phrase to complete the blank spaces. Complete both rounds to confirm all 12 words.
            </p>
            <div className="verification-progress" role="status">
              <span>Round {verificationRound + 1} of 2</span>
              <span>{verificationRound === 0 ? "First half" : "Final half"}</span>
            </div>
            <form key={verificationRound} onSubmit={confirmBackup} aria-describedby="verification-help">
              <ol className="phrase-grid verification-grid">
                {wallet?.mnemonic?.phrase.split(" ").map((word, index) => (
                  <li key={index} className={index % 2 === verificationRound ? "missing-word" : undefined}>
                    <span aria-hidden="true">{index + 1}</span>
                    {index % 2 === verificationRound ? (
                      <input
                        aria-label={`Recovery word ${index + 1}`}
                        value={confirmation[index] ?? ""}
                        onChange={event => {
                          setConfirmation(previous => ({ ...previous, [index]: event.target.value }));
                          setError("");
                        }}
                        autoComplete="off"
                        autoCapitalize="none"
                        spellCheck={false}
                        placeholder="Enter word"
                        required
                      />
                    ) : word}
                  </li>
                ))}
              </ol>
              <button className="primary" type="submit">
                {verificationRound === 0 ? "Continue to round 2" : "Confirm recovery phrase"}<span>→</span>
              </button>
              <button className="secondary" type="button" onClick={() => {
                setStep("backup"); setVerificationRound(0); setConfirmation({}); setError("");
              }}>View phrase again</button>
            </form>
          </>}
          {step === "secure" && <>
            <h2>Secure this device.</h2>
            <p className="muted">This password unlocks your wallet on this browser. Your recovery phrase restores it on another device.</p>
            <form onSubmit={register}>
              <label htmlFor="password">Device password</label>
              <input id="password" type="password" autoComplete="new-password" minLength={12} value={password} onChange={e => setPassword(e.target.value)} required disabled={busy} />
              <p className="field-help">Use at least 12 characters. This is separate from your recovery phrase.</p>
              <label htmlFor="repeat">Confirm password</label>
              <input id="repeat" type="password" autoComplete="new-password" minLength={12} value={repeatPassword} onChange={e => setRepeatPassword(e.target.value)} required disabled={busy} />
              <button className="primary" type="submit" disabled={busy}>{busy ? "Encrypting your wallet…" : "Create account"}<span>→</span></button>
              <button className="secondary" type="button" disabled={busy} onClick={() => { reset(); setStep("welcome"); }}>Cancel</button>
            </form>
          </>}
          {step === "unlock" && <>
            <h2>Welcome back.</h2><p className="muted">Unlock the encrypted wallet saved in this browser.</p>
            <form onSubmit={unlock}>
              <label htmlFor="unlock-password">Device password</label>
              <input id="unlock-password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required disabled={busy} />
              <button className="primary" disabled={busy} type="submit">{busy ? "Unlocking…" : "Unlock wallet"}<span>→</span></button>
            </form>
            <p className="field-help">Forgot your password? Restore your recovery phrase in a fresh browser profile to set a new one.</p>
          </>}
          {step === "account" && account && <>
            <div className="success-icon" aria-hidden="true">✓</div><h2>Your wallet is ready.</h2>
            <p className="muted">Your account is saved and encrypted on this browser. Keep your recovery phrase safe.</p>
            <AccountBalance account={account} />
            <details className="key-details"><summary>Ethereum account details</summary><dl className="account-details"><dt>Account address</dt><dd>{account.address}</dd><dt>Public key</dt><dd>{account.publicKey}</dd><dt>Derivation path</dt><dd>{DERIVATION_PATH}</dd></dl></details>
            <p className="field-help">This view reads on-chain balances. The custodial demo uses a separate simulated balance and does not fund this wallet.</p>
            <button className="primary" onClick={() => { setAccount(null); reset(); setStep("unlock"); }}>Lock wallet <span>↗</span></button>
          </>}
          {error && <p className="error" role="alert">{error}</p>}
          <div className="card-footer">Keys stay on your device. No recovery phrase or private key is shared with purchase providers.</div>
        </section>
      </main>
      <footer className="page-footer">A payment wallet, built on your terms.<span>Development prototype · Use test accounts only</span></footer>
    </div>
  );
}
