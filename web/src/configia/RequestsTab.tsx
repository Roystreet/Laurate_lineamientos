import {useCallback,useEffect,useState} from 'react';
import {Plus,FlaskConical,Upload,XCircle} from 'lucide-react';
import {api,post,Empty,Modal} from '../ui';
import {criterioName,formatDate,requestStateLabels,rowTitle,type RequestRow,type RequestDetail,type FindingRow} from './types';
import {AuthorField,useAuthor} from './AuthorField';
import {HallazgoPicker,emptyFinding,findingReady,type FindingRef} from './HallazgoPicker';
import {DraftEditor} from './DraftEditor';

export const StateBadge=({estado}:{estado:string})=><span className={'status cia-'+estado}>{requestStateLabels[estado] ?? estado}</span>;
const eventLabels:Record<string,string>={creada:'Creada',borrador_guardado:'Borrador guardado',prueba_creada:'Prueba ejecutada',veredicto:'Veredicto registrado',publicada:'Publicada',rechazada:'Rechazada'};

export function FindingCard({row}:{row:FindingRow|null}){
  if(!row)return <div className="cia-finding missing"><strong>Falta un hallazgo</strong><p>La IA no detectó algo que debía detectar en este criterio.</p></div>;
  return <div className="cia-finding"><strong>{rowTitle(row)}</strong><span className="status">{row.estado || row.cumple_consideracion}</span>
    {row.observacion?<p>{row.observacion}</p>:null}{row.literal?<blockquote>{row.literal}</blockquote>:null}</div>;
}

function NewRequest({onCreated,onClose,onError}:{onCreated:(id:string)=>void;onClose:()=>void;onError:(m:string)=>void}){
  const [autor,setAutor]=useAuthor(),[descripcion,setDescripcion]=useState(''),[esperado,setEsperado]=useState(''),[finding,setFinding]=useState<FindingRef>(emptyFinding),[busy,setBusy]=useState(false);
  async function create(){
    setBusy(true);
    try{const {id}=await post<{id:string}>('/config-ia/requests',{autor,descripcion,esperado,...finding});onCreated(id);}catch(e){onError((e as Error).message);}finally{setBusy(false);}
  }
  return <Modal title="Nueva solicitud de mejora" onClose={onClose}><div className="cia-form">
    <AuthorField value={autor} onChange={setAutor}/>
    <HallazgoPicker value={finding} onChange={setFinding} onError={onError}/>
    <label className="cia-field">¿Qué está mal?<textarea value={descripcion} onChange={e=>setDescripcion(e.target.value)} placeholder="Describe por qué el resultado no es correcto."/></label>
    <label className="cia-field">¿Qué esperabas?<textarea value={esperado} onChange={e=>setEsperado(e.target.value)} placeholder="Cómo debería haberlo evaluado la IA."/></label>
    <button className="primary" disabled={busy||!autor.trim()||!descripcion.trim()||!findingReady(finding)} onClick={()=>void create()}>Crear solicitud</button>
  </div></Modal>;
}

