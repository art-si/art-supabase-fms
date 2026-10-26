<template>
  <ArtDrawer :loading="loading" ref="drawerRef" header-icon="ri:truck-line" :show-footer="false">
    <ArtAsyncState
      :error="loadError?.message"
      :empty="!loading && !detail"
      empty-text="暂无承运商对账详情"
      empty-description="请返回对账列表重新选择记录，或刷新后重试。"
      @retry="retryLoad"
    >
      <template #empty-action>
        <ElButton type="primary" plain @click="retryLoad">重新加载</ElButton>
      </template>
      <div v-if="detail" class="statement-detail">
        <ArtSectionCard title="对账概览" preserve-content-structure>
          <ArtDescriptions
            :data="detail"
            :items="descriptionItems"
            :columns="2"
            label-width="104px"
          />
        </ArtSectionCard>
        <ArtSectionCard
          class="statement-detail__section"
          title="费用明细"
          :empty="!detail.items?.length"
          empty-title="暂无费用明细"
          empty-description="费用纳入承运商对账单后会显示在这里。"
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
            max-height="430px"
          />
        </ArtSectionCard>
        <ArtSectionCard
          class="statement-detail__section"
          title="审批记录"
          preserve-content-structure
        >
          <WorkflowBusinessHistory
            business-type="tms_carrier_statement"
            :business-id="detail.id"
            :min-height="180"
          />
        </ArtSectionCard>
      </div>
    </ArtAsyncState>
  </ArtDrawer>
</template>

<script setup lang="tsx">
  import { ElButton } from 'element-plus'
  import ArtDescriptions from '@/components/core/base/art-descriptions/index.vue'
  import type { ArtDescriptionItem } from '@/components/core/base/art-descriptions/types'
  import ArtDrawer from '@/components/core/drawers/art-drawer/index.vue'
  import type { ArtDrawerExpose } from '@/components/core/drawers/art-drawer/types'
  import ArtTable from '@/components/core/tables/art-table/index.vue'
  import ArtSectionCard from '@/components/core/surfaces/art-section-card/index.vue'
  import WorkflowBusinessHistory from '@/components/business/workflow-business-history/index.vue'
  import type { ColumnOption } from '@/types'
  import { fetchCarrierStatementDetail } from '@fms/api'
  import { useDetailRecord } from '@/hooks/core/useDetailRecord'
  import { createDateTimeFormatter } from '@/utils/ui/format'
  import { canViewField, formatSensitiveNumberWithAffix } from '@/utils/field-permission'

  defineOptions({ name: 'FinanceCarrierStatementDetailDrawer' })
  type Statement = Api.Fms.CarrierStatementRecord
  type Item = Api.Fms.CarrierStatementItem
  const drawerRef = ref<ArtDrawerExpose<Statement>>()
  const { detail, loading, loadError, loadDetail, openDetail, retryLoad } =
    useDetailRecord<Statement>(
      fetchCarrierStatementDetail,
      '承运商对账详情加载失败，请重试或返回列表重新选择。'
    )

  const canView = (field: Api.Fms.CarrierStatementFieldKey): boolean =>
    canViewField(detail.value?.fieldAccess, field)
  const formatDateTime = createDateTimeFormatter({ format: 'YYYY-MM-DD HH:mm', emptyText: '-' })
  const descriptionItems = computed<ArtDescriptionItem<Statement>[]>(() => [
    { key: 'statementNo', label: '对账单号', field: 'statementNo', copyable: true },
    {
      key: 'status',
      label: '状态',
      field: 'status',
      dictCode: 'tmsSettlementStatus',
      dictDisplay: 'tag'
    },
    { key: 'carrierName', label: '对账承运商', field: 'carrierName' },
    {
      key: 'period',
      label: '账期',
      value: (data: Statement) => `${data.periodStart} 至 ${data.periodEnd}`
    },
    {
      key: 'counts',
      label: '费用 / 运单',
      value: (data: Statement) => `${data.costCount} 笔 / ${data.waybillCount} 单`
    },
    ...(canView('statementAmounts')
      ? [
          {
            key: 'statementAmount',
            label: '应付金额',
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
            label: '已付金额',
            field: 'settledAmount',
            formatter: (value: unknown) =>
              formatSensitiveNumberWithAffix(value as number | string | null | undefined, {
                prefix: '¥'
              })
          },
          {
            key: 'outstandingAmount',
            label: '未付金额',
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
  const itemColumns = computed<ColumnOption<Item>[]>(() => [
    {
      prop: 'waybillNoSnapshot',
      label: '运单号',
      minWidth: 176,
      formatter: (row) => (
        <span class="statement-detail__identity">
          <strong>{row.waybillNoSnapshot || '—'}</strong>
          <small>{row.occurredOnSnapshot || '未记录日期'}</small>
        </span>
      )
    },
    {
      prop: 'costTypeSnapshot',
      label: '费用类型',
      width: 108,
      dict: { code: 'tmsWaybillCostType', display: 'text' }
    },
    {
      prop: 'payeeNameSnapshot',
      label: '收款方',
      minWidth: 130,
      showOverflowTooltip: true
    },
    ...(canView('statementAmounts')
      ? [
          {
            prop: 'lineAmount',
            label: '应付金额',
            minWidth: 200,
            align: 'right' as const,
            formatter: (row: Item) => (
              <span class="statement-detail__amount">
                <strong>{formatSensitiveNumberWithAffix(row.lineAmount, { prefix: '¥' })}</strong>
                <small>
                  费用 {formatSensitiveNumberWithAffix(row.costAmount, { prefix: '¥' })} · 调整{' '}
                  {formatSensitiveNumberWithAffix(row.adjustmentAmount, { prefix: '¥' })}
                </small>
              </span>
            )
          }
        ]
      : [])
  ])
  async function handleOpen(row: Statement, preloaded = false) {
    openDetail(row.id, preloaded ? row : undefined)
    await drawerRef.value?.handleOpen(row, {
      title: '承运商对账详情',
      subtitle: row.statementNo,
      size: 'xl',
      onOpen: preloaded ? undefined : () => loadDetail(row.id),
      drawerProps: { appendToBody: true, resizable: true, closeOnClickModal: true }
    })
  }
  defineExpose({ handleOpen })
</script>

<style scoped lang="scss">
  .statement-detail {
    :deep(.statement-detail__identity),
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
