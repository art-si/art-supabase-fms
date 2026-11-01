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
    <template v-if="!isEditing" #subtitle>
      先登记票面与往来信息，保存为草稿；确认收票或出票后进入受控生命周期，不再允许直接修改。
    </template>
    <ArtForm
      root-class="art-form--mobile-stack"
      ref="formRef"
      v-model:active-tab="activeTab"
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
  import { createFinancePrerequisiteOverlay } from '../../../modules/use-finance-account-set-prerequisite'
  import { normalizeNullableNumber, normalizeNullableText } from '@/utils/form/normalize'
  import dayjs from 'dayjs'
  import { storeToRefs } from 'pinia'
  import { useMediaQuery } from '@vueuse/core'
  import type { FormRules } from 'element-plus'
  import ArtDialog from '@/components/core/dialogs/art-dialog/index.vue'
  import type { ArtDialogExpose } from '@/components/core/dialogs/art-dialog/types'
  import ArtForm, { type FormItem } from '@/components/core/forms/art-form/index.vue'
  import { fetchAccountSetOptions, fetchCommercialBillDetail, saveCommercialBill } from '@fms/api'
  import { canEditField, canViewField } from '@/utils/field-permission'
  import { formatSensitiveCurrencyValue } from '@/utils/ui'
  import { useUserStore } from '@/store/modules/user'

  defineOptions({ name: 'FinanceCommercialBillDialog' })

  type FormData = Api.Fms.SaveCommercialBillPayload
  type Bill = Api.Fms.CommercialBillRecord

  const emit = defineEmits<{ success: [type: 'add' | 'edit'] }>()
  const userStore = useUserStore()
  const { getDictMap } = storeToRefs(userStore)
  const isNarrow = useMediaQuery('(max-width: 520px)')
  const booleanOptions = computed(() =>
    (getDictMap.value.commonBoolean ?? []).map((item) => ({
      ...item,
      value: item.value === 'true'
    }))
  )
  const dialogRef = ref<ArtDialogExpose>()
  const prerequisiteOverlay = createFinancePrerequisiteOverlay(dialogRef)
  const activeTab = ref('')
  const formRef = ref<{ validate: () => Promise<boolean>; clearValidate: () => void }>()
  const accountSetOptions = ref<Api.Fms.AccountSetOption[]>([])
  const currentRecord = shallowRef<Bill>()
  const fieldAccess = ref<Api.Fms.CommercialBillFieldAccessMap>({})

  const createInitialForm = (): FormData => ({
    id: undefined,
    accountSetId: '',
    billNo: '',
    externalBillNo: null,
    direction: 'receivable',
    billType: 'bank_acceptance',
    drawerName: '',
    payeeName: '',
    acceptorName: '',
    counterpartyName: null,
    issueDate: dayjs().format('YYYY-MM-DD'),
    dueDate: dayjs().add(6, 'month').format('YYYY-MM-DD'),
    faceAmount: 0,
    currencyCode: 'CNY',
    transferable: true,
    sourceType: null,
    sourceId: null,
    sourceNo: null,
    attachmentIds: [],
    remark: null
  })

  const form = reactive<{ data: FormData; rules: FormRules<FormData> }>({
    data: createInitialForm(),
    rules: {
      accountSetId: [{ required: true, message: '请选择所属账套', trigger: 'change' }],
      direction: [{ required: true, message: '请选择票据方向', trigger: 'change' }],
      billType: [{ required: true, message: '请选择票据类型', trigger: 'change' }],
      drawerName: [{ required: true, whitespace: true, message: '请输入出票人', trigger: 'blur' }],
      payeeName: [{ required: true, whitespace: true, message: '请输入收款人', trigger: 'blur' }],
      acceptorName: [
        { required: true, whitespace: true, message: '请输入承兑人', trigger: 'blur' }
      ],
      issueDate: [{ required: true, message: '请选择出票日', trigger: 'change' }],
      dueDate: [{ required: true, message: '请选择到期日', trigger: 'change' }],
      faceAmount: [
        { required: true, message: '请输入票面金额', trigger: 'change' },
        {
          validator: (_rule, value, callback) =>
            Number(value) > 0 ? callback() : callback(new Error('票面金额必须大于 0')),
          trigger: 'change'
        }
      ],
      currencyCode: [
        { required: true, whitespace: true, message: '请输入币种代码', trigger: 'blur' }
      ]
    }
  })

  const isEditing = computed(() => Boolean(form.data.id))
  const canView = (field: Api.Fms.CommercialBillFieldKey): boolean =>
    !isEditing.value || canViewField(fieldAccess.value, field)
  const canEdit = (field: Api.Fms.CommercialBillFieldKey): boolean =>
    !isEditing.value || canEditField(fieldAccess.value, field)

  const formItems = computed<FormItem[]>(() => {
    const items: FormItem[] = [
      { label: '票据登记', key: 'identitySection', type: 'tab', span: 24 },
      {
        label: '所属账套',
        key: 'accountSetId',
        type: 'select',
        span: 24,
        props: {
          options: accountSetOptions.value,
          filterable: true,
          disabled: isEditing.value,
          placeholder: '选择核算账套'
        }
      },
      {
        label: '票据方向',
        key: 'direction',
        type: 'segment',
        props: { options: getDictMap.value.fmsBillDirection ?? [], placeholder: '选择方向' }
      },
      {
        label: '票据类型',
        key: 'billType',
        type: isNarrow.value ? 'select' : 'segment',
        props: { options: getDictMap.value.fmsBillType ?? [], placeholder: '选择类型' }
      },
      {
        label: '内部编号',
        key: 'billNo',
        type: 'input',
        props: { maxlength: 60, placeholder: '留空则按票据编号规则自动生成' }
      }
    ]

    if (canView('billReferences')) {
      items.push(
        canEdit('billReferences')
          ? {
              label: '票面号码',
              key: 'externalBillNo',
              type: 'input',
              props: { maxlength: 120, placeholder: '选填，票面或电子票据号码' }
            }
          : {
              label: '票面号码',
              key: '__externalBillNoDisplay',
              type: 'input',
              props: { modelValue: currentRecord.value?.externalBillNo || '--', disabled: true }
            }
      )
    }

    if (canView('billParties')) {
      items.push({ label: '票面主体', key: 'partySection', type: 'divider', span: 24 })
      const partyItems: Array<[string, keyof Bill, string]> = [
        ['出票人', 'drawerName', '出票主体全称'],
        ['收款人', 'payeeName', '票面收款主体全称'],
        ['承兑人', 'acceptorName', '银行或企业承兑主体'],
        ['往来单位', 'counterpartyName', '客户、承运商或其他往来主体']
      ]
      items.push(
        ...partyItems.map(([label, key, placeholder]) =>
          canEdit('billParties')
            ? {
                label,
                key: String(key),
                type: 'input' as const,
                props: { maxlength: 160, placeholder }
              }
            : {
                label,
                key: `__${String(key)}Display`,
                type: 'input' as const,
                props: { modelValue: currentRecord.value?.[key] || '--', disabled: true }
              }
        )
      )
    }

    items.push(
      { label: '期限与金额', key: 'amountSection', type: 'tab', span: 24 },
      {
        label: '出票日期',
        key: 'issueDate',
        type: 'date',
        props: { valueFormat: 'YYYY-MM-DD', class: '!w-full' }
      },
      {
        label: '到期日期',
        key: 'dueDate',
        type: 'date',
        props: { valueFormat: 'YYYY-MM-DD', class: '!w-full' }
      }
    )

    if (canView('billAmounts')) {
      items.push(
        canEdit('billAmounts')
          ? {
              label: '票面金额',
              key: 'faceAmount',
              type: 'number',
              props: {
                min: 0,
                precision: 2,
                step: 1000,
                controlsPosition: 'right',
                class: '!w-full'
              }
            }
          : {
              label: '票面金额',
              key: '__faceAmountDisplay',
              type: 'input',
              props: {
                modelValue: formatSensitiveCurrencyValue(
                  currentRecord.value?.faceAmount,
                  currentRecord.value?.currencyCode
                ),
                disabled: true
              }
            }
      )
    }

    items.push(
      {
        label: '币种代码',
        key: 'currencyCode',
        type: 'input',
        props: { maxlength: 3, placeholder: 'CNY' }
      },
      {
        label: '允许背书',
        key: 'transferable',
        type: 'segment',
        props: { options: booleanOptions.value }
      }
    )

    if (canView('billReferences')) {
      items.push(
        { label: '业务依据', key: 'referenceSection', type: 'divider', span: 24 },
        canEdit('billReferences')
          ? {
              label: '来源单号',
              key: 'sourceNo',
              type: 'input',
              props: { maxlength: 120, placeholder: '选填，对账单、发票或合同编号' }
            }
          : {
              label: '来源单号',
              key: '__sourceNoDisplay',
              type: 'input',
              props: { modelValue: currentRecord.value?.sourceNo || '--', disabled: true }
            }
      )
    }

    items.push({
      label: '备注',
      key: 'remark',
      type: 'input',
      span: 24,
      props: { type: 'textarea', rows: 3, maxlength: 500, showWordLimit: true }
    })
    return items
  })

  async function handleSubmit(): Promise<boolean> {
    try {
      if (!(await validateArtFormForSubmit(formRef.value))) return false
      if (dayjs(form.data.dueDate).isBefore(dayjs(form.data.issueDate), 'day')) {
        ElMessage.warning('到期日期不能早于出票日期')
        return false
      }
      const payload: Api.Fms.SaveCommercialBillPayload = {
        id: form.data.id,
        accountSetId: form.data.accountSetId,
        billNo: form.data.billNo.trim(),
        direction: form.data.direction,
        billType: form.data.billType,
        currencyCode: form.data.currencyCode.trim().toUpperCase(),
        issueDate: form.data.issueDate,
        dueDate: form.data.dueDate,
        transferable: form.data.transferable,
        ...(canEdit('billParties')
          ? {
              drawerName: form.data.drawerName?.trim() || '',
              payeeName: form.data.payeeName?.trim() || '',
              acceptorName: form.data.acceptorName?.trim() || '',
              counterpartyName: normalizeNullableText(form.data.counterpartyName)
            }
          : {}),
        ...(canEdit('billAmounts') ? { faceAmount: Number(form.data.faceAmount) } : {}),
        ...(canEdit('billReferences')
          ? {
              externalBillNo: normalizeNullableText(form.data.externalBillNo),
              sourceType: form.data.sourceType || null,
              sourceId: form.data.sourceId || null,
              sourceNo: normalizeNullableText(form.data.sourceNo),
              attachmentIds: form.data.attachmentIds ?? []
            }
          : {}),
        remark: normalizeNullableText(form.data.remark)
      }
      const { error } = await saveCommercialBill(payload)
      if (error) return false
      emit('success', form.data.id ? 'edit' : 'add')
      return true
    } catch (error) {
      notifyFriendlyError(error, '商业票据保存失败，请检查内容后重试')
      return false
    }
  }

  async function handleOpen(row?: Bill): Promise<void> {
    currentRecord.value = undefined
    fieldAccess.value = {}
    Object.assign(form.data, createInitialForm())
    const prepare = async () => {
      await Promise.all([
        userStore.ensureDictLoaded('fmsBillDirection'),
        userStore.ensureDictLoaded('fmsBillType'),
        userStore.ensureDictLoaded('commonBoolean')
      ])
      const { data, error } = await fetchAccountSetOptions({ status: 'active', from: 0, to: 999 })
      if (error) throw error
      accountSetOptions.value = data ?? []
      const detailResult = row ? await fetchCommercialBillDetail(row.id) : undefined
      if (detailResult?.error) throw detailResult.error
      if (row && !detailResult?.data) throw new Error('票据不存在或已不可访问，请刷新列表')
      const record = detailResult?.data ?? undefined
      currentRecord.value = record
      fieldAccess.value = record?.fieldAccess ?? {}
      Object.assign(
        form.data,
        createInitialForm(),
        record && {
          id: record.id,
          accountSetId: record.accountSetId,
          billNo: record.billNo,
          externalBillNo: canEditField(record.fieldAccess, 'billReferences')
            ? (record.externalBillNo ?? null)
            : null,
          direction: record.direction,
          billType: record.billType,
          drawerName: canEditField(record.fieldAccess, 'billParties')
            ? (record.drawerName ?? '')
            : undefined,
          payeeName: canEditField(record.fieldAccess, 'billParties')
            ? (record.payeeName ?? '')
            : undefined,
          acceptorName: canEditField(record.fieldAccess, 'billParties')
            ? (record.acceptorName ?? '')
            : undefined,
          counterpartyName: canEditField(record.fieldAccess, 'billParties')
            ? (record.counterpartyName ?? null)
            : null,
          issueDate: record.issueDate,
          dueDate: record.dueDate,
          faceAmount: canEditField(record.fieldAccess, 'billAmounts')
            ? (normalizeNullableNumber(record.faceAmount) ?? undefined)
            : undefined,
          currencyCode: record.currencyCode,
          transferable: record.transferable,
          sourceType: canEditField(record.fieldAccess, 'billReferences')
            ? (record.sourceType ?? null)
            : null,
          sourceId: canEditField(record.fieldAccess, 'billReferences')
            ? (record.sourceId ?? null)
            : null,
          sourceNo: canEditField(record.fieldAccess, 'billReferences')
            ? (record.sourceNo ?? null)
            : null,
          attachmentIds: canEditField(record.fieldAccess, 'billReferences')
            ? (record.attachmentIds ?? [])
            : [],
          remark: record.remark ?? null
        }
      )
      if (!record) form.data.accountSetId = accountSetOptions.value[0]?.value ?? ''
    }
    await dialogRef.value?.handleOpen(undefined, {
      title: row ? '编辑商业票据' : '新建商业票据',
      confirmText: row ? '保存修改' : '创建草稿',
      loading: true,
      loadingText: '正在加载票据与账套…',
      onConfirm: handleSubmit,
      onOpen: async () => {
        try {
          await prepare()
          formRef.value?.clearValidate()
        } catch (error) {
          notifyFriendlyError(error, '商业票据加载失败，请重新打开重试')
          await dialogRef.value?.handleClose()
        } finally {
          prerequisiteOverlay.finishLoading()
        }
      },
      dialogProps: { closeOnClickModal: false, destroyOnClose: true }
    })
  }

  defineExpose({ handleOpen, ...prerequisiteOverlay })
</script>
