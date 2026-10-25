<template>
  <ArtDialog ref="dialogRef" size="xl">
    <div class="flex min-w-0 flex-col gap-4">
      <ArtForm
        ref="formRef"
        v-model="model"
        :items="items"
        :rules="rules"
        :span="12"
        :gutter="20"
        label-position="top"
        :show-reset="false"
        :show-submit="false"
      >
        <template #applicantEmployeeId>
          <ArtEmployeeSelect
            :model-value="model.applicantEmployeeId || undefined"
            v-model:selected-data="selectedApplicant"
            :tenant-id="model.tenantId"
            :api-fn="fetchReimbursementApplicantSelector"
            :disabled="Boolean(model.travelApplicationId)"
            placeholder="选择报销人"
            @update:model-value="setApplicant"
          />
        </template>
      </ArtForm>
      <ElAlert
        v-if="!model.applicantEmployeeId"
        class="mx-4"
        type="warning"
        :closable="false"
        title="请关联本人员工档案或选择已委托当前账号填单的报销人。"
      />
      <p v-else class="px-4 text-sm text-[var(--art-gray-700)]">
        申请人公司：{{ applicantCompanyName || '待设置' }} · 费用承担公司：{{
          expenseCompanyName || '待设置'
        }}
      </p>
      <ElAlert
        v-if="selectedLoan"
        class="mx-4 w-auto"
        :type="selectedLoan.isDemo ? 'warning' : 'info'"
        :closable="false"
        :title="`${selectedLoan.loanNo} · 可抵扣 ${formatCurrencyValue(selectedLoan.availableAmount)} · 本次抵扣 ${formatCurrencyValue(model.loanOffsetAmount)} · 应付现金 ${formatCurrencyValue(cashAmount)}${selectedLoan.isDemo ? '（演示借款，后续仅可模拟付款）' : ''}`"
      />

      <ArtSectionCard
        class="mx-4 min-w-0"
        title="费用明细"
        :subtitle="`报销金额合计：${formatCurrencyValue(totalAmount)}`"
        :empty="!lines.length"
        empty-title="尚未添加费用明细"
        empty-description="新增一条费用项目、发生日期和报销金额后即可保存草稿。"
        :min-height="185"
      >
        <template #actions>
          <ElButton
            v-auth="
              model.id ? 'FinanceExpenseReimbursement:Edit' : 'FinanceExpenseReimbursement:Add'
            "
            type="primary"
            plain
            :disabled="!model.applicantEmployeeId"
            @click="addLine"
          >
            <ArtSvgIcon icon="ri:add-line" aria-hidden="true" />新增明细
          </ElButton>
        </template>
        <ArtTable
          v-if="lines.length"
          :data="lines"
          :columns="lineColumns"
          :pagination="false"
          :show-table-header="false"
          table-layout="fixed"
          max-height="260px"
        />
      </ArtSectionCard>

      <ArtSectionCard
        class="mx-4 min-w-0"
        title="收款信息"
        :subtitle="`从已授权的收款资料带入账户，已分配收款：${formatCurrencyValue(payeeTotal)}。`"
        :empty="!payees.length"
        :empty-title="totalAmount > 0 && cashAmount === 0 ? '无需现金付款' : '尚未添加收款信息'"
        :empty-description="
          totalAmount > 0 && cashAmount === 0
            ? '本单已由借款抵扣，无需填写收款账户。'
            : '草稿可先保存；提交审批前需补齐与应付金额一致的收款账户。'
        "
        :min-height="185"
      >
        <template #actions>
          <strong class="text-sm font-semibold tabular-nums text-[var(--el-color-warning)]">
            付现金额 {{ formatCurrencyValue(cashAmount) }}
          </strong>
          <ElButton
            v-auth="
              model.id ? 'FinanceExpenseReimbursement:Edit' : 'FinanceExpenseReimbursement:Add'
            "
            type="primary"
            plain
            :disabled="!model.applicantEmployeeId"
            @click="addPayee"
          >
            <ArtSvgIcon icon="ri:add-line" aria-hidden="true" />新增收款
          </ElButton>
        </template>
        <ArtTable
          v-if="payees.length"
          :data="payees"
          :columns="payeeColumns"
          :pagination="false"
          :show-table-header="false"
          table-layout="fixed"
          max-height="260px"
        />
      </ArtSectionCard>
      <ElAlert
        v-if="payees.length && payeeTotal !== cashAmount"
        class="mx-4"
        type="warning"
        :closable="false"
        :title="`收款金额与应付现金额相差 ${formatCurrencyValue(Math.abs(cashAmount - payeeTotal))}，请核对后再保存。`"
      />
      <section class="px-4">
        <ArtSectionTitle>附件</ArtSectionTitle>
        <ArtUploadFile
          v-model="model.attachmentUrls"
          multiple
          :limit="8"
          :resource-tenant-id="model.tenantId"
          accept=".pdf,.doc,.docx,.xls,.xlsx,image/*"
          tip="支持文档和图片，单个文件不超过 20 MB"
        />
      </section>
    </div>
    <ReimbursementLineDialog ref="lineDialogRef" @save="saveLine" />
    <ExpensePayeeDialog ref="payeeDialogRef" @save="savePayee" />
    <MasterDataDeleteGuard ref="lineGuardRef" />
    <MasterDataDeleteGuard ref="payeeGuardRef" />
  </ArtDialog>
