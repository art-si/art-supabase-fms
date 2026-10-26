<template>
  <ArtDialog ref="dialogRef" size="lg">
    <div class="posting-rule-dialog">
      <ArtForm
        root-class="art-form--mobile-stack"
        ref="formRef"
        v-model="form.data"
        :items="form.items"
        :rules="form.rules"
        :span="12"
        :gutter="18"
        label-width="96px"
        :show-reset="false"
        :show-submit="false"
        scroll-to-error
      />

      <ArtSectionCard
        class="posting-rule-dialog__lines"
        aria-label="制证分录规则"
        preserve-content-structure
      >
        <template #header>
          <div class="posting-rule-dialog__section-head">
            <div>
              <ArtSectionTitle :show-line="false">制证分录规则</ArtSectionTitle>
              <p>金额口径与倍率共同计算分录金额；借贷双方必须至少各一条。</p>
            </div>
            <ElButton type="primary" plain @click="addLine">
              <ArtSvgIcon icon="ri:add-line" />新增分录
            </ElButton>
          </div>
        </template>

        <ArtTable
          ref="lineTableRef"
          :border="false"
          :data="form.lines"
          :columns="lineColumns"
          :pagination="false"
          table-layout="fixed"
          :scrollbar-always-on="false"
          empty-text="暂无制证分录"
          empty-description="请新增借方和贷方分录，形成完整的会计规则。"
          empty-height="180px"
        />
      </ArtSectionCard>
    </div>

    <PostingLineAuxiliaryDialog ref="auxiliaryDialogRef" />
  </ArtDialog>
</template>

