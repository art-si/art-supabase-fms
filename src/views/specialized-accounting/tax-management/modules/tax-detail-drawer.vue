<template>
  <ArtDrawer
    header-icon="ri:bill-line"
    :loading="loading"
    ref="drawerRef"
    @open="
      () => {
        activeDetailTab = 'overview'
      }
    "
    :show-footer="false"
  >
    <template #subtitle>
      <div class="flex flex-wrap items-center gap-1">
        <ArtDictDisplay dict-code="fmsTaxType" :value="period?.taxType" display="text" />
        <span v-if="period?.period"
          >· {{ period.period.fiscalYear }} 年第 {{ period.period.periodNo }} 期</span
        >
      </div>
    </template>
    <ArtAsyncState
      :error="loadError?.message"
      :empty="!loading && !period"
      empty-text="暂无税务期间详情"
      empty-description="请返回列表重新选择期间，或刷新后重试。"
      @retry="reloadDetail"
    >
      <div v-if="period" class="tax-detail">
        <ElTabs v-model="activeDetailTab"
          ><ElTabPane name="overview" label="期间与申报"
            ><div class="space-y-4"
              ><ArtSectionCard title="期间信息" preserve-content-structure>
                <ArtDescriptions
                  :data="period"
                  :items="descriptionItems"
                  :columns="2"
                  label-width="104px"
                />
              </ArtSectionCard>

              <ArtSectionCard
                v-if="filingItems.length"
                title="申报及缴纳"
                preserve-content-structure
              >
                <ArtDescriptions
                  :data="period"
                  :items="filingItems"
                  :columns="2"
                  label-width="104px"
                /> </ArtSectionCard></div
          ></ElTabPane>
          <ElTabPane name="lines" label="税务台账"
            ><div class="space-y-4"
              ><ArtSectionCard
                title="税务台账明细"
                subtitle="销项、进项与调整项目"
                :loading="linesLoading"
                :error="linesError"
                @retry="reload"
                :empty="!lines.length"
                empty-title="暂无税务台账明细"
                empty-description="新增明细后可在此核对计税金额、税率与税额。"
                :empty-visual-size="72"
                :min-height="188"
                preserve-content-structure
              >
                <template v-if="editable && !linesLoading && !linesError" #actions>
                  <ElButton
                    v-auth="'FinanceTaxManagement:Calculate'"
                    type="primary"
                    @click="dialogRef?.handleOpen(period)"
                  >
                    新增明细
                  </ElButton>
                </template>
                <ArtTable
                  v-if="!isCompact"
                  class="h-auto!"
                  height="auto"
                  :pagination="false"
                  :border="false"
                  :show-table-header="false"
                  :data="lines"
                  row-key="id"
                >
                  <ElTableColumn prop="occurredOn" label="日期" width="112" />
                  <ElTableColumn v-if="canViewSources" label="来源 / 单号" min-width="190">
                    <template #default="{ row }">
                      <div class="tax-detail__source">
                        <strong :title="row.sourceNo || '--'">{{ row.sourceNo || '--' }}</strong>
                        <small>{{ sourceTypeLabel(row.sourceType) }}</small>
                      </div>
                    </template>
                  </ElTableColumn>
                  <ElTableColumn label="方向" width="86">
                    <template #default="{ row }">
                      <ArtDictDisplay
                        dict-code="fmsTaxLedgerDirection"
                        :value="row.direction"
                        display="tag"
                      />
                    </template>
                  </ElTableColumn>
                  <ElTableColumn
                    v-if="canViewAmounts"
                    label="计税金额"
                    min-width="108"
                    align="right"
                  >
                    <template #default="{ row }">{{
                      formatProtectedAmount(row.taxableAmount)
                    }}</template>
                  </ElTableColumn>
                  <ElTableColumn v-if="canViewAmounts" label="税率" width="82" align="right">
                    <template #default="{ row }">{{ formatProtectedRate(row.taxRate) }}</template>
                  </ElTableColumn>
                  <ElTableColumn v-if="canViewAmounts" label="税额" min-width="108" align="right">
                    <template #default="{ row }">{{
                      formatProtectedAmount(row.taxAmount)
                    }}</template>
                  </ElTableColumn>
                  <ElTableColumn v-if="editable" label="操作" width="104" fixed="right">
                    <template #default="{ row }">
                      <BusinessTableRowActions>
                        <ArtButtonTable
                          type="edit"
                          label="编辑税务明细"
                          permission="FinanceTaxManagement:Calculate"
                          @click="editLine(row)"
                        />
                        <ArtButtonTable
                          type="delete"
                          label="删除税务明细"
                          permission="FinanceTaxManagement:Calculate"
                          @click="remove(row)"
                        />
                      </BusinessTableRowActions>
                    </template>
                  </ElTableColumn>
                </ArtTable>
                <div v-else-if="lines.length" class="tax-detail__mobile-list">
                  <article v-for="line in lines" :key="line.id" class="tax-detail__mobile-item">
                    <div class="tax-detail__mobile-heading">
                      <div class="tax-detail__mobile-identity">
                        <strong>{{
                          canViewSources ? line.sourceNo || '税务明细' : '税务明细'
                        }}</strong>
                        <small
                          >{{ line.occurredOn
                          }}<template v-if="canViewSources">
                            · {{ sourceTypeLabel(line.sourceType) }}</template
                          ></small
                        >
                      </div>
                      <BusinessTableRowActions v-if="editable">
                        <ArtButtonTable
                          type="edit"
                          label="编辑税务明细"
                          permission="FinanceTaxManagement:Calculate"
                          @click="editLine(line)"
                        />
                        <ArtButtonTable
                          type="delete"
                          label="删除税务明细"
                          permission="FinanceTaxManagement:Calculate"
                          @click="remove(line)"
                        />
                      </BusinessTableRowActions>
                    </div>
                    <div class="tax-detail__mobile-direction">
                      <ArtDictDisplay
                        dict-code="fmsTaxLedgerDirection"
                        :value="line.direction"
                        display="tag"
                      />
                    </div>
                    <dl v-if="canViewAmounts" class="tax-detail__mobile-amounts">
                      <div
                        ><dt>计税金额</dt
                        ><dd>{{ formatProtectedAmount(line.taxableAmount) }}</dd></div
                      >
                      <div
                        ><dt>税率</dt><dd>{{ formatProtectedRate(line.taxRate) }}</dd></div
                      >
                      <div
                        ><dt>税额</dt><dd>{{ formatProtectedAmount(line.taxAmount) }}</dd></div
                      >
                    </dl>
                  </article>
                </div>
              </ArtSectionCard></div
            ></ElTabPane
          ></ElTabs
        >
        <TaxLedgerDialog ref="dialogRef" @success="handleLinesChanged" />
        <MasterDataDeleteGuard ref="deleteGuardRef" />
      </div>
    </ArtAsyncState>
  </ArtDrawer>
