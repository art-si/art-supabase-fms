<template>
  <ArtPermissionGuard permission="FinanceReceivableAging:View">
    <FinanceAccountingWorkspaceShell class="receivable-aging-page">
      <BusinessWorkspaceHeader
        density="compact"
        eyebrow="RECEIVABLE AGING"
        title="应收账龄"
        description="按账期结束日拆分未结客户应收，识别长期挂账与客户集中度，为催收顺序提供依据。"
        icon="ri:hourglass-line"
        :tags="[
          { label: '五档账龄', type: 'primary' },
          { label: '客户集中度', type: 'warning' },
          { label: '敏感金额保护', type: 'info' }
        ]"
        :metrics="metrics"
        refreshable
        refresh-label="刷新应收账龄"
        :refresh-loading="loading"
        @refresh="loadOverview"
      />

      <ElAlert
        v-if="errorMessage && overview"
        type="error"
        show-icon
        :closable="false"
        :title="errorMessage"
      >
        <template #default
          ><ElButton type="primary" link @click="loadOverview">重新加载</ElButton></template
        >
      </ElAlert>
      <ElAlert
        v-if="overview?.truncated"
        type="warning"
        show-icon
        :closable="false"
        :title="`应收单据较多，当前展示 ${overview.returnedRecords} / ${overview.totalRecords} 笔`"
        description="本页账龄、金额与客户汇总基于当前返回的数据集。"
      />
      <ElAlert
        v-if="overview && !overview.readable"
        type="info"
        show-icon
        :closable="false"
        title="金额字段已按权限隐藏"
        description="仍可查看账龄数量和逾期天数；页面不会通过汇总计算绕过字段权限。"
      />
      <ArtSectionCard
        class="receivable-aging-page__workspace"
        title="账龄结构"
        :subtitle="`未结客户对账单共 ${overview?.statementCount ?? '--'} 笔，更新时间 ${generatedAt}`"
        preserve-content-structure
        :loading="loading && !overview"
        :error="!overview ? errorMessage : ''"
        :min-height="180"
        @retry="loadOverview"
      >
        <template #loading>
          <ElSkeleton animated aria-hidden="true">
            <template #template>
              <div class="receivable-aging-page__buckets receivable-aging-page__buckets--loading">
                <article v-for="bucket in Object.values(bucketMeta)" :key="bucket.label">
                  <span>{{ bucket.label }}</span>
                  <ElSkeletonItem variant="text" />
                  <ElSkeletonItem variant="text" />
                </article>
              </div>
            </template>
          </ElSkeleton>
        </template>
        <div v-if="overview" class="receivable-aging-page__buckets">
          <article v-for="bucket in overview.buckets" :key="bucket.key">
            <div
              ><span>{{ bucketMeta[bucket.key].label }}</span
              ><small>{{ bucket.statementCount }} 笔</small></div
            >
            <strong>{{ formatSensitiveCurrencyValue(bucket.amount) }}</strong>
            <span class="receivable-aging-page__bar">
              <i :style="{ width: `${bucketWidth(bucket.amount)}%` }"></i>
            </span>
          </article>
        </div>
      </ArtSectionCard>
      <ArtSectionCard
        v-if="overview || loading"
        class="receivable-aging-page__customers"
        preserve-content-structure
        title="重点客户应收"
        :loading="loading && !overview"
        :empty="!!overview && !overview.customers.length"
        empty-title="当前没有未结客户应收"
        empty-description="新增未结应收后可在此查看客户账龄排行。"
        :empty-visual-size="72"
        body-class="flex-1"
        :min-height="230"
      >
        <template #loading>
          <ElSkeleton animated aria-hidden="true">
            <template #template>
              <div class="receivable-aging-page__customer-skeleton">
                <div v-for="index in 4" :key="index">
                  <ElSkeletonItem variant="circle" />
                  <span><ElSkeletonItem variant="text" /><ElSkeletonItem variant="text" /></span>
                  <ElSkeletonItem variant="text" />
                </div>
              </div>
            </template>
          </ElSkeleton>
        </template>
        <ol v-if="overview">
          <li
            v-for="(customer, index) in overview.customers.slice(0, 10)"
            :key="customer.customerId"
          >
            <span class="receivable-aging-page__rank">{{ index + 1 }}</span>
            <div
              ><strong>{{ customer.customerName }}</strong
              ><small
                >{{ customer.statementCount }} 笔 · 最长 {{ customer.oldestAgingDays }} 天</small
              ></div
            >
            <strong>{{ formatSensitiveCurrencyValue(customer.amount) }}</strong>
            <ElTag
              :type="
                customer.oldestAgingDays > 90
                  ? 'danger'
                  : customer.oldestAgingDays > 30
                    ? 'warning'
                    : 'info'
              "
              effect="light"
              round
            >
              {{
                customer.oldestAgingDays > 90
                  ? '长期挂账'
                  : customer.oldestAgingDays > 30
                    ? '需关注'
                    : '账期内'
              }}
            </ElTag>
          </li>
        </ol>
      </ArtSectionCard>
    </FinanceAccountingWorkspaceShell>
  </ArtPermissionGuard>
