import { financeRouteNames } from '@/router/business-paths'
import { useArtFeedback } from '@/hooks/core/useArtFeedback'
import { fetchAccountSetOptions, fetchAccountingReadiness } from '@fms/api'
import type { FinancePrerequisiteOverlay } from './finance-prerequisite-overlay'

export { createFinancePrerequisiteOverlay } from './finance-prerequisite-overlay'
export type {
  FinancePrerequisiteOverlay,
  FinancePrerequisiteSession
} from './finance-prerequisite-overlay'

interface FinanceAccountSetPrerequisiteOptions {
  actionLabel: string
  activeRequired?: boolean
  accountSetId?: string
  available: boolean
  foundationRequired?: boolean
  fundAccountRequired?: boolean
}

function isMessageBoxDismissed(error: unknown): boolean {
  return error === 'cancel' || error === 'close'
}

/**
 * Gives disabled-looking finance entry points an actionable next step while
 * preserving the database-enforced account-set lifecycle requirements.
 */
export function useFinanceAccountSetPrerequisite() {
  const router = useRouter()
  const { confirmAction } = useArtFeedback()

  async function confirmAndNavigate(
    message: string,
    title: string,
    confirmButtonText: string,
    routeName: string,
    isCurrent: () => boolean = () => true
  ): Promise<void> {
    if (!isCurrent()) return
    try {
      await confirmAction(message, title, {
        type: 'info',
        confirmButtonText,
        cancelButtonText: '暂不处理'
      })
      if (isCurrent()) await router.push({ name: routeName })
    } catch (error) {
      if (!isMessageBoxDismissed(error)) throw error
    }
  }

  async function ensureAccountSet(
    {
      actionLabel,
      activeRequired = false,
      accountSetId,
      available,
      foundationRequired = false,
      fundAccountRequired = false
    }: FinanceAccountSetPrerequisiteOptions,
    isCurrent: () => boolean = () => true
  ): Promise<boolean> {
    if (!isCurrent()) return false
    if (!available) {
      const { data, error } = await fetchAccountSetOptions({
        status: activeRequired ? 'active' : undefined,
        from: 0,
        to: 0
      })
      if (!isCurrent() || error) return false
      available = Boolean(data?.length)
    }
    if (available) {
      if (!foundationRequired || !accountSetId) return true
      const { data } = await fetchAccountingReadiness(accountSetId)
      if (!isCurrent()) return false
      if (!data?.foundationReady) {
        await confirmAndNavigate(
          `“${actionLabel}”需要先补齐核心科目、自动制证规则和财务报表映射。初始化只新增缺失项，不覆盖已有配置。`,
          '核算基础尚未就绪',
          '前往会计科目',
          financeRouteNames.accountingSubject,
          isCurrent
        )
        return false
      }
      if (fundAccountRequired && !data?.fundAccountCount) {
        await confirmAndNavigate(
          `“${actionLabel}”需要至少一个已启用的资金账户。请先维护银行账户、现金账户或第三方支付账户。`,
          '需要配置资金账户',
          '前往资金账户',
          financeRouteNames.fundAccount,
          isCurrent
        )
        return false
      }
      return true
    }

    const stateText = activeRequired ? '已启用的账套' : '企业账套'
    const nextStepText = activeRequired
      ? '请前往账套管理完成创建并启用，再返回继续。'
      : '请前往账套管理完成创建，再返回继续。'
    await confirmAndNavigate(
      `“${actionLabel}”需要先配置${stateText}。${nextStepText}`,
      '需要完善财务基础配置',
      '前往账套管理',
      financeRouteNames.accountSet,
      isCurrent
    )
    return false
  }

  async function ensureLeafSubjects(available: boolean, actionLabel: string): Promise<boolean> {
    if (available) return true
    await confirmAndNavigate(
      `“${actionLabel}”需要至少一个末级会计科目。请先维护当前账套的科目体系。`,
      '需要完善会计科目',
      '前往会计科目',
      financeRouteNames.accountingSubject
    )
    return false
  }

  async function runWithAccountSet(
    options: FinanceAccountSetPrerequisiteOptions,
    action: () => void | Promise<void>,
    overlay?: FinancePrerequisiteOverlay
  ): Promise<boolean> {
    if (options.available && options.foundationRequired && options.accountSetId && overlay) {
      const opening = Promise.resolve(action())
      void opening.catch(() => undefined)
      // Business handleOpen establishes its intent synchronously, before any reset awaits.
      const session = overlay.currentSession()
      if (!session) {
        await opening
        return false
      }
      session.setPrerequisiteLoading(true)
      try {
        if (!(await ensureAccountSet(options, session.isCurrent))) {
          await session.dismiss()
          return false
        }
        await opening
        return session.isCurrent()
      } catch (error) {
        await session.dismiss()
        throw error
      } finally {
        session.setPrerequisiteLoading(false)
      }
    }
    const reservation = overlay?.reserveOpen()
    const isCurrent = reservation?.isCurrent ?? (() => true)
    if (!(await ensureAccountSet(options, isCurrent)) || !isCurrent()) return false
    await action()
    return true
  }

  function goToAccountSet(): void {
    void router.push({ name: financeRouteNames.accountSet })
  }

  return { ensureAccountSet, ensureLeafSubjects, goToAccountSet, runWithAccountSet }
}
