"use client";
import { useEffect, useState } from "react";
import { custodyApi } from "@/lib/custody";
type Batch = {id:string;payments:number;processingMs:number;processingTps:number;averageProcessingMs:number;rawBytes:number;compressedBytes:number;scope:string;l1Status:string};
type Metrics = {sequencerAvailable:boolean;reason:string;latestBlock:number|null;sampledBlocks:number|null;transactions:number|null;inclusionTps:number|null;batcherTps:number|null};
export default function PaymentPerformance({revision}:{revision:string}) {
  const [batches,setBatches]=useState<Batch[]>([]);
  const [metrics,setMetrics]=useState<Metrics|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  useEffect(()=>{let active=true; custodyApi<Batch[]>("traffic").then(data=>{if(active)setBatches(data);}).catch(()=>{if(active)setError("Unable to load test batch history.");}); return()=>{active=false;};},[revision]);
  async function measure() {
    setBusy(true);setError("");
    try {setMetrics(await custodyApi<Metrics>("appchain-metrics"));}catch(cause){setError((cause as Error).message);}finally{setBusy(false);}
  }
  return <section className="card activity-panel"><span className="eyebrow">PAYMENT PERFORMANCE</span><h2>Traffic and batching</h2>
    <p className="muted">Use the payment form to send repeated test payments to a merchant address. Each test run is saved as an application batch with zlib compression.</p>
    <p className="field-help">Application measurements include ledger SQL and JSON/zlib processing inside one atomic database transaction. They exclude commit time, HTTP latency, EVM execution and L1 settlement. No blockchain confirmation time or OP batcher TPS is inferred.</p>
    {batches.map(batch=><details key={batch.id}><summary>{batch.payments} payments · {batch.processingTps.toFixed(2)} application payments/s</summary><p>Processing: {batch.processingMs.toFixed(2)} ms · average: {batch.averageProcessingMs.toFixed(2)} ms/payment</p><p>JSON: {batch.rawBytes} bytes → zlib: {batch.compressedBytes} bytes · fixed test fee: 0 ETH</p><p>Scope: application ledger and zlib · L1: not submitted</p><code className="simulation-address">Batch reference: {batch.id}</code></details>)}
    {!batches.length && <p className="field-help">No payment traffic runs yet. Choose more than one payment in the send form.</p>}
    <h3>Actual OP Stack measurements</h3><button className="secondary" disabled={busy} onClick={()=>void measure()}>{busy?"Reading chain…":"Measure sequencer inclusion TPS"}</button>
    {metrics && <div role="status"><p>{metrics.reason}</p>{metrics.sequencerAvailable && <p>Head #{metrics.latestBlock} · {metrics.transactions} non-deposit transactions / {metrics.sampledBlocks} block intervals · observed inclusion: {metrics.inclusionTps===null?"Unavailable":`${metrics.inclusionTps.toFixed(2)} TPS`}</p>}<p>OP batcher throughput: unavailable · on-chain confirmation time: unavailable · public-chain fee comparison: not measured</p></div>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
