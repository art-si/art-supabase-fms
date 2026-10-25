<template>
  <ArtDialog ref="dialogRef" size="lg">
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
      <template #employeeId>
        <ArtEmployeeSelect
          :model-value="model.employeeId ?? undefined"
          @update:model-value="model.employeeId = $event ?? null"
          v-model:selected-data="selectedEmployee"
          :tenant-id="model.tenantId"
          placeholder="选择收款员工"
          @change="handleEmployeeChange"
        />
      </template>
      <template #userEmployeeId>
        <ArtEmployeeSelect
          :model-value="model.userEmployeeId ?? undefined"
          @update:model-value="model.userEmployeeId = $event ?? null"
          v-model:selected-data="selectedUser"
          :tenant-id="model.tenantId"
          placeholder="选择授权使用人"
        />
      </template>
    </ArtForm>
  </ArtDialog>
</template>

<script setup lang="ts">
  import { ElMessage } from 'element-plus'
  import { useDictionaryOptions } from '@/hooks/core/useDictionaryOptions'
  import { useAuth } from '@/hooks/core/useAuth'
  import { useTenantOperationGuard } from '@/hooks/core/useTenantOperationGuard'
  import { useArtOverlaySession } from '@/hooks/core/useArtOverlay'
  import TreeUtils from '@/utils/tree'
  import { useTenantScopeFormPolicy } from '@/hooks/core/useTenantScopeFormPolicy'
  import { notifyFriendlyError } from '@/hooks/core/useArtFeedback'
  import { validateArtFormForSubmit } from '@/utils/form/validate-art-form'
  import ArtDialog from '@/components/core/dialogs/art-dialog/index.vue'
  import type { ArtDialogExpose } from '@/components/core/dialogs/art-dialog/types'
  import ArtForm, { type FormItem } from '@/components/core/forms/art-form/index.vue'
  import ArtEmployeeSelect from '@/components/business/art-employee-select/index.vue'
  import type { EmployeeIntegrationItem } from '@/api/integration/employees'
  import { fetchEnabledOrganizationTree } from '@/api/system-manage'
  import { savePayeeInformation, type PayeeInformation, type PayeeInformationInput } from '@fms/api'

  interface OpenData {
    row?: PayeeInformation
    copy?: boolean
    getEmployee?: boolean
  }

  type FormModel = PayeeInformationInput & { id?: string }

  const emit = defineEmits<{ success: [] }>()
  const dialogRef = ref<ArtDialogExpose<OpenData>>()
  const session = useArtOverlaySession(() => Boolean(unref(dialogRef.value?.visible)))
  let employeeRequestVersion = 0
  let canMaintain = () => false
  const formRef = ref<InstanceType<typeof ArtForm>>()
  const { defaultWriteTenantId } = useTenantScopeFormPolicy()
  const currencyOptions = useDictionaryOptions('mdmCurrency')
  const organizationTreeUtils = new TreeUtils({
    idKey: 'id',
    parentKey: 'parentId',
    childrenKey: 'children'
  })
  const selectedEmployee = ref<EmployeeIntegrationItem[]>([])
  const selectedUser = ref<EmployeeIntegrationItem[]>([])
  const { hasAuth } = useAuth()
  const captureAdd = useTenantOperationGuard('FinancePayeeInformation:Add')
  const captureEdit = useTenantOperationGuard('FinancePayeeInformation:Edit')
  const captureCopy = useTenantOperationGuard('FinancePayeeInformation:Copy')
  const captureGet = useTenantOperationGuard('FinancePayeeInformation:Get')

  const initial = (): FormModel => ({
    tenantId: defaultWriteTenantId.value ?? '',
    isEmployee: true,
    employeeId: null,
    payeeName: '',
    organizationId: null,
    accountName: null,
    bankName: '',
    bankAccount: '',
    currencyCode: 'CNY',
    costCompanyId: null,
    authorizedUse: false,
    userEmployeeId: null,
    isDefault: false,
    remark: null
  })
  const model = ref<FormModel>(initial())

  const items = computed<FormItem[]>(() => [
    { key: 'identity', label: '收款人', type: 'divider', span: 24 },
    {
      key: 'isEmployee',
      label: '是否职员',
      type: 'switch',
      props: { activeText: '职员', inactiveText: '非职员' }
    },
    ...(model.value.isEmployee
      ? [{ key: 'employeeId', label: '收款人', type: 'input' as const }]
      : [
          {
            key: 'payeeName',
            label: '收款人',
            type: 'input' as const,
            props: { maxlength: 100, placeholder: '输入收款人姓名' }
          },
          {
            key: 'organizationId',
            label: '所属部门',
            type: 'treeSelect' as const,
            api: () => fetchEnabledOrganizationTree({ tenantId: model.value.tenantId }),
            resultField: 'data',
            labelField: 'organizationName',
            valueField: 'id',
            childrenField: 'children',
            props: { checkStrictly: true, clearable: true }
          }
        ]),
    { key: 'account', label: '银行账户', type: 'divider', span: 24 },
    {
      key: 'bankName',
      label: '收款银行',
      type: 'input',
      props: { maxlength: 120, placeholder: '输入收款银行及支行名称' }
    },
    {
      key: 'bankAccount',
      label: '银行账号',
      type: 'input',
      props: { maxlength: 64, placeholder: '输入银行账号' }
    },
    {
      key: 'accountName',
      label: '账户名称',
      type: 'input',
      props: { maxlength: 120, placeholder: '选填账户户名' }
    },
    {
      key: 'currencyCode',
      label: '币种',
      type: 'select',
      props: { filterable: true, options: currencyOptions }
    },
    {
      key: 'costCompanyId',
      label: '费用承担公司',
      type: 'treeSelect',
      api: async () => {
        const response = await fetchEnabledOrganizationTree({ tenantId: model.value.tenantId })
        if (response.error) throw response.error
        return organizationTreeUtils.mapTree(response.data ?? [], (item) => ({
          ...item,
          disabled: item.organizationType !== 'company'
        }))
      },
      labelField: 'organizationName',
      valueField: 'id',
      childrenField: 'children',
      props: { filterable: true, clearable: true, checkStrictly: true }
    },
    { key: 'access', label: '使用设置', type: 'divider', span: 24 },
    { key: 'authorizedUse', label: '授权使用', type: 'switch' },
    ...(model.value.authorizedUse
      ? [{ key: 'userEmployeeId', label: '使用人', type: 'input' as const }]
      : []),
    { key: 'isDefault', label: '默认收款信息', type: 'switch' },
    {
      key: 'remark',
      label: '备注',
      type: 'input',
      span: 24,
      props: { type: 'textarea', rows: 3, maxlength: 500, showWordLimit: true }
    }
  ])
  const rules = computed(() => ({
    employeeId: model.value.isEmployee
      ? [{ required: true, message: '请选择收款员工', trigger: 'change' }]
      : [],
    payeeName: !model.value.isEmployee
      ? [{ required: true, message: '请输入收款人', trigger: 'blur' }]
      : [],
    bankName: [{ required: true, message: '请输入收款银行', trigger: 'blur' }],
    bankAccount: [{ required: true, message: '请输入银行账号', trigger: 'blur' }],
    currencyCode: [{ required: true, message: '请选择币种', trigger: 'change' }]
  }))

  async function handleEmployeeChange(
    _id: string | string[] | undefined,
    rows: EmployeeIntegrationItem[]
  ): Promise<void> {
    const requestVersion = ++employeeRequestVersion
    const version = session.version.value
    const selected = rows[0]
    if (!canMaintain()) return
    const previousPayeeName = model.value.payeeName
    if (!selected) {
      if (model.value.accountName === previousPayeeName) model.value.accountName = null
      model.value.payeeName = ''
      model.value.organizationId = null
      model.value.costCompanyId = null
      return
    }
    if (!model.value.accountName || model.value.accountName === previousPayeeName)
      model.value.accountName = selected.employeeName
    model.value.payeeName = selected.employeeName
    model.value.organizationId = selected.organizationId ?? null
    model.value.costCompanyId = null
    if (!selected.organizationId) return
    let response: Awaited<ReturnType<typeof fetchEnabledOrganizationTree>>
    try {
      response = await fetchEnabledOrganizationTree({ tenantId: model.value.tenantId })
      if (response.error) throw response.error
    } catch (error) {
      if (requestVersion === employeeRequestVersion && session.isCurrent(version) && canMaintain())
        notifyFriendlyError(error, '员工所属公司未加载，请重新选择员工后重试')
      return
    }
    if (
      requestVersion !== employeeRequestVersion ||
      !session.isCurrent(version) ||
      !canMaintain() ||
      model.value.employeeId !== selected.id
    )
      return
    const tree = response.data ?? []
    const path = organizationTreeUtils.getPathToNode(tree, selected.organizationId) ?? []
    const companyId = path
      .reverse()
      .find((id) => organizationTreeUtils.findNode(tree, id)?.organizationType === 'company')
    model.value.costCompanyId = companyId ? String(companyId) : null
  }

  async function handleOpen(data: OpenData = {}): Promise<void> {
    const row = data.row
    const isCurrent = row && !data.copy ? captureEdit() : captureAdd()
    const isCurrentAction = data.copy ? captureCopy() : data.getEmployee ? captureGet() : () => true
    const canContinue = () => isCurrent() && isCurrentAction()
    if (!hasAuth('FinancePayeeInformation:View') || !canContinue()) return
    session.invalidate()
    employeeRequestVersion++
    const version = session.version.value
    const isCurrentSession = () => canContinue() && session.isCurrent(version)
    canMaintain = isCurrentSession
    model.value = {
      ...initial(),
      ...(row
        ? {
            tenantId: row.tenantId,
            isEmployee: row.isEmployee,
            employeeId: row.employeeId,
            payeeName: row.payeeName,
            organizationId: row.organizationId,
            accountName: row.accountName,
            bankName: row.bankName,
            bankAccount: row.bankAccount,
            currencyCode: row.currencyCode,
            costCompanyId: row.costCompanyId,
            authorizedUse: row.authorizedUse,
            userEmployeeId: row.userEmployeeId,
            remark: row.remark,
            id: data.copy ? undefined : row.id,
            isDefault: data.copy ? false : row.isDefault
          }
        : {})
    }
    selectedEmployee.value = row?.employeeId
      ? [
          {
            id: row.employeeId,
            tenantId: row.tenantId,
            employeeNo: row.payeeEmployeeNo ?? '',
            employeeName: row.payeeName,
            employmentStatus: ''
          }
        ]
      : []
    selectedUser.value = row?.userEmployeeId
      ? [
          {
            id: row.userEmployeeId,
            tenantId: row.tenantId,
            employeeNo: '',
            employeeName: row.userEmployeeName ?? '使用人',
            employmentStatus: ''
          }
        ]
      : []
    await dialogRef.value?.handleOpen(data, {
      onClose: () => {
        session.invalidate()
        employeeRequestVersion++
        return true
      },
      title: data.getEmployee
        ? '一键获取员工收款信息'
        : row && !data.copy
          ? '编辑收款信息'
          : data.copy
            ? '复制收款信息'
            : '新增收款信息',
      subtitle: data.getEmployee
        ? '从员工花名册选择人员，再补全银行资料后保存。'
        : '银行与账号为必填；职员资料会从员工花名册同步。',
      confirmText: row && !data.copy ? '保存更改' : '保存收款信息',
      onOpen: () => formRef.value?.clearValidate(),
      onConfirm: async () => {
        try {
          if (!isCurrentSession()) {
            ElMessage.warning('操作范围或权限已变化，请重新打开收款信息')
            return false
          }
          if (!(await validateArtFormForSubmit(formRef.value))) return false
          if (!isCurrentSession()) {
            ElMessage.warning('操作范围或权限已变化，请重新打开收款信息')
            return false
          }
          const { id, ...payload } = model.value
          await savePayeeInformation(payload, id)
          if (!isCurrentSession()) return false
          ElMessage.success(id ? '收款信息已更新' : '收款信息已保存')
          emit('success')
          return true
        } catch (error) {
          if (isCurrentSession())
            notifyFriendlyError(error, '收款信息保存失败，请检查银行、员工及租户信息后重试')
          return false
        }
      }
    })
  }
  defineExpose({ handleOpen })
</script>