<script setup lang="tsx">
  import { ref, reactive, computed } from 'vue'
  import { storeToRefs } from 'pinia'
  import { notifyFriendlyError } from '@/hooks/core/useArtFeedback'
  import { validateArtFormForSubmit } from '@/utils/form/validate-art-form'
  import { normalizeNullableText } from '@/utils/form/normalize'
  import ArtSectionCard from '@/components/core/surfaces/art-section-card/index.vue'
  import {
    ElButton,
    ElInput,
    ElInputNumber,
    ElMessage,
    ElOption,
    ElSegmented,
    ElSelect
  } from 'element-plus'
  import type { ComputedRef, UnwrapNestedRefs } from 'vue'
  import type { FormRules } from 'element-plus'
  import ArtDialog from '@/components/core/dialogs/art-dialog/index.vue'
  import type { ArtDialogExpose } from '@/components/core/dialogs/art-dialog/types'
  import ArtForm, { type FormItem } from '@/components/core/forms/art-form/index.vue'
  import ArtSectionTitle from '@/components/core/surfaces/art-section-title/index.vue'
  import ArtSvgIcon from '@/components/core/base/art-svg-icon/index.vue'
  import ArtTable, { type ArtTableExpose } from '@/components/core/tables/art-table/index.vue'
  import ArtButtonTable from '@/components/core/forms/art-button-table/index.vue'
  import type { ColumnOption } from '@/types'
  import { fetchFinancialStatementItems, fetchPostingRuleDetail, savePostingRule } from '@fms/api'
  import { useUserStore } from '@/store/modules/user'
  import { canEditField } from '@/utils/field-permission'
  import PostingLineAuxiliaryDialog from './posting-line-auxiliary-dialog.vue'

  defineOptions({ name: 'FinancePostingRuleDialog' })

  type Rule = Api.Fms.SecurePostingRuleRecord
  type Line = Api.Fms.PostingRuleLineRecord

  interface SelectOption {
    label: string
    value: string
  }

  interface DialogContext {
    accountSet: Api.Fms.AccountSetOption
    subjects: Api.Fms.SubjectRecord[]
    auxiliaryTypes: Api.Fms.AuxiliaryTypeRecord[]
    cashFlowItems: Api.Fms.FinancialStatementItemRecord[]
  }

  interface FormData {
    id?: string
    accountSetId: string
    ruleCode: string
    ruleName: string
    sourceEvent: string
    voucherType: Exclude<Api.Fms.VoucherType, 'reversal'>
    submissionMode: Api.Fms.PostingSubmissionMode
    costTypeCondition: string
    priority: number
    effectiveFrom: string
    effectiveTo: string
    isEnabled: boolean
    remark: string
  }

  interface FormExpose {
    validate: () => Promise<boolean>
    clearValidate: () => void
  }

  interface AuxiliaryDialogExpose {
    handleOpen: (
      value: Record<string, string>,
      auxiliaryTypes: Api.Fms.AuxiliaryTypeRecord[],
      sourceOptions: SelectOption[],
      onSave: (result: Record<string, string>) => void
    ) => Promise<void>
  }

  interface FormGroup {
    data: FormData
    lines: Line[]
    items: ComputedRef<FormItem[]>
    rules: FormRules<FormData>
  }

  const emit = defineEmits<{ success: [] }>()
  const userStore = useUserStore()
  const { getDictMap } = storeToRefs(userStore)
  const enabledOptions = computed(() =>
    (getDictMap.value.commonEnabledStatus ?? []).map((item) => ({
      ...item,
      value: item.value === 'enabled'
    }))
  )
  const dialogRef = ref<ArtDialogExpose<Rule | undefined>>()
  const auxiliaryDialogRef = ref<AuxiliaryDialogExpose>()
  const formRef = ref<FormExpose>()
  const lineTableRef = ref<ArtTableExpose>()
  const context = reactive<DialogContext>({
    accountSet: { label: '', value: '', status: 'draft', tenantId: '' },
    subjects: [],
    auxiliaryTypes: [],
    cashFlowItems: []
  })

  function createInitialForm(): FormData {
    return {
      id: undefined,
      accountSetId: '',
      ruleCode: '',
      ruleName: '',
      sourceEvent: '',
      voucherType: 'general',
      submissionMode: 'pending_review',
      costTypeCondition: '',
      priority: 100,
      effectiveFrom: '',
      effectiveTo: '',
      isEnabled: true,
      remark: ''
    }
  }

  function createLine(lineNo: number, direction: Api.Fms.BalanceDirection): Line {
    return {
      lineNo,
      direction,
      amountKey: 'gross_amount',
      amountMultiplier: 1,
      subjectId: '',
      cashFlowItemId: null,
      summary: '',
      auxiliaryBindings: {}
    }
  }

  const sourceEventOptions = computed<SelectOption[]>(() =>
    (getDictMap.value.fmsPostingSourceEvent ?? [])
      .filter((item) => !String(item.value).endsWith(':voided'))
      .map((item) => ({
        label: item.label ?? item.name,
        value: String(item.value)
      }))
  )
  const amountKeyOptions = computed<SelectOption[]>(() =>
    (getDictMap.value.fmsPostingAmountKey ?? []).map((item) => ({
      label: item.label ?? item.name,
      value: String(item.value)
    }))
  )
  const directionOptions = computed<SelectOption[]>(() =>
    (getDictMap.value.fmsBalanceDirection ?? [])
      .filter((item) => ['debit', 'credit'].includes(String(item.value)))
      .map((item) => ({ label: item.label ?? item.name, value: String(item.value) }))
  )
  const subjectOptions = computed<SelectOption[]>(() =>
    context.subjects
      .filter(
        (subject) =>
          subject.isEnabled &&
          !context.subjects.some((candidate) => candidate.parentId === subject.id)
      )
      .map((subject) => ({
        label: `${subject.subjectCode} ${subject.subjectName}`,
        value: subject.id
      }))
  )
  const payloadOptions = computed<SelectOption[]>(() => {
    const event = form.data.sourceEvent
    const allowed: Record<string, string[]> = {
      'customer_statement:confirmed': ['customer_id'],
      'carrier_statement:confirmed': ['carrier_id'],
      'estimated_payable:approved': ['supplier_id', 'organization_id', 'project_id'],
      'financial_payable:approved': ['supplier_id', 'organization_id', 'project_id'],
      'system:ap_payment_confirmed': ['supplier_id', 'organization_id', 'project_id'],
      'system:ap_virtual_payment_confirmed': [
        'supplier_id',
        'carrier_id',
        'organization_id',
        'project_id'
      ],
      'system:ap_supplier_refund_received': ['supplier_id', 'organization_id', 'project_id'],
      'system:ap_payable_refund_writeoff_approved': [
        'supplier_id',
        'counterparty_supplier_id',
        'organization_id',
        'counterparty_organization_id',
        'project_id',
        'receipt_project_id'
      ],
      'system:ap_payment_refund_received': [
        'supplier_id',
        'carrier_id',
        'organization_id',
        'project_id'
      ],
      'system:ap_writeoff_approved': [
        'supplier_id',
        'counterparty_supplier_id',
        'carrier_id',
        'counterparty_carrier_id',
        'organization_id',
        'counterparty_organization_id'
      ],
      'system:ap_receivable_offset_approved': [
        'supplier_id',
        'customer_id',
        'organization_id',
        'counterparty_organization_id',
        'project_id'
      ],
      'system:ap_red_blue_offset_approved': [
        'supplier_id',
        'counterparty_supplier_id',
        'organization_id',
        'counterparty_organization_id',
        'project_id'
      ],
      'system:ap_payment_refund_writeoff_approved': [
        'supplier_id',
        'counterparty_supplier_id',
        'organization_id',
        'counterparty_organization_id',
        'carrier_id',
        'counterparty_carrier_id'
      ],
      'system:ar_estimate_approved': ['customer_id', 'organization_id', 'project_id'],
      'system:ar_financial_approved': ['customer_id', 'organization_id', 'project_id'],
      'system:ar_reversal_approved': ['customer_id', 'organization_id', 'project_id'],
      'system:ar_revenue_approved': ['customer_id', 'organization_id', 'project_id'],
      'system:ar_receipt_confirmed': ['customer_id', 'organization_id'],
      'system:ar_refund_paid': ['customer_id', 'organization_id'],
      'system:ar_credit_payment_paid': ['customer_id', 'organization_id'],
      'customer_receipt:recorded': ['customer_id'],
      'carrier_payment:recorded': ['carrier_id'],
      'invoice:output_issued': ['customer_id'],
      'invoice:input_certified': ['carrier_id'],
      'expense_reimbursement:paid': ['applicant_user_id'],
      'waybill_cost:approved': ['waybill_id', 'carrier_id', 'driver_id', 'expense_item_id']
    }
    const values = new Set(allowed[event] ?? [])
    return (getDictMap.value.fmsPostingAuxiliaryPayloadKey ?? [])
      .filter((item) => values.has(String(item.value)))
      .map((item) => ({ label: item.label ?? item.name, value: String(item.value) }))
  })

  const form: UnwrapNestedRefs<FormGroup> = reactive<FormGroup>({
    data: createInitialForm(),
    lines: [createLine(1, 'debit'), createLine(2, 'credit')],
    items: computed<FormItem[]>(() => [
      { label: '规则信息', key: 'identitySection', type: 'divider', span: 24 },
      {
        label: '账套',
        key: 'accountSetId',
        type: 'select',
        span: 24,
        props: {
          options: [{ label: context.accountSet.label, value: context.accountSet.value }],
          disabled: true
        }
      },
      {
        label: '规则编码',
        key: 'ruleCode',
        type: 'input',
        span: 12,
        props: { maxlength: 40, placeholder: '如 CUSTOMER_RECEIPT' }
      },
      {
        label: '规则名称',
        key: 'ruleName',
        span: 12,
        type: 'input',
        props: { maxlength: 80, placeholder: '请输入规则名称' }
      },
      { label: '制证设置', key: 'postingSection', type: 'divider', span: 24 },
      {
        label: '业务事件',
        key: 'sourceEvent',
        type: 'select',
        props: {
          options: sourceEventOptions.value,
          clearable: false,
          onChange: () => {
            if (form.data.sourceEvent !== 'waybill_cost:approved') form.data.costTypeCondition = ''
            form.lines.forEach((line) => {
              line.auxiliaryBindings = {}
            })
          }
        }
      },
      {
        label: '凭证类型',
        key: 'voucherType',
        type: 'select',
        props: {
          options: (getDictMap.value.fmsVoucherType ?? []).filter(
            (item) => item.value !== 'reversal'
          ),
          clearable: false
        }
      },
      {
        label: '生成状态',
        key: 'submissionMode',
        type: 'select',
        props: { options: getDictMap.value.fmsPostingSubmissionMode ?? [], clearable: false }
      },
      {
        label: '规则优先级',
        key: 'priority',
        type: 'number',
        props: { min: 1, max: 9999, controlsPosition: 'right', class: '!w-full' }
      },
      ...(form.data.sourceEvent === 'waybill_cost:approved'
        ? [
            {
              label: '费用类型',
              key: 'costTypeCondition',
              type: 'select' as const,
              props: {
                options: getDictMap.value.fmsPostingWaybillCostType ?? [],
                clearable: true,
                placeholder: '全部费用类型'
              }
            }
          ]
        : []),
      { label: '生效管理', key: 'validitySection', type: 'divider', span: 24 },
      {
        label: '生效日期',
        key: 'effectiveFrom',
        type: 'date',
        props: { type: 'date', valueFormat: 'YYYY-MM-DD', class: '!w-full', clearable: true }
      },
      {
        label: '失效日期',
        key: 'effectiveTo',
        type: 'date',
        props: { type: 'date', valueFormat: 'YYYY-MM-DD', class: '!w-full', clearable: true }
      },
      {
        label: '启用状态',
        key: 'isEnabled',
        type: 'segment',
        props: { options: enabledOptions.value }
      },
      {
        label: '规则说明',
        key: 'remark',
        type: 'input',
        span: 24,
        props: { type: 'textarea', rows: 3, maxlength: 500, showWordLimit: true }
      }
    ]),
    rules: {
      accountSetId: [{ required: true, message: '请选择账套', trigger: 'change' }],
      ruleCode: [
        { required: true, whitespace: true, message: '请输入规则编码', trigger: 'blur' },
        {
          pattern: /^[A-Za-z0-9_-]{2,40}$/,
          message: '规则编码只能包含字母、数字、下划线和短横线',
          trigger: 'blur'
        }
      ],
      ruleName: [{ required: true, whitespace: true, message: '请输入规则名称', trigger: 'blur' }],
      sourceEvent: [{ required: true, message: '请选择业务事件', trigger: 'change' }],
      voucherType: [{ required: true, message: '请选择凭证类型', trigger: 'change' }],
      submissionMode: [{ required: true, message: '请选择生成状态', trigger: 'change' }]
    }
  })

  function updateLine(row: Line, patch: Partial<Line>): void {
    Object.assign(row, patch)
  }

  function lineSubject(row: Line): Api.Fms.SubjectRecord | undefined {
    return context.subjects.find((subject) => subject.id === row.subjectId)
  }

  function cashFlowOptions(row: Line): SelectOption[] {
    const direction: Api.Fms.CashFlowDirection = row.direction === 'debit' ? 'receipt' : 'payment'
    return context.cashFlowItems
      .filter(
        (item) =>
          item.isEnabled &&
          item.calculationMethod === 'mapping' &&
          item.cashFlowDirection === direction
      )
      .map((item) => ({ label: `${item.itemCode} ${item.itemName}`, value: item.id }))
  }

  function updateLineSubject(row: Line, subjectId: string): void {
    const subject = context.subjects.find((item) => item.id === subjectId)
    updateLine(row, {
      subjectId,
      cashFlowItemId: subject?.cashFlowRequired ? (row.cashFlowItemId ?? null) : null
    })
  }

  function updateLineDirection(row: Line, direction: Api.Fms.BalanceDirection): void {
    updateLine(row, { direction, cashFlowItemId: null })
  }

  function addLine(): void {
    const direction =
      form.lines.filter((item) => item.direction === 'debit').length <=
      form.lines.filter((item) => item.direction === 'credit').length
        ? 'debit'
        : 'credit'
    form.lines.push(createLine(form.lines.length + 1, direction))
  }

  function removeLine(row: Line): void {
    form.lines = form.lines
      .filter((item) => item !== row)
      .map((item, index) => ({ ...item, lineNo: index + 1 }))
  }

  function openAuxiliaryDialog(row: Line): void {
    if (!form.data.sourceEvent) {
      ElMessage.warning('请先选择业务事件，再配置核算维度绑定')
      return
    }
    if (!payloadOptions.value.length) {
      ElMessage.warning('当前业务事件暂无可绑定的实体来源，请核对业务事件配置')
      return
    }
    void auxiliaryDialogRef.value?.handleOpen(
      row.auxiliaryBindings,
      context.auxiliaryTypes,
      payloadOptions.value,
      (result) => updateLine(row, { auxiliaryBindings: result })
    )
  }

  const hasCashFlow = computed(() =>
    form.lines.some((line) => Boolean(lineSubject(line)?.cashFlowRequired))
  )

  const lineColumns = computed<ColumnOption<Line>[]>(() => [
    { prop: 'lineNo', label: '行号', width: 64, fixed: 'left', align: 'center' },
    {
      prop: 'direction',
      label: '借贷方向',
      width: 140,
      formatter: (row) => (
        <ElSegmented
          v-model={row.direction}
          options={directionOptions.value}
          aria-label={`第 ${row.lineNo} 行借贷方向`}
          onChange={() => updateLineDirection(row, row.direction)}
        />
      )
    },
    {
      prop: 'subjectId',
      label: '会计科目',
      required: true,
      requiredMessage: ({ rowIndex }) => `第 ${rowIndex + 1} 条制证分录未选择会计科目`,
      minWidth: 220,
      formatter: (row) => (
        <ElSelect
          v-model={row.subjectId}
          aria-label={`第 ${row.lineNo} 行会计科目`}
          filterable
          class="w-full!"
          placeholder="选择末级科目"
          onChange={() => updateLineSubject(row, row.subjectId)}
        >
          {subjectOptions.value.map((item) => (
            <ElOption key={item.value} label={item.label} value={item.value} />
          ))}
        </ElSelect>
      )
    },
    ...(hasCashFlow.value
      ? [
          {
            prop: 'cashFlowItemId',
            label: '现金流量项目',
            rules: [
              {
                validator: ({ row, value }: { row: Line; value: unknown }) =>
                  !lineSubject(row)?.cashFlowRequired || Boolean(value),
                message: ({ rowIndex }: { rowIndex: number }) =>
                  `第 ${rowIndex + 1} 条制证分录未选择现金流量项目`
              }
            ],
            minWidth: 220,
            formatter: (row: Line) =>
              lineSubject(row)?.cashFlowRequired ? (
                <ElSelect
                  v-model={row.cashFlowItemId}
                  aria-label={`第 ${row.lineNo} 行现金流量项目`}
                  filterable
                  class="w-full!"
                  placeholder="现金科目必选"
                >
                  {cashFlowOptions(row).map((item) => (
                    <ElOption key={item.value} label={item.label} value={item.value} />
                  ))}
                </ElSelect>
              ) : (
                <span class="text-g-500">无需归集</span>
              )
          }
        ]
      : []),
    {
      prop: 'amountKey',
      label: '金额口径',
      required: true,
      requiredMessage: ({ rowIndex }) => `第 ${rowIndex + 1} 条制证分录未选择金额口径`,
      width: 190,
      formatter: (row) => (
        <ElSelect
          v-model={row.amountKey}
          class="w-full!"
          aria-label={`第 ${row.lineNo} 行金额口径`}
        >
          {amountKeyOptions.value.map((item) => (
            <ElOption key={item.value} label={item.label} value={item.value} />
          ))}
        </ElSelect>
      )
    },
    {
      prop: 'amountMultiplier',
      label: '倍率',
      required: true,
      requiredMessage: ({ rowIndex }) => `第 ${rowIndex + 1} 条制证分录倍率必须大于 0`,
      rules: [
        {
          validator: ({ value }) => Number(value) > 0,
          message: ({ rowIndex }) => `第 ${rowIndex + 1} 条制证分录倍率必须大于 0`
        }
      ],
      width: 168,
      formatter: (row) => (
        <ElInputNumber
          v-model={row.amountMultiplier}
          aria-label={`第 ${row.lineNo} 行倍率`}
          min={0.000001}
          max={999999}
          precision={6}
          controlsPosition="right"
          class="w-full!"
        />
      )
    },
    {
      prop: 'summary',
      label: '分录摘要',
      minWidth: 170,
      formatter: (row) => (
        <ElInput
          v-model={row.summary}
          maxlength={120}
          placeholder="默认使用事件摘要"
          aria-label={`第 ${row.lineNo} 行分录摘要`}
        />
      )
    },
    {
      prop: 'auxiliaryBindings',
      label: '核算维度',
      width: 124,
      align: 'center',
      formatter: (row) => (
        <div class="flex items-center justify-center gap-2">
          {payloadOptions.value.length ? (
            <ArtButtonTable
              type="edit"
              label="配置核算维度绑定"
              permission=""
              onClick={() => openAuxiliaryDialog(row)}
            />
          ) : null}
          <span class="text-xs text-g-600">
            {Object.keys(row.auxiliaryBindings).length
              ? `${Object.keys(row.auxiliaryBindings).length} 项`
              : payloadOptions.value.length
                ? '未绑定'
                : '无需绑定'}
          </span>
        </div>
      )
    },
    {
      prop: 'operation',
      label: '操作',
      width: 64,
      fixed: 'right',
      align: 'center',
      formatter: (row) => (
        <ArtButtonTable
          type="delete"
          label="删除分录"
          permission=""
          onClick={() => removeLine(row)}
        />
      )
    }
  ])

  async function validateLines(): Promise<boolean> {
    if (form.lines.length < 2) {
      ElMessage.warning('制证规则至少需要两条分录')
      return false
    }
    const tableValidation = await lineTableRef.value?.validate()
    if (tableValidation && !tableValidation.valid) {
      return false
    }
    if (!form.lines.some((line) => line.direction === 'debit')) {
      ElMessage.warning('制证规则至少需要一条借方分录')
      return false
    }
    if (!form.lines.some((line) => line.direction === 'credit')) {
      ElMessage.warning('制证规则至少需要一条贷方分录')
      return false
    }
    if (
      form.data.effectiveFrom &&
      form.data.effectiveTo &&
      form.data.effectiveFrom > form.data.effectiveTo
    ) {
      ElMessage.warning('失效日期不能早于生效日期')
      return false
    }
    return true
  }

  async function handleSubmit(): Promise<boolean> {
    try {
      if (!(await validateArtFormForSubmit(formRef.value))) return false
    } catch (error) {
      notifyFriendlyError(error, '自动记账规则校验失败，请重试')
      return false
    }
    if (!(await validateLines())) return false
    const [sourceType, eventCode] = form.data.sourceEvent.split(':') as [
      Api.Fms.PostingSourceType,
      string
    ]
    try {
      const { error } = await savePostingRule({
        id: form.data.id,
        accountSetId: form.data.accountSetId,
        ruleCode: form.data.ruleCode.trim().toUpperCase(),
        ruleName: form.data.ruleName.trim(),
        sourceType,
        eventCode,
        voucherType: form.data.voucherType,
        submissionMode: form.data.submissionMode,
        matchConditions: form.data.costTypeCondition
          ? { cost_type: form.data.costTypeCondition }
          : {},
        priority: Number(form.data.priority || 100),
        effectiveFrom: form.data.effectiveFrom || null,
        effectiveTo: form.data.effectiveTo || null,
        isEnabled: form.data.isEnabled,
        remark: normalizeNullableText(form.data.remark),
        lines: form.lines.map((line, index) => ({
          ...line,
          lineNo: index + 1,
          amountMultiplier: Number(line.amountMultiplier),
          summary: normalizeNullableText(line.summary),
          auxiliaryBindings: { ...line.auxiliaryBindings }
        }))
      })
      if (error) return false
      emit('success')
      return true
    } catch (error) {
      notifyFriendlyError(error, '自动记账规则保存失败，请检查内容后重试')
      return false
    }
  }

  async function handleOpen(
    dialogContext: Omit<DialogContext, 'cashFlowItems'>,
    row?: Rule,
    loadContext?: () => Promise<Omit<DialogContext, 'cashFlowItems'> | undefined>
  ): Promise<void> {
    Object.assign(context, dialogContext)
    Object.assign(form.data, createInitialForm(), { accountSetId: context.accountSet.value })
    form.lines = [createLine(1, 'debit'), createLine(2, 'credit')]
    const prepare = async (): Promise<boolean> => {
      await Promise.all([
        userStore.ensureDictLoaded('fmsBalanceDirection'),
        userStore.ensureDictLoaded('fmsPostingAmountKey'),
        userStore.ensureDictLoaded('fmsPostingAuxiliaryPayloadKey'),
        userStore.ensureDictLoaded('fmsPostingSourceEvent'),
        userStore.ensureDictLoaded('fmsPostingSubmissionMode'),
        userStore.ensureDictLoaded('fmsPostingWaybillCostType'),
        userStore.ensureDictLoaded('fmsVoucherType'),
        userStore.ensureDictLoaded('commonEnabledStatus')
      ])
      if (loadContext) {
        const loaded = await loadContext()
        if (!loaded) throw new Error('当前账套不可用，请重新选择账套后重试')
        Object.assign(context, loaded)
      }
      const { data: cashFlowItems, error: cashFlowError } = await fetchFinancialStatementItems(
        context.accountSet.value,
        'cash_flow_statement'
      )
      if (cashFlowError) throw cashFlowError
      context.cashFlowItems = cashFlowItems ?? []
      if (row?.id) {
        const { data, error } = await fetchPostingRuleDetail(row.id)
        if (error) throw error
        if (!data) throw new Error('当前入账规则已不存在，请刷新列表后重试')
        if (!canEditField(data.fieldAccess, 'ruleConfiguration')) {
          ElMessage.warning('当前账号无权编辑该规则的制证配置')
          return false
        }
        if (
          !data.voucherType ||
          data.voucherType === '***' ||
          !data.submissionMode ||
          data.submissionMode === '***'
        ) {
          ElMessage.warning('规则配置已受字段权限保护，无法进入编辑')
          return false
        }
        Object.assign(form.data, {
          id: data.id,
          accountSetId: data.accountSetId,
          ruleCode: data.ruleCode,
          ruleName: data.ruleName,
          sourceEvent: `${data.sourceType}:${data.eventCode}`,
          voucherType: data.voucherType,
          submissionMode: data.submissionMode,
          costTypeCondition: String(data.matchConditions?.cost_type ?? ''),
          priority: data.priority,
          effectiveFrom: data.effectiveFrom ?? '',
          effectiveTo: data.effectiveTo ?? '',
          isEnabled: data.isEnabled,
          remark: data.remark ?? ''
        })
        form.lines = (data.lines ?? []).map((line, index) => ({
          ...line,
          lineNo: index + 1,
          amountMultiplier: Number(line.amountMultiplier),
          auxiliaryBindings: { ...line.auxiliaryBindings }
        }))
      }
      return true
    }
    await dialogRef.value?.handleOpen(row, {
      title: row ? '编辑自动入账规则' : '新增自动入账规则',
      subtitle: row ? undefined : '设置业务事件与分录，生成草稿或待审核凭证。',
      confirmText: row ? '保存修改' : '创建规则',
      contentMaxHeight: '78vh',
      showFullscreenButton: true,
      dialogProps: { closeOnClickModal: false },
      loading: true,
      loadingText: '正在加载入账规则…',
      onConfirm: handleSubmit,
      onOpen: async (_openData, api) => {
        try {
          if (!(await prepare())) {
            await api.handleClose()
            return
          }
          formRef.value?.clearValidate()
          lineTableRef.value?.clearValidate()
        } catch (error) {
          notifyFriendlyError(error, '入账规则加载失败，请重新打开重试')
          await api.handleClose()
        } finally {
          api.setLoading(false)
        }
      }
    })
  }

  defineExpose({ handleOpen })
