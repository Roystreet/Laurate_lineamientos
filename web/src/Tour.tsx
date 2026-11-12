import {useEffect,useRef,useState} from 'react';
import {ArrowRight,BookOpen,Files,Play,BarChart3,SlidersHorizontal,X} from 'lucide-react';
import type {Section} from './types';
const key='documental:tour:v1';
export function needsTour(){try{return localStorage.getItem(key)!=='done';}catch{return false;}}
export function resetTour(){try{localStorage.removeItem(key);}catch{/* Storage may be disabled. */}}
const steps=[
  {section:'requirements',target:'workflow',title:'De la ficha a los resultados',text:'La ficha define un requerimiento con su número. Después relacionas las evidencias, analizas y descargas los reportes. Te mostramos cómo.',icon:BookOpen},
  {section:'requirements',target:'upload-ficha',title:'1. Sube tu ficha',text:'Carga una ficha por archivo y confirma el número del requerimiento. Se preparará automáticamente y podrás continuar con sus evidencias.',icon:BookOpen},
  {section:'documents',target:'evidence-context',title:'2. Relaciona las evidencias',text:'Selecciona el número del requerimiento. Sube sus documentos y asigna un ID a cada lineamiento, o relaciona un documento que ya hayas cargado.',icon:Files},
  {section:'analysis',target:'analysis-selection',title:'3. Elige qué analizar',text:'Busca tus requerimientos, recorre las páginas y selecciona hasta diez que estén listos. La selección se conserva al cambiar de página. Pulsa Analizar documentos.',icon:Play},
  {section:'results',target:'analysis-results',title:'4. Consulta cada requerimiento',text:'Abre el detalle de un requerimiento para revisar sus criterios, evidencias y hallazgos. Descarga el consolidado y los reportes. Puedes repetir esta guía con Reiniciar tour.',icon:BarChart3},
  {section:'config',target:'config-tabs',title:'5. Mejora el análisis',text:'Si un hallazgo no es correcto, regístralo en Config IA. Allí se prueba el ajuste y se publica una nueva versión.',icon:SlidersHorizontal},
] satisfies {section:Section;target:string;title:string;text:string;icon:typeof BookOpen}[];
export function Tour({onNavigate,onClose}:{onNavigate:(section:Section)=>void;onClose:()=>void}){
  const [step,setStep]=useState(0),[box,setBox]=useState<DOMRect|null>(null),ref=useRef<HTMLDialogElement>(null),current=steps[step];
  useEffect(()=>{const dialog=ref.current;dialog?.showModal();return()=>dialog?.close();},[]);
  useEffect(()=>{
    onNavigate(current.section);
    const update=()=>{const target=document.querySelector(`[data-tour="${current.target}"]`);if(target){target.scrollIntoView({block:'center'});setBox(target.getBoundingClientRect());}};
    const frame=requestAnimationFrame(update);window.addEventListener('resize',update);window.addEventListener('scroll',update);
    return()=>{cancelAnimationFrame(frame);window.removeEventListener('resize',update);window.removeEventListener('scroll',update);};
  },[current,onNavigate]);
  function close(){try{localStorage.setItem(key,'done');}catch{/* The tour also works without storage. */}onClose();}
  return <dialog ref={ref} className="tour-dialog" aria-label="Cómo usar la aplicación" onCancel={e=>{e.preventDefault();close();}}>
    {box?<div className="tour-highlight" style={{left:Math.max(8,box.left-6),top:Math.max(8,box.top-6),width:Math.min(box.width+12,window.innerWidth-16),height:Math.min(box.height+12,window.innerHeight-16)}}/>:null}
    <div className="tour-card"><button className="icon-button tour-close" aria-label="Omitir tour" onClick={close}><X size={19}/></button><span className="tour-icon"><current.icon size={25}/></span><p className="eyebrow">GUÍA DE USO · {step+1} DE {steps.length}</p><h2>{current.title}</h2><p>{current.text}</p><div className="tour-dots" aria-hidden="true">{steps.map((_,i)=><span key={i} className={i===step?'active':''}/>)}</div><div className="tour-actions"><button className="secondary" disabled={!step} onClick={()=>setStep(s=>s-1)}>Anterior</button><button className="primary" onClick={()=>step===steps.length-1?close():setStep(s=>s+1)}>{step===steps.length-1?'Terminar tour':'Siguiente'}<ArrowRight size={16}/></button></div></div>
  </dialog>;
}