</template>
<script setup lang="ts">
  import ArtTable from '@/components/core/tables/art-table/index.vue'
  import ArtButtonTable from '@/components/core/forms/art-button-table/index.vue'
  import BusinessTableRowActions from '@/components/business/business-table-row-actions/index.vue'
  import MasterDataDeleteGuard from '@/components/business/master-data-delete-guard/index.vue'
  import ArtAsyncState from '@/components/core/feedback/art-async-state/index.vue'
  import ArtDescriptions from '@/components/core/base/art-descriptions/index.vue'
  import type { ArtDescriptionItem } from '@/components/core/base/art-descriptions/types'
  import { useDetailRecord } from '@/hooks/core/useDetailRecord'
  import ArtDrawer from '@/components/core/drawers/art-drawer/index.vue'
  import ArtSectionCard from '@/components/core/surfaces/art-section-card/index.vue'
  import type { ArtDrawerExpose } from '@/components/core/drawers/art-drawer/types'
  import ArtDictDisplay from '@/components/core/base/art-dict-display/index.vue'
  import { useAuth } from '@/hooks/core/useAuth'
  import { useArtFeedback } from '@/hooks/core/useArtFeedback'
  import { useRecordDeleteGuard } from '@/hooks/core/useRecordDeleteGuard'
  import { useUserStore } from '@/store/modules/user'
  import { deleteTaxLedgerLine, fetchTaxLedgerLines, fetchTaxPeriodDetail } from '@fms/api'
  import { canEditField, canViewField } from '@/utils/field-permission'
  import { formatSensitiveCurrencyValue as formatProtectedAmount } from '@/utils/ui'
  import TaxLedgerDialog from './tax-ledger-dialog.vue'
  import { useMediaQuery } from '@vueuse/core'
  defineOptions({ name: 'FinanceTaxDetailDrawer' })
  const emit = defineEmits<{ success: [] }>()
  const { hasAuth } = useAuth()
  const userStore = useUserStore()
  const isCompact = useMediaQuery('(max-width: 640px)')
  const { confirmAction } = useArtFeedback()
  const { deleteGuardRef, inspectDeleteReferences } = useRecordDeleteGuard(
    'fms_tax_ledger_line',
    '税务明细'
  )
  const drawerRef = ref<ArtDrawerExpose<Api.Fms.TaxPeriodRecord>>()
  const activeDetailTab = ref('overview')
  const dialogRef = ref<{
    handleOpen: (
      period: Api.Fms.TaxPeriodRecord,
      line?: Api.Fms.TaxLedgerLineRecord
    ) => Promise<void>
  }>()
  const {
    detail: period,
    activeId,
    loading,
    loadError,
    loadDetail,
    openDetail
  } = useDetailRecord(async (id) => {
    await Promise.all([
      userStore.ensureDictLoaded('fmsTaxLedgerDirection'),
      userStore.ensureDictLoaded('fmsTaxType'),
      userStore.ensureDictLoaded('fmsTaxPeriodStatus')
    ])
    return fetchTaxPeriodDetail(id)
  }, '税务期间加载失败，请重试。')
  const descriptionItems = computed<ArtDescriptionItem<Api.Fms.TaxPeriodRecord>[]>(() => [
    { key: 'taxType', field: 'taxType', label: '税种', dictCode: 'fmsTaxType' },
    {
      key: 'status',
      field: 'status',
      label: '状态',
      dictCode: 'fmsTaxPeriodStatus',
      dictDisplay: 'tag'
    },
    {
      key: 'period',
      label: '会计期间',
      value: (record: Api.Fms.TaxPeriodRecord) =>
        record.period ? `${record.period.fiscalYear} 年第 ${record.period.periodNo} 期` : '--',
      span: 2
    },
    ...(canViewField(period.value?.fieldAccess, 'taxAmounts')
      ? [
          { key: 'outputTaxAmount', field: 'outputTaxAmount', label: '销项税额' },
          { key: 'inputTaxAmount', field: 'inputTaxAmount', label: '进项税额' },
          { key: 'transferableInputAmount', field: 'transferableInputAmount', label: '上期留抵' },
          { key: 'adjustmentAmount', field: 'adjustmentAmount', label: '调整金额' },
          { key: 'payableAmount', field: 'payableAmount', label: '应纳税额', span: 2 }
        ].map((item) => ({
          ...item,
          formatter: (value: unknown) =>
            formatProtectedAmount(value as Api.Fms.SensitiveNumber | undefined | null)
        }))
      : []),
    { key: 'remark', field: 'remark', label: '备注', span: 2 }
  ])
  const lines = ref<Api.Fms.TaxLedgerLineRecord[]>([])
  const filingItems = computed<ArtDescriptionItem<Api.Fms.TaxPeriodRecord>[]>(() => {
    const record = period.value
    if (!record) return []
    const items: ArtDescriptionItem<Api.Fms.TaxPeriodRecord>[] = []
    if (canViewField(record.fieldAccess, 'filingReferences') && record.filingReference) {
      items.push({
        key: 'filingReference',
        field: 'filingReference',
        label: '申报凭证号',
        copyable: true,
        span: 2
      })
    }
    if (record.filedAt) {
      items.push({ key: 'filedAt', field: 'filedAt', label: '申报时间', format: 'datetime' })
    }
    if (record.filedBy) {
      items.push({ key: 'filedBy', field: 'filedBy', label: '申报人' })
    }
    if (record.paidAt) {
      items.push({ key: 'paidAt', field: 'paidAt', label: '缴纳时间', format: 'datetime', span: 2 })
    }
    return items
  })
  const linesLoading = ref(false)
  const linesError = ref('')
  let linesRequestId = 0
  const canViewSources = computed(() => canViewField(period.value?.fieldAccess, 'taxSources'))
  const canViewAmounts = computed(() => canViewField(period.value?.fieldAccess, 'taxAmounts'))
  const editable = computed(
    () =>
      hasAuth('FinanceTaxManagement:Calculate') &&
      Boolean(period.value && ['draft', 'calculated'].includes(period.value.status)) &&
      canEditField(period.value?.fieldAccess, 'taxSources') &&
      canEditField(period.value?.fieldAccess, 'taxAmounts')
  )
  async function reload(): Promise<void> {
    const parentId = period.value?.id
    if (!parentId) return
    const requestId = ++linesRequestId
    linesLoading.value = true
    linesError.value = ''
    try {
      const result = await fetchTaxLedgerLines(parentId)
      if (requestId !== linesRequestId || parentId !== period.value?.id) return
      if (result.error) {
        linesError.value = '税务明细加载失败，请重试。'
        return
      }
      lines.value = result.data ?? []
    } catch {
      if (requestId === linesRequestId) linesError.value = '税务明细加载失败，请重试。'
    } finally {
      if (requestId === linesRequestId) linesLoading.value = false
    }
  }
  function editLine(rawRow: object): void {
    if (!period.value) return
    void dialogRef.value?.handleOpen(period.value, rawRow as Api.Fms.TaxLedgerLineRecord)
  }

  async function remove(rawRow: object) {
    const row = rawRow as Api.Fms.TaxLedgerLineRecord
    if (await inspectDeleteReferences([{ id: row.id, label: row.sourceNo || '税务明细' }])) return
    try {
      await confirmAction('确定删除该税务台账明细吗？', '删除税务明细', { type: 'warning' })
    } catch {
      return
    }
    try {
      const result = await deleteTaxLedgerLine(row.id)
      if (result.error) throw result.error
      await handleLinesChanged()
    } catch {
      await inspectDeleteReferences([{ id: row.id, label: row.sourceNo || '税务明细' }])
    }
  }
  async function reloadDetail(): Promise<void> {
    const id = activeId.value
    if (!id) return
    ++linesRequestId
    lines.value = []
    await loadDetail(id)
    if (period.value?.id === id) await reload()
  }
  async function handleLinesChanged(): Promise<void> {
    emit('success')
    await reloadDetail()
  }
  async function handleOpen(row: Api.Fms.TaxPeriodRecord): Promise<void> {
    ++linesRequestId
    linesLoading.value = false
    linesError.value = ''
    openDetail(row.id)
    lines.value = []
    await drawerRef.value?.handleOpen(row, {
      title: '税务期间详情',
      size: 'xl',
      onOpen: reloadDetail,
      drawerProps: { appendToBody: true, resizable: true, closeOnClickModal: true }
    })
  }
  function formatProtectedRate(value: Api.Fms.SensitiveNumber | undefined | null): string {
    if (value === null || value === undefined || value === '') return '--'
    if (typeof value === 'string') return value
    return `${(value * 100).toFixed(4)}%`
  }
  function sourceTypeLabel(value: string | null | undefined): string {
    if (value === 'manual') return '手工录入'
    if (value === 'invoice') return '发票'
    return value?.trim() || '--'
  }
  defineExpose({ handleOpen })
