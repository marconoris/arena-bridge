# Are.na Bridge — Notas de desarrollo

Plugin de Obsidian para conectar un vault con Are.na. Autor original: Javier Arce. Versión actual: 2.0.0.

---

## Estado actual del plugin

| Comando | Estado |
|---|---|
| Obtener bloques de un canal | ✅ Funciona |
| Explorar mis canales | ✅ Funciona (caché local tras primera carga) |
| Actualizar lista de canales (refresco) | ✅ Borra el caché para forzar nueva descarga |
| Pull block (actualizar nota desde Are.na) | ✅ Funciona |
| Push note (enviar nota a Are.na) | ✅ Funciona |
| Obtener bloque por ID o URL | ✅ Funciona |
| Crear canal en Are.na | ✅ Funciona |
| Subir carpeta como canal (menú contextual) | ✅ Funciona |
| Abrir bloque en Are.na | ✅ Funciona |

---

## API de Are.na — Lo que sabemos con certeza

### Base URL
```
https://api.are.na/v3
```

### Autenticación
```
Authorization: Bearer {token}
```

### Estructura de respuesta (listas paginadas)
```json
{
  "data": [...],
  "meta": {
    "current_page": 1,
    "total_pages": 5,
    "has_more_pages": true
  }
}
```
Parámetros de paginación: `page` y `per` (máx. 100).

---

## Endpoints confirmados que funcionan

| Endpoint | Descripción |
|---|---|
| `GET /channels/{slug}` | Datos de un canal |
| `GET /channels/{slug}/contents` | Bloques de un canal (paginado) |
| `POST /channels/{slug}/blocks` | Añadir bloque a canal |
| `PUT /blocks/{id}` | Actualizar bloque |
| `GET /blocks/{id}` | Obtener bloque por ID |
| `GET /users/{slug}` | Datos de usuario (acepta slug, no solo ID numérico) |
| `GET /users/{slug}/contents` | Todos los contenidos del usuario (bloques + canales) |

---

## El problema de "Explorar mis canales" — Historia completa

### Lo que NO funciona y por qué

**`GET /v3/users/{slug}/channels` → 404**
No existe en v3. Ni con slug ni con ID numérico.

**`GET /v2/users/{slug}/channels`**
Existe en v2 (deprecated) pero se decidió no usarlo para no mezclar versiones.

**`GET /v3/search?q={username}`**
Busca contenido que contiene el texto del username, no canales del usuario. Resultados incompletos e imprecisos.

### Lo que SÍ funciona (solución actual)

El objeto usuario devuelto por `GET /users/{slug}` tiene esta estructura:
```json
{
  "id": 235824,
  "slug": "marco-noris",
  "counts": { "channels": 154, "followers": 71, "following": 405 },
  "_links": {
    "self": { "href": "https://api.are.na/v3/users/marco-noris" },
    "contents": { "href": "https://api.are.na/v3/users/marco-noris/contents" },
    "followers": { "href": "https://api.are.na/v3/users/marco-noris/followers" },
    "following": { "href": "https://api.are.na/v3/users/marco-noris/following" }
  }
}
```

**`_links` confirma que no existe un enlace `/channels` en v3.**

La solución actual: paginar `GET /users/{slug}/contents` y filtrar por `type === "Channel"`.

### Campos importantes en v3

- En v3 **no existe el campo `class`** en los items (es `undefined`).
- El campo correcto es **`type`**: `"Channel"`, `"Link"`, `"Text"`, `"Image"`, `"Attachment"`, `"Media"`.
- Los canales en `/contents` tienen `type: "Channel"`.

### Por qué es lento

`/users/{slug}/contents` devuelve todos los contenidos del usuario (bloques individuales, links, imágenes, canales...) mezclados. Con 154 canales entre potencialmente miles de bloques, hay que paginar bastante.

**Optimización implementada:** early exit usando `counts.channels` para parar en cuanto se han encontrado todos los canales.

### Rate limiting

| Tier | Requests/minuto |
|---|---|
| Guest (sin auth) | 30 |
| Free | 120 |
| Premium | 300 |
| Supporter/Lifetime | 600 |

Headers relevantes en cada respuesta:
- `X-RateLimit-Limit` — límite del tier
- `X-RateLimit-Tier` — tier actual
- `X-RateLimit-Reset` — Unix timestamp de cuando se resetea el límite
- `X-RateLimit-Window` — ventana en segundos (siempre 60)

Si se supera el límite: `429 Too Many Requests` con info de retry.

**Impacto en "Explorar mis canales":** paginar `/users/{slug}/contents` muchas veces puede provocar un 429 silencioso si el usuario está en Free tier. El código actual ya maneja el 429 con retry usando `X-RateLimit-Reset`.

**Uso prohibido:** scraping, descarga masiva o harvesting sistemático. Solo uso integrado normal.

**Importante — ToS:** La descarga paginada de todos los contenidos del usuario roza el límite de lo que la ToS permite ("systematic downloading"). La solución adoptada es **caché local**: la lista de canales se descarga una sola vez, se guarda en `data.json` (`settings.channelsCache`), y se reutiliza en cada uso posterior. El usuario puede forzar un refresco con el comando "Actualizar lista de canales".

