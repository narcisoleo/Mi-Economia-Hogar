# ECO HOGAR v2.3.3

Versión de estabilización de captura móvil.

## Cambios principales

- Voz con mayor ventana de escucha, dictado acumulativo, edición y reanálisis.
- Parser conservador: no inventa categorías ambiguas.
- Corrección de importes con separadores y saldos antes/después.
- Transferencias enviadas/recibidas con origen y destino por institución.
- Fechas de Mercado Pago, Naranja X y Cuenta DNI mejor soportadas.
- Clasificación segura de transferencias recibidas como ingreso salvo identificación de una persona del hogar.
- OCR de imágenes mejorado con preprocesamiento y segunda pasada selectiva.
- `¿Para quién fue?` sigue siendo opcional y se muestra como gasto común/sin asignar cuando no corresponde a una persona.
- Fondo gris suave `#e7ebf0` para mejorar jerarquía visual.
- Service Worker / caché de compartir actualizado a v2.3.3.

No requiere migración SQL ni variables nuevas en Vercel.
