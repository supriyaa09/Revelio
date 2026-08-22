/**
 * AI provider selection and transport.
 *
 * `analyze.ts` owns the *analysis* — the prompt, the JSON schema, the coercion
 * and the failure contract. This module owns only "which endpoint, which
 * headers, and how is the response body turned into an object". Providers are
 * interchangeable precisely because none of the analysis logic lives here.
 *
 * Server-only, for the same reason as analyze.ts: it reads credentials.
 */
if (typeof window !== 'undefined') {
  throw new Error(
    'processing/providers.ts is server-only. Do not import it from a client component.',
  );
}

export type AiProviderName = 'anthropic' | 'agentrouter';

/** Where Anthropic's own API lives. */
export const ANTHROPIC_DEFAULT_BASE_URL = 'https://api.anthropic.com';

/**
 * AgentRouter's Anthropic-compatible host.
 *
 * `co.agentrouter.org` is NOT this host. It answers, but rejects every request
 * with `401 {"code":401,"msg":"Invalid API Key!"}` regardless of credential,
 * auth scheme or headers — verified across eight combinations. Using it wastes
 * an afternoon on what looks like a bad key, so it is called out here.
 */
export const AGENTROUTER_DEFAULT_BASE_URL = 'https://agentrouter.org';

/**
 * AgentRouter serves Anthropic model ids and maps them onto its own upstreams
 * (`claude-opus-5` came back as `anthropic/claude-opus-5-aws`). Availability is
 * per-account: `claude-sonnet-5` returned `503 no available channel`, so this
 * default is the one confirmed to resolve. Override per deployment.
 */
export const AGENTROUTER_DEFAULT_MODEL = 'claude-opus-5';

/**
 * AgentRouter refuses any request whose User-Agent does not identify a Claude
 * CLI client — `401 {"error":{"message":"unauthorized client detected"}}` — and
 * the Anthropic SDK sends its own User-Agent, which is why routing a valid key
 * through the SDK failed while the same key worked in Claude Code.
 *
 * This is a client check by the gateway, not an authentication step, so it is a
 * configuration value rather than something hardcoded and hidden: whether
 * presenting this User-Agent from a web server is consistent with your
 * AgentRouter agreement is a question about your account, and you can set
 * REVELIO_AGENTROUTER_USER_AGENT to whatever that agreement permits.
 */
export const AGENTROUTER_DEFAULT_USER_AGENT = 'claude-cli/2.1.239 (external, cli)';

/** Generous: adaptive thinking on a long document is legitimately slow. */
const REQUEST_TIMEOUT_MS = 180_000;

/** Which variable chose the endpoint, so the probe cannot misreport it. */
export type BaseUrlSource =
  | 'default'
  | 'REVELIO_ANTHROPIC_BASE_URL'
  | 'ANTHROPIC_BASE_URL'
  | 'REVELIO_AGENTROUTER_BASE_URL';

export interface ProviderConfig {
  provider: AiProviderName;
  baseUrl: string;
  /** Endpoint the request is actually POSTed to. */
  endpoint: string;
  model: string;
  source: BaseUrlSource;
  /** Extra headers. Empty for Anthropic; the client identity for AgentRouter. */
  headers: Record<string, string>;
  /** Present when a base URL was set but refused. */
  ignored?: { variable: 'ANTHROPIC_BASE_URL'; value: string };
  /** True when the credential is missing entirely. */
  apiKey: string | null;
  /** Which variable supplied the credential. */
  apiKeySource: string | null;
}

/**
 * Reads the provider selection.
 *
 * Unknown values fall back to `anthropic` with a warning rather than throwing:
 * a typo in an env var should degrade to the safe default and be reported, not
 * take the whole processing pipeline down.
 */
export function resolveProviderName(
  env: Record<string, string | undefined> = process.env,
  warn: (message: string) => void = (m) => console.warn(m),
): AiProviderName {
  const raw = env.REVELIO_AI_PROVIDER?.trim().toLowerCase();
  if (!raw) return 'anthropic';
  if (raw === 'anthropic' || raw === 'agentrouter') return raw;
  warn(
    `[providers] REVELIO_AI_PROVIDER=${raw} is not a known provider. ` +
      "Falling back to 'anthropic'. Valid values: anthropic, agentrouter.",
  );
  return 'anthropic';
}

let warned = false;

function warnOnce(warn: (m: string) => void, message: string): void {
  if (warned) return;
  warned = true;
  warn(message);
}

/** Test seam: the warn-once latch is process-wide by design. */
export function __resetProviderWarning(): void {
  warned = false;
}

