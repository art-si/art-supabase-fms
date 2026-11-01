<template>
  <ArtDrawer
    header-icon="ri:exchange-dollar-line"
    :loading="detail.loading"
    ref="drawerRef"
    @open="
      () => {
        activeDetailTab = 'overview'
      }
    "
    :show-footer="false"
  >
    <template #subtitle="{ data }"> {{ data.transactionNo }} · 凭证与核销记录 </template>
    <ArtAsyncState
      :error="loadError?.message"
      :empty="!detail.loading && !detail.data"
      empty-text="暂无收付款详情"
      empty-description="请返回收付款列表重新选择记录，或刷新后重试。"
      @retry="retryLoad"
    >
      <template #empty-action>
        <ElButton type="primary" plain @click="retryLoad">重新加载</ElButton>
      </template>
      <div v-if="detail.data" class="cash-detail">
        <ElTabs v-model="activeDetailTab"
          ><ElTabPane name="overview" label="收付款信息"
            ><div class="space-y-4"
              ><ArtSectionCard :title="`${directionLabel}概览`" preserve-content-structure>
                <ArtDescriptions
                  :data="detail.data"
                  :items="descriptionItems"
                  :columns="2"
                  label-width="104px"
                /> </ArtSectionCard></div
          ></ElTabPane>
          <ElTabPane
            name="evidence"
            label="收付款凭证"
            v-if="canViewField(detail.data.fieldAccess, 'voucherEvidence')"
            ><div class="space-y-4"
              ><ArtSectionCard
                v-if="canViewField(detail.data.fieldAccess, 'voucherEvidence')"
                class="cash-detail__section"
                :title="`${directionLabel}凭证`"
                :empty="!detail.data.voucherUrls?.length"
                :empty-title="
                  getFieldAccess(detail.data.fieldAccess, 'voucherEvidence') === 'masked'
                    ? '凭证内容已脱敏'
                    : '暂无收付款凭证'
                "
                :empty-description="
                  getFieldAccess(detail.data.fieldAccess, 'voucherEvidence') === 'masked'
                    ? '当前权限无法查看凭证附件。'
                    : '登记凭证后可在此查看附件。'
                "
                :empty-visual-size="64"
                :min-height="148"
                preserve-content-structure
              >
                <ArtUploadImage
                  :model-value="detail.data.voucherUrls"
                  multiple
                  readonly
                  :size="112"
                /> </ArtSectionCard></div
          ></ElTabPane>
          <ElTabPane name="allocations" label="核销记录"
            ><div class="space-y-4"
              ><ArtSectionCard
                class="cash-detail__section"
                title="核销记录"
                :empty="!detail.data.allocations?.length"
                empty-title="暂无核销记录"
                empty-description="完成核销后可在此查看关联对账单与核销金额。"
                :empty-visual-size="64"
                :min-height="148"
                preserve-content-structure
              >
                <ArtTable
                  :border="false"
                  :data="detail.data.allocations ?? []"
                  :columns="allocationColumns"
                  :pagination="false"
                  height="auto"
                  :show-table-header="false"
                  table-layout="fixed"
                  empty-height="180px"
                  max-height="430px"
                  empty-text="暂无核销记录"
                /> </ArtSectionCard></div></ElTabPane
        ></ElTabs>
      </div>
    </ArtAsyncState>
  </ArtDrawer>
</template>

