# Are.na Bridge

Plugin de Obsidian para conectar tu vault con [Are.na](https://www.are.na). Importa canales y bloques, publica notas y mantén sincronizado tu contenido.

## Origen y atribución

Este proyecto es una continuación independiente basada en la versión 1 de [`javierarce/arena-manager`](https://github.com/javierarce/arena-manager), publicada bajo licencia MIT.

Mantiene el crédito al proyecto original, pero este repositorio no pretende seguir su upstream como fork activo. La implementación actual se ha adaptado al flujo moderno con Personal Access Token y a la API `v3` de Are.na.

## Instalación

1. Copia `main.js` y `manifest.json` en `.obsidian/plugins/arena-bridge/` dentro de tu vault.
2. En Obsidian: **Ajustes → Plugins de la comunidad → Activar** "Are.na Bridge".
3. Ve a los ajustes del plugin y configura:
   - **Personal Access Token** — obtenlo en [are.na/settings/oauth](https://www.are.na/settings/oauth). Para publicar, actualizar bloques o crear canales necesitas scope `write`
   - **Usuario (slug)** — tu slug de Are.na, por ejemplo `marco-noris`
   - **Carpeta** — carpeta del vault donde se guardarán los bloques (por defecto `arena`)
   - **Carpeta de adjuntos** — nombre de la subcarpeta local para imágenes y adjuntos descargados (por defecto `_assets`)
   - **Diagnóstico de caché** — muestra cuántas respuestas API y canales locales tiene en memoria persistida, y permite vaciar caché de canales, de bloques o todo

## Desarrollo

El runtime que carga Obsidian sigue siendo `main.js`, pero el código fuente modular vive en `src/`.

Si tienes Node.js instalado:

1. Ejecuta `npm install`
2. Ejecuta `npm run build` para regenerar `main.js`
3. Ejecuta `npm run dev` para rebuild automático mientras editas `src/`

`main.js` es el artefacto generado. Edita `src/`, no el bundle, salvo que estés haciendo una reparación urgente dentro del vault. Los archivos fuente válidos viven solo en `src/`.

## Comandos

### Explorar mis canales
Abre un modal con tus canales de Are.na. Puedes filtrarlos por nombre y seleccionar uno para importarlo al vault.

La primera vez tarda unos segundos en cargar la lista. El modal abre con un primer tramo de 12 canales y permite seguir cargando más desde ahí mismo si no aparece el que buscas. A partir de entonces reutiliza una caché local revalidada con `ETag`, de modo que solo vuelve a descargar las páginas que Are.na indica que cambiaron. Si creas canales nuevos en Are.na, puedes refrescar la lista desde el propio modal o usando **Actualizar lista de canales**.

### Obtener bloques de un canal
Importa bloques de un canal a partir de su slug o URL. Empieza por la primera página y, si el canal tiene más contenido, te pide confirmación antes de seguir. Por ejemplo:
```
mi-canal
https://www.are.na/marco-noris/mi-canal
```

### Obtener bloque por ID o URL
Importa un bloque concreto por su ID numérico o URL de Are.na.

### Actualizar nota desde Are.na (Pull)
Con una nota abierta que tenga `blockid` en el frontmatter, actualiza su contenido desde el bloque original en Are.na.
Las claves personalizadas que ya tengas en el frontmatter se conservan; el plugin solo actualiza los campos que gestiona de Are.na.

### Enviar nota a Are.na (Push)
Publica la nota activa en Are.na. Si ya tiene `blockid`, actualiza el bloque existente. Si no, abre un selector con tus canales de Are.na y crea un bloque nuevo; si lo prefieres, también puedes introducir el slug manualmente.

### Abrir bloque en Are.na
Abre en el navegador el bloque de Are.na correspondiente a la nota activa.

### Crear canal en Are.na
Abre un formulario para crear un canal nuevo directamente desde Obsidian. Puedes definir el nombre y la visibilidad:
- **Público** — cualquiera puede ver y añadir bloques
- **Cerrado** — cualquiera puede ver, pero solo tú (y colaboradores) podéis añadir
- **Privado** — solo tú y colaboradores podéis ver y añadir

El canal nuevo aparece automáticamente en "Explorar mis canales" sin necesidad de refrescar.

### Subir carpeta como canal a Are.na
Haz clic derecho en cualquier carpeta del vault y selecciona "Subir carpeta como canal a Are.na". Se abrirá el formulario de creación de canal (con el nombre de la carpeta como sugerencia) y, al confirmar, subirá todas las notas `.md` de esa carpeta como bloques de texto en el canal nuevo.

- Si una nota ya tiene `blockid` en el frontmatter, actualiza el bloque existente en lugar de duplicarlo.
- Las notas nuevas reciben `blockid` y `channel` en su frontmatter automáticamente.

### Actualizar lista de canales (refresco)
Borra la caché local de canales para forzar una nueva descarga en el próximo "Explorar mis canales".

## Estructura de las notas importadas

Cada bloque se guarda como una nota `.md` con frontmatter:

```yaml
---
blockid: 12345
class: Text
title: "Título del bloque"
user: marco-noris
channel: nombre-del-canal
created_at: 2024-01-01
updated_at: 2024-03-01
---

Contenido del bloque...
```

Los bloques se guardan en `{carpeta}/{slug-del-canal}/`. El `blockid` en el frontmatter es lo que permite hacer Pull y Push posteriores.

Cuando una nota ya existe, el plugin la localiza primero por `blockid` y no por título de archivo. Así evita duplicados si el bloque cambia de nombre en Are.na o si ya has renombrado la nota en Obsidian. El plugin no reconstruye el frontmatter desde cero: mantiene tus claves personalizadas y solo fusiona/actualiza los metadatos propios de Are.na.

Si una nota tiene este flag en el frontmatter, el plugin la excluye de Pull, Push y de "Subir carpeta como canal":

```yaml
arena_skip_sync: true
```

## Tipos de bloque soportados

| Tipo | Cómo se importa |
|---|---|
| Text | Contenido como texto Markdown |
| Link | Enlace con título y descripción |
| Image | Imagen embebida con `![]()` |
| Attachment | Enlace al archivo adjunto |
| Media | Contenido textual si existe |

## Notas

- El plugin usa la API v3 de Are.na con tu token personal, por lo que solo accede a contenido al que tienes acceso en Are.na.
- El cliente añade una pausa corta entre peticiones secuenciales y, si Are.na responde con `429`, espera hasta la ventana de reset antes de reintentar.
- Las respuestas `GET` cacheadas se revalidan con `If-None-Match` y `ETag`; el plugin solo reutiliza el cuerpo local cuando Are.na responde `304 Not Modified`.
- Las cargas paginadas no recorren todas las páginas automáticamente: tras cada página adicional el plugin pide confirmación, y se detiene tras varias páginas para evitar extracción masiva.
- Si activas **Descargar adjuntos**, las imágenes y adjuntos se guardan dentro del vault en la subcarpeta configurada junto a las notas importadas, y el Markdown pasa a enlazar al archivo local. En una misma ejecución solo se descargan un número limitado de adjuntos; el resto queda enlazado en remoto para evitar descargas masivas.
- La documentación de Are.na prohíbe scraping, crawling automatizado y descargas masivas o sistemáticas. Si necesitas sincronizaciones muy grandes o bulk export, conviene pedir permiso a Are.na antes de usar el plugin con ese volumen.
