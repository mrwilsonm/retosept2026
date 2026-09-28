# Registro de Contratos Vigentes — Reto 02

Aplicación con chat React, API Fastify, agente con OpenAI Responses y cinco herramientas determinísticas. El [PRD original](docs/PRD.md) y el [plan de implementación](docs/IMPLEMENTACION_RETO_02.md) están en `docs/`.

## Estado de la entrega

Implementados: lectura, extracción, validación, registro, archivado, historial, alertas, revisión humana, agente, API y frontend. La demo procesa los seis casos sin modelo. Las pruebas automatizadas del proveedor usan respuestas simuladas. **La clave ya se configuró y se intentó una llamada real: OpenAI respondió HTTP 429, `credit_balance_exhausted`. No hay todavía una conversación real exitosa.** El usuario confirmó que el saldo sigue pendiente.

Dockerfile y Compose preparados. Docker no estaba instalado en el equipo de desarrollo, por lo que la imagen está pendiente de ejecución. **URL pública: pendiente de desplegar en un alojamiento elegido por el usuario.**

La auditoría contra el PDF permitió corregir moneda desconocida, plazo en meses e inicialización del maestro. Consulta [el informe de cumplimiento](docs/INFORME_CUMPLIMIENTO.md) y [el índice de entrega](ENTREGA.md). No se declara cierre del 100% del reto.

## Ejecutar localmente

Requiere Node 24 recomendado; mínimo 22.12.

```bash
nvm install
nvm use
npm ci
cp -n .env.example .env
```

Configura `LLM_API_KEY` en `.env`. El modelo inicial es `gpt-4.1-mini`, configurable con `LLM_MODEL`. No compartas la clave en el frontend ni la agregues al repositorio.

```bash
npm run build && npm start
```

Abre http://localhost:3000. Este comando compila frontend y backend y arranca el servidor; después de editar TypeScript o React vuelve a compilar. Para ejecutar una compilación existente: `npm start`. `npm run dev` también compila y arranca sin vigilancia. La vigilancia queda en `npm run dev:watch`; en este equipo produjo `EMFILE`.

Si la terminal usa Node 15 aunque tengas Node 24 instalado en `/usr/local/bin`, utiliza `PATH=/usr/local/bin:$PATH npm start`.

## Demo y pruebas sin clave

```bash
npm run typecheck
npm test
npm run demo
npm run build
```

La demo **limpia `out/` al inicio** y usa `2026-09-03` como fecha fija. No la ejecutes mientras el servidor esté procesando contratos. Es una operación de demostración sobre salidas generadas, nunca sobre fixtures.

| Mensaje | Resultado |
|---|---|
| msg-001 | Nuevo, póliza pendiente |
| msg-002 | Nuevo, sin póliza |
| msg-003 | Actualiza una fila, agrega historial; póliza queda pendiente de ampliación |
| msg-004 | Duplicado, sin escritura de negocio |
| msg-005 | Rechazado, sin escritura de negocio |
| msg-006 | Bloqueado; se registra tras corrección y confirmación simuladas |

`msg-006` solo indica el mes de firma. La demo identifica expresamente como **datos humanos simulados** el inicio `2026-08-31` y el fin `2027-08-31`; no los presenta como extracción del texto.

Tras ejecutar la demo, los casos registrados ya no aparecen pendientes en el chat. Para ensayar desde cero, detén el servidor y ejecuta `npm run reset:demo`; luego inicia una conversación nueva.

## Pruebas de navegador

Usan un proveedor simulado y archivos temporales; no consumen OpenAI ni alteran `out/` del proyecto.

```bash
npx playwright install chromium
npm run test:e2e
```

Si tienes Chrome instalado puedes usar `PLAYWRIGHT_CHANNEL=chrome npm run test:e2e`. Las capturas quedan en `test-results/` y se excluyen del repositorio.

## Conversación de prueba

> Procesa el buzón con fecha de referencia 2026-09-03. Registra lo permitido, pide revisión de campos dudosos y genera alertas.

La tarjeta de `msg-006` permite revisar valor e introducir fechas. El backend vincula la confirmación a la sesión y al contrato; ni un `confirmado=true` del modelo ni un mensaje genérico «confirmo todo» autorizan la escritura. Si escribes la confirmación en el chat, el asistente te pide completar la tarjeta.

