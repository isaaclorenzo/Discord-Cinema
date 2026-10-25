import { anthropicAdapter } from './anthropic'
import { mockAdapter } from './mock'
import { openAiAdapter } from './openai-compat'
import { withPromptTools } from './prompt-tools'
import { webLlmAdapter } from './webllm'
import type { ModelInfo, ProviderAdapter, ProviderConfig } from './types'

export function getAdapter(provider: ProviderConfig, model?: ModelInfo): ProviderAdapter {
  const base =
    provider.kind === 'anthropic' ? anthropicAdapter : provider.kind === 'mock' ? mockAdapter : provider.kind === 'webllm' ? webLlmAdapter : openAiAdapter
  return model?.toolMode === 'prompt' ? withPromptTools(base) : base
}

export function costOf(model: ModelInfo | undefined, inputTokens: number, outputTokens: number): number {
  if (!model?.priceIn && !model?.priceOut) return 0
  return (inputTokens * (model.priceIn ?? 0) + outputTokens * (model.priceOut ?? 0)) / 1_000_000
}

export * from './types'
