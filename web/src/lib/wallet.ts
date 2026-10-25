import { HDNodeWallet, Mnemonic, Wallet, getBytes, ripemd160, sha256 } from "ethers";
import { bech32 } from "@scure/base";

export const VAULT_KEY = "wallet.vault.v1";
export const DERIVATION_PATH = "m/44'/60'/0'/0/0";

export function normalizePhrase(phrase: string): string {
  return phrase.trim().toLowerCase().split(/\s+/u).join(" ");
}

export function walletFromPhrase(phrase: string): HDNodeWallet {
  const normalized = normalizePhrase(phrase);
  if (!Mnemonic.isValidMnemonic(normalized)) {
    throw new Error("Enter a valid English recovery phrase with 12, 15, 18, 21, or 24 words, in the original order.");
  }
  // BIP-39 derives the seed; BIP-32/44 derives the Ethereum key pair.
  return HDNodeWallet.fromPhrase(normalized, "", DERIVATION_PATH);
}

export function createWallet(): HDNodeWallet {
  return Wallet.createRandom();
}

export async function encryptWallet(wallet: HDNodeWallet, password: string): Promise<string> {
  if (password.length < 12) throw new Error("Use a password with at least 12 characters.");
  return wallet.encrypt(password);
}

export async function unlockWallet(vault: string, password: string): Promise<Wallet | HDNodeWallet> {
  return Wallet.fromEncryptedJson(vault, password);
}

export type PublicAccount = {
  address: string;
  publicKey: string;
  bitcoinAddress: string | null;
};

export function publicAccount(wallet: Wallet | HDNodeWallet): PublicAccount {
  let bitcoinAddress: string | null = null;
  if (wallet instanceof HDNodeWallet && wallet.mnemonic) {
    const node = HDNodeWallet.fromSeed(wallet.mnemonic.computeSeed()).derivePath("m/84'/0'/0'/0/0");
    bitcoinAddress = bech32.encode("bc", [0, ...bech32.toWords(getBytes(ripemd160(sha256(node.publicKey))))]);
  }
  return { address: wallet.address, publicKey: wallet.signingKey.publicKey, bitcoinAddress };
}
