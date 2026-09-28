import { access, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
await access(new URL('fixtures/reto-02/maestro-contratos.csv', root));
await rm(fileURLToPath(new URL('out', root)), { recursive: true, force: true });
console.log('Salidas de demostración eliminadas. El próximo procesamiento partirá del maestro original.');
