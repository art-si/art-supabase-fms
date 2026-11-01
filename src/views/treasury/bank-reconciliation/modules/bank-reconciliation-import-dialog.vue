<template>
  <ArtDialog
    ref="dialogRef"
    @open="
      () => {
        activeTab = ''
      }
    "
    size="lg"
  >
    <template #subtitle>
      导入前请核对对账期间和期初、期末余额；对方账号只保存掩码，不保留明文。
    </template>
    <div class="bank-import-dialog">
      <ArtForm
        root-class="art-form--mobile-stack"
        ref="formRef"
        v-model:active-tab="activeTab"
        v-model="form.data"
        :items="formItems"
        :rules="form.rules"
        :span="12"
        :gutter="20"
        label-width="112px"
        ><template #bankLines
          ><div class="space-y-4"
            ><section class="bank-import-dialog__lines">
              <div class="bank-import-dialog__lines-header">
                <div>
                  <strong>银行流水明细</strong>
                  <span>支持一笔银行流水匹配多笔资金流水，也支持一笔资金流水分摊匹配。</span>
                </div>
                <ElButton type="primary" plain @click="addLine">
                  <ArtSvgIcon icon="ri:add-line" />
                  添加流水
                </ElButton>
              </div>
              <ArtTable
                ref="lineTableRef"
                :data="form.data.lines"
                :columns="lineColumns"
                :pagination="false"
                table-layout="fixed"
                max-height="360"
                ><template #transactionDate="{ row }">
                  <ElDatePicker
                    v-model="row.transactionDate"
                    type="date"
                    value-format="YYYY-MM-DD"
                    placeholder="选择日期"
                    class="!w-full"
                  />
                </template>
                <template #direction="{ row }">
                  <ElSegmented
                    v-model="row.direction"
                    :options="getDictMap.fmsFundLedgerDirection ?? []"
                    aria-label="银行流水方向"
                  />
                </template>
                <template #amount="{ row }">
                  <ElInputNumber
                    v-model="row.amount"
                    :min="0"
                    :precision="2"
                    :controls="false"
                    class="!w-full"
                  />
                </template>
                <template #counterparty="{ row }">
                  <div class="grid gap-2">
                    <ElInput
                      v-model="row.counterpartyName"
                      maxlength="120"
                      placeholder="对方户名"
                    />
                    <ElInput
                      v-model="row.counterpartyAccount"
                      maxlength="64"
                      show-password
                      autocomplete="new-password"
                      placeholder="保存后仅显示尾号"
                    />
                  </div>
                </template>
                <template #reference="{ row }">
                  <div class="grid gap-2">
                    <ElInput
                      v-model="row.bankReference"
                      maxlength="120"
                      placeholder="用于自动匹配"
                    />
                    <ElInput v-model="row.bankMemo" maxlength="300" placeholder="银行交易摘要" />
                  </div>
                </template>
                <template #operation="{ $index }">
                  <BusinessTableRowActions>
                    <ArtButtonTable
                      type="delete"
                      label="移除待导入流水"
                      permission=""
                      :disabled="form.data.lines.length <= 1"
                      @click="removeLine($index)"
                    />
                  </BusinessTableRowActions> </template
              ></ArtTable> </section></div></template
      ></ArtForm>

      <ElAlert
        v-if="submitError"
        class="mt-4"
        type="error"
        :closable="false"
        show-icon
        title="银行流水尚未导入"
        :description="submitError"
      />
    </div>
  </ArtDialog>
</template>