---

## Crear bloque y conectarlo a un canal — POST /v3/blocks

```json
{
  "value": "texto o URL",
  "title": "título opcional",
  "channel_ids": [123, "mi-canal-slug"]
}
```

- `value` es texto → crea Text block. Es una URL → Are.na infiere el tipo (Image, Link, Embed).
- `channel_ids` acepta IDs numéricos, strings o slugs. Permite conectar a múltiples canales a la vez (máx. 20).
- `insert_at` (opcional) — posición en el canal, solo válido con un único canal.

⚠️ **No existe `POST /v3/channels/{id}/blocks`** — da 404 siempre. El endpoint correcto es `POST /v3/blocks`.
⚠️ El campo es `value`, **no** `content` (que era el campo en v2).

---

## Endpoints de canal v3 (los 7 confirmados)

| Método | Endpoint | Descripción |
|---|---|---|
| GET | /v3/channels/{id} | Obtener canal |
| GET | /v3/channels/{id}/connections | Conexiones del canal |
| GET | /v3/channels/{id}/contents | Contenidos del canal |
| GET | /v3/channels/{id}/followers | Seguidores |
| POST | /v3/channels | Crear canal |
| PUT | /v3/channels/{id} | Actualizar canal |
| DELETE | /v3/channels/{id} | Eliminar canal |

---

## Crear canal — POST /v3/channels

```json
{ "title": "Nombre", "visibility": "public" | "closed" | "private" }
```

⚠️ El campo es `visibility`, **no** `status`. Usar `status` ignora el valor y crea el canal como público.

⚠️ El slug generado por Are.na incluye un sufijo aleatorio (ej. `mi-canal-c5jtueagmtk`). `POST /channels/{slug}/blocks` da 404 con estos slugs. Hay que usar el **ID numérico** del canal (`channel.id`) para añadir bloques a un canal recién creado.

---

## Posible mejora futura

Investigar si el endpoint de búsqueda acepta un filtro de tipo y usuario para obtener solo canales:
```
GET /v3/search?q=&models[]=Channel&user={slug}
```
No se ha podido confirmar si este parámetro existe. Podría ser más rápido si funciona.

---

## Estructura de un bloque (v3)

```json
{
  "id": 12345,
  "type": "Text",          // "Text", "Link", "Image", "Attachment", "Media", "Channel"
  "title": "...",
  "content": "...",
  "user": { "slug": "marco-noris" },
  "source": { "url": "...", "title": "..." },
  "image": { "src": "..." },
  "attachment": { "url": "..." },
  "description": { "plain": "...", "html": "..." },
  "created_at": "2024-01-01T00:00:00Z",
  "updated_at": "2024-01-01T00:00:00Z"
}
```

## Estructura de un canal (v3, dentro de /contents)

```json
{
  "id": 67890,
  "type": "Channel",
  "title": "Nombre del canal",
  "slug": "nombre-del-canal",
  "visibility": "public",
  "counts": { "contents": 42 },
  "user": { "slug": "marco-noris" }
}
```

---

## Archivos del plugin

| Archivo | Descripción |
|---|---|
| `main.js` | Bundle autocontenido generado por `esbuild`; es el único archivo JS que carga Obsidian en runtime |
| `src/main.js` | Entry point del código fuente modular |
| `src/plugin.js` | Clase principal del plugin y panel de ajustes |
| `src/arena-client.js` | Cliente HTTP para la API v3 de Are.na |
| `src/note-utils.js` | Helpers de frontmatter, serialización y render de bloques |
| `src/modals.js` | Modales reutilizables del plugin |
| `src/constants.js` | Constantes y settings por defecto |
| `esbuild.config.mjs` | Build script para generar `main.js` |
| `package.json` | Scripts y dependencia de `esbuild` |
| `manifest.json` | Metadatos del plugin (id, nombre, versión) |
| `data.json` | Configuración guardada (token, username, folder) |
| `DESARROLLO.md` | Este archivo |

---

## Configuración (data.json)

```json
{
  "token": "...",
  "username": "marco-noris",
  "folder": "Docs/Are.na",
  "downloadAttachments": false,
  "attachmentsFolderName": "_assets"
}
```

Cuando `downloadAttachments` está en `true`, los bloques de tipo `Image` y `Attachment` descargan su binario al vault en `.../{attachmentsFolderName}/` dentro de la carpeta del canal y las notas usan rutas locales relativas.

---

## Instalación en Obsidian

1. Para usar el plugin en Obsidian, copiar `main.js` y `manifest.json` a `.obsidian/plugins/arena-bridge/` dentro del vault.
2. Para desarrollo local, editar `src/` y regenerar `main.js` con `npm run build`.
3. No editar archivos JS en la raíz salvo `main.js` cuando haya que hacer una reparación urgente del bundle ya generado.
2. Activar el plugin en Ajustes → Plugins de la comunidad.
3. Configurar token y username en los ajustes del plugin.

El token se obtiene en: `https://are.na/settings/personal-access-tokens`