</template>

<script setup lang="tsx">
  import { unref } from 'vue'
  import { ElMessage } from 'element-plus'
  import dayjs from 'dayjs'
  import { round, sumBy } from 'lodash-es'
  import { storeToRefs } from 'pinia'
  import type { ColumnOption } from '@/types'
  import type { EmployeeIntegrationItem } from '@/api/integration/employees'
  import { fetchEmployeeReferencesByIds } from '@/api/integration/employees'
  import { fetchEnabledOrganizationTree } from '@/api/system-manage'
  import { useTenantScopeFormPolicy } from '@/hooks/core/useTenantScopeFormPolicy'
  import { notifyFriendlyError } from '@/hooks/core/useArtFeedback'
  import { useRecordDeleteGuard } from '@/hooks/core/useRecordDeleteGuard'
  import { useAuth } from '@/hooks/core/useAuth'
  import { useTenantOperationGuard } from '@/hooks/core/useTenantOperationGuard'
  import { useArtOverlaySession } from '@/hooks/core/useArtOverlay'
  import { getDeleteReferenceContext } from '@/utils/supabase/delete-reference'
  import { validateArtFormForSubmit } from '@/utils/form/validate-art-form'
  import { normalizeNullableText, normalizeNonNullableText } from '@/utils/form/normalize'
  import { createTenantScopeReadGuard } from '@/utils/tenant-scope-context'
  import { formatCurrencyValue } from '@/utils/ui'
  import TreeUtils from '@/utils/tree'
  import ArtDialog from '@/components/core/dialogs/art-dialog/index.vue'
  import type { ArtDialogExpose } from '@/components/core/dialogs/art-dialog/types'
  import ArtForm, { type FormItem } from '@/components/core/forms/art-form/index.vue'
  import ArtEmployeeSelect from '@/components/business/art-employee-select/index.vue'
  import ArtSectionCard from '@/components/core/surfaces/art-section-card/index.vue'
  import ArtSectionTitle from '@/components/core/surfaces/art-section-title/index.vue'
  import ArtDictDisplay from '@/components/core/base/art-dict-display/index.vue'
  import ArtSvgIcon from '@/components/core/base/art-svg-icon/index.vue'
  import ArtUploadFile from '@/components/core/forms/art-upload-file/index.vue'
  import ArtTable from '@/components/core/tables/art-table/index.vue'
  import ArtButtonTable from '@/components/core/forms/art-button-table/index.vue'
  import BusinessTableRowActions from '@/components/business/business-table-row-actions/index.vue'
  import MasterDataDeleteGuard from '@/components/business/master-data-delete-guard/index.vue'
  import { useUserStore } from '@/store/modules/user'
  import {
    fetchExpenseItemTree,
    fetchExpenseProjectOptions,
    fetchTravelReimbursementDetail,
    fetchReimbursementLoanOptions,
    fetchReimbursementApplicantSelector,
    fetchTravelAssignmentOptions,
    saveTravelReimbursementDraft,
    type TravelReimbursementDraftInput,
    type TravelReimbursementLineInput,
    type TravelReimbursementPayeeInput,
    type TravelLoanPayeeInput,
    type TravelLoan,
    type TravelApplication,
    type ReimbursementLoanOption
  } from '@fms/api'
  import ReimbursementLineDialog from './reimbursement-line-dialog.vue'
  import ExpensePayeeDialog from '../../shared/expense-payee-dialog.vue'
  import { findExpenseCompany } from '../../shared/expense-company'
  import { usePrimaryAssignment } from '../../shared/use-primary-assignment'

  interface OpenData {
    row?: Api.Fms.ExpenseReimbursementRecord
    copy?: boolean
    sourceLoan?: TravelLoan
    sourceApplication?: TravelApplication
    isCurrent?: () => boolean
  }
  interface LineDialogExpose {
    handleOpen: (data: {
      line?: TravelReimbursementLineInput
      tenantId: string
      applicantEmployeeId: string
      multipleReimbursees: boolean
      copy?: boolean
    }) => Promise<void>
  }
  interface PayeeDialogExpose {
    handleOpen: (data: {
      payee?: TravelLoanPayeeInput
      tenantId: string
      employeeId: string
      defaultAmount: number
      documentType: 'loan' | 'reimbursement'
      copy?: boolean
    }) => Promise<void>
  }
  type Organization = Api.SystemManage.OrganizationScopeFilterItem
  type EditablePayee = TravelReimbursementPayeeInput & { payeeName?: string }

  const emit = defineEmits<{ success: [] }>()
  const dialogRef = ref<ArtDialogExpose<OpenData>>()
  const { hasAuth } = useAuth()
  const captureOperation = useTenantOperationGuard('FinanceExpenseReimbursement:View')
  const session = useArtOverlaySession(() => Boolean(unref(dialogRef.value?.visible)))
  const formRef = ref<InstanceType<typeof ArtForm>>()
  const lineDialogRef = ref<LineDialogExpose>()
  const payeeDialogRef = ref<PayeeDialogExpose>()
  const {
    deleteGuardRef: lineGuardRef,
    deleteRecord: deleteLine,
    inspectDeleteReferences: inspectLineReferences
  } = useRecordDeleteGuard('fms_expense_reimbursement_line', '费用明细')
  const {
    deleteGuardRef: payeeGuardRef,
    deleteRecord: deletePayee,
    inspectDeleteReferences: inspectPayeeReferences
  } = useRecordDeleteGuard('fms_expense_reimbursement_payee', '收款明细')
  const { defaultWriteTenantId } = useTenantScopeFormPolicy()
  const { getUserInfo } = storeToRefs(useUserStore())
  const expenseTreeUtils = new TreeUtils({
    idKey: 'id',
    parentKey: 'parentId',
    childrenKey: 'children'
  })
  const organizations = ref<Organization[]>([])
  const expenseNames = ref(new Map<string, string>())
  const projectNames = ref(new Map<string, string>())
  const selectedApplicant = ref<EmployeeIntegrationItem[]>([])
  const lines = ref<TravelReimbursementLineInput[]>([])
  const payees = ref<EditablePayee[]>([])
  const loanOptions = ref<ReimbursementLoanOption[]>([])
  const removedLines = ref<Array<{ id: string; label: string }>>([])
  const removedPayees = ref<Array<{ id: string; label: string }>>([])
  const editingLineIndex = ref<number | null>(null)
  const editingPayeeIndex = ref<number | null>(null)

  const initial = (): TravelReimbursementDraftInput => ({
    tenantId: defaultWriteTenantId.value ?? '',
    applicantEmployeeId: getUserInfo.value.hrEmployeeId ?? '',
    assignmentId: null,
    reimbursementDate: dayjs().format('YYYY-MM-DD'),
    expenseDepartmentId: getUserInfo.value.hrEmployee?.organizationId ?? null,
    travelApplicationId: null,
    travelLoanId: null,
    loanOffsetAmount: 0,
    multipleReimbursees: false,
    isProjectExpense: false,
    projectId: null,
    plannedPaymentDate: dayjs().format('YYYY-MM-DD'),
    reason: '',
    remark: null,
    attachmentUrls: []
  })
  const model = ref<TravelReimbursementDraftInput>(initial())
  const { selectPrimaryAssignment } = usePrimaryAssignment(model)
  const totalAmount = computed(() =>
    round(
      sumBy(lines.value, (line) => line.grossAmount),
      2
    )
  )
  const payeeTotal = computed(() =>
    round(
      sumBy(payees.value, (payee) => payee.amount),
      2
    )
  )
  const cashAmount = computed(() =>
    round(Math.max(totalAmount.value - model.value.loanOffsetAmount, 0), 2)
  )
  const selectedLoan = computed(() =>
    loanOptions.value.find((loan) => loan.id === model.value.travelLoanId)
  )
  const applicantCompanyName = computed(
    () =>
      findExpenseCompany(organizations.value, selectedApplicant.value[0]?.organizationId)
        ?.organizationName
  )
  const expenseCompanyName = computed(
    () => findExpenseCompany(organizations.value, model.value.expenseDepartmentId)?.organizationName
  )

  const items = computed<FormItem[]>(() => [
    { key: 'base', label: '基本信息', type: 'divider', span: 24 },
    { key: 'applicantEmployeeId', label: '报销人', type: 'input' },
    {
      key: 'assignmentId',
      label: '职位',
      type: 'select',
      params: { tenantId: model.value.tenantId, employeeId: model.value.applicantEmployeeId },
      api: () =>
        model.value.applicantEmployeeId
          ? fetchTravelAssignmentOptions(model.value.tenantId, model.value.applicantEmployeeId)
          : Promise.resolve({ data: [], error: null }),
      resultField: 'data',
      labelField: 'businessTitle',
      valueField: 'id',
      props: { clearable: true, placeholder: '默认主职；可切换兼职职位' }
    },
    {
      key: 'reimbursementDate',
      label: '报销日期',
      type: 'date',
      props: { type: 'date', valueFormat: 'YYYY-MM-DD' }
    },
    {
      key: 'expenseDepartmentId',
      label: '费用承担部门',
      type: 'treeSelect',
      api: () => fetchEnabledOrganizationTree({ tenantId: model.value.tenantId }),
      resultField: 'data',
      labelField: 'organizationName',
      valueField: 'id',
      childrenField: 'children',
      props: { checkStrictly: true, placeholder: '选择费用承担部门' }
    },
    { key: 'multipleReimbursees', label: '多报销人', type: 'switch' },
    {
      key: 'travelLoanId',
      label: '关联借款',
      type: 'select',
      api: async () => {
        const tenant = model.value.tenantId
        const applicant = model.value.applicantEmployeeId
        if (!tenant || !applicant) return { data: [], error: null }
        const result = await fetchReimbursementLoanOptions(tenant, applicant, model.value.id)
        if (tenant === model.value.tenantId && applicant === model.value.applicantEmployeeId)
          loanOptions.value = result.data ?? []
        return result
      },
      resultField: 'data',
      labelField: 'loanNo',
      valueField: 'id',
      labelFn: (loan) =>
        `${typeof loan.loanNo === 'string' ? loan.loanNo : '借款单'} · 可抵扣 ${typeof loan.availableAmount === 'number' ? formatCurrencyValue(loan.availableAmount) : '待核对'}`,
      props: {
        clearable: true,
        filterable: true,
        placeholder: '直接报销可不关联借款',
        onChange: selectLoan
      }
    },
    ...(model.value.travelLoanId
      ? [
          {
            key: 'loanOffsetAmount',
            label: '本次借款抵扣（元）',
            type: 'number' as const,
            props: { min: 0, max: totalAmount.value, precision: 2, class: 'w-full!' }
          }
        ]
      : []),
    { key: 'isProjectExpense', label: '是否项目费用报销', type: 'switch' },
    ...(model.value.isProjectExpense
      ? [
          {
            key: 'projectId',
            label: '项目',
            type: 'select' as const,
            api: () => fetchExpenseProjectOptions(model.value.tenantId),
            resultField: 'data',
            labelField: 'projectName',
            valueField: 'id',
            props: { filterable: true, clearable: true, placeholder: '选择项目（选填）' }
          }
        ]
      : []),
    {
      key: 'plannedPaymentDate',
      label: '计划付款日期',
      type: 'date',
      props: { type: 'date', valueFormat: 'YYYY-MM-DD' }
    },
    {
      key: 'reason',
      label: '报销事由',
      type: 'input',
      span: 24,
      props: { type: 'textarea', rows: 2, maxlength: 500, showWordLimit: true }
    },
    {
      key: 'remark',
      label: '备注',
      type: 'input',
      span: 24,
      props: { type: 'textarea', rows: 2, maxlength: 500, showWordLimit: true }
    }
  ])
  const rules = computed(() => ({
    applicantEmployeeId: [{ required: true, message: '请选择报销人', trigger: 'change' }],
    reimbursementDate: [{ required: true, message: '请选择报销日期', trigger: 'change' }],
    expenseDepartmentId: [{ required: true, message: '请选择费用承担部门', trigger: 'change' }],
    reason: [{ required: true, message: '请填写报销事由', trigger: 'blur' }]
  }))

  watch(
    () => model.value.isProjectExpense,
    (enabled) => {
      if (!enabled) model.value.projectId = null
    }
  )
  watch(
    () => [model.value.multipleReimbursees, model.value.applicantEmployeeId] as const,
    ([enabled, applicantEmployeeId]) => {
      if (!enabled)
        lines.value.forEach((line) => {
          line.reimburseeEmployeeId = applicantEmployeeId
        })
    }
  )

  function setApplicant(id: string | undefined): void {
    model.value.applicantEmployeeId = id ?? ''
    model.value.assignmentId = null
    model.value.travelLoanId = null
    model.value.loanOffsetAmount = 0
    loanOptions.value = []
    const organizationId = selectedApplicant.value[0]?.organizationId
    if (organizationId) model.value.expenseDepartmentId = organizationId
    void selectPrimaryAssignment()
  }
  function selectLoan(): void {
    model.value.loanOffsetAmount = model.value.travelLoanId
      ? Math.min(totalAmount.value, selectedLoan.value?.availableAmount ?? 0)
      : 0
  }
  const lineColumns: ColumnOption<TravelReimbursementLineInput>[] = [
    {
      prop: 'expenseItemId',
      label: '费用项目',
      minWidth: 140,
      formatter: (row) => expenseNames.value.get(row.expenseItemId) ?? '已关联费用项目'
    },
    {
      prop: 'projectId',
      label: '项目',
      minWidth: 130,
      formatter: (row) =>
        row.projectId ? (projectNames.value.get(row.projectId) ?? '已关联项目') : '—'
    },
    { prop: 'occurredOn', label: '费用发生日期', width: 125 },
    {
      prop: 'grossAmount',
      label: '报销金额',
      width: 125,
      align: 'right',
      formatter: (row) => formatCurrencyValue(row.grossAmount)
    },
    {
      prop: 'taxRate',
      label: '税率',
      width: 85,
      align: 'right',
      formatter: (row) => `${row.taxRate}%`
    },
    {
      prop: 'taxAmount',
      label: '税额',
      width: 110,
      align: 'right',
      formatter: (row) => formatCurrencyValue(row.taxAmount)
    },
    { prop: 'invoiceNo', label: '发票号码', minWidth: 130, showOverflowTooltip: true },
    {
      prop: 'operation',
      label: '操作',
      width: 142,
      fixed: 'right',
      formatter: (row) => (
        <BusinessTableRowActions>
          <ArtButtonTable
            type="edit"
            permission={
              model.value.id
                ? 'FinanceExpenseReimbursement:Edit'
                : 'FinanceExpenseReimbursement:Add'
            }
            onClick={() => editLine(row)}
          />
          <ArtButtonTable
            type="add"
            icon="ri:file-copy-line"
            label="复制"
            permission={
              model.value.id
                ? 'FinanceExpenseReimbursement:Copy'
                : 'FinanceExpenseReimbursement:Add'
            }
            onClick={() => copyLine(row)}
          />
          <ArtButtonTable
            type="delete"
            permission={
              model.value.id
                ? 'FinanceExpenseReimbursement:DeleteLine'
                : 'FinanceExpenseReimbursement:Add'
            }
            onClick={() => void removeLine(row)}
          />
        </BusinessTableRowActions>
      )
    }
  ]
  const payeeColumns: ColumnOption<EditablePayee>[] = [
    {
      prop: 'settlementMethod',
      label: '支付方式',
      width: 125,
      formatter: (row) => (
        <ArtDictDisplay
          dictCode="fmsSettlementMethod"
          value={row.settlementMethod}
          display="text"
        />
      )
    },
    { prop: 'payeeType', label: '收款人类型', width: 110, formatter: () => '个人' },
    { prop: 'payeeName', label: '收款人', minWidth: 130 },
    { prop: 'bankAccount', label: '银行账号', minWidth: 155, showOverflowTooltip: true },
    { prop: 'accountName', label: '账户名称', minWidth: 145, showOverflowTooltip: true },
    { prop: 'bankName', label: '开户银行', minWidth: 150, showOverflowTooltip: true },
    {
      prop: 'amount',
      label: '收款金额',
      width: 125,
      align: 'right',
      formatter: (row) => formatCurrencyValue(row.amount)
    },
    {
      prop: 'operation',
      label: '操作',
      width: 142,
      fixed: 'right',
      formatter: (row) => (
        <BusinessTableRowActions>
          <ArtButtonTable
            type="edit"
            permission={
              model.value.id
                ? 'FinanceExpenseReimbursement:Edit'
                : 'FinanceExpenseReimbursement:Add'
            }
            onClick={() => editPayee(row)}
          />
          <ArtButtonTable
            type="add"
            icon="ri:file-copy-line"
            label="复制"
            permission={
              model.value.id
                ? 'FinanceExpenseReimbursement:Copy'
                : 'FinanceExpenseReimbursement:Add'
            }
            onClick={() => copyPayee(row)}
          />
          <ArtButtonTable
            type="delete"
            permission={
              model.value.id
                ? 'FinanceExpenseReimbursement:DeletePayee'
                : 'FinanceExpenseReimbursement:Add'
            }
            onClick={() => void removePayee(row)}
          />
        </BusinessTableRowActions>
      )
    }
  ]

  function addLine(): void {
    editingLineIndex.value = null
    void lineDialogRef.value?.handleOpen({
      tenantId: model.value.tenantId,
      applicantEmployeeId: model.value.applicantEmployeeId,
      multipleReimbursees: model.value.multipleReimbursees
    })
  }
  function editLine(line: TravelReimbursementLineInput): void {
    editingLineIndex.value = lines.value.indexOf(line)
    void lineDialogRef.value?.handleOpen({
      line,
      tenantId: model.value.tenantId,
      applicantEmployeeId: model.value.applicantEmployeeId,
      multipleReimbursees: model.value.multipleReimbursees
    })
  }
  function copyLine(line: TravelReimbursementLineInput): void {
    editingLineIndex.value = null
    void lineDialogRef.value?.handleOpen({
      line,
      copy: true,
      tenantId: model.value.tenantId,
      applicantEmployeeId: model.value.applicantEmployeeId,
      multipleReimbursees: model.value.multipleReimbursees
    })
  }
  function saveLine(line: TravelReimbursementLineInput): void {
    if (editingLineIndex.value === null) lines.value.push(line)
    else lines.value.splice(editingLineIndex.value, 1, line)
    editingLineIndex.value = null
  }
  async function removeLine(line: TravelReimbursementLineInput): Promise<void> {
    const index = lines.value.indexOf(line)
    if (index < 0) return
    if (!line.id) {
      lines.value.splice(index, 1)
      return
    }
    await deleteLine({
      resource: { id: line.id, label: expenseNames.value.get(line.expenseItemId) ?? '费用明细' },
      permission: 'FinanceExpenseReimbursement:DeleteLine',
      confirmMessage: '从草稿中移除此费用明细？保存报销单后生效。',
      remove: async () => {
        removedLines.value.push({
          id: line.id!,
          label: expenseNames.value.get(line.expenseItemId) ?? '费用明细'
        })
        lines.value.splice(index, 1)
      }
    })
  }
  function addPayee(): void {
    editingPayeeIndex.value = null
    void payeeDialogRef.value?.handleOpen({
      tenantId: model.value.tenantId,
      employeeId: model.value.applicantEmployeeId,
      documentType: 'reimbursement',
      defaultAmount: Math.max(cashAmount.value - payeeTotal.value, 0)
    })
  }
  function editPayee(payee: EditablePayee): void {
    editingPayeeIndex.value = payees.value.indexOf(payee)
    void payeeDialogRef.value?.handleOpen({
      payee,
      tenantId: model.value.tenantId,
      employeeId: model.value.applicantEmployeeId,
      documentType: 'reimbursement',
      defaultAmount: payee.amount
    })
  }
  function copyPayee(payee: EditablePayee): void {
    editingPayeeIndex.value = null
    void payeeDialogRef.value?.handleOpen({
      payee,
      copy: true,
      tenantId: model.value.tenantId,
      employeeId: model.value.applicantEmployeeId,
      documentType: 'reimbursement',
      defaultAmount: payee.amount
    })
  }
  function savePayee(payee: TravelLoanPayeeInput): void {
    if (editingPayeeIndex.value === null) payees.value.push(payee)
    else payees.value.splice(editingPayeeIndex.value, 1, payee)
    editingPayeeIndex.value = null
  }
  async function removePayee(payee: EditablePayee): Promise<void> {
    const index = payees.value.indexOf(payee)
    if (index < 0) return
    if (!payee.id) {
      payees.value.splice(index, 1)
      return
    }
    await deletePayee({
      resource: { id: payee.id, label: payee.payeeName || '收款明细' },
      permission: 'FinanceExpenseReimbursement:DeletePayee',
      confirmMessage: '从草稿中移除此收款明细？保存报销单后生效。',
      remove: async () => {
        removedPayees.value.push({ id: payee.id!, label: payee.payeeName || '收款明细' })
        payees.value.splice(index, 1)
      }
    })
  }

  async function handleOpen(data: OpenData = {}): Promise<void> {
    const scopeCurrent = captureOperation()
    const version = session.invalidate()
    const permissions = data.copy
      ? ['FinanceExpenseReimbursement:Add', 'FinanceExpenseReimbursement:Copy']
      : [data.row ? 'FinanceExpenseReimbursement:Edit' : 'FinanceExpenseReimbursement:Add']
    if (data.sourceApplication)
      permissions.push(
        'FinanceTravelApplication:View',
        'FinanceTravelApplication:PushReimbursement'
      )
    const contextCurrent = () =>
      scopeCurrent() &&
      session.version.value === version &&
      permissions.every((permission) => hasAuth(permission)) &&
      (!data.isCurrent || data.isCurrent())
    if (!contextCurrent()) return
    const isCurrent = () => contextCurrent() && session.isCurrent(version)
    const assertScope = createTenantScopeReadGuard()
    try {
      loanOptions.value = []
      const detail = data.row ? (await fetchTravelReimbursementDetail(data.row.id)).data : null
      if (!contextCurrent()) return
      if (detail && detail.sourceType !== 'travel') throw new Error('运单报销单不可按差旅报销编辑')
      if (
        detail &&
        (typeof detail.totalAmount !== 'number' ||
          detail.travelLines?.some(
            (line) => typeof line.grossAmount !== 'number' || typeof line.taxAmount !== 'number'
          ) ||
          detail.payees?.some(
            (payee) => typeof payee.amount !== 'number' || !payee.bankAccountSnapshot
          ))
      ) {
        throw new Error('报销金额或收款字段不可编辑，请联系管理员核对字段权限')
      }
      model.value = detail
        ? {
            id: data.copy ? undefined : detail.id,
            tenantId: detail.tenantId,
            applicantEmployeeId: detail.applicantEmployeeId ?? '',
            assignmentId: detail.assignmentId ?? null,
            reimbursementDate: detail.reimbursementDate,
            expenseDepartmentId: detail.expenseDepartmentId ?? null,
            travelApplicationId: detail.travelApplicationId ?? null,
            travelLoanId: data.copy ? null : (detail.travelLoanId ?? null),
            loanOffsetAmount:
              !data.copy && typeof detail.loanOffsetAmount === 'number'
                ? detail.loanOffsetAmount
                : 0,
            multipleReimbursees: detail.multipleReimbursees ?? false,
            isProjectExpense: detail.isProjectExpense ?? false,
            projectId: detail.projectId ?? null,
            plannedPaymentDate: detail.plannedPaymentDate,
            reason: detail.reason ?? '',
            remark: detail.remark ?? null,
            attachmentUrls: detail.basisUrls ?? []
          }
        : initial()
      lines.value = (detail?.travelLines ?? []).map((line) => ({
        id: data.copy ? undefined : line.id,
        expenseItemId: line.expenseItemId,
        projectId: line.projectId,
        occurredOn: line.occurredOn,
        grossAmount: Number(line.grossAmount),
        taxRate: line.taxRate,
        taxAmount: Number(line.taxAmount),
        invoiceNo: line.invoiceNo ?? null,
        reimburseeEmployeeId: line.reimburseeEmployeeId ?? null,
        remark: line.remark ?? null
      }))
      payees.value = (detail?.payees ?? []).map((payee) => ({
        id: data.copy ? undefined : payee.id,
        settlementMethod: payee.settlementMethod ?? 'bank_transfer',
        payeeType: 'person',
        payeeInformationId: payee.payeeInformationId ?? '',
        payeeName: payee.payeeNameSnapshot ?? '',
        bankAccount: payee.bankAccountSnapshot ?? '',
        accountName: payee.accountNameSnapshot ?? null,
        bankName: payee.bankNameSnapshot ?? '',
        amount: Number(payee.amount),
        remark: payee.remark ?? null
      }))
      if (data.sourceApplication) {
        const source = data.sourceApplication
        if (!['approved', 'paid', 'closed'].includes(source.status))
          throw new Error('出差申请尚未审批通过，请返回原单核对')
        model.value = {
          ...initial(),
          tenantId: source.tenantId,
          applicantEmployeeId: source.applicantEmployeeId,
          assignmentId: source.assignmentId,
          expenseDepartmentId: source.expenseDepartmentId,
          travelApplicationId: source.id,
          reason: source.reason,
          multipleReimbursees: source.multipleTravelers
        }
        lines.value = (source.itineraries ?? []).map((line) => ({
          expenseItemId: line.expenseItemId,
          projectId: line.projectId,
          occurredOn: line.endDate,
          grossAmount: line.requestedAmount,
          taxRate: 0,
          taxAmount: 0,
          invoiceNo: null,
          reimburseeEmployeeId: source.multipleTravelers ? null : source.applicantEmployeeId,
          remark: `${line.departurePlace} → ${line.destinationPlace}`
        }))
      }
      if (data.sourceLoan) {
        const source = data.sourceLoan
        model.value = {
          ...initial(),
          tenantId: source.tenantId,
          applicantEmployeeId: source.applicantEmployeeId,
          assignmentId: source.assignmentId,
          expenseDepartmentId: source.expenseDepartmentId,
          travelLoanId: source.id,
          reason: source.reason
        }
        lines.value = (source.items ?? []).map((item) => ({
          expenseItemId: item.expenseItemId,
          projectId: item.projectId,
          occurredOn: dayjs().format('YYYY-MM-DD'),
          grossAmount: item.amount,
          taxRate: 0,
          taxAmount: 0,
          invoiceNo: null,
          reimburseeEmployeeId: item.borrowerEmployeeId,
          remark: item.purpose
        }))
        model.value.multipleReimbursees = source.multipleTravelers
        model.value.loanOffsetAmount = Math.min(totalAmount.value, source.availableAmount ?? 0)
        loanOptions.value = [
          {
            id: source.id,
            tenantId: source.tenantId,
            loanNo: source.loanNo,
            applicantEmployeeId: source.applicantEmployeeId,
            applicantName: source.applicantName,
            reason: source.reason,
            assignmentId: source.assignmentId,
            expenseDepartmentId: source.expenseDepartmentId,
            isDemo: source.isDemo,
            availableAmount: source.availableAmount ?? 0,
            paidAmount: source.paidAmount ?? 0,
            repaidAmount: source.repaidAmount ?? 0,
            reimbursedAmount: source.reimbursedAmount ?? 0,
            remainingBalance: source.remainingBalance ?? 0
          }
        ]
        const payee = source.payees?.length === 1 ? source.payees[0] : undefined
        payees.value =
          payee && cashAmount.value > 0
            ? [
                {
                  settlementMethod: payee.settlementMethod,
                  payeeType: 'person',
                  payeeInformationId: payee.payeeInformationId,
                  payeeName: payee.payeeName,
                  bankAccount: payee.bankAccount,
                  accountName: payee.accountName,
                  bankName: payee.bankName,
                  amount: cashAmount.value,
                  remark: null
                }
              ]
            : []
      }
      removedLines.value = []
      removedPayees.value = []
      const [organizationsResult, expenseResult, projectResult] = await Promise.all([
        fetchEnabledOrganizationTree({ tenantId: model.value.tenantId }),
        fetchExpenseItemTree({ tenantId: model.value.tenantId, isEnabled: true }),
        fetchExpenseProjectOptions(model.value.tenantId)
      ])
      if (!contextCurrent()) return
      organizations.value = organizationsResult.data ?? []
      expenseNames.value = new Map(
        expenseTreeUtils
          .treeToList(expenseResult.data ?? [])
          .flatMap((item) => (item.id ? [[item.id, item.itemName] as const] : []))
      )
      projectNames.value = new Map(
        (projectResult.data ?? []).map((project) => [project.id, project.projectName])
      )
      const applicantReferences = model.value.applicantEmployeeId
        ? await fetchEmployeeReferencesByIds(model.value.tenantId, [
            model.value.applicantEmployeeId
          ])
        : []
      if (!contextCurrent()) return
      selectedApplicant.value = applicantReferences
      await selectPrimaryAssignment()
      assertScope()
      if (!contextCurrent()) return
      await dialogRef.value?.handleOpen(data, {
        title:
          detail && !data.copy
            ? `编辑费用报销 · ${detail.reimbursementNo}`
            : data.copy
              ? '复制费用报销单'
              : data.sourceApplication
                ? `出差申请下推报销 · ${data.sourceApplication.applicationNo}`
                : data.sourceLoan
                  ? `借款下推报销 · ${data.sourceLoan.loanNo}`
                  : '新增费用报销单',
        subtitle: data.sourceLoan
          ? '请按实际发生费用调整明细、金额及发票；借款抵扣后的差额再登记收款。'
          : '保存草稿后可提交审批；关联借款时，财务仅支付抵扣后的现金差额。',
        confirmText: '保存草稿',
        onOpen: () => formRef.value?.clearValidate(),
        onClose: () => {
          session.invalidate()
        },
        onConfirm: async () => {
          if (!isCurrent()) {
            ElMessage.warning('操作范围或权限已变化，请重新打开报销单')
            return false
          }
          try {
            if (!(await validateArtFormForSubmit(formRef.value))) return false
            if (!isCurrent()) return false
            if (!lines.value.length) {
              notifyFriendlyError(new Error('缺少费用明细'), '请先添加至少一条费用明细')
              return false
            }
            if (
              selectedLoan.value &&
              model.value.loanOffsetAmount > selectedLoan.value.availableAmount
            ) {
              notifyFriendlyError(
                new Error('借款可抵扣余额不足'),
                '本次抵扣超过借款可用余额，请核对已提交的报销和还款'
              )
              return false
            }
            if (!applicantCompanyName.value || !expenseCompanyName.value) {
              notifyFriendlyError(
                new Error('公司信息未配置'),
                '申请人或费用承担公司为空，请联系管理员设置组织'
              )
              return false
            }
            const payload: TravelReimbursementDraftInput = {
              ...model.value,
              assignmentId: normalizeNullableText(model.value.assignmentId),
              expenseDepartmentId: normalizeNullableText(model.value.expenseDepartmentId),
              travelApplicationId: normalizeNullableText(model.value.travelApplicationId),
              travelLoanId: normalizeNullableText(model.value.travelLoanId),
              projectId: normalizeNullableText(model.value.projectId),
              reason: normalizeNonNullableText(model.value.reason),
              remark: normalizeNullableText(model.value.remark)
            }
            const linePayloads = lines.value.map((line): TravelReimbursementLineInput => ({
              ...line,
              projectId: normalizeNullableText(line.projectId),
              reimburseeEmployeeId: normalizeNullableText(line.reimburseeEmployeeId),
              invoiceNo: normalizeNullableText(line.invoiceNo),
              remark: normalizeNullableText(line.remark)
            }))
            const payeePayloads = payees.value.map((payee): TravelReimbursementPayeeInput => ({
              ...payee,
              accountName: normalizeNullableText(payee.accountName),
              remark: normalizeNullableText(payee.remark)
            }))
            await saveTravelReimbursementDraft(payload, linePayloads, payeePayloads)
            if (!isCurrent()) return false
            ElMessage.success('费用报销草稿已保存')
            emit('success')
            return true
          } catch (error) {
            if (!isCurrent()) return false
            if (
              removedLines.value.length &&
              (await inspectLineReferences(
                removedLines.value,
                getDeleteReferenceContext(error)?.constraint
              ))
            )
              return false
            if (!isCurrent()) return false
            if (
              removedPayees.value.length &&
              (await inspectPayeeReferences(
                removedPayees.value,
                getDeleteReferenceContext(error)?.constraint
              ))
            )
              return false
            if (isCurrent())
              notifyFriendlyError(error, '费用报销保存失败，请核对明细和收款信息后重试')
            return false
          }
        }
      })
    } catch (error) {
      if (!contextCurrent()) return
      notifyFriendlyError(error, '费用报销单加载失败，请刷新列表后重试')
    }
  }

  defineExpose({ handleOpen })
</script>
