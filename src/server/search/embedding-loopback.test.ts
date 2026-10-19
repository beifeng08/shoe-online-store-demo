// @vitest-environment node
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { Socket } from 'node:net'
import type { NextResponse } from 'next/server'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest'
import type { AppDb } from '@/db/client'
import type { ChatEvent } from '@/domain/chat-events'
import type { Product } from '@/domain/product'
import type { AiProvider } from '@/server/ai/provider'
import type { Guardrails } from '@/server/guardrails'
import type { Repository } from './repository'

const state = vi.hoisted(() => ({
  repo: undefined as Repository | undefined,
  guardrails: [] as Guardrails[],
  stream: vi.fn<AiProvider['stream']>(),
}))

vi.mock('@/server/catalog/adapter', async () => {
  const { seedAdapter } = await import('@/server/catalog/seed-adapter')
  return { catalog: () => seedAdapter }
})
vi.mock('@/server/search/repository', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./repository')>()),
  createDefaultRepository: () => {
    if (!state.repo) throw new Error('内存仓库尚未初始化')
    return state.repo
  },
}))
vi.mock('@/server/ai/factory', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/ai/factory')>()),
  aiProvider: (): AiProvider => ({ stream: state.stream }),
}))
vi.mock('@/server/guardrails', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/guardrails')>()
  return {
    ...actual,
    createGuardrails: (...args: Parameters<typeof actual.createGuardrails>) => {
      const guardrails = actual.createGuardrails(...args)
      state.guardrails.push(guardrails)
      return guardrails
    },
  }
})

const MODEL = 'test-only-loopback-embedding'
const QUERY = 'sneaker'
const REPLY = 'Test-only deterministic recommendation.'
const PRIVATE_PAYLOAD = 'test-only-private-upstream-payload'
const CHAT_USAGE = { promptTokens: 7, completionTokens: 3 }
const DEADLINE_MS = 120
const CANCEL_BOUND_MS = 1_000

type Scenario = 'headers' | 'body' | 'bad-batch' | 'dimension' | 'dimension-retry' | 'success'
type Status = 'settled' | 'abandoned'
type Tables = typeof import('@/db/schema')
type Ledger = {
  reservations: Tables['aiBudgetReservations']['$inferSelect'][]
  days: Tables['aiBudgetDays']['$inferSelect'][]
  usage: Tables['aiUsage']['$inferSelect'][]
  embeddings: Tables['productEmbeddings']['$inferSelect'][]
}
type LoopbackContext = {
  provider: Awaited<ReturnType<typeof startLoopback>>
  repo: Repository
  writes: MockInstance<Repository['upsertEmbedding']>
  snapshot: () => Ledger
  products: Product[]
  productTexts: string[]
  keywordHandles: string[]
  searchableText: typeof import('@/domain/search-text').searchableText
  hashText: typeof import('./retrieval').hashText
  openRoute: () => Promise<{
    response: NextResponse
    reader: ReadableStreamDefaultReader<Uint8Array>
    controller: AbortController
  }>
  readEvents: (reader: ReadableStreamDefaultReader<Uint8Array>) => Promise<ChatEvent[]>
  assertSafeLogs: (fallbacks: number) => void
  assertLedger: (statuses: Status[], chatCalls: number) => Promise<void>
  assertPendingQuery: (call: Call) => void
  assertEmptyCache: () => void
  assertCompleted: (frames: ChatEvent[], handles: string[]) => void
}
type Call = {
  kind: 'probe' | 'query' | 'batch'
  input: string[]
  requestId: string
  day: string
  tokens: number
  closed: Promise<void>
  closedBeforeEnd: boolean
}

