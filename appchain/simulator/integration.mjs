// Against the running Docker app. Random test keys never leave this process.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Wallet } from 'ethers';
import { TEST_CHAIN_ID, GAS, GAS_PRICE } from './engine.mjs';
const base=process.argv[2]||'http://localhost:3000';
class Client {
  cookie='';
  async call(path,body,expected=200,mode='test'){
    const response=await fetch(`${base}/api/custody/${path}`,{method:body===undefined?'GET':'POST',headers:{Origin:base,Cookie:this.cookie,'Content-Type':'application/json','X-Wallet-Mode':mode},body:body===undefined?undefined:JSON.stringify(body)});
    const cookie=response.headers.get('set-cookie');if(cookie)this.cookie=cookie.split(';')[0];
    const result=await response.json();assert.equal(response.status,expected,`${path}: ${JSON.stringify(result)}`);return result;
  }
  async register(){this.email=`signed-${randomUUID()}@wallet.test`;return this.call('register',{email:this.email,password:'Offline-Wallet!2026'});}
  async bind(wallet,expected=200){const {message}=await this.call('wallet/challenge',{});return this.call('wallet/bind',{address:wallet.address,signature:await wallet.signMessage(message)},expected);}
}
const a=new Client(), b=new Client(), anon=new Client();
const signer=Wallet.createRandom(),merchant=Wallet.createRandom();
await anon.call('wallet/me',undefined,401);
await a.register();await b.register();
assert.equal((await a.call('wallet/me')).linked,false);
const challenge=await a.call('wallet/challenge',{});
await a.call('wallet/bind',{address:signer.address,signature:await merchant.signMessage(challenge.message)},400);
const state=await a.bind(signer);assert.equal(state.address,signer.address.toLowerCase());assert.equal(state.chainId,TEST_CHAIN_ID);
await a.call('wallet/bind',{address:signer.address,signature:await signer.signMessage(challenge.message)},409);
await b.bind(signer,409);await b.bind(merchant);
const buy={requestKey:randomUUID(),cardId:state.card.id,fiatAmount:'100'};
await a.call('wallet/buy',buy);assert.equal((await a.call('wallet/buy',buy)).replayed,true);
await a.call('wallet/buy',{...buy,fiatAmount:'101'},409);
assert.equal((await a.call('me')).cryptoWei,'0','no platform ETH deposit/credit');
assert.equal((await a.call('wallet/me')).cryptoWei,'40000000000000000');
assert.equal((await a.call('wallet/me')).card.fiatCents,'90000');
const transaction=(nonce,extra={})=>signer.signTransaction({type:2,chainId:TEST_CHAIN_ID,nonce,to:merchant.address,value:100000000000000n,gasLimit:GAS,maxFeePerGas:GAS_PRICE,maxPriorityFeePerGas:0,...extra});
const rawTransactions=await Promise.all(Array.from({length:20},(_,i)=>transaction(i)));
const payment={requestKey:randomUUID(),rawTransactions,blockCapacity:5};
const results=await Promise.all([a.call('wallet/send',payment),a.call('wallet/send',payment)]);
assert.equal(results[0].id,results[1].id);
const result=results[0];assert.equal(result.blocks.length,4);assert.equal(result.receipts.length,20);
assert.equal(result.scope,'OFFLINE_ROLLUP_MODEL');assert.equal(result.batch.l1Status,'NOT_SUBMITTED');
assert.equal(result.metrics.modeledInclusionTps,2.5);assert.ok(result.metrics.processingTps>0);
assert.equal((await a.call('wallet/me')).cryptoWei,(40000000000000000n-20n*(100000000000000n+GAS*GAS_PRICE)).toString());
assert.equal((await b.call('wallet/me')).cryptoWei,'2000000000000000');
await a.call('wallet/send',{...payment,requestKey:randomUUID()},409);
await a.call('wallet/send',{...payment,blockCapacity:6},409);
const before=await a.call('wallet/me');
await a.call('wallet/send',{requestKey:randomUUID(),rawTransactions:[await transaction(20),await transaction(21,{value:10n**18n})],blockCapacity:5},400);
assert.deepEqual(await a.call('wallet/me'),before,'rejected run leaves all state intact');
await a.call('wallet/send',{requestKey:randomUUID(),rawTransactions:[await transaction(20,{chainId:42069})],blockCapacity:5},400);
const wrong=await merchant.signTransaction({type:2,chainId:TEST_CHAIN_ID,nonce:20,to:signer.address,value:1,gasLimit:GAS,maxFeePerGas:GAS_PRICE,maxPriorityFeePerGas:0});
await a.call('wallet/send',{requestKey:randomUUID(),rawTransactions:[wrong],blockCapacity:5},400);
await a.call('wallet/send',{requestKey:randomUUID(),rawTransactions,blockCapacity:5},409,'normal');
const history=await a.call('wallet/history');assert.equal(history.runs.length,1);assert.equal(history.receipts.length,20);
assert.equal((await b.call('wallet/history')).runs.length,0);
assert.equal((await b.call('wallet/history')).receipts.length,20);
// An address need not be registered or deposit into this platform to receive.
const outside=Wallet.createRandom();
await a.call('wallet/send',{requestKey:randomUUID(),rawTransactions:[await transaction(20,{to:outside.address,value:100n})],blockCapacity:1});
const c=new Client();await c.register();const received=await c.bind(outside);assert.equal(received.cryptoWei,'100');
console.log(JSON.stringify({result:'PASS',scope:result.scope,payments:20,blocks:4,processingTps:result.metrics.processingTps,batchingTps:result.metrics.batchingTps,modeledInclusionTps:result.metrics.modeledInclusionTps,rawBytes:result.metrics.rawBytes,compressedBytes:result.metrics.compressedBytes,onchainInteractions:0,checks:['email-to-wallet proof','direct wallet test credit','browser-style signed payments','duplicate/concurrent retry','nonce/chain/ownership enforcement','rollback','recipient before registration','user isolation','normal disabled']}));
