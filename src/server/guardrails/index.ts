import type { BudgetRepository, BudgetUsage } from './budget-contract'
import { tokenBucket } from './rate-limit'
import { createSessionStore, type SessionMessage } from './session-state'
import { dailyTokenCap, reservationStaleMs, underDailyBudget, today } from './budget'

/** IP/会话双维内存令牌桶限流速率（默认 10 次/分）。 */
export const RATE_PER_MIN = 10
/** 护栏温和文案（消费端措辞，绝不暴露 "rate limited"）。 */
export const GUARDRAIL_MESSAGE = 'The assistant is taking a short break — try again in a moment.'

export class GuardrailError extends Error {
  constructor(
    public code: 'rate_limited' | 'budget' | 'turns',
    message: string,
  ) {
    super(message)
    this.name = 'GuardrailError'
  }
}

/**
 * 组装护栏决策。注意：内存令牌桶与会话计数都存活在实例内，
 * 必须单例复用（chat 模块级一次 createGuardrails(repo)），跨请求共享才有意义。
 */
export function createGuardrails(
  repo: BudgetRepository,
  options?: { now?: () => number }, // 可注入时钟：测试用假时钟驱动超回合/限流边界，不碰真实时间
) {
  const nowMs = () => options?.now?.() ?? Date.now()
  const sessions = createSessionStore(nowMs)
  const ipBuckets = tokenBucket(RATE_PER_MIN, RATE_PER_MIN, { now: nowMs })
  const sessionBuckets = tokenBucket(RATE_PER_MIN, RATE_PER_MIN, { now: nowMs })
  let lastRecovery: number | undefined
  let recovery: Promise<void> | undefined

  const recoverBudget = async () => {
    if (recovery) return recovery
    const now = nowMs()
    if (lastRecovery !== undefined && now - lastRecovery < 60_000) return
    recovery = (async () => {
      const recovered = await repo.recoverDailyBudgetReservations(now - reservationStaleMs())
      if (recovered > 0) console.warn('[ai/budget] recovered uncertain reservations', recovered)
      lastRecovery = now
    })()
    try {
      await recovery
    } finally {
      recovery = undefined
    }
  }

  const deny = (code: GuardrailError['code']): never => {
    throw new GuardrailError(code, GUARDRAIL_MESSAGE)
  }

  return {
    /** 领取一个回合；超限抛 code='turns'，否则返回裁剪后的会话历史供上下文注入。 */
    assertTurn(sessionKey: string): SessionMessage[] {
      const { allowed, history } = sessions.claim(sessionKey, nowMs())
      if (!allowed) deny('turns')
      return history
    },
    /**
     * 回合结束后把 user/assistant 消息写回同一会话存储。
     * 「全文」不成立：单条超长与超出窗口历史的裁剪发生在存储层
     * （session-state.ts 的 MAX_HISTORY_MESSAGE_CHARS / HISTORY_TURNS）。
     * 该裁剪是 I7「AI 护栏必须有界」的验收项，不得为保真而放宽。
     */
    pushTurn(sessionKey: string, role: SessionMessage['role'], content: string) {
      sessions.push(sessionKey, role, content)
    },
    /** IP+session 双维令牌桶；任一维度超限抛 code='rate_limited'。 */
    assertRate(ip: string, sessionKey: string): void {
      // Reject at the IP boundary before allocating a fresh session bucket.
      if (!ipBuckets.allow(ip, nowMs()) || !sessionBuckets.allow(sessionKey, nowMs())) {
        deny('rate_limited')
      }
    },
    /** 当日用量达到 AI_DAILY_TOKEN_CAP 后抛 code='budget'。 */
    async assertBudget(day = today()): Promise<void> {
      if (!(await underDailyBudget(repo, day))) deny('budget')
    },
    /** Atomically reserve an estimated prompt+completion budget for one request. */
    async reserveBudget(requestId: string, tokens: number, day = today()): Promise<void> {
      await recoverBudget()
      const accepted = await repo.reserveDailyBudget({
        requestId,
        day,
        tokens,
        cap: dailyTokenCap(),
      })
      if (!accepted) deny('budget')
    },
    /** Account for completed usage even if its estimate exceeded the admission cap. */
    async settleBudget(requestId: string, usage: BudgetUsage): Promise<void> {
      const settled = await repo.settleDailyBudget({ requestId, usage, cap: dailyTokenCap() })
      if (!settled) throw new Error('AI budget reservation is no longer pending')
    },
    /** Consume the full reservation when provider cost cannot be established. */
    async abandonBudget(requestId: string): Promise<void> {
      if (!(await repo.abandonDailyBudget(requestId))) {
        throw new Error('AI budget reservation cannot be abandoned')
      }
    },
    /** Release only when provider work has not begun. */
    async releaseBudget(requestId: string): Promise<void> {
      if (!(await repo.releaseDailyBudget(requestId))) {
        throw new Error('AI budget reservation cannot be released')
      }
    },
    /** 估算 token 落库 ai_usage（匿名成本计量）。 */
    async noteUsage(u: BudgetUsage): Promise<void> {
      await repo.insertUsage(u)
    },
    dispose() {
      sessions.dispose()
      ipBuckets.dispose()
      sessionBuckets.dispose()
    },
  }
}

export type Guardrails = ReturnType<typeof createGuardrails>
