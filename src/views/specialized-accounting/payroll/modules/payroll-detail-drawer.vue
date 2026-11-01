<template>
  <ArtDrawer
    header-icon="ri:group-line"
    :loading="loading"
    ref="drawerRef"
    @open="
      () => {
        activeDetailTab = 'overview'
      }
    "
    :show-footer="false"
  >
    <ArtAsyncState
      :error="loadError?.message"
      :empty="!loading && !run"
      empty-text="暂无薪资批次详情"
      empty-description="请返回列表重新选择批次，或刷新后重试。"
      @retry="reloadDetail"
    >
      <div v-if="run" class="payroll-detail">
        <ElTabs v-model="activeDetailTab"
          ><ElTabPane name="overview" label="批次信息"
            ><div class="space-y-4"
              ><ArtSectionCard title="批次信息" preserve-content-structure>
                <ArtDescriptions
                  :data="run"
                  :items="descriptionItems"
                  :columns="2"
                  :border="true"
                  label-width="104px"
                /> </ArtSectionCard></div
          ></ElTabPane>
          <ElTabPane name="lines" label="员工薪资"
            ><div class="space-y-4"
              ><ArtSectionCard
                title="员工薪资明细"
                subtitle="核对应发、扣款、企业成本与实发金额"
                :loading="linesLoading"
                :error="linesError"
                @retry="reload"
                :empty="!lines.length"
                empty-title="暂无员工薪资明细"
                :empty-description="
                  editable
                    ? '可同步已批准的 HR 薪酬，或手动新增员工明细。'
                    : '此批次没有可展示的员工薪资明细。'
                "
                :empty-visual-size="72"
                :min-height="188"
                preserve-content-structure
              >
                <template v-if="editable && !linesLoading && !linesError" #actions>
                  <div class="payroll-detail__toolbar-actions">
                    <ElButton
                      v-auth="'FinancePayroll:Calculate'"
                      :loading="importing"
                      plain
                      type="primary"
                      @click="importFromHr"
                    >
                      <ArtSvgIcon icon="ri:download-cloud-2-line" />同步 HR 薪酬
                    </ElButton>
                    <ElButton
                      v-auth="'FinancePayroll:Calculate'"
                      type="primary"
                      @click="lineDialogRef?.handleOpen(run)"
                    >
                      新增员工
                    </ElButton>
                  </div>
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
                  <ElTableColumn v-if="canViewIdentity" label="员工" min-width="200">
                    <template #default="{ row }">
                      <BusinessTableIdentityCell
                        :primary="row.employeeNameSnapshot"
                        :secondary="row.employeeNoSnapshot"
                      />
                    </template>
                  </ElTableColumn>
                  <ElTableColumn v-if="canViewAmounts" label="应发" min-width="110" align="right">
                    <template #default="{ row }">{{
                      formatProtectedAmount(row.grossAmount)
                    }}</template>
                  </ElTableColumn>
                  <ElTableColumn v-if="canViewAmounts" label="扣款" min-width="110" align="right">
                    <template #default="{ row }">{{
                      formatProtectedAmount(row.deductionAmount)
                    }}</template>
                  </ElTableColumn>
                  <ElTableColumn
                    v-if="canViewAmounts"
                    label="企业成本"
                    min-width="110"
                    align="right"
                  >
                    <template #default="{ row }">{{
                      formatProtectedAmount(row.employerCostAmount)
                    }}</template>
                  </ElTableColumn>
                  <ElTableColumn v-if="canViewAmounts" label="实发" min-width="110" align="right">
                    <template #default="{ row }">{{
                      formatProtectedAmount(row.netAmount)
                    }}</template>
                  </ElTableColumn>
                  <ElTableColumn v-if="editable" label="操作" width="110" fixed="right">
                    <template #default="{ row }">
                      <BusinessTableRowActions>
                        <ArtButtonTable
                          type="edit"
                          label="编辑员工薪资"
                          permission="FinancePayroll:Calculate"
                          @click="editLine(row)"
                        />
                        <ArtButtonTable
                          type="delete"
                          label="删除员工薪资"
                          permission="FinancePayroll:Calculate"
                          @click="removeLine(row)"
                        />
                      </BusinessTableRowActions>
                    </template>
                  </ElTableColumn>
                </ArtTable>
                <div v-else-if="lines.length" class="payroll-detail__mobile-list">
                  <article v-for="line in lines" :key="line.id" class="payroll-detail__mobile-item">
                    <div class="payroll-detail__mobile-heading">
                      <div class="payroll-detail__employee">
                        <strong>{{
                          canViewIdentity ? line.employeeNameSnapshot : '员工薪资'
                        }}</strong>
                        <small v-if="canViewIdentity">{{ line.employeeNoSnapshot }}</small>
                      </div>
                      <BusinessTableRowActions v-if="editable">
                        <ArtButtonTable
                          type="edit"
                          label="编辑员工薪资"
                          permission="FinancePayroll:Calculate"
                          @click="editLine(line)"
                        />
                        <ArtButtonTable
                          type="delete"
                          label="删除员工薪资"
                          permission="FinancePayroll:Calculate"
                          @click="removeLine(line)"
                        />
                      </BusinessTableRowActions>
                    </div>
                    <dl v-if="canViewAmounts" class="payroll-detail__mobile-amounts">
                      <div
                        ><dt>应发</dt><dd>{{ formatProtectedAmount(line.grossAmount) }}</dd></div
                      >
                      <div
                        ><dt>扣款</dt
                        ><dd>{{ formatProtectedAmount(line.deductionAmount) }}</dd></div
                      >
                      <div
                        ><dt>企业成本</dt
                        ><dd>{{ formatProtectedAmount(line.employerCostAmount) }}</dd></div
                      >
                      <div
                        ><dt>实发</dt><dd>{{ formatProtectedAmount(line.netAmount) }}</dd></div
                      >
                    </dl>
                  </article>
                </div>
              </ArtSectionCard></div
            ></ElTabPane
          ></ElTabs
        >
        <PayrollLineDialog ref="lineDialogRef" @success="handleLinesChanged" />
        <MasterDataDeleteGuard ref="deleteGuardRef" />
      </div>
    </ArtAsyncState>
  </ArtDrawer>
