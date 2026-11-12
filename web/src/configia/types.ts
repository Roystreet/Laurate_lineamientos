import {api} from '../ui';

export type Rule={codigo:string;texto:string;criterios:number[];activa:boolean};
export type RuleRow=Rule&{estado:'activa'|'inactiva'|'solo_borrador';desde:number|null};
export type RuleChange={codigo:string;accion:'agregada'|'editada'|'activada'|'desactivada';antes:Rule|null;despues:Rule};
export type Version={numero:number;created_at:string;publicado_por:string;origen:'inicial'|'solicitud'|'reversion';solicitud_numero:number|null;revertida_de:number|null;motivo:string|null;analisis:number;reglas:Rule[];cambios:RuleChange[]};
export type HistoryEntry={accion:string;antes:Rule|null;despues:Rule;autor:string;motivo:string|null;version_numero:number;solicitud_numero:number|null;created_at:string};
export type Change={op:'crear'|'modificar';codigo?:string|null;texto?:string;criterios?:number[];activa?:boolean;antes?:{texto:string;criterios:number[];activa:boolean};autor?:string;motivo?:string};
export type FindingRow=Record<string,string>;
export type RequestRow={id:string;numero:number;autor:string;descripcion:string;estado:string;estado_visible:string;requerimiento_codigo:string;criterio_id:number;created_at:string};
export type TestSummary={id:string;created_at:string;estado:string;exploratoria:boolean;veredicto:string|null;revisor:string|null;comentario:string|null};
export type RequestDetail=RequestRow&{
  esperado:string|null;ejecucion_id:string;requerimiento_id:string;criterio_nombre:string;fila_orden:number|null;fila_copia:FindingRow|null;motivo_rechazo:string|null;
  borrador:{base:{numero:number;reglas:Rule[]};cambios:Change[];reglas:Rule[];conflictos:{codigo:string;motivo:string}[];criterios_tocados:number[]};
  pruebas:TestSummary[];eventos:{tipo:string;autor:string;detalle:Record<string,unknown>|null;created_at:string}[];
  produccion_numero:number;publicacion:{ok:boolean;motivo:string|null};
};
export type CaseRun={ejecucion_id:string;created_at:string;estado:string;reglas_version:number|null;criterios:{criterio_id:number;nombre:string;estado_tecnico:string;filas:FindingRow[]}[]};
export type Side={estado_tecnico:string;origen:'reutilizado'|'ejecutado';filas:FindingRow[]}|null;
export type TestCase={codigo:string;requerimiento_id:string;ejecucion_id:string;origen:boolean;criterios:{criterio_id:number;nombre:string;produccion:Side;borrador:Side}[]};
export type TestDetail={id:string;solicitud_id:string;estado:string;exploratoria:boolean;veredicto:string|null;revisor:string|null;comentario:string|null;comparar_numero:number;base_numero:number;apagadas:string[];criterios:number[];progreso:{total:number;listos:number;errores:number};casos:TestCase[];tareas:{id:string;error:string}[];en_espera:boolean};

export const CRITERIOS=['Información completa','Coherencia','Consistencia','Sostenibilidad','Mejora continua','Integración'];
export const criterioName=(id:number)=>CRITERIOS[id-1] ?? `Criterio ${id}`;
export const requestStateLabels:Record<string,string>={pendiente:'Pendiente',en_prueba:'En prueba',funciono:'Funcionó',no_funciono:'No funcionó',requiere_reprueba:'Requiere volver a probar',publicada:'Publicada',rechazada:'Rechazada'};
export const ruleStateLabels:Record<string,string>={activa:'Activa',inactiva:'Inactiva',solo_borrador:'Solo en borradores'};
export const changeLabels:Record<string,string>={agregada:'Agregada',editada:'Editada',activada:'Activada',desactivada:'Desactivada'};
export const formatDate=(value:string)=>new Date(value).toLocaleString('es-VE',{dateStyle:'short',timeStyle:'short'});
export const put=<T,>(url:string,body:unknown)=>api<T>(url,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
/** Text shown for a finding or consideration row. */
export const rowTitle=(row:FindingRow)=>row.consideracion_evaluada || (row.hallazgo && row.hallazgo!=='N/A'?row.hallazgo:row.observacion) || 'Sin descripción';
