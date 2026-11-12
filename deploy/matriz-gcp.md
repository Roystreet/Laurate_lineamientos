# Despliegue en matriz-gcp

La plataforma se instala en `/srv/documental`, como proyecto Docker Compose `documental-produccion`. Utiliza `compose.gcp.yaml`, una base MySQL 8.4 propia y su volumen `mysql_data`. Los documentos y reportes están en `/srv/documental/storage`.

La configuración se obtiene del `.env` existente, transferido por SSH y protegido con permisos `600`. No se incluye en la imagen. API y worker se ejecutan juntos en el servicio `app` y aplican las migraciones al iniciar.

MySQL tiene un límite de 512 MiB, hasta 60 conexiones, el registro de rendimiento desactivado y un buffer de log de 16 MiB. El servicio de aplicación tiene un límite de 1 GiB. Estas opciones reducen el consumo en el servidor compartido y no modifican los parámetros de los análisis.

El Caddy existente de `matriz-produccion` sirve HTTPS para `documental-104-197-135-115.sslip.io` y envía las solicitudes a `documental-app:8008` mediante su red Docker. Se conserva la ruta de la otra aplicación. MySQL no publica un puerto en el servidor; la API solo publica `127.0.0.1:8008` para verificaciones locales.

El bloque de [Caddyfile.documental](Caddyfile.documental) se incorpora una sola vez a `/srv/matriz/deploy/Caddyfile`. Validar la configuración y recargar Caddy tras cambiar ese bloque:

```bash
docker exec matriz-produccion-caddy-1 caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker exec matriz-produccion-caddy-1 caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
```

## Operación

```bash
ssh matriz-gcp
cd /srv/documental
docker compose -p documental-produccion -f compose.gcp.yaml ps
docker compose -p documental-produccion -f compose.gcp.yaml logs --tail=80 app
docker compose -p documental-produccion -f compose.gcp.yaml exec -T app node scripts/check-config.js
```

Tras actualizar código o parámetros, construir y reiniciar los servicios:

```bash
docker compose -p documental-produccion -f compose.gcp.yaml up -d --build --wait
```

No utilizar `down -v`: elimina el volumen MySQL. Los originales y Excel deben conservarse en `storage/` entre despliegues. No se configuran copias de seguridad.

La carga inicial transfiere el catálogo y los resultados vigentes de la aplicación local, junto con todos los archivos de `storage/`. La transferencia SQL se transmite directamente entre ambos MySQL por SSH; no se guarda un archivo de respaldo. Las rutas de almacenamiento son relativas, por lo que los documentos y versiones mantienen sus identificadores.

## Verificación desde el equipo local

```bash
E2E_BASE_URL=https://documental-104-197-135-115.sslip.io pnpm test:e2e
```

Las pruebas de interfaz que suben documentos utilizan respuestas simuladas. La navegación, consulta y descarga del material existente se verifican contra la aplicación desplegada.

Verificado el 7 de octubre de 2026:

- Las 18 tablas y los 34 archivos coinciden con el origen mediante SHA-256, incluidas las versiones nuevas de fichas.
- Las descargas públicas de los 14 originales y 8 Excel coinciden byte por byte con las locales.
- Pasaron las cinco pruebas de interfaz contra HTTPS y las diez pruebas locales de compatibilidad, configuración y extracción.
- El servidor accede a los modelos configurados de OpenAI con la clave existente. API, worker y MySQL están activos, y el almacenamiento permite escritura.
- La aplicación que ya existía en el servidor mantiene su acceso HTTPS.