</template>
<script setup lang="ts">
  import ArtTable from '@/components/core/tables/art-table/index.vue'
  import ArtButtonTable from '@/components/core/forms/art-button-table/index.vue'
  import BusinessTableRowActions from '@/components/business/business-table-row-actions/index.vue'
  import BusinessTableIdentityCell from '@/components/business/business-table-identity-cell/index.vue'
  import MasterDataDeleteGuard from '@/components/business/master-data-delete-guard/index.vue'
  import ArtDrawer from '@/components/core/drawers/art-drawer/index.vue'
  import ArtSectionCard from '@/components/core/surfaces/art-section-card/index.vue'
  import type { ArtDrawerExpose } from '@/components/core/drawers/art-drawer/types'
  import ArtAsyncState from '@/components/core/feedback/art-async-state/index.vue'
  import ArtDescriptions from '@/components/core/base/art-descriptions/index.vue'
  import type { ArtDescriptionItem } from '@/components/core/base/art-descriptions/types'
  import { useDetailRecord } from '@/hooks/core/useDetailRecord'
  import ArtSvgIcon from '@/components/core/base/art-svg-icon/index.vue'
  import { useAuth } from '@/hooks/core/useAuth'
  import { notifyFriendlyError, useArtFeedback } from '@/hooks/core/useArtFeedback'
  import { useRecordDeleteGuard } from '@/hooks/core/useRecordDeleteGuard'
  import { useUserStore } from '@/store/modules/user'
  import {
    deletePayrollLine,
    fetchPayrollLines,
    fetchPayrollRunDetail,
    importHrCompensationLines
  } from '@fms/api'
  import { canEditField, canViewField, mergeFieldAccessMaps } from '@/utils/field-permission'
  import { formatSensitiveCurrencyValue as formatProtectedAmount } from '@/utils/ui'
  import { formatWithDayjs } from '@/utils/time'
  import { useMediaQuery } from '@vueuse/core'
  import PayrollLineDialog from './payroll-line-dialog.vue'
  defineOptions({ name: 'FinancePayrollDetailDrawer' })
  const emit = defineEmits<{ success: [] }>()
  const { hasAuth } = useAuth()
  const isCompact = useMediaQuery('(max-width: 640px)')
  const userStore = useUserStore()
  const { confirmAction } = useArtFeedback()
  const { deleteGuardRef, inspectDeleteReferences } = useRecordDeleteGuard(
    'fms_payroll_line',
    '薪资明细'
  )
  const drawerRef = ref<ArtDrawerExpose>()
  const activeDetailTab = ref('overview')
  const lineDialogRef = ref<{
    handleOpen: (run: Api.Fms.PayrollRunRecord, line?: Api.Fms.PayrollLineRecord) => Promise<void>
  }>()
  const {
    detail: run,
    loading,
    loadError,
    loadDetail,
    openDetail,
    activeId
  } = useDetailRecord(async (id) => {
    await userStore.ensureDictLoaded('fmsPayrollRunStatus')
    return fetchPayrollRunDetail(id)
  }, '薪资批次加载失败，请重试。')
  const descriptionItems = computed<ArtDescriptionItem<Api.Fms.PayrollRunRecord>[]>(() => [
    { key: 'runNo', field: 'runNo', label: '批次号', copyable: true },
    {
      key: 'status',
      field: 'status',
      label: '状态',
      dictCode: 'fmsPayrollRunStatus',
      dictDisplay: 'tag'
    },
    {
      key: 'payrollMonth',
      field: 'payrollMonth',
      label: '薪资月份',
      formatter: (value) =>
        typeof value === 'string' ? (formatWithDayjs(value, 'YYYY-MM') ?? '--') : '--'
    },
    {
      key: 'period',
      label: '会计期间',
      value: (record: Api.Fms.PayrollRunRecord) =>
        record.period ? `${record.period.fiscalYear} 年第 ${record.period.periodNo} 期` : '--'
    },
    ...(canViewField(run.value?.fieldAccess, 'salaryAmounts')
      ? ([
          {
            key: 'grossAmount',
            field: 'grossAmount',
            label: '应发金额',
            formatter: (_value, record) => formatProtectedAmount(record.grossAmount)
          },
          {
            key: 'deductionAmount',
            field: 'deductionAmount',
            label: '扣款金额',
            formatter: (_value, record) => formatProtectedAmount(record.deductionAmount)
          },
          {
            key: 'employerCostAmount',
            field: 'employerCostAmount',
            label: '企业成本',
            formatter: (_value, record) => formatProtectedAmount(record.employerCostAmount)
          },
          {
            key: 'netAmount',
            field: 'netAmount',
            label: '实发金额',
            formatter: (_value, record) => formatProtectedAmount(record.netAmount)
          }
        ] satisfies ArtDescriptionItem<Api.Fms.PayrollRunRecord>[])
      : []),
    { key: 'remark', field: 'remark', label: '备注', span: 2 }
  ])
  const lines = ref<Api.Fms.PayrollLineRecord[]>([])
  const linesLoading = ref(false)
  const linesError = ref('')
  let linesRequestId = 0
  const importing = ref(false)
  const lineFieldAccess = ref<Api.Fms.PayrollFieldAccessMap>({})
  const effectiveLineAccess = computed(() =>
    mergeFieldAccessMaps(lineFieldAccess.value, ...lines.value.map((line) => line.fieldAccess))
  )
  const canViewIdentity = computed(() =>
    canViewField(effectiveLineAccess.value, 'employeeIdentity')
  )
  const canViewAmounts = computed(() => canViewField(effectiveLineAccess.value, 'salaryAmounts'))
  const editable = computed(
    () =>
      hasAuth('FinancePayroll:Calculate') &&
      Boolean(run.value && ['draft', 'calculated'].includes(run.value.status)) &&
      canEditField(lineFieldAccess.value, 'employeeIdentity') &&
      canEditField(lineFieldAccess.value, 'salaryAmounts')
  )
  async function reload(): Promise<void> {
    const parentId = run.value?.id
    if (!parentId) return
    const requestId = ++linesRequestId
    linesLoading.value = true
    linesError.value = ''
    try {
      const result = await fetchPayrollLines(parentId)
      if (requestId !== linesRequestId || parentId !== run.value?.id) return
      if (result.error) {
        linesError.value = '薪资明细加载失败，请重试。'
        return
      }
      lines.value = result.data ?? []
      lineFieldAccess.value = result.fieldAccess
    } catch {
      if (requestId === linesRequestId) linesError.value = '薪资明细加载失败，请重试。'
    } finally {
      if (requestId === linesRequestId) linesLoading.value = false
    }
  }
  function editLine(rawRow: object): void {
    if (!run.value) return
    void lineDialogRef.value?.handleOpen(run.value, rawRow as Api.Fms.PayrollLineRecord)
  }

  async function removeLine(rawRow: object): Promise<void> {
    const row = rawRow as Api.Fms.PayrollLineRecord
    if (
      await inspectDeleteReferences([{ id: row.id, label: row.employeeNameSnapshot || '员工薪资' }])
    )
      return
    try {
      await confirmAction(
        `确定删除 ${row.employeeNameSnapshot || '该员工'} 的薪资明细吗？`,
        '删除薪资明细',
        {
          type: 'warning'
        }
      )
    } catch {
      return
    }
    try {
      const result = await deletePayrollLine(row.id)
      if (result.error) throw result.error
      await handleLinesChanged()
    } catch {
      await inspectDeleteReferences([{ id: row.id, label: row.employeeNameSnapshot || '员工薪资' }])
    }
  }
  async function importFromHr(): Promise<void> {
    if (!run.value) return
    try {
      await confirmAction(
        '系统将导入本薪资月份已批准且有效的 HR 薪酬。已有员工明细会保留，不会被覆盖。',
        '同步 HR 薪酬',
        { confirmButtonText: '开始同步', cancelButtonText: '取消', type: 'warning' }
      )
      importing.value = true
      const response = await importHrCompensationLines(run.value.id)
      if (response.error) throw response.error
      const result = response.data
      if (!result?.eligibleCount) {
        ElMessage.warning('该月份暂无已批准的 HR 员工薪酬，请先在 HR 薪酬管理中完成定薪与批准')
      } else if (!result.importedCount) {
        ElMessage.info(`符合条件的 ${result.skippedCount} 名员工均已有薪资明细，本次未覆盖`)
      } else {
        ElMessage.success(
          `已导入 ${result.importedCount} 名员工，保留 ${result.skippedCount} 条已有明细`
        )
      }
      await reloadDetail()
      if (result?.importedCount) emit('success')
    } catch (error) {
      if (error !== 'cancel' && error !== 'close') {
        notifyFriendlyError(error, 'HR 薪酬同步失败，请检查批次状态后重试')
      }
    } finally {
      importing.value = false
    }
  }
  async function reloadDetail(): Promise<void> {
    const id = activeId.value
    if (!id) return
    ++linesRequestId
    lines.value = []
    lineFieldAccess.value = {}
    await loadDetail(id)
    if (run.value?.id === id) await reload()
  }
  async function handleLinesChanged(): Promise<void> {
    emit('success')
    await reloadDetail()
  }
  async function handleOpen(row: Api.Fms.PayrollRunRecord): Promise<void> {
    ++linesRequestId
    linesLoading.value = false
    linesError.value = ''
    lineFieldAccess.value = {}

    openDetail(row.id)
    lines.value = []
    await drawerRef.value?.handleOpen(undefined, {
      title: '薪资批次详情',
      subtitle: row.runNo,
      size: 'xl',
      loading: true,
      loadingText: '正在加载薪资明细…',
      onOpen: async (_data, api) => {
        try {
          await reloadDetail()
        } finally {
          api.setLoading(false)
        }
      },
      drawerProps: { appendToBody: true, resizable: true, closeOnClickModal: true }
    })
  }
  defineExpose({ handleOpen })
</script>
<style scoped lang="scss">
  .payroll-detail {
    display: grid;
    gap: 18px;
  }

  .payroll-detail__toolbar-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;

    svg {
      width: 16px;
      height: 16px;
      margin-right: 5px;
    }
  }

  .payroll-detail small,
  .payroll-detail span {
    color: var(--el-text-color-secondary);
  }

  .payroll-detail__mobile-list {
    display: grid;
    gap: 10px;
  }

  .payroll-detail__mobile-item {
    padding: 12px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: var(--el-border-radius-base);
  }

  .payroll-detail__mobile-heading {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    justify-content: space-between;
  }

  .payroll-detail__employee {
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

  .payroll-detail__mobile-amounts {
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
