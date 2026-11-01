<template>
  <ArtDrawer
    :loading="loading"
    ref="drawerRef"
    @open="
      () => {
        activeDetailTab = 'overview'
      }
    "
    header-icon="ri:bank-card-line"
    :show-footer="false"
  >
    <ArtAsyncState
      :error="loadError?.message"
      :empty="!loading && !detail"
      empty-text="暂无付款申请详情"
      empty-description="请返回申请列表重新选择记录，或刷新后重试。"
      @retry="retryLoad"
    >
      <template #empty-action>
        <ElButton type="primary" plain @click="retryLoad">重新加载</ElButton>
      </template>
      <div v-if="detail" class="payment-application-detail">
        <ElTabs v-model="activeDetailTab"
          ><ElTabPane name="overview" label="申请信息"
            ><div class="space-y-4"
              ><ArtSectionCard title="申请信息" preserve-content-structure>
                <ArtDescriptions
                  :data="detail"
                  :items="descriptionItems"
                  :columns="2"
                  label-width="104px"
                /> </ArtSectionCard></div
          ></ElTabPane>
          <ElTabPane name="lines" label="付款明细"
            ><div class="space-y-4"
              ><ArtSectionCard
                class="payment-application-detail__section"
                title="付款明细"
                :empty="!detail.items?.length"
                empty-title="暂无付款明细"
                empty-description="添加付款项目后可在此核对金额与收款对象。"
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
                  table-layout="fixed"
                  empty-height="180px"
                  max-height="320px"
                  empty-text="暂无付款明细"
                /> </ArtSectionCard></div
          ></ElTabPane>
          <ElTabPane
            name="evidence"
            label="付款依据"
            v-if="canViewField(detail.fieldAccess, 'basisEvidence')"
            ><div class="space-y-4"
              ><ArtSectionCard
                v-if="canViewField(detail.fieldAccess, 'basisEvidence')"
                class="payment-application-detail__section"
                title="付款依据"
                :empty="
                  getFieldAccess(detail.fieldAccess, 'basisEvidence') === 'masked' ||
                  !detail.basisUrls?.length
                "
                :empty-title="
                  getFieldAccess(detail.fieldAccess, 'basisEvidence') === 'masked'
                    ? '付款依据已脱敏'
                    : '暂无付款依据'
                "
                :empty-description="
                  getFieldAccess(detail.fieldAccess, 'basisEvidence') === 'masked'
                    ? '当前权限无法查看付款依据。'
                    : '上传付款依据后可在此查看附件。'
                "
                :empty-visual-size="64"
                :min-height="148"
                preserve-content-structure
              >
                <ArtUploadImage
                  :model-value="detail.basisUrls ?? []"
                  title="付款依据"
                  :size="112"
                  readonly
                /> </ArtSectionCard></div
          ></ElTabPane>
          <ElTabPane name="history" label="审批记录"
            ><div class="space-y-4"
              ><ArtSectionCard
                class="payment-application-detail__section"
                title="审批记录"
                preserve-content-structure
              >
                <WorkflowBusinessHistory
                  business-type="tms_carrier_payment_application"
                  :business-id="detail.id"
                  :min-height="180"
                /> </ArtSectionCard></div></ElTabPane
        ></ElTabs>
      </div>
    </ArtAsyncState>
  </ArtDrawer>
</template>

