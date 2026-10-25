import { Transaction, verifyMessage, getAddress, encodeRlp, keccak256, concat, toBeHex, toUtf8Bytes } from 'ethers';
import { deflateSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';
export const TEST_CHAIN_ID = 420690001;
export const GAS_PRICE = 1000000n;
export const GAS = 21000n;
export const GENESIS_HASH = keccak256(toUtf8Bytes('wallet-offline-rollup-genesis-v1'));
const ORIGIN = keccak256(toUtf8Bytes('synthetic-l1-origin-not-onchain'));
const quantity = value => BigInt(value) === 0n ? '0x' : toBeHex(value);
const fail = (message, conflict = false) => { const error = new Error(message); error.conflict = conflict; error.public = true; throw error; };
export function prove({message, signature, address}) {
  try { return {ok: verifyMessage(message, signature).toLowerCase() === getAddress(address).toLowerCase()}; }
  catch { return {ok:false}; }
}
// Bedrock singular batch payloads, RLP byte-string stream, zlib channel and v0 frames.
// Mirrors the wire format, NOT the upstream batcher runtime or full derivation rules.
export function encodeChannel(blocks, channelId) {
  const encoded = blocks.map(block => encodeRlp(concat(['0x00', encodeRlp([
    block.parentHash, quantity(0), ORIGIN, quantity(block.timestamp), block.rawTransactions,
  ])])));
  const raw = Buffer.from(concat(encoded).slice(2),'hex');
  const compressed = deflateSync(raw);
  const frames=[];
  const id=Buffer.from(channelId.slice(2,34),'hex');
  for(let offset=0, index=0;offset<compressed.length;offset+=1000,index++) {
    const data=compressed.subarray(offset,offset+1000);
    const header=Buffer.alloc(22);id.copy(header);header.writeUInt16BE(index,16);header.writeUInt32BE(data.length,18);
    frames.push('0x'+Buffer.concat([Buffer.from([0]),header,data,Buffer.from([offset+1000>=compressed.length?1:0])]).toString('hex'));
  }
  return {format:'OP_SINGULAR_V0_ZLIB_FRAMES_V0_MODEL',rawBytes:raw.length,compressedBytes:compressed.length,
    frameBytes:frames.reduce((n,frame)=>n+(frame.length-2)/2,0),frames};
}
export function execute(input) {
  const start=performance.now();
  const {sender, rawTransactions, accounts: initial, head, blockCapacity=20}=input;
  if(!Array.isArray(rawTransactions)||rawTransactions.length<1||rawTransactions.length>200) fail('Submit 1–200 signed payments.');
  if(!Number.isInteger(blockCapacity)||blockCapacity<1||blockCapacity>100) fail('Block capacity must be 1–100.');
  const accounts=structuredClone(initial);
  const blocks=[],receipts=[];
  let parent=head.hash, height=head.number, timestamp=head.timestamp;
  let current=[];
  let totalFees=0n;
  const finishBlock=()=>{
    if(!current.length)return;
    height++; timestamp+=2;
    const block={number:height,parentHash:parent,timestamp,rawTransactions:current.map(tx=>tx.raw),transactionHashes:current.map(tx=>tx.hash),gasUsed:(GAS*BigInt(current.length)).toString()};
    // Model identifier, intentionally not an Ethereum header/state root.
    block.hash=keccak256(toUtf8Bytes(JSON.stringify(block)));
    current.forEach((tx,index)=>receipts.push({transactionHash:tx.hash,from:tx.from,to:tx.to,value:tx.value,
      nonce:tx.nonce,blockNumber:height,blockHash:block.hash,transactionIndex:index,status:'SIMULATED_INCLUDED',
      gasUsed:GAS.toString(),effectiveGasPrice:GAS_PRICE.toString(),feeWei:(GAS*GAS_PRICE).toString(),
      modeledConfirmationMs:(blocks.length+1)*2000}));
    blocks.push(block);parent=block.hash;current=[];
  };
  for(const raw of rawTransactions) {
    if(typeof raw!=='string'||raw.length>1024) fail('Invalid signed payment.');
    let tx;try{tx=Transaction.from(raw);}catch{fail('Invalid signed payment.');}
    let from;try{from=tx.from?.toLowerCase();}catch{fail('Invalid payment signature.');}
    if(!from||from!==sender.toLowerCase()) fail('Payment signature does not belong to your linked wallet.');
    if(tx.chainId!==BigInt(TEST_CHAIN_ID))fail('Wrong test chain ID. Real-chain transactions are never accepted.');
    if(tx.type!==2||tx.data!=='0x'||!tx.to||/^0x0{40}$/i.test(tx.to)||tx.to.toLowerCase()===from||tx.value<=0n)fail('Only positive native transfers to another nonzero address are supported.');
    if(tx.gasLimit!==GAS||tx.maxFeePerGas!==GAS_PRICE||tx.maxPriorityFeePerGas!==0n)fail('Use the configured fixed test gas and fee model.');
    const account=accounts[from]||{balance:'0',nonce:0};
    if(tx.nonce!==account.nonce)fail('Wallet nonce changed. Refresh and sign the payment again.',true);
    const cost=tx.value+GAS*GAS_PRICE;
    if(BigInt(account.balance)<cost)fail('Insufficient test ETH including modeled fees.');
    const to=tx.to.toLowerCase(),recipient=accounts[to]||{balance:'0',nonce:0};
    accounts[from]={balance:(BigInt(account.balance)-cost).toString(),nonce:account.nonce+1};
    accounts[to]={...recipient,balance:(BigInt(recipient.balance)+tx.value).toString()};
    totalFees+=GAS*GAS_PRICE;
    current.push({raw,hash:tx.hash,from,to,value:tx.value.toString(),nonce:tx.nonce});
    if(current.length===blockCapacity)finishBlock();
  }
  finishBlock();
  const executionMs=Math.max(performance.now()-start,0.001);
  const batchStart=performance.now();
  const channelId=keccak256(toUtf8Bytes(JSON.stringify([head.hash,rawTransactions])));
  const channel=encodeChannel(blocks,channelId);
  const batchMs=Math.max(performance.now()-batchStart,0.001);
  const totalMs=Math.max(performance.now()-start,0.001);
  const count=rawTransactions.length;
  return {ok:true,scope:'OFFLINE_ROLLUP_MODEL',chainId:TEST_CHAIN_ID,accounts,head:{number:height,hash:parent,timestamp},blocks,receipts,
    batch:{id:channelId,...channel,l1Status:'NOT_SUBMITTED',safe:false,finalized:false},
    metrics:{payments:count,blocks:blocks.length,executionMs,batchMs,totalMs,processingTps:count*1000/totalMs,
      executionTps:count*1000/executionMs,batchingTps:count*1000/batchMs,modeledInclusionTps:count/(blocks.length*2),
      averageModeledConfirmationMs:receipts.reduce((sum,r)=>sum+r.modeledConfirmationMs,0)/count,
      totalFeeWei:totalFees.toString(),assumedEthereumFeeWei:(GAS*1000000000n*BigInt(count)).toString(),
      comparison:'Assumed 1 gwei Ethereum gas versus 0.001 gwei model gas; excludes L1 data fees, not a live quote',
      rawBytes:channel.rawBytes,compressedBytes:channel.compressedBytes,frameBytes:channel.frameBytes}};
}
