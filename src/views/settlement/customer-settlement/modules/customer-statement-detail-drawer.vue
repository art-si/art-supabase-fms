<template>
  <ArtDrawer
    :loading="loading"
    ref="drawerRef"
    @open="
      () => {
        activeDetailTab = 'overview'
      }
    "
    header-icon="ri:file-text-line"
    :show-footer="false"
  >
    <ArtAsyncState
      :error="loadError?.message"
      :empty="!loading && !detail"
      empty-text="暂无客户对账详情"
      empty-description="请返回对账列表重新选择记录，或刷新后重试。"
      @retry="retryLoad"
    >
      <template #empty-action>
        <ElButton type="primary" plain @click="retryLoad">重新加载</ElButton>
      </template>
      <div v-if="detail" class="statement-detail">
        <ElTabs v-model="activeDetailTab"
          ><ElTabPane name="overview" label="对账概览"
            ><div class="space-y-4"
              ><ArtSectionCard title="对账概览" preserve-content-structure>
                <ArtDescriptions
                  :data="detail"
                  :items="descriptionItems"
                  :columns="2"
                  label-width="104px"
                /> </ArtSectionCard></div
          ></ElTabPane>
          <ElTabPane name="lines" label="运单明细"
            ><div class="space-y-4"
              ><ArtSectionCard
                class="statement-detail__section"
                title="运单明细"
                :empty="!detail.items?.length"
                empty-title="暂无运单明细"
                empty-description="生成对账单后，可在此查看纳入账期的运单。"
                :empty-visual-size="64"
                :min-height="148"
                preserve-content-structure
              >
                <ArtTable
                  :border="false"
                  :data="detail.items ?? []"
                  :columns="itemColumns"
                  :pagination="false"
                  height="auto"
                  :show-table-header="false"
                  max-height="420px"
                /> </ArtSectionCard></div
          ></ElTabPane>
          <ElTabPane name="workflow" label="审批记录"
            ><div class="space-y-4"
              ><ArtSectionCard
                class="statement-detail__section"
                title="审批记录"
                preserve-content-structure
              >
                <WorkflowBusinessHistory
                  business-type="tms_customer_statement"
                  :business-id="detail.id"
                  :min-height="180"
                /> </ArtSectionCard></div></ElTabPane
        ></ElTabs>
      </div>
    </ArtAsyncState>
  </ArtDrawer>
</template>