</template>

<script setup lang="ts">
  import { getFriendlySupabaseErrorMessage } from '@/utils/supabase'
  import ArtSectionCard from '@/components/core/surfaces/art-section-card/index.vue'
  import BusinessWorkspaceHeader, {
    type BusinessWorkspaceMetric
  } from '@/components/business/business-workspace-header/index.vue'
  import { formatSensitiveCurrencyValue } from '@/utils/ui'
  import { formatWithDayjs } from '@/utils/time'
  import FinanceAccountingWorkspaceShell from '@fms/views/modules/finance-accounting-workspace-shell/index.vue'
  import { fetchReceivableAgingOverview } from '@fms/api'

  defineOptions({ name: 'FinanceReceivableAging' })

  const loading = ref(false)
  const errorMessage = ref('')
  const overview = ref<Api.Fms.ReceivableAgingOverview | null>(null)
  const bucketMeta: Record<Api.Fms.ReceivableAgingBucketKey, { label: string }> = {
    current: { label: '账期内' },
    days1To30: { label: '逾期 1–30 天' },
    days31To60: { label: '逾期 31–60 天' },
    days61To90: { label: '逾期 61–90 天' },
    daysOver90: { label: '逾期 90 天以上' }
  }
  const generatedAt = computed(() =>
    overview.value ? formatWithDayjs(overview.value.generatedAt) : '--'
  )
  const maxBucketAmount = computed(() =>
    Math.max(...(overview.value?.buckets.map((item) => item.amount ?? 0) ?? [0]), 0)
  )

  const bucketWidth = (value?: number) =>
    value === undefined || !maxBucketAmount.value
      ? 0
      : Math.max((value / maxBucketAmount.value) * 100, 4)
  const metrics = computed<BusinessWorkspaceMetric[]>(() => [
    {
      key: 'total',
      label: '未结应收',
      value: formatSensitiveCurrencyValue(overview.value?.totalOutstanding),
      description: `${overview.value?.statementCount ?? 0} 笔对账单`,
      icon: 'ri:money-cny-circle-line',
      tone: 'primary',
      loading: loading.value
    },
    {
      key: 'overdue',
      label: '逾期单据',
      value: overview.value?.overdueStatementCount ?? 0,
      description: '已超过账期结束日',
      icon: 'ri:timer-flash-line',
      tone: overview.value?.overdueStatementCount ? 'warning' : 'info',
      loading: loading.value
    },
    {
      key: 'long',
      label: '超 90 天',
      value: overview.value?.over90StatementCount ?? 0,
      description: '优先催收与复核',
      icon: 'ri:alarm-warning-line',
      tone: overview.value?.over90StatementCount ? 'danger' : 'info',
      loading: loading.value
    },
    {
      key: 'customers',
      label: '涉及客户',
      value: overview.value?.customers.length ?? 0,
      description: '未结应收客户数',
      icon: 'ri:user-received-2-line',
      tone: 'info',
      loading: loading.value
    }
  ])
  async function loadOverview(): Promise<void> {
    loading.value = true
    errorMessage.value = ''
    try {
      overview.value = await fetchReceivableAgingOverview()
    } catch (error) {
      errorMessage.value = getFriendlySupabaseErrorMessage(error, '应收账龄加载失败')
    } finally {
      loading.value = false
    }
  }
  onMounted(() => void loadOverview())
