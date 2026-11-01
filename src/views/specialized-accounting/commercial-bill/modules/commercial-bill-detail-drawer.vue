<template>
  <ArtDrawer
    header-icon="ri:bank-card-line"
    :loading="loading"
    ref="drawerRef"
    @open="
      () => {
        activeDetailTab = 'overview'
      }
    "
    :show-footer="false"
  >
    <template #subtitle="{ data }"> {{ data.billNo }} · 票据信息与流转记录 </template>
    <ArtAsyncState
      :error="loadError?.message"
      :empty="!loading && !bill"
      empty-text="暂无票据详情"
      empty-description="请返回票据列表重新选择记录，或刷新后重试。"
      @retry="retryLoad"
    >
      <template #empty-action>
        <ElButton type="primary" plain @click="retryLoad">重新加载</ElButton>
      </template>
      <template v-if="bill">
        <div class="commercial-bill-detail">
          <ElTabs v-model="activeDetailTab"
            ><ElTabPane name="overview" label="票据信息"
              ><div class="space-y-4"
                ><ArtSectionCard title="票据信息" preserve-content-structure>
                  <ArtDescriptions
                    :data="bill"
                    :items="detailItems"
                    :columns="2"
                    label-width="104px"
                  /> </ArtSectionCard></div
            ></ElTabPane>
            <ElTabPane name="history" label="流转记录"
              ><div class="space-y-4"
                ><ArtSectionCard
                  class="commercial-bill-detail__events"
                  title="流转记录"
                  subtitle="保留每次状态变化的操作时间、金额与业务依据"
                  :empty="!events.length"
                  empty-title="草稿尚未产生流转记录"
                  empty-description="票据提交或状态变化后，操作记录会显示在这里。"
                  :empty-visual-size="64"
                  :min-height="148"
                  preserve-content-structure
                >
                  <ElTimeline>
                    <ElTimelineItem
                      v-for="event in events"
                      :key="event.id"
                      :timestamp="formatWithDayjs(event.createTime, 'YYYY-MM-DD HH:mm') || '--'"
                      placement="top"
                      :type="event.eventType === 'cancelled' ? 'danger' : 'primary'"
                    >
                      <div class="commercial-bill-detail__event-card">
                        <strong>{{
                          userStore.getDictItemByValue('fmsBillEventType', event.eventType)
                            ?.label ?? event.eventType
                        }}</strong>
                        <ArtDescriptions
                          :data="event"
                          :items="eventItems(event)"
                          :columns="2"
                          label-width="88px"
                        />
                      </div>
                    </ElTimelineItem>
                  </ElTimeline> </ArtSectionCard></div></ElTabPane
          ></ElTabs>
        </div>
      </template>
    </ArtAsyncState>
  </ArtDrawer>
</template>