<script setup lang="tsx">
  import { createDateTimeFormatter } from '@/utils/ui/format'

  import { ElButton, ElTag } from 'element-plus'
  import ArtTooltip from '@/components/core/feedback/art-tooltip/index.vue'
  import ArtDescriptions from '@/components/core/base/art-descriptions/index.vue'
  import type { ArtDescriptionItem } from '@/components/core/base/art-descriptions/types'
  import ArtDrawer from '@/components/core/drawers/art-drawer/index.vue'
  import type { ArtDrawerExpose } from '@/components/core/drawers/art-drawer/types'
  import ArtButtonTable from '@/components/core/forms/art-button-table/index.vue'
  import ArtSectionCard from '@/components/core/surfaces/art-section-card/index.vue'
  import ArtTable from '@/components/core/tables/art-table/index.vue'
  import ArtUploadImage from '@/components/core/forms/art-upload-image/index.vue'
  import type { ColumnOption } from '@/types'
  import {
    fetchCashTransactionDetail,
    reverseCarrierCashAllocation,
    reverseCashAllocation
  } from '@fms/api'
  import {
    canEditField,
    canViewField,
    getFieldAccess,
    formatSensitiveNumberWithAffix
  } from '@/utils/field-permission'
  import { notifyFriendlyError, useArtFeedback } from '@/hooks/core/useArtFeedback'
  import { useDetailRecord } from '@/hooks/core/useDetailRecord'

  defineOptions({ name: 'FinanceCashTransactionDetailDrawer' })

  const { promptReason } = useArtFeedback()

  type CashTransaction = Api.Fms.CashTransactionRecord
  interface DetailAllocation {
    id: string
    allocatedAmount?: Api.Fms.SensitiveNumber
    allocatedAt: string
    allocatedBy?: string | null
    isActive: boolean
    reverseReason?: string | null
    statement?: {
      statementNo: string
      periodStart: string
      periodEnd: string
    } | null
  }

  const emit = defineEmits<{ changed: [] }>()
  const drawerRef = ref<ArtDrawerExpose<CashTransaction>>()
  const activeDetailTab = ref('overview')
  const {
    detail: detailData,
    loading,
    loadError,
    loadDetail,
    openDetail,
    retryLoad
  } = useDetailRecord<CashTransaction>(
    fetchCashTransactionDetail,
    '收付款详情加载失败，请重试或返回列表重新选择。'
  )
  const detail = reactive({ data: detailData, loading })
  const directionLabel = computed(() => (detail.data?.direction === 'payment' ? '付款' : '收款'))

  const formatDateTime = createDateTimeFormatter({ format: 'YYYY-MM-DD HH:mm', emptyText: '-' })

  const descriptionItems = computed<ArtDescriptionItem<CashTransaction>[]>(() => [
    {
      key: 'transactionNo',
      label: `${directionLabel.value}单号`,
      field: 'transactionNo',
      copyable: true
    },
    {
      key: 'status',
      label: '状态',
      field: 'status',
      dictCode: 'tmsCashTransactionStatus',
      dictDisplay: 'tag'
    },
    {
      key: 'counterpartyName',
      label: detail.data?.direction === 'receipt' ? '收款客户' : '付款承运商',
      field: 'counterpartyName'
    },
    {
      key: 'transactionDate',
      label: `${directionLabel.value}日期`,
      field: 'transactionDate',
      format: 'date'
    },
    ...(canViewField(detail.data?.fieldAccess, 'transactionAmounts')
      ? [
          {
            key: 'amount',
            label: `${directionLabel.value}金额`,
            field: 'amount' as const,
            formatter: (value: unknown) =>
              formatSensitiveNumberWithAffix(value as Api.Fms.SensitiveNumber, { prefix: '¥' })
          },
          {
            key: 'allocatedAmount',
            label: '已核销金额',
            field: 'allocatedAmount' as const,
            formatter: (value: unknown) =>
              formatSensitiveNumberWithAffix(value as Api.Fms.SensitiveNumber, { prefix: '¥' })
          },
          {
            key: 'unallocatedAmount',
            label: '账面未核销余额',
            field: 'unallocatedAmount' as const,
            formatter: (value: unknown) =>
              formatSensitiveNumberWithAffix(value as Api.Fms.SensitiveNumber, { prefix: '¥' })
          },
          {
            key: 'allocatableAmount',
            label: '可核销余额',
            field: 'allocatableAmount' as const,
            formatter: (value: unknown) =>
              formatSensitiveNumberWithAffix(value as Api.Fms.SensitiveNumber, { prefix: '¥' })
          }
        ]
      : []),
    ...(detail.data?.direction === 'payment' &&
    canViewField(detail.data.fieldAccess, 'transactionAmounts')
      ? [
          {
            key: 'principalAmount',
            label: '核销本金',
            field: 'principalAmount' as const,
            formatter: (value: unknown) =>
              formatSensitiveNumberWithAffix(value as Api.Fms.SensitiveNumber, { prefix: '¥' })
          },
          {
            key: 'feeAmount',
            label: '手续费（不核销）',
            field: 'feeAmount' as const,
            formatter: (value: unknown) =>
              formatSensitiveNumberWithAffix(value as Api.Fms.SensitiveNumber, { prefix: '¥' })
          }
        ]
      : []),
    {
      key: 'paymentMethod',
      label: `${directionLabel.value}方式`,
      field: 'paymentMethod',
      dictCode: 'tmsCashPaymentMethod',
      dictDisplay: 'text'
    },
    ...(canViewField(detail.data?.fieldAccess, 'bankDetails')
      ? [
          {
            key: 'fundAccount',
            label: '资金账户',
            field: 'fundAccount' as const,
            formatter: (_value: unknown, row: CashTransaction) =>
              row.fundAccount
                ? `${row.fundAccount.accountName} · ${row.fundAccount.accountNoMasked}`
                : '历史未关联'
          },
          {
            key: 'bankReference',
            label: '银行流水号',
            field: 'bankReference' as const,
            copyable: detail.data?.bankReference !== '***'
          }
        ]
      : []),
    { key: 'createBy', label: '登记人', field: 'createBy' },
    {
      key: 'createTime',
      label: '登记时间',
      field: 'createTime',
      formatter: (value) => formatDateTime(value as string | null | undefined)
    },
    { key: 'remark', label: '备注', field: 'remark' },
    ...(detail.data?.status === 'voided'
      ? [{ key: 'voidReason', label: '作废原因', field: 'voidReason', span: 2 }]
      : [])
  ])

  const allocationColumns = computed<ColumnOption<DetailAllocation>[]>(() => [
    { type: 'globalIndex', label: '序号', width: 66 },
    {
      prop: 'statementNo',
      label: '对账单号',
      width: 190,
      formatter: (row) => row.statement?.statementNo ?? '-'
    },
    {
      prop: 'period',
      label: '对账账期',
      minWidth: 195,
      formatter: (row) =>
        row.statement ? `${row.statement.periodStart} 至 ${row.statement.periodEnd}` : '-'
    },
    ...(canViewField(detail.data?.fieldAccess, 'transactionAmounts')
      ? [
          {
            prop: 'allocatedAmount',
            label: '核销金额',
            width: 130,
            align: 'right' as const,
            formatter: (row: DetailAllocation) =>
              formatSensitiveNumberWithAffix(row.allocatedAmount, { prefix: '¥' })
          }
        ]
      : []),
    {
      prop: 'allocatedAt',
      label: '核销时间',
      width: 165,
      formatter: (row) => formatDateTime(row.allocatedAt)
    },
    {
      prop: 'allocatedBy',
      label: '核销人',
      width: 120,
      showOverflowTooltip: true
    },
    {
      prop: 'isActive',
      label: '状态',
      width: 95,
      formatter: (row) =>
        row.isActive ? <ElTag type="success">有效</ElTag> : <ElTag type="info">已撤销</ElTag>
    },
    {
      prop: 'operation',
      label: '操作',
      width: 86,
      fixed: 'right',
      formatter: (row) =>
        row.isActive && canEditField(detail.data?.fieldAccess, 'transactionAmounts') ? (
          <ArtTooltip content="撤销核销" placement="top">
            <ArtButtonTable
              type="delete"
              icon="ri:arrow-go-back-line"
              label="撤销核销"
              permission="FinanceCashTransaction:Allocate"
              onClick={() => void handleReverse(row)}
            />
          </ArtTooltip>
        ) : (
          <ArtTooltip
            content={
              row.isActive
                ? '当前金额字段权限不允许撤销核销。'
                : row.reverseReason || '此核销记录已撤销，保留历史供追溯。'
            }
            placement="top"
          >
            <span class="text-sm text-g-500">—</span>
          </ArtTooltip>
        )
    }
  ])

  async function handleReverse(row: DetailAllocation): Promise<void> {
    try {
      const reason = await promptReason(
        `撤销后将释放 ${formatSensitiveNumberWithAffix(row.allocatedAmount, { prefix: '¥' })}，并自动回退收款及对账单状态。`,
        '撤销核销',
        {
          confirmButtonText: '确认撤销',
          placeholder: '请填写撤销原因',
          emptyMessage: '撤销原因不能为空'
        }
      )
      if (detail.data?.direction === 'payment') {
        await reverseCarrierCashAllocation(row.id, reason)
      } else {
        await reverseCashAllocation(row.id, reason)
      }
      if (detail.data) await loadDetail(detail.data.id)
      emit('changed')
    } catch (error) {
      if (error !== 'cancel' && error !== 'close') {
        notifyFriendlyError(error, '撤销核销失败，请刷新记录后重试。')
      }
    }
  }

  async function handleOpen(row: CashTransaction): Promise<void> {
    openDetail(row.id, row)
    await drawerRef.value?.handleOpen(row, {
      title: `${row.direction === 'payment' ? '付款' : '收款'}详情`,
      size: 'xl',
      onOpen: () => loadDetail(row.id),
      drawerProps: { appendToBody: true, resizable: true, closeOnClickModal: true }
    })
  }

  defineExpose({ handleOpen })
</script>

<style scoped lang="scss">
  .cash-detail {
    &__section {
      margin-top: var(--art-space-6);
    }
  }
</style>
