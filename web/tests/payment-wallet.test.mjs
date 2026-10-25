import test from 'node:test';
import assert from 'node:assert/strict';
import { Transaction } from 'ethers';
import { walletFromPhrase,signPayments,vaultKey } from '../src/lib/payment-wallet.ts';
const phrase='test test test test test test test test test test test junk';
test('email vault namespaces normalize email without using it as entropy',()=>{
 assert.equal(vaultKey(' Example@Wallet.Test '),'wallet.email.v1:example@wallet.test');
 assert.notEqual(vaultKey('other@wallet.test'),vaultKey('example@wallet.test'));
});
test('wallet signs independent payments with consecutive nonces and an isolated test chain ID',async()=>{
 const signer=walletFromPhrase(phrase);
 const account={chainId:420690001,nonce:8,gasLimit:'21000',gasPriceWei:'1000000'};
 const raw=await signPayments(signer,account,'0x3333333333333333333333333333333333333333',1000n,3);
 for(let i=0;i<raw.length;i++){
  const tx=Transaction.from(raw[i]);assert.equal(tx.from,signer.address);assert.equal(tx.nonce,8+i);
  assert.equal(tx.chainId,420690001n);assert.equal(tx.value,1000n);assert.equal(tx.gasLimit,21000n);
  assert.equal(tx.maxFeePerGas,1000000n);assert.equal(tx.maxPriorityFeePerGas,0n);
 }
 assert.equal(new Set(raw).size,3);
 await assert.rejects(signPayments(signer,{...account,chainId:42069},signer.address,1n,1),/Signing stopped/);
});