<script setup lang="ts">
  import { notifyFriendlyError } from '@/hooks/core/useArtFeedback'
  import { getFriendlySupabaseErrorMessage } from '@/utils/supabase'
  import { validateArtFormForSubmit } from '@/utils/form/validate-art-form'
  import { createFinancePrerequisiteOverlay } from '../../../modules/use-finance-account-set-prerequisite'
  import ArtTable, { type ArtTableExpose } from '@/components/core/tables/art-table/index.vue'
  import type { ColumnOption } from '@/types'
  import ArtButtonTable from '@/components/core/forms/art-button-table/index.vue'
  import BusinessTableRowActions from '@/components/business/business-table-row-actions/index.vue'
  import { normalizeNullableText } from '@/utils/form/normalize'
  import dayjs from 'dayjs'
  import type { FormRules } from 'element-plus'
  import { storeToRefs } from 'pinia'
  import ArtSvgIcon from '@/components/core/base/art-svg-icon/index.vue'
  import ArtDialog from '@/components/core/dialogs/art-dialog/index.vue'
  import type { ArtDialogExpose } from '@/components/core/dialogs/art-dialog/types'
  import ArtForm, { type FormItem } from '@/components/core/forms/art-form/index.vue'
  import {
    fetchAccountSetOptions,
    fetchFundAccountOptions,
    importBankReconciliation
  } from '@fms/api'
  import { useUserStore } from '@/store/modules/user'

  defineOptions({ name: 'FinanceBankReconciliationImportDialog' })

  type FormData = Api.Fms.ImportBankReconciliationPayload

  const emit = defineEmits<{ success: [] }>()
  const userStore = useUserStore()
  const { getDictMap } = storeToRefs(userStore)
  const dialogRef = ref<ArtDialogExpose>()
  const prerequisiteOverlay = createFinancePrerequisiteOverlay(dialogRef)
  const activeTab = ref('')
  const formRef = ref<InstanceType<typeof ArtForm>>()
  type ImportLine = FormData['lines'][number]
  const lineTableRef = ref<ArtTableExpose<ImportLine>>()
  const lineColumns: ColumnOption<ImportLine>[] = [
    { type: 'index', label: '#', width: 48 },
    {
      prop: 'transactionDate',
      label: '交易日期',
      width: 145,
      useSlot: true,
      required: true,
      headerTooltip: '交易日期必须位于上方选择的对账期间内。',
      rules: {
        validator: ({ value }) =>
          typeof value === 'string' &&
          value >= form.data.statementStartDate &&
          value <= form.data.statementEndDate,
        message: ({ rowIndex }) => '第 ' + (rowIndex + 1) + ' 行交易日期必须位于对账期间内'
      }
    },
    { prop: 'direction', label: '方向', width: 130, useSlot: true, required: true },
    {
      prop: 'amount',
      label: '金额',
      width: 115,
      useSlot: true,
      required: true,
      headerTooltip: '金额必须大于0，最多保留两位小数。',
      rules: {
        validator: ({ value }) => Number.isFinite(value) && Number(value) > 0,
        message: ({ rowIndex }) => '第 ' + (rowIndex + 1) + ' 行流水金额必须大于0'
      }
    },
    { prop: 'counterparty', label: '对方户名 / 账号', minWidth: 180, useSlot: true },
    { prop: 'reference', label: '银行参考号 / 摘要', minWidth: 180, useSlot: true },
    { prop: 'operation', label: '操作', width: 64, fixed: 'right', useSlot: true }
  ]
  const accountSetId = ref('')
  const accountSetOptions = ref<Api.Fms.AccountSetOption[]>([])
  const accountOptions = ref<Api.Fms.FundAccountOption[]>([])
  const submitError = ref('')

  const createLine = (): Api.Fms.ImportBankStatementLinePayload => ({
    transactionDate: dayjs().format('YYYY-MM-DD'),
    direction: 'outflow',
    amount: 0,
    statementBalance: null,
    counterpartyName: null,
    counterpartyAccount: null,
    bankReference: null,
    bankSerialNo: null,
    bankMemo: null
  })

  const createInitialForm = (): FormData => ({
    fundAccountId: '',
    statementStartDate: dayjs().startOf('month').format('YYYY-MM-DD'),
    statementEndDate: dayjs().format('YYYY-MM-DD'),
    openingBalance: 0,
    closingBalance: 0,
    importedFileName: null,
    remark: null,
    lines: [createLine()]
  })

  const form = reactive<{ data: FormData; rules: FormRules<FormData> }>({
    data: createInitialForm(),
    rules: {
      fundAccountId: [{ required: true, message: '请选择对账账户', trigger: 'change' }],
      statementStartDate: [{ required: true, message: '请选择开始日期', trigger: 'change' }],
      statementEndDate: [{ required: true, message: '请选择结束日期', trigger: 'change' }],
      openingBalance: [{ required: true, message: '请输入期初余额', trigger: 'change' }],
      closingBalance: [{ required: true, message: '请输入期末余额', trigger: 'change' }]
    }
  })

  const formItems = computed<FormItem[]>(() => [
    { label: '对账范围', key: 'scopeSection', type: 'tab', span: 24 },
    {
      label: '所属账套',
      key: '__accountSetId',
      type: 'select',
      props: {
        modelValue: accountSetId.value,
        options: accountSetOptions.value,
        filterable: true,
        placeholder: '选择核算账套',
        onChange: (value: string) => void handleAccountSetChange(value)
      }
    },
    {
      label: '对账账户',
      key: 'fundAccountId',
      type: 'select',
      props: {
        options: accountOptions.value,
        filterable: true,
        disabled: !accountSetId.value,
        placeholder: '选择已启用银行对账的账户'
      }
    },
    {
      label: '期间开始',
      key: 'statementStartDate',
      type: 'date',
      props: { valueFormat: 'YYYY-MM-DD', class: '!w-full' }
    },
    {
      label: '期间结束',
      key: 'statementEndDate',
      type: 'date',
      props: { valueFormat: 'YYYY-MM-DD', class: '!w-full' }
    },
    { label: '余额核对', key: 'balanceSection', type: 'divider', span: 24 },
    {
      label: '期初余额',
      key: 'openingBalance',
      type: 'number',
      props: { precision: 2, step: 100, controlsPosition: 'right', class: '!w-full' }
    },
    {
      label: '期末余额',
      key: 'closingBalance',
      type: 'number',
      props: { precision: 2, step: 100, controlsPosition: 'right', class: '!w-full' }
    },
    { label: '导入说明', key: 'sourceSection', type: 'divider', span: 24 },
    {
      label: '来源文件名',
      key: 'importedFileName',
      type: 'input',
      props: { maxlength: 200, placeholder: '例如 2026-08-银行流水.xlsx' }
    },
    {
      label: '导入说明',
      key: 'remark',
      type: 'textarea',
      span: 24,
      props: { placeholder: '选填' }
    },
    { key: 'bankLinesSection', label: '银行流水', type: 'tab' },
    { key: 'bankLines', label: '', span: 24, labelWidth: 0 }
  ])

  function addLine(): void {
    form.data.lines.push(createLine())
  }

  function removeLine(index: number): void {
    if (form.data.lines.length > 1) form.data.lines.splice(index, 1)
  }

  async function handleAccountSetChange(value: string): Promise<void> {
    accountSetId.value = value
    form.data.fundAccountId = ''
    if (!value) {
      accountOptions.value = []
      return
    }
    const { data } = await fetchFundAccountOptions({ accountSetId: value, status: 'active' })
    accountOptions.value = (data ?? []).filter(
      (item) => item.accountType !== 'cash' && item.reconciliationEnabled
    )
  }

  async function validateLines(): Promise<boolean> {
    if (!form.data.lines.length) {
      ElMessage.warning('请至少添加一笔银行流水')
      return false
    }
    const result = await lineTableRef.value?.validate({ focus: false })
    if (result && !result.valid) {
      await formRef.value?.focusField('bankLines')
      if (result.firstError) {
        await lineTableRef.value?.validateField(result.firstError.prop)
        ElMessage.warning(result.firstError.message)
      }
      return false
    }
    const inflow = form.data.lines
      .filter((line) => line.direction === 'inflow')
      .reduce((sum, line) => sum + Number(line.amount), 0)
    const outflow = form.data.lines
      .filter((line) => line.direction === 'outflow')
      .reduce((sum, line) => sum + Number(line.amount), 0)
    if (
      Number((form.data.openingBalance + inflow - outflow).toFixed(2)) !==
      Number(form.data.closingBalance)
    ) {
      ElMessage.warning('期末余额应等于期初余额加流入减流出，请核对银行流水')
      return false
    }
    return true
  }

  async function handleSubmit(): Promise<boolean> {
    submitError.value = ''
    try {
      if (!(await validateArtFormForSubmit(formRef.value))) return false
      if (!(await validateLines())) return false
      await importBankReconciliation({
        ...form.data,
        importedFileName: normalizeNullableText(form.data.importedFileName),
        remark: normalizeNullableText(form.data.remark),
        lines: form.data.lines.map((line) => ({
          ...line,
          counterpartyName: normalizeNullableText(line.counterpartyName),
          counterpartyAccount: normalizeNullableText(line.counterpartyAccount),
          bankReference: normalizeNullableText(line.bankReference),
          bankSerialNo: normalizeNullableText(line.bankSerialNo),
          bankMemo: normalizeNullableText(line.bankMemo)
        }))
      })
      emit('success')
      return true
    } catch (error) {
      submitError.value = getFriendlySupabaseErrorMessage(
        error,
        '请核对对账账户、期间与余额后重试；已填写的流水仍保留在当前表单。'
      )
      notifyFriendlyError(error, '银行流水导入失败，请稍后重试')
      return false
    }
  }

  async function handleOpen(): Promise<void> {
    submitError.value = ''
    accountSetOptions.value = []
    accountSetId.value = ''
    accountOptions.value = []
    Object.assign(form.data, createInitialForm())
    await dialogRef.value?.handleOpen(undefined, {
      title: '导入银行对账单',
      confirmText: '导入并开始对账',
      loading: true,
      loadingText: '正在加载账套…',
      onConfirm: handleSubmit,
      onOpen: async (_openData, api) => {
        formRef.value?.clearValidate()
        try {
          await userStore.ensureDictLoaded('fmsFundLedgerDirection')
          const { data, error } = await fetchAccountSetOptions({
            status: 'active',
            from: 0,
            to: 999
          })
          if (error) throw error
          accountSetOptions.value = data ?? []
          if (accountSetOptions.value.length === 1) {
            await handleAccountSetChange(accountSetOptions.value[0].value)
          }
        } catch (error) {
          notifyFriendlyError(error, '银行对账导入基础资料加载失败，请重试')
          await api.handleClose()
        } finally {
          prerequisiteOverlay.finishLoading()
        }
      },
      dialogProps: { closeOnClickModal: false, destroyOnClose: true }
    })
  }

  defineExpose({ handleOpen, ...prerequisiteOverlay })
</script>

<style scoped lang="scss">
  .bank-import-dialog {
    display: grid;
    gap: 20px;
    min-width: 0;

    &__lines {
      min-width: 0;
      padding-top: 18px;
      border-top: 1px solid var(--el-border-color-lighter);
    }

    &__lines-header {
      display: flex;
      gap: 16px;
      align-items: flex-start;
      justify-content: space-between;
      margin-bottom: 12px;

      > div {
        display: grid;
        gap: 4px;
      }

      span {
        font-size: 12px;
        color: var(--el-text-color-secondary);
      }
    }
  }
</style>
