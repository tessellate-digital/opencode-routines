// Provider catalog mirroring what `opencode /connect` offers.
// Each entry maps to the env var(s) a user needs to supply.
// `fields` describes what to prompt for — the first field whose key is
// stored as a Setting is used to detect whether the provider is configured.

export interface ProviderField {
  key: string; // the env var / settings key
  label: string; // human label
  placeholder: string;
  secret: boolean;
}

export interface Provider {
  id: string;
  name: string;
  description: string;
  docsUrl: string;
  fields: ProviderField[];
  /** When set, this provider uses OAuth device flow instead of manual field entry. */
  authFlow?: 'device';
  /** Show in the default "popular" view of the provider picker. */
  popular?: boolean;
}

// ---------------------------------------------------------------------------
// Popular providers (shown by default)
// ---------------------------------------------------------------------------

const POPULAR: Provider[] = [
  {
    id: 'opencode',
    name: 'OpenCode Zen',
    description: 'Curated models maintained by the OpenCode team.',
    docsUrl: 'https://opencode.ai/docs/providers#opencode-zen',
    popular: true,
    fields: [
      {
        key: 'OPENCODE_API_KEY',
        label: 'API key',
        placeholder: 'sk-…',
        secret: true,
      },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    description: 'Claude 3.x and Claude 4 model family.',
    docsUrl: 'https://opencode.ai/docs/providers#anthropic',
    popular: true,
    fields: [
      {
        key: 'ANTHROPIC_API_KEY',
        label: 'API key',
        placeholder: 'sk-ant-…',
        secret: true,
      },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'GPT-4o, o3, and other OpenAI models.',
    docsUrl: 'https://opencode.ai/docs/providers#openai',
    popular: true,
    fields: [
      {
        key: 'OPENAI_API_KEY',
        label: 'API key',
        placeholder: 'sk-…',
        secret: true,
      },
    ],
  },
  {
    id: 'github-copilot',
    name: 'GitHub Copilot',
    description: 'Use your existing Copilot subscription.',
    docsUrl: 'https://opencode.ai/docs/providers#github-copilot',
    popular: true,
    authFlow: 'device',
    fields: [
      {
        key: 'GITHUB_TOKEN',
        label: 'GitHub token',
        placeholder: 'gho_…',
        secret: true,
      },
    ],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    description: 'Unified gateway to 200+ models.',
    docsUrl: 'https://opencode.ai/docs/providers#openrouter',
    popular: true,
    fields: [
      {
        key: 'OPENROUTER_API_KEY',
        label: 'API key',
        placeholder: 'sk-or-…',
        secret: true,
      },
    ],
  },
  {
    id: 'google-vertex',
    name: 'Google Vertex AI',
    description: 'Gemini and other Google models via Vertex AI.',
    docsUrl: 'https://opencode.ai/docs/providers#google-vertex-ai',
    popular: true,
    fields: [
      {
        key: 'GOOGLE_CLOUD_PROJECT',
        label: 'GCloud project ID',
        placeholder: 'my-project-123',
        secret: false,
      },
      {
        key: 'GOOGLE_APPLICATION_CREDENTIALS',
        label: 'Service account JSON path',
        placeholder: '/path/to/key.json',
        secret: false,
      },
    ],
  },
  {
    id: 'amazon-bedrock',
    name: 'Amazon Bedrock',
    description: 'Claude, Llama and other models via AWS Bedrock.',
    docsUrl: 'https://opencode.ai/docs/providers#amazon-bedrock',
    popular: true,
    fields: [
      {
        key: 'AWS_ACCESS_KEY_ID',
        label: 'AWS access key ID',
        placeholder: 'AKIA…',
        secret: false,
      },
      {
        key: 'AWS_SECRET_ACCESS_KEY',
        label: 'AWS secret access key',
        placeholder: '…',
        secret: true,
      },
      {
        key: 'AWS_REGION',
        label: 'AWS region',
        placeholder: 'us-east-1',
        secret: false,
      },
    ],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    description: 'DeepSeek Coder and DeepSeek Reasoner.',
    docsUrl: 'https://opencode.ai/docs/providers#deepseek',
    popular: true,
    fields: [
      {
        key: 'DEEPSEEK_API_KEY',
        label: 'API key',
        placeholder: 'sk-…',
        secret: true,
      },
    ],
  },
  {
    id: 'groq',
    name: 'Groq',
    description: 'Ultra-fast inference on Llama, Mixtral and more.',
    docsUrl: 'https://opencode.ai/docs/providers#groq',
    popular: true,
    fields: [
      {
        key: 'GROQ_API_KEY',
        label: 'API key',
        placeholder: 'gsk_…',
        secret: true,
      },
    ],
  },
  {
    id: 'ollama',
    name: 'Ollama (local)',
    description: 'Run models locally via Ollama.',
    docsUrl: 'https://opencode.ai/docs/providers#ollama',
    popular: true,
    fields: [
      {
        key: 'OLLAMA_BASE_URL',
        label: 'Base URL',
        placeholder: 'http://localhost:11434/v1',
        secret: false,
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// All other providers (shown when the user expands or searches)
// ---------------------------------------------------------------------------

const OTHER: Provider[] = [
  {
    id: '302ai',
    name: '302.AI',
    description: 'Chinese AI cloud platform with multiple models.',
    docsUrl: 'https://opencode.ai/docs/providers#302ai',
    fields: [
      {
        key: '302AI_API_KEY',
        label: 'API key',
        placeholder: '…',
        secret: true,
      },
    ],
  },
  {
    id: 'azure-openai',
    name: 'Azure OpenAI',
    description: 'OpenAI models hosted on Microsoft Azure.',
    docsUrl: 'https://opencode.ai/docs/providers#azure-openai',
    fields: [
      {
        key: 'AZURE_OPENAI_API_KEY',
        label: 'API key',
        placeholder: '…',
        secret: true,
      },
      {
        key: 'AZURE_RESOURCE_NAME',
        label: 'Resource name',
        placeholder: 'my-resource',
        secret: false,
      },
    ],
  },
  {
    id: 'azure-cognitive',
    name: 'Azure Cognitive Services',
    description: 'OpenAI models via Azure Cognitive Services endpoint.',
    docsUrl: 'https://opencode.ai/docs/providers#azure-cognitive-services',
    fields: [
      {
        key: 'AZURE_COGNITIVE_SERVICES_API_KEY',
        label: 'API key',
        placeholder: '…',
        secret: true,
      },
      {
        key: 'AZURE_COGNITIVE_SERVICES_RESOURCE_NAME',
        label: 'Resource name',
        placeholder: 'my-resource',
        secret: false,
      },
    ],
  },
  {
    id: 'baseten',
    name: 'Baseten',
    description: 'Deploy and run ML models with Baseten.',
    docsUrl: 'https://opencode.ai/docs/providers#baseten',
    fields: [
      {
        key: 'BASETEN_API_KEY',
        label: 'API key',
        placeholder: '…',
        secret: true,
      },
    ],
  },
  {
    id: 'cerebras',
    name: 'Cerebras',
    description: 'Wafer-scale chip inference, Llama and Qwen.',
    docsUrl: 'https://opencode.ai/docs/providers#cerebras',
    fields: [
      {
        key: 'CEREBRAS_API_KEY',
        label: 'API key',
        placeholder: '…',
        secret: true,
      },
    ],
  },
  {
    id: 'cloudflare-ai-gateway',
    name: 'Cloudflare AI Gateway',
    description: 'Unified endpoint for multiple AI providers via Cloudflare.',
    docsUrl: 'https://opencode.ai/docs/providers#cloudflare-ai-gateway',
    fields: [
      {
        key: 'CLOUDFLARE_ACCOUNT_ID',
        label: 'Account ID',
        placeholder: '…',
        secret: false,
      },
      {
        key: 'CLOUDFLARE_GATEWAY_ID',
        label: 'Gateway ID',
        placeholder: '…',
        secret: false,
      },
      {
        key: 'CLOUDFLARE_API_TOKEN',
        label: 'API token',
        placeholder: '…',
        secret: true,
      },
    ],
  },
  {
    id: 'cloudflare-workers-ai',
    name: 'Cloudflare Workers AI',
    description: 'Run AI models on Cloudflare global network.',
    docsUrl: 'https://opencode.ai/docs/providers#cloudflare-workers-ai',
    fields: [
      {
        key: 'CLOUDFLARE_ACCOUNT_ID',
        label: 'Account ID',
        placeholder: '…',
        secret: false,
      },
      {
        key: 'CLOUDFLARE_API_KEY',
        label: 'API key',
        placeholder: '…',
        secret: true,
      },
    ],
  },
  {
    id: 'cortecs',
    name: 'Cortecs',
    description: 'Cortecs AI inference platform.',
    docsUrl: 'https://opencode.ai/docs/providers#cortecs',
    fields: [
      {
        key: 'CORTECS_API_KEY',
        label: 'API key',
        placeholder: '…',
        secret: true,
      },
    ],
  },
  {
    id: 'deep-infra',
    name: 'Deep Infra',
    description: 'Serverless inference for open-source models.',
    docsUrl: 'https://opencode.ai/docs/providers#deep-infra',
    fields: [
      {
        key: 'DEEPINFRA_API_KEY',
        label: 'API key',
        placeholder: '…',
        secret: true,
      },
    ],
  },
  {
    id: 'fireworks',
    name: 'Fireworks AI',
    description: 'Fast inference for open models.',
    docsUrl: 'https://opencode.ai/docs/providers#fireworks-ai',
    fields: [
      {
        key: 'FIREWORKS_API_KEY',
        label: 'API key',
        placeholder: '…',
        secret: true,
      },
    ],
  },
  {
    id: 'firmware',
    name: 'Firmware',
    description: 'Firmware AI model hosting.',
    docsUrl: 'https://opencode.ai/docs/providers#firmware',
    fields: [
      {
        key: 'FIRMWARE_API_KEY',
        label: 'API key',
        placeholder: '…',
        secret: true,
      },
    ],
  },
  {
    id: 'gitlab',
    name: 'GitLab Duo',
    description: 'AI features from your GitLab subscription.',
    docsUrl: 'https://opencode.ai/docs/providers#gitlab-duo',
    fields: [
      {
        key: 'GITLAB_TOKEN',
        label: 'Personal access token',
        placeholder: 'glpat-…',
        secret: true,
      },
    ],
  },
  {
    id: 'helicone',
    name: 'Helicone',
    description: 'LLM observability gateway with logging and analytics.',
    docsUrl: 'https://opencode.ai/docs/providers#helicone',
    fields: [
      {
        key: 'HELICONE_API_KEY',
        label: 'API key',
        placeholder: '…',
        secret: true,
      },
    ],
  },
  {
    id: 'huggingface',
    name: 'Hugging Face',
    description: 'Access open models via Hugging Face Inference Providers.',
    docsUrl: 'https://opencode.ai/docs/providers#hugging-face',
    fields: [
      {
        key: 'HUGGINGFACE_API_KEY',
        label: 'API token',
        placeholder: 'hf_…',
        secret: true,
      },
    ],
  },
  {
    id: 'ionet',
    name: 'IO.NET',
    description: 'Decentralised GPU compute for AI inference.',
    docsUrl: 'https://opencode.ai/docs/providers#ionet',
    fields: [
      {
        key: 'IONET_API_KEY',
        label: 'API key',
        placeholder: '…',
        secret: true,
      },
    ],
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    description: 'MiniMax M2 and other models.',
    docsUrl: 'https://opencode.ai/docs/providers#minimax',
    fields: [
      {
        key: 'MINIMAX_API_KEY',
        label: 'API key',
        placeholder: '…',
        secret: true,
      },
    ],
  },
  {
    id: 'moonshot',
    name: 'Moonshot AI',
    description: 'Kimi K2 and other Moonshot models.',
    docsUrl: 'https://opencode.ai/docs/providers#moonshot-ai',
    fields: [
      {
        key: 'MOONSHOT_API_KEY',
        label: 'API key',
        placeholder: '…',
        secret: true,
      },
    ],
  },
  {
    id: 'nebius',
    name: 'Nebius Token Factory',
    description: 'European AI inference with Nebius Token Factory.',
    docsUrl: 'https://opencode.ai/docs/providers#nebius-token-factory',
    fields: [
      {
        key: 'NEBIUS_API_KEY',
        label: 'API key',
        placeholder: '…',
        secret: true,
      },
    ],
  },
  {
    id: 'nvidia',
    name: 'Nvidia',
    description: 'Nvidia NIM inference microservices.',
    docsUrl: 'https://opencode.ai/docs/providers',
    fields: [
      {
        key: 'NVIDIA_API_KEY',
        label: 'API key',
        placeholder: 'nvapi-…',
        secret: true,
      },
    ],
  },
  {
    id: 'ollama-cloud',
    name: 'Ollama Cloud',
    description: 'Cloud-hosted Ollama models.',
    docsUrl: 'https://opencode.ai/docs/providers#ollama-cloud',
    fields: [
      {
        key: 'OLLAMA_CLOUD_API_KEY',
        label: 'API key',
        placeholder: '…',
        secret: true,
      },
    ],
  },
  {
    id: 'ovhcloud',
    name: 'OVHcloud AI Endpoints',
    description: 'European cloud AI endpoints from OVHcloud.',
    docsUrl: 'https://opencode.ai/docs/providers#ovhcloud-ai-endpoints',
    fields: [
      {
        key: 'OVHCLOUD_API_KEY',
        label: 'API key',
        placeholder: '…',
        secret: true,
      },
    ],
  },
  {
    id: 'sap-ai-core',
    name: 'SAP AI Core',
    description: 'Access 40+ models through SAP AI Core.',
    docsUrl: 'https://opencode.ai/docs/providers#sap-ai-core',
    fields: [
      {
        key: 'AICORE_SERVICE_KEY',
        label: 'Service key (JSON)',
        placeholder: '{"clientid":"…", …}',
        secret: true,
      },
    ],
  },
  {
    id: 'scaleway',
    name: 'Scaleway',
    description: 'European cloud inference via Scaleway Generative APIs.',
    docsUrl: 'https://opencode.ai/docs/providers#scaleway',
    fields: [
      {
        key: 'SCALEWAY_API_KEY',
        label: 'API key',
        placeholder: '…',
        secret: true,
      },
    ],
  },
  {
    id: 'stackit',
    name: 'STACKIT',
    description: 'Sovereign AI hosting on European infrastructure.',
    docsUrl: 'https://opencode.ai/docs/providers#stackit',
    fields: [
      {
        key: 'STACKIT_API_KEY',
        label: 'Auth token',
        placeholder: '…',
        secret: true,
      },
    ],
  },
  {
    id: 'stepfun',
    name: 'StepFun',
    description: 'StepFun AI models.',
    docsUrl: 'https://opencode.ai/docs/providers',
    fields: [
      {
        key: 'STEPFUN_API_KEY',
        label: 'API key',
        placeholder: '…',
        secret: true,
      },
    ],
  },
  {
    id: 'together',
    name: 'Together AI',
    description: 'Open-source model hosting at scale.',
    docsUrl: 'https://opencode.ai/docs/providers#together-ai',
    fields: [
      {
        key: 'TOGETHER_API_KEY',
        label: 'API key',
        placeholder: '…',
        secret: true,
      },
    ],
  },
  {
    id: 'venice',
    name: 'Venice AI',
    description: 'Privacy-focused AI inference.',
    docsUrl: 'https://opencode.ai/docs/providers#venice-ai',
    fields: [
      {
        key: 'VENICE_API_KEY',
        label: 'API key',
        placeholder: '…',
        secret: true,
      },
    ],
  },
  {
    id: 'vercel',
    name: 'Vercel AI Gateway',
    description: 'Access models from multiple providers through Vercel.',
    docsUrl: 'https://opencode.ai/docs/providers#vercel-ai-gateway',
    fields: [
      {
        key: 'VERCEL_API_KEY',
        label: 'API key',
        placeholder: '…',
        secret: true,
      },
    ],
  },
  {
    id: 'xai',
    name: 'xAI',
    description: 'Grok models from xAI.',
    docsUrl: 'https://opencode.ai/docs/providers#xai',
    fields: [
      {
        key: 'XAI_API_KEY',
        label: 'API key',
        placeholder: 'xai-…',
        secret: true,
      },
    ],
  },
  {
    id: 'zai',
    name: 'Z.AI',
    description: 'GLM-4 and other Z.AI models.',
    docsUrl: 'https://opencode.ai/docs/providers#zai',
    fields: [{ key: 'ZAI_API_KEY', label: 'API key', placeholder: '…', secret: true }],
  },
  {
    id: 'zenmux',
    name: 'ZenMux',
    description: 'AI model router and gateway.',
    docsUrl: 'https://opencode.ai/docs/providers#zenmux',
    fields: [
      {
        key: 'ZENMUX_API_KEY',
        label: 'API key',
        placeholder: '…',
        secret: true,
      },
    ],
  },
  {
    id: 'kimi-for-coding',
    name: 'Kimi for Coding',
    description: 'Kimi K2 coding-optimised models.',
    docsUrl: 'https://opencode.ai/docs/providers',
    fields: [
      {
        key: 'KIMI_FOR_CODING_API_KEY',
        label: 'API key',
        placeholder: '…',
        secret: true,
      },
    ],
  },
  {
    id: 'opencode-go',
    name: 'OpenCode Go',
    description: 'Low-cost subscription for popular open coding models.',
    docsUrl: 'https://opencode.ai/docs/providers#opencode-go',
    fields: [
      {
        key: 'OPENCODE_API_KEY',
        label: 'API key',
        placeholder: 'sk-…',
        secret: true,
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Combined export — popular first, then the rest alphabetically
// ---------------------------------------------------------------------------

export const PROVIDERS: Provider[] = [
  ...POPULAR,
  ...OTHER.sort((a, b) => a.name.localeCompare(b.name)),
];