// 此计时器独立于生产 AbortSignal，生产请求未结束时也能有限失败。
async function finite<T>(operation: Promise<T>, label: string, ms = 2_500): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}未在有限等待内结束`)), ms)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

async function observeQuietly(): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await finite(
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 180)
      }),
      '观察取消后的延迟工作',
    )
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

async function startLoopback(
  scenario: Scenario,
  pending: () => { requestId: string; day: string; reservedTokens: number }[],
  tokensFor: (texts: string[]) => number,
) {
  const sockets = new Set<Socket>()
  const calls: Call[] = []
  const faults: string[] = []
  let queryResponse: ServerResponse | undefined
  let resolveQuery!: (call: Call) => void
  const queryStarted = new Promise<Call>((resolve) => {
    resolveQuery = resolve
  })
  const send = (response: ServerResponse, data: unknown[]) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ data, debug: PRIVATE_PAYLOAD }))
  }
  const handle = async (request: IncomingMessage, response: ServerResponse) => {
    if (
      request.socket.remoteAddress !== '127.0.0.1' ||
      request.method !== 'POST' ||
      request.url !== '/v1/embeddings' ||
      request.headers.authorization?.trim() !== 'Bearer'
    ) {
      throw new Error('非预期的 loopback 请求')
    }
    const raw = await finite(
      (async () => {
        const chunks: Buffer[] = []
        for await (const chunk of request) chunks.push(Buffer.from(chunk))
        return Buffer.concat(chunks).toString('utf8')
      })(),
      '读取 loopback 请求体',
    )
    const payload: unknown = JSON.parse(raw)
    if (
      payload === null ||
      typeof payload !== 'object' ||
      !('model' in payload) ||
      payload.model !== MODEL ||
      !('encoding_format' in payload) ||
      payload.encoding_format !== 'float' ||
      !('input' in payload)
    ) {
      throw new Error('embedding 请求格式不符')
    }
    const input: unknown = payload.input
    const probe = input === 'ping'
    if (!probe && (!Array.isArray(input) || !input.every((value) => typeof value === 'string'))) {
      throw new Error('正式 embedding 输入必须是字符串数组')
    }
    const texts: string[] = probe ? ['ping'] : (input as string[])
    const kind = probe ? 'probe' : texts.length === 1 ? 'query' : 'batch'
    if ((kind === 'query' && texts[0] !== QUERY) || (kind === 'batch' && texts.length < 2)) {
      throw new Error('query 或 batch 的输入不符')
    }
    const reservations = pending()
    if (reservations.length !== 1 || reservations[0].reservedTokens !== tokensFor(texts)) {
      throw new Error('每次网络请求必须有独立且精确的 pending reservation')
    }
    let resolveClosed!: () => void
    const closed = new Promise<void>((resolve) => {
      resolveClosed = resolve
    })
    const call: Call = {
      kind,
      input: texts,
      requestId: reservations[0].requestId,
      day: reservations[0].day,
      tokens: tokensFor(texts),
      closed,
      closedBeforeEnd: false,
    }
    response.once('close', () => {
      call.closedBeforeEnd = !response.writableEnded
      resolveClosed()
    })
    calls.push(call)
    if (kind === 'probe') {
      send(response, [{ embedding: [1, 0] }])
      return
    }
    if (kind === 'query') {
      queryResponse = response
      if (scenario === 'body') {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.flushHeaders()
        response.write('{"data":[{"embedding":[')
      } else if (scenario !== 'headers') {
        send(response, [{ embedding: [1, 0] }])
      }
      resolveQuery(call)
      return
    }
    if (scenario === 'bad-batch') {
      // 整批长度正确、前缀合法，只有最后一个向量含不可用的原始 payload。
      send(
        response,
        texts.map((_text, index) => ({
          index,
          embedding: index === texts.length - 1 ? [1, PRIVATE_PAYLOAD] : [index + 1, 1],
        })),
      )
      return
    }
    if (scenario === 'dimension' || scenario === 'dimension-retry') {
      if (
        scenario === 'dimension-retry' &&
        calls.filter((value) => value.kind === 'batch').length === 1
      ) {
        response.writeHead(503)
        response.end()
        return
      }
      send(
        response,
        texts.map((_text, index) => ({ index, embedding: [index + 1, 1, 1] })),
      )
      return
    }
    if (scenario !== 'success') throw new Error('停滞 query 后不应出现 batch')
    send(response, texts.map((_text, index) => ({ index, embedding: [index + 1, 1] })).reverse())
  }
  const server = createServer((request, response) => {
    void handle(request, response).catch(() => {
      // fixture 自身错误也不把请求体或上游 payload 写到日志。
      faults.push('loopback fixture 请求失败')
      response.destroy()
    })
  })
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })
  const close = async () => {
    const closed = new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') {
          reject(error)
        } else {
          resolve()
        }
      })
    })
    server.closeAllConnections()
    for (const socket of sockets) socket.destroy()
    await finite(closed, '关闭 owned loopback listener')
  }
  try {
    await finite(
      new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', () => {
          server.removeListener('error', reject)
          resolve()
        })
      }),
      '启动 loopback listener',
    )
    const address = server.address()
    if (!address || typeof address === 'string' || address.address !== '127.0.0.1') {
      throw new Error('listener 必须只绑定 IPv4 loopback')
    }
    return {
      origin: `http://127.0.0.1:${address.port}`,
      calls,
      faults,
      queryStarted,
      close,
      releaseQuery() {
        if (!queryResponse || queryResponse.destroyed || queryResponse.writableEnded) return
        if (scenario === 'body') queryResponse.end('1,0]}]}')
        else send(queryResponse, [{ embedding: [1, 0] }])
      },
      listening: () => server.listening,
    }
  } catch (error) {
    await close()
    throw error
  }
}

