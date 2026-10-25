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
            :api-fn="fetchLoanApplicantSelector"
            placeholder="选择借款人"
            @update:model-value="setApplicant"
          />
        </template>
      </ArtForm>
      <ElAlert
        v-if="!model.applicantEmployeeId"
        type="warning"
        :closable="false"
        title="请关联本人员工档案或选择已委托当前账号填单的借款人。"
      />
      <p v-else class="px-4 text-sm text-[var(--art-gray-700)]">
        申请人公司：{{ applicantCompanyName || '待设置' }} · 费用承担公司：{{
          expenseCompanyName || '待设置'
        }}
      </p>

      <ArtSectionCard
        class="mx-4 min-w-0"
        title="借款明细"
        subtitle="按费用项目登记借款人、金额和用途。"
        :empty="!loanItems.length"
        empty-title="尚未添加借款明细"
        empty-description="添加费用项目和借款用途后，可保存借款草稿。"
        :min-height="185"
      >
        <template #actions>
          <strong class="text-sm font-semibold tabular-nums text-[var(--el-color-warning)]">
            借款合计 {{ formatCurrencyValue(loanTotal) }}
          </strong>
          <ElButton type="primary" plain :disabled="!model.applicantEmployeeId" @click="addItem">
            <ArtSvgIcon icon="ri:add-line" aria-hidden="true" />新增明细
          </ElButton>
        </template>
        <ArtTable
          v-if="loanItems.length"
          :data="loanItems"
          :columns="itemColumns"
          :pagination="false"
          :show-table-header="false"
          table-layout="fixed"
          max-height="260px"
        />
      </ArtSectionCard>

      <ArtSectionCard
        class="mx-4 min-w-0"
        title="收款信息"
        subtitle="从已授权的收款资料带入账户，逐笔核对本次收款金额。"
        :empty="!payees.length"
        empty-title="尚未添加收款信息"
        empty-description="先在收款信息页面维护银行账户，再为借款单添加收款明细。"
        :min-height="185"
      >
        <template #actions>
          <strong class="text-sm font-semibold tabular-nums text-[var(--el-color-warning)]">
            收款合计 {{ formatCurrencyValue(payeeTotal) }}
          </strong>
          <ElButton type="primary" plain :disabled="!model.applicantEmployeeId" @click="addPayee">
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
        v-if="loanTotal > 0 && payeeTotal > 0 && loanTotal !== payeeTotal"
        class="mx-4"
        type="warning"
        :closable="false"
        :title="`借款合计与收款合计相差 ${formatCurrencyValue(Math.abs(loanTotal - payeeTotal))}。草稿可保存，提交前请核对金额。`"
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
    <TravelLoanItemDialog ref="itemDialogRef" @save="saveItem" />
    <ExpensePayeeDialog ref="payeeDialogRef" @save="savePayee" />
    <MasterDataDeleteGuard ref="itemGuardRef" />
    <MasterDataDeleteGuard ref="payeeGuardRef" />
  </ArtDialog>
</template>

