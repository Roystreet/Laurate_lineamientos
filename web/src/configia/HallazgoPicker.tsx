import {useEffect,useState} from 'react';
import {api} from '../ui';
import type {Req} from '../types';
import {formatDate,rowTitle,type CaseRun} from './types';

export type FindingRef={requerimientoId:string;ejecucionId:string;criterioId:number|null;filaOrden:number|null|undefined};
export const emptyFinding:FindingRef={requerimientoId:'',ejecucionId:'',criterioId:null,filaOrden:undefined};
export const findingReady=(f:FindingRef)=>Boolean(f.requerimientoId&&f.ejecucionId&&f.criterioId&&f.filaOrden!==undefined);

/** Requerimiento → análisis → criterio → hallazgo (o "falta un hallazgo"). */
export function HallazgoPicker({value,onChange,onError}:{value:FindingRef;onChange:(value:FindingRef)=>void;onError:(message:string)=>void}){
  const [reqs,setReqs]=useState<Req[]>([]),[cases,setCases]=useState<CaseRun[]>([]);
  useEffect(()=>{api<Req[]>('/requirements').then(setReqs).catch(e=>onError(e.message));},[onError]);
  useEffect(()=>{
    if(!value.requerimientoId){setCases([]);return;}
    api<CaseRun[]>(`/config-ia/cases?requirementId=${encodeURIComponent(value.requerimientoId)}`).then(setCases).catch(e=>onError(e.message));
  },[value.requerimientoId,onError]);
  const run=cases.find(c=>c.ejecucion_id===value.ejecucionId),criterion=run?.criterios.find(c=>c.criterio_id===value.criterioId);
  return <div className="cia-picker">
    <label className="cia-field">Requerimiento<select aria-label="Requerimiento del hallazgo" value={value.requerimientoId} onChange={e=>onChange({...emptyFinding,requerimientoId:e.target.value})}>
      <option value="">Selecciona…</option>{reqs.map(r=><option key={r.id} value={r.id}>{r.codigo}</option>)}</select></label>
    {value.requerimientoId?cases.length?<label className="cia-field">Análisis<select aria-label="Análisis del hallazgo" value={value.ejecucionId} onChange={e=>onChange({...value,ejecucionId:e.target.value,criterioId:null,filaOrden:undefined})}>
      <option value="">Selecciona…</option>{cases.map(c=><option key={c.ejecucion_id} value={c.ejecucion_id}>{formatDate(c.created_at)} · {c.reglas_version?`v${c.reglas_version}`:'Anterior a Config IA'}</option>)}</select></label>
      :<p className="cia-hint">Este requerimiento todavía no tiene análisis.</p>:null}
    {run?<label className="cia-field">Criterio<select aria-label="Criterio del hallazgo" value={value.criterioId ?? ''} onChange={e=>onChange({...value,criterioId:Number(e.target.value)||null,filaOrden:undefined})}>
      <option value="">Selecciona…</option>{run.criterios.map(c=><option key={c.criterio_id} value={c.criterio_id}>{c.nombre}</option>)}</select></label>:null}
    {criterion?<fieldset className="cia-rows"><legend>¿Qué resultado está mal?</legend>
      {criterion.filas.map((row,i)=><label key={i} className={'cia-row-option '+(value.filaOrden===i?'selected':'')}><input type="radio" name="fila" checked={value.filaOrden===i} onChange={()=>onChange({...value,filaOrden:i})}/>
        <span><strong>{rowTitle(row)}</strong><small>{row.estado || row.cumple_consideracion}{row.lineamiento?` · ${row.lineamiento}`:''}</small></span></label>)}
      <label className={'cia-row-option '+(value.filaOrden===null?'selected':'')}><input type="radio" name="fila" checked={value.filaOrden===null} onChange={()=>onChange({...value,filaOrden:null})}/><span><strong>Falta un hallazgo en este criterio</strong><small>La IA no detectó algo que debía detectar</small></span></label>
    </fieldset>:null}
  </div>;
}