</script>

<style scoped lang="scss">
  .posting-rule-dialog {
    display: flex;
    flex-direction: column;
    gap: var(--art-space-4);
    min-width: 0;

    &__lines {
      min-width: 0;
      padding: var(--art-space-4);
      border: 1px solid var(--el-border-color-lighter);
    }

    :global(.posting-rule-dialog__lines .el-table__body .art-table__cell-content),
    :global(.posting-rule-dialog__lines .el-table__body .art-table__cell-value),
    :global(.posting-rule-dialog__lines .el-table__body .el-select),
    :global(.posting-rule-dialog__lines .el-table__body .el-input),
    :global(.posting-rule-dialog__lines .el-table__body .el-input-number) {
      width: 100%;
      min-width: 0;
    }

    &__section-head {
      display: flex;
      gap: var(--art-space-4);
      align-items: flex-start;
      justify-content: space-between;
      margin-bottom: var(--art-space-4);

      p {
        margin: 6px 0 0;
        font-size: 13px;
        color: var(--el-text-color-secondary);
      }
    }

    @media (width <= 900px) {
      :deep(.art-form .el-col:first-child) {
        flex: 0 0 100%;
        max-width: 100%;
      }
    }

    @media (width <= 680px) {
      &__section-head {
        flex-direction: column;
      }
    }
  }
</style>