<script setup lang="ts">
  import { ElButton } from 'element-plus'
  import type { ColumnOption } from '@/types'
  import ArtDescriptions from '@/components/core/base/art-descriptions/index.vue'
  import type { ArtDescriptionItem } from '@/components/core/base/art-descriptions/types'
  import ArtDrawer from '@/components/core/drawers/art-drawer/index.vue'
  import type { ArtDrawerExpose } from '@/components/core/drawers/art-drawer/types'
  import ArtSectionCard from '@/components/core/surfaces/art-section-card/index.vue'
  import ArtUploadImage from '@/components/core/forms/art-upload-image/index.vue'
  import WorkflowBusinessHistory from '@/components/business/workflow-business-history/index.vue'
  import { fetchCarrierPaymentApplicationDetail } from '@fms/api'
  import { useDetailRecord } from '@/hooks/core/useDetailRecord'
  import {
    canViewField,
    getFieldAccess,
    formatSensitiveNumberWithAffix
  } from '@/utils/field-permission'

  defineOptions({ name: 'FinancePaymentApplicationDetailDrawer' })

  type Application = Api.Fms.CarrierPaymentApplicationRecord
  type ApplicationItem = Api.Fms.CarrierPaymentApplicationItem

  const drawerRef = ref<ArtDrawerExpose<Application>>()
  const activeDetailTab = ref('overview')
  const { detail, loading, loadError, loadDetail, openDetail, retryLoad } =
    useDetailRecord<Application>(
      (id) => fetchCarrierPaymentApplicationDetail(id, { showErrorMessage: false }),
      '付款申请详情加载失败，请重试或返回列表重新选择。'
    )

  const descriptionItems = computed<ArtDescriptionItem<Application>[]>(() => [
    { key: 'applicationNo', label: '付款申请单号', field: 'applicationNo', copyable: true },
    {
      key: 'status',
      label: '申请状态',
      field: 'status',
      dictCode: 'tmsCarrierPaymentApplicationStatus'
    },
    { key: 'carrierName', label: '承运商', field: 'carrierName' },
    ...(canViewField(detail.value?.fieldAccess, 'applicationAmounts')
      ? [
          {
            key: 'amount',
            label: '申请金额',
            field: 'amount' as const,
            formatter: (value: unknown) =>
              formatSensitiveNumberWithAffix(value as Api.Fms.SensitiveNumber, { prefix: '¥' })
          }
        ]
      : []),
    {
      key: 'plannedPaymentDate',
      label: '计划付款日期',
      field: 'plannedPaymentDate',
      format: 'date'
    },
    {
      key: 'paymentMethod',
      label: '付款方式',
      field: 'paymentMethod',
      dictCode: 'tmsCashPaymentMethod'
    },
    {
      key: 'statementCount',
      label: '对账单数',
      field: 'statementCount',
      formatter: (value) => `${Number(value ?? 0)} 份`
    },
    {
      key: 'paidTransactionNo',
      label: '付款流水号',
      field: 'paidTransactionNo',
      copyable: true
    },
    { key: 'remark', label: '申请说明', field: 'remark', span: 2 },
    { key: 'reviewRemark', label: '审批意见', field: 'reviewRemark', span: 2 },
    { key: 'cancelReason', label: '取消原因', field: 'cancelReason', span: 2 }
  ])

  const itemColumns = computed<ColumnOption<ApplicationItem>[]>(() => [
    { prop: 'statementNoSnapshot', label: '对账单号', minWidth: 190 },
    ...(canViewField(detail.value?.fieldAccess, 'applicationAmounts')
      ? [
          {
            prop: 'statementAmountSnapshot' as const,
            label: '对账金额',
            width: 135,
            align: 'right' as const,
            formatter: (row: ApplicationItem) =>
              formatSensitiveNumberWithAffix(row.statementAmountSnapshot, { prefix: '¥' })
          },
          {
            prop: 'outstandingAmountSnapshot' as const,
            label: '申请时未付',
            width: 135,
            align: 'right' as const,
            formatter: (row: ApplicationItem) =>
              formatSensitiveNumberWithAffix(row.outstandingAmountSnapshot, { prefix: '¥' })
          },
          {
            prop: 'appliedAmount' as const,
            label: '本次付款',
            width: 135,
            align: 'right' as const,
            formatter: (row: ApplicationItem) =>
              formatSensitiveNumberWithAffix(row.appliedAmount, { prefix: '¥' })
          }
        ]
      : [])
  ])

  async function handleOpen(row: Application): Promise<void> {
    openDetail(row.id)
    await drawerRef.value?.handleOpen(row, {
      title: '付款申请详情',
      subtitle: row.applicationNo,
      size: 'xl',
      onOpen: () => loadDetail(row.id),
      drawerProps: { appendToBody: true, resizable: true, closeOnClickModal: true }
    })
  }

  defineExpose({ handleOpen })
</script>

<style scoped lang="scss">
  .payment-application-detail {
    min-width: 0;

    &__section {
      margin-top: var(--art-space-6);
    }
  }
</style>
