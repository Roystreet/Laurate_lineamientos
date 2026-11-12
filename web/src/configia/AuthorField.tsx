import {useState} from 'react';

const KEY='documental:autor';
function readAuthor(){try{return localStorage.getItem(KEY) ?? '';}catch{return '';}}
function storeAuthor(value:string){try{localStorage.setItem(KEY,value);}catch{/* Storage may be disabled. */}}

/** Name typed by hand (there are no user accounts); remembered on this browser. */
export function useAuthor(){
  const [autor,setAutor]=useState(readAuthor);
  return [autor,(value:string)=>{setAutor(value);storeAuthor(value);}] as const;
}
export function AuthorField({value,onChange,label='Tu nombre'}:{value:string;onChange:(value:string)=>void;label?:string}){
  return <label className="cia-field">{label}<input value={value} maxLength={100} placeholder="Escribe tu nombre" onChange={e=>onChange(e.target.value)}/></label>;
}
