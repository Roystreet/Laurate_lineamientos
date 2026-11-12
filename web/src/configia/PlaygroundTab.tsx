import {useCallback,useEffect,useState} from 'react';
import {Play,Plus,X,Upload,RefreshCw,Check} from 'lucide-react';
import {api,post,Empty} from '../ui';
import type {Req} from '../types';
import {CRITERIOS,criterioName,formatDate,type CaseRun,type RequestDetail,type RequestRow,type TestDetail,type Version} from './types';
import {AuthorField,useAuthor} from './AuthorField';
import {CriteriaChips} from './RulesTab';
import {StateBadge} from './RequestsTab';
import {SideBySide} from './SideBySide';

type CaseRef={requerimientoId:string;ejecucionId:string;codigo:string};
const ACTIVE=['queued','running'];

export function PlaygroundTab({solicitudId,onSelect,onChanged,onError}:{solicitudId:string|null;onSelect:(id:string)=>void;onChanged:()=>void;onError:(m:string)=>void}){
  const [open,setOpen]=useState<RequestRow[]>([]),[detail,setDetail]=useState<RequestDetail|null>(null),[versions,setVersions]=useState<Version[]>([]),[reqs,setReqs]=useState<Req[]>([]);
  const [compare,setCompare]=useState<number|null>(null),[off,setOff]=useState<string[]>([]),[controls,setControls]=useState<CaseRef[]>([]),[criterios,setCriterios]=useState<number[]>([]),[addReq,setAddReq]=useState('');
  const [testId,setTestId]=useState<string|null>(null),[test,setTest]=useState<TestDetail|null>(null),[autor,setAutor]=useAuthor(),[comentario,setComentario]=useState(''),[busy,setBusy]=useState(false);

  useEffect(()=>{
    Promise.all([api<RequestRow[]>('/config-ia/requests'),api<Version[]>('/config-ia/versions'),api<Req[]>('/requirements')])
      .then(([rows,v,r])=>{setOpen(rows.filter(x=>!['publicada','rechazada'].includes(x.estado)));setVersions(v);setReqs(r);}).catch(e=>onError(e.message));
  },[onError]);
  const loadRequest=useCallback(async()=>{
    if(!solicitudId){setDetail(null);return;}
    try{const d=await api<RequestDetail>(`/config-ia/requests/${solicitudId}`);setDetail(d);return d;}catch(e){onError((e as Error).message);}
  },[solicitudId,onError]);
  useEffect(()=>{void loadRequest().then(d=>{
    setOff([]);setControls([]);setCompare(null);setTest(null);
    setCriterios(d?(d.borrador.criterios_tocados.length?d.borrador.criterios_tocados:[d.criterio_id]):[]);
    setTestId(d?.pruebas[0]?.id ?? null);
  });},[loadRequest]);
  useEffect(()=>{
    if(!testId){setTest(null);return;}
    let timer:ReturnType<typeof setTimeout>|undefined,stopped=false;
    const tick=async()=>{try{const t=await api<TestDetail>(`/config-ia/tests/${testId}`);if(stopped)return;setTest(t);if(ACTIVE.includes(t.estado))timer=setTimeout(()=>void tick(),3000);else void loadRequest();}catch(e){onError((e as Error).message);}};
    void tick();return()=>{stopped=true;clearTimeout(timer);};
  },[testId,onError,loadRequest]);

  if(!solicitudId||!detail)return <div className="cia-tab">
    <p className="muted">Elige la solicitud cuyo borrador quieres probar.</p>
    {open.length?<select aria-label="Solicitud a probar" value="" onChange={e=>onSelect(e.target.value)}><option value="">Selecciona una solicitud…</option>{open.map(r=><option key={r.id} value={r.id}>#{r.numero} · {r.requerimiento_codigo} · {r.descripcion.slice(0,60)}</option>)}</select>
      :<Empty title="No hay solicitudes abiertas" text="Crea una solicitud en la pestaña Solicitudes para probar un cambio."/>}
  </div>;

  const production=versions[0]?.numero ?? detail.produccion_numero,compareWith=compare ?? production;
  const origin:CaseRef={requerimientoId:detail.requerimiento_id,ejecucionId:detail.ejecucion_id,codigo:detail.requerimiento_codigo};
  const cases=[origin,...controls],exploratory=off.length>0||compareWith!==production;
  const closed=['publicada','rechazada'].includes(detail.estado);
  async function addControl(){
    const req=reqs.find(r=>r.id===addReq);if(!req)return;
    try{const runs=await api<CaseRun[]>(`/config-ia/cases?requirementId=${encodeURIComponent(req.id)}`);
      if(!runs.length){onError(`${req.codigo} todavía no tiene análisis.`);return;}
      setControls(cs=>[...cs,{requerimientoId:req.id,ejecucionId:runs[0].ejecucion_id,codigo:req.codigo}]);setAddReq('');}catch(e){onError((e as Error).message);}
  }
  async function act(fn:()=>Promise<unknown>){setBusy(true);try{await fn();}catch(e){onError((e as Error).message);}finally{setBusy(false);}}
  const run=()=>act(async()=>{
    const {id}=await post<{id:string}>('/config-ia/tests',{solicitudId:detail.id,autor,criterios,apagadas:off,casos:cases.map(c=>({requerimientoId:c.requerimientoId,ejecucionId:c.ejecucionId})),...(compareWith!==production?{compararConNumero:compareWith}:{})});
    setTestId(id);onChanged();
  });
  const verdict=(veredicto:'funciono'|'no_funciono')=>act(async()=>{setTest(await post<TestDetail>(`/config-ia/tests/${test!.id}/verdict`,{revisor:autor,veredicto,comentario}));await loadRequest();onChanged();});
  const publish=()=>act(async()=>{await post(`/config-ia/requests/${detail.id}/publish`,{autor});await loadRequest();onChanged();});

  return <div className="cia-tab">
    <div className="cia-draft-head"><div><h4>Solicitud #{detail.numero} · {detail.requerimiento_codigo} · {detail.criterio_nombre}</h4><p className="muted">{detail.descripcion}</p></div><StateBadge estado={detail.estado}/></div>
    {!closed?<div className="cia-setup">
      <label className="cia-field">Comparar<select aria-label="Versión a comparar" value={compareWith} onChange={e=>setCompare(Number(e.target.value))}>{versions.map(v=><option key={v.numero} value={v.numero}>{v.numero===production?`Producción v${v.numero}`:`v${v.numero}`}</option>)}</select><small>contra el borrador de la solicitud</small></label>
      <fieldset className="cia-criteria cia-block"><legend>Reglas del borrador</legend>{detail.borrador.reglas.length?detail.borrador.reglas.map(r=><label key={r.codigo} className={r.activa?'':'inactive'}><input type="checkbox" disabled={!r.activa} checked={r.activa&&!off.includes(r.codigo)} onChange={e=>setOff(o=>e.target.checked?o.filter(c=>c!==r.codigo):[...o,r.codigo])}/><span className="code">{r.codigo}</span>{r.texto}<CriteriaChips ids={r.criterios}/></label>):<span className="muted">Sin reglas.</span>}</fieldset>
      <div className="cia-block"><span className="cia-label">Casos</span><ul className="cia-cases">{cases.map((c,i)=><li key={c.requerimientoId}>{i===0?'★ ':''}<span className="code">{c.codigo}</span>{i===0?<span className="type-tag">Origen</span>:<button className="icon-button" aria-label={`Quitar ${c.codigo}`} onClick={()=>setControls(cs=>cs.filter(x=>x!==c))}><X size={14}/></button>}</li>)}</ul>
        {cases.length<10?<div className="cia-actions"><select aria-label="Agregar requerimiento de control" value={addReq} onChange={e=>setAddReq(e.target.value)}><option value="">Agregar requerimiento de control…</option>{reqs.filter(r=>!cases.some(c=>c.requerimientoId===r.id)).map(r=><option key={r.id} value={r.id}>{r.codigo}</option>)}</select><button className="secondary small" disabled={!addReq} onClick={()=>void addControl()}><Plus size={14}/>Agregar</button></div>:null}</div>
      <fieldset className="cia-criteria cia-block"><legend>Criterios a ejecutar</legend>{CRITERIOS.map((name,i)=><label key={name}><input type="checkbox" checked={criterios.includes(i+1)} onChange={e=>setCriterios(cs=>e.target.checked?[...cs,i+1].sort():cs.filter(c=>c!==i+1))}/>{name}</label>)}</fieldset>
      {exploratory?<p className="cia-warning">Prueba exploratoria: no habilita publicar.</p>:null}
      <AuthorField value={autor} onChange={setAutor}/>
      <div className="cia-actions"><button className="primary" disabled={busy||!autor.trim()||!criterios.length||detail.borrador.conflictos.length>0} onClick={()=>void run()}><Play size={15}/>Ejecutar prueba</button>{detail.borrador.conflictos.length?<span className="cia-hint">Resuelve los conflictos del borrador antes de probar.</span>:null}</div>
    </div>:null}
    {detail.pruebas.length>1?<label className="cia-field">Ver prueba<select aria-label="Prueba" value={testId ?? ''} onChange={e=>setTestId(e.target.value)}>{detail.pruebas.map(t=><option key={t.id} value={t.id}>{formatDate(t.created_at)}{t.exploratoria?' · exploratoria':''}{t.veredicto?` · ${t.veredicto==='funciono'?'Funcionó':'No funcionó'}`:''}</option>)}</select></label>:null}
    {test?<div className="cia-result">
      <div className="cia-draft-head"><h4>Resultado {test.exploratoria?'(exploratoria)':''}</h4><span className="cia-meta">{test.progreso.listos}/{test.progreso.total} listos{test.progreso.errores?` · ${test.progreso.errores} con error`:''} · criterios: {test.criterios.map(criterioName).join(', ')}</span></div>
      {ACTIVE.includes(test.estado)?<p className="muted">{test.en_espera?'En espera: hay un análisis en curso.':'Ejecutando la prueba…'}</p>:null}
      {test.tareas.map(t=><div key={t.id} className="cia-warning">{t.error}<button className="text-button" onClick={()=>void act(async()=>{await post(`/tasks/${t.id}/retry`);setTestId(null);setTimeout(()=>setTestId(test.id),0);})}><RefreshCw size={13}/>Reintentar</button></div>)}
      <SideBySide detail={test}/>
      {!ACTIVE.includes(test.estado)?<div className="cia-decision">
        {test.veredicto?<p>Veredicto: <StateBadge estado={test.veredicto}/> {test.revisor}{test.comentario?` — ${test.comentario}`:''}</p>:null}
        {!closed?<><AuthorField value={autor} onChange={setAutor} label="Revisado por"/>
        <label className="cia-field">Comentario<input value={comentario} onChange={e=>setComentario(e.target.value)} placeholder="Opcional"/></label>
        <div className="cia-actions"><button className="secondary" disabled={busy||!autor.trim()} onClick={()=>void verdict('funciono')}><Check size={15}/>Funcionó</button><button className="secondary" disabled={busy||!autor.trim()} onClick={()=>void verdict('no_funciono')}><X size={15}/>No funcionó</button>
          {detail.publicacion.ok?<button className="primary" disabled={busy||!autor.trim()} onClick={()=>void publish()}><Upload size={15}/>Publicar como v{detail.produccion_numero+1}</button>:detail.publicacion.motivo?<span className="cia-hint">Para publicar: {detail.publicacion.motivo}</span>:null}</div></>:null}
      </div>:null}
    </div>:null}
  </div>;
}