const loadDatabaseModules = () =>
  Promise.all([
    import('@/db/client'),
    import('./repository'),
    import('@/db/schema'),
    import('@/server/guardrails/text'),
  ])

const loadRouteModules = () =>
  Promise.all([
    import('@/app/api/ai/chat/route'),
    import('next/server'),
    import('@/domain/chat-events'),
    import('@/server/catalog/seed-adapter'),
    import('@/domain/search-text'),
    import('./retrieval'),
    import('./keyword'),
  ])

// 首次转换模块图的耗时随机器负载波动，不是 finite 要约束的生产行为；每个用例 resetModules 后仍在 finite 内重新求值。
beforeAll(async () => {
  await Promise.all([loadDatabaseModules(), loadRouteModules()])
})

beforeEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
  state.repo = undefined
  state.guardrails.length = 0
  state.stream.mockReset()
  state.stream.mockImplementation(async function* (context) {
    context.signal?.throwIfAborted()
    yield REPLY
    yield { type: 'usage' as const, usage: CHAT_USAGE }
  })
  for (const [key, value] of Object.entries({
    NODE_ENV: 'test',
    APP_ENV: 'test',
    AI_SESSION_SECRET: 'test-only-loopback-session-secret-not-for-deployment',
    AI_API_KEY: '',
    AI_DISABLE_REAL: '0',
    AI_BASE_URL: '',
    AI_EMBEDDING_MODEL: MODEL,
    AI_REQUEST_TIMEOUT_MS: String(DEADLINE_MS),
    AI_DAILY_TOKEN_CAP: '1000000',
    AI_MAX_OUTPUT_TOKENS: '32',
    AI_MAX_MESSAGE_CHARS: '800',
    CATALOG_SOURCE: 'seed',
    DB_DRIVER: 'sqlite',
    DATABASE_URL: ':memory:',
    NODE_USE_ENV_PROXY: '0',
    HTTP_PROXY: '',
    HTTPS_PROXY: '',
    ALL_PROXY: '',
    http_proxy: '',
    https_proxy: '',
    all_proxy: '',
    NO_PROXY: '127.0.0.1',
  })) {
    vi.stubEnv(key, value)
  }
  for (const level of ['warn', 'error', 'log', 'info'] as const) {
    vi.spyOn(console, level).mockImplementation(() => {})
  }
})

afterEach(() => {
  try {
    for (const guardrails of state.guardrails.splice(0)) guardrails.dispose()
  } finally {
    state.repo = undefined
    state.stream.mockReset()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.resetModules()
    vi.useRealTimers()
  }
})

