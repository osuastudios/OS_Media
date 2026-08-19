# Manual de OS Media

Bienvenido a OsuaStudio Media Tool, desarrollada por OSUA para sus pequeñas criaturas <3. Esto es todo lo que necesitas para bajarte vídeos y música de YouTube y Twitch.

## Instalar

1. Descarga el instalador (`OS Media Setup.exe`). El navegador puede avisar de "archivo poco común": pulsa **Ver más** → **Mantener** / **Conservar de todos modos**.
2. Ábrelo y sigue el asistente (puedes dejar la carpeta por defecto).
3. Si Windows muestra la pantalla azul "Windows protegió tu PC": pulsa **Más información** → **Ejecutar de todas formas**. Es normal, la app no tiene certificado de pago, no significa que sea insegura.
4. Al terminar, tendrás **OS Media** en el Escritorio y buscable desde el menú de inicio (tecla Windows → escribe "OS Media").

La primera vez que abras la app tardará un poco más: está descargando en silencio las herramientas que necesita por dentro (yt-dlp, ffmpeg, deno). Solo pasa una vez.

## Descargar algo

1. Pega la URL del vídeo de YouTube o del clip/VOD de Twitch.
2. Elige **Vídeo** o **MP3**. Si es vídeo, elige también la calidad.
3. Elige dónde guardarlo (por defecto `Escritorio\OS Media`).
4. Pulsa **Descargar**. Verás progreso, velocidad y tiempo restante; al terminar puedes abrir la carpeta directamente.

## Vídeo vs MP3

- **Vídeo (MP4):** mejor disponible / 1080p / 720p / 480p.
- **Solo audio (MP3):** máxima calidad siempre, con la miniatura incluida como portada.

## Ajustes (el engranaje de arriba)

- **Cookies del navegador:** actívalo si YouTube bloquea una descarga. Usa tu sesión de **Firefox** (funciona mucho mejor que Chrome/Edge, que fallan si el navegador está abierto o por cómo cifran las cookies en Windows).
- **Intervalo entre descargas:** segundos de espera antes de cada descarga (3 por defecto). Más bajo = más rápido, pero más riesgo de bloqueo.
- **Plantilla de nombre de archivo:** por defecto `%(title)s.%(ext)s` (el título tal cual). No hace falta tocarlo.

## Si algo falla

Es normal — YouTube cambia cosas constantemente. La app siempre explica qué ha pasado en lenguaje claro y tiene un botón **Reintentar**.

| Mensaje | Solución |
|---|---|
| YouTube ha bloqueado la petición | Pulsa "Actualizar yt-dlp ahora" (abajo del todo) y reintenta. Si sigue, activa cookies de Firefox en Ajustes. |
| Este vídeo requiere sesión iniciada | Activa cookies del navegador (Firefox) en Ajustes. |
| El vídeo no está disponible o es privado | Nada que hacer por nuestra parte — comprueba el enlace. |

## Preguntas rápidas

- **¿Cuántas descargas a la vez?** De momento, una detrás de otra.
- **¿Playlists?** Todavía no soportado.
- **¿Spotify o Netflix?** No, y nunca — usan DRM y saltárselo es ilegal. Solo YouTube y Twitch.
- **¿Necesito instalar yt-dlp/ffmpeg yo?** No, la app se los descarga sola y los mantiene al día.

---
Hecho con ♥ por OSUA
