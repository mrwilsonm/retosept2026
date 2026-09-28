# Verificación de la implementación

Fecha: 2026-09-28. Entorno: macOS, Node 24.16.0.

| Comprobación | Resultado |
|---|---|
| TypeScript backend y frontend | Correcto |
| Vitest | 40 pruebas pasan |
| Playwright con Chrome instalado | 2 pruebas pasan |
| Demo completa sin clave | 6/6 casos |
| Build TypeScript + React/Vite | Correcto |
| Dos ejecuciones de demo | Salidas idénticas salvo auditoría con timestamps |
| Integridad de fixtures contra ZIP original | 14/14 archivos idénticos |
| Dependencias y lockfile | Consistentes |
| Auditoría npm tras instalación final | 0 vulnerabilidades reportadas |

La prueba de navegador recorre chat, herramientas, revisión de msg-006, bloqueo por fechas faltantes, corrección, confirmación, reporte y restauración de sesión al recargar. La otra comprueba el diseño móvil sin desbordamiento horizontal. Usan proveedor simulado y directorio temporal.

## Pendiente de verificación externa

- Una conversación real exitosa con OpenAI: clave configurada, intento real HTTP 429 (`credit_balance_exhausted`). Saldo pendiente confirmado por el usuario.
- Construcción y ejecución de la imagen Docker: Docker no está instalado en este equipo.
- Despliegue en alojamiento elegido y prueba de URL pública.

Se intentaron solicitudes reales a OpenAI, rechazadas por falta de créditos. No se obtuvo una respuesta de modelo ni una medición de costo real; no se enviaron correos o mensajes de entrega a terceros.

## Auditoría adicional de entrega

Se volvieron a ejecutar typecheck, las 40 pruebas y build: correctos. La demo se ejecutó dos veces en una copia temporal, con resultados 6/6 y salidas repetibles salvo timestamps. No se borró `out/` del servidor. Después de los arreglos se repitieron las dos pruebas de Chrome: ambas pasan. Las pruebas de navegador usan un proveedor simulado; no se presentan como pruebas con OpenAI real.

Se reprodujeron y corrigieron tres diferencias fuera de los seis casos originales: moneda EUR ahora devuelve error y permite continuar; plazo con inicio explícito y meses sin «hasta» deriva fin con confianza 0.7; primera lectura crea maestro de salida. Se agregó regresión automatizada. El arranque dev no requiere vigilancia de archivos. Ver [informe](INFORME_CUMPLIMIENTO.md).
