<template>
  <ArtDrawer
    header-icon="ri:git-branch-line"
    :loading="loading"
    ref="drawerRef"
    @open="
      () => {
        activeDetailTab = 'overview'
      }
    "
    :show-footer="false"
  >
    <template #subtitle>{{ eventSubtitle }}</template>
    <ArtAsyncState
      :error="loadError?.message"
      :empty="!loading && !detail"
      empty-text="暂无自动入账事件详情"
      empty-description="请返回事件列表重新选择记录，或刷新后重试。"
      @retry="retryLoad"
    >
      <template #empty-action>
        <ElButton type="primary" plain @click="retryLoad">重新加载</ElButton>
      </template>
      <div v-if="detail" class="posting-event-detail">
        <ElTabs
          v-if="canViewPayload && (payloadItems.length || referenceItems.length)"
          v-model="activeDetailTab"
          ><ElTabPane name="overview" label="处理信息"
            ><div class="space-y-4"
              ><ArtSectionCard title="处理信息" preserve-content-structure>
                <ArtDescriptions
                  :data="detail"
                  :items="descriptionItems"
                  :columns="2"
                  label-width="104px"
                />
              </ArtSectionCard>

              <ArtSectionCard
                v-if="canViewDiagnostics && detail.lastError"
                class="posting-event-detail__section"
                title="异常信息"
                preserve-content-structure
              >
                <ElAlert
                  type="error"
                  :closable="false"
                  show-icon
                  :title="friendlyProcessingError"
                  description="核对所属账套的会计期间、制证规则与业务单据，修正后返回事件列表重试。"
                /> </ArtSectionCard></div
          ></ElTabPane>
          <ElTabPane name="payload" label="业务数据"
            ><div class="space-y-4"
              ><ArtSectionCard
                v-if="canViewPayload"
                class="posting-event-detail__section"
                title="业务数据"
                :empty="!payloadItems.length"
                empty-title="暂无业务载荷"
                empty-description="业务事件生成载荷后，可在此核对字段。"
                :empty-visual-size="64"
                :min-height="148"
                preserve-content-structure
              >
                <ArtDescriptions
                  :data="detail.payload"
                  :items="payloadItems"
                  :columns="1"
                  label-width="140px"
                />
              </ArtSectionCard>

              <ArtSectionCard
                v-if="canViewPayload && referenceItems.length"
                title="关联记录标识"
                subtitle="用于核对业务关联；来源单号和处理结果见上方。"
                preserve-content-structure
              >
                <template #actions>
                  <ElButton
                    plain
                    :aria-expanded="showReferences"
                    @click="showReferences = !showReferences"
                  >
                    <ArtSvgIcon
                      :icon="showReferences ? 'ri:arrow-up-s-line' : 'ri:arrow-down-s-line'"
                    />
                    {{ showReferences ? '收起标识' : '展开标识' }}
                  </ElButton>
                </template>
                <ArtDescriptions
                  v-if="showReferences"
                  :data="detail.payload"
                  :items="referenceItems"
                  :columns="1"
                  label-width="140px"
                /> </ArtSectionCard></div></ElTabPane></ElTabs
        ><div v-else class="space-y-4"
          ><ArtSectionCard title="处理信息" preserve-content-structure>
            <ArtDescriptions
              :data="detail"
              :items="descriptionItems"
              :columns="2"
              label-width="104px"
            />
          </ArtSectionCard>

          <ArtSectionCard
            v-if="canViewDiagnostics && detail.lastError"
            class="posting-event-detail__section"
            title="异常信息"
            preserve-content-structure
          >
            <ElAlert
              type="error"
              :closable="false"
              show-icon
              :title="friendlyProcessingError"
              description="核对所属账套的会计期间、制证规则与业务单据，修正后返回事件列表重试。"
            /> </ArtSectionCard
        ></div>

        <section v-if="canOpenVoucher" class="posting-event-detail__voucher art-card-xs">
          <div>
            <strong>{{ detail.voucher?.voucherNo || '已生成会计凭证' }}</strong>
            <span>凭证状态与后续审核、过账仍由凭证中心统一控制。</span>
          </div>
          <ElButton type="primary" plain @click="viewVoucher"> 查看凭证 </ElButton>
        </section>
      </div>
    </ArtAsyncState>
  </ArtDrawer>
</template>

