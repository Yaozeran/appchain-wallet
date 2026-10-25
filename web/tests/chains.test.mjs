import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Wallet } from 'ethers';
import { formatBalance } from '../src/lib/chains.ts';
import { publicAccount, walletFromPhrase, encryptWallet, unlockWallet } from '../src/lib/wallet.ts';
import { validateTransakUrl } from '../src/lib/transak.ts';

const phrase = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

test('Bitcoin receive address matches the published BIP-84 vector and stays distinct from Ethereum', () => {
  const account = publicAccount(walletFromPhrase(phrase));
  assert.equal(account.bitcoinAddress, 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu');
  assert.match(account.address, /^0x[0-9a-fA-F]{40}$/);
  assert.notEqual(account.address, account.bitcoinAddress);
  assert.equal('privateKey' in account, false);
});

test('existing encrypted mnemonic wallets retain their Bitcoin address on unlock', async () => {
  const wallet = walletFromPhrase(phrase);
  const vault = await encryptWallet(wallet,'long-test-password');
  const restored = await unlockWallet(vault,'long-test-password');
  assert.deepEqual(publicAccount(restored), publicAccount(wallet));
  assert.equal(publicAccount(new Wallet(wallet.privateKey)).bitcoinAddress, null);
});

test('formatting preserves exact wei/satoshi values without floating point', () => {
  assert.equal(formatBalance('1000000000000000001',18),'1.000000000000000001');
  assert.equal(formatBalance('1',18),'0.000000000000000001');
  assert.equal(formatBalance('100000000',8),'1');
  assert.equal(formatBalance('-1000',8),'-0.00001');
  assert.equal(formatBalance('0',18),'0');
  assert.throws(()=>formatBalance('NaN',18));
  assert.throws(()=>formatBalance('1',-1));
});

test('Transak checkout validation preserves opaque URLs and rejects other hosts and modes', () => {
  const url = 'https://global-stg.transak.com?apiKey=fixture&sessionId=a%2Bb%3D';
  assert.equal(validateTransakUrl(url,'staging'),url);
  for (const bad of ['https://attacker.test?sessionId=x','https://global.transak.com?sessionId=x','https://global-stg.transak.com','https://global-stg.transak.com?sessionId=x&sessionId=y','https://user@global-stg.transak.com?sessionId=x']) assert.throws(()=>validateTransakUrl(bad,'staging'));
});
