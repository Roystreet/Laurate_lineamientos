import {useEffect,useState} from 'react';
import {Plus,Pencil,Power,Undo2,Save} from 'lucide-react';
import {CRITERIOS,put,type Change,type Rule,type RequestDetail} from './types';
import {CriteriaChips} from './RulesTab';

// `index` identifies a not-yet-saved new rule (it has no code until the server assigns one).
type Form={mode:'crear'|'editar'|'activa';index?:number;codigo?:string;texto:string;criterios:number[];activa?:boolean;motivo:string};

function RuleForm({form,onChange,onSubmit,onCancel}:{form:Form;onChange:(f:Form)=>void;onSubmit:()=>void;onCancel:()=>void}){
  const toggle=form.mode==='activa';
  const valid=form.motivo.trim()&&(toggle||(form.texto.trim()&&form.criterios.length));
  return <div className="cia-rule-form">
    {toggle?<p className="muted">{form.activa?'Activar':'Desactivar'} {form.codigo}</p>:<>
      <label className="cia-field">Regla<textarea aria-label="Texto de la regla" value={form.texto} onChange={e=>onChange({...form,texto:e.target.value})} placeholder="Ej.: No exigir firma física en los planes; su validez se verifica por el código y la versión del pie de página."/></label>
      <fieldset className="cia-criteria"><legend>Se aplica a</legend>{CRITERIOS.map((name,i)=><label key={name}><input type="checkbox" checked={form.criterios.includes(i+1)} onChange={e=>onChange({...form,criterios:e.target.checked?[...form.criterios,i+1].sort():form.criterios.filter(c=>c!==i+1)})}/>{name}</label>)}</fieldset>
    </>}
    <label className="cia-field">Motivo del cambio<input aria-label="Motivo del cambio" value={form.motivo} onChange={e=>onChange({...form,motivo:e.target.value})} placeholder="¿Por qué este cambio?"/></label>
    <div className="cia-actions"><button className="primary" disabled={!valid} onClick={onSubmit}>Aplicar al borrador</button><button className="secondary" onClick={onCancel}>Cancelar</button></div>
  </div>;
}

const snapshot=(r:Rule)=>({texto:r.texto,criterios:r.criterios,activa:r.activa});

