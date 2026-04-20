/**
 * Unit tests for executor.ts helpers.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

// ─── Mock heavy dependencies ─────────────────────────────────────────────────

const mockPrepareGet = vi.fn();
const mockPrepareRun = vi.fn();
const mockPrepareAll = vi.fn(() => []);
const mockDbPrepare = vi.fn(() => ({
  get: mockPrepareGet,
  run: mockPrepareRun,
  all: mockPrepareAll,
}));

vi.mock('../../database', () => ({
  db: {
    prepare: mockDbPrepare,
  },
}));
vi.mock('../eventBus', () => ({ eventBus: { broadcast: vi.fn() } }));
const mockRunStreamClose = vi.fn();
vi.mock('../runStreamStore', () => ({
  openRun: vi.fn(),
  push: vi.fn(),
  close: mockRunStreamClose,
  connectStream: vi.fn(),
  getHistory: vi.fn(() => []),
  hasErrorEvents: vi.fn(() => false),
}));

const mockAcquireContext = vi.fn();
vi.mock('../opencodeServerPool', () => ({
  acquireContext: mockAcquireContext,
}));

const mockTriggerFindById = vi.fn(() => undefined);
vi.mock('../../repositories/triggersRepository', () => ({
  triggersRepository: {
    findById: mockTriggerFindById,
  },
}));

const mockSubscribeRun = vi.fn();
const mockUnsubscribeRun = vi.fn();
const mockWaitForDrain = vi.fn().mockResolvedValue(undefined);
const mockHadErrors = vi.fn().mockReturnValue(false);
vi.mock('../opencodeEventRelay', () => ({
  subscribeRun: mockSubscribeRun,
  unsubscribeRun: mockUnsubscribeRun,
  waitForDrain: mockWaitForDrain,
  hadErrors: mockHadErrors,
}));

// ─── Module imports (after mocks) ─────────────────────────────────────────────

let parseModelString: (model: string) => { providerID: string; modelID: string } | null;
let Executor: new () => {
  startRun(
    runId: string,
    routine: unknown,
    prompt: string,
    existingSessionId?: string
  ): Promise<void>;
  cancelRun(runId: string): Promise<void>;
};

beforeAll(async () => {
  const mod = await import('../executor');
  parseModelString = mod.parseModelString;
  Executor = mod.Executor as unknown as typeof Executor;
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── parseModelString tests ───────────────────────────────────────────────────

describe('parseModelString', () => {
  it('returns null for empty string (use server default)', () => {
    expect(parseModelString('')).toBeNull();
  });

  it('parses "providerID/modelID" into SDK model object', () => {
    expect(parseModelString('anthropic/claude-opus-4-5')).toEqual({
      providerID: 'anthropic',
      modelID: 'claude-opus-4-5',
    });
  });

  it('handles modelID that itself contains slashes (e.g. openrouter paths)', () => {
    expect(parseModelString('openrouter/anthropic/claude-3-5-sonnet')).toEqual({
      providerID: 'openrouter',
      modelID: 'anthropic/claude-3-5-sonnet',
    });
  });

  it('throws on a string with no slash (malformed)', () => {
    expect(() => parseModelString('noSlashAtAll')).toThrow(/malformed model/i);
  });

  it('throws on a string that starts with a slash (empty providerID)', () => {
    expect(() => parseModelString('/modelOnly')).toThrow(/malformed model/i);
  });

  it('throws on a string that ends with a slash (empty modelID)', () => {
    expect(() => parseModelString('providerOnly/')).toThrow(/malformed model/i);
  });
});

// ─── startRun: existingSessionId bypasses session.create() ───────────────────

describe('startRun with existingSessionId', () => {
  function makeRoutine() {
    return {
      id: 'routine-1',
      name: 'Test Routine',
      model: '',
      agent: '',
      workspace_path: '/tmp',
      repository: null,
      branch: null,
      env_vars: '{}',
    };
  }

  function makeMockClient(sessionCreate: ReturnType<typeof vi.fn>) {
    return {
      session: {
        create: sessionCreate,
        prompt: vi.fn().mockResolvedValue({ data: { info: { id: 'msg-1' } } }),
        abort: vi.fn(),
      },
    };
  }

  it('skips session.create() when existingSessionId is supplied', async () => {
    const sessionCreateMock = vi.fn();
    const mockClient = makeMockClient(sessionCreateMock);

    const mockRelease = vi.fn();
    mockAcquireContext.mockResolvedValue({
      client: mockClient,
      baseUrl: 'http://localhost:1234',
      release: mockRelease,
    });

    // DB responses (in call order):
    // 1. metadata fetch
    // 2. trigger_id fetch (no trigger)
    // 3. last-run query in buildPromptContext (none)
    // 4. pre-prompt cancellation status check
    // 5. post-prompt status check
    // NOTE: no session_id fetch since existingSessionId is provided
    mockPrepareGet
      .mockReturnValueOnce({ metadata: '{}' })
      .mockReturnValueOnce({ trigger_id: null })
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce({ status: 'running' })
      .mockReturnValueOnce({ status: 'running' });

    const executor = new Executor();
    // Pass existingSessionId — should bypass session.create()
    await executor.startRun('run-1', makeRoutine(), 'hello', 'existing-session-xyz');

    expect(sessionCreateMock).not.toHaveBeenCalled();
    expect(mockClient.session.prompt).toHaveBeenCalledWith(
      expect.objectContaining({ path: { id: 'existing-session-xyz' } })
    );
  });

  it('calls session.create() when existingSessionId is NOT supplied and DB has no session_id', async () => {
    const sessionCreateMock = vi.fn().mockResolvedValue({ data: { id: 'new-session-abc' } });
    const mockClient = makeMockClient(sessionCreateMock);

    const mockRelease = vi.fn();
    mockAcquireContext.mockResolvedValue({
      client: mockClient,
      baseUrl: 'http://localhost:1234',
      release: mockRelease,
    });

    // DB responses (in call order):
    // 1. metadata fetch
    // 2. trigger_id fetch (no trigger)
    // 3. last-run query in buildPromptContext (none)
    // 4. session_id fetch from DB (null — no prior session)
    // 5. pre-prompt cancellation status check
    // 6. post-prompt status check
    mockPrepareGet
      .mockReturnValueOnce({ metadata: '{}' })
      .mockReturnValueOnce({ trigger_id: null })
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce({ session_id: null })
      .mockReturnValueOnce({ status: 'running' })
      .mockReturnValueOnce({ status: 'running' });

    const executor = new Executor();
    await executor.startRun('run-2', makeRoutine(), 'hello');

    expect(sessionCreateMock).toHaveBeenCalledOnce();
    expect(mockClient.session.prompt).toHaveBeenCalledWith(
      expect.objectContaining({ path: { id: 'new-session-abc' } })
    );
  });
});

// ─── startRun: pre-prompt cancellation check ─────────────────────────────────

describe('startRun cancellation race', () => {
  function makeRoutine() {
    return {
      id: 'routine-2',
      name: 'Cancel Test',
      model: '',
      agent: '',
      workspace_path: '/tmp',
      repository: null,
      branch: null,
      env_vars: '{}',
    };
  }

  it('skips prompt and finalizes as cancelled if DB status is cancelled before prompt', async () => {
    const sessionCreateMock = vi.fn().mockResolvedValue({ data: { id: 'sess-cancel' } });
    const promptMock = vi.fn();
    const mockClient = {
      session: {
        create: sessionCreateMock,
        prompt: promptMock,
        abort: vi.fn(),
      },
    };

    const mockRelease = vi.fn();
    mockAcquireContext.mockResolvedValue({
      client: mockClient,
      baseUrl: 'http://localhost:1234',
      release: mockRelease,
    });

    // DB responses (in call order):
    // 1. metadata fetch
    // 2. trigger_id fetch (no trigger)
    // 3. last-run query in buildPromptContext (none)
    // 4. session_id fetch (null — no prior session in DB)
    // 5. pre-prompt status check → 'cancelled' → skip prompt
    mockPrepareGet
      .mockReturnValueOnce({ metadata: '{}' })
      .mockReturnValueOnce({ trigger_id: null })
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce({ session_id: null })
      .mockReturnValueOnce({ status: 'cancelled' });

    const executor = new Executor();
    await executor.startRun('run-cancel', makeRoutine(), 'do work');

    // prompt must NOT be called since run was already cancelled
    expect(promptMock).not.toHaveBeenCalled();
    // release must still be called to avoid resource leak
    expect(mockRelease).toHaveBeenCalled();
  });
});

// ─── startRun: session.error events downgrade success → failed ────────────────

describe('startRun session.error downgrade', () => {
  function makeRoutine() {
    return {
      id: 'routine-err',
      name: 'Error Test',
      model: '',
      agent: '',
      workspace_path: '/tmp',
      repository: null,
      branch: null,
      env_vars: '{}',
    };
  }

  it('marks run as failed when hadErrors returns true after drain', async () => {
    const mockClient = {
      session: {
        create: vi.fn().mockResolvedValue({ data: { id: 'sess-err-1' } }),
        prompt: vi.fn().mockResolvedValue({ data: { info: { id: 'msg-1' } } }),
        abort: vi.fn(),
      },
    };
    const mockRelease = vi.fn();
    mockAcquireContext.mockResolvedValue({
      client: mockClient,
      baseUrl: 'http://localhost:1234',
      release: mockRelease,
    });

    // hadErrors returns true → run should be marked failed
    mockHadErrors.mockReturnValue(true);

    // DB responses:
    // 1. metadata fetch
    // 2. trigger_id fetch (no trigger)
    // 3. last-run query (none)
    // 4. session_id fetch (null)
    // 5. pre-prompt status check (running)
    // 6. post-prompt status check (running — not cancelled → sets promptCompletedNormally=true)
    mockPrepareGet
      .mockReturnValueOnce({ metadata: '{}' })
      .mockReturnValueOnce({ trigger_id: null })
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce({ session_id: null })
      .mockReturnValueOnce({ status: 'running' })
      .mockReturnValueOnce({ status: 'running' });

    const executor = new Executor();
    await executor.startRun('run-err-1', makeRoutine(), 'do work');

    // db.prepare() is called with the SQL string. Find the call that writes 'failed'.

    const prepareCalls = mockDbPrepare.mock.calls.map((args: any[]) => args[0] as string);
    const failedCall = prepareCalls.find((sql) => sql.includes("status = 'failed'"));
    expect(failedCall).toBeDefined();

    // Should NOT have written status = 'success' as final status
    const successCall = prepareCalls.find((sql) => sql.includes("status = 'success'"));
    expect(successCall).toBeUndefined();

    // close() must be called with a done payload carrying the failed status
    expect(mockRunStreamClose).toHaveBeenCalledWith('run-err-1', {
      status: 'failed',
      exit_code: null,
    });
  });

  it('marks run as success when hadErrors returns false', async () => {
    const mockClient = {
      session: {
        create: vi.fn().mockResolvedValue({ data: { id: 'sess-ok-1' } }),
        prompt: vi.fn().mockResolvedValue({ data: { info: { id: 'msg-1' } } }),
        abort: vi.fn(),
      },
    };
    const mockRelease = vi.fn();
    mockAcquireContext.mockResolvedValue({
      client: mockClient,
      baseUrl: 'http://localhost:1234',
      release: mockRelease,
    });

    mockHadErrors.mockReturnValue(false);

    mockPrepareGet
      .mockReturnValueOnce({ metadata: '{}' })
      .mockReturnValueOnce({ trigger_id: null })
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce({ session_id: null })
      .mockReturnValueOnce({ status: 'running' })
      .mockReturnValueOnce({ status: 'running' });

    const executor = new Executor();
    await executor.startRun('run-ok-1', makeRoutine(), 'do work');

    const prepareCalls2 = mockDbPrepare.mock.calls.map((args: any[]) => args[0] as string);
    const successCall = prepareCalls2.find((sql) => sql.includes("status = 'success'"));
    expect(successCall).toBeDefined();

    // close() must be called with a done payload carrying the success status
    expect(mockRunStreamClose).toHaveBeenCalledWith('run-ok-1', {
      status: 'success',
      exit_code: null,
    });
  });
});

// ─── startRun: trigger context in prompt ─────────────────────────────────────

describe('startRun trigger prompt context', () => {
  function makeRoutine() {
    return {
      id: 'routine-trig',
      name: 'Trigger Context Test',
      model: '',
      agent: '',
      workspace_path: '/tmp',
      repository: null,
      branch: null,
      env_vars: '{}',
    };
  }

  function setupMocks() {
    const promptMock = vi.fn().mockResolvedValue({ data: { info: { id: 'msg-1' } } });
    const mockClient = {
      session: {
        create: vi.fn().mockResolvedValue({ data: { id: 'sess-trig' } }),
        prompt: promptMock,
        abort: vi.fn(),
      },
    };
    mockAcquireContext.mockResolvedValue({
      client: mockClient,
      baseUrl: 'http://localhost:1234',
      release: vi.fn(),
    });
    mockHadErrors.mockReturnValue(false);
    return { promptMock, mockClient };
  }

  function standardDbMocks(triggerId: string | null) {
    mockPrepareGet
      .mockReturnValueOnce({ metadata: '{}' })
      .mockReturnValueOnce({ trigger_id: triggerId })
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce({ session_id: null })
      .mockReturnValueOnce({ status: 'running' })
      .mockReturnValueOnce({ status: 'running' });
  }

  function extractPromptText(promptMock: ReturnType<typeof vi.fn>): string {
    const body = promptMock.mock.calls[0][0].body;
    return body.parts[0].text;
  }

  it('includes recursive folder path for watcher trigger', async () => {
    const { promptMock } = setupMocks();
    standardDbMocks('trig-1');
    mockTriggerFindById.mockReturnValueOnce({
      id: 'trig-1',
      type: 'watcher',
      config: JSON.stringify({
        paths: ['/workspaces/user-data/desktop'],
        recursive: true,
        events: ['add'],
      }),
    });

    const executor = new Executor();
    await executor.startRun('run-trig-1', makeRoutine(), 'sort files');

    const prompt = extractPromptText(promptMock);
    expect(prompt).toContain('[HARD REQUIREMENTS]');
    expect(prompt).toContain('You MUST only access files within: /workspaces/user-data/desktop');
    expect(prompt).not.toContain('top-level');
  });

  it('includes top-level only constraint for non-recursive watcher trigger', async () => {
    const { promptMock } = setupMocks();
    standardDbMocks('trig-2');
    mockTriggerFindById.mockReturnValueOnce({
      id: 'trig-2',
      type: 'watcher',
      config: JSON.stringify({
        paths: ['/data/inbox'],
        recursive: false,
        events: ['add'],
      }),
    });

    const executor = new Executor();
    await executor.startRun('run-trig-2', makeRoutine(), 'process files');

    const prompt = extractPromptText(promptMock);
    expect(prompt).toContain('You MUST only access files within: /data/inbox (top-level only');
    expect(prompt).toContain('do NOT descend into subfolders');
  });

  it('includes multiple folder paths', async () => {
    const { promptMock } = setupMocks();
    standardDbMocks('trig-3');
    mockTriggerFindById.mockReturnValueOnce({
      id: 'trig-3',
      type: 'watcher',
      config: JSON.stringify({
        paths: ['/data/a', '/data/b'],
        recursive: true,
        events: ['add'],
      }),
    });

    const executor = new Executor();
    await executor.startRun('run-trig-3', makeRoutine(), 'sync');

    const prompt = extractPromptText(promptMock);
    expect(prompt).toContain('You MUST only access files within: /data/a, /data/b');
  });

  it('includes include file filter as hard requirement', async () => {
    const { promptMock } = setupMocks();
    standardDbMocks('trig-4');
    mockTriggerFindById.mockReturnValueOnce({
      id: 'trig-4',
      type: 'watcher',
      config: JSON.stringify({
        paths: ['/photos'],
        recursive: true,
        events: ['add'],
        fileFilter: { mode: 'include', patterns: ['.png', '.jpg'] },
      }),
    });

    const executor = new Executor();
    await executor.startRun('run-trig-4', makeRoutine(), 'classify');

    const prompt = extractPromptText(promptMock);
    expect(prompt).toContain('[HARD REQUIREMENTS]');
    expect(prompt).toContain('You MUST only touch files of type: .png, .jpg');
  });

  it('includes exclude file filter as hard requirement', async () => {
    const { promptMock } = setupMocks();
    standardDbMocks('trig-5');
    mockTriggerFindById.mockReturnValueOnce({
      id: 'trig-5',
      type: 'watcher',
      config: JSON.stringify({
        paths: ['/repo'],
        recursive: true,
        events: ['change'],
        fileFilter: { mode: 'exclude', patterns: ['.tmp', '.log'] },
      }),
    });

    const executor = new Executor();
    await executor.startRun('run-trig-5', makeRoutine(), 'lint');

    const prompt = extractPromptText(promptMock);
    expect(prompt).toContain('[HARD REQUIREMENTS]');
    expect(prompt).toContain('You MUST NOT touch files of type: .tmp, .log');
  });

  it('does not add trigger context when no trigger_id', async () => {
    const { promptMock } = setupMocks();
    standardDbMocks(null);

    const executor = new Executor();
    await executor.startRun('run-trig-6', makeRoutine(), 'manual run');

    const prompt = extractPromptText(promptMock);
    expect(prompt).not.toContain('[HARD REQUIREMENTS]');
    expect(prompt).not.toContain('MUST');
  });

  it('skips file filter when mode is none', async () => {
    const { promptMock } = setupMocks();
    standardDbMocks('trig-7');
    mockTriggerFindById.mockReturnValueOnce({
      id: 'trig-7',
      type: 'watcher',
      config: JSON.stringify({
        paths: ['/data'],
        recursive: true,
        events: ['add'],
        fileFilter: { mode: 'none', patterns: ['.png'] },
      }),
    });

    const executor = new Executor();
    await executor.startRun('run-trig-7', makeRoutine(), 'watch');

    const prompt = extractPromptText(promptMock);
    expect(prompt).toContain('You MUST only access files within: /data');
    expect(prompt).not.toContain('MUST only touch');
    expect(prompt).not.toContain('MUST NOT touch');
  });
});