<script setup lang="tsx">
  import { ElMessage } from 'element-plus'
  import dayjs from 'dayjs'
  import { storeToRefs } from 'pinia'
  import type { ColumnOption } from '@/types'
  import {
    fetchEmployeeReferencesByIds,
    type EmployeeIntegrationItem
  } from '@/api/integration/employees'
  import { fetchEnabledOrganizationTree } from '@/api/system-manage'
  import { useTenantScopeFormPolicy } from '@/hooks/core/useTenantScopeFormPolicy'
  import { notifyFriendlyError } from '@/hooks/core/useArtFeedback'
  import { useRecordDeleteGuard } from '@/hooks/core/useRecordDeleteGuard'
  import { useAuth } from '@/hooks/core/useAuth'
  import { useTenantOperationGuard } from '@/hooks/core/useTenantOperationGuard'
  import { useArtOverlaySession } from '@/hooks/core/useArtOverlay'
  import { unref } from 'vue'
  import { getDeleteReferenceContext } from '@/utils/supabase/delete-reference'
  import { validateArtFormForSubmit } from '@/utils/form/validate-art-form'
  import { formatCurrencyValue } from '@/utils/ui'
  import TreeUtils from '@/utils/tree'
  import ArtDialog from '@/components/core/dialogs/art-dialog/index.vue'
  import type { ArtDialogExpose } from '@/components/core/dialogs/art-dialog/types'
  import ArtForm, { type FormItem } from '@/components/core/forms/art-form/index.vue'
  import ArtEmployeeSelect from '@/components/business/art-employee-select/index.vue'
  import ArtSvgIcon from '@/components/core/base/art-svg-icon/index.vue'
  import ArtSectionCard from '@/components/core/surfaces/art-section-card/index.vue'
  import ArtSectionTitle from '@/components/core/surfaces/art-section-title/index.vue'
  import ArtUploadFile from '@/components/core/forms/art-upload-file/index.vue'
  import ArtTable from '@/components/core/tables/art-table/index.vue'
  import ArtButtonTable from '@/components/core/forms/art-button-table/index.vue'
  import BusinessTableRowActions from '@/components/business/business-table-row-actions/index.vue'
  import MasterDataDeleteGuard from '@/components/business/master-data-delete-guard/index.vue'
  import { useUserStore } from '@/store/modules/user'
  import {
    fetchExpenseItemTree,
    fetchExpenseProjectOptions,
    fetchLoanApplicantSelector,
    fetchTravelAssignmentOptions,
    fetchTravelLoanDetail,
    saveTravelLoanDraft,
    type TravelLoan,
    type TravelLoanInput,
    type TravelLoanItemInput,
    type TravelLoanPayeeInput
  } from '@fms/api'
  import TravelLoanItemDialog from './travel-loan-item-dialog.vue'
  import ExpensePayeeDialog from '../../shared/expense-payee-dialog.vue'
  import { findExpenseCompany } from '../../shared/expense-company'
  import { usePrimaryAssignment } from '../../shared/use-primary-assignment'

  interface OpenData {
    row?: TravelLoan
    copy?: boolean
  }
  interface ItemDialogExpose {
    handleOpen: (data: {
      item?: TravelLoanItemInput
      tenantId: string
      applicantEmployeeId: string
      multipleTravelers: boolean
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

  const emit = defineEmits<{ success: [] }>()
  const dialogRef = ref<ArtDialogExpose<OpenData>>()
  const { hasAuth } = useAuth()
  const captureOperation = useTenantOperationGuard('FinanceLoanApplication:View')
  const session = useArtOverlaySession(() => Boolean(unref(dialogRef.value?.visible)))
  const formRef = ref<InstanceType<typeof ArtForm>>()
  const itemDialogRef = ref<ItemDialogExpose>()
  const payeeDialogRef = ref<PayeeDialogExpose>()
  const {
    deleteGuardRef: itemGuardRef,
    deleteRecord: deleteItem,
    inspectDeleteReferences: inspectItemReferences
  } = useRecordDeleteGuard('fms_travel_loan_item', '借款明细')
  const {
    deleteGuardRef: payeeGuardRef,
    deleteRecord: deletePayee,
    inspectDeleteReferences: inspectPayeeReferences
  } = useRecordDeleteGuard('fms_travel_loan_payee', '收款明细')
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
  const loanItems = ref<TravelLoanItemInput[]>([])
  const payees = ref<TravelLoanPayeeInput[]>([])
  const removedItems = ref<Array<{ id: string; label: string }>>([])
  const removedPayees = ref<Array<{ id: string; label: string }>>([])
  const editingItemIndex = ref<number | null>(null)
  const editingPayeeIndex = ref<number | null>(null)
  const initial = (): TravelLoanInput => ({
    tenantId: defaultWriteTenantId.value ?? '',
    applicantEmployeeId: getUserInfo.value.hrEmployeeId ?? '',
    assignmentId: null,
    applicationDate: dayjs().format('YYYY-MM-DD'),
    expenseDepartmentId: getUserInfo.value.hrEmployee?.organizationId ?? null,
    repaymentDate: dayjs().add(30, 'day').format('YYYY-MM-DD'),
    multipleTravelers: false,
    reason: '',
    remark: null,
    attachmentUrls: []
  })
  const model = ref<TravelLoanInput>(initial())
  const { selectPrimaryAssignment } = usePrimaryAssignment(model)
  const loanTotal = computed(() =>
    loanItems.value.reduce((sum, item) => sum + Number(item.amount), 0)
  )
  const payeeTotal = computed(() =>
    payees.value.reduce((sum, item) => sum + Number(item.amount), 0)
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
    { key: 'applicantEmployeeId', label: '申请人', type: 'input' },
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
      key: 'applicationDate',
      label: '申请日期',
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
    {
      key: 'repaymentDate',
      label: '还款日期',
      type: 'date',
      props: { type: 'date', valueFormat: 'YYYY-MM-DD' }
    },
    { key: 'multipleTravelers', label: '多出差人', type: 'switch' },
    {
      key: 'reason',
      label: '借款事由',
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
  const rules = {
    applicantEmployeeId: [{ required: true, message: '请选择申请人', trigger: 'change' }],
    applicationDate: [{ required: true, message: '请选择申请日期', trigger: 'change' }],
    expenseDepartmentId: [{ required: true, message: '请选择费用承担部门', trigger: 'change' }],
    repaymentDate: [{ required: true, message: '请选择还款日期', trigger: 'change' }],
    reason: [{ required: true, message: '请填写借款事由', trigger: 'blur' }]
  }
  const itemColumns: ColumnOption<TravelLoanItemInput>[] = [
    {
      prop: 'expenseItemId',
      label: '费用项目',
      minWidth: 160,
      formatter: (row) => expenseNames.value.get(row.expenseItemId) ?? '已关联费用项目'
    },
    {
      prop: 'projectId',
      label: '项目',
      minWidth: 140,
      formatter: (row) =>
        row.projectId ? (projectNames.value.get(row.projectId) ?? '已关联项目') : '—'
    },
    {
      prop: 'borrowerEmployeeId',
      label: '借款人',
      minWidth: 120,
      formatter: (row) =>
        row.borrowerEmployeeId === model.value.applicantEmployeeId
          ? selectedApplicant.value[0]?.employeeName || '申请人'
          : '已授权借款人'
    },
    {
      prop: 'amount',
      label: '借款金额',
      width: 130,
      align: 'right',
      formatter: (row) => formatCurrencyValue(row.amount)
    },
    { prop: 'purpose', label: '借款用途', minWidth: 170, showOverflowTooltip: true },
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
              model.value.id ? 'FinanceLoanApplication:Edit' : 'FinanceLoanApplication:Add'
            }
            onClick={() => editItem(row)}
          />
          <ArtButtonTable
            icon="ri:file-copy-line"
            label="复制借款明细"
            permission={
              model.value.id ? 'FinanceLoanApplication:CopyItem' : 'FinanceLoanApplication:Add'
            }
            onClick={() => copyItem(row)}
          />
          <ArtButtonTable
            type="delete"
            permission={
              model.value.id ? 'FinanceLoanApplication:DeleteItem' : 'FinanceLoanApplication:Add'
            }
            onClick={() => removeItem(row)}
          />
        </BusinessTableRowActions>
      )
    }
  ]
  const payeeColumns: ColumnOption<TravelLoanPayeeInput>[] = [
    {
      prop: 'settlementMethod',
      label: '支付方式',
      minWidth: 140,
      dict: { code: 'fmsSettlementMethod', display: 'text' }
    },
    {
      prop: 'payeeType',
      label: '收款人类型',
      width: 110,
      dict: { code: 'fmsPayeeType', display: 'text' }
    },
    {
      prop: 'payeeName',
      label: '收款人',
      minWidth: 130,
      formatter: (row) => row.payeeName || '已选收款人'
    },
    { prop: 'bankAccount', label: '银行账号', minWidth: 180, showOverflowTooltip: true },
    { prop: 'accountName', label: '账户名称', minWidth: 130, showOverflowTooltip: true },
    { prop: 'bankName', label: '开户银行', minWidth: 170, showOverflowTooltip: true },
    {
      prop: 'amount',
      label: '收款金额',
      width: 125,
      align: 'right',
      formatter: (row) => formatCurrencyValue(row.amount)
    },
    { prop: 'remark', label: '备注', minWidth: 150, showOverflowTooltip: true },
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
              model.value.id ? 'FinanceLoanApplication:Edit' : 'FinanceLoanApplication:Add'
            }
            onClick={() => editPayee(row)}
          />
          <ArtButtonTable
            icon="ri:file-copy-line"
            label="复制收款明细"
            permission={
              model.value.id ? 'FinanceLoanApplication:CopyPayee' : 'FinanceLoanApplication:Add'
            }
            onClick={() => copyPayee(row)}
          />
          <ArtButtonTable
            type="delete"
            permission={
              model.value.id ? 'FinanceLoanApplication:DeletePayee' : 'FinanceLoanApplication:Add'
            }
            onClick={() => removePayee(row)}
          />
        </BusinessTableRowActions>
      )
    }
  ]
  function setApplicant(id: string | undefined): void {
    model.value.applicantEmployeeId = id ?? ''
    model.value.assignmentId = null
    const organizationId = selectedApplicant.value[0]?.organizationId
    if (organizationId) model.value.expenseDepartmentId = organizationId
    void selectPrimaryAssignment()
  }
  function addItem(): void {
    editingItemIndex.value = null
    void itemDialogRef.value?.handleOpen({
      tenantId: model.value.tenantId,
      applicantEmployeeId: model.value.applicantEmployeeId,
      multipleTravelers: model.value.multipleTravelers
    })
  }
  function editItem(item: TravelLoanItemInput): void {
    editingItemIndex.value = loanItems.value.indexOf(item)
    void itemDialogRef.value?.handleOpen({
      item,
      tenantId: model.value.tenantId,
      applicantEmployeeId: model.value.applicantEmployeeId,
      multipleTravelers: model.value.multipleTravelers
    })
  }
  function copyItem(item: TravelLoanItemInput): void {
    editingItemIndex.value = null
    void itemDialogRef.value?.handleOpen({
      item,
      copy: true,
      tenantId: model.value.tenantId,
      applicantEmployeeId: model.value.applicantEmployeeId,
      multipleTravelers: model.value.multipleTravelers
    })
  }
  function saveItem(item: TravelLoanItemInput): void {
    if (editingItemIndex.value === null) loanItems.value.push(item)
    else loanItems.value.splice(editingItemIndex.value, 1, item)
    editingItemIndex.value = null
  }
  async function removeItem(item: TravelLoanItemInput): Promise<void> {
    const index = loanItems.value.indexOf(item)
    if (index < 0) return
    if (!item.id) {
      loanItems.value.splice(index, 1)
      return
    }
    await deleteItem({
      resource: { id: item.id, label: expenseNames.value.get(item.expenseItemId) ?? '借款明细' },
      permission: 'FinanceLoanApplication:DeleteItem',
      confirmMessage: '从草稿中移除此借款明细？保存借款单后生效。',
      remove: async () => {
        removedItems.value.push({
          id: item.id!,
          label: expenseNames.value.get(item.expenseItemId) ?? '借款明细'
        })
        loanItems.value.splice(index, 1)
      }
    })
  }
  function addPayee(): void {
    editingPayeeIndex.value = null
    void payeeDialogRef.value?.handleOpen({
      tenantId: model.value.tenantId,
      employeeId: model.value.applicantEmployeeId,
      documentType: 'loan',
      defaultAmount: Math.max(loanTotal.value - payeeTotal.value, 0)
    })
  }
  function editPayee(payee: TravelLoanPayeeInput): void {
    editingPayeeIndex.value = payees.value.indexOf(payee)
    void payeeDialogRef.value?.handleOpen({
      payee,
      tenantId: model.value.tenantId,
      employeeId: model.value.applicantEmployeeId,
      documentType: 'loan',
      defaultAmount: payee.amount
    })
  }
  function copyPayee(payee: TravelLoanPayeeInput): void {
    editingPayeeIndex.value = null
    void payeeDialogRef.value?.handleOpen({
      payee,
      copy: true,
      tenantId: model.value.tenantId,
      employeeId: model.value.applicantEmployeeId,
      documentType: 'loan',
      defaultAmount: payee.amount
    })
  }
  function savePayee(payee: TravelLoanPayeeInput): void {
    if (editingPayeeIndex.value === null) payees.value.push(payee)
    else payees.value.splice(editingPayeeIndex.value, 1, payee)
    editingPayeeIndex.value = null
  }
  async function removePayee(payee: TravelLoanPayeeInput): Promise<void> {
    const index = payees.value.indexOf(payee)
    if (index < 0) return
    if (!payee.id) {
      payees.value.splice(index, 1)
      return
    }
    await deletePayee({
      resource: { id: payee.id, label: payee.payeeName || '收款明细' },
      permission: 'FinanceLoanApplication:DeletePayee',
      confirmMessage: '从草稿中移除此收款明细？保存借款单后生效。',
      remove: async () => {
        removedPayees.value.push({ id: payee.id!, label: payee.payeeName || '收款明细' })
        payees.value.splice(index, 1)
      }
    })
  }
  async function loadOptions(isCurrent: () => boolean): Promise<void> {
    const [organizationsResult, expenseResult, projectResult] = await Promise.all([
      fetchEnabledOrganizationTree({ tenantId: model.value.tenantId }),
      fetchExpenseItemTree({ tenantId: model.value.tenantId, isEnabled: true }),
      fetchExpenseProjectOptions(model.value.tenantId)
    ])
    if (!isCurrent()) return
    organizations.value = organizationsResult.data ?? []
    expenseNames.value = new Map(
      expenseTreeUtils
        .treeToList(expenseResult.data ?? [])
        .flatMap((item) => (item.id ? [[item.id, item.itemName] as const] : []))
    )
    projectNames.value = new Map(
      (projectResult.data ?? []).map((project) => [project.id, project.projectName])
    )
  }
  async function handleOpen(data: OpenData = {}): Promise<void> {
    const scopeCurrent = captureOperation()
    const version = session.invalidate()
    const permissions = data.copy
      ? ['FinanceLoanApplication:Add', 'FinanceLoanApplication:Copy']
      : [data.row?.id ? 'FinanceLoanApplication:Edit' : 'FinanceLoanApplication:Add']
    const contextCurrent = () =>
      scopeCurrent() &&
      session.version.value === version &&
      permissions.every((permission) => hasAuth(permission))
    if (!contextCurrent()) return
    const isCurrent = () => contextCurrent() && session.isCurrent(version)
    try {
      const detail = data.row ? (await fetchTravelLoanDetail(data.row.id)).data : null
      if (!contextCurrent()) return
      const editingRejected = !data.copy && detail?.status === 'rejected'
      model.value = detail
        ? {
            id: data.copy ? undefined : detail.id,
            copySourceId: data.copy ? detail.id : undefined,
            tenantId: detail.tenantId,
            applicantEmployeeId: detail.applicantEmployeeId,
            assignmentId: detail.assignmentId,
            applicationDate: data.copy ? dayjs().format('YYYY-MM-DD') : detail.applicationDate,
            expenseDepartmentId: detail.expenseDepartmentId,
            repaymentDate: data.copy
              ? dayjs().add(30, 'day').format('YYYY-MM-DD')
              : detail.repaymentDate,
            multipleTravelers: detail.multipleTravelers,
            reason: detail.reason,
            remark: detail.remark,
            attachmentUrls: detail.attachmentUrls
          }
        : initial()
      loanItems.value = (detail?.items ?? []).map((item) => ({
        id: data.copy ? undefined : item.id,
        expenseItemId: item.expenseItemId,
        projectId: item.projectId,
        borrowerEmployeeId: item.borrowerEmployeeId,
        amount: item.amount,
        purpose: item.purpose
      }))
      payees.value = (detail?.payees ?? []).map((payee) => ({
        id: data.copy ? undefined : payee.id,
        settlementMethod: payee.settlementMethod,
        payeeType: payee.payeeType,
        payeeInformationId: payee.payeeInformationId,
        payeeName: payee.payeeName,
        bankAccount: payee.bankAccount,
        accountName: payee.accountName,
        bankName: payee.bankName,
        amount: payee.amount,
        remark: payee.remark
      }))
      removedItems.value = []
      removedPayees.value = []
      const applicantReferences = detail
        ? [
            {
              id: detail.applicantEmployeeId,
              tenantId: detail.tenantId,
              employeeNo: detail.applicantEmployeeNo,
              employeeName: detail.applicantName,
              organizationId: detail.applicantOrganizationId,
              avatarUrl: detail.applicantAvatarUrl,
              jobTitle: detail.positionName,
              employmentStatus: ''
            }
          ]
        : model.value.applicantEmployeeId
          ? await fetchEmployeeReferencesByIds(model.value.tenantId, [
              model.value.applicantEmployeeId
            ])
          : []
      if (!contextCurrent()) return
      selectedApplicant.value = applicantReferences
      await loadOptions(contextCurrent)
      if (!contextCurrent()) return
      await selectPrimaryAssignment()
      if (!contextCurrent()) return
      await dialogRef.value?.handleOpen(data, {
        title: data.copy
          ? `复制借款单 · ${detail?.loanNo ?? ''}`
          : detail
            ? `编辑借款单 · ${detail.loanNo}`
            : '新增借款单',
        subtitle: editingRejected
          ? '修改后保留驳回状态和审批记录，可重新提交审批。'
          : '保存草稿后可提交审批；审核通过后可登记付款。',
        confirmText: editingRejected ? '保存修改' : '保存草稿',
        onOpen: () => formRef.value?.clearValidate(),
        onClose: () => {
          session.invalidate()
        },
        onConfirm: async () => {
          if (!isCurrent()) {
            ElMessage.warning('操作范围或权限已变化，请重新打开借款单')
            return false
          }
          try {
            if (!(await validateArtFormForSubmit(formRef.value))) return false
            if (!isCurrent()) return false
            if (!applicantCompanyName.value || !expenseCompanyName.value) {
              notifyFriendlyError(
                new Error('公司信息未配置'),
                '申请人或费用承担公司为空，请联系管理员设置组织'
              )
              return false
            }
            await saveTravelLoanDraft(model.value, loanItems.value, payees.value)
            if (!isCurrent()) return false
            ElMessage.success(
              data.copy
                ? '已复制为新的借款草稿'
                : editingRejected
                  ? '借款修改已保存，可重新提交审批'
                  : '借款草稿已保存'
            )
            emit('success')
            return true
          } catch (error) {
            if (!isCurrent()) return false
            const constraint = getDeleteReferenceContext(error)?.constraint
            if (
              removedItems.value.length &&
              (await inspectItemReferences(removedItems.value, constraint))
            )
              return false
            if (!isCurrent()) return false
            if (
              removedPayees.value.length &&
              (await inspectPayeeReferences(removedPayees.value, constraint))
            )
              return false
            if (!isCurrent()) return false
            notifyFriendlyError(error, '借款单保存失败，请核对明细、收款账户和租户信息后重试')
            return false
          }
        }
      })
    } catch (error) {
      if (contextCurrent()) notifyFriendlyError(error, '借款单加载失败，请刷新列表后重试')
    }
  }
  defineExpose({ handleOpen })
</script>
