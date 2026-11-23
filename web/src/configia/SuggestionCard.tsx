import {useState} from 'react';
import {Check,Pencil,RefreshCw,Trash2} from 'lucide-react';
import {CRITERIOS,type ApproveBody,type Clash,type Suggestion,type SuggestionWarning} from './types';
import {CriteriaChips} from './RulesTab';

const clashVerb:Record<Clash['tipo'],string>={contradice:'Contradice a',duplica:'Repite a',se_solapa:'Se solapa con'};
const warningLabels:Record<SuggestionWarning['tipo'],string>={
  contradice_texto_base:'Ojo: esto contradice una regla fija del análisis',
  hallazgo_parece_correcto:'Ojo: el resultado original parece correcto',
  problema_de_entrada:'Parece un problema de lectura del documento, no de las instrucciones',
  criterio_distinto:'Revisa los criterios',
  otra:'Ojo',
};
const clashOrigin=(c:Clash)=>c.origen==='produccion'?'(producción)':c.origen==='esta_solicitud'?'(este borrador)':`(borrador #${c.solicitud_numero})`;

type EditForm={texto:string;criterios:number[];motivo:string};

/** Regla que la IA sugiere para la solicitud: se aprueba (o se ajusta) opción por opción y pasa al borrador. */
export function SuggestionCard({value,closed,draftDirty,autor,onRequest,onApprove,onDiscard}:{value:Suggestion;closed:boolean;draftDirty:boolean;autor:string;onRequest:(indicacion:string)=>Promise<void>;onApprove:(body:ApproveBody)=>Promise<void>;onDiscard:()=>Promise<void>}){
  const [indicacion,setIndicacion]=useState(''),[form,setForm]=useState<EditForm|null>(null),[busy,setBusy]=useState(false);
  const run=async(fn:()=>Promise<void>)=>{setBusy(true);try{await fn();}finally{setBusy(false);}};
  const proposal=value.propuesta;
  const approved=(opcion:string)=>value.aprobaciones.some(a=>a.opcion===opcion);
  const canApprove=['lista','aprobada'].includes(value.estado)&&!value.desactualizada&&!closed;
  const blocked=busy||draftDirty||!autor.trim();
  const approve=(body:Omit<ApproveBody,'autor'>)=>run(async()=>{await onApprove({autor,...body});setForm(null);});
  const toApprove=(c:Clash)=>c.tipo==='contradice'&&c.ajuste&&!approved(c.codigo)?c:null;
  const pending=approved('regla_nueva')?proposal?.choques.map(toApprove).filter(Boolean) as Clash[]|undefined:undefined;

  return <div className="cia-suggestion">
    <div className="cia-draft-head"><h4>Regla sugerida por IA</h4>{value.estado==='aprobada'?<span className="cia-badge ia">Aprobada</span>:null}</div>
    {value.estado==='generando'?<p className="muted" role="status">Generando sugerencia…</p>:null}
    {value.estado==='error'?<p className="cia-hint">{value.error ?? 'No se pudo generar la sugerencia.'}</p>:null}
    {value.desactualizada?<p className="cia-hint">Producción cambió; pide otra sugerencia.</p>:null}
    {proposal?<>
      <p>Entendí: {proposal.entendimiento}</p>
      {proposal.advertencias.map((w,i)=><p key={i} className="cia-warning"><strong>{warningLabels[w.tipo]}.</strong> {w.explicacion}</p>)}
      <div className="cia-option">
        <div className="cia-option-head"><strong>Regla nueva</strong>{proposal.recomendacion==='regla_nueva'?<span className="cia-badge nueva">Recomendada</span>:null}{approved('regla_nueva')?<span className="cia-badge agregada">Aprobada</span>:null}</div>
        <p className="cia-quote">{proposal.regla.texto}</p><CriteriaChips ids={proposal.regla.criterios}/>
        <p className="muted">{proposal.regla.motivo}</p>
        {canApprove&&!approved('regla_nueva')?<div className="cia-actions">
          <button className="primary small" disabled={blocked} onClick={()=>void approve({opcion:'regla_nueva'})}><Check size={14}/>Aprobar</button>
          <button className="secondary small" disabled={blocked} onClick={()=>setForm({texto:proposal.regla.texto,criterios:proposal.regla.criterios,motivo:proposal.regla.motivo})}><Pencil size={14}/>Editar y aprobar</button>
        </div>:null}
        {form&&canApprove?<div className="cia-rule-form">
          <label className="cia-field">Texto sugerido<textarea value={form.texto} onChange={e=>setForm({...form,texto:e.target.value})}/></label>
          <fieldset className="cia-criteria"><legend>Se aplica a</legend>{CRITERIOS.map((name,i)=><label key={name}><input type="checkbox" checked={form.criterios.includes(i+1)} onChange={e=>setForm({...form,criterios:e.target.checked?[...form.criterios,i+1].sort():form.criterios.filter(c=>c!==i+1)})}/>{name}</label>)}</fieldset>
          <label className="cia-field">Motivo sugerido<input value={form.motivo} onChange={e=>setForm({...form,motivo:e.target.value})}/></label>
          <div className="cia-actions"><button className="primary small" disabled={blocked||!form.texto.trim()||!form.criterios.length||!form.motivo.trim()} onClick={()=>void approve({opcion:'regla_nueva',texto:form.texto.trim(),criterios:form.criterios,motivo:form.motivo.trim()})}>Confirmar aprobación</button><button className="text-button" onClick={()=>setForm(null)}>Cancelar</button></div>
        </div>:null}
      </div>
      {proposal.choques.map(c=><div className="cia-option" key={c.codigo}>
        <div className="cia-option-head"><strong>{clashVerb[c.tipo]}</strong><span className="code">{c.codigo}</span><span className="muted">{clashOrigin(c)}</span>{proposal.recomendacion===c.codigo?<span className="cia-badge nueva">Recomendada</span>:null}{approved(c.codigo)?<span className="cia-badge agregada">Aprobada</span>:null}</div>
        <p>{c.explicacion}</p>
        {c.ajuste?<>
          {c.origen==='esta_solicitud'?<p className="muted">Reemplaza {c.codigo} en el borrador</p>:null}
          <p className="cia-quote">{c.ajuste.texto}</p><CriteriaChips ids={c.ajuste.criterios}/><p className="muted">{c.ajuste.motivo}</p>
          {canApprove&&!approved(c.codigo)?<div className="cia-actions"><button className="primary small" aria-label={`Aprobar ajuste de ${c.codigo}`} disabled={blocked} onClick={()=>void approve({opcion:c.codigo})}><Check size={14}/>Aprobar ajuste</button></div>:null}
        </>:null}
      </div>)}
      {pending?.map(c=><p key={c.codigo} className="cia-hint">{c.codigo} ordena lo contrario; considera aprobar el ajuste.</p>)}
      {canApprove&&draftDirty?<p className="cia-hint">Guarda o descarta los cambios del borrador antes de aprobar.</p>:null}
    </>:null}
    {!closed&&value.estado!=='generando'?<div className="cia-rule-form">
      <label className="cia-field">Indicación para la IA (opcional)<input aria-label="Indicación para la IA (opcional)" value={indicacion} onChange={e=>setIndicacion(e.target.value)} placeholder="Ej.: hazla más específica."/></label>
      <div className="cia-actions">
        <button className="secondary small" disabled={busy||!autor.trim()} onClick={()=>void run(async()=>{await onRequest(indicacion.trim());setIndicacion('');})}><RefreshCw size={14}/>Pedir otra</button>
        {value.estado==='lista'?<button className="text-button" disabled={busy||!autor.trim()} onClick={()=>void run(onDiscard)}><Trash2 size={13}/>Descartar</button>:null}
      </div>
    </div>:null}
  </div>;
}
