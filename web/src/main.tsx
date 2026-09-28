import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

type Field = { valor: string | number | boolean | null; confianza: number; evidencia?: string };
type Pending = { id: string; mensajeId: string; fields: string[]; contract: Record<string, Field> };
type Tool = { id: string; name: string; arguments: unknown; result: { ok?: boolean; data?: unknown; error?: string } };
type ChatMessage = { role: string; content: string };
type ResponseData = { reply?: string; messages: ChatMessage[]; toolCalls: Tool[]; pendingConfirmations: Pending[]; usage: { inputTokens: number; outputTokens: number } };
function toolSummary(tool: Tool): string {
  if (!tool.result.ok) return 'Revisar';
  const data = tool.result.data;
  if (typeof data !== 'object' || data === null) return 'Completado';
  if ('clasificacion' in data && typeof data.clasificacion === 'string') return data.clasificacion;
  if ('accion' in data && typeof data.accion === 'string') return data.accion;
  if ('mensajes' in data && Array.isArray(data.mensajes)) return `${data.mensajes.length} mensajes`;
  if ('vencen' in data && Array.isArray(data.vencen)) return `${data.vencen.length} vencimientos`;
  return 'Completado';
}
async function api<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'No se pudo completar la solicitud');
  return data as T;
}
function Review({ pending, busy, onDecision }: { pending: Pending; busy: boolean; onDecision: (decision: string, corrections: Record<string, unknown>) => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [invalid, setInvalid] = useState('');
  function change(key: string, value: string) { setValues(previous => ({ ...previous, [key]: value })); setInvalid(''); }
  function submit() {
    const corrections: Record<string, unknown> = {};
    for (const key of pending.fields) {
      const field = pending.contract[key];
      if (!field) continue;
      const raw = values[key] ?? (field.valor === null ? '' : String(field.valor));
      if (!raw && key !== 'tipo_poliza') { setInvalid(`Completa ${key.replaceAll('_', ' ')} antes de confirmar.`); return; }
      corrections[key] = key === 'valor' ? Number(raw) : key === 'requiere_poliza' ? raw === 'true' : raw;
    }
    setInvalid(''); onDecision('confirmar', corrections);
  }
  return <section className="review" aria-label={`Revisar ${pending.mensajeId}`}>
    <span className="eyebrow">REVISIÓN HUMANA</span><h3>Confirma los datos de {pending.mensajeId}</h3>
    <p>Los campos inciertos no se guardan hasta que revises su evidencia y completes los valores.</p>
    {pending.fields.map(key => { const field = pending.contract[key]; return <label key={key} className="review-field">
      <span>{key.replaceAll('_', ' ')} <small>{field ? `${Math.round(field.confianza * 100)}% de confianza` : 'Conflicto de coincidencia'}</small></span>
      {field && (key === 'requiere_poliza' ? <select value={values[key] ?? String(field.valor ?? '')} onChange={e => change(key, e.target.value)}><option value="">Selecciona</option><option value="true">Sí</option><option value="false">No</option></select>
        : <input type={key.startsWith('fecha_') ? 'date' : key === 'valor' ? 'number' : 'text'} min={key === 'valor' ? 0 : undefined} step={key === 'valor' ? 'any' : undefined} value={values[key] ?? (field.valor === null ? '' : String(field.valor))} onChange={e => change(key, e.target.value)}/>)}
      <small>{field?.evidencia ?? 'Se requiere identificar manualmente el contrato base.'}</small>
    </label>; })}
    {invalid && <p role="alert">{invalid}</p>}
    <div className="actions"><button disabled={busy} onClick={submit}>Confirmar y registrar</button><button className="secondary" disabled={busy} onClick={() => onDecision('rechazar', {})}>Rechazar</button></div>
  </section>;
}
function App() {
  const [sessionId, setSessionId] = useState(() => sessionStorage.getItem('contract-session') ?? crypto.randomUUID());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [health, setHealth] = useState<{ configured: boolean; model: string } | null>(null);
  const [report, setReport] = useState('');
  const [usage, setUsage] = useState({ inputTokens: 0, outputTokens: 0 });
  useEffect(() => {
    sessionStorage.setItem('contract-session', sessionId);
    void api<typeof health>('/api/health').then(setHealth).catch(() => setError('No se pudo conectar con el servidor.'));
    void api<ResponseData>(`/api/sessions/${sessionId}`).then(data => { setMessages(data.messages); setTools(data.toolCalls); setPending(data.pendingConfirmations); setUsage(data.usage); }).catch(() => undefined);
  }, [sessionId]);
  async function send(message: string, confirmation?: { id: string; decision: string; corrections: Record<string, unknown> }) {
    if (busy) return;
    setBusy(true); setError(''); setText('');
    try {
      const result = await api<ResponseData>('/api/chat', { sessionId, message, ...(confirmation ? { confirmation } : {}) });
      setMessages(result.messages); setTools(previous => [...previous, ...result.toolCalls]); setPending(result.pendingConfirmations); setUsage(result.usage);
    } catch (e) { setError(e instanceof Error ? e.message : 'Error de conexión'); setText(message); }
    finally { setBusy(false); }
  }
  return <div className="app">
    <header><div className="brand-mark">RC</div><div><span className="eyebrow">OPERACIONES · RETO 02</span><h1>Registro de Contratos</h1></div><span className={`status ${health?.configured ? 'ready' : ''}`}><i/>{health?.configured ? 'IA configurada' : 'IA sin configurar'}</span></header>
    <div className="page-heading"><div><h2>Todo contrato, en un solo lugar.</h2><p>Procesa el buzón, revisa los datos y conserva la trazabilidad de cada decisión.</p></div><button className="secondary" disabled={busy} onClick={() => { setMessages([]); setTools([]); setPending([]); setReport(''); setSessionId(crypto.randomUUID()); }}>Nueva conversación</button></div>
    {!health?.configured && <div className="notice">Para activar el chat, configura LLM_API_KEY y LLM_MODEL en el archivo .env del servidor. La demo sin IA está disponible con npm run demo.</div>}
    <main><section className="chat-panel"><div className="panel-heading"><h3>Asistente de contratos</h3><span>Conversación</span></div>
      <div className="messages" aria-live="polite">
        {!messages.length && <div className="welcome"><div className="welcome-icon">↗</div><h3>Empecemos por el buzón</h3><p>El asistente extrae y valida los contratos. Tú decides sobre los datos que necesitan revisión.</p><button className="suggestion" disabled={busy || !health?.configured} onClick={() => void send('Procesa el buzón con fecha de referencia 2026-09-03. Registra lo permitido, pide revisión de campos dudosos y genera alertas.')}>Procesar buzón · 3 sep 2026 <span>→</span></button></div>}
        {messages.map((message, i) => <article key={i} className={`message ${message.role}`}><span className="message-label">{message.role === 'user' ? 'Tú' : 'Asistente'}</span><p>{message.content}</p></article>)}
        {pending.map(item => <Review key={item.id} pending={item} busy={busy} onDecision={(decision, corrections) => void send(`Revisión de ${item.mensajeId}: ${decision}`, { id: item.id, decision, corrections })}/>)}
        {busy && <p className="thinking" role="status">Procesando contratos…</p>}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <form onSubmit={e => { e.preventDefault(); if (text.trim()) void send(text); }}><label className="sr-only" htmlFor="message">Mensaje para el asistente</label><textarea id="message" rows={2} value={text} onChange={e => setText(e.target.value)} placeholder="Pide procesar el buzón, continuar o generar alertas…" disabled={busy}/><button disabled={busy || !text.trim() || !health?.configured}>Enviar ↑</button></form>
    </section><aside><div className="panel-heading"><h3>Actividad</h3><span>{tools.length} llamadas</span></div><p className="aside-intro">Cada acción muestra sus argumentos y el resultado de la herramienta.</p>
      <div className="tool-list">{!tools.length && <p className="empty">Las acciones aparecerán aquí al iniciar el procesamiento.</p>}{tools.map((tool, i) => <details className="tool" key={`${tool.id}-${i}`}><summary><span className={tool.result.ok ? 'success-dot' : 'error-dot'}/><span>{tool.name.replace('contratos_', '').replaceAll('_', ' ')}</span><small>{toolSummary(tool)}</small></summary><h4>Argumentos</h4><pre>{JSON.stringify(tool.arguments, null, 2)}</pre><h4>Resultado</h4><pre>{JSON.stringify(tool.result, null, 2)}</pre></details>)}</div>
      <div className="report-box"><h3>Reporte de alertas</h3><p>Vencimientos, pólizas y cobertura desde el corte.</p><button className="secondary" onClick={() => void api<{ markdown: string }>('/api/alerts').then(data => setReport(data.markdown)).catch(e => setError(e.message))}>Ver último reporte ↗</button></div>
      <p className="usage">Tokens de entrada: {usage.inputTokens.toLocaleString()} · salida: {usage.outputTokens.toLocaleString()}</p>
    </aside></main>{report && <section className="report"><div className="panel-heading"><h3>Alertas de contratos</h3><button className="secondary" onClick={() => setReport('')}>Cerrar</button></div><pre>{report}</pre></section>}
    <footer>Datos del reto · Los documentos originales se conservan intactos.<span>Revisión humana · Historial · Trazabilidad</span></footer>
  </div>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
