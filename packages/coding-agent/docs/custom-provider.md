# Custom Providers

Extensions can register custom model providers via `linc.registerProvider()`. This enables:

- **Proxies** - Route requests through corporate proxies or API gateways
- **Custom endpoints** - Use self-hosted or private model deployments
- **OAuth/SSO** - Add authentication flows for enterprise providers
- **Custom APIs** - Implement streaming for non-standard LLM APIs

Provider plugins are normal [Linc packages](./packages.md) that ship an extension.

## Example Extensions

See these complete provider examples:

- [`examples/extensions/custom-provider-anthropic/`](../examples/extensions/custom-provider-anthropic/)
- [`examples/extensions/custom-provider-gitlab-duo/`](../examples/extensions/custom-provider-gitlab-duo/)
- [`examples/extensions/custom-provider-qwen-cli/`](../examples/extensions/custom-provider-qwen-cli/)

## Quick Reference

```typescript
import type { ExtensionAPI } from "@casemark/linc";

export default function (linc: ExtensionAPI) {
  // Override baseUrl for an existing provider.
  linc.registerProvider("casedev", {
    baseUrl: "https://proxy.example.com/llm/v1"
  });

  // Register a new OpenAI-compatible provider with models.
  linc.registerProvider("my-provider", {
    openaiCompatBaseUrl: "https://api.example.com/v1",
    apiKey: "MY_API_KEY",
    models: [
      {
        id: "my-model",
        name: "My Model",
        reasoning: false,
        input: ["text", "image"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 4096
      }
    ]
  });
}
```

`openaiCompatBaseUrl` is shorthand for `baseUrl` plus `api: "openai-completions"`. Use it for OpenAI-compatible chat completions servers such as LiteLLM, vLLM, Ollama, LM Studio, and gateway proxies.

## Override Existing Provider

The simplest use case is redirecting an existing provider through a proxy.

```typescript
linc.registerProvider("casedev", {
  baseUrl: "https://proxy.example.com/llm/v1"
});

linc.registerProvider("casedev", {
  headers: {
    "X-Custom-Header": "value"
  }
});
```

When only `baseUrl`, `openaiCompatBaseUrl`, or `headers` are provided, existing models for that provider are preserved with the new endpoint.

## Register New Provider

To add a new provider, specify `models` along with endpoint and auth configuration.

```typescript
linc.registerProvider("local-llm", {
  openaiCompatBaseUrl: "http://localhost:11434/v1",
  apiKey: "OLLAMA_API_KEY",
  models: [
    {
      id: "qwen3-coder",
      name: "Qwen3 Coder",
      reasoning: true,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 262144,
      maxTokens: 8192,
      compat: {
        supportsDeveloperRole: false,
        maxTokensField: "max_tokens",
        thinkingFormat: "qwen-chat-template"
      }
    }
  ]
});
```

When `models` is provided, it replaces all existing models for that provider.

## Package Form

Provider packages declare their extension under `package.json.linc.extensions`:

```json
{
  "name": "@acme/linc-provider-local",
  "keywords": ["linc-package", "linc-provider"],
  "peerDependencies": {
    "@casemark/linc": "*"
  },
  "linc": {
    "extensions": ["./dist/index.js"]
  }
}
```

Then users install it like any other package:

```bash
linc install npm:@acme/linc-provider-local
```

## Unregister Provider

Use `linc.unregisterProvider(name)` to remove a provider registered via `linc.registerProvider(name, ...)`:

```typescript
linc.unregisterProvider("local-llm");
```

Unregistering removes that provider's dynamic models, API key fallback, OAuth provider registration, and custom stream handler registrations. Any built-in models or provider behavior that were overridden are restored.

Calls made after the initial extension load phase are applied immediately, so no `/reload` is required.

## API Types

The `api` field determines which streaming implementation is used:

| API | Use for |
|-----|---------|
| `anthropic-messages` | Anthropic Claude API and compatibles |
| `openai-completions` | OpenAI Chat Completions API and compatibles |
| `openai-responses` | OpenAI Responses API |
| `azure-openai-responses` | Azure OpenAI Responses API |
| `openai-codex-responses` | OpenAI Codex Responses API |
| `mistral-conversations` | Mistral SDK Conversations/Chat streaming |
| `google-generative-ai` | Google Generative AI API |
| `google-gemini-cli` | Google Cloud Code Assist API |
| `google-vertex` | Google Vertex AI API |
| `bedrock-converse-stream` | Amazon Bedrock Converse API |

Most OpenAI-compatible providers work with `openai-completions`. Use `compat` for provider quirks:

```typescript
models: [{
  id: "custom-model",
  // ...
  compat: {
    supportsDeveloperRole: false,
    supportsReasoningEffort: true,
    reasoningEffortMap: {
      minimal: "default",
      low: "default",
      medium: "default",
      high: "default",
      xhigh: "default"
    },
    maxTokensField: "max_tokens",
    requiresToolResultName: true,
    thinkingFormat: "qwen"
  }
}]
```