</script>

<style scoped lang="scss">
  .receivable-aging-page {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;

    &__workspace,
    &__customers {
      min-width: 0;
    }

    &__customers {
      display: flex;
      flex: 1 1 auto;
      flex-direction: column;
      min-height: 230px;
    }

    &__buckets {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 12px;
    }

    &__buckets article {
      min-width: 0;
      padding: 16px;
      background: var(--art-gray-100);
      border: 1px solid var(--el-border-color-lighter);
      border-radius: var(--el-border-radius-base);
    }

    &__buckets article > div {
      display: flex;
      gap: 8px;
      justify-content: space-between;
      color: var(--el-text-color-regular);
    }

    &__buckets--loading article {
      display: grid;
      gap: 12px;

      > span {
        font-size: 13px;
        color: var(--el-text-color-regular);
      }

      :deep(.el-skeleton__item) {
        height: 14px;

        &:nth-of-type(2) {
          width: 72%;
          height: 22px;
        }
      }
    }

    &__customer-skeleton {
      display: grid;
      gap: 8px;
      margin-top: 16px;

      > div {
        display: grid;
        grid-template-columns: 30px minmax(0, 1fr) 110px;
        gap: 12px;
        align-items: center;
        padding: 12px 14px;
        border-bottom: 1px solid var(--el-border-color-lighter);
      }

      > div > span {
        display: grid;
        gap: 8px;
      }

      :deep(.el-skeleton__circle) {
        width: 26px;
        height: 26px;
      }

      :deep(.el-skeleton__text) {
        height: 14px;
      }
    }

    &__buckets strong {
      display: block;
      margin: 12px 0;
      font-size: 18px;
      font-variant-numeric: tabular-nums;
      color: var(--art-gray-900);
    }

    &__bar {
      display: block;
      height: 6px;
      overflow: hidden;
      background: var(--el-fill-color);
      border-radius: 99px;
    }

    &__bar i {
      display: block;
      height: 100%;
      background: var(--theme-color);
      border-radius: inherit;
    }

    &__customers ol {
      display: grid;
      gap: 8px;
      padding: 0;
      margin: 16px 0 0;
      list-style: none;
    }

    &__customers li {
      display: grid;
      grid-template-columns: 30px minmax(0, 1fr) auto auto;
      gap: 12px;
      align-items: center;
      padding: 12px 14px;
      border-bottom: 1px solid var(--el-border-color-lighter);
    }

    &__customers li div strong,
    &__customers li small {
      display: block;
    }

    &__customers li small {
      margin-top: 4px;
      color: var(--el-text-color-regular);
    }

    &__rank {
      display: grid;
      place-items: center;
      width: 26px;
      height: 26px;
      color: var(--el-color-primary);
      background: var(--el-color-primary-light-9);
      border-radius: var(--art-surface-radius);
    }
  }

  @media only screen and (width <= 1000px) {
    .receivable-aging-page__buckets {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media only screen and (width <= 767px) {
    .receivable-aging-page {
      &__buckets {
        grid-template-columns: 1fr;
      }

      &__customers li {
        grid-template-columns: 30px minmax(0, 1fr);
      }

      &__customers li > strong,
      &__customers li > .el-tag {
        grid-column: 2;
        justify-self: start;
      }
    }
  }
</style>
