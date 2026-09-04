"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { acceptOffer, getTrackingWsToken, listOrderMatches, listOrderOffers, listOrders, Match, Offer, Order, trackingWebSocketUrl } from "../lib/api";

function requirementSummary(payload: Order["payload"]) { if (!payload) return ""; const parts: string[] = []; if (payload.weightKg) parts.push(`${payload.weightKg} kg`); if (payload.volumeM3) parts.push(`${payload.volumeM3} m³`); if (payload.vehicleType) parts.push(payload.vehicleType); if (payload.refrigerated) parts.push("Soğutuculu"); return parts.join(" · "); }
const trackingStatuses = new Set(["DRIVER_ASSIGNED", "EN_ROUTE_PICKUP", "ARRIVED_PICKUP", "LOADED", "IN_TRANSIT", "ARRIVED_DELIVERY", "DELIVERED"]);
const statusSteps = [["DRIVER_ASSIGNED", "Sürücü atandı"], ["EN_ROUTE_PICKUP", "Pickup'a gidiliyor"], ["ARRIVED_PICKUP", "Pickup noktasında"], ["LOADED", "Yük alındı"], ["IN_TRANSIT", "Taşınıyor"], ["ARRIVED_DELIVERY", "Teslimat noktasında"], ["DELIVERED", "Teslim edildi"], ["COMPLETED", "Tamamlandı"]] as const;
const statusLabels: Record<string, string> = Object.fromEntries(statusSteps);
const terminalLabels: Record<string, string> = { CANCELLED: "İptal edildi", EXPIRED: "Süresi doldu", FAILED: "Başarısız", DISPUTED: "Uyuşmazlık" };
const terminalStatuses = new Set(["COMPLETED", "CANCELLED", "EXPIRED", "FAILED", "DISPUTED"]);