Después de confirmar se recalculan las alertas. Puedes pedir continuar con el buzón. Duplicados y rechazados se mantienen pendientes porque no generan escrituras de negocio, según RN1/RN4.

## Variables

| Variable | Valor de ejemplo | Uso |
|---|---|---|
| PORT | 3000 | Puerto HTTP |
| HOST | 127.0.0.1 | Interfaz local; Docker usa 0.0.0.0 |
| LLM_PROVIDER | openai | Proveedor implementado |
| LLM_MODEL | gpt-4.1-mini | Modelo con function calling |
| LLM_API_KEY | vacío | Solo backend |
| LLM_TIMEOUT_MS | 30000 | Cancela solicitudes al proveedor |
| AGENT_MAX_ITERATIONS | 25 | Iteraciones por turno |
| AGENT_MAX_TOKENS | 200000 | Presupuesto acumulado por sesión |
| APP_MAX_TOKENS | 1000000 | Presupuesto global de esta instancia |

Se reserva un presupuesto conservador antes de cada llamada. Una llamada fallida conserva la reserva, porque su consumo puede ser incierto. Las sesiones y contadores son de memoria y se reinician con el servidor; los datos contractuales permanecen en `out/`.

## API

- `POST /api/chat`: `{ sessionId, message, hoy? }` → `{ reply, messages, toolCalls, needsConfirmation, pendingConfirmations, usage }`.
- Confirmación en la misma ruta: `{ sessionId, confirmation: { id, decision: "confirmar" | "rechazar", corrections: { fecha_inicio, fecha_fin, valor, ... } } }`. `id` proviene de la tarjeta pendiente de esa sesión.
- `GET /api/sessions/:id`: conversación visible, historial completo de herramientas y pendientes.
- `GET /api/health`: proveedor, modelo y estado de configuración, sin claves.
- `GET /api/alerts`: último reporte Markdown generado.

No hay autenticación, conforme al alcance del reto. El estado de configuración no certifica conectividad con el proveedor. Un turno activo excluye otros turnos concurrentes; la API responde 409 para reintentar.

## Archivos generados

```text
out/
├── log.jsonl
├── procesados.json
├── registros.json
├── alertas.md
└── sharepoint/
    ├── maestro-contratos.csv
    ├── historial.jsonl
    ├── Contratos/<año>/<cliente>/<id>.txt
    └── versiones/<id>/<mensaje>.txt
```

Los registros incluyen recibos para reintentos idempotentes. Una transacción pendiente se recupera antes de la siguiente herramienta. Se serializan operaciones dentro de un proceso: **no ejecutar varias réplicas o procesos escribiendo en el mismo `out/`**. El journal permite recuperación tras interrupciones; no constituye una transacción de base de datos con garantías frente a fallos de disco.

## Docker

Con Docker instalado y `.env` configurado:

```bash
docker compose up --build
```

Sirve frontend y API en el puerto 3000, ejecuta como usuario sin privilegios y persiste resultados en un volumen. La construcción comprueba tipos, pruebas unitarias/integración y compilación; no necesita clave para esas verificaciones. `.env` queda fuera de la imagen.

Para un alojamiento compatible con Docker: construir el Dockerfile, configurar variables, publicar el puerto 3000, montar almacenamiento persistente en `/app/out` y mantener una sola réplica. Falta elegir el alojamiento y registrar aquí la URL real tras probarla.

## Estructura y decisiones

- `src/domain/`, `src/services/`: reglas independientes del modelo.
- `src/repositories/`: fixtures, persistencia, journal y auditoría.
- `src/tools/contratos.ts`: cinco herramientas con Zod.
- `src/llm/`: interfaz de proveedor y adaptador OpenAI.
- `src/agent/`: ciclo, sesiones y control de confirmación.
- `agent/prompt.md`, `src/knowledge/`: comportamiento y conocimiento externos.
- `web/`: React/Vite, chat, herramientas y revisión.
- `tests/`: core, API, proveedor simulado y navegador.

Consulta [SOLUCION.md](SOLUCION.md) para supuestos, modelo, costos, regla de gobierno y riesgos pendientes.