<script setup lang="ts">
  import { ElButton } from 'element-plus'
  import ArtDrawer from '@/components/core/drawers/art-drawer/index.vue'
  import type { ArtDrawerExpose } from '@/components/core/drawers/art-drawer/types'
  import ArtAsyncState from '@/components/core/feedback/art-async-state/index.vue'
  import ArtDescriptions from '@/components/core/base/art-descriptions/index.vue'
  import ArtSectionCard from '@/components/core/surfaces/art-section-card/index.vue'
  import type { ArtDescriptionItem } from '@/components/core/base/art-descriptions/types'
  import { fetchCommercialBillDetail, fetchCommercialBillEvents } from '@fms/api'
  import { useDetailRecord } from '@/hooks/core/useDetailRecord'
  import { canViewField } from '@/utils/field-permission'
  import { formatSensitiveCurrencyValue } from '@/utils/ui'
  import { formatWithDayjs } from '@/utils/time'
  import { useUserStore } from '@/store/modules/user'

  defineOptions({ name: 'FinanceCommercialBillDetailDrawer' })

  type Bill = Api.Fms.CommercialBillRecord
  type Event = Api.Fms.CommercialBillEventRecord
  interface BillDetail {
    record: Bill
    events: Event[]
  }

  const userStore = useUserStore()

  const drawerRef = ref<ArtDrawerExpose<Bill>>()
  const activeDetailTab = ref('overview')
  const {
    detail: loadedDetail,
    loading,
    loadError,
    loadDetail,
    openDetail,
    retryLoad
  } = useDetailRecord<BillDetail>(async (id) => {
    await Promise.all([
      userStore.ensureDictLoaded('fmsBillStatus'),
      userStore.ensureDictLoaded('fmsBillEventType'),
      userStore.ensureDictLoaded('fmsBillDirection'),
      userStore.ensureDictLoaded('fmsBillType')
    ])
    const [recordResult, eventResult] = await Promise.all([
      fetchCommercialBillDetail(id, { showErrorMessage: false }),
      fetchCommercialBillEvents(id, { showErrorMessage: false })
    ])
    return {
      data: recordResult.data
        ? { record: recordResult.data, events: eventResult.data ?? [] }
        : undefined,
      error: recordResult.error ?? eventResult.error
    }
  }, '票据详情加载失败，请重试或返回列表重新选择。')
  const bill = computed(() => loadedDetail.value?.record)
  const events = computed(() => loadedDetail.value?.events ?? [])

  function eventItems(event: Event): ArtDescriptionItem<Event>[] {
    return [
      ...(event.eventDate
        ? [{ key: 'eventDate', field: 'eventDate', label: '业务日期', format: 'date' as const }]
        : []),
      ...(canView('billAmounts')
        ? [
            {
              key: 'amount',
              label: '发生金额',
              formatter: (_value: unknown, row: Event) =>
                formatSensitiveCurrencyValue(row.amount, bill.value?.currencyCode)
            }
          ]
        : []),
      ...(canView('billParties') && event.counterpartyName
        ? [{ key: 'counterpartyName', field: 'counterpartyName', label: '往来单位', span: 2 }]
        : []),
      ...(canView('billReferences') && event.referenceNo
        ? [{ key: 'referenceNo', field: 'referenceNo', label: '业务依据', copyable: true, span: 2 }]
        : []),
      ...(event.remark ? [{ key: 'remark', field: 'remark', label: '备注', span: 2 }] : [])
    ]
  }

  const canView = (field: Api.Fms.CommercialBillFieldKey): boolean =>
    canViewField(bill.value?.fieldAccess, field)

  const detailItems = computed<ArtDescriptionItem<Bill>[]>(() => {
    if (!bill.value) return []
    const items: ArtDescriptionItem<Bill>[] = [
      { key: 'billNo', label: '票据编号', field: 'billNo', copyable: true },
      {
        key: 'status',
        label: '票据状态',
        field: 'status',
        dictCode: 'fmsBillStatus',
        dictDisplay: 'tag'
      },
      { key: 'direction', label: '票据方向', field: 'direction', dictCode: 'fmsBillDirection' },
      { key: 'billType', label: '票据类型', field: 'billType', dictCode: 'fmsBillType' },
      { key: 'issueDate', label: '出票日期', field: 'issueDate', format: 'date' },
      { key: 'dueDate', label: '到期日期', field: 'dueDate', format: 'date' },
      {
        key: 'transferable',
        label: '允许背书',
        field: 'transferable',
        span: 2,
        formatter: (_value, row) => (row.transferable ? '允许' : '禁止')
      }
    ]
    if (canView('billParties')) {
      items.splice(
        4,
        0,
        { key: 'drawerName', label: '出票人', field: 'drawerName' },
        { key: 'payeeName', label: '收款人', field: 'payeeName' },
        { key: 'acceptorName', label: '承兑人', field: 'acceptorName' },
        { key: 'counterpartyName', label: '往来单位', field: 'counterpartyName' }
      )
    }
    if (canView('billAmounts')) {
      items.push(
        {
          key: 'faceAmount',
          label: '票面金额',
          field: 'faceAmount',
          formatter: (_value, row) =>
            formatSensitiveCurrencyValue(row.faceAmount, bill.value?.currencyCode)
        },
        {
          key: 'settledAmount',
          label: '已结金额',
          field: 'settledAmount',
          formatter: (_value, row) =>
            formatSensitiveCurrencyValue(row.settledAmount, bill.value?.currencyCode)
        }
      )
    }
    if (canView('billReferences')) {
      items.push(
        { key: 'externalBillNo', label: '票面号码', field: 'externalBillNo', copyable: true },
        { key: 'sourceNo', label: '来源单号', field: 'sourceNo', copyable: true }
      )
    }
    items.push({ key: 'remark', label: '备注', field: 'remark', span: 2 })
    return items
  })

  async function handleOpen(row: Bill): Promise<void> {
    openDetail(row.id)
    await drawerRef.value?.handleOpen(row, {
      title: '票据详情',
      size: 'xl',
      onOpen: () => loadDetail(row.id),
      drawerProps: { appendToBody: true, resizable: true, closeOnClickModal: true }
    })
  }

  defineExpose({ handleOpen })
</script>

<style scoped lang="scss">
  .commercial-bill-detail {
    display: grid;
    gap: var(--art-space-4);
    min-width: 0;

    &__events {
      min-width: 0;
    }

    &__event-card {
      display: grid;
      gap: 12px;
      padding: 12px 14px;
      background: var(--el-fill-color-lighter);
      border-radius: var(--el-border-radius-base);
    }
  }
</style>