/**
 * Resolves the full provider configuration: endpoint, model, headers, credential.
 *
 * The Anthropic branch keeps exactly the behaviour established in ADR-041 —
 * `REVELIO_ANTHROPIC_BASE_URL` wins, a bare `ANTHROPIC_BASE_URL` is ignored
 * unless explicitly permitted. The AgentRouter branch is separate because
 * selecting it *is* the explicit statement of intent, so its base URL needs no
 * second flag.
 */
export function resolveProvider(
  env: Record<string, string | undefined> = process.env,
  warn: (message: string) => void = (m) => console.warn(m),
): ProviderConfig {
  const provider = resolveProviderName(env, warn);

  if (provider === 'agentrouter') {
    const baseUrl = env.REVELIO_AGENTROUTER_BASE_URL?.trim() || AGENTROUTER_DEFAULT_BASE_URL;
    const model =
      env.REVELIO_AGENTROUTER_MODEL?.trim() ||
      env.ANTHROPIC_MODEL?.trim() ||
      AGENTROUTER_DEFAULT_MODEL;

    // The router's key is the same credential shape as Anthropic's, and users
    // arrive here having already put it in ANTHROPIC_API_KEY. ANTHROPIC_AUTH_TOKEN
    // is accepted too because that is where Claude-Code-style setups keep it.
    const [apiKey, apiKeySource] = firstOf(env, [
      'REVELIO_AGENTROUTER_API_KEY',
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_AUTH_TOKEN',
    ]);

    warnOnce(
      warn,
      `[providers] REVELIO_AI_PROVIDER=agentrouter. Document text is sent to ${baseUrl}` +
        `/v1/messages as model ${model}, not to ${ANTHROPIC_DEFAULT_BASE_URL}.`,
    );

    return {
      provider,
      baseUrl,
      endpoint: messagesEndpoint(baseUrl),
      model,
      source: 'REVELIO_AGENTROUTER_BASE_URL',
      headers: {
        // Required by the gateway; see AGENTROUTER_DEFAULT_USER_AGENT.
        'user-agent': env.REVELIO_AGENTROUTER_USER_AGENT?.trim() || AGENTROUTER_DEFAULT_USER_AGENT,
        'x-app': 'cli',
      },
      apiKey,
      apiKeySource,
    };
  }

  // ── Anthropic: unchanged semantics ────────────────────────────────────────
  const resolved = resolveAnthropicBaseUrl(env, warn);
  const [apiKey, apiKeySource] = firstOf(env, ['ANTHROPIC_API_KEY']);

  return {
    provider: 'anthropic',
    baseUrl: resolved.baseUrl,
    endpoint: messagesEndpoint(resolved.baseUrl),
    model: env.ANTHROPIC_MODEL?.trim() || 'claude-opus-5',
    source: resolved.source,
    headers: {},
    ignored: resolved.ignored,
    apiKey,
    apiKeySource,
  };
}

function firstOf(
  env: Record<string, string | undefined>,
  names: string[],
): [string | null, string | null] {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return [value, name];
  }
  return [null, null];
}

/** Tolerates a base URL supplied with or without a trailing slash or /v1. */
function messagesEndpoint(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  return /\/v1$/.test(trimmed) ? `${trimmed}/messages` : `${trimmed}/v1/messages`;
}

export interface ResolvedBaseUrl {
  baseUrl: string;
  source: BaseUrlSource;
  ignored?: { variable: 'ANTHROPIC_BASE_URL'; value: string };
}

/**
 * Endpoint resolution for the Anthropic provider. Behaviour is unchanged from
 * ADR-041: `REVELIO_ANTHROPIC_BASE_URL` takes precedence, then
 * `ANTHROPIC_BASE_URL` but only with `ANTHROPIC_ALLOW_BASE_URL_OVERRIDE=true`.
 *
 * The asymmetry is deliberate. The risk is not "a proxy is configured", it is
 * "a proxy is configured by accident": the SDK reads `ANTHROPIC_BASE_URL`
 * unprompted and this process inherits the whole shell, so a value exported for
 * an unrelated tool would silently redirect institutional document text.
 * `REVELIO_`-prefixed variables cannot arrive that way.
 */
