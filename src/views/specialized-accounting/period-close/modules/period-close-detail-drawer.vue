<template>
  <ArtDrawer
    header-icon="ri:shield-check-line"
    :loading="loading"
    ref="drawerRef"
    @open="
      () => {
        activeDetailTab = 'overview'
      }
    "
    :show-footer="false"
  >
    <ArtAsyncState
      :error="loadError?.message"
      :empty="!loading && !run"
      empty-text="暂无关账检查详情"
      empty-description="请返回关账列表重新选择记录，或重新加载。"
      @retry="retryLoad"
    >
      <div v-if="run" class="close-detail">
        <ElTabs v-model="activeDetailTab"
          ><ElTabPane name="overview" label="关账概览"
            ><div class="space-y-4"
              ><ArtSectionCard title="关账概览" preserve-content-structure>
                <ArtDescriptions
                  :data="run"
                  :items="descriptionItems"
                  :columns="2"
                  label-width="104px"
                /> </ArtSectionCard></div
          ></ElTabPane>
          <ElTabPane name="checks" label="检查结果"
            ><div class="space-y-4"
              ><ArtSectionCard
                title="关账检查结果"
                :empty="!checks.length"
                empty-title="暂无关账检查结果"
                empty-description="执行关账检查后，结果和阻断原因会显示在这里。"
                :empty-visual-size="72"
                :min-height="188"
                preserve-content-structure
              >
                <ArtTable
                  v-if="!isNarrow"
                  :pagination="false"
                  :border="false"
                  :data="checks"
                  row-key="id"
                >
                  <ElTableColumn prop="checkName" label="检查项目" min-width="170" />
                  <ElTableColumn v-if="canViewDiagnostics" label="结果" width="100">
                    <template #default="{ row }">
                      <span v-if="row.status === '***'">***</span>
                      <ArtDictDisplay
                        v-else
                        dict-code="fmsPeriodCloseCheckStatus"
                        :value="row.status"
                        display="tag"
                      />
                    </template>
                  </ElTableColumn>
                  <ElTableColumn v-if="canViewDiagnostics" label="问题数" width="90" align="right">
                    <template #default="{ row }">{{
                      formatSensitiveCountValue(row.issueCount)
                    }}</template>
                  </ElTableColumn>
                  <ElTableColumn
                    v-if="canViewDiagnostics"
                    prop="summary"
                    label="检查结论"
                    min-width="280"
                  >
                    <template #default="{ row }">
                      <span class="whitespace-normal break-words">{{ row.summary || '—' }}</span>
                    </template>
                  </ElTableColumn>
                  <ElTableColumn v-if="canViewDiagnostics" label="控制级别" width="110">
                    <template #default="{ row }">
                      <span v-if="row.isBlocking === '***'">***</span>
                      <ElTag
                        v-else
                        :type="row.status === 'blocked' ? 'danger' : 'info'"
                        effect="plain"
                      >
                        {{ row.isBlocking ? '强制校验' : '提示校验' }}
                      </ElTag>
                    </template>
                  </ElTableColumn>
                </ArtTable>
                <div v-else class="close-detail__checks">
                  <article v-for="check in checks" :key="check.id" class="close-detail__check">
                    <header>
                      <strong>{{ check.checkName }}</strong>
                      <ArtDictDisplay
                        v-if="canViewDiagnostics && check.status !== '***'"
                        dict-code="fmsPeriodCloseCheckStatus"
                        :value="check.status"
                        display="tag"
                      />
                      <span v-else-if="canViewDiagnostics">***</span>
                    </header>
                    <template v-if="canViewDiagnostics">
                      <p>{{ check.summary || '暂无检查结论' }}</p>
                      <footer>
                        <span>问题数 {{ formatSensitiveCountValue(check.issueCount) }}</span>
                        <ElTag
                          :type="check.status === 'blocked' ? 'danger' : 'info'"
                          effect="plain"
                        >
                          {{
                            check.isBlocking === '***'
                              ? '***'
                              : check.isBlocking
                                ? '强制校验'
                                : '提示校验'
                          }}
                        </ElTag>
                      </footer>
                    </template>
                  </article>
                </div>
              </ArtSectionCard></div
            ></ElTabPane
          ></ElTabs
        >
      </div>
    </ArtAsyncState>
  </ArtDrawer>
