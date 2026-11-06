import OpenAI from 'openai'
import { getAiConfig, isConfigured, type AiConfig } from './config'

export interface ChatTurn {
  role: 'system' | 'user' | 'assistant'
  content: string
}

function createClient(config: AiConfig): OpenAI {
  return new OpenAI({
    // 本地 Ollama 等无需鉴权的服务也要求非空字符串
    apiKey: config.apiKey || 'local',
    baseURL: config.baseUrl,
    timeout: 120_000,
    maxRetries: 1,
  })
}

export async function* streamChat(
  turns: ChatTurn[],
  options: { signal?: AbortSignal; temperature?: number } = {},
): AsyncGenerator<string> {
  const config = getAiConfig()
  if (!isConfigured(config)) {
    throw new Error('AI 尚未配置。请先在「设置」页填写 Base URL、模型和 API Key。')
  }

  const client = createClient(config)
  const stream = await client.chat.completions.create(
    {
      model: config.model,
      messages: turns,
      temperature: options.temperature ?? 0.6,
      stream: true,
    },
    { signal: options.signal },
  )

  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta?.content
    if (delta) yield delta
  }
}

export async function completeChat(
  turns: ChatTurn[],
  options: { signal?: AbortSignal; temperature?: number; maxTokens?: number } = {},
): Promise<string> {
  const config = getAiConfig()
  if (!isConfigured(config)) {
    throw new Error('AI 尚未配置。请先在「设置」页填写 Base URL、模型和 API Key。')
  }

  const client = createClient(config)
  const completion = await client.chat.completions.create(
    {
      model: config.model,
      messages: turns,
      temperature: options.temperature ?? 0.3,
      max_tokens: options.maxTokens,
    },
    { signal: options.signal },
  )

  return completion.choices?.[0]?.message?.content ?? ''
}

/** 不依赖已保存配置的连通性测试。 */
export async function testConnection(input: {
  baseUrl: string
  model: string
  apiKey: string
}): Promise<string> {
  const client = createClient({
    baseUrl: input.baseUrl.replace(/\/+$/, ''),
    model: input.model,
    apiKey: input.apiKey || 'local',
    source: 'settings',
  })
  const completion = await client.chat.completions.create({
    model: input.model,
    messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
    temperature: 0,
    max_tokens: 10,
  })
  return completion.choices?.[0]?.message?.content ?? ''
}
