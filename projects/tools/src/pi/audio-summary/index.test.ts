import type { AssistantMessage } from '@earendil-works/pi-ai';
import type { AgentEndEvent, ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { SettingsManager } from '@earendil-works/pi-coding-agent';
import { afterEach, describe, expect, it, vi } from 'vitest';
import audioSummaryExtension, {
  extractAssistantMessageText,
  extractLastMessageText,
  notifyUnresolvedSummaryModel,
  selectSummaryModel
} from './index.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

type AgentEndHandler = (event: AgentEndEvent, ctx: ExtensionContext) => Promise<void> | void;

function createStubExtensionApi(settings: object = {}): { api: ExtensionAPI; handlers: Map<string, unknown> } {
  const handlers = new Map<string, unknown>();
  const api = {
    getSettings: () => settings,
    on: (eventName: string, handler: unknown) => {
      handlers.set(eventName, handler);
    }
  } as unknown as ExtensionAPI;
  return { api, handlers };
}

interface FakeContextOptions {
  readonly hasUI?: boolean;
  readonly notifications?: Array<[string, string | undefined]>;
  readonly statusCalls?: Array<[string, string | undefined]>;
  readonly model?: unknown;
  readonly findModel?: (provider: string, modelId: string) => unknown;
}

function createFakeContext(options: FakeContextOptions = {}): ExtensionContext {
  const notifications = options.notifications ?? [];
  const statusCalls = options.statusCalls ?? [];
  return {
    hasUI: options.hasUI ?? true,
    model: options.model,
    ui: {
      notify: (message: string, type?: string) => {
        notifications.push([message, type]);
      },
      setStatus: (key: string, text: string | undefined) => {
        statusCalls.push([key, text]);
      }
    },
    modelRegistry: {
      find: options.findModel ?? (() => undefined),
      getApiKeyAndHeaders: () => Promise.resolve({ ok: false, error: 'no auth configured for this test' })
    }
  } as unknown as ExtensionContext;
}

function getCapturedAgentEndHandler(handlers: Map<string, unknown>): AgentEndHandler {
  const handler = handlers.get('agent_end');
  if (typeof handler !== 'function') {
    throw new Error('Expected audioSummaryExtension to register an agent_end handler.');
  }
  return handler as AgentEndHandler;
}

describe('audioSummaryExtension', () => {
  it('should register a handler for the agent_end event', () => {
    const { api, handlers } = createStubExtensionApi();

    audioSummaryExtension(api);

    expect(handlers.has('agent_end')).toBe(true);
  });

  it('should no-op without notifying when there are no messages to summarize', async () => {
    const { api, handlers } = createStubExtensionApi();
    audioSummaryExtension(api);
    const handler = getCapturedAgentEndHandler(handlers);
    const notifications: Array<[string, string | undefined]> = [];
    const statusCalls: Array<[string, string | undefined]> = [];
    const ctx = createFakeContext({ notifications, statusCalls });

    await handler({ type: 'agent_end', messages: [] }, ctx);

    expect(notifications).toEqual([]);
    expect(statusCalls).toEqual([['audio-summary', undefined]]);
  });

  it('should no-op when the last message is whitespace-only', async () => {
    const { api, handlers } = createStubExtensionApi();
    audioSummaryExtension(api);
    const handler = getCapturedAgentEndHandler(handlers);
    const notifications: Array<[string, string | undefined]> = [];
    const ctx = createFakeContext({ notifications });

    await handler({ type: 'agent_end', messages: [{ role: 'user', content: '   ', timestamp: 0 }] }, ctx);

    expect(notifications).toEqual([]);
  });

  it('should no-op when the last message carries no content field, such as a bash execution message', async () => {
    const { api, handlers } = createStubExtensionApi();
    audioSummaryExtension(api);
    const handler = getCapturedAgentEndHandler(handlers);
    const notifications: Array<[string, string | undefined]> = [];
    const ctx = createFakeContext({ notifications });
    const bashExecutionMessage = {
      role: 'bashExecution' as const,
      command: 'ls',
      output: '',
      exitCode: 0,
      cancelled: false,
      truncated: false,
      timestamp: 0
    };

    await handler({ type: 'agent_end', messages: [bashExecutionMessage] }, ctx);

    expect(notifications).toEqual([]);
  });
});

describe('extractLastMessageText', () => {
  it('should return undefined for an empty message list', () => {
    expect(extractLastMessageText([])).toBeUndefined();
  });

  it('should return the raw string content of a user message', () => {
    const messages = [{ role: 'user' as const, content: 'plain string content', timestamp: 0 }];
    expect(extractLastMessageText(messages)).toBe('plain string content');
  });

  it('should return the text of the last text part in an array-content message', () => {
    const messages = [
      {
        role: 'toolResult' as const,
        toolCallId: 'call-1',
        toolName: 'someTool',
        content: [
          { type: 'image' as const, data: 'abc', mimeType: 'image/png' },
          { type: 'text' as const, text: 'final answer' }
        ],
        isError: false,
        timestamp: 0
      }
    ];
    expect(extractLastMessageText(messages)).toBe('final answer');
  });

  it('should return undefined when the last content part is not text', () => {
    const messages = [
      {
        role: 'toolResult' as const,
        toolCallId: 'call-1',
        toolName: 'someTool',
        content: [
          { type: 'text' as const, text: 'ignored' },
          { type: 'image' as const, data: 'abc', mimeType: 'image/png' }
        ],
        isError: false,
        timestamp: 0
      }
    ];
    expect(extractLastMessageText(messages)).toBeUndefined();
  });

  it('should return undefined for an empty content array', () => {
    const messages = [
      {
        role: 'toolResult' as const,
        toolCallId: 'call-1',
        toolName: 'someTool',
        content: [],
        isError: false,
        timestamp: 0
      }
    ];
    expect(extractLastMessageText(messages)).toBeUndefined();
  });

  it('should return undefined when the last message has no content field', () => {
    const messages = [
      {
        role: 'branchSummary' as const,
        summary: 'a prior branch summary',
        fromId: 'entry-1',
        timestamp: 0
      }
    ];
    expect(extractLastMessageText(messages)).toBeUndefined();
  });
});

describe('extractAssistantMessageText', () => {
  it('should join every text part with a space, skipping thinking parts', () => {
    const response = {
      content: [
        { type: 'thinking', thinking: 'internal reasoning' },
        { type: 'text', text: 'Hello' },
        { type: 'text', text: 'World' }
      ]
    } as unknown as AssistantMessage;

    expect(extractAssistantMessageText(response)).toBe('Hello World');
  });

  it('should return an empty string when there are no text parts', () => {
    const response = {
      content: [{ type: 'toolCall', id: 'call-1', name: 'someTool', arguments: {} }]
    } as unknown as AssistantMessage;

    expect(extractAssistantMessageText(response)).toBe('');
  });
});

describe('selectSummaryModel', () => {
  it('should use ctx.model without a registry lookup or notification when the summary model is undefined', () => {
    const currentModel = { id: 'current-session-model' };
    const findModel = vi.fn();
    const notifications: Array<[string, string | undefined]> = [];
    const ctx = createFakeContext({ model: currentModel, findModel, notifications });

    expect(selectSummaryModel(ctx, undefined)).toBe(currentModel);
    expect(findModel).not.toHaveBeenCalled();
    expect(notifications).toEqual([]);
  });

  it('should return undefined when neither a summary model nor a session model is available', () => {
    expect(selectSummaryModel(createFakeContext())).toBeUndefined();
  });

  it('should return the configured model when the registry finds it', () => {
    const resolvedModel = { id: 'gemma-4-e2b' };
    const findModel = vi.fn(() => resolvedModel);
    const ctx = createFakeContext({ findModel });

    expect(selectSummaryModel(ctx, 'spark/gemma-4-e2b')).toBe(resolvedModel);
    expect(findModel).toHaveBeenCalledWith('spark', 'gemma-4-e2b');
  });

  it('should preserve slashes within the model id', () => {
    const resolvedModel = { id: 'organization/model' };
    const findModel = vi.fn(() => resolvedModel);
    const ctx = createFakeContext({ findModel });

    expect(selectSummaryModel(ctx, 'spark/organization/model')).toBe(resolvedModel);
    expect(findModel).toHaveBeenCalledWith('spark', 'organization/model');
  });

  it.each(['bare-model', '/model', 'spark/'])('should fall back without a registry lookup for %s', summaryModel => {
    const currentModel = { id: 'current-session-model' };
    const findModel = vi.fn();
    const ctx = createFakeContext({ model: currentModel, findModel });

    expect(selectSummaryModel(ctx, summaryModel)).toBe(currentModel);
    expect(findModel).not.toHaveBeenCalled();
  });

  it('should fall back to ctx.model and notify when the configured model does not resolve', () => {
    const currentModel = { id: 'current-session-model' };
    const notifications: Array<[string, string | undefined]> = [];
    const ctx = createFakeContext({ model: currentModel, notifications, findModel: () => undefined });

    expect(selectSummaryModel(ctx, 'spark/gemma-4-e2b')).toBe(currentModel);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.[0]).toContain('spark/gemma-4-e2b');
  });
});

