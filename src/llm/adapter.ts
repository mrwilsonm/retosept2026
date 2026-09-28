export interface ToolCall { id: string; name: string; arguments: unknown }
export type Message = { role: 'user' | 'assistant' | 'tool'; content: string; calls?: ToolCall[]; callId?: string; name?: string; continuation?: unknown[] };
export interface ToolDefinition { name: string; description: string; parameters: Record<string, unknown> }
export interface LLMResponse { text: string; calls: ToolCall[]; inputTokens: number; outputTokens: number; continuation?: unknown[] }
export interface LLMAdapter {
  send(messages: Message[], tools: ToolDefinition[], instructions: string, maxOutputTokens: number): Promise<LLMResponse>;
}
