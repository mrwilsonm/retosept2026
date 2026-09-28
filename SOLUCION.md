# SOLUCIÓN — Registro de Contratos Vigentes

## 1. Problema

La analista administrativa necesita registrar los contratos que llegan al buzón único, recuperar visibilidad de vigencias y pólizas y conservar trazabilidad sin duplicar filas ni inventar datos.

## 2. Arquitectura

```text
React/Vite → Fastify → ciclo del agente → adaptador OpenAI Responses
                           ↓                 ↑
                    herramientas Zod → resultados
                           ↓
             extracción / validación / registro / alertas
                           ↓
              repositorios → fixtures (lectura) / out (escritura)
```

`demo.ts` llama las mismas cinco herramientas sin HTTP, interfaz ni proveedor. Comportamiento en `agent/prompt.md`, conocimiento en `src/knowledge/registro-contratos.md`, ejecución en `src/tools/contratos.ts`. Docker sirve frontend compilado y backend en un proceso.

## 3. Ciclo del agente

El adaptador recibe mensajes, definiciones de herramientas, instrucciones y límite de salida. El ciclo valida argumentos con Zod, ejecuta herramientas, agrega resultados y repite hasta obtener texto, revisión humana o alcanzar límites. Se registran llamadas en la conversación y en `out/log.jsonl`, incluso intentos bloqueados.

Hay límite de 25 iteraciones por defecto, presupuesto de sesión y presupuesto global. Antes de solicitar una respuesta se reserva una estimación conservadora basada en bytes UTF-8 del contexto más margen y salida máxima. Las respuestas exitosas ajustan el contador con el consumo reportado; los errores mantienen la reserva. Las sesiones y contadores viven en memoria.

El backend vuelve a extraer los datos en validación y registro; no acepta fechas ni confianza inventadas por el modelo. La confirmación se realiza mediante tarjeta con ID aleatorio, contrato y sesión. Un mensaje de texto no basta. El registro vuelve a validar aun con confirmación y exige completar campos obligatorios. Tras registrar una revisión se actualizan alertas.

## 4. Elección del modelo y costo

OpenAI fue seleccionado por el usuario. Se propone `gpt-4.1-mini` como configuración inicial: soporta llamadas a funciones y evita requerir razonamiento para reglas que ya ejecuta TypeScript. Es configurable. La clave se configuró y la llamada real devolvió HTTP 429 (`credit_balance_exhausted`); el usuario confirmó que el saldo sigue pendiente. Su calidad en este reto aún no se ha validado con una conversación real. [Ficha oficial de GPT-4.1 mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini).