describe('notifyUnresolvedSummaryModel', () => {
  it('should notify the user when the extension has UI', () => {
    const notifications: Array<[string, string | undefined]> = [];
    const ctx = createFakeContext({ hasUI: true, notifications });

    notifyUnresolvedSummaryModel(ctx, 'spark/gemma-4-e2b');

    expect(notifications).toEqual([
      ['⚠️ audioSummary.model "spark/gemma-4-e2b" did not resolve; falling back to the current model', 'info']
    ]);
  });

  it('should not notify when the extension has no UI', () => {
    const notifications: Array<[string, string | undefined]> = [];
    const ctx = createFakeContext({ hasUI: false, notifications });

    notifyUnresolvedSummaryModel(ctx, 'spark/gemma-4-e2b');

    expect(notifications).toEqual([]);
  });
});

describe('audioSummaryExtension with playback suppressed', () => {
  it('should resolve the summary model from merged Pi settings even without a session model', async () => {
    vi.stubEnv('MOSHI_CLIENT', '1');
    const settingsManager = SettingsManager.fromStorage({
      withLock: (scope, callback) => {
        callback(
          JSON.stringify({
            audioSummary: { model: scope === 'global' ? 'spark/default-model' : 'spark/project-model' }
          })
        );
      }
    });
    const { api, handlers } = createStubExtensionApi(settingsManager.getSettings());
    audioSummaryExtension(api);
    const resolvedModel = { id: 'project-model' };
    const findModel = vi.fn(() => resolvedModel);
    const ctx = createFakeContext({ findModel });
    const getAuth = vi.spyOn(ctx.modelRegistry, 'getApiKeyAndHeaders');

    await getCapturedAgentEndHandler(handlers)(
      { type: 'agent_end', messages: [{ role: 'user', content: 'Shipped the fix.', timestamp: 0 }] },
      ctx
    );

    expect(findModel).toHaveBeenCalledWith('spark', 'project-model');
    expect(getAuth).toHaveBeenCalledWith(resolvedModel);
  });

  it.each([
    {},
    { audioSummary: null },
    { audioSummary: 'invalid' },
    { audioSummary: {} },
    { audioSummary: { model: null } },
    { audioSummary: { model: 123 } },
    { audioSummary: { model: '' } },
    { audioSummary: { model: '   ' } }
  ])('should use ctx.model when settings have no usable summary model: %j', async settings => {
    vi.stubEnv('MOSHI_CLIENT', '1');
    const { api, handlers } = createStubExtensionApi(settings);
    audioSummaryExtension(api);
    const currentModel = { id: 'current-session-model' };
    const findModel = vi.fn();
    const ctx = createFakeContext({ model: currentModel, findModel });
    const getAuth = vi.spyOn(ctx.modelRegistry, 'getApiKeyAndHeaders');

    await getCapturedAgentEndHandler(handlers)(
      { type: 'agent_end', messages: [{ role: 'user', content: 'Shipped the fix.', timestamp: 0 }] },
      ctx
    );

    expect(findModel).not.toHaveBeenCalled();
    expect(getAuth).toHaveBeenCalledWith(currentModel);
  });

  it('should notify the summary without reaching the speaking status when MOSHI_CLIENT is 1', async () => {
    vi.stubEnv('MOSHI_CLIENT', '1');
    const { api, handlers } = createStubExtensionApi();
    audioSummaryExtension(api);
    const handler = getCapturedAgentEndHandler(handlers);
    const notifications: Array<[string, string | undefined]> = [];
    const statusCalls: Array<[string, string | undefined]> = [];
    const ctx = createFakeContext({ notifications, statusCalls });

    await handler({ type: 'agent_end', messages: [{ role: 'user', content: 'Shipped the fix.', timestamp: 0 }] }, ctx);

    expect(notifications).toContainEqual(['🔊 Shipped the fix.', 'info']);
    expect(notifications).not.toContainEqual(['🔊 audio summaries unavailable', 'info']);
    expect(statusCalls).toEqual([['audio-summary', undefined]]);
  });
});