<script setup lang="tsx">
  import { useMediaQuery } from '@vueuse/core'
  import { ElButton, ElTag } from 'element-plus'
  import ArtDescriptions from '@/components/core/base/art-descriptions/index.vue'
  import type { ArtDescriptionItem } from '@/components/core/base/art-descriptions/types'
  import ArtDrawer from '@/components/core/drawers/art-drawer/index.vue'
  import type { ArtDrawerExpose } from '@/components/core/drawers/art-drawer/types'
  import ArtTable from '@/components/core/tables/art-table/index.vue'
  import ArtSectionCard from '@/components/core/surfaces/art-section-card/index.vue'
  import WorkflowBusinessHistory from '@/components/business/workflow-business-history/index.vue'
  import type { ColumnOption } from '@/types'
  import { fetchCustomerStatementDetail } from '@fms/api'
  import { useDetailRecord } from '@/hooks/core/useDetailRecord'
  import { createDateTimeFormatter } from '@/utils/ui/format'
  import { canViewField, formatSensitiveNumberWithAffix } from '@/utils/field-permission'
  import { getSettlementStatusPresentation } from '../../../modules/settlement-status'

  defineOptions({ name: 'FinanceCustomerStatementDetailDrawer' })

  type CustomerStatement = Api.Fms.CustomerStatementRecord
  type CustomerStatementItem = Api.Fms.CustomerStatementItem

  const drawerRef = ref<ArtDrawerExpose<CustomerStatement>>()
  const activeDetailTab = ref('overview')
  const { detail, loading, loadError, loadDetail, openDetail, retryLoad } =
    useDetailRecord<CustomerStatement>(
      fetchCustomerStatementDetail,
      '客户对账详情加载失败，请重试或返回列表重新选择。'
    )
  const isCompact = useMediaQuery('(max-width: 900px)')

  const canView = (field: Api.Fms.CustomerStatementFieldKey): boolean =>
    canViewField(detail.value?.fieldAccess, field)

  const formatDateTime = createDateTimeFormatter({ format: 'YYYY-MM-DD HH:mm', emptyText: '-' })

  const descriptionItems = computed<ArtDescriptionItem<CustomerStatement>[]>(() => [
    { key: 'statementNo', label: '对账单号', field: 'statementNo', copyable: true },
    {
      key: 'status',
      label: '状态',
      field: 'status',
      render: (value) => {
        const status = getSettlementStatusPresentation(String(value ?? ''))
        return <ElTag type={status.type}>{status.label}</ElTag>
      }
    },
    { key: 'customerName', label: '对账客户', field: 'customerName' },
    {
      key: 'period',
      label: '账期',
      value: (data: CustomerStatement) => `${data.periodStart} 至 ${data.periodEnd}`
    },
    {
      key: 'waybillCount',
      label: '运单数量',
      field: 'waybillCount',
      formatter: (value) => `${Number(value ?? 0)} 单`
    },
    ...(canView('statementAmounts')
      ? [
          {
            key: 'statementAmount',
            label: '对账金额',
            field: 'statementAmount',
            formatter: (value: unknown) =>
              formatSensitiveNumberWithAffix(value as number | string | null | undefined, {
                prefix: '¥'
              })
          }
        ]
      : []),
    ...(canView('settlementAmounts')
      ? [
          {
            key: 'settledAmount',
            label: '已结金额',
            field: 'settledAmount',
            formatter: (value: unknown) =>
              formatSensitiveNumberWithAffix(value as number | string | null | undefined, {
                prefix: '¥'
              })
          },
          {
            key: 'outstandingAmount',
            label: '未结金额',
            field: 'outstandingAmount',
            formatter: (value: unknown) =>
              formatSensitiveNumberWithAffix(value as number | string | null | undefined, {
                prefix: '¥'
              })
          }
        ]
      : []),
    { key: 'createBy', label: '创建人', field: 'createBy' },
    {
      key: 'createTime',
      label: '创建时间',
      field: 'createTime',
      formatter: (value) => formatDateTime(value as string | null | undefined)
    },
    { key: 'remark', label: '备注', field: 'remark', span: 2 },
    ...(detail.value?.reviewRemark
      ? [{ key: 'reviewRemark', label: '审核意见', field: 'reviewRemark', span: 2 }]
      : []),
    ...(detail.value?.voidReason
      ? [{ key: 'voidReason', label: '作废原因', field: 'voidReason', span: 2 }]
      : [])
  ])

  const itemColumns = computed<ColumnOption<CustomerStatementItem>[]>(() => [
    {
      prop: 'waybillNoSnapshot',
      label: '运单 / 订单',
      minWidth: 196,
      formatter: (row) => (
        <span class="statement-detail__waybill">
          <strong>{row.waybillNoSnapshot || '—'}</strong>
          <small>
            {row.orderNoSnapshot || '未关联订单'}
            {isCompact.value ? ` · ${formatDateTime(row.completedAtSnapshot)}` : ''}
          </small>
        </span>
      )
    },
    {
      prop: 'route',
      label: '运输线路',
      minWidth: isCompact.value ? 145 : 170,
      showOverflowTooltip: true,
      formatter: (row) =>
        [row.originStationSnapshot, row.destinationStationSnapshot].filter(Boolean).join(' → ') ||
        '-'
    },
    ...(!isCompact.value
      ? [
          {
            prop: 'completedAtSnapshot',
            label: '完成时间',
            width: 145,
            formatter: (row: CustomerStatementItem) => formatDateTime(row.completedAtSnapshot)
          }
        ]
      : []),
    ...(canView('statementAmounts')
      ? [
          ...(!isCompact.value
            ? [
                {
                  prop: 'receivableAmount',
                  label: '应收金额',
                  width: 102,
                  align: 'right' as const,
                  formatter: (row: CustomerStatementItem) =>
                    formatSensitiveNumberWithAffix(row.receivableAmount, { prefix: '¥' })
                },
                {
                  prop: 'adjustmentAmount',
                  label: '调整金额',
                  width: 102,
                  align: 'right' as const,
                  formatter: (row: CustomerStatementItem) =>
                    formatSensitiveNumberWithAffix(row.adjustmentAmount, { prefix: '¥' })
                }
              ]
            : []),
          {
            prop: 'lineAmount',
            label: '对账金额',
            width: isCompact.value ? 200 : 112,
            align: 'right' as const,
            formatter: (row: CustomerStatementItem) =>
              isCompact.value ? (
                <span class="statement-detail__amount">
                  <strong>{formatSensitiveNumberWithAffix(row.lineAmount, { prefix: '¥' })}</strong>
                  <small>
                    应收 {formatSensitiveNumberWithAffix(row.receivableAmount, { prefix: '¥' })} ·
                    调整 {formatSensitiveNumberWithAffix(row.adjustmentAmount, { prefix: '¥' })}
                  </small>
                </span>
              ) : (
                formatSensitiveNumberWithAffix(row.lineAmount, { prefix: '¥' })
              )
          }
        ]
      : [])
  ])

  async function handleOpen(row: CustomerStatement): Promise<void> {
    openDetail(row.id)
    await drawerRef.value?.handleOpen(row, {
      title: '客户对账详情',
      subtitle: row.statementNo,
      size: 'xl',
      onOpen: () => loadDetail(row.id),
      drawerProps: { appendToBody: true, resizable: true, closeOnClickModal: true }
    })
  }

  defineExpose({ handleOpen })
</script>

<style scoped lang="scss">
  .statement-detail {
    :deep(.statement-detail__waybill),
    :deep(.statement-detail__amount) {
      display: grid;
      gap: 2px;
      min-width: 0;

      strong,
      small {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      strong {
        font-weight: 600;
        color: var(--el-text-color-primary);
      }

      small {
        font-size: var(--art-font-size-caption);
        color: var(--el-text-color-secondary);
      }
    }

    :deep(.statement-detail__amount) {
      text-align: right;
    }

    &__section {
      margin-top: var(--art-space-6);
    }
  }
</style>
