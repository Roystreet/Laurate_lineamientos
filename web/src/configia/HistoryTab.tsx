import {useEffect,useState} from 'react';
import {RotateCcw,Eye} from 'lucide-react';
import {api,post,Modal} from '../ui';
import {changeLabels,formatDate,type Version} from './types';
import {AuthorField,useAuthor} from './AuthorField';
import {CriteriaChips} from './RulesTab';

const origin=(v:Version)=>v.origen==='solicitud'?`Solicitud #${v.solicitud_numero}`:v.origen==='reversion'?`Reversión a v${v.revertida_de}`:'Versión inicial';

export function HistoryTab({revision,onPublished,onError}:{revision:number;onPublished:()=>void;onError:(message:string)=>void}){
  const [versions,setVersions]=useState<Version[]>([]),[view,setView]=useState<Version|null>(null),[revert,setRevert]=useState<Version|null>(null);
  const [autor,setAutor]=useAuthor(),[motivo,setMotivo]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{api<Version[]>('/config-ia/versions').then(setVersions).catch(e=>onError(e.message));},[revision,onError]);
  async function republish(){
    if(!revert)return;setBusy(true);
    try{await post(`/config-ia/versions/${revert.numero}/republish`,{autor,motivo});setRevert(null);setMotivo('');onPublished();}
    catch(e){onError((e as Error).message);}finally{setBusy(false);}
  }
  return <div className="cia-tab">
    <ol className="cia-versions">{versions.map((v,i)=><li key={v.numero} className={i===0?'current':''}>
      <div className="cia-version-head"><span className="code">v{v.numero}</span>{i===0?<span className="status complete">En producción</span>:null}<span>{formatDate(v.created_at)} · {v.publicado_por}</span><span className="type-tag">{origin(v)}</span><span className="cia-meta">{v.analisis} análisis</span></div>
      {v.motivo?<p className="cia-motivo">{v.motivo}</p>:null}
      {v.cambios.length?<ul className="cia-changes">{v.cambios.map(c=><li key={c.codigo}><span className={'cia-badge '+c.accion}>{changeLabels[c.accion]}</span><span className="code">{c.codigo}</span>{c.despues.texto}</li>)}</ul>:<p className="muted">Sin reglas adicionales respecto de la versión anterior.</p>}
      <div className="cia-actions"><button className="text-button" onClick={()=>setView(v)}><Eye size={14}/>Ver reglas</button>{i>0?<button className="text-button" onClick={()=>setRevert(v)}><RotateCcw size={14}/>Volver a esta versión</button>:null}</div>
    </li>)}</ol>
    {view?<Modal title={`Reglas de v${view.numero}`} onClose={()=>setView(null)}>
      {view.reglas.length?<ul className="cia-rule-list">{view.reglas.map(r=><li key={r.codigo} className={r.activa?'':'inactive'}><span className="code">{r.codigo}</span> {r.texto} <CriteriaChips ids={r.criterios}/>{r.activa?null:<span className="status">Inactiva</span>}</li>)}</ul>:<p className="muted">Esta versión usa solo las instrucciones base, sin reglas adicionales.</p>}
    </Modal>:null}
    {revert?<Modal title={`Volver a v${revert.numero}`} onClose={()=>setRevert(null)}>
      <p className="muted">Se publicará una nueva versión con las mismas reglas que v{revert.numero}. Los próximos análisis la usarán y los borradores abiertos tendrán que volver a probarse.</p>
      <div className="cia-form"><AuthorField value={autor} onChange={setAutor}/><label className="cia-field">Motivo<textarea value={motivo} onChange={e=>setMotivo(e.target.value)} placeholder="¿Por qué vuelves a esta versión?"/></label>
      <button className="primary" disabled={busy||!autor.trim()||!motivo.trim()} onClick={()=>void republish()}>Publicar como nueva versión</button></div>
    </Modal>:null}
  </div>;
}
