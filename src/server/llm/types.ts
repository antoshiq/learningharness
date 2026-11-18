// Provider-neutral message format. It mirrors Anthropic content blocks so that
// Anthropic responses (including thinking blocks, which must be replayed
// unchanged) can be stored verbatim; the OpenAI-compatible adapter converts.

export interface TextBlock {
  type: "text";
  text: string;
}
export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}
export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}
/** A picture in a user message (a photo of a solution), in the Anthropic shape. */
export interface ImageBlock {
  type: "image";
  source: { type: "base64"; media_type: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; data: string };
}
/** Any other provider-specific block (e.g. Anthropic `thinking`), kept opaque. */
export interface OpaqueBlock {
  type: string;
  [k: string]: unknown;
}
export type Block = TextBlock | ToolUseBlock | ToolResultBlock | ImageBlock | OpaqueBlock;

export interface ChatMsg {
  role: "user" | "assistant";
  content: Block[];
}

export interface ToolDef {
  name: string;
  description: string;
  /** JSON Schema of the input object */
  schema: Record<string, unknown>;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** USD when the provider reports it or the price is known; otherwise null. */
  cost: number | null;
}

export type StopReason = "end" | "tool_use" | "max_tokens" | "refusal";

export interface LlmRequest {
  model: string;
  system: string;
  messages: ChatMsg[];
  tools?: ToolDef[];
  maxTokens?: number;
  onText?: (delta: string) => void;
  signal?: AbortSignal;
}

export interface LlmResult {
  content: Block[];
  stopReason: StopReason;
  usage: LlmUsage;
}

export interface LlmProvider {
  id: string;
  chat(req: LlmRequest): Promise<LlmResult>;
  listModels(): Promise<string[]>;
}

export const isText = (b: Block): b is TextBlock => b.type === "text" && typeof (b as TextBlock).text === "string";
export const isToolUse = (b: Block): b is ToolUseBlock => b.type === "tool_use";
export const isToolResult = (b: Block): b is ToolResultBlock => b.type === "tool_result";
export const isImage = (b: Block): b is ImageBlock => b.type === "image" && !!(b as Partial<ImageBlock>).source?.data;

/** Pictures of all messages, in order (connections that take files attach them separately). */
export const imagesOf = (messages: ChatMsg[]): ImageBlock[] => messages.flatMap((m) => m.content.filter(isImage));

export class LlmError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}
