<template>
  <ArtDialog ref="dialog" title="费用委托管理" size="xl" :show-footer="false">
    <ElAlert
      title="仅管理本人发出的费用委托；受托人须为同租户账号。委托仅在所选单据范围和有效期内生效。"
      type="info"
      :closable="false"
      class="mb-4"
    />
    <ArtAsyncState :loading="loading" :error="loadError" @retry="loadData">
      <div class="mb-4 flex flex-wrap justify-end gap-2">
        <ElButton
          v-auth="'FinanceExpenseReimbursement:Delegate'"
          type="primary"
          :disabled="busy"
          @click="edit()"
          >新增委托</ElButton
        >
        <ElButton :disabled="busy" @click="loadData">刷新记录</ElButton>
      </div>
      <ArtTable
        :data="records"
        :columns="columns"
        :pagination="false"
        empty-text="暂无本人发出的费用委托"
        empty-description="新增委托后，同租户受托人可在有效期内为你办理指定费用单据。"
      >
        <template #isActive="{ row }"
          ><ArtDictDisplay dict-code="commonBoolean" :value="String(row.isActive)"
        /></template>
        <template #operation="{ row }">
          <BusinessTableRowActions>
            <ArtButtonTable
              type="edit"
              permission="FinanceExpenseReimbursement:Delegate"
              :disabled="busy"
              @click="edit(row)"
            />
            <ElButton
              v-auth="'FinanceExpenseReimbursement:Delegate'"
              link
              type="warning"
              :disabled="busy || !row.isActive"
              @click="revoke(row)"
              >撤销委托</ElButton
            >
          </BusinessTableRowActions>
        </template>
      </ArtTable>
    </ArtAsyncState>
  </ArtDialog>
  <ArtDialog ref="editor" size="md">
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
</template>

