import { nextTick, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { omit } from 'lodash-es'
import { notifyFriendlyError } from '@/hooks/core/useArtFeedback'
import { createTenantScopeReadGuard } from '@/utils/tenant-scope-context'
import { prepareTravelLoanPush, type TravelLoan, type TravelLoanPushKind } from '@fms/api'

/** Prepare a fresh, authorized source before opening a target expense draft. */
export function useLoanPushRoute(
  kind: TravelLoanPushKind,
  openDraft: (loan: TravelLoan, isCurrent: () => boolean) => Promise<void>
): void {
  const route = useRoute()
  const router = useRouter()
  const target = kind === 'repayment' ? 'FinanceRepayment' : 'FinanceExpenseReimbursement'
  watch(
    () => (route.name === target ? route.query.fromLoan : undefined),
    async (id, _, onCleanup) => {
      if (typeof id !== 'string' || !id) return
      let active = true
      let consuming = false
      let consumedPath: string | undefined
      onCleanup(() => {
        if (!consuming) active = false
      })
      const isCurrent = () =>
        active &&
        route.name === target &&
        (consumedPath ? route.fullPath === consumedPath : route.query.fromLoan === id)
      const assertScope = createTenantScopeReadGuard()
      try {
        const result = await prepareTravelLoanPush(id, kind)
        assertScope()
        if (!isCurrent()) return
        if (!result.data) throw new Error('借款下推资料不可用')
        // Consume the entry before opening: ArtDialog closes when fullPath changes.
        consuming = true
        const destination = router.resolve({ query: omit(route.query, ['fromLoan']) })
        await router.replace(destination)
        await nextTick()
        consuming = false
        consumedPath = destination.fullPath
        assertScope()
        if (isCurrent()) await openDraft(result.data, isCurrent)
      } catch (error) {
        if (isCurrent()) notifyFriendlyError(error, '借款下推失败，请核对可用余额和目标单据权限')
      } finally {
        consuming = false
        if (!consumedPath && isCurrent()) {
          try {
            await router.replace({ query: omit(route.query, ['fromLoan']) })
          } catch (error) {
            notifyFriendlyError(error, '下推入口清理失败，请返回列表后重试')
          }
        }
      }
    },
    { immediate: true }
  )
}
