import type { ExtractedContract } from '../domain/contrato.js';
import type { Message } from '../llm/adapter.js';
export interface ToolView { id: string; name: string; arguments: unknown; result: unknown }
export interface PendingConfirmation { id: string; mensajeId: string; fields: string[]; contract: ExtractedContract }
export interface Session {
  id: string; messages: Message[]; toolCalls: ToolView[];
  pending: PendingConfirmation[]; today: string;
  usage: { inputTokens: number; outputTokens: number; reservedTokens: number };
  busy: boolean;
}
export function createSession(id: string, today: string): Session {
  return { id, today, messages: [], toolCalls: [], pending: [], usage: { inputTokens: 0, outputTokens: 0, reservedTokens: 0 }, busy: false };
}
