<template>
  <ArtDrawer
    :loading="loading"
    ref="drawerRef"
    header-icon="ri:file-list-3-line"
    :show-footer="false"
  >
    <template #subtitle>
      {{ detail?.voucherNo || '查看会计分录、业务来源及操作记录' }}
    </template>
    <ArtAsyncState
      :error="loadError?.message"
      :empty="!loading && !detail"
      empty-text="暂无凭证详情"
      empty-description="请返回凭证列表重新选择记录，或刷新后重试。"
      @retry="retryLoad"
    >
      <template #empty-action>
        <ElButton type="primary" plain @click="retryLoad">重新加载</ElButton>
      </template>
      <VoucherRelatedLayout
        v-if="detail"
        :source="detail"
        :before-navigate="() => drawerRef?.handleClose()"
      >
        <div class="voucher-detail">
          <section class="voucher-detail__hero art-card-xs">
            <span class="voucher-detail__hero-icon" aria-hidden="true">
              <ArtSvgIcon icon="ri:file-list-3-line" />
            </span>
            <div class="voucher-detail__hero-copy">
              <div class="voucher-detail__title-row">
                <h2>{{ detail.voucherNo }}</h2>
                <ElTag :type="statusType(detail.status)" effect="light">
                  {{ statusLabel(detail.status) }}
                </ElTag>
              </div>
              <p>{{ detail.accountSet?.accountSetName }}</p>
              <span>{{ displaySummary }}</span>
            </div>
          </section>

          <ArtSectionCard title="凭证信息" preserve-content-structure>
            <ArtDescriptions
              :data="detail"
              :items="descriptionItems"
              :columns="2"
              label-width="104px"
            />
          </ArtSectionCard>

          <ArtSectionCard
            class="voucher-detail__section"
            title="会计分录"
            :empty="!detail.lines?.length"
            empty-title="暂无会计分录"
            empty-description="补充分录后可核对借贷金额。"
            :empty-visual-size="64"
            :min-height="148"
            preserve-content-structure
          >
            <ArtTable
              :border="false"
              :data="detail.lines ?? []"
              :columns="lineColumns"
              :pagination="false"
              table-layout="fixed"
              empty-text="暂无会计分录"
            />
            <div v-if="canViewAmounts" class="voucher-detail__totals">
              <strong>借方合计 {{ formatSensitiveNumber(detail.totalDebit) }}</strong>
              <strong>贷方合计 {{ formatSensitiveNumber(detail.totalCredit) }}</strong>
            </div>
          </ArtSectionCard>

          <ArtSectionCard
            v-if="canViewAttachments"
            class="voucher-detail__section"
            title="原始凭证附件"
            :empty="!detail.attachments?.length"
            :empty-title="
              getFieldAccess(detail.fieldAccess, 'voucherAttachments') === 'masked'
                ? '附件内容已脱敏'
                : '暂无原始凭证附件'
            "
            :empty-description="
              getFieldAccess(detail.fieldAccess, 'voucherAttachments') === 'masked'
                ? '当前权限无法查看原始凭证附件。'
                : '上传回单、发票或合同后，可在此下载核对。'
            "
            :empty-visual-size="64"
            :min-height="148"
            preserve-content-structure
          >
            <div class="voucher-detail__attachments">
              <ElButton
                v-for="attachment in detail.attachments"
                :key="attachment.url"
                plain
                @click="downloadAttachment(attachment)"
              >
                <ArtSvgIcon icon="ri:attachment-2" />{{ attachment.name }}
              </ElButton>
            </div>
          </ArtSectionCard>

          <ArtSectionCard
            v-if="canViewAuditTrail"
            class="voucher-detail__section"
            title="操作流水"
            :empty="!detail.actions?.length"
            empty-title="暂无操作流水"
            empty-description="提交、审核和过账后，处理记录会显示在这里。"
            :empty-visual-size="64"
            :min-height="148"
            preserve-content-structure
          >
            <ElTimeline class="voucher-detail__timeline">
              <ElTimelineItem
                v-for="item in detail.actions"
                :key="item.id"
                :timestamp="formatTime(item.actionTime)"
                placement="top"
              >
                <div class="voucher-detail__timeline-card">
                  <strong>{{ actionLabel(item.action) }}</strong>
                  <span>{{ item.actor }}</span>
                  <p v-if="item.reason">{{ item.reason }}</p>
                </div>
              </ElTimelineItem>
            </ElTimeline>
          </ArtSectionCard>
        </div>
      </VoucherRelatedLayout>
    </ArtAsyncState>
  </ArtDrawer>
</template>

