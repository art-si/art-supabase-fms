<template>
  <ArtDialog ref="dialogRef" size="md">
    <template #subtitle>
      直接汇率表示“1 单位外币可折算的本位币金额”，同一币种、日期和汇率类型仅保留一条记录。
    </template>
    <ArtForm
      root-class="art-form--mobile-stack"
      ref="formRef"
      v-model="form.data"
      :items="formItems"
      :rules="form.rules"
      :span="12"
      :gutter="20"
      label-width="104px"
    />
  </ArtDialog>
</template>

<script setup lang="ts">
  import { notifyFriendlyError } from '@/hooks/core/useArtFeedback'
  import { validateArtFormForSubmit } from '@/utils/form/validate-art-form'
  import { normalizeNullableText } from '@/utils/form/normalize'
  import dayjs from 'dayjs'
  import type { FormRules } from 'element-plus'
  import { storeToRefs } from 'pinia'
  import ArtDialog from '@/components/core/dialogs/art-dialog/index.vue'
  import type { ArtDialogExpose } from '@/components/core/dialogs/art-dialog/types'
  import ArtForm, { type FormItem } from '@/components/core/forms/art-form/index.vue'
  import { saveExchangeRate } from '@fms/api'
  import { useUserStore } from '@/store/modules/user'

  defineOptions({ name: 'FinanceExchangeRateDialog' })

  type FormData = Api.Fms.SaveExchangeRatePayload

  const emit = defineEmits<{ success: [] }>()
  const userStore = useUserStore()
  const { getDictMap } = storeToRefs(userStore)
  const dialogRef = ref<ArtDialogExpose>()
  const formRef = ref<{ validate: () => Promise<boolean>; clearValidate: () => void }>()
  const currencyOptions = ref<Array<{ label: string; value: string }>>([])
  const rateTypeOptions = computed(() => getDictMap.value.fmsExchangeRateType ?? [])

  const createInitialForm = (): FormData => ({
    id: undefined,
    tenantId: '',
    accountSetId: '',
    currencyId: '',
    rateDate: dayjs().format('YYYY-MM-DD'),
    rateType: 'spot',
    directRate: 1,
    source: null,
    remark: null
  })
  const form = reactive<{ data: FormData; rules: FormRules<FormData> }>({
    data: createInitialForm(),
    rules: {
      currencyId: [{ required: true, message: '请选择外币', trigger: 'change' }],
      rateDate: [{ required: true, message: '请选择汇率日期', trigger: 'change' }],
      rateType: [{ required: true, message: '请选择汇率类型', trigger: 'change' }],
      directRate: [
        { required: true, message: '请输入直接汇率', trigger: 'blur' },
        { type: 'number', min: 0.00000001, message: '直接汇率必须大于 0', trigger: 'blur' }
      ]
    }
  })

  const formItems = computed<FormItem[]>(() => [
    { label: '汇率口径', key: 'rateScopeSection', type: 'divider', span: 24 },
    {
      label: '外币',
      key: 'currencyId',
      type: form.data.id ? 'text' : 'select',
      span: 12,
      props: form.data.id
        ? {
            formatter: () =>
              currencyOptions.value.find((item) => item.value === form.data.currencyId)?.label ??
              '当前外币'
          }
        : { filterable: true, options: currencyOptions.value }
    },
    {
      label: '汇率日期',
      key: 'rateDate',
      type: 'date',
      span: 12,
      props: { type: 'date', valueFormat: 'YYYY-MM-DD', class: 'w-full!' }
    },
    {
      label: '汇率类型',
      key: 'rateType',
      type:
        rateTypeOptions.value.length > 0 && rateTypeOptions.value.length <= 4
          ? 'segment'
          : 'select',
      span: 12,
      props: { options: rateTypeOptions.value }
    },
    {
      label: '直接汇率',
      key: 'directRate',
      type: 'number',
      span: 12,
      description: '输入 1 单位所选外币对应的本位币金额；例如折算为 7.20 时，录入 7.20。',
      props: {
        min: 0,
        precision: 8,
        step: 0.01,
        controlsPosition: 'right',
        class: 'w-full!'
      }
    },
    { label: '来源说明', key: 'rateSourceSection', type: 'divider', span: 24 },
    {
      label: '汇率来源',
      key: 'source',
      type: 'input',
      span: 24,
      props: { maxlength: 120, placeholder: '例如：中国外汇交易中心、银行牌价' }
    },
    {
      label: '备注',
      key: 'remark',
      type: 'input',
      span: 24,
      props: { type: 'textarea', rows: 3, maxlength: 500, showWordLimit: true }
    }
  ])

  async function handleSubmit(): Promise<boolean> {
    try {
      if (!(await validateArtFormForSubmit(formRef.value))) return false
      await saveExchangeRate({
        id: form.data.id,
        tenantId: form.data.tenantId,
        accountSetId: form.data.accountSetId,
        currencyId: form.data.currencyId,
        rateDate: form.data.rateDate,
        rateType: form.data.rateType,
        directRate: Number(form.data.directRate),
        source: normalizeNullableText(form.data.source),
        remark: normalizeNullableText(form.data.remark)
      })
      emit('success')
      return true
    } catch (error) {
      notifyFriendlyError(error, '汇率保存失败，请检查内容后重试')
      return false
    }
  }

  async function handleOpen(
    accountSet: Api.Fms.AccountSetOption,
    currencies: Api.Fms.CurrencyRecord[],
    selectedCurrency?: Api.Fms.CurrencyRecord,
    row?: Api.Fms.ExchangeRateRecord
  ): Promise<void> {
    currencyOptions.value = currencies
      .filter((item) => !item.isBase && (item.isEnabled || item.id === row?.currencyId))
      .map((item) => ({ label: `${item.currencyName}（${item.currencyCode}）`, value: item.id }))
    Object.assign(form.data, createInitialForm(), {
      id: row?.id,
      tenantId: accountSet.tenantId,
      accountSetId: accountSet.value,
      currencyId: row?.currencyId ?? selectedCurrency?.id ?? currencyOptions.value[0]?.value ?? '',
      rateDate: row?.rateDate ?? dayjs().format('YYYY-MM-DD'),
      rateType: row?.rateType ?? 'spot',
      directRate: Number(row?.directRate ?? 1),
      source: row?.source ?? null,
      remark: row?.remark ?? null
    })
    await dialogRef.value?.handleOpen(undefined, {
      title: row ? '编辑汇率' : '新增汇率',
      confirmText: row ? '保存修改' : '保存汇率',
      loading: true,
      loadingText: '正在加载汇率选项…',
      onConfirm: handleSubmit,
      onOpen: async (_data, api) => {
        try {
          await userStore.ensureDictLoaded('fmsExchangeRateType')
          formRef.value?.clearValidate()
        } catch (error) {
          notifyFriendlyError(error, '汇率选项加载失败，请重新打开重试')
          await api.handleClose()
        } finally {
          api.setLoading(false)
        }
      },
      dialogProps: { closeOnClickModal: false }
    })
  }

  defineExpose({ handleOpen })
</script>
