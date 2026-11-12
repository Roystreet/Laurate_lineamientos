import {useRef,useState} from 'react';
import {FileText,LoaderCircle,UploadCloud} from 'lucide-react';
import type {Uploaded} from './types';
import {api} from './ui';
export function Uploader({kind,reqId,replaceId,code,onDone,maxMb,maxFiles}:{kind:'ficha'|'evidencia';reqId?:string;replaceId?:string;code?:string;onDone:(files:Uploaded[],hasFailures:boolean)=>void;maxMb:number;maxFiles:number}){
  const [items,setItems]=useState<{file:File;code:string;lineamiento:string}[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const input=useRef<HTMLInputElement>(null);
  function add(files:FileList|null){
    if(!files)return;const chosen=Array.from(files);
    if(chosen.length>(replaceId?1:maxFiles)){setError(`Selecciona hasta ${replaceId?1:maxFiles} archivos.`);return;}
    if(chosen.some(f=>f.size>maxMb*1024*1024)){setError(`Cada archivo debe pesar hasta ${maxMb} MB.`);return;}
    setError('');setMessage('');setItems(chosen.map(file=>({file,code:code ?? file.name.match(/\d+(?:\.\d+){0,5}/)?.[0] ?? '',lineamiento:file.name.replace(/\.[^.]+$/,'')})));
    if(input.current)input.current.value='';
  }
  async function submit(){
    setBusy(true);setError('');setMessage('');const uploaded:Uploaded[]=[],failed:typeof items=[],errors:string[]=[];
    for(const item of items){
      try{
        const form=new FormData();form.append('kind',kind);
        if(reqId)form.append('reqId',reqId);if(replaceId)form.append('replaceId',replaceId);
        if(kind==='ficha')form.append('code',item.code);else if(!replaceId)form.append('lineamiento',item.lineamiento.trim());
        form.append('files',item.file);const response=await api<{files:Uploaded[]}>('/uploads',{method:'POST',body:form});
        if(!response.files[0]?.ok)throw new Error(response.files[0]?.error ?? 'Carga fallida');uploaded.push(response.files[0]);
      }catch(e){errors.push(`${item.file.name}: ${(e as Error).message}`);failed.push(item);}
    }
    setItems(failed);setBusy(false);setError(errors.join(' · '));
    if(uploaded.length){setMessage(`${uploaded.length} documento(s) ${kind==='ficha'?'recibidos':'relacionados con este requerimiento'}. Estamos preparando su contenido.`);onDone(uploaded,failed.length>0);}
  }
  const invalid=items.some(i=>kind==='ficha'?!/^\d+(?:\.\d+){0,5}$/.test(i.code):!i.lineamiento.trim());
  return <div className="upload-area"><input ref={input} type="file" aria-label={kind==='ficha'?'Seleccionar fichas':'Seleccionar evidencias'} multiple={!replaceId} accept=".pdf,.docx,.xlsx,.xlsm,.txt,.md,.json,.png,.jpg,.jpeg" hidden onChange={e=>add(e.target.files)}/>
    <button className="dropzone" disabled={busy} onClick={()=>input.current?.click()} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(!busy)add(e.dataTransfer.files);}}><span className="upload-icon"><UploadCloud size={25}/></span><strong>{replaceId?'Selecciona la nueva versión':kind==='ficha'?'Sube la ficha del requerimiento':'Sube las evidencias de este requerimiento'}</strong><span>Arrastra archivos o haz clic para seleccionarlos</span><small>PDF, Word, Excel, texto e imágenes · Hasta {maxMb} MB</small></button>
    {items.length?<div className="upload-list">{items.map((item,i)=><div className="upload-item" key={i}><FileText size={17}/><span>{item.file.name}<small>{(item.file.size/1024).toFixed(0)} KB</small></span>{!replaceId?<label>{kind==='ficha'?'Número del requerimiento':'ID del lineamiento'}<input aria-label={`${kind==='ficha'?'Número de':'Lineamiento de'} ${item.file.name}`} value={kind==='ficha'?item.code:item.lineamiento} placeholder={kind==='ficha'?'5.3.1.14':'politica-institucional'} onChange={e=>setItems(prev=>prev.map((it,j)=>j===i?{...it,[kind==='ficha'?'code':'lineamiento']:e.target.value}:it))}/></label>:null}</div>)}<p className="muted">{kind==='ficha'?'Confirma el número que aparece en la ficha. Este será el requerimiento al que relacionarás las evidencias.':'Cada ID identifica un lineamiento en los resultados y reportes. Puedes conservar el nombre propuesto.'}</p><button className="primary" disabled={busy||invalid} onClick={()=>void submit()}>{busy?<LoaderCircle size={16}/>:<UploadCloud size={16}/>} {busy?'Cargando…':replaceId?'Guardar nueva versión':kind==='ficha'?'Crear requerimiento y continuar':'Cargar y relacionar evidencias'}</button></div>:null}
    {error?<p className="feedback error" role="alert">{error}</p>:null}{message?<p className="feedback success" role="status">{message}</p>:null}
  </div>;
}
