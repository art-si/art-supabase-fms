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
    <div class="voucher-template-dialog flex flex-col gap-3 min-w-0">
      <ArtForm
        ref="formRef"
        v-model:active-tab="activeTab"
        root-class="art-form--mobile-stack"
        v-model="form.data"
        :items="form.items"
        :rules="form.rules"
        :span="12"
        :gutter="18"
        label-width="96px"
        scroll-to-error
        ><template #templateLines
          ><VoucherEntryLines
            ref="lineEditorRef"
            v-if="canShowEntries"
            v-model="form.lines"
            :subjects="context.subjects"
            :currencies="context.currencies"
            :auxiliary-items="context.auxiliaryItems"
            :direction-options="directionOptions"
            mode="template"
            allow-zero-amount
            :readonly="!canEditEntries" />
          <ElAlert
            v-else-if="entryAccess === 'masked'"
            :title="`模板分录已脱敏${detailLineCount ? `，共 ${detailLineCount} 条` : ''}`"
            description="科目、借贷方向、核算维度和默认金额不会发送到无明文权限的客户端。"
            type="warning"
            :closable="false"
            show-icon /></template
      ></ArtForm>

      <ElAlert
        v-if="narrativeAccess === 'masked'"
        title="默认摘要与模板说明已按字段权限脱敏"
        type="info"
        :closable="false"
        show-icon
      />
    </div>
  </ArtDialog>
</template>

