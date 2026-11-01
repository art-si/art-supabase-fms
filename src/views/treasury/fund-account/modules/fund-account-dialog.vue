<template>
  <ArtDialog ref="dialogRef" size="md">
    <template #subtitle>
      账号仅在保存时用于生成掩码和不可逆指纹，系统不存储完整明文账号。
    </template>
    <ElAlert
      v-if="currencyError"
      class="mb-4"
      type="error"
      :closable="false"
      show-icon
      title="账户币种加载失败"
    >
      <span>请重试后再选择币种。</span>
      <ElButton
        type="primary"
        plain
        :loading="currencyLoading"
        @click="loadCurrencies(form.data.accountSetId)"
      >
        重新加载
      </ElButton>
    </ElAlert>
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
    />
  </ArtDialog>
</template>

<script setup lang="ts">
  import { notifyFriendlyError } from '@/hooks/core/useArtFeedback'
  import { validateArtFormForSubmit } from '@/utils/form/validate-art-form'
  import { normalizeNullableText } from '@/utils/form/normalize'
  import type { FormRules } from 'element-plus'
  import { useDictionaryOptions } from '@/hooks/core/useDictionaryOptions'
  import ArtDialog from '@/components/core/dialogs/art-dialog/index.vue'
  import type { ArtDialogExpose } from '@/components/core/dialogs/art-dialog/types'
  import ArtForm, { type FormItem } from '@/components/core/forms/art-form/index.vue'
  import { fetchAccountSetOptions, fetchCurrencyList, saveFundAccount } from '@fms/api'
  import { canEditField, canViewField } from '@/utils/field-permission'

  defineOptions({ name: 'FinanceFundAccountDialog' })

  type FormData = Omit<Api.Fms.SaveFundAccountPayload, 'openingBalance' | 'frozenBalance'> & {
    openingBalance: Api.Fms.SensitiveNumber
    frozenBalance: Api.Fms.SensitiveNumber
    fieldAccess?: Api.Fms.FundAccountFieldAccessMap
  }
  type Account = Api.Fms.FundAccountRecord

  const emit = defineEmits<{ success: [type: 'add' | 'edit'] }>()
  const accountTypeOptions = useDictionaryOptions('fmsFundAccountType')
  const accountStatusOptions = useDictionaryOptions('fmsFundAccountStatus')
  const booleanOptions = useDictionaryOptions('commonBoolean', (value) => value === 'true')
  const dialogRef = ref<ArtDialogExpose>()
  const formRef = ref<{ validate: () => Promise<boolean>; clearValidate: () => void }>()
  const activeTab = ref('identitySection')
  const accountSetOptions = ref<Api.Fms.AccountSetOption[]>([])
  const currencyOptions = ref<Array<{ label: string; value: string }>>([])
  const currencyLoading = ref(false)
  const currencyError = ref(false)
  let currencyRequestId = 0
  const canViewSensitiveField = (field: Api.Fms.FundAccountFieldKey): boolean =>
    canViewField(form.data.fieldAccess, field, form.data.id ? 'hidden' : 'edit')
  const canEditSensitiveField = (field: Api.Fms.FundAccountFieldKey): boolean =>
    canEditField(form.data.fieldAccess, field, form.data.id ? 'hidden' : 'edit')

  const createInitialForm = (): FormData => ({
    id: undefined,
    fieldAccess: {},
    accountSetId: '',
    currencyId: '',
    accountCode: '',
    accountName: '',
    accountType: 'bank',
    bankName: null,
    bankBranch: null,
    accountNo: null,
    openingBalance: 0,
    frozenBalance: 0,
    status: 'active',
    isDefault: false,
    onlineBankingEnabled: false,
    reconciliationEnabled: true,
    balanceAsOf: null,
    remark: null
  })

  const form = reactive<{ data: FormData; rules: FormRules<FormData> }>({
    data: createInitialForm(),
    rules: {
      accountSetId: [{ required: true, message: '请选择所属账套', trigger: 'change' }],
      currencyId: [{ required: true, message: '请选择账户币种', trigger: 'change' }],
      accountCode: [
        { required: true, whitespace: true, message: '请输入账户编码', trigger: 'blur' },
        {
          pattern: /^[A-Z0-9_-]{2,30}$/,
          message: '请输入 2-30 位大写字母、数字、下划线或连字符',
          trigger: 'blur'
        }
      ],
      accountName: [
        { required: true, whitespace: true, message: '请输入账户名称', trigger: 'blur' }
      ],
      accountType: [{ required: true, message: '请选择账户类型', trigger: 'change' }],
      accountNo: [
        {
          validator: (_rule, value, callback) => {
            if (!form.data.id && !String(value ?? '').trim()) callback(new Error('请输入资金账号'))
            else callback()
          },
          trigger: 'blur'
        }
      ],
      bankName: [
        {
          validator: (_rule, value, callback) => {
            if (
              canEditSensitiveField('accountDetails') &&
              form.data.accountType === 'bank' &&
              !String(value ?? '').trim()
            ) {
              callback(new Error('银行账户必须填写开户银行'))
            } else callback()
          },
          trigger: 'blur'
        }
      ],
      openingBalance: [{ required: true, message: '请输入期初余额', trigger: 'change' }],
      frozenBalance: [{ required: true, message: '请输入冻结金额', trigger: 'change' }],
      balanceAsOf: [
        {
          validator: (_rule, value, callback) => {
            if (Number(form.data.openingBalance) !== 0 && !value) {
              callback(new Error('存在期初余额时必须填写余额日期'))
            } else callback()
          },
          trigger: 'change'
        }
      ]
    }
  })

  const isBank = computed(() => form.data.accountType === 'bank')

  const formItems = computed<FormItem[]>(() => [
    {
      label: '账户信息',
      key: 'identitySection',
      type:
        canViewSensitiveField('accountDetails') || canViewSensitiveField('accountBalances')
          ? 'tab'
          : 'divider',
      span: 24
    },
    {
      label: '所属账套',
      key: 'accountSetId',
      type: 'select',
      span: 24,
      props: {
        options: accountSetOptions.value,
        filterable: true,
        disabled: Boolean(form.data.id),
        placeholder: '选择核算账套',
        onChange: (value: string) => void loadCurrencies(value, true)
      }
    },
    {
      label: '账户币种',
      key: 'currencyId',
      type: 'select',
      props: {
        options: currencyOptions.value,
        filterable: true,
        disabled:
          Boolean(form.data.id) ||
          !form.data.accountSetId ||
          currencyLoading.value ||
          currencyError.value,
        loading: currencyLoading.value,
        placeholder: !form.data.accountSetId ? '请先选择所属账套' : '选择币种'
      }
    },
    {
      label: '账户编码',
      key: 'accountCode',
      type: 'input',
      props: {
        maxlength: 30,
        placeholder: '例如 CMB_BASIC',
        onInput: (value: string) => (form.data.accountCode = value.toUpperCase())
      }
    },
    {
      label: '账户名称',
      key: 'accountName',
      type: 'input',
      props: { maxlength: 80, placeholder: '例如 招商银行基本户' }
    },
    {
      label: '账户类型',
      key: 'accountType',
      type: 'segment',
      props: { options: accountTypeOptions }
    },
    {
      label: '资金与设置',
      key: 'bankSection',
      type:
        canViewSensitiveField('accountDetails') || canViewSensitiveField('accountBalances')
          ? 'tab'
          : 'divider',
      span: 24
    },
    {
      label: '资金账号',
      key: 'accountNo',
      type: 'input',
      hidden: !canViewSensitiveField('accountDetails'),
      props: {
        maxlength: 64,
        showPassword: canEditSensitiveField('accountDetails'),
        disabled: !canEditSensitiveField('accountDetails'),
        autocomplete: 'new-password',
        placeholder: form.data.id ? '留空表示不变' : '输入银行卡号、现金箱编号或钱包账号'
      }
    },
    {
      label: '开户银行',
      key: 'bankName',
      type: 'input',
      hidden: !canViewSensitiveField('accountDetails'),
      props: {
        disabled: !isBank.value || !canEditSensitiveField('accountDetails'),
        maxlength: 80,
        placeholder: '银行账户必填'
      }
    },
    {
      label: '开户支行',
      key: 'bankBranch',
      type: 'input',
      hidden: !canViewSensitiveField('accountDetails'),
      props: {
        disabled: !isBank.value || !canEditSensitiveField('accountDetails'),
        maxlength: 120,
        placeholder: '选填'
      }
    },
    {
      label: '余额管理',
      key: 'balanceSection',
      type: 'divider',
      span: 24,
      hidden: !canViewSensitiveField('accountBalances')
    },
    {
      label: '期初余额',
      key: 'openingBalance',
      type: canEditSensitiveField('accountBalances') ? 'number' : 'text',
      hidden: !canViewSensitiveField('accountBalances'),
      props: canEditSensitiveField('accountBalances')
        ? { precision: 2, step: 100, controlsPosition: 'right', class: '!w-full' }
        : {}
    },
    {
      label: '余额日期',
      key: 'balanceAsOf',
      type: canEditSensitiveField('accountBalances') ? 'date' : 'text',
      hidden: !canViewSensitiveField('accountBalances'),
      props: canEditSensitiveField('accountBalances')
        ? {
            valueFormat: 'YYYY-MM-DD',
            placeholder: '期初余额对应日期',
            class: '!w-full'
          }
        : {}
    },
    {
      label: '冻结金额',
      key: 'frozenBalance',
      type: canEditSensitiveField('accountBalances') ? 'number' : 'text',
      hidden: !canViewSensitiveField('accountBalances'),
      props: canEditSensitiveField('accountBalances')
        ? {
            min: 0,
            precision: 2,
            step: 100,
            controlsPosition: 'right',
            class: '!w-full'
          }
        : {}
    },
    { label: '账户设置', key: 'managementSection', type: 'divider', span: 24 },
    {
      label: '账户状态',
      key: 'status',
      type: 'segment',
      props: { options: accountStatusOptions }
    },
    {
      label: '默认账户',
      key: 'isDefault',
      type: 'segment',
      props: { options: booleanOptions }
    },
    {
      label: '银企直联',
      key: 'onlineBankingEnabled',
      type: 'segment',
      props: { options: booleanOptions, disabled: !isBank.value }
    },
    {
      label: '银行对账',
      key: 'reconciliationEnabled',
      type: 'segment',
      props: { options: booleanOptions, disabled: form.data.accountType === 'cash' }
    },
    {
      label: '备注',
      key: 'remark',
      type: 'input',
      span: 24,
      props: { type: 'textarea', rows: 3, maxlength: 500, showWordLimit: true }
    }
  ])

  async function loadCurrencies(accountSetId: string, reset = false): Promise<void> {
    const requestId = ++currencyRequestId
    currencyOptions.value = []
    currencyError.value = false
    currencyLoading.value = false
    if (reset) form.data.currencyId = ''
    if (!accountSetId) {
      currencyOptions.value = []
      return
    }
    currencyLoading.value = true
    try {
      const { data, error } = await fetchCurrencyList(accountSetId)
      if (requestId !== currencyRequestId) return
      if (error) throw error
      currencyOptions.value = (data ?? [])
        .filter((item) => item.isEnabled)
        .map((item) => ({
          label: `${item.currencyCode} · ${item.currencyName}${item.isBase ? '（本位币）' : ''}`,
          value: item.id
        }))
      if (reset && currencyOptions.value.length === 1) {
        form.data.currencyId = currencyOptions.value[0].value
      }
    } catch (error) {
      if (requestId !== currencyRequestId) return
      currencyError.value = true
      notifyFriendlyError(error, '账户币种加载失败，请重试')
    } finally {
      if (requestId === currencyRequestId) currencyLoading.value = false
    }
  }

  async function handleSubmit(): Promise<boolean> {
    if (currencyLoading.value || currencyError.value) return false
    try {
      if (!(await validateArtFormForSubmit(formRef.value))) return false
      const payload: Partial<Api.Fms.SaveFundAccountPayload> = {
        ...form.data,
        accountCode: form.data.accountCode.trim().toUpperCase(),
        accountName: form.data.accountName.trim(),
        bankName: isBank.value ? normalizeNullableText(form.data.bankName) : null,
        bankBranch: isBank.value ? normalizeNullableText(form.data.bankBranch) : null,
        accountNo: normalizeNullableText(form.data.accountNo),
        onlineBankingEnabled: isBank.value && form.data.onlineBankingEnabled,
        reconciliationEnabled: form.data.accountType !== 'cash' && form.data.reconciliationEnabled,
        remark: normalizeNullableText(form.data.remark),
        openingBalance: Number(form.data.openingBalance ?? 0),
        frozenBalance: Number(form.data.frozenBalance ?? 0)
      }
      delete (payload as Record<string, unknown>).fieldAccess
      if (form.data.id && !canEditSensitiveField('accountDetails')) {
        delete payload.accountNo
        delete payload.bankName
        delete payload.bankBranch
      }
      if (form.data.id && !canEditSensitiveField('accountBalances')) {
        delete payload.openingBalance
        delete payload.frozenBalance
        delete payload.balanceAsOf
      }
      await saveFundAccount(payload as Api.Fms.SaveFundAccountPayload)
      emit('success', form.data.id ? 'edit' : 'add')
      return true
    } catch (error) {
      notifyFriendlyError(error, '资金账户保存失败，请检查内容后重试')
      return false
    }
  }

  async function handleOpen(row?: Account): Promise<void> {
    activeTab.value = 'identitySection'
    currencyRequestId++
    currencyOptions.value = []
    currencyLoading.value = false
    currencyError.value = false
    accountSetOptions.value = []
    Object.assign(
      form.data,
      createInitialForm(),
      row && {
        id: row.id,
        accountSetId: row.accountSetId,
        currencyId: row.currencyId,
        accountCode: row.accountCode,
        accountName: row.accountName,
        accountType: row.accountType,
        bankName: row.bankName ?? null,
        bankBranch: row.bankBranch ?? null,
        openingBalance: row.openingBalance ?? 0,
        frozenBalance: row.frozenBalance ?? 0,
        status: row.status,
        isDefault: row.isDefault,
        onlineBankingEnabled: row.onlineBankingEnabled,
        reconciliationEnabled: row.reconciliationEnabled,
        balanceAsOf: row.balanceAsOf ?? null,
        remark: row.remark ?? null,
        fieldAccess: row.fieldAccess
      }
    )
    if (row && !canEditSensitiveField('accountDetails')) {
      form.data.accountNo = row.accountNoMasked ?? null
    }
    await dialogRef.value?.handleOpen(undefined, {
      title: row ? `编辑资金账户 · ${row.accountName}` : '新建资金账户',
      confirmText: row ? '保存修改' : '创建账户',
      loading: true,
      loadingText: '正在加载账套与币种…',
      onConfirm: handleSubmit,
      onOpen: async (_openData, api) => {
        formRef.value?.clearValidate()
        try {
          const { data, error } = await fetchAccountSetOptions({
            status: 'active',
            from: 0,
            to: 999
          })
          if (error) throw error
          accountSetOptions.value = data ?? []
          if (!form.data.accountSetId && accountSetOptions.value.length === 1) {
            form.data.accountSetId = accountSetOptions.value[0].value
          }
          if (form.data.accountSetId) await loadCurrencies(form.data.accountSetId)
        } catch (error) {
          notifyFriendlyError(error, '资金账户基础资料加载失败，请重试')
          await api.handleClose()
        } finally {
          api.setLoading(false)
        }
      },
      dialogProps: { closeOnClickModal: false, destroyOnClose: true }
    })
  }

  defineExpose({ handleOpen })
</script>
