<template>
  <ArtDialog ref="dialogRef" size="xl">
    <VoucherRelatedLayout :source="relatedSource" :before-navigate="() => dialogRef?.handleClose()">
      <div class="voucher-dialog">
        <ElAlert
          v-if="partialSaveError"
          class="mb-4"
          type="warning"
          :closable="false"
          show-icon
          :title="partialSaveError"
        />
        <ArtForm
          ref="formRef"
          root-class="art-form--mobile-stack"
          v-model="form.data"
          :items="form.items"
          :rules="form.rules"
          :span="8"
          :gutter="18"
          label-width="92px"
          :show-reset="false"
          :show-submit="false"
          :disabled="!canEditVoucher"
          scroll-to-error
        />

        <VoucherEntryLines
          ref="lineEditorRef"
          v-model="form.data.lines"
          :subjects="context.subjects"
          :currencies="context.currencies"
          :auxiliary-items="context.auxiliaryItems"
          :readonly="!amountEditable || templateLoading"
        />

        <CashFlowAllocationPanel
          ref="cashFlowPanelRef"
          v-model="cashFlowDrafts"
          :lines="form.data.lines"
          :subjects="context.subjects"
          :statement-items="context.cashFlowItems"
          :readonly="!amountEditable"
        />

        <ArtSectionCard
          v-if="canViewAttachments"
          class="voucher-dialog__attachments"
          :empty="!form.data.attachments.length"
          empty-title="暂无原始凭证附件"
          empty-description="上传回单、发票或合同，保留记账依据。"
          :empty-visual-size="64"
          :min-height="148"
          preserve-content-structure
        >
          <template #header
            ><div class="voucher-dialog__section-header">
              <div>
                <ArtSectionTitle :show-line="false">原始凭证附件</ArtSectionTitle>
                <p>支持上传回单、发票、合同或其他记账依据，附件与凭证一并留存。</p>
              </div>
              <ArtUploadFile
                v-if="canEditAttachments"
                :resource-tenant-id="context.accountSet.tenantId"
                :disabled="!context.accountSet.tenantId"
                title="上传附件"
                :show-file-list="false"
                :show-tip="false"
                inline
                @resource-change="handleAttachmentUpload"
              /> </div
          ></template>
          <ArtTable
            :border="false"
            :data="form.data.attachments"
            :columns="attachmentColumns"
            :pagination="false"
            :show-table-header="false"
            empty-height="120px"
            empty-text="暂无附件"
          />
        </ArtSectionCard>
      </div>
    </VoucherRelatedLayout>

    <template #footer="{ loading, api }">
      <div class="voucher-dialog__footer">
        <ElButton :disabled="loading" @click="api.handleClose()">取消</ElButton>
        <ElButton
          v-if="hasAuth(form.data.id ? 'FinanceVoucherCenter:Edit' : 'FinanceVoucherCenter:Add')"
          :type="hasAuth('FinanceVoucherCenter:Submit') ? undefined : 'primary'"
          :loading="loading && submitMode === 'save'"
          :disabled="templateLoading"
          @click="handleFooterConfirm(api, 'save')"
        >
          保存草稿
        </ElButton>
        <ElButton
          v-if="
            hasAuth(form.data.id ? 'FinanceVoucherCenter:Edit' : 'FinanceVoucherCenter:Add') &&
            hasAuth('FinanceVoucherCenter:Submit')
          "
          type="primary"
          :loading="loading && submitMode === 'submit'"
          :disabled="templateLoading"
          @click="handleFooterConfirm(api, 'submit')"
        >
          保存并提交
        </ElButton>
      </div>
    </template>
  </ArtDialog>
</template>