<script setup lang="ts">
  import { computed, ref, unref } from 'vue'
  import dayjs from 'dayjs'
  import { ElMessage } from 'element-plus'
  import ArtDialog from '@/components/core/dialogs/art-dialog/index.vue'
  import type { ArtDialogExpose } from '@/components/core/dialogs/art-dialog/types'
  import ArtForm, { type FormItem } from '@/components/core/forms/art-form/index.vue'
  import ArtTable from '@/components/core/tables/art-table/index.vue'
  import BusinessTableRowActions from '@/components/business/business-table-row-actions/index.vue'
  import { useUserStore } from '@/store/modules/user'
  import { useAuth } from '@/hooks/core/useAuth'
  import { useArtOverlaySession } from '@/hooks/core/useArtOverlay'
  import { useArtFeedback, notifyFriendlyError } from '@/hooks/core/useArtFeedback'
  import { useDictionaryOptions } from '@/hooks/core/useDictionaryOptions'
  import { fetchEnabledOrganizationUserList } from '@/api/system-manage'
  import { validateArtFormForSubmit } from '@/utils/form/validate-art-form'
  import type { ArtUserSelectOption } from '@/components/core/forms/art-user-select/types'
  import type { ColumnOption } from '@/types'
  import {
    fetchExpenseDelegations,
    saveExpenseDelegation,
    revokeExpenseDelegation,
    type ExpenseDelegation,
    type ExpenseDelegationInput
  } from '@fms/api/modules/expense/delegation'

  const dialog = ref<ArtDialogExpose>()
  const editor = ref<ArtDialogExpose>()
  const form = ref<InstanceType<typeof ArtForm>>()
  const user = useUserStore()
  const { hasAuth } = useAuth()
  const { confirmAction } = useArtFeedback()
  const session = useArtOverlaySession(() => Boolean(unref(dialog.value?.visible)))
  const loading = ref(false)
  const busy = ref(false)
  const loadError = ref('')
  const records = ref<ExpenseDelegation[]>([])
  const users = ref<ArtUserSelectOption[]>([])
  const scopes = useDictionaryOptions('fmsExpenseDelegationScope')
  const model = ref<ExpenseDelegationInput>({
    delegateUserId: '',
    scopes: [],
    validFrom: '',
    validTo: ''
  })
  const items = computed<FormItem[]>(() => [
    {
      key: 'delegateUserId',
      label: '受托账号',
      type: 'userSelect',
      span: 24,
      props: {
        options: users.value,
        disabled: Boolean(model.value.id),
        placeholder: '选择同租户同事'
      }
    },
    {
      key: 'scopes',
      label: '委托单据范围',
      type: 'checkboxGroup',
      span: 24,
      props: { options: scopes }
    },
    {
      key: 'validFrom',
      label: '开始日期',
      type: 'date',
      span: 12,
      props: { valueFormat: 'YYYY-MM-DD' }
    },
    {
      key: 'validTo',
      label: '结束日期',
      type: 'date',
      span: 12,
      props: { valueFormat: 'YYYY-MM-DD' }
    }
  ])
  const rules = {
    delegateUserId: [{ required: true, message: '请选择受托账号', trigger: 'change' }],
    scopes: [
      {
        type: 'array' as const,
        required: true,
        min: 1,
        message: '请选择至少一种委托单据',
        trigger: 'change'
      }
    ],
    validFrom: [{ required: true, message: '请选择开始日期', trigger: 'change' }],
    validTo: [{ required: true, message: '请选择结束日期', trigger: 'change' }]
  }
  const columns: ColumnOption<ExpenseDelegation>[] = [
    {
      prop: 'delegateUserId',
      label: '受托账号',
      minWidth: 180,
      formatter: (row) => row.delegate?.nickName || row.delegate?.userName || '受托账号已不可用'
    },
    {
      prop: 'scopes',
      label: '委托单据范围',
      minWidth: 240,
      formatter: (row) =>
        row.scopes
          .map((scope) => scopes.find((item) => item.value === scope)?.label || '未知范围')
          .join('、')
    },
    { prop: 'validFrom', label: '开始日期', width: 125 },
    { prop: 'validTo', label: '结束日期', width: 125 },
    {
      prop: 'isActive',
      label: '启用',
      width: 100,
      useSlot: true
    },
    { prop: 'operation', label: '操作', width: 180, fixed: 'right', useSlot: true }
  ]
  async function loadData() {
    if (
      loading.value ||
      !hasAuth('FinanceExpenseReimbursement:Delegate') ||
      !session.isCurrent(session.version.value)
    )
      return
    const version = session.version.value
    loading.value = true
    loadError.value = ''
    try {
      const identity = user.getUserInfo
      if (!identity.hrEmployeeId || !identity.tenantId)
        throw new Error('请先为当前账号绑定员工档案后管理委托')
      const [rows, accounts] = await Promise.all([
        fetchExpenseDelegations(identity.hrEmployeeId, identity.tenantId),
        fetchEnabledOrganizationUserList({ tenantId: identity.tenantId })
      ])
      if (accounts.error) throw accounts.error
      if (!session.isCurrent(version)) return
      records.value = rows
      users.value = (accounts.data ?? [])
        .filter((account) => account.id !== identity.userId)
        .map((account) => ({
          value: account.id,
          label: account.nickName || account.userName,
          userName: account.userName,
          nickName: account.nickName,
          avatar: account.avatar
        }))
    } catch (error) {
      if (session.isCurrent(version)) {
        loadError.value = '费用委托未加载，请核对账号员工档案后重试'
        notifyFriendlyError(error, loadError.value)
      }
    } finally {
      if (session.isCurrent(version)) loading.value = false
    }
  }
  async function handleOpen() {
    if (!hasAuth('FinanceExpenseReimbursement:Delegate')) return
    session.invalidate()
    loading.value = false
    records.value = []
    users.value = []
    await dialog.value?.handleOpen(undefined, {
      onClose: () => {
        session.invalidate()
        void editor.value?.handleClose()
        return true
      }
    })
    await loadData()
  }
  async function edit(row?: ExpenseDelegation) {
    if (
      busy.value ||
      loading.value ||
      loadError.value ||
      !hasAuth('FinanceExpenseReimbursement:Delegate')
    )
      return
    model.value = row
      ? {
          id: row.id,
          delegateUserId: row.delegateUserId,
          scopes: [...row.scopes],
          validFrom: row.validFrom,
          validTo: row.validTo
        }
      : {
          delegateUserId: '',
          scopes: [],
          validFrom: dayjs().format('YYYY-MM-DD'),
          validTo: dayjs().add(30, 'day').format('YYYY-MM-DD')
        }
    const version = session.version.value
    await editor.value?.handleOpen(undefined, {
      title: row ? '编辑费用委托' : '新增费用委托',
      confirmText: '保存委托',
      onOpen: () => form.value?.clearValidate(),
      onConfirm: async () => {
        if (!session.isCurrent(version) || !hasAuth('FinanceExpenseReimbursement:Delegate'))
          return false
        if (!(await validateArtFormForSubmit(form.value))) return false
        if (model.value.validTo < model.value.validFrom) {
          ElMessage.warning('结束日期不能早于开始日期')
          return false
        }
        if (!users.value.some((account) => account.value === model.value.delegateUserId)) {
          ElMessage.warning('受托账号已不可用，请重新选择')
          return false
        }
        busy.value = true
        try {
          await saveExpenseDelegation(model.value)
          ElMessage.success('费用委托已保存')
          await loadData()
          return true
        } catch (error) {
          notifyFriendlyError(error, '费用委托保存失败，请重试')
          return false
        } finally {
          busy.value = false
        }
      }
    })
  }
  async function revoke(row: ExpenseDelegation) {
    if (busy.value || !row.isActive || !hasAuth('FinanceExpenseReimbursement:Delegate')) return
    const version = session.version.value
    try {
      await confirmAction('撤销后，该账号将不能继续依据此委托为你办理费用单据。', '撤销费用委托')
    } catch {
      return
    }
    if (!session.isCurrent(version) || busy.value) return
    busy.value = true
    try {
      await revokeExpenseDelegation(row.id)
      ElMessage.success('费用委托已撤销')
      await loadData()
    } catch (error) {
      notifyFriendlyError(error, '费用委托撤销失败，请重试')
    } finally {
      busy.value = false
    }
  }
  defineExpose({ handleOpen })
</script>