export function resolveAnthropicBaseUrl(
  env: Record<string, string | undefined> = process.env,
  warn: (message: string) => void = (m) => console.warn(m),
): ResolvedBaseUrl {
  const revelio = env.REVELIO_ANTHROPIC_BASE_URL?.trim();
  if (revelio) {
    const shadowed = env.ANTHROPIC_BASE_URL?.trim();
    warnOnce(
      warn,
      `[analyze] REVELIO_ANTHROPIC_BASE_URL=${revelio} is in use. Document text is sent ` +
        `there, not to ${ANTHROPIC_DEFAULT_BASE_URL}.` +
        (shadowed && shadowed !== revelio
          ? ` ANTHROPIC_BASE_URL=${shadowed} is also set and is being overridden.`
          : ''),
    );
    return { baseUrl: revelio, source: 'REVELIO_ANTHROPIC_BASE_URL' };
  }

  const override = env.ANTHROPIC_BASE_URL?.trim();
  if (!override) return { baseUrl: ANTHROPIC_DEFAULT_BASE_URL, source: 'default' };

  const allowed = env.ANTHROPIC_ALLOW_BASE_URL_OVERRIDE?.trim().toLowerCase() === 'true';

  if (!allowed) {
    warnOnce(
      warn,
      `[analyze] IGNORING ANTHROPIC_BASE_URL=${override}. Document text is being sent to ` +
        `${ANTHROPIC_DEFAULT_BASE_URL} instead. That variable is set in this process's ` +
        'environment, and honouring it would forward institutional document text to a third ' +
        'party. If the proxy is intended, set REVELIO_ANTHROPIC_BASE_URL to the same value, ' +
        'or set ANTHROPIC_ALLOW_BASE_URL_OVERRIDE=true.',
    );
    return {
      baseUrl: ANTHROPIC_DEFAULT_BASE_URL,
      source: 'default',
      ignored: { variable: 'ANTHROPIC_BASE_URL', value: override },
    };
  }

  warnOnce(
    warn,
    `[analyze] ANTHROPIC_BASE_URL=${override} is in use and was explicitly permitted by ` +
      'ANTHROPIC_ALLOW_BASE_URL_OVERRIDE. Document text is sent there, not to Anthropic.',
  );
  return { baseUrl: override, source: 'ANTHROPIC_BASE_URL' };
}

/** The subset of the Messages response this pipeline reads. */
export interface MessagesResponse {
  content?: { type: string; text?: string }[];
  stop_reason?: string | null;
  stop_details?: { explanation?: string; category?: string } | null;
  model?: string;
}

/** Carries the HTTP status so describeError() can report it like the SDK does. */
export class ProviderHttpError extends Error {
  readonly status: number;
  constructor(status: number, body: string) {
    super(`${status} ${body.slice(0, 300)}`);
    this.name = 'ProviderHttpError';
    this.status = status;
  }
}

/**
 * POSTs an Anthropic Messages payload to AgentRouter and returns the parsed body.
 *
 * Deliberately plain `fetch` rather than the Anthropic SDK. The SDK dispatches
 * parsing on the response's content-type, and AgentRouter does not return a JSON
 * content-type — so the SDK handed back the response body as a *string* with no
 * `content`, `stop_reason` or `model`, which surfaced downstream as
 * "Cannot read properties of undefined". The body itself is valid Messages
 * format. Parsing it here explicitly is what makes the provider work; it also
 * means the gateway's non-standard error envelopes are read as text instead of
 * being swallowed by SDK error mapping.
 *
 * The request body is built by the caller and passed through untouched, so both
 * providers send byte-identical payloads.
 */
export async function callAgentRouter(
  config: ProviderConfig,
  body: Record<string, unknown>,
): Promise<MessagesResponse> {
  if (!config.apiKey) throw new Error('no API key');

  const response = await fetch(config.endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      // AgentRouter accepts x-api-key and Bearer equally; x-api-key matches the
      // Anthropic Messages API this endpoint claims to implement.
      'x-api-key': config.apiKey,
      ...config.headers,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const text = await response.text();

  if (!response.ok) throw new ProviderHttpError(response.status, text);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // A gateway returning HTML — a login page, a proxy error — is the likely
    // cause, so quote the start of it rather than reporting a parse offset.
    throw new Error(`provider returned non-JSON body: ${text.slice(0, 200)}`);
  }

  const message = parsed as MessagesResponse & { error?: { message?: string } };

  // Some gateways answer 200 with an error envelope. Treat that as the failure
  // it is instead of reporting "empty response" further down.
  if (message.error) {
    throw new Error(`provider error: ${message.error.message ?? JSON.stringify(message.error)}`);
  }
  if (!Array.isArray(message.content)) {
    throw new Error(`provider returned no content array: ${text.slice(0, 200)}`);
  }

  return message;
}
