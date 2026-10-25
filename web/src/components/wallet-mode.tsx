"use client";
import { useEffect, useState } from "react";
import { custodyApi } from "@/lib/custody";
export default function WalletMode() {
  const [open,setOpen]=useState(false);
  const [reason,setReason]=useState("Normal payments are unavailable. Test mode runs signed wallet payments through an offline rollup model.");
  useEffect(()=> { let active=true; custodyApi<{reason:string}>("capabilities").then(data=>{if(active)setReason(data.reason);}).catch(()=>{}); return()=>{active=false;}; },[]);
  return <div className="wallet-mode"><button className="secondary compact" aria-expanded={open} onClick={()=>setOpen(!open)}>Test mode ▾</button>{open && <div className="mode-menu"><button className="secondary" onClick={()=>setOpen(false)}>✓ Test mode</button><button className="secondary" disabled>Normal mode · unavailable</button><p className="field-help">{reason}</p></div>}</div>;
}