<script setup lang="tsx">
  import { ElButton } from 'element-plus'
  import { useUserStore } from '@/store/modules/user'
  import ArtAsyncState from '@/components/core/feedback/art-async-state/index.vue'
  import ArtDescriptions from '@/components/core/base/art-descriptions/index.vue'
  import type { ArtDescriptionItem } from '@/components/core/base/art-descriptions/types'
  import ArtDrawer from '@/components/core/drawers/art-drawer/index.vue'
  import type { ArtDrawerExpose } from '@/components/core/drawers/art-drawer/types'
  import ArtSectionCard from '@/components/core/surfaces/art-section-card/index.vue'
  import ArtSvgIcon from '@/components/core/base/art-svg-icon/index.vue'
  import { fetchPostingEventDetail } from '@fms/api'
  import { useDetailRecord } from '@/hooks/core/useDetailRecord'
  import {
    isReadableFieldAccess,
    canViewField,
    formatSensitiveNumber,
    formatSensitiveNumberWithAffix,
    getFieldAccess
  } from '@/utils/field-permission'
  import { getFriendlySupabaseErrorMessage } from '@/utils/supabase'
  import { formatVoucherSummary } from '../../../modules/voucher-summary'

  defineOptions({ name: 'FinancePostingEventDetailDrawer' })

  type Event = Api.Fms.SecurePostingEventRecord

  const emit = defineEmits<{ 'view-voucher': [voucherId: string] }>()
  const userStore = useUserStore()
  const drawerRef = ref<ArtDrawerExpose<Event>>()
  const activeDetailTab = ref('overview')
  const showReferences = ref(false)
  const { detail, loading, loadError, loadDetail, openDetail, retryLoad } = useDetailRecord<Event>(
    async (id) => {
      await Promise.all([
        userStore.ensureDictLoaded('fmsBillType'),
        userStore.ensureDictLoaded('fmsBillDirection'),
        userStore.ensureDictLoaded('fmsPostingSourceEvent'),
        userStore.ensureDictLoaded('tmsCashPaymentMethod'),
        userStore.ensureDictLoaded('fmsPostingWaybillCostType'),
        userStore.ensureDictLoaded('fmsBillEventType'),
        userStore.ensureDictLoaded('tmsInvoiceDirection'),
        userStore.ensureDictLoaded('tmsInvoiceType'),
        userStore.ensureDictLoaded('fmsTaxType')
      ])
      return fetchPostingEventDetail(id, { showErrorMessage: false })
    },
    '自动入账事件详情加载失败，请重试或返回列表重新选择。'
  )

  const payloadLabelMap: Record<string, string> = {
    billId: '票据关联标识',
    billType: '票据类型',
    direction: '票据方向',
    referenceNo: '银行流水号',
    billEventId: '流转关联标识',
    fundAccountId: '资金账户关联标识',
    counterpartyName: '往来单位',
    runId: '核算批次 ID',
    periodId: '会计期间 ID',
    assetCount: '资产数量',
    grossAmount: '业务总额',
    gross_amount: '业务总额',
    netAmount: '不含税金额',
    net_amount: '不含税金额',
    taxAmount: '税额',
    tax_amount: '税额',
    paid_amount: '实付分摊金额',
    payable_amount: '应付金额（含现金折扣）',
    discount_amount: '现金折扣金额',
    fee_amount: '付款手续费',
    has_cash_discount: '含现金折扣',
    payment_business_type: '付款业务类型',
    customer_id: '客户 ID',
    customerId: '客户关联标识',
    carrier_id: '承运商 ID',
    carrierId: '承运商关联标识',
    applicant_user_id: '报销申请人 ID',
    waybill_id: '运单 ID',
    driver_id: '司机 ID',
    expense_item_id: '费用项目 ID',
    customer_name: '客户名称',
    carrier_name: '承运商名称',
    counterparty_name: '往来方名称',
    payee_name: '收款方',
    payment_method: '收付方式',
    paymentMethod: '收付方式',
    bankReference: '银行流水号',
    invoice_no: '发票号码',
    invoiceNo: '发票号码',
    invoiceType: '发票类型',
    taxRate: '税率',
    taxType: '税种',
    taxPeriodId: '税务期间关联标识',
    tax_rate: '税率',
    cost_type: '费用类型',
    costType: '费用类型',
    waybill_no: '运单号'
  }

  const canViewSourceReferences = computed(() =>
    canViewField(detail.value?.fieldAccess, 'eventSourceReferences')
  )
  const eventSubtitle = computed(() =>
    canViewSourceReferences.value && detail.value?.sourceNo
      ? detail.value.sourceType === 'tax'
        ? formatVoucherSummary(detail.value.summary, [], {
            sourceType: 'tax',
            taxTypes: userStore.getDictMap.fmsTaxType
          })
        : detail.value.sourceNo
      : '核对业务事件、处理结果与生成凭证'
  )
  const canViewDiagnostics = computed(() =>
    canViewField(detail.value?.fieldAccess, 'processingDiagnostics')
  )
  const canViewPayload = computed(
    () =>
      canViewField(detail.value?.fieldAccess, 'eventAmounts') ||
      canViewField(detail.value?.fieldAccess, 'eventPayloadDetails')
  )
  const canOpenVoucher = computed(
    () =>
      Boolean(detail.value?.voucherId) &&
      isReadableFieldAccess(getFieldAccess(detail.value?.fieldAccess, 'eventSourceReferences'))
  )
  const friendlyProcessingError = computed(() =>
    getFriendlySupabaseErrorMessage(
      detail.value?.lastError,
      '自动入账处理失败，请核对规则与业务单据后重试'
    )
  )

  const descriptionItems = computed<ArtDescriptionItem<Event>[]>(() => {
    const items: ArtDescriptionItem<Event>[] = [
      {
        key: 'sourceEvent',
        label: '业务事件',
        field: 'sourceEvent',
        dictCode: 'fmsPostingSourceEvent'
      },
      { key: 'eventDate', label: '业务日期', field: 'eventDate', format: 'date' },
      { key: 'status', label: '处理状态', field: 'status', dictCode: 'fmsPostingEventStatus' },
      { key: 'createTime', label: '捕获时间', field: 'createTime', format: 'datetime' }
    ]
    if (canViewSourceReferences.value) {
      items.push(
        {
          key: 'accountSet',
          label: '所属账套',
          field: 'accountSet',
          formatter: (_value, row) => row.accountSet?.accountSetName || '待匹配账套'
        },
        {
          key: 'summary',
          label: '事件摘要',
          field: 'summary',
          formatter: (_value, row) =>
            formatVoucherSummary(
              row.summary,
              row.sourceType === 'waybill_cost'
                ? userStore.getDictMap.fmsPostingWaybillCostType
                : [],
              {
                sourceType: row.sourceType,
                billEvents: userStore.getDictMap.fmsBillEventType,
                taxTypes: userStore.getDictMap.fmsTaxType
              }
            )
        },
        {
          key: 'rule',
          label: '命中规则',
          field: 'rule',
          formatter: (_value, row) =>
            row.rule ? `${row.rule.ruleCode} · ${row.rule.ruleName}` : '未命中规则'
        },
        {
          key: 'voucher',
          label: '生成凭证',
          field: 'voucher',
          formatter: (_value, row) => row.voucher?.voucherNo || '—'
        },
        {
          key: 'sourceNo',
          label: detail.value?.sourceType === 'tax' ? '税种' : '来源单号',
          field: 'sourceNo',
          ...(detail.value?.sourceType === 'tax' ? { dictCode: 'fmsTaxType' } : {}),
          copyable:
            detail.value?.sourceType !== 'tax' &&
            isReadableFieldAccess(
              getFieldAccess(detail.value?.fieldAccess, 'eventSourceReferences')
            )
        }
      )
    }
    if (canViewDiagnostics.value) {
      items.push(
        {
          key: 'attemptCount',
          label: '处理次数',
          field: 'attemptCount',
          formatter: (value) => {
            const formatted = formatSensitiveNumber(value as number | string | null | undefined, {
              maximumFractionDigits: 0
            })
            return formatted === '***' ? formatted : `${formatted} 次`
          }
        },
        { key: 'createBy', label: '事件发起人', field: 'createBy' },
        { key: 'processedAt', label: '处理时间', field: 'processedAt', format: 'datetime' }
      )
    }
    return items
  })

  const referenceKeys = [
    'billId',
    'billEventId',
    'fundAccountId',
    'runId',
    'periodId',
    'taxPeriodId',
    'customer_id',
    'customerId',
    'carrier_id',
    'carrierId',
    'applicant_user_id',
    'waybill_id',
    'driver_id',
    'expense_item_id'
  ]
  const referenceItems = computed<ArtDescriptionItem<Record<string, unknown>>[]>(() =>
    Object.entries(detail.value?.payload ?? {})
      .filter(([key, value]) => referenceKeys.includes(key) && value != null)
      .map(([key]) => ({ key, field: key, label: payloadLabelMap[key], copyable: true }))
  )

  const payloadItems = computed<ArtDescriptionItem<Record<string, unknown>>[]>(() =>
    Object.entries(detail.value?.payload ?? {})
      .filter(([key]) => !referenceKeys.includes(key))
      .map(([key]) => ({
        key,
        field: key,
        label:
          key === 'direction' && detail.value?.sourceType === 'invoice'
            ? '发票方向'
            : (payloadLabelMap[key] ?? key),
        ...(getPayloadDictCode(key)
          ? { dictCode: getPayloadDictCode(key) }
          : { formatter: (value: unknown) => formatPayloadValue(key, value) })
      }))
  )

  function getPayloadDictCode(key: string): string | undefined {
    if (key === 'taxType') return 'fmsTaxType'
    if (key === 'paymentMethod' || key === 'payment_method') return 'tmsCashPaymentMethod'
    if (key === 'costType' || key === 'cost_type') return 'fmsPostingWaybillCostType'
    if (detail.value?.sourceType === 'commercial_bill') {
      if (key === 'billType') return 'fmsBillType'
      if (key === 'direction') return 'fmsBillDirection'
    }
    if (detail.value?.sourceType === 'invoice') {
      if (key === 'invoiceType') return 'tmsInvoiceType'
      if (key === 'direction') return 'tmsInvoiceDirection'
    }
    return undefined
  }

  const paymentBusinessTypeLabels: Record<string, string> = {
    purchase: '采购付款',
    advance: '预付款',
    other: '其他付款',
    sales_refund: '销售退款'
  }
  function formatPayloadValue(key: string, value: unknown): string {
    if (value == null) return '—'
    if (value === '***') return '***'
    if (key === 'has_cash_discount' && typeof value === 'boolean') return value ? '是' : '否'
    if (key === 'payment_business_type' && typeof value === 'string')
      return paymentBusinessTypeLabels[value] ?? value
    if (
      [
        'grossAmount',
        'gross_amount',
        'netAmount',
        'net_amount',
        'taxAmount',
        'tax_amount',
        'paid_amount',
        'payable_amount',
        'discount_amount',
        'fee_amount'
      ].includes(key) &&
      (typeof value === 'number' || typeof value === 'string')
    ) {
      return formatSensitiveNumberWithAffix(value, {
        prefix: '¥',
        numberFormat: { minimumFractionDigits: 2, maximumFractionDigits: 2 }
      })
    }
    if (
      ['taxRate', 'tax_rate'].includes(key) &&
      (typeof value === 'number' || typeof value === 'string')
    ) {
      return formatSensitiveNumberWithAffix(value, {
        suffix: '%',
        numberFormat: { maximumFractionDigits: 4 }
      })
    }
    return typeof value === 'object' ? JSON.stringify(value) : String(value)
  }

  function viewVoucher(): void {
    const voucherId = detail.value?.voucherId
    if (canOpenVoucher.value && voucherId) emit('view-voucher', voucherId)
  }

  async function handleOpen(row: Event | string): Promise<void> {
    const eventId = typeof row === 'string' ? row : row.id
    const initialRow = typeof row === 'string' ? undefined : row
    showReferences.value = false
    openDetail(eventId)
    await drawerRef.value?.handleOpen(initialRow, {
      title: '自动入账事件',
      headerIcon: 'ri:git-branch-line',
      size: 'xl',
      onOpen: () => loadDetail(eventId),
      drawerProps: { appendToBody: true, resizable: true, closeOnClickModal: true }
    })
  }

  defineExpose({ handleOpen })
</script>

<style scoped lang="scss">
  .posting-event-detail {
    display: grid;
    gap: var(--art-space-4);
    min-width: 0;

    &__section {
      min-width: 0;
    }

    &__voucher {
      display: flex;
      gap: var(--art-space-4);
      align-items: center;
      justify-content: space-between;
      padding: var(--art-space-4);
      border: 1px solid var(--el-border-color-lighter);

      div {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      span {
        font-size: 13px;
        color: var(--el-text-color-secondary);
      }
    }

    @media (width <= 640px) {
      &__voucher {
        flex-direction: column;
        align-items: flex-start;
      }
    }
  }
</style>