<script setup lang="tsx">
  import BusinessTableIdentityCell from '@/components/business/business-table-identity-cell/index.vue'
  import { storeToRefs } from 'pinia'
  import { ElButton, ElTag, ElTimeline, ElTimelineItem } from 'element-plus'
  import ArtDescriptions from '@/components/core/base/art-descriptions/index.vue'
  import type { ArtDescriptionItem } from '@/components/core/base/art-descriptions/types'
  import ArtDrawer from '@/components/core/drawers/art-drawer/index.vue'
  import type { ArtDrawerExpose } from '@/components/core/drawers/art-drawer/types'
  import ArtSectionCard from '@/components/core/surfaces/art-section-card/index.vue'
  import ArtTable from '@/components/core/tables/art-table/index.vue'
  import ArtSvgIcon from '@/components/core/base/art-svg-icon/index.vue'
  import { fetchVoucherDetail } from '@fms/api'
  import { useDetailRecord } from '@/hooks/core/useDetailRecord'
  import type { ColumnOption } from '@/types'
  import { createDateTimeFormatter } from '@/utils/ui/format'
  import { downloadAttachment } from '@/utils/file'
  import { canViewField, formatSensitiveNumber, getFieldAccess } from '@/utils/field-permission'
  import { useUserStore } from '@/store/modules/user'
  import { formatVoucherSummary, voucherSourceLabel } from '../../../modules/voucher-summary'
  import VoucherRelatedLayout from './voucher-related-layout.vue'

  defineOptions({ name: 'FinanceVoucherDetailDrawer' })

  type Voucher = Api.Fms.SecureVoucherRecord
  type Line = Api.Fms.SecureVoucherLineRecord

  const drawerRef = ref<ArtDrawerExpose<Voucher>>()
  const { detail, activeId, loading, loadError, loadDetail, openDetail, retryLoad } =
    useDetailRecord<Voucher>(async (id) => {
      await Promise.all([
        userStore.ensureDictLoaded('fmsPostingWaybillCostType'),
        userStore.ensureDictLoaded('fmsBillEventType'),
        userStore.ensureDictLoaded('fmsTaxType')
      ])
      return fetchVoucherDetail(id, { showErrorMessage: false })
    }, '凭证详情加载失败，请重试或返回列表重新选择。')
  const userStore = useUserStore()
  const { getDictMap } = storeToRefs(userStore)

  const displaySummary = computed(() =>
    formatVoucherSummary(
      detail.value?.summary,
      getDictMap.value.fmsPostingWaybillCostType,
      detail.value
        ? {
            sourceType: detail.value.sourceType,
            billEvents: getDictMap.value.fmsBillEventType,
            taxTypes: getDictMap.value.fmsTaxType
          }
        : undefined
    )
  )

  const canViewAmounts = computed(() => canViewField(detail.value?.fieldAccess, 'voucherAmounts'))
  const canViewAttachments = computed(() =>
    canViewField(detail.value?.fieldAccess, 'voucherAttachments')
  )
  const canViewAuditTrail = computed(() => canViewField(detail.value?.fieldAccess, 'auditTrail'))
  const canViewSourceReferences = computed(() =>
    canViewField(detail.value?.fieldAccess, 'sourceReferences')
  )
  const hasForeignCurrency = computed(() =>
    (detail.value?.lines ?? []).some((line) => Boolean(line.currencyCodeSnapshot))
  )

  const descriptionItems = computed<ArtDescriptionItem<Voucher>[]>(() => [
    { key: 'voucherNo', label: '凭证号', field: 'voucherNo', copyable: true },
    { key: 'status', label: '凭证状态', field: 'status', dictCode: 'fmsVoucherStatus' },
    { key: 'voucherDate', label: '凭证日期', field: 'voucherDate', format: 'date' },
    { key: 'voucherType', label: '凭证类型', field: 'voucherType', dictCode: 'fmsVoucherType' },
    {
      key: 'periodNo',
      label: '会计期间',
      field: 'periodNo',
      formatter: (_value, row) => `${row.fiscalYear} 年第 ${row.periodNo} 期`
    },
    {
      key: 'sourceType',
      label: '业务来源',
      field: 'sourceType',
      formatter: (value) => voucherSourceLabel(value, getDictMap.value.fmsVoucherSourceType)
    },
    ...(canViewSourceReferences.value && detail.value?.sourceNo
      ? [
          {
            key: 'sourceNo',
            label: detail.value.sourceType === 'tax' ? '税种' : '来源单号',
            field: 'sourceNo',
            copyable: detail.value.sourceType !== 'tax',
            ...(detail.value.sourceType === 'tax' ? { dictCode: 'fmsTaxType' } : {})
          }
        ]
      : []),
    {
      key: 'lineCount',
      label: '分录数',
      field: 'lineCount',
      formatter: (value) => `${Number(value ?? 0)} 条`
    },
    { key: 'createBy', label: '制单人', field: 'createBy' },
    { key: 'createTime', label: '制单时间', field: 'createTime', format: 'datetime' },
    ...(canViewAuditTrail.value
      ? [
          ...(detail.value?.reviewedBy
            ? [{ key: 'reviewedBy', label: '审核人', field: 'reviewedBy' }]
            : []),
          ...(detail.value?.postedBy
            ? [{ key: 'postedBy', label: '过账人', field: 'postedBy' }]
            : []),
          ...(detail.value?.reviewComment
            ? [{ key: 'reviewComment', label: '审核意见', field: 'reviewComment', span: 2 }]
            : []),
          ...(detail.value?.voidReason
            ? [{ key: 'voidReason', label: '作废原因', field: 'voidReason', span: 2 }]
            : []),
          ...(detail.value?.reversalReason
            ? [{ key: 'reversalReason', label: '冲销原因', field: 'reversalReason', span: 2 }]
            : [])
        ]
      : [])
  ])

  const lineColumns = computed<ColumnOption<Line>[]>(() => [
    { prop: 'lineNo', label: '行号', width: 68, align: 'center', fixed: 'left' },
    { prop: 'summary', label: '摘要', minWidth: 160, showOverflowTooltip: true },
    {
      prop: 'subjectId',
      label: '会计科目',
      minWidth: 190,
      formatter: (row) => (
        <BusinessTableIdentityCell
          primary={row.subjectNameSnapshot}
          secondary={row.subjectCodeSnapshot}
        />
      )
    },
    ...(canViewAmounts.value
      ? [
          ...(hasForeignCurrency.value
            ? [
                {
                  prop: 'currencyCodeSnapshot',
                  label: '外币',
                  width: 90,
                  formatter: (row: Line) => row.currencyCodeSnapshot || '—'
                },
                {
                  prop: 'originalAmount',
                  label: '原币金额',
                  width: 120,
                  align: 'right' as const,
                  formatter: (row: Line) =>
                    row.currencyCodeSnapshot ? formatSensitiveNumber(row.originalAmount) : '—'
                }
              ]
            : []),
          {
            prop: 'debitAmount',
            label: '借方金额',
            width: 135,
            align: 'right' as const,
            formatter: (row: Line) => formatSensitiveNumber(row.debitAmount)
          },
          {
            prop: 'creditAmount',
            label: '贷方金额',
            width: 135,
            align: 'right' as const,
            formatter: (row: Line) => formatSensitiveNumber(row.creditAmount)
          }
        ]
      : [])
  ])

  function statusLabel(status: Api.Fms.VoucherStatus): string {
    return {
      draft: '草稿',
      pending_review: '待审核',
      approved: '已审核',
      rejected: '已驳回',
      posted: '已过账',
      reversed: '已冲销',
      voided: '已作废'
    }[status]
  }

  function statusType(
    status: Api.Fms.VoucherStatus
  ): 'success' | 'warning' | 'danger' | 'info' | 'primary' {
    return {
      draft: 'info',
      pending_review: 'warning',
      approved: 'primary',
      rejected: 'danger',
      posted: 'success',
      reversed: 'warning',
      voided: 'info'
    }[status] as 'success' | 'warning' | 'danger' | 'info' | 'primary'
  }

  function actionLabel(action: Api.Fms.VoucherAction): string {
    return {
      create: '创建凭证',
      save: '保存凭证',
      submit: '提交审核',
      approve: '审核通过',
      reject: '审核驳回',
      post: '凭证过账',
      void: '凭证作废',
      reverse: '凭证冲销',
      reversal_create: '生成冲销凭证'
    }[action]
  }

  const formatTime = createDateTimeFormatter({ emptyText: '—' })

  async function handleOpen(row: Voucher | string): Promise<void> {
    const initialRow = typeof row === 'string' ? undefined : row
    openDetail(typeof row === 'string' ? row : row.id)
    await drawerRef.value?.handleOpen(initialRow, {
      title: '会计凭证详情',
      size: 'min(var(--art-dialog-width-xl), 96vw)',
      onOpen: () => loadDetail(activeId.value),
      drawerProps: { appendToBody: true, resizable: true, closeOnClickModal: true }
    })
  }

  defineExpose({ handleOpen })
