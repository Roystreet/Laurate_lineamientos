import {useEffect,useRef,type ReactNode} from 'react';
import {AlertCircle,CheckCircle2,LoaderCircle,Layers,X,ChevronLeft,ChevronRight} from 'lucide-react';
export const labels:Record<string,string>={queued:'En espera',processing:'Preparando',running:'En curso',complete:'Completado',done:'Completado',error:'No se completó',partial:'Parcial',blank:'Página vacía',illegible:'Texto ilegible'};
export const friendlyMessage=(message:string)=>message.replace(/OCR/gi,'lectura del documento');
export async function api<T>(url:string,options?:RequestInit):Promise<T>{
  const response=await fetch('/api'+url,options);
  const unavailable=`El servicio no pudo completar la solicitud (HTTP ${response.status}). Vuelve a intentar en unos momentos.`;
  let body;
  try{body=await response.json();}
  catch{throw new Error(response.ok?'El servidor devolvió una respuesta incompleta. Vuelve a intentar.':unavailable);}
  if(!response.ok)throw new Error(friendlyMessage(body?.error || body?.files?.map((f:{error?:string})=>f.error).filter(Boolean).join(' · ') || unavailable));
  return body;
}
export const post=<T,>(url:string,body?:unknown)=>api<T>(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body ?? {})});
export function Status({value}:{value:string}){
  return <span className={'status '+value}>{['running','processing','queued'].includes(value)?<LoaderCircle size={12}/>:value==='error'||value==='partial'?<AlertCircle size={12}/>:<CheckCircle2 size={12}/>} {labels[value] ?? value}</span>;
}
export function Empty({title,text}:{title:string;text:string}){return <div className="empty"><Layers size={30}/><h3>{title}</h3><p>{text}</p></div>;}
export function Modal({title,children,onClose}:{title:string;children:ReactNode;onClose:()=>void}){
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const dialog=ref.current;dialog?.showModal();return()=>dialog?.close();},[]);
  return <dialog ref={ref} aria-label={title} onCancel={onClose} onClick={e=>{if(e.target===ref.current)onClose();}}><div className="modal-header"><h2>{title}</h2><button className="icon-button" aria-label="Cerrar" onClick={onClose}><X size={20}/></button></div><div className="modal-content">{children}</div></dialog>;
}
export function Pagination({total,page,size,onPage,onSize,label}:{total:number;page:number;size:number;onPage:(page:number)=>void;onSize:(size:number)=>void;label:string}){
  const pages=Math.max(1,Math.ceil(total/size)),current=Math.min(page,pages);
  return <div className="pagination" aria-label={`Paginación de ${label}`}><span>{total?`${(current-1)*size+1}–${Math.min(current*size,total)} de ${total}`:'0 resultados'}</span><label>Por página<select aria-label={`Cantidad de ${label} por página`} value={size} onChange={e=>onSize(Number(e.target.value))}>{[5,10,20].map(n=><option key={n}>{n}</option>)}</select></label><div><button className="icon-button" aria-label={`Página anterior de ${label}`} disabled={current===1} onClick={()=>onPage(current-1)}><ChevronLeft size={18}/></button><span>Página {current} de {pages}</span><button className="icon-button" aria-label={`Página siguiente de ${label}`} disabled={current===pages} onClick={()=>onPage(current+1)}><ChevronRight size={18}/></button></div></div>;
}