export function RequestDetailModal({id,onClose,onOpenPlayground,onChanged,onError}:{id:string;onClose:()=>void;onOpenPlayground:(id:string)=>void;onChanged:()=>void;onError:(m:string)=>void}){
  const [detail,setDetail]=useState<RequestDetail|null>(null),[autor,setAutor]=useAuthor(),[rejecting,setRejecting]=useState(false),[motivo,setMotivo]=useState(''),[busy,setBusy]=useState(false);
  const load=useCallback(()=>api<RequestDetail>(`/config-ia/requests/${id}`).then(setDetail).catch(e=>onError(e.message)),[id,onError]);
  useEffect(()=>{void load();},[load]);
  async function act(fn:()=>Promise<unknown>){setBusy(true);try{await fn();await load();onChanged();}catch(e){onError((e as Error).message);}finally{setBusy(false);}}
  if(!detail)return <Modal title="Solicitud" onClose={onClose}><p className="muted">Cargando…</p></Modal>;
  const closed=['publicada','rechazada'].includes(detail.estado);
  return <Modal title={`Solicitud #${detail.numero}`} onClose={onClose}><div className="cia-form">
    <div className="detail-tags"><StateBadge estado={detail.estado}/><span className="code">{detail.requerimiento_codigo}</span><span className="type-tag">{detail.criterio_nombre}</span><span>{detail.autor} · {formatDate(detail.created_at)}</span></div>
    <div><h4>Qué está mal</h4><p>{detail.descripcion}</p>{detail.esperado?<><h4>Qué se esperaba</h4><p>{detail.esperado}</p></>:null}{detail.motivo_rechazo?<p className="cia-hint">Rechazada: {detail.motivo_rechazo}</p>:null}</div>
    <div><h4>Resultado original</h4><FindingCard row={detail.fila_copia}/></div>
    {!closed?<AuthorField value={autor} onChange={setAutor}/>:null}
    <DraftEditor detail={detail} autor={autor} onSaved={d=>{setDetail(d);onChanged();}} onError={onError}/>
    {detail.pruebas.length?<div><h4>Pruebas</h4><ul className="cia-rule-list">{detail.pruebas.map(t=><li key={t.id}>{formatDate(t.created_at)} · <span className="status">{t.estado==='complete'?'Completada':t.estado==='partial'?'Parcial':'En curso'}</span>{t.exploratoria?<span className="type-tag">Exploratoria</span>:null}{t.veredicto?<StateBadge estado={t.veredicto}/>:null}{t.revisor?` ${t.revisor}`:''}{t.comentario?` — ${t.comentario}`:''}</li>)}</ul></div>:null}
    {!closed?<div className="cia-actions">
      <button className="secondary" onClick={()=>onOpenPlayground(detail.id)}><FlaskConical size={15}/>Probar en el playground</button>
      <button className="primary" disabled={busy||!detail.publicacion.ok||!autor.trim()} onClick={()=>void act(()=>post(`/config-ia/requests/${detail.id}/publish`,{autor}))}><Upload size={15}/>Publicar como v{detail.produccion_numero+1}</button>
      <button className="text-button" onClick={()=>setRejecting(v=>!v)}><XCircle size={14}/>Rechazar</button>
    </div>:null}
    {!closed&&!detail.publicacion.ok&&detail.publicacion.motivo?<p className="cia-hint">Para publicar: {detail.publicacion.motivo}</p>:null}
    {rejecting&&!closed?<div className="cia-rule-form"><label className="cia-field">Motivo del rechazo<input value={motivo} onChange={e=>setMotivo(e.target.value)}/></label><button className="secondary" disabled={busy||!motivo.trim()||!autor.trim()} onClick={()=>void act(()=>post(`/config-ia/requests/${detail.id}/reject`,{autor,motivo}))}>Confirmar rechazo</button></div>:null}
    <div><h4>Actividad</h4><ol className="cia-timeline">{detail.eventos.map((e,i)=><li key={i}>{eventLabels[e.tipo] ?? e.tipo} · {e.autor} · {formatDate(e.created_at)}</li>)}</ol></div>
  </div></Modal>;
}

export function RequestsTab({revision,onOpenPlayground,onChanged,onError}:{revision:number;onOpenPlayground:(id:string)=>void;onChanged:()=>void;onError:(m:string)=>void}){
  const [rows,setRows]=useState<RequestRow[]>([]),[creating,setCreating]=useState(false),[open,setOpen]=useState<string|null>(null);
  useEffect(()=>{api<RequestRow[]>('/config-ia/requests').then(setRows).catch(e=>onError(e.message));},[revision,onError]);
  return <div className="cia-tab">
    <div className="cia-draft-head"><p className="muted">Registra aquí los resultados que no te parecen correctos. Cada solicitud tiene su propio borrador de reglas para probar y publicar.</p><button className="primary" onClick={()=>setCreating(true)}><Plus size={15}/>Nueva solicitud</button></div>
    {rows.length?<div className="table-scroll"><table><thead><tr><th>#</th><th>Qué está mal</th><th>Req.</th><th>Criterio</th><th>Autor</th><th>Fecha</th><th>Estado</th></tr></thead><tbody>
      {rows.map(r=><tr key={r.id}><td><button className="code code-button" aria-label={`Abrir solicitud ${r.numero}`} onClick={()=>setOpen(r.id)}>#{r.numero}</button></td><td className="cia-rule-text">{r.descripcion}</td><td><span className="code">{r.requerimiento_codigo}</span></td><td>{criterioName(r.criterio_id)}</td><td>{r.autor}</td><td>{formatDate(r.created_at)}</td><td><StateBadge estado={r.estado_visible}/></td></tr>)}
    </tbody></table></div>:<Empty title="Sin solicitudes" text="Cuando un hallazgo no sea correcto, crea una solicitud y ligala a ese resultado."/>}
    {creating?<NewRequest onClose={()=>setCreating(false)} onError={onError} onCreated={id=>{setCreating(false);setOpen(id);onChanged();}}/>:null}
    {open?<RequestDetailModal id={open} onClose={()=>setOpen(null)} onChanged={onChanged} onError={onError} onOpenPlayground={id=>{setOpen(null);onOpenPlayground(id);}}/>:null}
  </div>;
}
