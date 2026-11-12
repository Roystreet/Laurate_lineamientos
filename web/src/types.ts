export type Ficha={nombre_requerimiento:string;tipo:string;consideraciones:string[];requerimientos_relacionados:string[]};
export type Req={id:string;codigo:string;documento_ficha_actual:string;ficha:Ficha|null;evidencias:number;fichas_pendientes:number;evidencias_pendientes:number};
export type Doc={id:string;clase:string;nombre_original:string;estado:string;error:string|null;lineamiento?:string;activa?:number;compartido?:number};
export type Row=Record<string,string>;
export type Task={id:string;tipo:string;estado:string;error:string|null;payload:{requirementId?:string}};
export type Result={id:string;nombre:string;codigo:string;criterio_id:number;estado_tecnico:string;filas:Row[]};
export type Run={id:string;estado:string;error:string|null;created_at:string;requerimientos:number;requirementIds:string[];reglas_version:number|null};
export type Input={id:string;codigo:string;ficha:Ficha;evidencias:{id:string;version_id:string;lineamiento:string;nombre_original:string}[]};
export type Detail=Run & {inputs:Input[];tasks:Task[];results:Result[];reports:{id:string;tipo:string;nombre:string}[]};
export type Page={numero:number;metodo:string;estado:string;texto:string;error:string|null};
export type Preview={id:string;version_actual:string;displayedVersionId?:string;nombre_original:string;estado:string;texto:string;error:string|null;pages:Page[];versions:{id:string;estado:string;created_at:string}[];tasks:{id:string;estado:string;error:string|null}[]};
export type Section='requirements'|'documents'|'analysis'|'results'|'config';
export type Uploaded={ok:boolean;error?:string;documentId:string;requirementId:string};
export const isPrepared=(r:Req)=>Boolean(r.ficha&&Number(r.evidencias)>0&&!Number(r.fichas_pendientes)&&!Number(r.evidencias_pendientes));
export function preparationLabel(r:Req){
  if(!r.ficha||Number(r.fichas_pendientes))return 'Ficha pendiente de preparación';
  if(!Number(r.evidencias))return 'Agrega evidencias';
  return Number(r.evidencias_pendientes)?'Evidencias pendientes de preparación':'Listo para analizar';
}