async function withLoopback(scenario: Scenario, run: (context: LoopbackContext) => Promise<void>) {
  const [{ createDb }, { createRepository }, tables, text] = await finite(
    loadDatabaseModules(),
    '动态加载真实数据库与预算模块',
  )
  const database = createDb(':memory:') as AppDb & { $client: { close(): void } }
  let loopback: Awaited<ReturnType<typeof startLoopback>> | undefined
  const readers = new Set<ReadableStreamDefaultReader<Uint8Array>>()
  const controllers: AbortController[] = []
  const snapshot = (): Ledger => ({
    reservations: database.select().from(tables.aiBudgetReservations).all(),
    days: database.select().from(tables.aiBudgetDays).all(),
    usage: database.select().from(tables.aiUsage).orderBy(tables.aiUsage.id).all(),
    embeddings: database.select().from(tables.productEmbeddings).all(),
  })
  const tokensFor = (texts: string[]) =>
    Math.max(
      1,
      texts.reduce((sum, value) => sum + text.estTokens(value), 0),
    )

  async function makeContext(): Promise<LoopbackContext> {
    const repo = createRepository(database)
    state.repo = repo
    // Spy 保留真实 SQLite 写入，仅用于证明坏批次连第一条写入都未尝试。
    const writes = vi.spyOn(repo, 'upsertEmbedding')
    loopback = await startLoopback(
      scenario,
      () => snapshot().reservations.filter((row) => row.status === 'pending'),
      tokensFor,
    )
    const provider = loopback
    vi.stubEnv('AI_BASE_URL', `${provider.origin}/v1`)
    const [
      { POST },
      { NextRequest },
      events,
      { seedAdapter },
      { searchableText },
      { hashText },
      keyword,
    ] = await finite(loadRouteModules(), '动态加载真实 POST 与检索模块')
    const products = await finite(seedAdapter.getProducts({}), '读取内存 seed 目录')
    expect(products.length).toBeGreaterThan(10)
    const productTexts = products.map(searchableText)
    const keywordHandles = keyword
      .keywordSearch(QUERY, products)
      .filter((hit) => hit.score > 0)
      .slice(0, 4)
      .map((hit) => hit.handle)
    expect(keywordHandles.length).toBeGreaterThan(0)

    const openRoute = async () => {
      const controller = new AbortController()
      controllers.push(controller)
      const response = await finite(
        POST(
          new NextRequest(`${provider.origin}/api/ai/chat`, {
            method: 'POST',
            signal: controller.signal,
            headers: {
              'content-type': 'application/json',
              origin: provider.origin,
              'sec-fetch-site': 'same-origin',
            },
            body: JSON.stringify({ mode: 'find-shoes', text: QUERY }),
          }),
        ),
        '调用真实 POST Route Handler',
      )
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('text/event-stream')
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(response.headers.get('set-cookie')).toContain('HttpOnly')
      expect(response.body).not.toBeNull()
      const reader = response.body!.getReader()
      readers.add(reader)
      return { response, reader, controller }
    }
    const readEvents = async (reader: ReadableStreamDefaultReader<Uint8Array>) => {
      const raw = await finite(
        (async () => {
          const decoder = new TextDecoder()
          let result = ''
          while (true) {
            const next = await reader.read()
            if (next.done) return result + decoder.decode()
            result += decoder.decode(next.value, { stream: true })
          }
        })(),
        '读取完整 SSE 并等待 EOF',
      )
      expect(raw).not.toContain(PRIVATE_PAYLOAD)
      return raw
        .split('\n\n')
        .filter((frame) => frame.trim() !== '')
        .map((frame): ChatEvent => {
          const event = events.parseEvent(frame)
          expect(event).not.toBeNull()
          return event!
        })
    }
    const assertSafeLogs = (fallbacks: number) => {
      const warnings = vi.mocked(console.warn).mock.calls
      expect(warnings).toHaveLength(fallbacks)
      for (const call of warnings) {
        expect(call).toEqual([JSON.stringify({ event: 'retrieval_fallback', strategy: 'keyword' })])
      }
      for (const call of vi.mocked(console.error).mock.calls) {
        expect(call).toHaveLength(1)
        expect(typeof call[0]).toBe('string')
        expect(call[0]).not.toContain(PRIVATE_PAYLOAD)
        const value = JSON.parse(call[0] as string)
        expect(value).toEqual({
          event: 'ai_provider_failure',
          request_id: expect.any(String),
          elapsed_ms: expect.any(Number),
        })
      }
      expect(console.log).not.toHaveBeenCalled()
      expect(console.info).not.toHaveBeenCalled()
    }
    const assertLedger = async (statuses: Status[], chatCalls: number) => {
      const ledger = snapshot()
      expect(provider.faults).toEqual([])
      expect(provider.calls).toHaveLength(statuses.length)
      expect(state.stream).toHaveBeenCalledTimes(chatCalls)
      expect(state.guardrails).toHaveLength(1)
      expect(ledger.reservations).toHaveLength(statuses.length + chatCalls)
      expect(ledger.reservations.filter((row) => row.status === 'pending')).toEqual([])
      expect(ledger.reservations.filter((row) => row.status === 'settling')).toEqual([])
      const day = provider.calls[0].day
      const embeddingUsage = provider.calls.flatMap((call, index) => {
        expect(ledger.reservations.find((row) => row.requestId === call.requestId)).toEqual({
          requestId: call.requestId,
          day,
          reservedTokens: call.tokens,
          actualTokens: call.tokens,
          status: statuses[index],
          createdAt: expect.any(Number),
        })
        return statuses[index] === 'settled'
          ? [{ model: MODEL, promptTokens: call.tokens, completionTokens: 0 }]
          : []
      })
      const networkIds = new Set(provider.calls.map((call) => call.requestId))
      const chatReservations = ledger.reservations.filter((row) => !networkIds.has(row.requestId))
      for (let index = 0; index < chatReservations.length; index++) {
        const context = state.stream.mock.calls[index][0]
        const prompt = [context.system, ...context.messages.map((message) => message.content)]
          .filter(Boolean)
          .join('\n')
        expect(chatReservations[index]).toMatchObject({
          day,
          status: 'settled',
          reservedTokens: text.estTokens(prompt) + text.maxOutputTokens(),
          actualTokens: CHAT_USAGE.promptTokens + CHAT_USAGE.completionTokens,
        })
      }
      const usageFields = (row: (typeof ledger.usage)[number]) => ({
        model: row.model,
        promptTokens: row.promptTokens,
        completionTokens: row.completionTokens,
      })
      // 按模型拆开真实 embedding 与确定性 chat，避免将混合行数当成 embedding 成功数。
      expect(ledger.usage.filter((row) => row.model === MODEL).map(usageFields)).toEqual(
        embeddingUsage,
      )
      expect(ledger.usage.filter((row) => row.model === 'mock').map(usageFields)).toEqual(
        Array.from({ length: chatCalls }, () => ({ model: 'mock', ...CHAT_USAGE })),
      )
      expect(ledger.usage).toHaveLength(embeddingUsage.length + chatCalls)
      const usedTokens =
        provider.calls.reduce((sum, call) => sum + call.tokens, 0) +
        chatCalls * (CHAT_USAGE.promptTokens + CHAT_USAGE.completionTokens)
      expect(ledger.days).toEqual([{ day, reservedTokens: 0, usedTokens }])
      await expect(finite(repo.dayTokenUsage(day), '读取真实日预算')).resolves.toBe(usedTokens)
    }
    const assertPendingQuery = (call: Call) => {
      expect(provider.calls.map((value) => value.kind)).toEqual(['probe', 'query'])
      expect(call.input).toEqual([QUERY])
      expect(snapshot().reservations.find((row) => row.requestId === call.requestId)).toMatchObject(
        {
          status: 'pending',
          reservedTokens: tokensFor([QUERY]),
          actualTokens: 0,
        },
      )
      expect(state.stream).not.toHaveBeenCalled()
      expect(writes).not.toHaveBeenCalled()
    }
    const assertEmptyCache = () => {
      expect(writes).not.toHaveBeenCalled()
      expect(snapshot().embeddings).toEqual([])
    }
    const assertCompleted = (frames: ChatEvent[], handles: string[]) => {
      expect(frames).toEqual([
        { type: 'productCards', items: expect.any(Array) },
        { type: 'delta', text: REPLY },
        { type: 'done' },
      ])
      const cards = frames[0]
      if (cards.type !== 'productCards') throw new Error('缺少真实商品卡帧')
      expect(cards.items.map((card) => card.handle)).toEqual(handles)
      expect(state.stream.mock.calls.at(-1)?.[0].system).toContain(
        products.find((product) => product.handle === handles[0])!.title,
      )
      expect(console.error).not.toHaveBeenCalled()
    }
    return {
      provider,
      repo,
      writes,
      snapshot,
      products,
      productTexts,
      keywordHandles,
      searchableText,
      hashText,
      openRoute,
      readEvents,
      assertSafeLogs,
      assertLedger,
      assertPendingQuery,
      assertEmptyCache,
      assertCompleted,
    }
  }

  try {
    await run(await makeContext())
  } finally {
    for (const controller of controllers) controller.abort()
    // 无论断言或生产流是否失败，均主动摧毁本 fixture 的连接并关闭 listener。
    const cleanup = await Promise.allSettled([
      ...(loopback ? [loopback.close()] : []),
      ...Array.from(readers, (reader) => finite(reader.cancel(), '清理 owned SSE reader')),
    ])
    try {
      for (const guardrails of state.guardrails.splice(0)) guardrails.dispose()
    } finally {
      state.repo = undefined
      database.$client.close()
    }
    expect(loopback?.listening() ?? false).toBe(false)
    expect(cleanup.filter((result) => result.status === 'rejected')).toEqual([])
  }
}