<script setup lang="ts">
  import { notifyFriendlyError } from '@/hooks/core/useArtFeedback'
  import { validateArtFormForSubmit } from '@/utils/form/validate-art-form'
  import { normalizeNullableText } from '@/utils/form/normalize'
  import { cloneDeep } from 'lodash-es'
  import { ElAlert, ElMessage } from 'element-plus'
  import { storeToRefs } from 'pinia'
  import type { ComputedRef, UnwrapNestedRefs } from 'vue'
  import type { FormRules } from 'element-plus'
  import ArtDialog from '@/components/core/dialogs/art-dialog/index.vue'
  import type { ArtDialogExpose } from '@/components/core/dialogs/art-dialog/types'
  import ArtForm, { type FormItem } from '@/components/core/forms/art-form/index.vue'
  import { fetchVoucherTemplateDetail, saveVoucherTemplate } from '@fms/api'
  import VoucherEntryLines from '@fms/views/modules/voucher-entry-lines.vue'
  import { useUserStore } from '@/store/modules/user'
  import {
    isReadableFieldAccess,
    canEditField,
    getFieldAccess,
    type FieldAccessLevel
  } from '@/utils/field-permission'

  defineOptions({ name: 'FinanceVoucherTemplateDialog' })

  type Template = Api.Fms.VoucherTemplateRecord
  type Line = Api.Fms.VoucherLineRecord

  interface FormData {
    id?: string
    accountSetId: string
    templateCode: string
    templateName: string
    voucherType: Exclude<Api.Fms.VoucherType, 'reversal'>
    summary: string
    isEnabled: boolean
    sort: number
    remark: string
  }

  interface DialogContext {
    accountSet: Api.Fms.AccountSetOption
    subjects: Api.Fms.SubjectRecord[]
    currencies: Api.Fms.CurrencyRecord[]
    auxiliaryItems: Api.Fms.AuxiliaryItemRecord[]
  }

  interface FormExpose {
    validate: () => Promise<boolean>
    clearValidate: () => void
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
  const dialogRef = ref<ArtDialogExpose<Template | undefined>>()
  const activeTab = ref('')
  const lineEditorRef = ref<InstanceType<typeof VoucherEntryLines>>()
  const formRef = ref<FormExpose>()
  const fieldAccess = ref<Api.Fms.VoucherTemplateFieldAccessMap>({})
  const detailLineCount = ref(0)
  const context = reactive<DialogContext>({
    accountSet: { label: '', value: '', status: 'draft', tenantId: '' },
    subjects: [],
    currencies: [],
    auxiliaryItems: []
  })

  function createLine(lineNo: number, direction: Api.Fms.BalanceDirection): Line {
    return {
      lineNo,
      summary: '',
      subjectId: '',
      auxiliaryValues: {},
      currencyId: null,
      exchangeRate: 1,
      originalAmount: 0,
      quantity: 0,
      debitAmount: 0,
      creditAmount: 0,
      entryDirection: direction
    }
  }

  function createInitialForm(): FormData {
    return {
      id: undefined,
      accountSetId: '',
      templateCode: '',
      templateName: '',
      voucherType: 'general',
      summary: '',
      isEnabled: true,
      sort: 100,
      remark: ''
    }
  }

  const form: UnwrapNestedRefs<FormGroup> = reactive<FormGroup>({
    data: createInitialForm(),
    lines: [createLine(1, 'debit'), createLine(2, 'credit')],
    items: computed<FormItem[]>(() => [
      {
        label: '模板信息',
        key: 'identitySection',
        type: canShowEntries.value ? 'tab' : 'divider',
        span: 24
      },
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
        label: '模板编码',
        key: 'templateCode',
        type: 'input',
        span: 12,
        props: { maxlength: 30, placeholder: '如 CASH_RECEIPT' }
      },
      {
        label: '模板名称',
        key: 'templateName',
        type: 'input',
        span: 12,
        props: { maxlength: 80, placeholder: '请输入模板名称' }
      },
      ...(canShowEntries.value || canShowNarrative.value
        ? ([
            { label: '默认制单', key: 'voucherDefaultsSection', type: 'divider', span: 24 }
          ] as FormItem[])
        : []),
      ...(canShowEntries.value
        ? ([
            {
              label: '凭证类型',
              key: 'voucherType',
              type: 'select',
              props: {
                options: voucherTypeOptions.value,
                clearable: false,
                disabled: !canEditEntries.value
              }
            }
          ] as FormItem[])
        : []),
      ...(canShowNarrative.value
        ? ([
            {
              label: '默认摘要',
              key: 'summary',
              type: 'input',
              span: 12,
              props: {
                maxlength: 200,
                showWordLimit: true,
                placeholder: '套用模板时带入凭证摘要',
                disabled: !canEditNarrative.value
              }
            }
          ] as FormItem[])
        : []),
      {
        label: '启用状态',
        key: 'isEnabled',
        type: 'segment',
        props: { options: enabledOptions.value }
      },
      {
        label: '排序',
        key: 'sort',
        type: 'number',
        props: { min: 0, max: 9999, controlsPosition: 'right', class: '!w-full' }
      },
      ...(canShowNarrative.value
        ? ([
            {
              label: '模板说明',
              key: 'remark',
              type: 'input',
              span: 24,
              props: {
                type: 'textarea',
                rows: 3,
                maxlength: 500,
                showWordLimit: true,
                disabled: !canEditNarrative.value
              }
            }
          ] as FormItem[])
        : []),
      {
        key: 'templateLinesSection',
        label: '模板分录',
        type: canShowEntries.value ? 'tab' : 'divider',
        hidden: !canShowEntries.value
      },
      {
        key: 'templateLines',
        label: '',
        span: 24,
        labelWidth: 0,
        hidden: !canShowEntries.value && entryAccess.value !== 'masked'
      }
    ]),
    rules: {
      accountSetId: [{ required: true, message: '请选择账套', trigger: 'change' }],
      templateCode: [
        { required: true, whitespace: true, message: '请输入模板编码', trigger: 'blur' },
        {
          pattern: /^[A-Za-z0-9_-]{2,30}$/,
          message: '模板编码只能包含字母、数字、下划线和短横线',
          trigger: 'blur'
        }
      ],
      templateName: [
        { required: true, whitespace: true, message: '请输入模板名称', trigger: 'blur' }
      ],
      voucherType: [{ required: true, message: '请选择凭证类型', trigger: 'change' }]
    }
  })

  const voucherTypeOptions = computed(() =>
    (getDictMap.value.fmsVoucherType ?? []).filter((item) => item.value !== 'reversal')
  )
  const enabledOptions = computed(() =>
    (getDictMap.value.commonEnabledStatus ?? []).map((item) => ({
      ...item,
      value: item.value === 'enabled'
    }))
  )
  const sensitiveFieldFallback = computed<FieldAccessLevel>(() =>
    form.data.id ? 'hidden' : 'edit'
  )
  const narrativeAccess = computed(() =>
    getFieldAccess(fieldAccess.value, 'templateNarrative', sensitiveFieldFallback.value)
  )
  const entryAccess = computed(() =>
    getFieldAccess(fieldAccess.value, 'templateEntries', sensitiveFieldFallback.value)
  )
  const canShowNarrative = computed(() => isReadableFieldAccess(narrativeAccess.value))
  const canShowEntries = computed(() => isReadableFieldAccess(entryAccess.value))
  const canEditNarrative = computed(() =>
    canEditField(fieldAccess.value, 'templateNarrative', sensitiveFieldFallback.value)
  )
  const canEditEntries = computed(() =>
    canEditField(fieldAccess.value, 'templateEntries', sensitiveFieldFallback.value)
  )
  const directionOptions = computed(() =>
    (getDictMap.value.fmsBalanceDirection ?? [])
      .filter((item) => item.value === 'debit' || item.value === 'credit')
      .map((item) => ({
        label: item.label ?? item.name,
        value: item.value as Api.Fms.BalanceDirection
      }))
  )

  async function validateLines(): Promise<boolean> {
    if (!canEditEntries.value) return true
    if (!form.lines.length) {
      ElMessage.warning('凭证模板至少需要一条分录')
      return false
    }
    const result = await lineEditorRef.value?.validate()
    if (result && !result.valid) {
      if (result.firstError) ElMessage.warning(result.firstError.message)
      return false
    }
    return true
  }

  async function handleSubmit(): Promise<boolean> {
    try {
      if (!(await validateArtFormForSubmit(formRef.value))) return false
    } catch (error) {
      notifyFriendlyError(error, '凭证模板校验失败，请重试')
      return false
    }
    if (canEditEntries.value) {
      activeTab.value = 'templateLinesSection'
      await nextTick()
    }
    if (!(await validateLines())) return false
    try {
      const payload: Api.Fms.SaveVoucherTemplatePayload = {
        id: form.data.id,
        accountSetId: form.data.accountSetId,
        templateCode: form.data.templateCode.trim().toUpperCase(),
        templateName: form.data.templateName.trim(),
        isEnabled: form.data.isEnabled,
        sort: form.data.sort
      }
      if (canEditNarrative.value) {
        payload.summary = normalizeNullableText(form.data.summary)
        payload.remark = normalizeNullableText(form.data.remark)
      }
      if (canEditEntries.value) {
        payload.voucherType = form.data.voucherType
        payload.lines = cloneDeep(form.lines).map((line, index) => ({
          lineNo: index + 1,
          summary: normalizeNullableText(line.summary),
          subjectId: line.subjectId,
          entryDirection: line.entryDirection ?? 'debit',
          defaultAmount: Math.max(Number(line.debitAmount || 0), Number(line.creditAmount || 0)),
          auxiliaryValues: Object.fromEntries(
            Object.entries(line.auxiliaryValues).filter(([, value]) => Boolean(value))
          ),
          currencyId: line.currencyId ?? null,
          exchangeRate: Number(line.exchangeRate || 1),
          quantity: Number(line.quantity || 0)
        }))
      }
      await saveVoucherTemplate(payload)
      emit('success')
      return true
    } catch (error) {
      notifyFriendlyError(error, '凭证模板保存失败，请检查内容后重试')
      return false
    }
  }

  async function handleOpen(
    dialogContext: DialogContext,
    row?: Template,
    loadContext?: () => Promise<DialogContext | undefined>
  ): Promise<void> {
    Object.assign(context, dialogContext)
    fieldAccess.value = {}
    detailLineCount.value = 0
    Object.assign(form.data, createInitialForm(), { accountSetId: context.accountSet.value })
    form.lines = [createLine(1, 'debit'), createLine(2, 'credit')]
    const prepare = async (): Promise<boolean> => {
      await Promise.all([
        userStore.ensureDictLoaded('fmsBalanceDirection'),
        userStore.ensureDictLoaded('fmsVoucherType'),
        userStore.ensureDictLoaded('commonEnabledStatus')
      ])
      if (loadContext) {
        const loaded = await loadContext()
        if (!loaded) throw new Error('凭证模板核算基础加载失败，请重试')
        Object.assign(context, loaded)
      }
      if (!row?.id) return true
      const { data, error } = await fetchVoucherTemplateDetail(row.id)
      if (error) throw error
      if (!data) throw new Error('凭证模板不存在或无权查看，请刷新列表')
      fieldAccess.value = data.fieldAccess ?? {}
      detailLineCount.value = data.lineCount ?? 0
      Object.assign(form.data, {
        id: data.id,
        accountSetId: data.accountSetId,
        templateCode: data.templateCode,
        templateName: data.templateName,
        isEnabled: data.isEnabled,
        sort: data.sort,
        ...(isReadableFieldAccess(getFieldAccess(data.fieldAccess, 'templateNarrative'))
          ? { summary: data.summary ?? '', remark: data.remark ?? '' }
          : {}),
        ...(isReadableFieldAccess(getFieldAccess(data.fieldAccess, 'templateEntries')) &&
        data.voucherType !== '***'
          ? {
              voucherType:
                data.voucherType ?? ('general' as Exclude<Api.Fms.VoucherType, 'reversal'>)
            }
          : {})
      })
      form.lines = (Array.isArray(data.lines) ? data.lines : []).map((line, index) => ({
        lineNo: index + 1,
        summary: line.summary ?? '',
        subjectId: line.subjectId,
        auxiliaryValues: { ...line.auxiliaryValues },
        currencyId: line.currencyId ?? null,
        exchangeRate: Number(line.exchangeRate || 1),
        originalAmount: line.currencyId ? Number(line.defaultAmount || 0) : 0,
        quantity: Number(line.quantity || 0),
        debitAmount: line.entryDirection === 'debit' ? Number(line.defaultAmount || 0) : 0,
        creditAmount: line.entryDirection === 'credit' ? Number(line.defaultAmount || 0) : 0,
        entryDirection: line.entryDirection
      }))
      return true
    }
    await dialogRef.value?.handleOpen(row, {
      title: row ? '编辑凭证模板' : '新增凭证模板',
      subtitle: row ? undefined : '设置常用分录，套用后生成草稿凭证；默认金额可在制单时调整。',
      confirmText: row ? '保存修改' : '创建模板',
      contentMaxHeight: '78vh',
      showFullscreenButton: true,
      dialogProps: { closeOnClickModal: false },
      loading: true,
      loadingText: '正在加载凭证模板…',
      onConfirm: handleSubmit,
      onOpen: async (_openData, api) => {
        try {
          if (!(await prepare())) {
            await api.handleClose()
            return
          }
          formRef.value?.clearValidate()
        } catch (error) {
          notifyFriendlyError(error, '凭证模板加载失败，请重试')
          await api.handleClose()
        } finally {
          api.setLoading(false)
        }
      }
    })
  }

  defineExpose({ handleOpen })
</script>
