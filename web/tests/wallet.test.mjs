import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Mnemonic, computeAddress } from 'ethers';
import { createWallet, walletFromPhrase, encryptWallet, unlockWallet, DERIVATION_PATH } from '../src/lib/wallet.ts';

// Public test fixture only. Never use this phrase for real funds.
const phrase = 'test test test test test test test test test test test junk';

test('derives the standard Ethereum account from a known recovery phrase', () => {
  const wallet = walletFromPhrase(phrase);
  assert.equal(wallet.address, '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
  assert.equal(wallet.privateKey, '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
  assert.equal(wallet.path, DERIVATION_PATH);
  assert.equal(computeAddress(wallet.signingKey.publicKey), wallet.address);
});

test('normalizes whitespace and case without changing the account', () => {
  assert.equal(walletFromPhrase(`  ${phrase.toUpperCase().replaceAll(' ', '\n ')}  `).address, walletFromPhrase(phrase).address);
});

test('rejects arbitrary phrases and bad mnemonic checksums', () => {
  for (const invalid of ['', 'my favorite secret phrase', 'test '.repeat(12)]) {
    assert.throws(() => walletFromPhrase(invalid), /valid English recovery phrase/);
  }
});

test('generates valid, distinct 12-word wallets', () => {
  const a = createWallet();
  const b = createWallet();
  assert.equal(a.mnemonic.phrase.split(' ').length, 12);
  assert.ok(Mnemonic.isValidMnemonic(a.mnemonic.phrase));
  assert.notEqual(a.address, b.address);
  assert.equal(walletFromPhrase(a.mnemonic.phrase).privateKey, a.privateKey);
});

test('requires a password of at least 12 characters', async () => {
  await assert.rejects(encryptWallet(walletFromPhrase(phrase), 'short'), /12 characters/);
});

test('encrypted vault restores keys and rejects wrong passwords or tampering', async () => {
  const wallet = walletFromPhrase(phrase);
  const vault = await encryptWallet(wallet, 'a-long-test-password');
  assert.ok(!vault.includes(wallet.privateKey.slice(2)));
  assert.ok(!vault.includes(phrase));
  assert.ok(!vault.includes(wallet.mnemonic.computeSeed().slice(2)));
  const unlocked = await unlockWallet(vault, 'a-long-test-password');
  assert.equal(unlocked.privateKey, wallet.privateKey);
  assert.equal(unlocked.address, wallet.address);
  await assert.rejects(unlockWallet(vault, 'wrong-password'));
  const tampered = JSON.parse(vault);
  tampered.Crypto.ciphertext = '00'.repeat(32);
  await assert.rejects(unlockWallet(JSON.stringify(tampered), 'a-long-test-password'));
});
