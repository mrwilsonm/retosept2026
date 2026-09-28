import { z } from 'zod';
import type { LLMAdapter, LLMResponse, Message, ToolDefinition } from './adapter.js';

const responseSchema = z.object({
  status: z.string(),
  output: z.array(z.object({ type: z.string() }).passthrough()),
  usage: z.object({ input_tokens: z.number().nonnegative(), output_tokens: z.number().nonnegative() }),
});
/** Stateless Responses API adapter. No secrets or provider error payloads are logged. */
export class OpenAIAdapter implements LLMAdapter {
  constructor(private readonly config: { apiKey: string; model: string; timeout: number }, private readonly request: typeof fetch = fetch) {}
  async send(messages: Message[], tools: ToolDefinition[], instructions: string, maxOutputTokens: number): Promise<LLMResponse> {
    if (!this.config.apiKey || !this.config.model) throw new Error('Configura LLM_API_KEY y LLM_MODEL en el backend.');
    const input: unknown[] = [];
    for (const message of messages) {
      if (message.continuation) input.push(...message.continuation);
      else if (message.role === 'tool') input.push({ type: 'function_call_output', call_id: message.callId, output: message.content });
      else {
        if (message.content) input.push({ role: message.role, content: message.content });
        for (const call of message.calls ?? []) input.push({ type: 'function_call', call_id: call.id, name: call.name, arguments: JSON.stringify(call.arguments) });
      }
    }
    try {
      const response = await this.request('https://api.openai.com/v1/responses', {
        method: 'POST', headers: { Authorization: `Bearer ${this.config.apiKey}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(this.config.timeout),
        body: JSON.stringify({ model: this.config.model, instructions, input, store: false, include: ['reasoning.encrypted_content'],
          max_output_tokens: maxOutputTokens, parallel_tool_calls: false,
          tools: tools.map(tool => ({ type: 'function', ...tool, strict: false })),
        }),
      });
      if (!response.ok) throw new Error(`El proveedor de IA devolvió HTTP ${response.status}. Revisa la configuración o reintenta.`);
      const parsed = responseSchema.parse(await response.json());
      const result: LLMResponse = { text: '', calls: [], inputTokens: parsed.usage.input_tokens, outputTokens: parsed.usage.output_tokens, continuation: parsed.output };
      for (const item of parsed.output) {
        if (item.type === 'function_call') {
          const call = z.object({ call_id: z.string(), name: z.string(), arguments: z.string() }).parse(item);
          let args: unknown;
          try { args = JSON.parse(call.arguments); } catch { args = null; }
          result.calls.push({ id: call.call_id, name: call.name, arguments: args });
        } else if (item.type === 'message') {
          const content = z.object({ content: z.array(z.object({ type: z.string(), text: z.string().optional() })) }).parse(item);
          result.text += content.content.filter(part => part.type === 'output_text').map(part => part.text ?? '').join('\n');
        }
      }
      if (parsed.status !== 'completed' && !result.text && !result.calls.length) result.text = 'La respuesta alcanzó el límite de salida. Puedes continuar en otro turno.';
      return result;
    } catch (error) {
      if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) throw new Error('El proveedor de IA no respondió a tiempo. Puedes reintentar.');
      if (error instanceof Error && error.message.startsWith('El proveedor')) throw error;
      throw new Error('No se pudo completar la respuesta del proveedor de IA. Puedes reintentar.');
    }
  }
}
