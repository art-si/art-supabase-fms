import {
  computed,
  getCurrentScope,
  onScopeDispose,
  ref,
  shallowRef,
  toValue,
  type MaybeRefOrGetter,
  type Ref
} from 'vue'
import { fetchAccountingPeriodList } from '@fms/api'
import type { FormItem } from '@/components/core/forms/art-form/index.vue'

type AccountingPeriodOption = {
  label: string
  periodName: string
  dateRange: string
  value: string
}

/** 账套期间联动：编辑保留当前期间，创建仅选择允许的期间。 */
export function useAccountingPeriodOptions(
  accountSetId: Ref<string>,
  selectedPeriodId: Ref<string>,
  editing: MaybeRefOrGetter<boolean> = false,
  allowedStatuses: Api.Fms.AccountingPeriodStatus[] = ['open']
) {
  const periodOptions = shallowRef<AccountingPeriodOption[]>([])
  const periodFieldText = computed<Pick<FormItem, 'description' | 'slots'>>(() => {
    const selected = periodOptions.value.find(({ value }) => value === selectedPeriodId.value)
    if (!selected) return {}
    const { dateRange, periodName } = selected
    return { description: dateRange, slots: { label: () => periodName } }
  })
  const periodsLoading = ref(false)
  const periodLoadFailed = ref(false)
  let requestId = 0

  function resetPeriods(): void {
    ++requestId
    periodOptions.value = []
    periodsLoading.value = false
    periodLoadFailed.value = false
  }
  if (getCurrentScope()) onScopeDispose(resetPeriods)

  async function loadPeriods(): Promise<void> {
    const currentRequest = ++requestId
    const accountId = accountSetId.value
    periodOptions.value = []
    if (!toValue(editing)) selectedPeriodId.value = ''
    periodLoadFailed.value = false
    periodsLoading.value = Boolean(accountId)
    if (!accountId) return
    try {
      const { data, error } = await fetchAccountingPeriodList(accountId, {
        showErrorMessage: false
      })
      if (currentRequest !== requestId || accountId !== accountSetId.value) return
      if (error) {
        periodLoadFailed.value = true
        return
      }
      const isEditing = toValue(editing)
      const retainedPeriodId = isEditing ? selectedPeriodId.value : undefined
      periodOptions.value = (data ?? [])
        .filter(
          (period) => allowedStatuses.includes(period.status) || period.id === retainedPeriodId
        )
        .map(({ id, fiscalYear, periodNo, startDate, endDate }) => {
          const periodName = `${fiscalYear} 年第 ${periodNo} 期`
          const dateRange = `${startDate} 至 ${endDate}`
          return { label: `${periodName} · ${dateRange}`, periodName, dateRange, value: id }
        })
      if (!isEditing) selectedPeriodId.value = periodOptions.value[0]?.value ?? ''
    } catch {
      if (currentRequest === requestId) periodLoadFailed.value = true
    } finally {
      if (currentRequest === requestId) periodsLoading.value = false
    }
  }

  return {
    periodOptions,
    periodFieldText,
    periodsLoading,
    periodLoadFailed,
    loadPeriods,
    resetPeriods
  }
}
