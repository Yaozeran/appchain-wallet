import test from 'node:test';
import assert from 'node:assert/strict';
import { Wallet, Transaction, decodeRlp, getBytes, keccak256, toUtf8Bytes } from 'ethers';
import { inflateSync } from 'node:zlib';
import { execute, encodeChannel, prove, TEST_CHAIN_ID,GAS,GAS_PRICE,GENESIS_HASH } from '../engine.mjs';
// Public development fixtures only, never operator keys.
const sender=Wallet.fromPhrase('test test test test test test test test test test test junk');
const recipient='0x3333333333333333333333333333333333333333';
const address=sender.address.toLowerCase();
const sign=(nonce,extra={})=>sender.signTransaction({type:2,chainId:TEST_CHAIN_ID,nonce,to:recipient,value:100n,gasLimit:GAS,maxFeePerGas:GAS_PRICE,maxPriorityFeePerGas:0,...extra});
const input=rawTransactions=>({sender:address,rawTransactions,accounts:{[address]:{balance:'1000000000000000000',nonce:0}},head:{number:0,hash:GENESIS_HASH,timestamp:1700000000},blockCapacity:2});

test('ownership proofs require the exact signed challenge and key',async()=>{
 const signature=await sender.signMessage('challenge-one');
 assert.equal(prove({message:'challenge-one',signature,address}).ok,true);
 assert.equal(prove({message:'challenge-two',signature,address}).ok,false);
 assert.equal(prove({message:'challenge-one',signature,address:recipient}).ok,false);
});
test('signed payments execute nonce, balance and fee rules; blocks and receipts survive encoding',async()=>{
 const raw=await Promise.all([sign(0),sign(1),sign(2)]),initial=input(raw);
 const result=execute(initial);
 assert.equal(result.blocks.length,2);assert.equal(result.receipts.length,3);
 assert.equal(result.accounts[address].nonce,3);
 assert.equal(BigInt(result.accounts[address].balance),1000000000000000000n-300n-3n*GAS*GAS_PRICE);
 assert.equal(result.accounts[recipient].balance,'300');
 assert.equal(result.blocks[1].parentHash,result.blocks[0].hash);
 assert.equal(result.receipts[2].blockHash,result.blocks[1].hash);
 assert.equal(result.receipts[0].transactionHash,Transaction.from(raw[0]).hash);
 assert.equal(result.metrics.modeledInclusionTps,0.75);
 assert.equal(result.metrics.averageModeledConfirmationMs,8000/3);
 assert.equal(result.batch.l1Status,'NOT_SUBMITTED');
 assert.equal(initial.accounts[address].nonce,0,'input remains immutable');
 // Independently parse the first encoded frame/channel/RLP string and batch list.
 const frame=Buffer.from(result.batch.frames[0].slice(2),'hex');
 assert.equal(frame[0],0);assert.equal(frame.readUInt16BE(17),0);
 const length=frame.readUInt32BE(19);assert.equal(frame[23+length],1);
 const stream=inflateSync(frame.subarray(23,23+length));
 // RLP first string: parse its prefix to split a multi-batch stream.
 const prefix=stream[0];let header=1,bodyLength;
 if(prefix<=0xb7)bodyLength=prefix-0x80;else {const size=prefix-0xb7;bodyLength=Number(BigInt('0x'+stream.subarray(1,1+size).toString('hex')));header+=size;}
 const encodedBatch=decodeRlp('0x'+stream.subarray(0,header+bodyLength).toString('hex'));
 assert.equal(encodedBatch.slice(0,4),'0x00');
 const batch=decodeRlp('0x'+encodedBatch.slice(4));
 assert.equal(batch[0],GENESIS_HASH);assert.equal(batch[1],'0x');assert.equal(batch[3],'0x6553f102');
 assert.deepEqual(batch[4],raw.slice(0,2));
});
test('rejects unowned signatures, wrong chains, replay/nonces, call data, fees and overspending without mutating inputs',async()=>{
 for(const raw of [await sign(1),await sign(0,{chainId:42069}),await sign(0,{data:'0x1234'}),await sign(0,{maxFeePerGas:1n}),await sign(0,{value:0n}),await sign(0,{to:sender.address})])assert.throws(()=>execute(input([raw])));
 const raw=await sign(0);
 assert.throws(()=>execute({...input([raw]),sender:recipient}),/signature/);
 const low=input([raw]);low.accounts[address].balance='1';assert.throws(()=>execute(low),/Insufficient/);assert.equal(low.accounts[address].nonce,0);
 assert.throws(()=>execute(input([raw,raw])),/nonce/);
});
test('channels split into ordered bounded frames and reassemble exactly',()=>{
 const randomTransactions=Array.from({length:40},(_,i)=>'0x'+Array.from({length:8},(_,j)=>keccak256(toUtf8Bytes(`${i}:${j}`)).slice(2)).join(''));
 const blocks=[{parentHash:GENESIS_HASH,timestamp:1700000002,rawTransactions:randomTransactions}];
 const channel=encodeChannel(blocks,'0x'+'ab'.repeat(32));assert.ok(channel.frames.length>1);
 const pieces=channel.frames.map((hex,i)=>{const frame=Buffer.from(getBytes(hex));assert.equal(frame.readUInt16BE(17),i);assert.equal(frame[frame.length-1],i===channel.frames.length-1?1:0);return frame.subarray(23,frame.length-1);});
 assert.equal(Buffer.concat(pieces).length,channel.compressedBytes);
 assert.equal(inflateSync(Buffer.concat(pieces)).length,channel.rawBytes);
});