El adaptador usa Responses con `store: false`, preserva las llamadas y sus resultados y conserva los elementos opacos de continuación del proveedor. Implementa timeout con AbortSignal y oculta cuerpos de error que podrían contener datos internos. [Guía oficial de function calling](https://developers.openai.com/api/docs/guides/function-calling).

Precios consultados el 28 de septiembre de 2026: USD 0.40 por millón de tokens de entrada y USD 1.60 de salida, sin asumir descuento por caché. Ejemplo hipotético de un caso con 20,000 tokens de entrada y 2,000 de salida: USD 0.0112. No es una medición del proyecto. Fórmula: `(entrada × precio_entrada + salida × precio_salida) / 1,000,000`. La interfaz muestra el consumo real reportado; actualizar precios al entregar. [Fuente de precios](https://developers.openai.com/api/docs/models/gpt-4.1-mini).

## 5. Estrategia de extracción

Regex por cláusulas, normalización de identificadores, separadores monetarios y fechas españolas. El domicilio del cliente determina país, evitando confundirlo con el domicilio colombiano del contratista. El valor sale de la cláusula VALOR, nunca del umbral de garantías.

Confianzas: datos explícitos 1; país por domicilio 0.95; póliza o su ausencia en texto completo 0.9; moneda de otra cláusula en contrato por demanda 0.85; fecha derivada 0.7; valor por demanda 0.6; ausencias 0. Son heurísticas, no probabilidades calibradas.

La extracción de un otrosí conserva los ausentes como null; la validación hereda del maestro identificado lo no modificado y anota su procedencia. El objeto se limita a 200 caracteres y conserva texto completo y aviso de truncamiento en evidencia.

## 6. Regla de gobierno propuesta

**Canal único:** `contratos@periferia-ficticia.com`, administrado por la analista responsable del maestro, con suplente designado por la jefatura administrativa.

**Obligación comercial:** remitir PDF firmado, otrosíes, actas de terminación y soportes de pólizas dentro de dos días hábiles desde su firma. Asunto `[CONTRATO] cliente - número` o `[OTROSI] cliente - número`. Aplica aunque no se exija póliza.

**Acuse:** respuesta objetivo en cinco minutos con ID de recepción y estado: registrado, pendiente de información o revisión. El presente reto simula archivos y no envía correos reales.

**Excepciones:** documentos sin firma, sin datos esenciales o con contradicciones pasan a revisión. Un contrato explícitamente por demanda admite valor cero confirmado. Si el comercial no aclara en dos días hábiles, se escala a su líder y al responsable administrativo; el caso permanece abierto. Las cuestiones jurídicas se remiten al asesor externo designado por la organización, sin atribuir competencias jurídicas al agente.

**Cierre del gap:** campaña única de dos semanas para junio–agosto de 2026. Cada comercial entrega su inventario y administración lo cruza con facturación y pólizas, solicita soportes y registra responsables de cada faltante. Esta campaña se diseña, no se ejecuta en el reto.

**Indicador mensual:** contratos facturados presentes en el maestro / contratos facturados identificados, meta 100%. Publicar faltantes y responsable de cierre junto al indicador.

## 7. Decisiones y trade-offs

1. **CSV/JSON frente a PostgreSQL:** cumple el PRD y permite inspección directa. Se agrega journal de recuperación y serialización en un proceso; no permite varias réplicas escritoras.
2. **Extracción determinística frente a LLM-first:** reproducibilidad y valor final verificable; los formatos nuevos requieren ampliar reglas.
3. **Levenshtein normalizado frente a embeddings:** umbral 0.9 estable y comprobable; no detecta toda equivalencia semántica.
4. **Sesiones en memoria frente a Redis:** reduce infraestructura; reiniciar pierde conversaciones y contadores, aunque conserva contratos.
5. **Confirmación estructurada frente a interpretar “sí” con el LLM:** vincula correcciones al contrato exacto; exige completar la tarjeta aun si se expresa aprobación por texto.
6. **HTTP sin streaming frente a WebSockets:** API más sencilla; las llamadas se muestran al terminar el turno, con indicador de procesamiento mientras tanto.

Zod es el contrato runtime; csv-parse evita errores de CSV; Fastify expone API; React/Vite construyen la interfaz; Vitest y Playwright prueban lógica y navegador. No se usa SDK de IA: fetch queda encapsulado en el adaptador.

## 8. Supuestos

- `msg-006` no especifica el día de inicio: revisión de valor, fecha_inicio y fecha_fin. Las fechas de la demo son correcciones humanas expresamente simuladas.
- Las fechas de registro se toman del argumento `hoy`; fuera de demo, el backend usa la fecha de referencia de sesión. Las actualizaciones conservan la fecha de registro original.
- Ampliar plazo, valor o cobertura devuelve a pendiente una póliza previamente vigente, para verificar su ampliación.
- Duplicados y rechazados no se marcan procesados: no hay escrituras de negocio, pero sí auditoría obligatoria.
- La ruta principal conserva el último documento recibido; `versiones/<id>/<mensaje>.txt` conserva cada adjunto nuevo. Los PDF históricos referenciados en el CSV original no fueron entregados y no se inventan.
- RN1 precede a diferencias de redacción: ID, valor e intervalo iguales son duplicado salvo otrosí. Conflictos de identificación siguen visibles.
- La demo limpia exclusivamente la carpeta de salidas del proyecto; debe ejecutarse sin servidor activo.

## 9. Cobertura y validación

| Historia | Estado | Evidencia / límite |
|---|---|---|
| HU-1 | Hecho | Pendientes, adjuntos y errores aislados de correos |
| HU-2 | Parcial | Fixtures cubiertos; falta corregir extracción de inicio explícito más meses sin «hasta» |
| HU-3 | Hecho | Seis clasificaciones, diferencias y comercial |
| HU-4 | Hecho | Validación, confirmación, archivo, historial, procesados y reintentos |
| HU-5 | Hecho | Alertas por fecha explícita y corte inclusivo |
| HU-6 | Parcial | Errores, timeout y aislamiento probados; moneda desconocida retorna éxito con null y debe retornar error según PRD |
| Agente real | Bloqueado por saldo | Clave configurada; prueba real HTTP 429 credit_balance_exhausted |
| Frontend/API | Implementado | Compilación, pruebas API y pruebas de navegador |
| Docker | Configuración preparada | No ejecutado: Docker no está instalado en esta máquina |
| URL pública | Pendiente | Falta plataforma y despliegue real |
| RN6 | Parcial | Fixture intacto; el maestro de salida se materializa al registrar, no en primera lectura |
| Código para entrega | ZIP disponible | Git local inicializado; destino mrwilsonm/retosept2026; publicación pendiente de autenticación |

Las pruebas usan directorios temporales y comprueban escrituras, bloqueo, confirmación, reintentos concurrentes, herencia del otrosí, límites de ejecución y contrato HTTP. La demo ejecuta seis casos completos sin API key. La entrega no se considera desplegada ni validada contra OpenAI hasta completar esas comprobaciones externas. La auditoría adicional, sus reproducciones y las decisiones pendientes están en [INFORME_CUMPLIMIENTO.md](docs/INFORME_CUMPLIMIENTO.md).

## 10. Uso de IA

Codex ayudó a leer el PRD, implementar el core, adaptador, API, interfaz, pruebas y documentación. Se usó la skill OpenAI Docs para contrastar el adaptador con documentación oficial. Se descartó inventar el día de firma de `msg-006` para coincidir con el ejemplo del PRD. También se sustituyeron dependencias tras avisos de npm audit. El responsable de la entrega debe revisar el código y poder defender sus decisiones.

## 11. Riesgos de producción

Los extractores están orientados a los textos entregados, no validados sobre contratos arbitrarios. PDFs escaneados requerirán OCR y calibración de confianza. Se necesitan autenticación, autorización, retención de conversaciones y protección de presupuestos persistente antes de uso real.

Las confirmaciones son de una sesión en memoria; en un sistema multiusuario haría falta versionar la revisión contra el maestro para rechazar decisiones obsoletas. El mutex es de proceso: una segunda instancia compartiendo `out/` puede interferir. El journal permite roll-forward después de interrupciones ordinarias, pero no ofrece las garantías de una base de datos ante fallos del almacenamiento. El consumo de IA y su calidad deben medirse con una clave y modelo reales antes de publicar el enlace.