<script setup lang="tsx">
  import BusinessAttachmentRowActions from '@/components/business/business-attachment-row-actions/index.vue'
  import { voucherSourceOptions } from '../../../modules/voucher-summary'
  import { notifyFriendlyError } from '@/hooks/core/useArtFeedback'
  import { validateArtFormForSubmit } from '@/utils/form/validate-art-form'
  import { normalizeNullableText } from '@/utils/form/normalize'
  import ArtSectionCard from '@/components/core/surfaces/art-section-card/index.vue'
  import dayjs from 'dayjs'
  import { cloneDeep } from 'lodash-es'
  import { ElAlert, ElButton, ElMessage } from 'element-plus'
  import { storeToRefs } from 'pinia'
  import type { ComputedRef, UnwrapNestedRefs } from 'vue'
  import type { FormRules } from 'element-plus'
  import ArtDialog from '@/components/core/dialogs/art-dialog/index.vue'
  import type { ArtDialogExpose } from '@/components/core/dialogs/art-dialog/types'
  import ArtUploadFile from '@/components/core/forms/art-upload-file/index.vue'
  import ArtForm, { type FormItem } from '@/components/core/forms/art-form/index.vue'
  import ArtSectionTitle from '@/components/core/surfaces/art-section-title/index.vue'
  import ArtTable from '@/components/core/tables/art-table/index.vue'
  import type { ColumnOption } from '@/types'
  import {
    fetchCashFlowAllocations,
    fetchFinancialStatementItems,
    fetchVoucherDetail,
    fetchVoucherTemplateDetail,
    saveCashFlowAllocations,
    saveVoucher,
    transitionVoucher
  } from '@fms/api'
  import { attachmentTableLink } from '@/components/core/media/art-file-viewer/table-link'
  import { getFileExtension, removeAttachmentRow } from '@/utils/file'
  import {
    isReadableFieldAccess,
    canEditField,
    canViewField,
    getFieldAccess
  } from '@/utils/field-permission'
  import VoucherEntryLines from '@fms/views/modules/voucher-entry-lines.vue'
  import CashFlowAllocationPanel from './cash-flow-allocation-panel.vue'
  import VoucherRelatedLayout from './voucher-related-layout.vue'
  import type { VoucherReferenceSource } from '@/utils/finance/voucher-reference'
  import { createTenantScopeReadGuard } from '@/utils/tenant-scope-context'
  import { useUserStore } from '@/store/modules/user'
  import { useAuth } from '@/hooks/core/useAuth'

  defineOptions({ name: 'FinanceVoucherDialog' })
  const { hasAuth } = useAuth()

  type Voucher = Api.Fms.SecureVoucherRecord
  type FormData = Api.Fms.SaveVoucherPayload & { templateId?: string }
  type SubmitMode = 'save' | 'submit'
  type FooterApi = Pick<ArtDialogExpose<Voucher | undefined>, 'handleConfirm'>

  interface DialogContext {
    accountSet: Api.Fms.AccountSetOption
    subjects: Api.Fms.SubjectRecord[]
    currencies: Api.Fms.CurrencyRecord[]
    auxiliaryItems: Api.Fms.AuxiliaryItemRecord[]
    templates: Api.Fms.VoucherTemplateRecord[]
    cashFlowItems: Api.Fms.FinancialStatementItemRecord[]
  }

  interface FormExpose {
    validate: () => Promise<boolean>
    clearValidate: () => void
  }

  interface FormGroup {
    data: FormData
    items: ComputedRef<FormItem[]>
    rules: FormRules<FormData>
  }

  const emit = defineEmits<{ success: [mode: SubmitMode] }>()
  const userStore = useUserStore()
  const { getDictMap } = storeToRefs(userStore)
  const dialogRef = ref<ArtDialogExpose<Voucher | undefined>>()
  const formRef = ref<FormExpose>()
  const lineEditorRef = ref<{
    isBalanced: boolean
    validate: () => Promise<
      import('@/components/core/tables/art-table/index.vue').ArtTableValidationResult
    >
    clearValidate: () => void
  }>()
  const cashFlowPanelRef = ref<{ validate: (requireComplete?: boolean) => Promise<boolean> }>()
  const cashFlowDrafts = ref<Api.Fms.VoucherCashFlowAllocationDraft[]>([])
  const submitMode = ref<SubmitMode>('save')
  const partialSaveError = ref('')
  const templateLoading = ref(false)
  let templateRequestId = 0
  const fieldAccess = ref<Api.Fms.VoucherFieldAccessMap>({
    voucherAmounts: 'edit',
    sourceReferences: 'edit',
    voucherAttachments: 'edit',
    auditTrail: 'edit'
  })
  const relatedSource = shallowRef<VoucherReferenceSource>()
  const canEditVoucher = computed(() =>
    hasAuth(form.data.id ? 'FinanceVoucherCenter:Edit' : 'FinanceVoucherCenter:Add')
  )
  const amountEditable = computed(
    () => canEditVoucher.value && canEditField(fieldAccess.value, 'voucherAmounts')
  )
  const canViewAttachments = computed(() => canViewField(fieldAccess.value, 'voucherAttachments'))
  const canEditAttachments = computed(
    () => canEditVoucher.value && canEditField(fieldAccess.value, 'voucherAttachments')
  )
  const context = reactive<DialogContext>({
    accountSet: { label: '', value: '', status: 'draft', tenantId: '' },
    subjects: [],
    currencies: [],
    auxiliaryItems: [],
    templates: [],
    cashFlowItems: []
  })

  function createLine(lineNo: number): Api.Fms.VoucherLineRecord {
    return {
      lineNo,
      summary: '',
      subjectId: '',
      auxiliaryValues: {},
      currencyId: null,
      exchangeRate: 1,
      originalAmount: 0,
      quantity: 0,
      debitAmount: 0,
      creditAmount: 0
    }
  }

  function createInitialForm(): FormData {
    return {
      id: undefined,
      accountSetId: '',
      voucherType: 'general',
      voucherDate: dayjs().format('YYYY-MM-DD'),
      sourceType: 'manual',
      sourceId: null,
      sourceNo: null,
      summary: '',
      attachments: [],
      lines: [createLine(1), createLine(2)],
      templateId: ''
    }
  }

  const form: UnwrapNestedRefs<FormGroup> = reactive<FormGroup>({
    data: createInitialForm(),
    items: computed<FormItem[]>(() => [
      {
        label: '账套',
        key: 'accountSetId',
        type: 'select',
        span: 12,
        props: {
          options: [{ label: context.accountSet.label, value: context.accountSet.value }],
          disabled: true
        }
      },
      {
        label: '凭证日期',
        key: 'voucherDate',
        type: 'date',
        span: 6,
        props: { type: 'date', valueFormat: 'YYYY-MM-DD', class: '!w-full' }
      },
      {
        label: '凭证类型',
        key: 'voucherType',
        type: 'select',
        span: 6,
        props: {
          options: voucherTypeOptions.value,
          clearable: false,
          disabled: !canEditVoucher.value || form.data.voucherType === 'reversal'
        }
      },
      {
        label: '套用模板',
        key: 'templateId',
        type: 'select',
        props: {
          options: context.templates
            .filter(
              (item) =>
                item.isEnabled &&
                isReadableFieldAccess(getFieldAccess(item.fieldAccess, 'templateEntries'))
            )
            .map((item) => ({
              label: `${item.templateCode} ${item.templateName}`,
              value: item.id
            })),
          clearable: true,
          filterable: true,
          placeholder: '可选，快速生成分录',
          disabled: !canEditVoucher.value || Boolean(form.data.id) || templateLoading.value,
          loading: templateLoading.value,
          onChange: (value?: string) => void applyTemplate(value)
        }
      },
      {
        label: '凭证摘要',
        key: 'summary',
        type: 'input',
        span: 16,
        props: { maxlength: 200, showWordLimit: true, placeholder: '概括本次经济业务' }
      },
      {
        label: '业务来源',
        key: 'sourceType',
        type: 'select',
        props: { options: sourceTypeOptions.value, disabled: true }
      },
      {
        label: '来源单号',
        key: 'sourceNo',
        type: 'input',
        props: {
          maxlength: 80,
          disabled: true
        }
      }
    ]),
    rules: {
      accountSetId: [{ required: true, message: '请选择账套', trigger: 'change' }],
      voucherDate: [{ required: true, message: '请选择凭证日期', trigger: 'change' }],
      voucherType: [{ required: true, message: '请选择凭证类型', trigger: 'change' }],
      summary: [
        { required: true, whitespace: true, message: '请输入凭证摘要', trigger: 'blur' },
        { max: 200, message: '凭证摘要不能超过 200 个字符', trigger: 'blur' }
      ]
    }
  })

  const voucherTypeOptions = computed(() =>
    (getDictMap.value.fmsVoucherType ?? []).filter((item) => item.value !== 'reversal')
  )
  const sourceTypeOptions = computed(() =>
    voucherSourceOptions(getDictMap.value.fmsVoucherSourceType)
  )

  const attachmentColumns = computed<ColumnOption<Api.Fms.VoucherAttachment>[]>(() => [
    { type: 'globalIndex', label: '序号', width: 72 },
    {
      prop: 'name',
      label: '附件名称',
      minWidth: 240,
      showOverflowTooltip: true,
      link: attachmentTableLink
    },
    { prop: 'fileType', label: '格式', width: 100 },
    { prop: 'fileSize', label: '大小', width: 110 },
    {
      prop: 'operation',
      label: '操作',
      width: canEditAttachments.value ? 144 : 104,
      fixed: 'right',
      formatter: (row: Api.Fms.VoucherAttachment) => (
        <BusinessAttachmentRowActions
          file={row}
          removable={canEditAttachments.value}
          removeLabel="移除附件"
          onRemove={() => void removeAttachment(row)}
        />
      )
    }
  ])

  async function validateLines(): Promise<boolean> {
    if (form.data.lines.length < 2) {
      ElMessage.warning('凭证至少需要两条分录')
      return false
    }
    const tableValidation = await lineEditorRef.value?.validate()
    if (tableValidation && !tableValidation.valid) {
      return false
    }
    const debit = form.data.lines.reduce((sum, line) => sum + Number(line.debitAmount || 0), 0)
    const credit = form.data.lines.reduce((sum, line) => sum + Number(line.creditAmount || 0), 0)
    if (debit <= 0 || Math.abs(debit - credit) > 0.001) {
      ElMessage.warning('凭证借贷金额必须大于零且保持平衡')
      return false
    }
    return true
  }

  async function handleSubmit(): Promise<boolean> {
    const savePermission = form.data.id ? 'FinanceVoucherCenter:Edit' : 'FinanceVoucherCenter:Add'
    const mode = submitMode.value
    const writeAmounts = amountEditable.value
    const canSave = (): boolean =>
      hasAuth(savePermission) && (mode !== 'submit' || hasAuth('FinanceVoucherCenter:Submit'))
    if (!canSave()) {
      ElMessage.warning('凭证操作权限已变化，请刷新页面后重试')
      return false
    }
    if (templateLoading.value) return false
    partialSaveError.value = ''
    relatedSource.value = undefined
    try {
      if (!(await validateArtFormForSubmit(formRef.value))) return false
    } catch (error) {
      notifyFriendlyError(error, '记账凭证校验失败，请重试')
      return false
    }
    if (!(await validateLines())) return false
    if (!canSave()) {
      ElMessage.warning('凭证操作权限已变化，请刷新页面后重试')
      return false
    }
    if (writeAmounts && !(await cashFlowPanelRef.value?.validate(mode === 'submit'))) return false
    let savedVoucherId: string | undefined
    let saveStage: 'voucher' | 'allocations' | 'submit' = 'voucher'
    try {
      const payload = cloneDeep(toRaw(form.data))
      delete payload.templateId
      payload.lines = payload.lines.map((line, index) => ({
        ...line,
        lineNo: index + 1,
        summary: line.summary.trim(),
        auxiliaryValues: Object.fromEntries(
          Object.entries(line.auxiliaryValues).filter(([, value]) => Boolean(value))
        )
      }))
      if (!canSave()) {
        ElMessage.warning('凭证操作权限已变化，请刷新页面后重试')
        return false
      }
      const { data } = await saveVoucher(payload)
      if (!data?.id) throw new Error('凭证保存结果不完整，请保留草稿并刷新列表核实')
      savedVoucherId = data?.id
      if (savedVoucherId) form.data.id = savedVoucherId
      saveStage = 'allocations'
      if (data?.id && writeAmounts) {
        const { data: detail } = await fetchVoucherDetail(data.id)
        if (!detail) throw new Error('凭证已保存，但分录读取失败，请刷新后核实现金流量归集')
        const lineIdByNo = new Map(
          (detail?.lines ?? [])
            .filter((line): line is Api.Fms.VoucherLineRecord & { id: string } => Boolean(line.id))
            .map((line) => [line.lineNo, line.id])
        )
        if (!canSave()) throw new Error('凭证已保存，操作权限已变化，请刷新后核实归集与提交状态')
        if (cashFlowDrafts.value.some((item) => !lineIdByNo.get(item.voucherLineNo)))
          throw new Error('凭证已保存，但归集分录未匹配，请刷新后核实现金流量归集')
        await saveCashFlowAllocations(
          data.id,
          cashFlowDrafts.value.map((item) => ({
            voucherLineId: lineIdByNo.get(item.voucherLineNo) ?? '',
            statementItemId: item.statementItemId,
            amount: Number(item.amount),
            remark: normalizeNullableText(item.remark)
          }))
        )
      }
      if (mode === 'submit' && data?.id) {
        saveStage = 'submit'
        if (!canSave()) throw new Error('凭证已保存，提交权限已变化，请刷新后核实凭证状态')
        await transitionVoucher(data.id, 'submit')
      }
      if (mode === 'save') ElMessage.success('会计凭证草稿已保存')
      emit('success', mode)
      return true
    } catch (error) {
      const fallback =
        saveStage === 'allocations'
          ? '凭证已保存，但现金流量归集未完成；请检查后重试'
          : saveStage === 'submit'
            ? '凭证已保存，提交状态待核实；请先查看列表中的凭证状态'
            : '记账凭证保存失败，请检查内容后重试'
      notifyFriendlyError(error, fallback)
      if (savedVoucherId) {
        partialSaveError.value = fallback
        emit('success', 'save')
      }
      return false
    }
  }

  async function applyTemplate(templateId?: string): Promise<void> {
    if (!canEditVoucher.value) {
      ElMessage.warning('当前权限不足，无法套用凭证模板')
      return
    }
    const requestId = ++templateRequestId
    if (!templateId) return
    templateLoading.value = true
    try {
      const { data, error } = await fetchVoucherTemplateDetail(templateId)
      if (requestId !== templateRequestId) return
      if (!canEditVoucher.value) {
        ElMessage.warning('凭证操作权限已变化，模板未套用，请刷新后重试')
        return
      }
      if (error) throw error
      if (!data) throw new Error('凭证模板不存在或无权查看，请重新选择')
      const entriesAccess = getFieldAccess(data.fieldAccess, 'templateEntries')
      if (
        !isReadableFieldAccess(entriesAccess) ||
        !data.voucherType ||
        data.voucherType === '***' ||
        !Array.isArray(data.lines)
      ) {
        form.data.templateId = ''
        ElMessage.warning('当前字段权限不允许套用该凭证模板')
        return
      }
      form.data.voucherType = data.voucherType
      if (isReadableFieldAccess(getFieldAccess(data.fieldAccess, 'templateNarrative'))) {
        form.data.summary = data.summary || form.data.summary
      }
      form.data.lines = data.lines.map((line, index) => ({
        lineNo: index + 1,
        summary: line.summary || data.summary || '',
        subjectId: line.subjectId,
        auxiliaryValues: { ...line.auxiliaryValues },
        currencyId: line.currencyId ?? null,
        exchangeRate: Number(line.exchangeRate || 1),
        originalAmount: line.currencyId ? Number(line.defaultAmount || 0) : 0,
        quantity: Number(line.quantity || 0),
        debitAmount: line.entryDirection === 'debit' ? Number(line.defaultAmount || 0) : 0,
        creditAmount: line.entryDirection === 'credit' ? Number(line.defaultAmount || 0) : 0
      }))
      ElMessage.success('凭证模板已套用，请核对金额与核算维度')
    } catch (error) {
      if (requestId !== templateRequestId) return
      form.data.templateId = ''
      notifyFriendlyError(error, '凭证模板加载失败，请重新选择')
    } finally {
      if (requestId === templateRequestId) templateLoading.value = false
    }
  }

  function handleAttachmentUpload(resources: Api.DataCenter.Resources.ResourceListItem[]): void {
    if (!canEditAttachments.value) {
      ElMessage.warning('当前权限不足，无法修改凭证附件')
      return
    }
    const resource = resources[0]
    if (!resource) return
    if (!resource.url) return
    if (form.data.attachments.some((item) => item.url === resource.url)) {
      ElMessage.info('该附件已在当前凭证中')
      return
    }
    const fileName = resource.originName || resource.objectName || '附件'
    form.data.attachments.push({
      name: fileName,
      url: resource.url,
      fileType: getFileExtension(fileName, resource.suffix),
      fileSize: resource.sizeInfo
    })
    ElMessage.success('附件已添加')
  }

  function removeAttachment(row: Api.Fms.VoucherAttachment): void {
    if (!canEditAttachments.value) {
      ElMessage.warning('当前权限不足，无法修改凭证附件')
      return
    }
    form.data.attachments = removeAttachmentRow(form.data.attachments, row)
  }

  function toEditableLine(line: Api.Fms.SecureVoucherLineRecord): Api.Fms.VoucherLineRecord {
    return {
      ...line,
      exchangeRate: Number(line.exchangeRate ?? 1),
      originalAmount: Number(line.originalAmount ?? 0),
      quantity: Number(line.quantity ?? 0),
      debitAmount: Number(line.debitAmount ?? 0),
      creditAmount: Number(line.creditAmount ?? 0)
    }
  }

  async function handleOpen(
    dialogContext: Omit<DialogContext, 'cashFlowItems'>,
    row?: Voucher,
    loadContext?: () => Promise<Omit<DialogContext, 'cashFlowItems'> | undefined>
  ): Promise<void> {
    if (!hasAuth(row?.id ? 'FinanceVoucherCenter:Edit' : 'FinanceVoucherCenter:Add')) {
      ElMessage.warning('当前账号无权新增或编辑凭证')
      return
    }
    const assertScope = createTenantScopeReadGuard()
    ++templateRequestId
    templateLoading.value = false
    Object.assign(context, dialogContext)
    cashFlowDrafts.value = []
    partialSaveError.value = ''
    fieldAccess.value = {
      voucherAmounts: 'edit',
      sourceReferences: 'edit',
      voucherAttachments: 'edit',
      auditTrail: 'edit'
    }
    Object.assign(form.data, createInitialForm(), { accountSetId: context.accountSet.value })
    if (!row?.id)
      relatedSource.value = { sourceType: 'manual', fieldAccess: { sourceReferences: 'edit' } }
    const prepare = async (): Promise<boolean> => {
      await Promise.all([
        userStore.ensureDictLoaded('fmsVoucherSourceType'),
        userStore.ensureDictLoaded('fmsVoucherType')
      ])
      if (loadContext) {
        const loaded = await loadContext()
        if (!loaded) return false
        Object.assign(context, loaded)
      }
      const { data: cashFlowItems } = await fetchFinancialStatementItems(
        context.accountSet.value,
        'cash_flow_statement'
      )
      context.cashFlowItems = cashFlowItems ?? []
      if (row?.id) {
        const [{ data }, { data: allocations }] = await Promise.all([
          fetchVoucherDetail(row.id),
          fetchCashFlowAllocations(row.id)
        ])
        if (!data) return false
        relatedSource.value = data
        fieldAccess.value = data.fieldAccess ?? {}
        if (!isReadableFieldAccess(getFieldAccess(fieldAccess.value, 'voucherAmounts'))) {
          ElMessage.warning('当前字段权限不足，无法编辑凭证分录')
          return false
        }
        Object.assign(form.data, {
          id: data.id,
          accountSetId: data.accountSetId,
          voucherType: data.voucherType,
          voucherDate: data.voucherDate,
          sourceType: data.sourceType,
          sourceId: data.sourceId,
          sourceNo: data.sourceNo,
          summary: data.summary,
          attachments: cloneDeep(data.attachments ?? []),
          lines: cloneDeep((data.lines ?? []).map(toEditableLine))
        })
        const lineNoById = new Map(
          (data.lines ?? [])
            .filter((line): line is Api.Fms.SecureVoucherLineRecord & { id: string } =>
              Boolean(line.id)
            )
            .map((line) => [line.id, line.lineNo])
        )
        cashFlowDrafts.value = (allocations ?? [])
          .map((allocation) => ({
            voucherLineNo: lineNoById.get(allocation.voucherLineId) ?? 0,
            statementItemId: allocation.statementItemId,
            amount: Number(allocation.amount),
            remark: allocation.remark ?? null
          }))
          .filter((item) => item.voucherLineNo > 0)
      }
      return true
    }
    await dialogRef.value?.handleOpen(row, {
      title: row ? `编辑凭证 · ${row.voucherNo}` : '新增会计凭证',
      subtitle: '凭证提交后锁定核算范围与分录，过账后只能通过反向凭证冲销。',
      contentMaxHeight: '78vh',
      showFullscreenButton: true,
      fullscreen: false,
      dialogProps: { closeOnClickModal: false },
      loading: true,
      loadingText: '正在加载凭证资料…',
      onConfirm: handleSubmit,
      onOpen: async (_openData, api) => {
        try {
          if (!(await prepare())) {
            await api.handleClose()
            return
          }
          assertScope()
          formRef.value?.clearValidate()
          lineEditorRef.value?.clearValidate()
        } catch (error) {
          notifyFriendlyError(error, '凭证资料加载失败，请重新打开')
          await api.handleClose()
        } finally {
          api.setLoading(false)
        }
      }
    })
  }

  async function handleFooterConfirm(api: FooterApi, mode: SubmitMode): Promise<void> {
    submitMode.value = mode
    await api.handleConfirm()
  }

  defineExpose({ handleOpen })
</script>

<style scoped lang="scss">
  .voucher-dialog {
    display: flex;
    flex-direction: column;
    gap: var(--art-space-3);
    min-width: 0;

    &__attachments {
      min-width: 0;
      padding: var(--art-space-4);
    }

    &__section-header,
    &__footer {
      display: flex;
      gap: var(--art-space-3);
      align-items: center;
      justify-content: space-between;
    }

    &__section-header {
      margin-bottom: var(--art-space-3);

      :deep(.art-section-title) {
        width: auto;
        margin: 0;
      }

      p {
        margin: 4px 0 0;
        font-size: 13px;
        color: var(--el-text-color-secondary);
      }
    }

    &__footer {
      justify-content: flex-end;
      width: 100%;
    }

    @media (width <= 680px) {
      &__section-header,
      &__footer {
        flex-wrap: wrap;
      }

      &__section-header {
        justify-content: flex-start;
      }
    }
  }
</style>
