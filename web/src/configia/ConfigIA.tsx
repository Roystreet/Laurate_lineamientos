import {useCallback,useEffect,useState} from 'react';
import {api,Empty} from '../ui';
import {formatDate,type Version} from './types';
import {RulesTab} from './RulesTab';
import {HistoryTab} from './HistoryTab';
import {RequestsTab} from './RequestsTab';
import './configia.css';

type Tab='rules'|'requests'|'playground'|'history';
const tabs:{key:Tab;label:string}[]=[{key:'rules',label:'Reglas'},{key:'requests',label:'Solicitudes'},{key:'playground',label:'Playground'},{key:'history',label:'Historial'}];

export function ConfigIA({onError}:{onError:(message:string)=>void}){
  const [tab,setTab]=useState<Tab>('rules'),[playgroundFor,setPlaygroundFor]=useState<string|null>(null),[revision,setRevision]=useState(0),[production,setProduction]=useState<Version|null>(null);
  const refresh=useCallback(()=>setRevision(v=>v+1),[]);
  useEffect(()=>{api<Version[]>('/config-ia/versions').then(v=>setProduction(v[0] ?? null)).catch(e=>onError(e.message));},[revision,onError]);
  return <section className="panel cia" data-tour="config-tabs">
    <div className="panel-heading cia-heading">
      <div className="tabs" role="tablist" aria-label="Secciones de Config IA">{tabs.map(t=><button key={t.key} role="tab" aria-selected={tab===t.key} className={tab===t.key?'active':''} onClick={()=>setTab(t.key)}>{t.label}</button>)}</div>
      {production?<span className="cia-production">Versión en producción: <strong>v{production.numero}</strong> · publicada {formatDate(production.created_at)} por {production.publicado_por}</span>:null}
    </div>
    {tab==='rules'?<RulesTab revision={revision} onError={onError}/>:null}
    {tab==='requests'?<RequestsTab revision={revision} onChanged={refresh} onError={onError} onOpenPlayground={id=>{setPlaygroundFor(id);setTab('playground');}}/>:null}
    {tab==='playground'?<Empty title="Playground" text={playgroundFor?'Disponible en la siguiente entrega.':'Abre una solicitud y pulsa Probar en el playground.'}/>:null}
    {tab==='history'?<HistoryTab revision={revision} onPublished={refresh} onError={onError}/>:null}
  </section>;
}
