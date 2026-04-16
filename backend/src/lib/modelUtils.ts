import type { Provider } from '@opencode-ai/sdk/dist/gen/types.gen.js';

/**
 * Flatten a list of Provider objects (from config.providers() SDK response)
 * into a sorted array of model ID strings in the format "providerID/modelID".
 *
 * This preserves the existing /api/models response shape so the frontend model
 * picker continues to work without changes.
 */
export function flattenProviderModels(providers: Provider[]): string[] {
  const ids: string[] = [];
  for (const provider of providers) {
    for (const modelKey of Object.keys(provider.models)) {
      ids.push(`${provider.id}/${modelKey}`);
    }
  }
  return ids.sort();
}
