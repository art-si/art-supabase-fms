<template>
  <ArtDrawer
    header-icon="ri:funds-box-line"
    :loading="loading"
    ref="drawerRef"
    :show-footer="false"
  >
    <template #subtitle="{ data }">{{ data.transferNo }} · 资金流向与操作轨迹</template>
    <ArtAsyncState
      :error="loadError?.message"
      :empty="!loading && !detail"
      empty-text="暂无资金调拨详情"
      empty-description="请返回调拨列表重新选择记录，或刷新后重试。"
      @retry="retryLoad"
    >
      <template #empty-action>
        <ElButton type="primary" plain @click="retryLoad">重新加载</ElButton>
      </template>
      <div v-if="detail" class="fund-transfer-detail">
        <ElTabs v-model="activeTab">
          <ElTabPane name="details" label="调拨资料" class="grid gap-4">
            <ArtSectionCard title="调拨信息" preserve-content-structure>
              <ArtDescriptions
                :data="detail"
                :items="descriptionItems"
                :columns="2"
                label-width="104px"
              />
            </ArtSectionCard>

            <section
              v-if="showTransferFlow"
              class="fund-transfer-detail__flow"
              :class="{ 'is-amount-only': !canViewAccounts }"
              aria-label="资金流向"
            >
              <p
                v-if="detail.status === 'reversed'"
                class="col-span-full m-0 text-sm text-[var(--el-text-color-secondary)]"
              >
                原调拨已冲销，以下为原始转账方向；反向流水已恢复本次调拨金额。
              </p>
              <div v-if="canViewAccounts">
                <small>转出账户</small>
                <strong>{{ detail.sourceAccountName || '--' }}</strong>
                <span>{{ detail.sourceAccountNoMasked || '--' }}</span>
              </div>
              <div class="fund-transfer-detail__arrow">
                <ArtSvgIcon icon="ri:arrow-right-line" />
                <strong v-if="canViewAmounts">{{
                  formatSensitiveCurrencyValue(detail.amount, detail?.currencyCode)
                }}</strong>
                <small v-if="canViewAmounts && hasFeeAmount">
                  手续费 {{ formatSensitiveCurrencyValue(detail.feeAmount, detail?.currencyCode) }}
                </small>
              </div>
              <div v-if="canViewAccounts">
                <small>转入账户</small>
                <strong>{{ detail.targetAccountName || '--' }}</strong>
                <span>{{ detail.targetAccountNoMasked || '--' }}</span>
              </div>
            </section>
          </ElTabPane>
          <ElTabPane name="actions" label="操作轨迹">
            <ArtSectionCard
              class="fund-transfer-detail__section"
              title="操作轨迹"
              :empty="!actions.length"
              empty-title="暂无操作记录"
              empty-description="提交、审核和执行调拨后，可在此查看操作轨迹。"
              :empty-visual-size="64"
              :min-height="148"
              preserve-content-structure
            >
              <ol v-if="isMobile" class="m-0 grid list-none gap-4 p-0">
                <li v-for="action in actions" :key="action.id" class="grid min-w-0 gap-3">
                  <strong class="text-sm text-g-900">{{ actionLabels[action.action] }}</strong>
                  <ArtDescriptions
                    :data="action"
                    :items="actionItems(action)"
                    :columns="1"
                    label-width="88px"
                  />
                </li>
              </ol>
              <ArtTable
                v-else
                :border="false"
                :data="actions"
                :columns="actionColumns"
                :pagination="false"
                height="auto"
                :show-table-header="false"
                table-layout="fixed"
                empty-height="160px"
                max-height="320px"
                empty-text="暂无操作记录"
              />
            </ArtSectionCard>
          </ElTabPane>
        </ElTabs>
      </div>
    </ArtAsyncState>
  </ArtDrawer>
</template>

