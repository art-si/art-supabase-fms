<template>
  <ArtDrawer header-icon="ri:line-chart-line" ref="drawerRef" :show-footer="false">
    <div class="depreciation-workbench">
      <ElAlert v-if="loadError" type="error" :closable="false" show-icon>
        <template #title>折旧数据加载失败</template>
        <ElButton plain type="primary" @click="loadInitialData">重新加载</ElButton>
      </ElAlert>
      <ElAlert v-if="periodLoadFailed" type="error" :closable="false" show-icon>
        <template #title>会计期间加载失败，请重新加载后再计算。</template>
        <ElButton plain type="primary" @click="loadPeriods">重新加载期间</ElButton>
      </ElAlert>
      <ArtForm
        v-model="calculationScope"
        :items="scopeItems"
        :span="24"
        :gutter="0"
        :label-position="isCompact ? 'top' : 'right'"
        label-width="84px"
        root-class="p-0!"
      >
        <template #layout="{ fields: Fields, items }">
          <div class="depreciation-workbench__controls">
            <component :is="Fields" :items="items.slice(0, 1)" :actions="false" />
            <component :is="Fields" :items="items.slice(1)" :actions="false" />
            <ElButton
              v-auth="'FinanceFixedAsset:Depreciation'"
              type="primary"
              :disabled="
                !periodId ||
                !canCalculate ||
                periodsLoading ||
                periodLoadFailed ||
                runsLoading ||
                Boolean(runsError)
              "
              :loading="calculating"
              :title="canCalculate ? undefined : '需要资产价值字段编辑权限'"
              @click="calculate"
              >计算本期折旧</ElButton
            >
          </div>
        </template>
      </ArtForm>
      <ArtSectionCard
        title="折旧批次"
        subtitle="选择批次查看资产折旧明细"
        :loading="runsLoading"
        :error="runsError"
        @retry="loadRuns"
        :empty="!runs.length"
        empty-title="暂无折旧批次"
        :empty-description="
          !accountSetId
            ? '选择账套后可查看折旧批次。'
            : canCalculate
              ? '选择开放期间并计算本期折旧后，批次会显示在这里。'
              : '当前账套暂无折旧批次，请联系有权限的人员完成计算后查看。'
        "
        :empty-visual-size="72"
        :min-height="188"
        preserve-content-structure
      >
        <ArtTable
          v-if="!isCompact"
          class="h-auto!"
          height="auto"
          :border="false"
          :pagination="false"
          :show-table-header="false"
          :data="runs"
          row-key="id"
          max-height="280"
          :highlight-current-row="true"
          :current-row-key="selectedRun?.id"
          @row-click="selectRun"
        >
          <ElTableColumn prop="runNo" label="批次号" min-width="170">
            <template #default="{ row }">
              <ElButton
                link
                type="primary"
                :aria-pressed="selectedRun?.id === row.id"
                @click.stop="selectRun(row)"
              >
                {{ row.runNo }}
              </ElButton>
            </template>
          </ElTableColumn>
          <ElTableColumn label="期间" min-width="120"
            ><template #default="{ row }">{{
              row.period ? `${row.period.fiscalYear}-${row.period.periodNo}` : '--'
            }}</template></ElTableColumn
          >
          <ElTableColumn prop="assetCount" label="资产数" width="90" />
          <ElTableColumn v-if="canViewRunValues" label="折旧金额" min-width="130" align="right"
            ><template #default="{ row }">{{
              formatProtectedAmount(row.totalAmount)
            }}</template></ElTableColumn
          >
          <ElTableColumn label="状态" width="100"
            ><template #default="{ row }"
              ><ArtDictDisplay
                dict-code="fmsDepreciationRunStatus"
                :value="row.status"
                display="tag" /></template
          ></ElTableColumn>
          <ElTableColumn v-if="hasRunActions" label="操作" width="80" fixed="right"
            ><template #default="{ row }"
              ><BusinessTableRowActions
                @click.stop
                v-if="row.status === 'calculated' && canEditField(row.fieldAccess, 'assetValues')"
                ><ArtButtonTable
                  type="sign"
                  label="确认折旧并入账"
                  permission="FinanceFixedAsset:Depreciation"
                  @click="postRun(row)" /></BusinessTableRowActions></template
          ></ElTableColumn>
        </ArtTable>
        <div v-else-if="runs.length" class="depreciation-workbench__mobile-list">
          <article
            v-for="run in runs"
            :key="run.id"
            class="depreciation-workbench__mobile-item"
            :class="selectedRun?.id === run.id ? 'border-primary! bg-primary/5' : ''"
          >
            <div class="depreciation-workbench__mobile-heading">
              <ElButton
                link
                type="primary"
                :aria-pressed="selectedRun?.id === run.id"
                @click="selectRun(run)"
                >{{ run.runNo }}</ElButton
              >
              <ArtDictDisplay
                dict-code="fmsDepreciationRunStatus"
                :value="run.status"
                display="tag"
              />
            </div>
            <dl class="depreciation-workbench__mobile-facts">
              <div>
                <dt>期间</dt>
                <dd>{{ run.period ? `${run.period.fiscalYear}-${run.period.periodNo}` : '--' }}</dd>
              </div>
              <div
                ><dt>资产数</dt><dd>{{ run.assetCount }}</dd></div
              >
              <div v-if="canViewRunValues">
                <dt>折旧金额</dt>
                <dd>{{ formatProtectedAmount(run.totalAmount) }}</dd>
              </div>
            </dl>
            <ElButton
              v-if="run.status === 'calculated' && canEditField(run.fieldAccess, 'assetValues')"
              v-auth="'FinanceFixedAsset:Depreciation'"
              type="primary"
              plain
              @click="postRun(run)"
            >
              确认折旧并入账
            </ElButton>
          </article>
        </div>
      </ArtSectionCard>
      <ArtSectionCard
        v-if="selectedRun"
        :title="`${selectedRun.runNo} · 折旧明细`"
        :loading="linesLoading"
        :error="linesError"
        @retry="selectRun(selectedRun)"
        :empty="!lines.length"
        empty-title="暂无资产折旧明细"
        empty-description="此批次没有可展示的资产明细。"
        :empty-visual-size="64"
        :min-height="164"
        preserve-content-structure
      >
        <ArtTable
          v-if="!isCompact"
          class="h-auto!"
          height="auto"
          :border="false"
          :pagination="false"
          :show-table-header="false"
          :data="lines"
          size="small"
          max-height="300"
        >
          <ElTableColumn label="资产" min-width="240">
            <template #default="{ row }">
              <BusinessTableIdentityCell
                :primary="row.asset?.assetName"
                :secondary="row.asset?.assetNo"
              />
            </template>
          </ElTableColumn>
          <ElTableColumn v-if="canViewLineValues" label="期初累计" min-width="120" align="right"
            ><template #default="{ row }">{{
              formatProtectedAmount(row.openingAccumulatedDepreciation)
            }}</template></ElTableColumn
          >
          <ElTableColumn v-if="canViewLineValues" label="本期折旧" min-width="120" align="right"
            ><template #default="{ row }">{{
              formatProtectedAmount(row.depreciationAmount)
            }}</template></ElTableColumn
          >
          <ElTableColumn v-if="canViewLineValues" label="期末累计" min-width="120" align="right"
            ><template #default="{ row }">{{
              formatProtectedAmount(row.closingAccumulatedDepreciation)
            }}</template></ElTableColumn
          >
        </ArtTable>
        <div v-else-if="lines.length" class="depreciation-workbench__mobile-list">
          <article v-for="line in lines" :key="line.id" class="depreciation-workbench__mobile-item">
            <strong>{{ line.asset?.assetNo }} · {{ line.asset?.assetName }}</strong>
            <dl v-if="canViewLineValues" class="depreciation-workbench__mobile-facts">
              <div>
                <dt>期初累计</dt>
                <dd>{{ formatProtectedAmount(line.openingAccumulatedDepreciation) }}</dd>
              </div>
              <div>
                <dt>本期折旧</dt>
                <dd>{{ formatProtectedAmount(line.depreciationAmount) }}</dd>
              </div>
              <div>
                <dt>期末累计</dt>
                <dd>{{ formatProtectedAmount(line.closingAccumulatedDepreciation) }}</dd>
              </div>
            </dl>
          </article>
        </div>
      </ArtSectionCard>
    </div>
  </ArtDrawer>
