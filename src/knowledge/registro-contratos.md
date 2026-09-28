# Registro de contratos
El maestro tiene una fila por contrato. RN1: ID, valor e intervalo iguales implican duplicado; no hay escritura contractual.
RN2: ID igual o NIT y objeto con similitud >= 0.9 permiten actualización. Los otrosíes heredan lo no modificado del maestro identificado.
RN3: sin coincidencia se registra nuevo. RN4: sin contrato, partes u objeto se rechaza.
RN5: confianza < 0.8 exige revisión. La confirmación no permite fechas inválidas ni campos obligatorios nulos.
RN6: fixtures de solo lectura; escrituras exclusivamente en out. RN7: auditoría de todas las herramientas.
Pólizas nuevas exigidas quedan pendientes. Cambios de plazo, valor o cobertura vuelven pendiente la póliza para revisar su ampliación.
Alertas: vencimientos desde hoy hasta hoy+60 inclusivos; pólizas exigidas no vigentes; registros desde 2026-05-30 inclusivo.
Duplicados y rechazados permanecen en el buzón porque el PRD prohíbe sus escrituras de negocio.
El agente no revisa cláusulas jurídicamente ni envía mensajes a comerciales.