</template>
<script setup lang="ts">
  import { formatSensitiveCountValue } from '@/utils/ui'
  import { useMediaQuery } from '@vueuse/core'
  import { useDetailRecord } from '@/hooks/core/useDetailRecord'
  import { useUserStore } from '@/store/modules/user'
  import ArtAsyncState from '@/components/core/feedback/art-async-state/index.vue'
  import ArtTable from '@/components/core/tables/art-table/index.vue'
  import ArtDrawer from '@/components/core/drawers/art-drawer/index.vue'
  import ArtSectionCard from '@/components/core/surfaces/art-section-card/index.vue'
  import ArtDescriptions from '@/components/core/base/art-descriptions/index.vue'
  import type { ArtDescriptionItem } from '@/components/core/base/art-descriptions/types'
  import type { ArtDrawerExpose } from '@/components/core/drawers/art-drawer/types'
  import ArtDictDisplay from '@/components/core/base/art-dict-display/index.vue'
  import { fetchPeriodCloseChecks, fetchPeriodCloseRunDetail } from '@fms/api'
  import { canViewField } from '@/utils/field-permission'
  defineOptions({ name: 'FinancePeriodCloseDetailDrawer' })
  const drawerRef = ref<ArtDrawerExpose>()
  const activeDetailTab = ref('overview')
  const userStore = useUserStore()
  const isNarrow = useMediaQuery('(max-width: 640px)')
  const { detail, loading, loadError, loadDetail, openDetail, retryLoad } = useDetailRecord<{
    run: Api.Fms.PeriodCloseRunRecord
    checks: Api.Fms.PeriodCloseCheckRecord[]
  }>(async (id) => {
    const [runResult, checkResult] = await Promise.all([
      fetchPeriodCloseRunDetail(id, { showErrorMessage: false }),
      fetchPeriodCloseChecks(id, { showErrorMessage: false }),
      userStore.ensureDictLoaded('fmsPeriodCloseCheckStatus'),
      userStore.ensureDictLoaded('fmsPeriodCloseRunStatus')
    ])
    return {
      data: runResult.data ? { run: runResult.data, checks: checkResult.data ?? [] } : undefined,
      error: runResult.error ?? checkResult.error
    }
  }, '关账检查详情加载失败，请重新加载。')
  const run = computed(() => detail.value?.run)
  const checks = computed(() => detail.value?.checks ?? [])
  const canViewDiagnostics = computed(() =>
    canViewField(run.value?.fieldAccess, 'closeDiagnostics')
  )
  const descriptionItems = computed<ArtDescriptionItem<Api.Fms.PeriodCloseRunRecord>[]>(() => [
    { key: 'runNo', label: '关账批次', field: 'runNo', copyable: true },
    { key: 'status', label: '状态', field: 'status', dictCode: 'fmsPeriodCloseRunStatus' },
    {
      key: 'period',
      label: '会计期间',
      field: 'period',
      formatter: (_value, row) =>
        row.period ? `${row.period.fiscalYear} 年第 ${row.period.periodNo} 期` : '--'
    },
    { key: 'createTime', label: '检查时间', field: 'createTime', format: 'datetime' },
    ...(canViewDiagnostics.value
      ? ['passedCount', 'warningCount', 'blockingCount'].map((field, index) => ({
          key: field,
          label: ['通过项目', '提醒项目', '阻断项目'][index],
          field,
          formatter: (value: unknown) => formatSensitiveCountValue(value as Api.Fms.SensitiveNumber)
        }))
      : []),
    ...(canViewField(run.value?.fieldAccess, 'closeAudit')
      ? [
          ...(run.value?.completedAt
            ? [
                {
                  key: 'completedAt',
                  label: '结账时间',
                  field: 'completedAt',
                  format: 'datetime' as const
                }
              ]
            : []),
          ...(run.value?.cancelledAt
            ? [
                {
                  key: 'cancelledAt',
                  label: '取消时间',
                  field: 'cancelledAt',
                  format: 'datetime' as const
                }
              ]
            : []),
          ...(run.value?.cancelReason
            ? [{ key: 'cancelReason', label: '取消原因', field: 'cancelReason', span: 2 }]
            : [])
        ]
      : [])
  ])
  async function handleOpen(row: Api.Fms.PeriodCloseRunRecord) {
    openDetail(row.id)
    await drawerRef.value?.handleOpen(undefined, {
      title: '关账检查详情',
      subtitle: row.runNo,
      size: 'xl',
      loading: true,
      loadingText: '正在加载关账检查…',
      onOpen: async (_data, api) => {
        try {
          await loadDetail(row.id)
        } finally {
          api.setLoading(false)
        }
      },
      drawerProps: { appendToBody: true, resizable: true, closeOnClickModal: true }
    })
  }
  defineExpose({ handleOpen })
</script>
<style scoped lang="scss">
  .close-detail {
    display: grid;
    gap: var(--art-space-4);
  }

  .close-detail__checks {
    display: grid;
    gap: var(--art-space-3);
  }

  .close-detail__check {
    padding: var(--art-space-3);
    border: 1px solid var(--el-border-color-lighter);
    border-radius: var(--el-border-radius-base);

    header,
    footer {
      display: flex;
      gap: var(--art-space-2);
      align-items: center;
      justify-content: space-between;
    }

    header strong {
      min-width: 0;
      overflow-wrap: anywhere;
    }

    p {
      margin: var(--art-space-3) 0;
      color: var(--el-text-color-regular);
      overflow-wrap: anywhere;
    }
  }
</style>
