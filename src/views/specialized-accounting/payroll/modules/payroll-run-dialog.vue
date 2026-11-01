<template>
  <ArtDialog ref="dialogRef" size="sm"
    ><template v-if="!form.id" #subtitle
      >每个会计期间仅保留一个薪资批次；创建后在明细工作台维护员工金额。</template
    >
    <ElAlert v-if="periodLoadFailed" type="error" :closable="false" show-icon class="mb-4">
      <template #title>会计期间加载失败，请重新加载后再保存。</template>
      <ElButton plain type="primary" @click="loadPeriods">重新加载期间</ElButton>
    </ElAlert>
    <ArtForm
      ref="formRef"
      v-model="form"
      :items="items"
      :rules="rules"
      :span="24"
      label-width="106px"
  /></ArtDialog>
</template>
<script setup lang="ts">
  import { useAccountingPeriodOptions } from '../../../modules/use-accounting-period-options'
  import { notifyFriendlyError } from '@/hooks/core/useArtFeedback'
  import { validateArtFormForSubmit } from '@/utils/form/validate-art-form'
  import { createFinancePrerequisiteOverlay } from '../../../modules/use-finance-account-set-prerequisite'
  import type { FormRules } from 'element-plus'
  import ArtDialog from '@/components/core/dialogs/art-dialog/index.vue'
  import type { ArtDialogExpose } from '@/components/core/dialogs/art-dialog/types'
  import ArtForm, { type FormItem } from '@/components/core/forms/art-form/index.vue'
  import { fetchAccountSetOptions, fetchPayrollRunDetail, savePayrollRun } from '@fms/api'
  import { canEditField } from '@/utils/field-permission'
  import { ACCOUNTING_SELECT_EMPTY_TEXT } from '../../../modules/accounting-select-text'
  defineOptions({ name: 'FinancePayrollRunDialog' })
  const emit = defineEmits<{ success: [] }>()
  const dialogRef = ref<ArtDialogExpose>()
  const prerequisiteOverlay = createFinancePrerequisiteOverlay(dialogRef)
  const formRef = ref<{ validate: () => Promise<boolean>; clearValidate: () => void }>()
  const accountSetOptions = ref<Api.Fms.AccountSetOption[]>([])
  const fieldAccess = ref<Api.Fms.PayrollFieldAccessMap>({})
  const form = ref<Api.Fms.SavePayrollRunPayload & { accountSetId: string }>({
    accountSetId: '',
    accountingPeriodId: '',
    salaryExpenseSubjectId: null,
    salaryPayableSubjectId: null,
    taxPayableSubjectId: null,
    socialSecurityPayableSubjectId: null,
    remark: null
  })
  const canEditReferences = computed(
    () => !form.value.id || canEditField(fieldAccess.value, 'payrollReferences')
  )
  const { periodOptions, periodsLoading, periodLoadFailed, loadPeriods, resetPeriods } =
    useAccountingPeriodOptions(
      computed({
        get: () => form.value.accountSetId,
        set: (value) => {
          form.value.accountSetId = value
        }
      }),
      computed({
        get: () => form.value.accountingPeriodId,
        set: (value) => {
          form.value.accountingPeriodId = value
        }
      }),
      computed(() => Boolean(form.value.id))
    )
  const rules: FormRules = {
    accountSetId: [{ required: true, message: '请选择账套', trigger: 'change' }],
    accountingPeriodId: [{ required: true, message: '请选择开放期间', trigger: 'change' }]
  }
  const items = computed<FormItem[]>(() => [
    {
      label: '所属账套',
      key: 'accountSetId',
      type: 'select',
      props: {
        options: accountSetOptions.value,
        filterable: true,
        onChange: loadPeriods,
        disabled: Boolean(form.value.id),
        noDataText: ACCOUNTING_SELECT_EMPTY_TEXT.accountSet
      }
    },
    {
      label: '会计期间',
      key: 'accountingPeriodId',
      type: 'select',
      props: {
        options: periodOptions.value,
        disabled:
          Boolean(form.value.id) ||
          !form.value.accountSetId ||
          periodsLoading.value ||
          periodLoadFailed.value,
        loading: periodsLoading.value,
        placeholder: '选择开放期间',
        noDataText: form.value.accountSetId
          ? ACCOUNTING_SELECT_EMPTY_TEXT.openAccountingPeriod
          : ACCOUNTING_SELECT_EMPTY_TEXT.chooseAccountSet
      }
    },
    {
      label: '备注',
      key: 'remark',
      type: 'input',
      props: { type: 'textarea', rows: 3, maxlength: 300 }
    }
  ])
  async function submit(): Promise<boolean> {
    try {
      if (periodsLoading.value || periodLoadFailed.value) return false
      if (!(await validateArtFormForSubmit(formRef.value))) return false
      const result = await savePayrollRun({
        id: form.value.id,
        accountingPeriodId: form.value.accountingPeriodId,
        ...(canEditReferences.value
          ? {
              salaryExpenseSubjectId: form.value.salaryExpenseSubjectId || null,
              salaryPayableSubjectId: form.value.salaryPayableSubjectId || null,
              taxPayableSubjectId: form.value.taxPayableSubjectId || null,
              socialSecurityPayableSubjectId: form.value.socialSecurityPayableSubjectId || null
            }
          : {}),
        remark: form.value.remark
      })
      if (result.error) throw result.error
      emit('success')
      return true
    } catch (error) {
      notifyFriendlyError(error, '工资批次保存失败，请检查内容后重试')
      return false
    }
  }
  async function handleOpen(row?: Api.Fms.PayrollRunRecord, accountSetId?: string): Promise<void> {
    resetPeriods()
    accountSetOptions.value = []
    fieldAccess.value = {}
    form.value.id = undefined
    const prepare = async () => {
      const { data: accountSets, error } = await fetchAccountSetOptions({
        status: 'active',
        from: 0,
        to: 999
      })
      if (error) throw error
      accountSetOptions.value = accountSets ?? []
      const detailResult = row ? await fetchPayrollRunDetail(row.id) : undefined
      if (detailResult?.error) throw detailResult.error
      if (row && !detailResult?.data) throw new Error('薪资批次不存在或已不可访问，请刷新列表')
      const record = detailResult?.data ?? undefined
      if (
        !record &&
        accountSetId &&
        !accountSetOptions.value.some((item) => item.value === accountSetId)
      ) {
        throw new Error('所选账套已不可用，请刷新列表后重试')
      }
      fieldAccess.value = record?.fieldAccess ?? {}
      Object.assign(form.value, {
        id: record?.id,
        accountSetId:
          record?.accountSetId ?? accountSetId ?? accountSetOptions.value[0]?.value ?? '',
        accountingPeriodId: record?.accountingPeriodId || '',
        salaryExpenseSubjectId: canEditField(record?.fieldAccess, 'payrollReferences')
          ? (record?.salaryExpenseSubjectId ?? null)
          : null,
        salaryPayableSubjectId: canEditField(record?.fieldAccess, 'payrollReferences')
          ? (record?.salaryPayableSubjectId ?? null)
          : null,
        taxPayableSubjectId: canEditField(record?.fieldAccess, 'payrollReferences')
          ? (record?.taxPayableSubjectId ?? null)
          : null,
        socialSecurityPayableSubjectId: canEditField(record?.fieldAccess, 'payrollReferences')
          ? (record?.socialSecurityPayableSubjectId ?? null)
          : null,
        remark: record?.remark || null
      })
      await loadPeriods()
    }
    await dialogRef.value?.handleOpen(undefined, {
      title: row ? `编辑薪资批次 · ${row.runNo}` : '新建薪资批次',
      confirmText: row ? '保存修改' : '创建批次',
      loading: true,
      loadingText: '正在加载薪资批次与账套…',
      onConfirm: submit,
      onOpen: async () => {
        try {
          await prepare()
          formRef.value?.clearValidate()
        } catch (error) {
          notifyFriendlyError(error, '薪资批次加载失败，请重新打开重试')
          await dialogRef.value?.handleClose()
        } finally {
          prerequisiteOverlay.finishLoading()
        }
      },
      dialogProps: { closeOnClickModal: false }
    })
  }
  defineExpose({ handleOpen, ...prerequisiteOverlay })
</script>
