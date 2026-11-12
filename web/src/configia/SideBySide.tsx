import {Star} from 'lucide-react';
import {rowTitle,type Side,type TestDetail,type FindingRow} from './types';

function RowView({row}:{row:FindingRow}){
  const consideration=Boolean(row.consideracion_evaluada);
  const verdict=consideration?(row.cumple_consideracion==='si'?'Cumple':row.cumple_consideracion==='no'?'No cumple':row.cumple_consideracion):row.estado;
  return <li className="cia-sbs-row"><div className="cia-sbs-row-head"><span className={'status '+(verdict ?? '')}>{verdict || 'Sin estado'}</span>{row.lineamiento?<span className="type-tag">{row.lineamiento}</span>:null}</div>
    <strong>{rowTitle(row)}</strong>{row.observacion&&!consideration?<p>{row.observacion}</p>:consideration&&row.observacion?<p>{row.observacion}</p>:null}{row.literal?<blockquote>{row.literal}</blockquote>:null}</li>;
}
function Column({title,side}:{title:string;side:Side}){
  return <div className="cia-sbs-col"><div className="cia-sbs-col-head"><strong>{title}</strong>{side?.origen==='reutilizado'?<span className="mini-tag">Reutilizado del análisis original</span>:null}</div>
    {!side?<p className="muted">Pendiente…</p>:side.estado_tecnico==='error'?<p className="cia-hint">No se completó este criterio.</p>:<ul className="cia-sbs-rows">{side.filas.map((row,i)=><RowView key={i} row={row}/>)}</ul>}
  </div>;
}

/** Por caso (origen primero) y criterio: producción a la izquierda, borrador a la derecha. */
export function SideBySide({detail}:{detail:TestDetail}){
  return <div className="cia-sbs">{detail.casos.map(caso=><section key={caso.requerimiento_id} className="cia-sbs-case">
    <h4>{caso.origen?<Star size={14} aria-label="Caso de origen"/>:null}Requerimiento <span className="code">{caso.codigo}</span>{caso.origen?<span className="type-tag">Caso de origen</span>:<span className="type-tag">Control</span>}</h4>
    {caso.criterios.length?caso.criterios.map(c=><div key={c.criterio_id} className="cia-sbs-criterion"><h5>{c.nombre}</h5><div className="cia-sbs-grid">
      <Column title={`Producción v${detail.comparar_numero}`} side={c.produccion}/><Column title="Borrador" side={c.borrador}/>
    </div></div>):<p className="muted">Los criterios elegidos no aplican a este tipo de requerimiento.</p>}
  </section>)}</div>;
}