</template>

<script setup lang="ts">
  import { useAccountingPeriodOptions } from '../../../modules/use-accounting-period-options'
  import { createFinancePrerequisiteOverlay } from '../../../modules/use-finance-account-set-prerequisite'
  import ArtTable from '@/components/core/tables/art-table/index.vue'
  import ArtButtonTable from '@/components/core/forms/art-button-table/index.vue'
  import ArtForm, { type FormItem } from '@/components/core/forms/art-form/index.vue'
  import BusinessTableRowActions from '@/components/business/business-table-row-actions/index.vue'
  import BusinessTableIdentityCell from '@/components/business/business-table-identity-cell/index.vue'
  import ArtDrawer from '@/components/core/drawers/art-drawer/index.vue'
  import ArtSectionCard from '@/components/core/surfaces/art-section-card/index.vue'
  import type { ArtDrawerExpose } from '@/components/core/drawers/art-drawer/types'
  import ArtDictDisplay from '@/components/core/base/art-dict-display/index.vue'
  import { notifyFriendlyError, useArtFeedback } from '@/hooks/core/useArtFeedback'
  import { useAuth } from '@/hooks/core/useAuth'
  import { formatSensitiveCurrencyValue as formatProtectedAmount } from '@/utils/ui'
  import { useMediaQuery } from '@vueuse/core'
  import { canEditField, canViewField, mergeFieldAccessMaps } from '@/utils/field-permission'
  import { ACCOUNTING_SELECT_EMPTY_TEXT } from '../../../modules/accounting-select-text'
  import {
    actAssetDepreciationRun,
    calculateAssetDepreciation,
    fetchAccountSetOptions,
    fetchAssetDepreciationLines,
    fetchAssetDepreciationRuns
  } from '@fms/api'
  defineOptions({ name: 'FinanceAssetDepreciationDrawer' })
  const emit = defineEmits<{ success: [] }>()
  const { confirmAction } = useArtFeedback()
  const isCompact = useMediaQuery('(max-width: 640px)')
  const drawerRef = ref<ArtDrawerExpose>()
  const prerequisiteOverlay = createFinancePrerequisiteOverlay(drawerRef)
  const accountSetOptions = ref<Api.Fms.AccountSetOption[]>([])
  const calculationScope = ref({ accountSetId: '', periodId: '' })
  const accountSetId = computed({
    get: () => calculationScope.value.accountSetId,
    set: (value) => {
      calculationScope.value.accountSetId = value
    }
  })
  const periodId = computed({
    get: () => calculationScope.value.periodId,
    set: (value) => {
      calculationScope.value.periodId = value
    }
  })
  const loadError = ref(false)
  const requestedAccountSetId = ref<string>()
  const requestedRunNo = ref<string>()
  const {
    periodOptions,
    periodFieldText,
    periodsLoading,
    periodLoadFailed,
    loadPeriods: loadPeriodOptions,
    resetPeriods
  } = useAccountingPeriodOptions(accountSetId, periodId)
  const runsLoading = ref(false)
  const runsError = ref('')
  const linesLoading = ref(false)
  const linesError = ref('')
  const calculating = ref(false)
  let runsRequestId = 0
  let linesRequestId = 0
  const runs = ref<Api.Fms.AssetDepreciationRunRecord[]>([])
  const selectedRun = ref<Api.Fms.AssetDepreciationRunRecord>()
  const lines = ref<Api.Fms.AssetDepreciationLineRecord[]>([])
  const runFieldAccess = ref<Api.Fms.FixedAssetFieldAccessMap>({})
  const lineFieldAccess = ref<Api.Fms.FixedAssetFieldAccessMap>({})
  const effectiveRunAccess = computed(() =>
    mergeFieldAccessMaps(runFieldAccess.value, ...runs.value.map((row) => row.fieldAccess))
  )
  const effectiveLineAccess = computed(() =>
    mergeFieldAccessMaps(lineFieldAccess.value, ...lines.value.map((row) => row.fieldAccess))
  )
  const { hasAuth } = useAuth()
  const hasRunActions = computed(
    () =>
      hasAuth('FinanceFixedAsset:Depreciation') &&
      runs.value.some(
        (run) => run.status === 'calculated' && canEditField(run.fieldAccess, 'assetValues')
      )
  )
  const canCalculate = computed(
    () =>
      hasAuth('FinanceFixedAsset:Depreciation') && canEditField(runFieldAccess.value, 'assetValues')
  )
  const canViewRunValues = computed(() => canViewField(effectiveRunAccess.value, 'assetValues'))
  const canViewLineValues = computed(() => canViewField(effectiveLineAccess.value, 'assetValues'))
  const scopeItems = computed<FormItem[]>(() => [
    {
      key: 'accountSetId',
      label: '所属账套',
      type: 'select',
      props: {
        options: accountSetOptions.value,
        clearable: false,
        filterable: true,
        disabled: calculating.value,
        placeholder: '选择账套',
        noDataText: ACCOUNTING_SELECT_EMPTY_TEXT.accountSet,
        onChange: loadPeriods
      }
    },
    {
      key: 'periodId',
      label: '会计期间',
      type: 'select',
      ...periodFieldText.value,
      props: {
        options: periodOptions.value,
        clearable: false,
        filterable: false,
        loading: periodsLoading.value,
        disabled:
          !accountSetId.value ||
          periodsLoading.value ||
          periodLoadFailed.value ||
          calculating.value,
        placeholder: '选择开放期间',
        noDataText: accountSetId.value
          ? ACCOUNTING_SELECT_EMPTY_TEXT.openAccountingPeriod
          : ACCOUNTING_SELECT_EMPTY_TEXT.chooseAccountSet
      }
    }
  ])
  async function loadPeriods(): Promise<void> {
    selectedRun.value = undefined
    ++linesRequestId
    lines.value = []
    linesError.value = ''
    linesLoading.value = false
    runs.value = []
    runFieldAccess.value = {}
    await Promise.all([loadPeriodOptions(), loadRuns()])
  }
  async function loadRuns(): Promise<void> {
    const requestId = ++runsRequestId
    const currentAccountSetId = accountSetId.value
    runsError.value = ''
    runsLoading.value = Boolean(currentAccountSetId)
    if (!currentAccountSetId) return
    try {
      const result = await fetchAssetDepreciationRuns(currentAccountSetId)
      if (requestId !== runsRequestId || currentAccountSetId !== accountSetId.value) return
      if (result.error) {
        runsError.value = '折旧批次加载失败，请重试。'
        return
      }
      runs.value = result.data ?? []
      runFieldAccess.value = result.fieldAccess
    } catch {
      if (requestId === runsRequestId) runsError.value = '折旧批次加载失败，请重试。'
    } finally {
      if (requestId === runsRequestId) runsLoading.value = false
    }
  }
  async function selectRun(rawRow: object): Promise<void> {
    const row = rawRow as Api.Fms.AssetDepreciationRunRecord
    const requestId = ++linesRequestId
    selectedRun.value = row
    lines.value = []
    lineFieldAccess.value = {}
    linesError.value = ''
    linesLoading.value = true
    try {
      const result = await fetchAssetDepreciationLines(row.id)
      if (requestId !== linesRequestId || selectedRun.value?.id !== row.id) return
      if (result.error) {
        linesError.value = '资产折旧明细加载失败，请重试。'
        return
      }
      lines.value = result.data ?? []
      lineFieldAccess.value = result.fieldAccess
    } catch {
      if (requestId === linesRequestId) linesError.value = '资产折旧明细加载失败，请重试。'
    } finally {
      if (requestId === linesRequestId) linesLoading.value = false
    }
  }
  async function calculate(): Promise<void> {
    if (calculating.value || periodsLoading.value || periodLoadFailed.value || !periodId.value)
      return
    if (!canCalculate.value) {
      ElMessage.warning('你没有资产价值字段的编辑权限，无法计算折旧')
      return
    }
    calculating.value = true
    try {
      await calculateAssetDepreciation(periodId.value)
      await loadRuns()
      emit('success')
    } catch (error) {
      notifyFriendlyError(error, '折旧计算失败，请检查期间和资产状态后重试')
    } finally {
      calculating.value = false
    }
  }
  async function postRun(rawRow: object): Promise<void> {
    const row = rawRow as Api.Fms.AssetDepreciationRunRecord
    if (!canEditField(row.fieldAccess, 'assetValues')) {
      ElMessage.warning('你没有资产价值字段的编辑权限，无法确认折旧')
      return
    }
    try {
      await confirmAction(
        `确认批次 ${row.runNo} 的折旧金额 ${formatProtectedAmount(row.totalAmount)} 吗？`,
        '确认本期折旧',
        { type: 'warning', confirmButtonText: '确认并入账' }
      )
      await actAssetDepreciationRun(row.id, 'post')
      await loadRuns()
      emit('success')
    } catch (error) {
      if (error !== 'cancel' && error !== 'close') {
        notifyFriendlyError(error, '折旧入账失败，请刷新批次状态后重试')
      }
    }
  }
  async function loadInitialData(): Promise<void> {
    loadError.value = false
    drawerRef.value?.setLoading(true)
    try {
      const { data, error } = await fetchAccountSetOptions({ status: 'active', from: 0, to: 999 })
      if (error) {
        loadError.value = true
        return
      }
      accountSetOptions.value = data ?? []
      accountSetId.value = requestedAccountSetId.value || accountSetOptions.value[0]?.value || ''
      await loadPeriods()
      const requestedRun = runs.value.find((run) => run.runNo === requestedRunNo.value)
      if (requestedRun) await selectRun(requestedRun)
    } catch {
      loadError.value = true
    } finally {
      prerequisiteOverlay.finishLoading()
    }
  }
  async function handleOpen(currentAccountSetId?: string, runNo?: string): Promise<void> {
    ++runsRequestId
    ++linesRequestId
    resetPeriods()
    accountSetId.value = ''
    periodId.value = ''
    selectedRun.value = undefined
    lines.value = []
    runsError.value = ''
    linesError.value = ''
    runsLoading.value = false
    linesLoading.value = false
    requestedAccountSetId.value = currentAccountSetId
    requestedRunNo.value = runNo
    loadError.value = false
    accountSetOptions.value = []
    runs.value = []
    await drawerRef.value?.handleOpen(undefined, {
      title: '固定资产折旧管理',
      subtitle: '选择期间计算折旧，核对批次后确认入账',
      size: 'xl',
      loading: true,
      loadingText: '正在加载折旧数据…',
      onOpen: loadInitialData,
      drawerProps: { appendToBody: true, resizable: true, closeOnClickModal: true }
    })
  }

  defineExpose({ handleOpen, ...prerequisiteOverlay })