</script>
<style scoped lang="scss">
  .tax-detail {
    display: grid;
    gap: 18px;
  }

  .tax-detail small,
  .tax-detail span {
    color: var(--el-text-color-secondary);
  }

  .tax-detail__source {
    display: grid;
    gap: 2px;
    min-width: 0;

    strong {
      overflow: hidden;
      text-overflow: ellipsis;
      font-weight: 500;
      white-space: nowrap;
    }

    small {
      font-size: 12px;
    }
  }

  .tax-detail__mobile-list {
    display: grid;
    gap: 10px;
  }

  .tax-detail__mobile-item {
    padding: 12px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: var(--el-border-radius-base);
  }

  .tax-detail__mobile-heading {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    justify-content: space-between;
  }

  .tax-detail__mobile-identity {
    display: grid;
    gap: 2px;
    min-width: 0;

    strong,
    small {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  .tax-detail__mobile-direction {
    margin-top: 10px;
  }

  .tax-detail__mobile-amounts {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px 16px;
    padding-top: 12px;
    margin: 12px 0 0;
    border-top: 1px solid var(--el-border-color-lighter);

    div {
      display: grid;
      gap: 3px;
    }

    dt {
      font-size: 12px;
      color: var(--el-text-color-secondary);
    }

    dd {
      margin: 0;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
  }
</style>
