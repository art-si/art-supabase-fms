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
    <template #subtitle="{ data }">
      {{ data.invoiceNo || data.invoiceRecordNo }} · 发票信息与审批记录
    </template>
    <ArtAsyncState
      :error="loadError?.message"
      :empty="!loading && !detail"
      empty-text="暂无发票详情"
      empty-description="请返回发票列表重新选择记录，或刷新后重试。"
      @retry="retryLoad"
    >
      <template #empty-action>
        <ElButton type="primary" plain @click="retryLoad">重新加载</ElButton>
      </template>
      <div v-if="detail" class="invoice-detail">
        <ElTabs v-model="activeDetailTab"
          ><ElTabPane name="overview" label="发票信息"
            ><div class="space-y-4"
              ><ArtSectionCard title="发票信息" preserve-content-structure>
                <ArtDescriptions
                  :data="detail"
                  :items="descriptionItems"
                  :columns="2"
                  label-width="128px"
                /> </ArtSectionCard></div
          ></ElTabPane>
          <ElTabPane
            name="attachments"
            label="发票附件"
            v-if="canViewField(detail.fieldAccess, 'invoiceAttachments')"
            ><div class="space-y-4"
              ><ArtSectionCard
                v-if="canViewField(detail.fieldAccess, 'invoiceAttachments')"
                class="invoice-detail__section"
                title="发票附件"
                :empty="
                  getFieldAccess(detail.fieldAccess, 'invoiceAttachments') === 'masked' ||
                  !attachmentUrls.length
                "
                :empty-title="
                  getFieldAccess(detail.fieldAccess, 'invoiceAttachments') === 'masked'
                    ? '附件内容已脱敏'
                    : '暂无发票附件'
                "
                :empty-description="
                  getFieldAccess(detail.fieldAccess, 'invoiceAttachments') === 'masked'
                    ? '当前权限无法查看发票附件。'
                    : '上传附件后可在此查看原始发票。'
                "
                :empty-visual-size="64"
                :min-height="148"
                preserve-content-structure
              >
                <ArtUploadImage
                  :model-value="attachmentUrls"
                  title="发票附件"
                  :size="112"
                  readonly
                /> </ArtSectionCard></div
          ></ElTabPane>
          <ElTabPane name="statements" label="关联对账单"
            ><div class="space-y-4"
              ><ArtSectionCard
                class="invoice-detail__section"
                title="关联对账单"
                :empty="!detail.statementLinks?.length"
                empty-title="暂未关联对账单"
                empty-description="发票匹配对账单后，关联关系会显示在这里。"
                :empty-visual-size="64"
                :min-height="148"
                preserve-content-structure
              >
                <ArtTable
                  :border="false"
                  :data="detail.statementLinks ?? []"
                  :columns="statementLinkColumns"
                  :pagination="false"
                  height="auto"
                  :show-table-header="false"
                  table-layout="fixed"
                  empty-height="180px"
                  max-height="360px"
                  empty-text="暂未关联对账单"
                /> </ArtSectionCard></div
          ></ElTabPane>
          <ElTabPane name="history" label="审批记录"
            ><div class="space-y-4"
              ><ArtSectionCard
                class="invoice-detail__section"
                title="审批记录"
                preserve-content-structure
              >
                <WorkflowBusinessHistory
                  business-type="tms_invoice"
                  :business-id="detail.id"
                  :min-height="180"
                /> </ArtSectionCard></div></ElTabPane
        ></ElTabs>
      </div>
    </ArtAsyncState>
  </ArtDrawer>
</template>