</script>

<style scoped lang="scss">
  .depreciation-workbench {
    display: grid;
    gap: 18px;
  }

  .depreciation-workbench__controls {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 12px;
    align-items: start;
    padding: 16px;
    background: var(--el-fill-color-lighter);
    border: 1px solid var(--el-border-color-lighter);
    border-radius: var(--el-border-radius-base);

    > * {
      width: 100%;
      min-width: 0;
      margin: 0;
    }

    > :first-child {
      grid-column: 1 / -1;
    }

    :deep(.el-form-item) {
      margin-bottom: 0;
    }
  }

  .depreciation-workbench__mobile-list {
    display: grid;
    gap: 10px;
  }

  .depreciation-workbench__mobile-item {
    display: grid;
    gap: 12px;
    padding: 12px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: var(--el-border-radius-base);
  }

  .depreciation-workbench__mobile-heading {
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: space-between;
  }

  .depreciation-workbench__mobile-facts {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px 16px;
    margin: 0;

    div {
      display: grid;
      gap: 3px;
    }

    dt {
      font-size: 12px;
      color: var(--el-text-color-secondary);
    }

    dd {
      margin: 0;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
  }

  @media (width <= 767px) {
    .depreciation-workbench__controls {
      grid-template-columns: 1fr;
    }
  }
</style>
