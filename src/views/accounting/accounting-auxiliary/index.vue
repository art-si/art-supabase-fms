<template>
  <FinanceAccountingWorkspaceShell
    class="accounting-auxiliary-page"
    hide-master-delete-notice
    :class="{ 'is-focus-mode': focusMode }"
  >
    <MasterDeleteProcessingNotice
      v-if="deleteContext.active"
      :record-rows="referencedItemId ? filteredItems : workspace.types"
      :record-loading="workspace.loading || workspace.itemLoading"
      :record-error="Boolean(workspace.error || workspace.itemError)"
      :action-hint="
        workspace.error
          ? '关联定位未完成，请重新加载或清除定位后返回检查。'
          : workspace.loading
            ? '正在读取关联目标，请稍候。'
            : '请核对关联辅助核算资料，处理完成后返回原页面继续删除。'
      "
    />
    <BusinessWorkspaceHeader
      v-show="!focusMode"
      density="compact"
      eyebrow="财务基础 · 核算维度"
      title="辅助核算"
      description="统一客户、承运商、部门、员工、项目等核算维度，并与现有业务主数据保持同源。"
      icon="ri:git-branch-line"
      :tags="[
        { label: '业务主数据同步', type: 'primary' },
        { label: '租户账套隔离', type: 'success' },
        { label: '维度停用留痕', type: 'info' }
      ]"
      :metrics="metrics"
    >
      <template #actions>
        <BusinessWorkspaceFocusToggle v-model="focusMode" />
      </template>
    </BusinessWorkspaceHeader>

    <ArtSectionCard
      v-show="!focusMode"
      title="核算范围"
      subtitle="客户、承运商、部门和员工以现有业务档案为权威来源"
      class="accounting-workspace-scope-section"
    >
      <div class="accounting-auxiliary-page__scope">
        <span>当前账套</span>
        <ElSelect
          v-model="scope.accountSetId"
          aria-label="当前账套"
          filterable
          :loading="scope.loading"
          :disabled="mutationBusy"
          placeholder="请选择账套"
          @change="handleAccountSetChange"
        >
          <ElOption
            v-for="item in scope.options"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </ElSelect>
      </div>
      <AccountingSetupGuide
        :loading="scope.loading"
        :has-account-set="scope.options.length > 0"
        :can-configure="hasAuth('FinanceAccountSet:Add')"
        @configure="goToAccountSet"
      />
    </ArtSectionCard>

    <div class="accounting-auxiliary-page__workspace" :class="{ 'is-focused': focusMode }">
      <ArtSectionCard
        title="核算维度"
        subtitle="选择维度后查看其核算项目"
        class="accounting-auxiliary-page__types accounting-workspace-fill-section"
        :body-class="[
          'accounting-workspace-content-state',
          { 'is-empty': workspace.types.length === 0 }
        ]"
        :loading="workspace.loading"
        :empty-visual-size="68"
        :min-height="150"
        :error="workspace.error"
        :empty="workspace.types.length === 0"
        empty-title="暂无辅助核算维度"
        empty-description="创建账套时会自动生成客户、承运商、部门、员工和项目维度。"
        @retry="retryWorkspace"
      >
        <template #actions>
          <ArtIconButton
            v-auth="'FinanceAccountingAuxiliary:AddType'"
            icon="ri:add-line"
            label="新增维度"
            :disabled="mutationBusy"
            @click="openTypeDialog()"
          />
        </template>

        <div class="accounting-auxiliary-page__type-list">
          <div
            v-for="item in workspace.types"
            :key="item.id"
            class="accounting-auxiliary-page__type-card"
            :class="{ 'is-active': item.id === workspace.selectedTypeId }"
          >
            <button
              type="button"
              class="accounting-auxiliary-page__type-select"
              :aria-label="`选择核算维度${item.typeName}`"
              :aria-pressed="item.id === workspace.selectedTypeId"
              :disabled="mutationBusy"
              @click="selectType(item.id)"
            >
              <span class="accounting-auxiliary-page__type-icon">
                <ArtSvgIcon :icon="sourceIcon(item.sourceType)" />
              </span>
              <span class="accounting-auxiliary-page__type-content">
                <strong>{{ item.typeName }}</strong>
                <small>{{ item.typeCode }}</small>
              </span>
              <span class="accounting-auxiliary-page__type-meta">
                <span
                  v-if="item.id === workspace.selectedTypeId"
                  class="accounting-auxiliary-page__selected-badge"
                >
                  <ArtSvgIcon icon="ri:check-line" />已选
                </span>
                <ArtDictDisplay
                  v-else
                  dict-code="fmsAuxiliarySourceType"
                  :value="item.sourceType"
                  display="text"
                />
                <ElTag size="small" :type="item.isEnabled ? 'success' : 'info'">
                  {{ item.isEnabled ? '启用' : '停用' }}
                </ElTag>
              </span>
            </button>
            <ArtButtonMore
              trigger="click"
              class="accounting-auxiliary-page__type-more"
              :list="getTypeActions(item)"
              @click="handleTypeAction($event, item)"
            />
          </div>
        </div>
      </ArtSectionCard>

      <ArtSectionCard
        title="核算项目"
        :subtitle="
          selectedType ? `${selectedType.typeName} · ${sourceDescription}` : '请先选择核算维度'
        "
        class="accounting-auxiliary-page__items accounting-workspace-fill-section"
      >
        <template #actions>
          <BusinessWorkspaceFocusToggle v-show="focusMode" v-model="focusMode" />
          <ElButton
            v-if="hasAuth('FinanceAccountingAuxiliary:Sync') && canSync"
            :loading="workspace.syncing"
            :disabled="mutationBusy"
            @click="handleSync"
          >
            <ArtSvgIcon icon="ri:refresh-line" />同步主数据
          </ElButton>
          <ElButton
            v-if="hasAuth('FinanceAccountingAuxiliary:Add') && canMaintainItems"
            type="primary"
            :disabled="mutationBusy"
            @click="openItemDialog()"
          >
            <ArtSvgIcon icon="ri:add-line" />新增项目
          </ElButton>
        </template>

        <ArtSearchBar
          v-model="itemFilterForm"
          class="accounting-auxiliary-page__item-search"
          :items="itemSearchItems"
          :span="8"
          :gutter="12"
          label-position="left"
          label-width="76px"
          :show-expand="false"
          :button-left-limit="0"
          @search="applyItemFilters"
          @reset="resetItemFilters"
        />

        <ArtAsyncState
          class="accounting-workspace-content-state"
          :class="{ 'is-empty': filteredItems.length === 0 }"
          :loading="workspace.loading || workspace.itemLoading"
          :empty-image-size="72"
          :min-height="160"
          :error="workspace.error || workspace.itemError"
          :empty="
            !workspace.loading &&
            !workspace.itemLoading &&
            !workspace.error &&
            !workspace.itemError &&
            filteredItems.length === 0
          "
          empty-text="暂无辅助核算项目"
          :empty-description="
            canSync ? '点击“同步主数据”从现有业务档案生成核算项目。' : '可新增手工核算项目。'
          "
          @retry="workspace.error ? retryWorkspace() : loadItems()"
        >
          <ArtTable
            v-if="
              !workspace.loading &&
              !workspace.itemLoading &&
              !workspace.error &&
              !workspace.itemError
            "
            :border="false"
            :data="filteredItems"
            :columns="columns"
            :pagination="false"
            table-layout="fixed"
            empty-text="暂无辅助核算项目"
          />
        </ArtAsyncState>
      </ArtSectionCard>
    </div>

    <AuxiliaryTypeDialog ref="typeDialogRef" @success="loadWorkspace" />
    <AuxiliaryItemDialog ref="itemDialogRef" @success="loadItems" />
    <MasterDataDeleteGuard ref="deleteGuardRef" />
  </FinanceAccountingWorkspaceShell>
