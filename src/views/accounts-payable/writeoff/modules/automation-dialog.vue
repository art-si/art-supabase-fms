<template>
  <ArtDialog ref="dialog" title="后台应付核销管理" size="xl" :show-footer="false">
    <ElAlert
      title="启用后将按启用人员的当前权限处理；修改配置会取消旧版本待执行任务。已有处理历史的配置只能停用。"
      type="info"
      :closable="false"
      class="mb-4"
    />
    <ArtAsyncState :loading="loading" :error="error" @retry="load">
      <template v-if="workspace">
        <ElAlert
          v-if="!workspace.runtime.available"
          title="后台调度尚未就绪，可先保存停用配置。"
          type="warning"
          :closable="false"
          class="mb-4"
        />
        <div class="mb-4 flex flex-wrap justify-end gap-2">
          <ElButton
            v-auth="'FinancePayableWriteoff:Automation'"
            type="primary"
            :disabled="busy"
            @click="edit()"
            >新增后台配置</ElButton
          >
          <ElButton :disabled="busy" @click="load">刷新记录</ElButton>
        </div>
        <ElTabs v-model="tab">
          <ElTabPane label="后台配置" name="configurations">
            <ArtTable
              :data="workspace.configurations.data"
              :columns="configurationColumns"
              :pagination="{
                current: configurationPage,
                size: pageSize,
                total: workspace.configurations.total
              }"
              @pagination:current-change="changeConfigurationPage"
              @pagination:size-change="changePageSize"
            >
              <template #enabled="{ row }"
                ><ArtDictDisplay dict-code="commonBoolean" :value="String(row.enabled)"
              /></template>
              <template #operation="{ row }"
                ><BusinessTableRowActions>
                  <ArtButtonTable
                    type="edit"
                    permission="FinancePayableWriteoff:Automation"
                    :disabled="busy"
                    @click="edit(row)"
                  />
                  <ArtButtonTable
                    type="delete"
                    permission="FinancePayableWriteoff:AutomationDelete"
                    :disabled="busy"
                    @click="remove(row)"
                  /> </BusinessTableRowActions
              ></template>
            </ArtTable>
          </ElTabPane>
          <ElTabPane label="处理任务" name="jobs">
            <ArtTable
              :data="workspace.jobs.data"
              :columns="jobColumns"
              :pagination="{ current: jobPage, size: pageSize, total: workspace.jobs.total }"
              @pagination:current-change="changeJobPage"
              @pagination:size-change="changePageSize"
            >
              <template #operation="{ row }"
                ><BusinessTableRowActions>
                  <ElButton
                    v-auth="'FinancePayableWriteoff:View'"
                    link
                    type="primary"
                    :disabled="busy"
                    @click="showRecords(row)"
                    >核销记录</ElButton
                  >
                  <ElButton
                    v-auth="'FinancePayableWriteoff:AutomationRetry'"
                    link
                    type="warning"
                    :disabled="busy || !canRetry(row)"
                    @click="retry(row)"
                    >重试任务</ElButton
                  >
                </BusinessTableRowActions></template
              >
            </ArtTable>
          </ElTabPane>
        </ElTabs>
      </template>
    </ArtAsyncState>
  </ArtDialog>
  <ArtDialog ref="editor" size="lg">
    <ElAlert
      title="默认保存为停用配置；启用会授权后台按当前人员权限核销，补处理已有余额须单独选择。"
      type="warning"
      :closable="false"
      class="mb-4"
    />
    <ArtForm
      ref="form"
      v-model="model"
      :items="items"
      :rules="rules"
      :show-submit="false"
      :show-reset="false"
      label-position="top"
    />
  </ArtDialog>
  <ArtDialog ref="recordsDialog" title="后台任务生成记录" size="lg" :show-footer="false">
    <ArtTableQuery
      :key="selectedJobId"
      :api-fn="loadRecords"
      :columns-factory="() => recordColumns"
      :header-actions="[]"
    />
  </ArtDialog>
  <MasterDataDeleteGuard ref="deleteGuard" />