</script>

<style scoped lang="scss">
  .voucher-detail {
    display: grid;
    gap: var(--art-space-4);
    min-width: 0;

    &__hero {
      display: flex;
      gap: 14px;
      align-items: center;
      min-width: 0;
      padding: 18px;
    }

    &__hero-icon {
      display: grid;
      flex: 0 0 44px;
      place-items: center;
      width: 44px;
      height: 44px;
      font-size: 22px;
      color: var(--el-color-primary);
      background: var(--el-color-primary-light-9);
      border-radius: var(--el-border-radius-base);
    }

    &__hero-copy {
      display: grid;
      gap: 4px;
      min-width: 0;

      h2,
      p {
        margin: 0;
      }

      h2 {
        font-size: 18px;
        line-height: 26px;
        overflow-wrap: anywhere;
      }

      p,
      > span {
        color: var(--el-text-color-secondary);
        overflow-wrap: anywhere;
      }
    }

    &__title-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;

      .el-tag {
        flex: 0 0 auto;
      }
    }

    &__section {
      min-width: 0;
    }

    &__totals,
    &__attachments {
      display: flex;
      flex-wrap: wrap;
      gap: var(--art-space-3);
    }

    &__totals {
      justify-content: flex-end;
      padding-top: var(--art-space-3);
    }

    &__timeline-card {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 4px var(--art-space-3);
      padding: var(--art-space-3);
      background: var(--el-fill-color-lighter);
      border-radius: var(--el-border-radius-base);

      span {
        color: var(--el-text-color-secondary);
        text-align: right;
      }

      p {
        grid-column: 1 / -1;
        margin: 0;
      }
    }
  }
</style>
