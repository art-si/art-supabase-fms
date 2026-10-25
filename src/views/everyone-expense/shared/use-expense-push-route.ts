import { nextTick, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { omit } from 'lodash-es'
import { notifyFriendlyError } from '@/hooks/core/useArtFeedback'
import { createTenantScopeReadGuard } from '@/utils/tenant-scope-context'

/** Prepare a fresh, authorized source before opening a target expense draft. */
export function useExpensePushRoute<T>(options: {
  queryKey: 'fromLoan' | 'fromApplication'
  target: 'FinanceRepayment' | 'FinanceExpenseReimbursement'
  prepare: (id: string) => Promise<{ data: T | null | undefined }>
  openDraft: (source: T, isCurrent: () => boolean) => Promise<void>
  errorMessage: string
}): void {
  const route = useRoute()
  const router = useRouter()
  const { queryKey, target, prepare, openDraft, errorMessage } = options
  watch(
    () => (route.name === target ? route.query[queryKey] : undefined),
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
        (consumedPath ? route.fullPath === consumedPath : route.query[queryKey] === id)
      const assertScope = createTenantScopeReadGuard()
      try {
        const result = await prepare(id)
        assertScope()
        if (!isCurrent()) return
        if (!result.data) throw new Error('来源单据不可用')
        // Consume the entry before opening: ArtDialog closes when fullPath changes.
        consuming = true
        const destination = router.resolve({ query: omit(route.query, [queryKey]) })
        await router.replace(destination)
        await nextTick()
        consuming = false
        consumedPath = destination.fullPath
        assertScope()
        if (isCurrent()) await openDraft(result.data, isCurrent)
      } catch (error) {
        if (isCurrent()) notifyFriendlyError(error, errorMessage)
      } finally {
        consuming = false
        if (!consumedPath && isCurrent()) {
          try {
            await router.replace({ query: omit(route.query, [queryKey]) })
          } catch (error) {
            notifyFriendlyError(error, '下推入口清理失败，请返回列表后重试')
          }
        }
      }
    },
    { immediate: true }
  )
}