</template>

<script setup lang="tsx">
  import FinanceAccountingWorkspaceShell from '@fms/views/modules/finance-accounting-workspace-shell/index.vue'
  import { useDictionaryOptions } from '@/hooks/core/useDictionaryOptions'
  import { getFriendlySupabaseErrorMessage } from '@/utils/supabase'
  import { ElButton, ElMessage, ElTag } from 'element-plus'
  import BusinessWorkspaceHeader, {
    type BusinessWorkspaceMetric
  } from '@/components/business/business-workspace-header/index.vue'
  import AccountingSetupGuide from '../../modules/accounting-setup-guide.vue'
  import { useFinanceAccountSetPrerequisite } from '../../modules/use-finance-account-set-prerequisite'
  import ArtSectionCard from '@/components/core/surfaces/art-section-card/index.vue'
  import ArtAsyncState from '@/components/core/feedback/art-async-state/index.vue'
  import ArtButtonTable from '@/components/core/forms/art-button-table/index.vue'
  import BusinessTableIdentityCell from '@/components/business/business-table-identity-cell/index.vue'
  import BusinessTableRowActions from '@/components/business/business-table-row-actions/index.vue'
  import ArtButtonMore, {
    type ButtonMoreItem
  } from '@/components/core/forms/art-button-more/index.vue'
  import ArtSearchBar, {
    type SearchFormItem
  } from '@/components/core/forms/art-search-bar/index.vue'
  import ArtDictDisplay from '@/components/core/base/art-dict-display/index.vue'
  import type { ColumnOption } from '@/types'
  import { notifyFriendlyError, useArtFeedback } from '@/hooks/core/useArtFeedback'
  import MasterDataDeleteGuard from '@/components/business/master-data-delete-guard/index.vue'
  import MasterDeleteProcessingNotice from '@/components/business/master-delete-processing-notice/index.vue'
  import { useMasterDataDeleteProcessingContext } from '@/hooks/core/useMasterDataDeleteProcessing'
  import { useRecordDeleteGuard } from '@/hooks/core/useRecordDeleteGuard'
  import { useAuth } from '@/hooks/core/useAuth'
  import { useUserStore } from '@/store/modules/user'
  import {
    deleteAuxiliaryType,
    fetchAccountSetOptions,
    fetchAuxiliaryItemList,
    fetchAuxiliaryTypeDetail,
    fetchAuxiliaryTypeList,
    setAuxiliaryItemEnabled,
    syncAuxiliaryItems
  } from '@fms/api'
  import BusinessWorkspaceFocusToggle from '@/components/business/business-workspace-focus-toggle/index.vue'
  import ArtIconButton from '@/components/core/widget/art-icon-button/index.vue'
  import { useWorkspaceFocus } from '@/hooks/core/useWorkspaceFocus'
  import AuxiliaryTypeDialog from './modules/auxiliary-type-dialog.vue'
  import AuxiliaryItemDialog from './modules/auxiliary-item-dialog.vue'

  const commonEnabledStatusOptions = useDictionaryOptions(
    'commonEnabledStatus',
    (value) => value === 'enabled'
  )

  defineOptions({ name: 'FinanceAccountingAuxiliary' })

  type AuxiliaryType = Api.Fms.AuxiliaryTypeRecord
  type AuxiliaryItem = Api.Fms.AuxiliaryItemRecord

  interface ScopeGroup {
    accountSetId: string
    loading: boolean
    options: Api.Fms.AccountSetOption[]
  }

  interface WorkspaceGroup {
    loading: boolean
    error: string
    types: AuxiliaryType[]
    selectedTypeId: string
    itemLoading: boolean
    itemError: string
    items: AuxiliaryItem[]
    syncing: boolean
    toggling: boolean
  }

  interface ItemFilter extends Record<string, unknown> {
    keyword: string
    enabled?: boolean
  }

  interface AuxiliaryTypeDialogExpose {
    handleOpen: (accountSet: Api.Fms.AccountSetOption, row?: AuxiliaryType) => Promise<void>
  }

  interface AuxiliaryItemDialogExpose {
    handleOpen: (
      accountSet: Api.Fms.AccountSetOption,
      type: AuxiliaryType,
      row?: AuxiliaryItem
    ) => Promise<void>
  }

  const { confirmAction } = useArtFeedback()
  const { deleteGuardRef, deleteRecord, deleteBusy } = useRecordDeleteGuard(
    'fms_auxiliary_type',
    '辅助核算维度'
  )
  const { focusMode } = useWorkspaceFocus()
  const { ensureAccountSet, goToAccountSet } = useFinanceAccountSetPrerequisite()
  const { hasAuth } = useAuth()
  const route = useRoute()
  const deleteContext = useMasterDataDeleteProcessingContext()
  const navigationReady = ref(false)
  let referenceRequestId = 0
  const referencedItemId = computed(() =>
    deleteContext.value.active && route.query.dependencyCode === 'fms_auxiliary_item'
      ? deleteContext.value.recordId
      : ''
  )
  const referencedTypeId = computed(() => {
    if (!deleteContext.value.active) return ''
    if (route.query.dependencyCode === 'fms_auxiliary_type') return deleteContext.value.recordId
    return typeof route.query.referencedRecordId === 'string' ? route.query.referencedRecordId : ''
  })
  const userStore = useUserStore()
  const typeDialogRef = ref<AuxiliaryTypeDialogExpose>()
  const itemDialogRef = ref<AuxiliaryItemDialogExpose>()
  const scope = reactive<ScopeGroup>({ accountSetId: '', loading: true, options: [] })
  const workspace = reactive<WorkspaceGroup>({
    loading: false,
    error: '',
    types: [],
    selectedTypeId: '',
    itemLoading: false,
    itemError: '',
    items: [],
    syncing: false,
    toggling: false
  })
  const mutationBusy = computed(() => deleteBusy.value || workspace.syncing || workspace.toggling)
  const itemFilterForm = ref<ItemFilter>(createDefaultItemFilter())
  const appliedItemFilter = reactive<ItemFilter>(createDefaultItemFilter())
  const itemSearchItems: SearchFormItem[] = [
    {
      label: '核算项目',
      key: 'keyword',
      type: 'input',
      props: { clearable: true, placeholder: '搜索项目编码或名称' }
    },
    {
      label: '项目状态',
      key: 'enabled',
      type: 'select',
      props: {
        clearable: true,
        placeholder: '全部状态',
        options: commonEnabledStatusOptions
      }
    }
  ]

  const currentAccountSet = computed(() =>
    scope.options.find((item) => item.value === scope.accountSetId)
  )
  const selectedType = computed(() =>
    workspace.types.find((item) => item.id === workspace.selectedTypeId)
  )
  const canSync = computed(
    () =>
      Boolean(selectedType.value) &&
      !['manual', 'project'].includes(selectedType.value?.sourceType ?? '')
  )
  const canMaintainItems = computed(
    () =>
      Boolean(selectedType.value) &&
      ['manual', 'project'].includes(selectedType.value?.sourceType ?? '')
  )
  const sourceDescription = computed(() =>
    canSync.value ? '由业务主数据同步，名称和状态以源档案为准' : '由财务手工维护'
  )
  const filteredItems = computed(() => {
    const keyword = appliedItemFilter.keyword.trim().toLowerCase()
    return workspace.items.filter((item) => {
      if (referencedItemId.value && item.id !== referencedItemId.value) return false
      const matched =
        !keyword ||
        item.itemCode.toLowerCase().includes(keyword) ||
        item.itemName.toLowerCase().includes(keyword)
      return (
        matched &&
        (appliedItemFilter.enabled === undefined || item.isEnabled === appliedItemFilter.enabled)
      )
    })
  })

  const metrics = computed<BusinessWorkspaceMetric[]>(() => [
    {
      key: 'types',
      label: '核算维度',
      value: workspace.types.length,
      description: '当前账套维度数量',
      icon: 'ri:git-branch-line'
    },
    {
      key: 'items',
      label: '核算项目',
      value: workspace.items.length,
      description: selectedType.value?.typeName ?? '请选择核算维度',
      icon: 'ri:list-check-3',
      tone: 'success'
    },
    {
      key: 'enabled',
      label: '启用项目',
      value: workspace.items.filter((item) => item.isEnabled).length,
      description: '可用于凭证和期初余额',
      icon: 'ri:checkbox-circle-line',
      tone: 'warning'
    },
    {
      key: 'linked',
      label: '业务关联',
      value: workspace.items.filter((item) => item.externalEntityId).length,
      description: '与业务主数据保持同源',
      icon: 'ri:links-line',
      tone: 'info'
    }
  ])

  const columns: ColumnOption<AuxiliaryItem>[] = [
    {
      prop: 'itemName',
      label: '核算项目',
      minWidth: 220,
      formatter: (row) => (
        <BusinessTableIdentityCell
          primary={row.itemName}
          secondary={row.itemCode}
          icon="ri:node-tree"
        />
      )
    },
    {
      prop: 'externalEntityId',
      label: '数据来源',
      width: 104,
      formatter: (row) => (
        <ElTag type={row.externalEntityId ? 'primary' : 'info'}>
          {row.externalEntityId ? '业务同步' : '手工维护'}
        </ElTag>
      )
    },
    { prop: 'sort', label: '排序', width: 64, align: 'center' },
    {
      prop: 'isEnabled',
      label: '状态',
      width: 76,
      dict: {
        code: 'commonEnabledStatus',
        display: 'tag',
        value: (row) => (row.isEnabled ? 'enabled' : 'disabled')
      }
    },
    {
      prop: 'operation',
      label: '操作',
      width: 104,
      fixed: 'right',
      formatter: (row) => {
        if (row.externalEntityId) return <span title="请在对应的业务主数据中维护">—</span>
        return (
          <BusinessTableRowActions>
            <ArtButtonTable
              type="edit"
              permission="FinanceAccountingAuxiliary:Edit"
              label="编辑核算项目"
              disabled={mutationBusy.value}
              onClick={() => openItemDialog(row)}
            />
            <ArtButtonTable
              type="sign"
              icon={row.isEnabled ? 'ri:forbid-line' : 'ri:checkbox-circle-line'}
              iconColor={row.isEnabled ? 'var(--el-color-danger)' : undefined}
              buttonBgColor={row.isEnabled ? 'var(--el-color-danger-light-9)' : undefined}
              permission="FinanceAccountingAuxiliary:Toggle"
              label={row.isEnabled ? '停用核算项目' : '启用核算项目'}
              disabled={mutationBusy.value}
              onClick={() => toggleItem(row)}
            />
          </BusinessTableRowActions>
        )
      }
    }
  ]

  function sourceIcon(sourceType: Api.Fms.AuxiliarySourceType): string {
    return {
      manual: 'ri:edit-line',
      customer: 'ri:user-star-line',
      carrier: 'ri:truck-line',
      department: 'ri:organization-chart',
      employee: 'ri:team-line',
      project: 'ri:briefcase-4-line'
    }[sourceType]
  }

  function createDefaultItemFilter(): ItemFilter {
    return { keyword: '', enabled: undefined }
  }

  function getTypeActions(row: AuxiliaryType): ButtonMoreItem[] {
    const actions: ButtonMoreItem[] = [
      {
        key: 'edit',
        label: '编辑维度',
        icon: 'ri:edit-line',
        auth: 'FinanceAccountingAuxiliary:EditType',
        disabled: mutationBusy.value
      }
    ]
    if (!row.isSystem && row.sourceType === 'manual') {
      actions.push({
        key: 'delete',
        label: '删除维度',
        icon: 'ri:delete-bin-line',
        color: 'var(--el-color-danger)',
        auth: 'FinanceAccountingAuxiliary:DeleteType',
        disabled: mutationBusy.value
      })
    }
    return actions
  }

  function handleTypeAction(action: ButtonMoreItem, row: AuxiliaryType): void {
    if (mutationBusy.value) return
    if (action.key === 'edit') {
      void openTypeDialog(row)
      return
    }
    if (action.key === 'delete') void handleDeleteType(row)
  }

  function applyItemFilters(params: Record<string, unknown>): void {
    appliedItemFilter.keyword = typeof params.keyword === 'string' ? params.keyword : ''
    appliedItemFilter.enabled = typeof params.enabled === 'boolean' ? params.enabled : undefined
  }

  function resetItemFilters(): void {
    itemFilterForm.value = createDefaultItemFilter()
    Object.assign(appliedItemFilter, createDefaultItemFilter())
  }

  let itemRequestId = 0
  let workspaceRequestId = 0

  async function loadItems(): Promise<void> {
    const requestId = ++itemRequestId
    const accountSetId = scope.accountSetId
    const typeId = workspace.selectedTypeId
    const isCurrent = () =>
      requestId === itemRequestId &&
      accountSetId === scope.accountSetId &&
      typeId === workspace.selectedTypeId
    if (!accountSetId || !typeId) {
      workspace.items = []
      workspace.itemLoading = false
      workspace.itemError = ''
      return
    }
    workspace.itemLoading = true
    workspace.itemError = ''
    try {
      const result = await fetchAuxiliaryItemList(accountSetId, typeId)
      if (!isCurrent()) return
      if (result.error) throw result.error
      workspace.items = result.data ?? []
    } catch (error) {
      if (!isCurrent()) return
      workspace.itemError = getFriendlySupabaseErrorMessage(error, '辅助核算项目加载失败')
    } finally {
      if (isCurrent()) workspace.itemLoading = false
    }
  }

  async function loadWorkspace(): Promise<void> {
    const requestId = ++workspaceRequestId
    const accountSetId = scope.accountSetId
    const isCurrent = () => requestId === workspaceRequestId && accountSetId === scope.accountSetId
    if (!accountSetId) return
    workspace.loading = true
    workspace.error = ''
    try {
      await userStore.ensureDictLoaded('fmsAuxiliarySourceType')
      if (!isCurrent()) return
      const result = await fetchAuxiliaryTypeList(accountSetId)
      if (!isCurrent()) return
      if (result.error) throw result.error
      workspace.types = result.data ?? []
      if (!workspace.types.some((item) => item.id === workspace.selectedTypeId)) {
        workspace.selectedTypeId = workspace.types[0]?.id ?? ''
      }
      await loadItems()
    } catch (error) {
      if (!isCurrent()) return
      workspace.error = getFriendlySupabaseErrorMessage(error, '辅助核算维度加载失败')
    } finally {
      if (isCurrent()) workspace.loading = false
    }
  }

  function selectType(id: string): void {
    if (mutationBusy.value) return
    workspace.selectedTypeId = id
    resetItemFilters()
    void loadItems()
  }

  function handleAccountSetChange(): void {
    Object.assign(workspace, { selectedTypeId: '', items: [] })
    resetItemFilters()
    void loadWorkspace()
  }

  async function openTypeDialog(row?: AuxiliaryType): Promise<void> {
    if (mutationBusy.value) return
    if (
      !(await ensureAccountSet({
        actionLabel: row ? '编辑核算维度' : '新增核算维度',
        available: Boolean(currentAccountSet.value)
      }))
    )
      return
    await typeDialogRef.value?.handleOpen(currentAccountSet.value!, row)
  }

  async function handleDeleteType(row: AuxiliaryType): Promise<void> {
    if (mutationBusy.value || row.isSystem || row.sourceType !== 'manual') return
    await deleteRecord({
      resource: { id: row.id, label: row.typeName },
      permission: 'FinanceAccountingAuxiliary:DeleteType',
      confirmMessage: `确定删除手工维度“${row.typeName}（${row.typeCode}）”吗？仅未被会计科目和核算项目引用的维度可以删除。`,
      remove: () => deleteAuxiliaryType(row.id),
      onDeleted: loadWorkspace,
      failureMessage: '核算维度删除失败，请检查引用关系后重试'
    })
  }

  async function openItemDialog(row?: AuxiliaryItem): Promise<void> {
    if (mutationBusy.value) return
    if (!currentAccountSet.value || !selectedType.value) return
    await itemDialogRef.value?.handleOpen(currentAccountSet.value, selectedType.value, row)
  }

  async function handleSync(): Promise<void> {
    if (mutationBusy.value || !selectedType.value || !canSync.value) return
    if (!hasAuth('FinanceAccountingAuxiliary:Sync')) {
      ElMessage.warning('辅助核算同步权限已变化，请刷新页面后重试')
      return
    }
    const accountSetId = scope.accountSetId
    const typeId = selectedType.value.id
    workspace.syncing = true
    try {
      await syncAuxiliaryItems(accountSetId, typeId)
      await loadItems()
    } catch (error) {
      notifyFriendlyError(error, '辅助核算项目同步失败，请重试')
    } finally {
      workspace.syncing = false
    }
  }

  async function toggleItem(row: AuxiliaryItem): Promise<void> {
    if (mutationBusy.value || row.externalEntityId) return
    if (!hasAuth('FinanceAccountingAuxiliary:Toggle')) {
      ElMessage.warning('核算项目启停权限已变化，请刷新页面后重试')
      return
    }
    workspace.toggling = true
    try {
      await confirmAction(
        `确定${row.isEnabled ? '停用' : '启用'}项目“${row.itemCode} ${row.itemName}”吗？`,
        `${row.isEnabled ? '停用' : '启用'}辅助核算项目`
      )
      if (!hasAuth('FinanceAccountingAuxiliary:Toggle')) {
        ElMessage.warning('核算项目启停权限已变化，请刷新页面后重试')
        return
      }
      await setAuxiliaryItemEnabled(row.id, !row.isEnabled)
      await loadItems()
    } catch (error) {
      if (error === 'cancel' || error === 'close') return
      notifyFriendlyError(error, '辅助核算项目状态更新失败，请重试')
    } finally {
      workspace.toggling = false
    }
  }

  async function loadAccountSets(): Promise<void> {
    scope.loading = true
    try {
      const result = await fetchAccountSetOptions({ from: 0, to: 999 })
      scope.options = result.data ?? []
      if (!scope.accountSetId && scope.options.length) {
        scope.accountSetId = scope.options[0].value
        if (!(await locateReferencedItem())) await loadWorkspace()
      }
    } finally {
      scope.loading = false
      navigationReady.value = true
    }
  }

  async function locateReferencedItem(): Promise<boolean> {
    if (!deleteContext.value.active) return false
    Object.assign(workspace, {
      loading: true,
      error: '',
      types: [],
      selectedTypeId: '',
      itemLoading: true,
      itemError: '',
      items: []
    })
    const typeId = referencedTypeId.value
    if (!typeId) {
      Object.assign(workspace, {
        loading: false,
        itemLoading: false,
        error: '关联定位信息不完整，请返回后重新检查',
        itemError: '关联定位信息不完整，请返回后重新检查'
      })
      return true
    }
    const requestId = ++referenceRequestId
    const recordId = deleteContext.value.recordId
    const isCurrent = () =>
      requestId === referenceRequestId &&
      deleteContext.value.active &&
      recordId === deleteContext.value.recordId &&
      typeId === referencedTypeId.value
    try {
      const { data, error } = await fetchAuxiliaryTypeDetail(typeId)
      if (!isCurrent()) return true
      if (error) throw error
      if (!data || !scope.options.some((item) => item.value === data.accountSetId)) {
        throw new Error('关联维度已不存在或当前账号无法访问，请返回后重新检查')
      }
      scope.accountSetId = data.accountSetId
      workspace.selectedTypeId = data.id
      resetItemFilters()
      await loadWorkspace()
    } catch (error) {
      if (isCurrent()) {
        const message = getFriendlySupabaseErrorMessage(error, '关联项目定位失败，请重新加载')
        Object.assign(workspace, { error: message, itemError: message })
      }
    } finally {
      if (isCurrent()) Object.assign(workspace, { loading: false, itemLoading: false })
    }
    return true
  }

  async function retryWorkspace(): Promise<void> {
    if (!(await locateReferencedItem())) await loadWorkspace()
  }

  watch(
    [() => deleteContext.value.active, referencedTypeId, referencedItemId],
    () => {
      if (!navigationReady.value) return
      if (deleteContext.value.active) void locateReferencedItem()
      else {
        referenceRequestId += 1
        resetItemFilters()
        void loadWorkspace()
      }
    },
    { flush: 'post' }
  )

  onMounted(loadAccountSets)