describe('真实 loopback embedding 经 POST 路由的预算、取消与缓存', () => {
  it.each(['headers', 'body'] as const)(
    'query %s 停滞按 deadline 放弃并有限完成关键词回退',
    async (phase) => {
      await withLoopback(phase, async (context) => {
        const { reader } = await context.openRoute()
        const query = await finite(context.provider.queryStarted, '等待正式 query')
        context.assertPendingQuery(query)
        context.assertCompleted(await context.readEvents(reader), context.keywordHandles)
        await finite(query.closed, '等待停滞 query 连接关闭')
        expect(query.closedBeforeEnd).toBe(true)
        context.assertEmptyCache()
        await context.assertLedger(['settled', 'abandoned'], 1)
        context.assertSafeLogs(1)
      })
    },
  )

  it.each(['Error', 'EmbeddingDispatchBlockedError'] as const)(
    '请求 signal 在 query 中以 %s abort 后安全结束且不调用 chat、不回退、不写缓存',
    async (reasonKind) => {
      // 取消必须早于独立的 1 秒上限；10 秒 provider deadline 无法替取消实现兜底。
      vi.stubEnv('AI_REQUEST_TIMEOUT_MS', '10000')
      await withLoopback('body', async (context) => {
        const { reader, controller, response } = await context.openRoute()
        const query = await finite(context.provider.queryStarted, '等待可取消的 query')
        context.assertPendingQuery(query)
        const completion = context.readEvents(reader)
        const { EmbeddingDispatchBlockedError } = await finite(
          import('./embedder'),
          '读取取消原因类型',
        )
        controller.abort(
          reasonKind === 'Error'
            ? new Error(PRIVATE_PAYLOAD)
            : new EmbeddingDispatchBlockedError(PRIVATE_PAYLOAD),
        )
        const frames = await finite(completion, 'caller abort 后流必须结束', CANCEL_BOUND_MS)
        const { FALLBACK_ERROR_TEXT } = await finite(
          import('@/server/ai/chat'),
          '读取真实安全错误文案',
        )
        expect(frames).toEqual([{ type: 'error', code: 'provider', message: FALLBACK_ERROR_TEXT }])
        await finite(query.closed, 'caller abort 关闭 query 连接', CANCEL_BOUND_MS)
        expect(query.closedBeforeEnd).toBe(true)
        context.assertEmptyCache()
        await context.assertLedger(['settled', 'abandoned'], 0)
        context.assertSafeLogs(0)
        expect(vi.mocked(console.error).mock.calls).toHaveLength(1)
        expect(JSON.parse(vi.mocked(console.error).mock.calls[0][0] as string).request_id).toBe(
          response.headers.get('x-request-id'),
        )
        const before = context.snapshot()
        context.provider.releaseQuery()
        await observeQuietly()
        expect(context.snapshot()).toEqual(before)
        await context.assertLedger(['settled', 'abandoned'], 0)
        context.assertSafeLogs(0)
      })
    },
  )

  it('reader.cancel 及时结束自身及 pending read，随后没有新调用或预算变化', async () => {
    vi.stubEnv('AI_REQUEST_TIMEOUT_MS', '10000')
    await withLoopback('headers', async (context) => {
      const { reader } = await context.openRoute()
      const pendingRead = reader.read()
      const query = await finite(context.provider.queryStarted, '等待 reader 的 pending query')
      context.assertPendingQuery(query)
      const [cancelled, read] = await finite(
        Promise.all([reader.cancel(), pendingRead]),
        'reader cancel 和 pending read 必须同时结束',
        CANCEL_BOUND_MS,
      )
      expect(cancelled).toBeUndefined()
      expect(read).toEqual({ done: true, value: undefined })
      await finite(query.closed, 'reader cancel 关闭 query 连接', CANCEL_BOUND_MS)
      expect(query.closedBeforeEnd).toBe(true)
      context.assertEmptyCache()
      await context.assertLedger(['settled', 'abandoned'], 0)
      context.assertSafeLogs(0)
      const before = context.snapshot()
      context.provider.releaseQuery()
      await observeQuietly()
      expect(context.snapshot()).toEqual(before)
      context.assertEmptyCache()
      await context.assertLedger(['settled', 'abandoned'], 0)
      context.assertSafeLogs(0)
    })
  })

  it('合法 query 后坏 batch 的合法前缀也零写入，批次放弃且不泄漏 payload', async () => {
    await withLoopback('bad-batch', async (context) => {
      const { reader } = await context.openRoute()
      context.assertCompleted(await context.readEvents(reader), context.keywordHandles)
      expect(context.provider.calls.map((call) => call.kind)).toEqual(['probe', 'query', 'batch'])
      expect(context.provider.calls[1].input).toEqual([QUERY])
      expect(context.provider.calls[2].input).toEqual(context.productTexts)
      context.assertEmptyCache()
      await context.assertLedger(['settled', 'settled', 'abandoned'], 1)
      context.assertSafeLogs(1)
    })
  })

  it.each(['dimension', 'dimension-retry'] as const)(
    '%s 的合法三维 batch 与二维 query 不符时在结算前拒绝，零缓存且无 batch 成功 usage',
    async (scenario) => {
      await withLoopback(scenario, async (context) => {
        const { reader } = await context.openRoute()
        context.assertCompleted(await context.readEvents(reader), context.keywordHandles)
        const retry = scenario === 'dimension-retry'
        expect(context.provider.calls.map((call) => call.kind)).toEqual(
          retry ? ['probe', 'query', 'batch', 'batch'] : ['probe', 'query', 'batch'],
        )
        for (const call of context.provider.calls.filter((value) => value.kind === 'batch')) {
          expect(call.input).toEqual(context.productTexts)
        }
        context.assertEmptyCache()
        await context.assertLedger(
          retry
            ? ['settled', 'settled', 'abandoned', 'abandoned']
            : ['settled', 'settled', 'abandoned'],
          1,
        )
        context.assertSafeLogs(1)
      })
    },
  )

  it('反序 indexed batch 按输入映射全部真实缓存，第二次检索复用缓存且逐调用结算', async () => {
    await withLoopback('success', async (context) => {
      const handles = context.products
        .slice(-4)
        .reverse()
        .map((product) => product.handle)
      const first = await context.openRoute()
      context.assertCompleted(await context.readEvents(first.reader), handles)
      expect(context.provider.calls.map((call) => call.kind)).toEqual(['probe', 'query', 'batch'])
      expect(context.provider.calls[2].input).toEqual(context.productTexts)
      expect(context.writes).toHaveBeenCalledTimes(context.products.length)
      const cached = await finite(context.repo.allEmbeddings(MODEL), '读取完整真实 embedding 缓存')
      expect(cached).toHaveLength(context.products.length)
      for (let index = 0; index < context.products.length; index++) {
        const product = context.products[index]
        expect(cached.find((row) => row.productId === product.id)).toEqual({
          productId: product.id,
          contentHash: context.hashText(context.searchableText(product)),
          model: MODEL,
          vector: [index + 1, 1],
        })
      }
      await context.assertLedger(['settled', 'settled', 'settled'], 1)
      const second = await context.openRoute()
      context.assertCompleted(await context.readEvents(second.reader), handles)
      expect(context.provider.calls.map((call) => call.kind)).toEqual([
        'probe',
        'query',
        'batch',
        'query',
      ])
      expect(context.provider.calls[3].input).toEqual([QUERY])
      expect(context.writes).toHaveBeenCalledTimes(context.products.length)
      expect(await finite(context.repo.allEmbeddings(MODEL), '再次读取缓存')).toEqual(cached)
      await context.assertLedger(['settled', 'settled', 'settled', 'settled'], 2)
      context.assertSafeLogs(0)
    })
  })
})