/** Reglas de producción con los cambios del borrador encima. Cada cambio pide motivo; "Guardar borrador" los envía. */
export function DraftEditor({detail,autor,onSaved,onError}:{detail:RequestDetail;autor:string;onSaved:(d:RequestDetail)=>void;onError:(m:string)=>void}){
  const [cambios,setCambios]=useState<Change[]>(detail.borrador.cambios),[form,setForm]=useState<Form|null>(null),[busy,setBusy]=useState(false);
  useEffect(()=>setCambios(detail.borrador.cambios),[detail]);
  const closed=['publicada','rechazada'].includes(detail.estado);
  const dirty=JSON.stringify(cambios)!==JSON.stringify(detail.borrador.cambios);
  const base=detail.borrador.base.reglas,conflict=(codigo?:string|null)=>detail.borrador.conflictos.find(c=>c.codigo===codigo);
  const changeOf=(codigo:string)=>cambios.find(c=>c.op==='modificar'&&c.codigo===codigo);
  const effective=(r:Rule):Rule=>{const c=changeOf(r.codigo);return c?{...r,...(c.texto!==undefined?{texto:c.texto}:{}),...(c.criterios?{criterios:c.criterios}:{}),...(c.activa!==undefined?{activa:c.activa}:{})}:r;};
  function apply(f:Form){
    if(f.mode==='crear'){
      const next:Change={...(f.index!==undefined?cambios[f.index]:{}),op:'crear',texto:f.texto.trim(),criterios:f.criterios,motivo:f.motivo.trim(),autor};
      setCambios(cs=>f.index!==undefined?cs.map((c,i)=>i===f.index?next:c):[...cs,{...next,codigo:null}]);
    }else{
      const original=base.find(r=>r.codigo===f.codigo)!,prev=changeOf(f.codigo!);
      // `antes` is the production rule this edit was made against. It only moves forward when the user
      // edits a rule whose conflict (and current production text) is on screen.
      const antes=conflict(f.codigo)||!prev?.antes?snapshot(original):prev.antes;
      const next:Change={op:'modificar',codigo:f.codigo,...(prev?.texto!==undefined?{texto:prev.texto}:{}),...(prev?.criterios?{criterios:prev.criterios}:{}),...(prev?.activa!==undefined?{activa:prev.activa}:{}),
        ...(f.mode==='editar'?{texto:f.texto.trim(),criterios:f.criterios}:{activa:f.activa}),antes,motivo:f.motivo.trim(),autor};
      setCambios(cs=>[...cs.filter(c=>c!==prev),next]);
    }
    setForm(null);
  }
  async function save(){
    setBusy(true);
    try{onSaved(await put<RequestDetail>(`/config-ia/requests/${detail.id}/draft`,{autor,cambios}));}catch(e){onError((e as Error).message);}finally{setBusy(false);}
  }
  const created=cambios.map((c,index)=>({c,index})).filter(x=>x.c.op==='crear');
  const formFor=(match:boolean)=>form&&match?<RuleForm form={form} onChange={setForm} onSubmit={()=>apply(form)} onCancel={()=>setForm(null)}/>:null;
  return <div className="cia-draft">
    <div className="cia-draft-head"><h4>Borrador sobre v{detail.borrador.base.numero}</h4>{!closed?<button className="secondary small" onClick={()=>setForm({mode:'crear',texto:'',criterios:[detail.criterio_id],motivo:''})}><Plus size={14}/>Agregar regla</button>:null}</div>
    {formFor(form?.mode==='crear'&&form.index===undefined)}
    <ul className="cia-rule-list">
      {created.map(({c,index})=><li key={c.codigo ?? `nueva-${index}`} className="changed"><span className="cia-badge nueva">Nueva</span>{c.codigo?<span className="code">{c.codigo}</span>:null}<span className="cia-rule-text">{c.texto}</span><CriteriaChips ids={c.criterios ?? []}/>
        {conflict(c.codigo)?<span className="cia-hint">{conflict(c.codigo)!.motivo}</span>:null}
        {!closed?<span className="cia-actions"><button className="text-button" onClick={()=>setForm({mode:'crear',index,texto:c.texto ?? '',criterios:c.criterios ?? [],motivo:c.motivo ?? ''})}><Pencil size={13}/>Editar</button><button className="text-button" onClick={()=>setCambios(cs=>cs.filter((_,i)=>i!==index))}><Undo2 size={13}/>Quitar</button></span>:null}
        {formFor(form?.mode==='crear'&&form.index===index)}</li>)}
      {base.map(original=>{const r=effective(original),c=changeOf(original.codigo),clash=conflict(r.codigo);return <li key={r.codigo} className={(c?'changed ':'')+(r.activa?'':'inactive')}>
        {c?<span className={'cia-badge '+(c.texto!==undefined||c.criterios?'editada':c.activa?'activada':'desactivada')}>{c.texto!==undefined||c.criterios?'Editada':c.activa?'Activada':'Desactivada'}</span>:null}
        <span className="code">{r.codigo}</span><span className="cia-rule-text">{r.texto}</span><CriteriaChips ids={r.criterios}/>{r.activa?null:<span className="status">Inactiva</span>}
        {clash?<span className="cia-hint">{clash.motivo} Producción ahora: “{original.texto}”{original.activa?'':' (inactiva)'}.</span>:null}
        {!closed?<span className="cia-actions">
          <button className="text-button" onClick={()=>setForm({mode:'editar',codigo:r.codigo,texto:r.texto,criterios:r.criterios,motivo:c?.motivo ?? ''})}><Pencil size={13}/>Editar</button>
          <button className="text-button" onClick={()=>setForm({mode:'activa',codigo:r.codigo,texto:r.texto,criterios:r.criterios,activa:!r.activa,motivo:''})}><Power size={13}/>{r.activa?'Desactivar':'Activar'}</button>
          {c?<button className="text-button" onClick={()=>setCambios(cs=>cs.filter(x=>x!==c))}><Undo2 size={13}/>Descartar cambio</button>:null}
        </span>:null}
        {formFor(form?.mode!=='crear'&&form?.codigo===r.codigo)}
      </li>;})}
    </ul>
    {!base.length&&!created.length?<p className="muted">Producción no tiene reglas adicionales. Agrega la primera.</p>:null}
    {!closed?<div className="cia-actions"><button className="primary" disabled={busy||!dirty||!autor.trim()} onClick={()=>void save()}><Save size={15}/>Guardar borrador</button>{dirty?<span className="cia-hint">Hay cambios sin guardar.</span>:null}{!autor.trim()?<span className="cia-hint">Escribe tu nombre para guardar.</span>:null}</div>:null}
  </div>;
}
