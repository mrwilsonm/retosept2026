# Entrega — Registro de Contratos Vigentes

**Reto:** Prueba IA 02 — Periferia IT Group.  
**Autor / cuenta de entrega:** mrwilsonm (nombre completo pendiente de confirmación).  
**Fecha límite indicada:** 28 de septiembre de 2026, 4:00 p. m., Colombia (UTC−05:00).  
**Estado:** versión local implementada y auditada; entrega final pendiente de cierre.  
**Repositorio destino:** https://github.com/mrwilsonm/retosept2026 — publicación pendiente de autenticación.  
**URL pública:** pendiente. `http://localhost:3000` es acceso local, no enlace público.

## Dictamen

**El reto todavía no está completo al 100% frente al instructivo y al PRD.** Hay implementación local de las cinco herramientas, agente, API, interfaz y demo. Faltan el despliegue público, una conversación real exitosa con el proveedor y la publicación del repositorio. Los ajustes técnicos T01–T04 están corregidos.

El PDF exige código fuente, `demo.ts`, URL pública funcional y `SOLUCION.md`. El PRD permite un ZIP como alternativa al repositorio Git, y acepta defensa local con penalización por falta de despliegue; esa alternativa no equivale a cumplir el enlace público.

## Contenido de la entrega

| Elemento | Ubicación | Estado |
|---|---|---|
| Instrucciones del evaluador | [PDF](docs/Detalle%20instrucciones%20reto%202.pdf) y [PRD](docs/PRD.md) | Revisados |
| Guía de instalación y API | [README.md](README.md) | Actualizada |
| Arquitectura, modelo, costos, decisiones y gobierno | [SOLUCION.md](SOLUCION.md) | Documentado, con límites explícitos |
| Auditoría requisito por requisito | [Informe de cumplimiento](docs/INFORME_CUMPLIMIENTO.md) | Incluye diferencias reproducidas |
| Evidencias de comprobación | [Verificación](docs/VERIFICACION.md) | Pruebas locales y límites de evidencia |
| Plan de cierre | [Pendientes de entrega](docs/PENDIENTES_ENTREGA.md) | Requiere decisiones del candidato |
| Guion de demostración | [Guía de defensa](docs/GUIA_DEFENSA.md) | Incluye alternativa sin saldo |
| Texto de presentación | [Mensaje de entrega](docs/MENSAJE_ENTREGA.md) | Borrador; no enviado |
| Código fuente y pruebas | `src/`, `web/`, `agent/`, `tests/`, `scripts/` | Implementados |
| Demo independiente del modelo | `demo.ts` | 6/6 casos completos |
| Contenedor | `Dockerfile`, `compose.yaml` | Preparado, no ejecutado en este equipo |

## Evidencia resumida

- Typecheck de frontend y backend correcto.
- 40 pruebas unitarias/de integración pasando.
- 2 pruebas de navegador con proveedor simulado; ver fecha de comprobación en VERIFICACION.md.
- Demo repetida dos veces en copia temporal: 6/6, sin API key y con la misma salida lógica.
- Los fixtures se conservan intactos; no se altera el maestro original.
- Prueba real de conectividad: HTTP 429, `credit_balance_exhausted`; el usuario confirmó que no ha agregado saldo.

Las pruebas de navegador con proveedor simulado no demuestran que el modelo real complete el flujo. No hay evaluación externa ni puntuación oficial del reto.

## Inicio local para el evaluador

Con Node 24 y desde la raíz:

```bash
npm ci
cp -n .env.example .env
# Configurar la clave propia de OpenAI en .env si se probará el chat real.
npm run build && npm start
```

Abrir `http://localhost:3000`. Para ejecutar el core sin IA: `npm run demo`, con el servidor detenido, porque la demo limpia `out/`.

## Paquete

El ZIP de trabajo se genera en `artifacts/reto-02-contratos.zip`. Contiene código, pruebas, fixtures y documentación; excluye `.env`, `node_modules/`, `out/`, `dist/`, capturas de pruebas y archivos de configuración personales. El archivo es una versión auditada con pendientes declarados, no una certificación de cumplimiento total.