<script setup lang="ts">
  import { useMediaQuery } from '@vueuse/core'
  import { ElButton } from 'element-plus'
  import type { ColumnOption } from '@/types'
  import ArtDescriptions from '@/components/core/base/art-descriptions/index.vue'
  import type { ArtDescriptionItem } from '@/components/core/base/art-descriptions/types'
  import ArtSvgIcon from '@/components/core/base/art-svg-icon/index.vue'
  import ArtDrawer from '@/components/core/drawers/art-drawer/index.vue'
  import type { ArtDrawerExpose } from '@/components/core/drawers/art-drawer/types'
  import ArtSectionCard from '@/components/core/surfaces/art-section-card/index.vue'
  import { fetchFundTransferActions, fetchFundTransferDetail } from '@fms/api'
  import { useDetailRecord } from '@/hooks/core/useDetailRecord'
  import { canViewField } from '@/utils/field-permission'
  import { formatSensitiveCurrencyValue } from '@/utils/ui'
  import { formatWithDayjs } from '@/utils/time'

  defineOptions({ name: 'FinanceFundTransferDetailDrawer' })

  type Transfer = Api.Fms.FundTransferRecord
  type Action = Api.Fms.FundTransferActionRecord
  interface TransferDetail {
    record: Transfer
    actions: Action[]
  }

  const drawerRef = ref<ArtDrawerExpose<Transfer>>()
  const activeTab = ref('details')
  const {
    detail: loadedDetail,
    loading,
    loadError,
    loadDetail,
    openDetail,
    retryLoad
  } = useDetailRecord<TransferDetail>(async (id) => {
    const [recordResult, actionResult] = await Promise.all([
      fetchFundTransferDetail(id, { showErrorMessage: false }),
      fetchFundTransferActions(id, { showErrorMessage: false })
    ])
    return {
      data: recordResult.data
        ? { record: recordResult.data, actions: actionResult.data ?? [] }
        : undefined,
      error: recordResult.error ?? actionResult.error
    }
  }, '资金调拨详情加载失败，请重试或返回列表重新选择。')
  const detail = computed(() => loadedDetail.value?.record)
  const actions = computed(() => loadedDetail.value?.actions ?? [])
  const isMobile = useMediaQuery('(max-width: 700px)')

  function actionItems(action: Action): ArtDescriptionItem<Action>[] {
    return [
      { key: 'actionTime', label: '操作时间', field: 'actionTime', format: 'datetime' },
      { key: 'actionBy', label: '操作人', field: 'actionBy' },
      {
        key: 'toStatus',
        label: '结果状态',
        field: 'toStatus',
        dictCode: 'fmsFundTransferStatus',
        dictDisplay: 'tag'
      },
      ...(action.actionRemark
        ? [{ key: 'actionRemark', label: '操作说明', field: 'actionRemark' }]
        : [])
    ]
  }

  const canViewAccounts = computed(() =>
    canViewField(detail.value?.fieldAccess, 'transferAccounts')
  )
  const canViewAmounts = computed(() => canViewField(detail.value?.fieldAccess, 'transferAmounts'))
  const canViewBankReference = computed(() =>
    canViewField(detail.value?.fieldAccess, 'bankReference')
  )
  const showTransferFlow = computed(() => canViewAccounts.value || canViewAmounts.value)
  const hasFeeAmount = computed(() => {
    const value = detail.value?.feeAmount
    if (value === '***') return true
    return Number(value) > 0
  })
  const descriptionItems = computed<ArtDescriptionItem<Transfer>[]>(() => [
    { key: 'transferNo', label: '调拨单号', field: 'transferNo', copyable: true },
    { key: 'status', label: '调拨状态', field: 'status', dictCode: 'fmsFundTransferStatus' },
    { key: 'transferDate', label: '调拨日期', field: 'transferDate', format: 'date' },
    { key: 'currencyCode', label: '币种', field: 'currencyCode' },
    ...(canViewBankReference.value
      ? [
          {
            key: 'bankReference',
            label: '银行参考号',
            field: 'bankReference',
            copyable: true
          } as ArtDescriptionItem<Transfer>
        ]
      : []),
    { key: 'createBy', label: '创建人', field: 'createBy' },
    { key: 'purpose', label: '调拨用途', field: 'purpose', span: 2 },
    ...(detail.value?.reviewRemark
      ? [{ key: 'reviewRemark', label: '审批意见', field: 'reviewRemark', span: 2 }]
      : []),
    ...(detail.value?.reversalReason
      ? [{ key: 'reversalReason', label: '冲销原因', field: 'reversalReason', span: 2 }]
      : [])
  ])

  const actionColumns: ColumnOption<Action>[] = [
    {
      prop: 'action',
      label: '业务操作',
      minWidth: 190,
      formatter: (row) =>
        h('div', { class: 'grid gap-1' }, [
          h(
            'strong',
            { class: 'text-sm text-[var(--el-text-color-primary)]' },
            actionLabels[row.action] || '业务操作'
          ),
          h(
            'span',
            { class: 'text-xs text-[var(--el-text-color-secondary)]' },
            formatWithDayjs(row.actionTime, 'YYYY-MM-DD HH:mm') || '--'
          )
        ])
    },
    { prop: 'actionBy', label: '操作人', minWidth: 150, showOverflowTooltip: true },
    {
      prop: 'toStatus',
      label: '状态',
      width: 105,
      fixed: 'right',
      dict: { code: 'fmsFundTransferStatus', display: 'tag' }
    },
    { prop: 'actionRemark', label: '说明', minWidth: 180, showOverflowTooltip: true }
  ]

  const actionLabels: Record<Api.Fms.FundTransferAction, string> = {
    create: '创建调拨',
    edit: '编辑调拨',
    submit: '提交审批',
    approve: '审批通过',
    reject: '驳回调拨',
    execute: '执行入账',
    reverse: '冲销调拨'
  }

  async function handleOpen(row: Transfer): Promise<void> {
    activeTab.value = 'details'
    openDetail(row.id)
    await drawerRef.value?.handleOpen(row, {
      title: '资金调拨详情',
      size: 'xl',
      onOpen: () => loadDetail(row.id),
      drawerProps: { appendToBody: true, resizable: true, closeOnClickModal: true }
    })
  }

  defineExpose({ handleOpen })
</script>

<style scoped lang="scss">
  .fund-transfer-detail {
    min-width: 0;

    &__flow {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
      gap: 20px;
      align-items: center;
      padding: 20px;
      margin-top: 20px;
      background: color-mix(in srgb, var(--el-color-primary) 4%, var(--default-box-color));
      border: 1px solid var(--el-border-color-lighter);
      border-radius: var(--el-border-radius-base);

      > div:not(.fund-transfer-detail__arrow) {
        display: grid;
        gap: 6px;
        min-width: 0;

        strong {
          overflow-wrap: anywhere;
        }

        span {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        small,
        span {
          color: var(--el-text-color-secondary);
        }
      }
    }

    &__arrow {
      display: grid;
      justify-items: center;
      color: var(--el-color-primary);
    }

    &__flow.is-amount-only {
      grid-template-columns: minmax(0, 1fr);
    }

    &__section {
      margin-top: var(--art-space-6);
    }

    @media (width <= 700px) {
      &__flow {
        grid-template-columns: 1fr;
      }

      &__arrow :deep(.art-svg-icon) {
        transform: rotate(90deg);
      }
    }
  }
</style>