export default function OrdersPage(){
 const [token,setToken]=useState(""),[orders,setOrders]=useState<Order[]>([]),[offers,setOffers]=useState<Record<string,Offer[]>>({}),[matches,setMatches]=useState<Record<string,Match[]>>({}),[busy,setBusy]=useState(""),[loadingMatches,setLoadingMatches]=useState(""),[message,setMessage]=useState("");
 const socketsRef=useRef<Map<string,WebSocket>>(new Map());
 async function load(t:string){const r=await listOrders(t);setOrders(r.orders);const entries=await Promise.all(r.orders.map(async o=>[o.id,(await listOrderOffers(t,o.id)).offers] as const));setOffers(Object.fromEntries(entries));}
 useEffect(()=>{const t=window.localStorage.getItem("yuklab_access_token")??"";setToken(t);if(!t)return;void load(t).catch(e=>setMessage(e instanceof Error?e.message:"Siparişler alınamadı."));const refresh=window.setInterval(()=>{void load(t).catch(()=>undefined);},15000);const sockets=socketsRef.current;return()=>{window.clearInterval(refresh);for(const socket of sockets.values())socket.close();sockets.clear();};},[]);
 useEffect(()=>{
   if(!token)return;
   const active=new Set(orders.filter(o=>!terminalStatuses.has(o.status)).map(o=>o.id));
   for(const [id,socket] of socketsRef.current) if(!active.has(id)){socket.close();socketsRef.current.delete(id);}
   for(const order of orders){if(!active.has(order.id)||socketsRef.current.has(order.id))continue;
     void getTrackingWsToken(token,order.id).then(({token:wsToken})=>{
       if(socketsRef.current.has(order.id))return;
       const socket=new WebSocket(trackingWebSocketUrl(order.id),[`yuklab-token.${wsToken}`]);
       socketsRef.current.set(order.id,socket);
       socket.onmessage=(event)=>{try{const payload=JSON.parse(event.data) as {type?:string;status?:string};
         if(payload.type==="order.status"&&payload.status){setOrders(current=>current.map(item=>item.id===order.id?{...item,status:payload.status!}:item));return;}
         if(payload.type==="order.offer"){void listOrderOffers(token,order.id).then(r=>setOffers(current=>({...current,[order.id]:r.offers}))).catch(()=>undefined);}
       }catch{/* Ignore malformed events. */}};
       socket.onclose=()=>{if(socketsRef.current.get(order.id)===socket)socketsRef.current.delete(order.id);};
       socket.onerror=()=>undefined;
     }).catch(()=>undefined);
   }
 },[orders,token]);
 async function showMatches(orderId:string){if(!token)return;setLoadingMatches(orderId);setMessage("");try{const r=await listOrderMatches(token,orderId);setMatches(current=>({...current,[orderId]:r.matches}));}catch(e){setMessage(e instanceof Error?e.message:"Uygun taşıyıcılar alınamadı.");}finally{setLoadingMatches("");}}
 async function choose(orderId:string,offerId:string){if(!token)return;setBusy(offerId);setMessage("");try{await acceptOffer(token,orderId,offerId);await load(token);setMessage("Teklif kabul edildi. Sürücü atandı.");}catch(e){setMessage(e instanceof Error?e.message:"Teklif kabul edilemedi.");}finally{setBusy("");}}
 return <main className="dashboard"><header className="dashboard-header"><div><p className="eyebrow">YÜKLAB · CUSTOMER</p><h1>Siparişlerim</h1><p className="lead">Taleplerini, gelen teklifleri ve seçtiğin hizmet sağlayıcıyı yönet.</p></div><Link className="nav-link" href="/">Yeni talep →</Link></header>{!token?<div className="notice error">Siparişlerini görmek için giriş yapmalısın.</div>:<>{message&&<div className="notice">{message}</div>}<div className="stack">{orders.length===0?<div className="empty">Henüz sipariş yok.</div>:orders.map(o=>{const currentIndex=statusSteps.findIndex(([status])=>status===o.status);return <article className="job-card" key={o.id}><div className="job-top"><strong>{o.serviceType}</strong><span className={`status-badge ${o.status.toLowerCase()}`}>{statusLabels[o.status]??terminalLabels[o.status]??o.status}</span></div><div className="order-timeline">{statusSteps.map(([status,label],index)=><div className={`order-step${index<currentIndex?" done":index===currentIndex?" current":""}`} key={status}><span className="order-step-dot">{index<currentIndex?"✓":index+1}</span><span>{label}</span></div>)}</div><p><b>{o.pickupAddress}</b> → {o.deliveryAddress||"Teslimat adresi yok"}</p>{(o.pickupLat||o.deliveryLat)&&<p className="requirements">📍 GPS: {o.pickupLat&&o.pickupLng?`${o.pickupLat}, ${o.pickupLng}`:"Alım yok"} → {o.deliveryLat&&o.deliveryLng?`${o.deliveryLat}, ${o.deliveryLng}`:"Teslimat yok"}</p>}{requirementSummary(o.payload)&&<p className="requirements"><b>Yük gereksinimleri:</b> {requirementSummary(o.payload)}</p>}{trackingStatuses.has(o.status)&&o.assignedDriverId&&<Link className="tracking-button" href={`/tracking/${o.id}`}>📍 Sürücüyü canlı takip et →</Link>}<button onClick={()=>showMatches(o.id)} disabled={loadingMatches===o.id}>{loadingMatches===o.id?"Eşleştiriliyor…":"En uygun taşıyıcıları bul →"}</button><div className="match-list">{(matches[o.id]||[]).length>0&&<><h3>Akıllı eşleştirme</h3>{matches[o.id].map((m,index)=><div className="match-card" key={`${m.providerId}-${m.vehicleId??"none"}`}><div className="job-top"><strong>#{index+1} Uygun taşıyıcı</strong><span>{m.score.toFixed(0)} puan</span></div><p>{m.distanceKm.toFixed(1)} km · {m.etaMinutes?`${m.etaMinutes} dk ETA`:"ETA hesaplanamadı"} · ⭐ {m.rating.toFixed(1)} · Güvenilirlik {m.reliabilityScore.toFixed(0)}</p><p><b>Araç:</b> {m.vehicleType||"Standart"}{m.vehicleSubtype?` / ${m.vehicleSubtype}`:""} · {m.capacityKg?`${m.capacityKg} kg`:"Kapasite yok"}{m.volumeM3?` · ${m.volumeM3} m³`:""}{m.refrigerated?" · ❄ Soğutuculu":""}</p></div>)}</>}</div><h3>Teklifler</h3>{(offers[o.id]||[]).length===0?<p>Henüz teklif gelmedi.</p>:(offers[o.id]||[]).map(f=><div className="offer-card" key={f.id}><div><strong>{f.provider?.firstName} {f.provider?.lastName}</strong><span>{f.status}</span></div><p>{Number(f.amountMinor)/100} {f.currency} · {f.etaMinutes?`${f.etaMinutes} dk`:"ETA yok"}</p>{f.note&&<small>{f.note}</small>}{f.status==="PENDING"&&["PUBLISHED","OFFERING"].includes(o.status)&&<button disabled={busy===f.id} onClick={()=>choose(o.id,f.id)}>{busy===f.id?"Seçiliyor…":"Bu teklifi kabul et"}</button>}</div>)}</article>})}</div></>}</main>;
}