</template>

<script setup lang="ts">
  import { computed, onMounted, ref, unref, watch } from 'vue'
  import { useRoute } from 'vue-router'
  import { ElMessage } from 'element-plus'
  import ArtDialog from '@/components/core/dialogs/art-dialog/index.vue'
  import type { ArtDialogExpose } from '@/components/core/dialogs/art-dialog/types'
  import ArtForm, { type FormItem } from '@/components/core/forms/art-form/index.vue'
  import ArtTable from '@/components/core/tables/art-table/index.vue'
  import ArtTableQuery from '@/components/core/tables/art-table-query/index.vue'
  import BusinessTableRowActions from '@/components/business/business-table-row-actions/index.vue'
  import MasterDataDeleteGuard from '@/components/business/master-data-delete-guard/index.vue'
  import { useArtOverlaySession } from '@/hooks/core/useArtOverlay'
  import { useAuth } from '@/hooks/core/useAuth'
  import { useArtFeedback, notifyFriendlyError } from '@/hooks/core/useArtFeedback'
  import { useDictionaryOptions } from '@/hooks/core/useDictionaryOptions'
  import { useTenantScopeStore } from '@/store/modules/tenant-scope'
  import { validateArtFormForSubmit } from '@/utils/form/validate-art-form'
  import { financePaths } from '@/router/business-paths'
  import type { ColumnOption } from '@/types'
  import {
    fetchPayableAutomationWorkspace,
    savePayableAutomation,
    deletePayableAutomation,
    fetchPayableAutomationDeleteDependencies,
    retryPayableAutomationJob,
    fetchPayableAutomationRecords,
    type PayableAutomationWorkspace,
    type PayableAutomationConfiguration,
    type PayableAutomationJob,
    type PayableAutomationInput,
    type PayableAutomationRecord
  } from '@/api/payable-automation'

  const dialog = ref<ArtDialogExpose>()
  const editor = ref<ArtDialogExpose>()
  const recordsDialog = ref<ArtDialogExpose>()
  const form = ref<InstanceType<typeof ArtForm>>()
  const deleteGuard = ref<InstanceType<typeof MasterDataDeleteGuard>>()
  const session = useArtOverlaySession(() => Boolean(unref(dialog.value?.visible)))
  const { hasAuth } = useAuth()
  const { confirmAction, confirmDelete } = useArtFeedback()
  const tenantScope = useTenantScopeStore()
  const route = useRoute()
  const loading = ref(false)
  const busy = ref(false)
  const error = ref('')
  const workspace = ref<PayableAutomationWorkspace>()
  const configurationPage = ref(1)
  const jobPage = ref(1)
  const pageSize = ref(20)
  const tab = ref('configurations')
  const selectedJobId = ref('')
  const model = ref<PayableAutomationInput>(emptyModel())
  const yesNo = useDictionaryOptions('commonBoolean', (value) => value === 'true')
  const currencyModes = useDictionaryOptions('fmsPayableAutoCurrencyMode')
  function emptyModel(): PayableAutomationInput {
    return {
      name: '',
      schemeId: '',
      accountSetId: '',
      expectedSchemeVersion: 0,
      enabled: false,
      relations: [],
      allowCrossParty: false,
      crossCurrencyMode: 'same_currency',
      processExisting: false
    }
  }
  const items = computed<FormItem[]>(() => {
    const scheme = workspace.value?.schemes.find((row) => row.id === model.value.schemeId)
    return [
      { key: 'name', label: '配置名称', type: 'input', span: 24, props: { maxlength: 100 } },
      {
        key: 'schemeId',
        label: '核销方案',
        type: 'select',
        span: 12,
        props: {
          options: workspace.value?.schemes.map((row) => ({ label: row.name, value: row.id })),
          disabled: Boolean(model.value.id && editingJobCount.value)
        }
      },
      {
        key: 'accountSetId',
        label: '核算账套',
        type: 'select',
        span: 12,
        props: {
          options: workspace.value?.books
            .filter((row) => row.tenantId === scheme?.tenantId)
            .map((row) => ({ label: row.name, value: row.id })),
          disabled: Boolean(model.value.id && editingJobCount.value)
        }
      },
      {
        key: 'relations',
        label: '核销关系',
        type: 'checkboxGroup',
        span: 24,
        props: { options: workspace.value?.relations ?? [] }
      },
      {
        key: 'crossCurrencyMode',
        label: '异币分配',
        type: 'select',
        span: 12,
        props: { options: currencyModes }
      },
      {
        key: 'allowCrossParty',
        label: '允许跨往来单位',
        type: 'radioGroup',
        span: 12,
        props: { options: yesNo, optionType: 'button' }
      },
      {
        key: 'enabled',
        label: '启用后台处理',
        type: 'radioGroup',
        span: 12,
        props: { options: yesNo, optionType: 'button' }
      },
      {
        key: 'processExisting',
        label: '补处理已有余额',
        type: 'radioGroup',
        span: 12,
        props: { options: yesNo, optionType: 'button', disabled: !model.value.enabled }
      }
    ]
  })
  const editingJobCount = ref(0)
  const rules = {
    name: [{ required: true, message: '请填写配置名称', trigger: 'blur' }],
    schemeId: [{ required: true, message: '请选择核销方案', trigger: 'change' }],
    accountSetId: [{ required: true, message: '请选择同租户账套', trigger: 'change' }],
    relations: [
      {
        type: 'array' as const,
        required: true,
        min: 1,
        message: '请选择核销关系',
        trigger: 'change'
      }
    ]
  }
  const configurationColumns: ColumnOption<PayableAutomationConfiguration>[] = [
    { prop: 'name', label: '配置名称', minWidth: 200 },
    { prop: 'schemeName', label: '方案', minWidth: 160 },
    { prop: 'accountSetName', label: '账套', minWidth: 160 },
    { prop: 'enabled', label: '启用', width: 90, useSlot: true },
    { prop: 'actorName', label: '执行人员', minWidth: 130 },
    { prop: 'version', label: '版本', width: 80 },
    { prop: 'pauseReason', label: '暂停原因', minWidth: 220 },
    { prop: 'jobCount', label: '任务数', width: 90 },
    { prop: 'operation', label: '操作', width: 110, fixed: 'right', useSlot: true }
  ]
  const jobColumns: ColumnOption<PayableAutomationJob>[] = [
    { prop: 'jobNo', label: '任务编号', minWidth: 180 },
    { prop: 'automationName', label: '配置', minWidth: 160 },
    { prop: 'sourceDocumentNo', label: '来源单据', minWidth: 180 },
    { prop: 'status', label: '状态', width: 120, dict: { code: 'fmsPayableAutomationJobStatus' } },
    { prop: 'message', label: '处理说明', minWidth: 240 },
    { prop: 'attemptCount', label: '尝试次数', width: 110 },
    { prop: 'recordCount', label: '生成记录', width: 110 },
    { prop: 'operation', label: '操作', width: 190, fixed: 'right', useSlot: true }
  ]
  const recordColumns: ColumnOption<PayableAutomationRecord>[] = [
    { prop: 'recordNo', label: '核销编号', minWidth: 200 },
    { prop: 'documentNo', label: '核销单据', minWidth: 200 },
    { prop: 'writeoffDate', label: '核销日期', width: 130 },
    { prop: 'status', label: '状态', width: 110, dict: { code: 'fmsPayableWriteoffRecordStatus' } },
    { prop: 'voucherNo', label: '凭证编号', minWidth: 180 }
  ]
  async function load() {
    if (loading.value || !session.isCurrent(session.version.value)) return
    const version = session.version.value
    loading.value = true
    error.value = ''
    try {
      const data = await fetchPayableAutomationWorkspace({
        configurationPage: configurationPage.value,
        jobPage: jobPage.value,
        size: pageSize.value,
        tenantId: tenantScope.effectiveTenantId,
        automationId:
          typeof route.query.automationId === 'string' ? route.query.automationId : undefined,
        jobId: typeof route.query.jobId === 'string' ? route.query.jobId : undefined
      })
      if (session.isCurrent(version)) workspace.value = data
    } catch (cause) {
      if (session.isCurrent(version)) {
        error.value = '后台核销资料未加载，请重试'
        notifyFriendlyError(cause, error.value)
      }
    } finally {
      if (session.isCurrent(version)) loading.value = false
    }
  }
  async function handleOpen() {
    if (!hasAuth('FinancePayableWriteoff:View') && !hasAuth('FinancePayableWriteoff:Automation'))
      return
    session.invalidate()
    loading.value = false
    configurationPage.value = 1
    jobPage.value = 1
    tab.value = route.query.jobId ? 'jobs' : 'configurations'
    await dialog.value?.handleOpen(undefined, {
      onClose: () => {
        session.invalidate()
        void editor.value?.handleClose()
        void recordsDialog.value?.handleClose()
        return true
      }
    })
    await load()
  }
  async function edit(row?: PayableAutomationConfiguration) {
    if (busy.value || !workspace.value || !hasAuth('FinancePayableWriteoff:Automation')) return
    editingJobCount.value = row?.jobCount ?? 0
    model.value = row
      ? {
          id: row.id,
          version: row.version,
          name: row.name,
          schemeId: row.schemeId,
          expectedSchemeVersion: row.schemeVersion,
          accountSetId: row.accountSetId,
          enabled: row.enabled,
          relations: [...row.relations],
          allowCrossParty: row.allowCrossParty,
          crossCurrencyMode: row.crossCurrencyMode,
          processExisting: false
        }
      : emptyModel()
    const version = session.version.value
    await editor.value?.handleOpen(undefined, {
      title: row ? '编辑后台核销配置' : '新增后台核销配置',
      confirmText: '保存配置',
      onOpen: () => form.value?.clearValidate(),
      onConfirm: async () => {
        if (
          !session.isCurrent(version) ||
          !hasAuth('FinancePayableWriteoff:Automation') ||
          !(await validateArtFormForSubmit(form.value))
        )
          return false
        const scheme = workspace.value?.schemes.find((item) => item.id === model.value.schemeId)
        if (
          !scheme ||
          !workspace.value?.books.some(
            (book) => book.id === model.value.accountSetId && book.tenantId === scheme.tenantId
          )
        ) {
          ElMessage.warning('方案和账套必须属于同一租户，请重新选择')
          return false
        }
        if (model.value.enabled) {
          try {
            await confirmAction(
              model.value.processExisting
                ? '将启用后台核销并补处理已有余额，可能产生实际核销记录。'
                : '将按你当前的业务权限启用后台核销。',
              '启用后台核销'
            )
          } catch {
            return false
          }
        }
        if (!session.isCurrent(version)) return false
        busy.value = true
        try {
          await savePayableAutomation({
            ...model.value,
            expectedSchemeVersion: scheme.version,
            processExisting: model.value.enabled && model.value.processExisting
          })
          ElMessage.success('后台核销配置已保存')
          await load()
          return true
        } catch (cause) {
          notifyFriendlyError(cause, '后台核销配置保存失败，请重试')
          return false
        } finally {
          busy.value = false
        }
      }
    })
  }
  async function remove(row: PayableAutomationConfiguration) {
    if (busy.value || !hasAuth('FinancePayableWriteoff:AutomationDelete')) return
    const version = session.version.value
    const options = {
      resourceLabel: '后台核销配置',
      resources: [{ id: row.id, label: row.name }],
      fetchDependencies: fetchPayableAutomationDeleteDependencies,
      dependencyMeta: {
        fms_payable_writeoff_automation: {
          label: '启用中的后台配置',
          unit: '条',
          description: '请先停用配置。',
          actionLabel: '查看配置',
          order: 1,
          routePath: financePaths.payableWriteoff,
          routeQuery: { automationId: row.id },
          canNavigate: () => hasAuth('FinancePayableWriteoff:View')
        },
        fms_payable_writeoff_automation_job: {
          label: '后台处理任务',
          unit: '条',
          description: '保留处理历史，只能停用配置。',
          actionLabel: '查看任务',
          order: 2,
          statusDictCode: 'fmsPayableAutomationJobStatus',
          routePath: financePaths.payableWriteoff,
          routeQuery: (record: { recordId: string }) => ({
            automationId: row.id,
            jobId: record.recordId
          }),
          canNavigate: () => hasAuth('FinancePayableWriteoff:View')
        }
      }
    }
    busy.value = true
    try {
      if (
        !deleteGuard.value ||
        (await deleteGuard.value.inspect(options)) ||
        !session.isCurrent(version)
      )
        return
      try {
        await confirmDelete(`确认删除后台配置“${row.name}”？`)
      } catch {
        return
      }
      if (!session.isCurrent(version)) return
      try {
        await deletePayableAutomation(row.id, row.version)
      } catch (cause) {
        await deleteGuard.value.inspect(options)
        throw cause
      }
      ElMessage.success('后台核销配置已删除')
      await load()
    } catch (cause) {
      notifyFriendlyError(cause, '后台配置删除失败，请重新检查关联记录')
    } finally {
      busy.value = false
    }
  }
  function canRetry(row: PayableAutomationJob) {
    return (
      hasAuth('FinancePayableWriteoff:AutoWriteoff') &&
      row.configurationEnabled &&
      row.configurationVersion === row.automationVersion &&
      ['blocked', 'failed', 'no_match'].includes(row.status)
    )
  }
  async function retry(row: PayableAutomationJob) {
    if (busy.value || !hasAuth('FinancePayableWriteoff:AutomationRetry') || !canRetry(row)) return
    const version = session.version.value
    try {
      await confirmAction('任务将重新排队，并按原启用人员的当前权限处理。', '重试后台核销任务')
    } catch {
      return
    }
    if (!session.isCurrent(version) || busy.value) return
    busy.value = true
    try {
      await retryPayableAutomationJob(row.id)
      ElMessage.success('后台核销任务已重新排队')
      await load()
    } catch (cause) {
      notifyFriendlyError(cause, '后台任务重试失败，请刷新后核对配置')
    } finally {
      busy.value = false
    }
  }
  async function showRecords(row: PayableAutomationJob) {
    selectedJobId.value = row.id
    await recordsDialog.value?.handleOpen()
  }
  function loadRecords(params: { current?: number; size?: number }) {
    return fetchPayableAutomationRecords(
      selectedJobId.value,
      params.current ?? 1,
      params.size ?? 20
    )
  }
  async function changeConfigurationPage(value: number) {
    configurationPage.value = value
    await load()
  }
  async function changePageSize(value: number) {
    pageSize.value = value
    configurationPage.value = 1
    jobPage.value = 1
    await load()
  }
  async function changeJobPage(value: number) {
    jobPage.value = value
    await load()
  }
  watch(
    () => tenantScope.effectiveTenantId,
    () => {
      session.invalidate()
      void dialog.value?.handleClose()
      void editor.value?.handleClose()
      void recordsDialog.value?.handleClose()
    }
  )
  watch(
    () => [route.query.automationId, route.query.jobId],
    () => {
      if (route.query.automationId || route.query.jobId) void handleOpen()
    },
    { flush: 'post' }
  )
  onMounted(() => {
    if (route.query.automationId || route.query.jobId) void handleOpen()
  })
  defineExpose({ handleOpen })
</script>
