import {useEffect,useState} from 'react';
import {History} from 'lucide-react';
import {api,Empty,Modal} from '../ui';
import {CRITERIOS,criterioName,ruleStateLabels,changeLabels,formatDate,type RuleRow,type HistoryEntry} from './types';

export function CriteriaChips({ids}:{ids:number[]}){
  return <span className="cia-chips">{ids.map(id=><span className="mini-tag" key={id}>{criterioName(id)}</span>)}</span>;
}

export function RulesTab({revision,onError}:{revision:number;onError:(message:string)=>void}){
  const [rules,setRules]=useState<RuleRow[]>([]),[criterio,setCriterio]=useState(''),[estado,setEstado]=useState(''),[q,setQ]=useState('');
  const [history,setHistory]=useState<{codigo:string;rows:HistoryEntry[]}|null>(null);
  useEffect(()=>{
    const params=new URLSearchParams({...(criterio?{criterio}:{}),...(estado?{estado}:{}),...(q.trim()?{q:q.trim()}:{})});
    api<RuleRow[]>(`/config-ia/rules?${params}`).then(setRules).catch(e=>onError(e.message));
  },[criterio,estado,q,revision,onError]);
  async function openHistory(codigo:string){
    try{setHistory({codigo,rows:await api<HistoryEntry[]>(`/config-ia/rules/${codigo}/history`)});}catch(e){onError((e as Error).message);}
  }
  return <div className="cia-tab">
    <p className="muted">Estas reglas se suman a las instrucciones de la IA en los criterios indicados. Las reglas se crean y cambian desde una solicitud.</p>
    <div className="cia-filters">
      <select aria-label="Filtrar por criterio" value={criterio} onChange={e=>setCriterio(e.target.value)}><option value="">Todos los criterios</option>{CRITERIOS.map((name,i)=><option key={name} value={i+1}>{name}</option>)}</select>
      <select aria-label="Filtrar por estado" value={estado} onChange={e=>setEstado(e.target.value)}><option value="">Todos los estados</option>{Object.entries(ruleStateLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select>
      <input className="search" aria-label="Buscar reglas" placeholder="Buscar en el texto…" value={q} onChange={e=>setQ(e.target.value)}/>
    </div>
    {rules.length?<div className="table-scroll"><table><thead><tr><th>Regla</th><th>Texto</th><th>Criterios</th><th>Estado</th><th>Desde</th><th/></tr></thead><tbody>
      {rules.map(r=><tr key={r.codigo}><td><span className="code">{r.codigo}</span></td><td className="cia-rule-text">{r.texto}</td><td><CriteriaChips ids={r.criterios}/></td><td><span className={'status cia-rule-'+r.estado}>{ruleStateLabels[r.estado]}</span></td><td>{r.desde?`v${r.desde}`:'—'}</td><td><button className="text-button" aria-label={`Historial de ${r.codigo}`} onClick={()=>void openHistory(r.codigo)}><History size={14}/>Historial</button></td></tr>)}
    </tbody></table></div>:<Empty title="Sin reglas" text="Todavía no hay reglas con estos filtros. Las reglas nacen de una solicitud de mejora."/>}
    {history?<Modal title={`Historial de ${history.codigo}`} onClose={()=>setHistory(null)}>
      {history.rows.length?<ol className="cia-timeline">{history.rows.map((h,i)=><li key={i}><strong>{changeLabels[h.accion] ?? h.accion} en v{h.version_numero}</strong> · {h.autor} · {formatDate(h.created_at)}{h.solicitud_numero?` · Solicitud #${h.solicitud_numero}`:''}
        {h.motivo?<p>{h.motivo}</p>:null}<p className="cia-quote">{h.despues.texto}</p><CriteriaChips ids={h.despues.criterios}/></li>)}</ol>:<p className="muted">Esta regla aún no se ha publicado.</p>}
    </Modal>:null}
  </div>;
}
