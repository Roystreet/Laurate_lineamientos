Requerimientos de solicitud


Se queire hacer un bash de ejecucion de script en nodejs  con javascript sin typsecript que tienen que relaizar las siguiente tareas convertir de la carpeta que se muestra en la estrucuta del proyecot de data los datos sin procesar, debemos convertirlo en markdown se deben de generar dos comandos generar lineamientos  y requerimnientos sin procesar, es decir que no tengan  registros  en la carpeta de data
y guardar en el caso de lineamiento,  los lineamientos vienen de una carpeta  en data sin procesar  en lineamientos_reuqeirmiento y dentro tendremos los lienamos que tendr ese requerimiento  es decir el nombre ejemplo req_1.1.1.1 todos los lineamisnot que van a al requerimiento 1.1.1.1 se van a colgar aca y luego en formato markdown se guradan en la carpeta data/mutable/lineamientos/req_... en los tres puntos ira la informacion ahora analiza la siguiente estrucuta de carpeta 


Estructura de Carpetas 
    -> src
        -> helpers -> tdos los helpers necesarios para el desarrollo de la aplicacion
        -> llm     ->  Modelos de ia que podemos utilizar
        -> steps => se guardaran todos los pasos que se pueden ejecutar en el basj 
            -> 0 convertir-a-markdown
                ->convertir-lineamiento
                ->convertir-plan
                ->convertir-ficha-requeriiento
            -> 1 validar-requerimientos
            -> 2 procesar requerimiento
            -> 3 generar-excel-por-requerimiento
            -> 4 generar-matriz-total-lineamientos
        -> propmt 
            -> propmt-analizar-requerimientos
        -> 
    -> data
        -> inmutable
        -> mutable 
            ->requerimientos
                ->1.1.1.1
            ->lieamientos
                ->req_1.1.1.1
        -> matriz-lineamientos
        -> data-sin-procesar
            ->requerimientos
            ->lineamientos_requerimiento
                req_1.1.1.1

    -> documentacion => se explica que realiz cada uno de los script necesarios en el proceso 
    

esta estrcutura sirve para poder enfocar nuestro desarrollo y todo lo que vamos a implemntar, tomar todo para el desarollo del proyecto 