Use `qwen-chat-template` for local Qwen-compatible servers that read `chat_template_kwargs.enable_thinking`.

## Auth Header

If your provider expects `Authorization: Bearer <key>` but does not use a standard API, set `authHeader: true`:

```typescript
linc.registerProvider("custom-api", {
  baseUrl: "https://api.example.com",
  apiKey: "MY_API_KEY",
  authHeader: true,
  api: "openai-completions",
  models: [...]
});
```

## OAuth Support

Add OAuth/SSO authentication that integrates with `/login`:

```typescript
import type { OAuthCredentials, OAuthLoginCallbacks } from "@casemark/linc-ai";

linc.registerProvider("corporate-ai", {
  baseUrl: "https://ai.corp.com/v1",
  api: "openai-responses",
  models: [...],
  oauth: {
    name: "Corporate AI (SSO)",

    async login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
      callbacks.onAuth({ url: "https://sso.corp.com/authorize?client_id=..." });
      const code = await callbacks.onPrompt({ message: "Enter SSO code:" });
      const tokens = await exchangeCodeForTokens(code);

      return {
        refresh: tokens.refreshToken,
        access: tokens.accessToken,
        expires: Date.now() + tokens.expiresIn * 1000
      };
    },

    async refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
      const tokens = await refreshAccessToken(credentials.refresh);
      return {
        refresh: tokens.refreshToken ?? credentials.refresh,
        access: tokens.accessToken,
        expires: Date.now() + tokens.expiresIn * 1000
      };
    },

    getApiKey(credentials: OAuthCredentials): string {
      return credentials.access;
    }
  }
});
```

After registration, users can authenticate via `/login corporate-ai`. Credentials are persisted in `~/.linc/agent/auth.json`.

## Custom Streaming API

For providers with non-standard APIs, implement `streamSimple`. Study the existing provider implementations in `packages/ai/src/providers/` before writing your own.

```typescript
import {
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type SimpleStreamOptions,
  calculateCost,
  createAssistantMessageEventStream,
} from "@casemark/linc-ai";

function streamMyProvider(
  model: Model<any>,
  context: Context,
  options?: SimpleStreamOptions
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();

  (async () => {
    const output: AssistantMessage = {
      role: "assistant",
      content: [],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    };

    try {
      stream.push({ type: "start", partial: output });
      // Make API request and push content events as they arrive.
      calculateCost(model, output.usage);
      stream.push({ type: "done", reason: output.stopReason as "stop", message: output });
      stream.end();
    } catch (error) {
      output.stopReason = options?.signal?.aborted ? "aborted" : "error";
      output.errorMessage = error instanceof Error ? error.message : String(error);
      stream.push({ type: "error", reason: output.stopReason, error: output });
      stream.end();
    }
  })();

  return stream;
}

linc.registerProvider("my-provider", {
  baseUrl: "https://api.example.com",
  apiKey: "MY_API_KEY",
  api: "my-custom-api",
  models: [...],
  streamSimple: streamMyProvider
});
```

## Config Reference

```typescript
interface ProviderConfig {
  baseUrl?: string;
  openaiCompatBaseUrl?: string;
  apiKey?: string;
  api?: Api;
  streamSimple?: (
    model: Model<Api>,
    context: Context,
    options?: SimpleStreamOptions
  ) => AssistantMessageEventStream;
  headers?: Record<string, string>;
  authHeader?: boolean;
  models?: ProviderModelConfig[];
  oauth?: {
    name: string;
    login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials>;
    refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials>;
    getApiKey(credentials: OAuthCredentials): string;
    modifyModels?(models: Model<Api>[], credentials: OAuthCredentials): Model<Api>[];
  };
}
```

## Model Definition Reference

```typescript
interface ProviderModelConfig {
  id: string;
  name: string;
  api?: Api;
  baseUrl?: string;
  openaiCompatBaseUrl?: string;
  reasoning: boolean;
  input: ("text" | "image")[];
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  contextWindow: number;
  maxTokens: number;
  headers?: Record<string, string>;
  compat?: {
    supportsStore?: boolean;
    supportsDeveloperRole?: boolean;
    supportsReasoningEffort?: boolean;
    reasoningEffortMap?: Partial<Record<"minimal" | "low" | "medium" | "high" | "xhigh", string>>;
    supportsUsageInStreaming?: boolean;
    maxTokensField?: "max_completion_tokens" | "max_tokens";
    requiresToolResultName?: boolean;
    requiresAssistantAfterToolResult?: boolean;
    requiresThinkingAsText?: boolean;
    thinkingFormat?: "openai" | "zai" | "qwen" | "qwen-chat-template";
  };
}
```
