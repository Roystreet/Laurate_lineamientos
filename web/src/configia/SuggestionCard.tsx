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
// The same code can clash both as this draft's or production's rule and as another request's rule.
const clashKey=(c:Clash)=>`${c.origen}-${c.codigo}-${c.solicitud_numero ?? ''}`;

type OptionText={texto:string;criterios:number[];motivo:string};
type EditForm=OptionText&{opcion:string};

/** Regla que la IA sugiere para la solicitud: se aprueba (o se ajusta) opción por opción y pasa al borrador. */
export function SuggestionCard({value,closed,draftDirty,autor,onRequest,onApprove,onDiscard}:{value:Suggestion;closed:boolean;draftDirty:boolean;autor:string;onRequest:(indicacion:string)=>Promise<void>;onApprove:(body:ApproveBody)=>Promise<void>;onDiscard:()=>Promise<void>}){
  const [indicacion,setIndicacion]=useState(''),[form,setForm]=useState<EditForm|null>(null),[busy,setBusy]=useState(false);
  // The parent already showed the error; the edit form and the indication stay as the user left them.
  const run=async(fn:()=>Promise<void>)=>{setBusy(true);try{await fn();}catch{/* shown by the parent */}finally{setBusy(false);}};
  const proposal=value.propuesta;
  const approval=(opcion:string)=>value.aprobaciones.find(a=>a.opcion===opcion);
  const canApprove=['lista','aprobada'].includes(value.estado)&&!value.desactualizada&&!closed;
  const blocked=busy||draftDirty||!autor.trim();
  const approve=(body:Omit<ApproveBody,'autor'>)=>run(async()=>{await onApprove({autor,...body});setForm(null);});
  const toApprove=(c:Clash)=>c.tipo==='contradice'&&c.ajuste&&!approval(c.codigo)?c:null;
  const pending=approval('regla_nueva')?proposal?.choques.map(toApprove).filter(Boolean) as Clash[]|undefined:undefined;

  const badges=(opcion:string)=>{const a=approval(opcion);return <>
    {proposal?.recomendacion===opcion?<span className="cia-badge nueva">Recomendada</span>:null}
    {a?<span className="cia-badge agregada">Aprobada</span>:null}{a?.editada?<span className="muted">(editada)</span>:null}
  </>;};
  /** An option as it was approved, or as proposed with its "Aprobar" and "Editar y aprobar" actions. */
  const option=(opcion:string,proposed:OptionText,ajuste:boolean)=>{
    const a=approval(opcion),shown=a ?? proposed;
    return <>
      <p className="cia-quote">{shown.texto}</p><CriteriaChips ids={shown.criterios}/><p className="muted">{shown.motivo}</p>
      {canApprove&&!a?<div className="cia-actions">
        <button className="primary small" aria-label={ajuste?`Aprobar ajuste de ${opcion}`:undefined} disabled={blocked} onClick={()=>void approve({opcion})}><Check size={14}/>{ajuste?'Aprobar ajuste':'Aprobar'}</button>
        <button className="secondary small" aria-label={ajuste?`Editar y aprobar ajuste de ${opcion}`:undefined} disabled={blocked} onClick={()=>setForm({opcion,texto:proposed.texto,criterios:proposed.criterios,motivo:proposed.motivo})}><Pencil size={14}/>Editar y aprobar</button>
      </div>:null}
      {form?.opcion===opcion&&canApprove&&!a?<div className="cia-rule-form">
        <label className="cia-field">Texto sugerido<textarea value={form.texto} onChange={e=>setForm({...form,texto:e.target.value})}/></label>
        <fieldset className="cia-criteria"><legend>Se aplica a</legend>{CRITERIOS.map((name,i)=><label key={name}><input type="checkbox" checked={form.criterios.includes(i+1)} onChange={e=>setForm({...form,criterios:e.target.checked?[...form.criterios,i+1].sort((x,y)=>x-y):form.criterios.filter(c=>c!==i+1)})}/>{name}</label>)}</fieldset>
        <label className="cia-field">Motivo sugerido<input value={form.motivo} onChange={e=>setForm({...form,motivo:e.target.value})}/></label>
        <div className="cia-actions"><button className="primary small" disabled={blocked||!form.texto.trim()||!form.criterios.length||!form.motivo.trim()} onClick={()=>void approve({opcion,texto:form.texto.trim(),criterios:form.criterios,motivo:form.motivo.trim()})}>Confirmar aprobación</button><button className="text-button" onClick={()=>setForm(null)}>Cancelar</button></div>
      </div>:null}
    </>;
  };

  return <div className="cia-suggestion">
    <div className="cia-draft-head"><h4>Regla sugerida por IA</h4>{value.estado==='aprobada'?<span className="cia-badge ia">Aprobada</span>:null}</div>
    {value.estado==='generando'?<p className="muted" role="status">Generando sugerencia…</p>:null}
    {value.estado==='error'?<p className="cia-hint">{value.error ?? 'No se pudo generar la sugerencia.'}</p>:null}
    {value.desactualizada?<p className="cia-hint">{value.estado==='aprobada'?'Producción cambió. Lo que aprobaste sigue en el borrador; para otra opción, pide otra sugerencia.':'Producción cambió; pide otra sugerencia.'}</p>:null}
    {proposal?<>
      <p>Entendí: {proposal.entendimiento}</p>
      {proposal.advertencias.map((w,i)=><p key={i} className="cia-warning"><strong>{warningLabels[w.tipo]}.</strong> {w.explicacion}</p>)}
      <div className="cia-option">
        <div className="cia-option-head"><strong>Regla nueva</strong>{badges('regla_nueva')}</div>
        {option('regla_nueva',proposal.regla,false)}
      </div>
      {proposal.choques.map(c=><div className="cia-option" key={clashKey(c)}>
        <div className="cia-option-head"><strong>{clashVerb[c.tipo]}</strong><span className="code">{c.codigo}</span><span className="muted">{clashOrigin(c)}</span>{c.ajuste?badges(c.codigo):null}</div>
        <p>{c.explicacion}</p>
        {c.ajuste?<>
          {c.origen==='esta_solicitud'?<p className="muted">Reemplaza {c.codigo} en el borrador</p>:null}
          {option(c.codigo,c.ajuste,true)}
        </>:null}
      </div>)}
      {pending?.map(c=><p key={clashKey(c)} className="cia-hint">{c.codigo} ordena lo contrario; considera aprobar el ajuste.</p>)}
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