<script setup lang="ts">
  import { ref, computed } from 'vue'
  import { ElButton } from 'element-plus'
  import type { ColumnOption } from '@/types'
  import ArtDescriptions from '@/components/core/base/art-descriptions/index.vue'
  import type { ArtDescriptionItem } from '@/components/core/base/art-descriptions/types'
  import ArtDrawer from '@/components/core/drawers/art-drawer/index.vue'
  import type { ArtDrawerExpose } from '@/components/core/drawers/art-drawer/types'
  import ArtSectionCard from '@/components/core/surfaces/art-section-card/index.vue'
  import ArtUploadImage from '@/components/core/forms/art-upload-image/index.vue'
  import WorkflowBusinessHistory from '@/components/business/workflow-business-history/index.vue'
  import { fetchInvoiceDetail } from '@fms/api'
  import { formatSensitiveCurrencyValue } from '@/utils/ui/format'
  import { useDetailRecord } from '@/hooks/core/useDetailRecord'
  import {
    canViewField,
    getFieldAccess,
    formatSensitiveNumberWithAffix
  } from '@/utils/field-permission'

  defineOptions({ name: 'FinanceInvoiceDetailDrawer' })

  type Invoice = Api.Fms.InvoiceRecord
  type StatementLink = NonNullable<Invoice['statementLinks']>[number]

  const drawerRef = ref<ArtDrawerExpose<Invoice>>()
  const activeDetailTab = ref('overview')
  const { detail, loading, loadError, loadDetail, openDetail, retryLoad } =
    useDetailRecord<Invoice>(
      (id) => fetchInvoiceDetail(id, { showErrorMessage: false }),
      '发票详情加载失败，请重试或返回列表重新选择。'
    )
  const attachmentUrls = computed(() =>
    (detail.value?.attachments ?? [])
      .map((item) => (typeof item.url === 'string' ? item.url : ''))
      .filter(Boolean)
  )

  const descriptionItems = computed<ArtDescriptionItem<Invoice>[]>(() => [
    { key: 'invoiceRecordNo', label: '登记单号', field: 'invoiceRecordNo', copyable: true },
    { key: 'status', label: '发票状态', field: 'status', dictCode: 'tmsInvoiceStatus' },
    { key: 'direction', label: '发票方向', field: 'direction', dictCode: 'tmsInvoiceDirection' },
    { key: 'invoiceType', label: '发票类型', field: 'invoiceType', dictCode: 'tmsInvoiceType' },
    { key: 'counterparty', label: '往来单位', field: 'counterpartyNameSnapshot' },
    { key: 'issueDate', label: '开票日期', field: 'issueDate', format: 'date' },
    { key: 'currencyCode', label: '币种', field: 'currencyCode' },
    { key: 'invoiceCode', label: '发票代码', field: 'invoiceCode', copyable: true },
    { key: 'invoiceNo', label: '发票号码', field: 'invoiceNo', copyable: true },
    { key: 'invoiceTitle', label: '发票抬头', field: 'invoiceTitle' },
    ...(canViewField(detail.value?.fieldAccess, 'taxIdentity')
      ? [
          {
            key: 'taxNumber',
            label: '纳税人识别号',
            field: 'taxNumber' as const,
            copyable: detail.value?.taxNumber !== '***'
          }
        ]
      : []),
    ...(canViewField(detail.value?.fieldAccess, 'invoiceAmounts')
      ? [
          {
            key: 'amountExcludingTax',
            label: '不含税金额',
            field: 'amountExcludingTax' as const,
            formatter: (_value: unknown, data: Invoice) =>
              formatSensitiveCurrencyValue(data.amountExcludingTax, data.currencyCode)
          },
          {
            key: 'taxRate',
            label: '税率',
            field: 'taxRate' as const,
            formatter: (_value: unknown, data: Invoice) =>
              formatSensitiveNumberWithAffix(data.taxRate, { suffix: '%' })
          },
          {
            key: 'taxAmount',
            label: '税额',
            field: 'taxAmount' as const,
            formatter: (_value: unknown, data: Invoice) =>
              formatSensitiveCurrencyValue(data.taxAmount, data.currencyCode)
          },
          {
            key: 'totalAmount',
            label: '价税合计',
            field: 'totalAmount' as const,
            formatter: (_value: unknown, data: Invoice) =>
              formatSensitiveCurrencyValue(data.totalAmount, data.currencyCode)
          },
          {
            key: 'linkedAmount',
            label: '已关联金额',
            field: 'linkedAmount' as const,
            formatter: (_value: unknown, data: Invoice) =>
              formatSensitiveCurrencyValue(data.linkedAmount, data.currencyCode)
          },
          {
            key: 'unlinkedAmount',
            label: '未关联金额',
            field: 'unlinkedAmount' as const,
            formatter: (_value: unknown, data: Invoice) =>
              formatSensitiveCurrencyValue(data.unlinkedAmount, data.currencyCode)
          }
        ]
      : []),
    { key: 'remark', label: '备注', field: 'remark', span: 2 }
  ])

  const statementLinkColumns = computed<ColumnOption<StatementLink>[]>(() => {
    const columns: ColumnOption<StatementLink>[] = [
      { prop: 'statementNo', label: '对账单号', minWidth: 180 },
      {
        prop: 'counterpartyName',
        label: '往来单位',
        minWidth: 180,
        showOverflowTooltip: true
      },
      {
        prop: 'periodLabel',
        label: '账期',
        width: 205,
        formatter: (row) => `${row.periodStart} 至 ${row.periodEnd}`
      }
    ]
    if ((detail.value?.statementLinks ?? []).some((row) => row.statementAmount !== undefined)) {
      columns.push({
        prop: 'statementAmount',
        label: '对账金额',
        width: 135,
        align: 'right',
        formatter: (row) => formatSensitiveNumberWithAffix(row.statementAmount, { prefix: '¥' })
      })
    }
    if (canViewField(detail.value?.fieldAccess, 'invoiceAmounts')) {
      columns.push({
        prop: 'linkedAmount',
        label: '关联金额',
        width: 135,
        align: 'right',
        formatter: (row) => formatSensitiveNumberWithAffix(row.linkedAmount, { prefix: '¥' })
      })
    }
    return columns
  })

  async function handleOpen(row: Invoice): Promise<void> {
    openDetail(row.id)
    await drawerRef.value?.handleOpen(row, {
      title: '发票详情',
      size: 'xl',
      onOpen: () => loadDetail(row.id),
      drawerProps: { appendToBody: true, resizable: true, closeOnClickModal: true }
    })
  }

  defineExpose({ handleOpen })
</script>

<style scoped lang="scss">
  .invoice-detail {
    &__section {
      margin-top: var(--art-space-6);
    }
  }
</style>
