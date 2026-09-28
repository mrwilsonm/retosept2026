import { isoDate, type ContractRecord } from '../domain/contrato.js';
import { FileRepositories } from '../repositories/files.js';
import { OutputRepository } from '../repositories/output.js';

export function daysBetween(start: string, end: string): number {
  return (Date.parse(isoDate.parse(end)) - Date.parse(isoDate.parse(start))) / 86_400_000;
}
export async function generateAlerts(today: string, repo: FileRepositories) {
  isoDate.parse(today);
  const contracts = await repo.contracts();
  const vencen = contracts.filter(row => { const days = daysBetween(today, row.fecha_fin); return days >= 0 && days <= 60; });
  const polizas_pendientes = contracts.filter(row => row.requiere_poliza && row.estado_poliza !== 'vigente');
  const registrados_desde_corte = contracts.filter(row => row.fecha_registro >= '2026-05-30');
  const escape = (value: string) => value.replace(/\|/g, '\\|').replace(/[\r\n]/g, ' ');
  const table = (rows: ContractRecord[], last: string, value: (row: ContractRecord) => string) =>
    `| Contrato | Cliente | ${last} |\n|---|---|---|\n${rows.map(row => `| ${escape(row.id_contrato)} | ${escape(row.cliente)} | ${escape(value(row))} |`).join('\n') || '| — | Sin resultados | — |'}\n`;
  const content = `# Alertas de contratos\n\nFecha de referencia: ${today}\n\n## Contratos que vencen en 60 días o menos\n\n${table(vencen, 'Fecha fin / días', row => `${row.fecha_fin} / ${daysBetween(today, row.fecha_fin)}`)}\n## Pólizas pendientes\n\n${table(polizas_pendientes, 'Estado', row => row.estado_poliza)}\n## Registrados desde el corte 2026-05-30 (inclusivo)\n\n${table(registrados_desde_corte, 'Fecha registro', row => row.fecha_registro)}`;
  await new OutputRepository(repo.root).atomic('alertas.md', content);
  return { ruta: 'out/alertas.md', vencen, polizas_pendientes, registrados_desde_corte };
}