</script>

<style scoped lang="scss">
  .accounting-auxiliary-page {
    height: var(--art-full-height);
    min-height: var(--art-full-height);

    &.is-focus-mode {
      gap: 0;
    }

    &__scope {
      display: flex;
      flex-direction: column;
      gap: 6px;
      align-items: stretch;
      max-width: 560px;
      margin-top: var(--art-space-4);

      > span {
        flex: none;
        font-size: 12px;
        font-weight: 600;
        line-height: 18px;
        color: var(--el-text-color-regular);
      }

      :deep(.el-select) {
        flex: 1;
      }
    }

    &__workspace {
      display: grid;
      flex: 1;
      grid-template-rows: minmax(0, 1fr);
      grid-template-columns: minmax(300px, 340px) minmax(0, 1fr);
      gap: 12px;
      min-height: 360px;

      &.is-focused {
        height: 100%;
      }
    }

    &__types,
    &__items {
      min-width: 0;
      min-height: 0;
    }

    &__type-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    &__type-card {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 4px;
      align-items: center;
      width: 100%;
      padding: 6px;
      color: var(--el-text-color-primary);
      text-align: left;
      background: var(--art-gray-100);
      border: 1px solid var(--el-border-color-lighter);
      border-radius: var(--el-border-radius-base);
      transition:
        color 0.18s ease,
        background-color 0.18s ease,
        border-color 0.18s ease,
        box-shadow 0.18s ease;

      &:hover,
      &:focus-within,
      &.is-active {
        color: var(--theme-color);
        outline: none;
        background: color-mix(in srgb, var(--theme-color) 11%, var(--art-gray-100));
      }

      &.is-active {
        border-color: color-mix(in srgb, var(--theme-color) 62%, var(--el-border-color));
        box-shadow: inset 3px 0 0 var(--theme-color);
      }
    }

    &__type-select {
      display: grid;
      grid-template-columns: 40px minmax(0, 1fr) auto;
      gap: 10px;
      align-items: center;
      min-width: 0;
      padding: 4px 2px 4px 4px;
      color: inherit;
      text-align: left;
      touch-action: manipulation;
      cursor: pointer;
      background: transparent;
      border: 0;
      border-radius: var(--el-border-radius-small);

      &:focus-visible {
        outline: 2px solid color-mix(in srgb, var(--theme-color) 55%, transparent);
        outline-offset: 1px;
      }
    }

    &__type-icon {
      display: grid;
      place-items: center;
      width: 40px;
      height: 40px;
      font-size: 20px;
      color: var(--theme-color);
      background: color-mix(in srgb, var(--theme-color) 10%, transparent);
      border-radius: var(--el-border-radius-base);
    }

    &__type-card.is-active &__type-icon {
      color: #fff;
      background: var(--theme-color);
    }

    &__type-content,
    &__type-meta {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    &__type-content {
      gap: 3px;

      strong,
      small {
        overflow-wrap: anywhere;
        white-space: normal;
      }

      small {
        color: var(--el-text-color-secondary);
      }
    }

    &__type-meta {
      gap: 5px;
      align-items: flex-end;
      font-size: 12px;
      white-space: nowrap;
    }

    &__selected-badge {
      display: inline-flex;
      gap: 3px;
      align-items: center;
      font-weight: 650;
      color: var(--theme-color);
      white-space: nowrap;
    }

    &__type-more {
      flex: none;
    }

    &__item-search {
      margin-bottom: 12px;
    }
  }

  @media only screen and (width <= 980px) {
    .accounting-auxiliary-page {
      height: auto;
      min-height: var(--art-full-height);

      &__workspace {
        flex: none;
        grid-template-rows: 360px minmax(460px, auto);
        grid-template-columns: 1fr;

        &.is-focused {
          height: auto;
        }
      }
    }
  }

  @media only screen and (width <= 640px) {
    .accounting-auxiliary-page {
      &__scope {
        flex-direction: column;
        align-items: stretch;

        :deep(.el-select) {
          width: 100%;
        }
      }
    }
  }

  :global(html[data-box-mode='border-mode'] .accounting-auxiliary-page__type-card:hover),
  :global(html[data-box-mode='border-mode'] .accounting-auxiliary-page__type-card:focus-within),
  :global(html[data-box-mode='border-mode'] .accounting-auxiliary-page__type-card.is-active) {
    border-color: color-mix(in srgb, var(--theme-color) 55%, var(--el-border-color));
    box-shadow:
      inset 3px 0 0 var(--theme-color),
      inset 0 0 0 1px color-mix(in srgb, var(--theme-color) 20%, transparent);
  }

  :global(html[data-box-mode='shadow-mode'] .accounting-auxiliary-page__type-card:hover),
  :global(html[data-box-mode='shadow-mode'] .accounting-auxiliary-page__type-card:focus-within),
  :global(html[data-box-mode='shadow-mode'] .accounting-auxiliary-page__type-card.is-active) {
    border-color: transparent;
    box-shadow:
      inset 3px 0 0 var(--theme-color),
      0 8px 20px color-mix(in srgb, var(--theme-color) 16%, transparent);
  }
</style>
