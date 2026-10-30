<template>
  <ArtDialog ref="dialogRef" size="lg">
    <section class="reimbursement-dialog__summary art-card-xs" aria-label="本次报销摘要">
      <article>
        <span class="is-primary"><ArtSvgIcon icon="ri:money-cny-circle-line" /></span>
        <div>
          <small>本次报销金额</small>
          <strong>{{ money(totalAmount) }}</strong>
          <p>合并所选费用后生成</p>
        </div>
      </article>
      <article>
        <span class="is-info"><ArtSvgIcon icon="ri:file-list-3-line" /></span>
        <div>
          <small>费用明细</small>
          <strong>{{ state.expenses.length }} 笔</strong>
          <p>{{ relatedWaybillLabel }}</p>
        </div>
      </article>
      <article>
        <span class="is-warning"><ArtSvgIcon icon="ri:time-line" /></span>
        <div>
          <small>费用核销状态</small>
          <ArtDictDisplay
            dict-code="tmsWaybillCostSettlementStatus"
            value="unsettled"
            display="tag"
          />
          <p>审批通过并付清后逐笔核销</p>
        </div>
      </article>
    </section>

    <ElAlert
      v-if="!attachmentTenantId"
      class="mb-4"
      type="warning"
      :closable="false"
      show-icon
      title="无法确定费用所属租户，暂不能上传补充附件"
    />

    <ElAlert
      v-if="form.data.payeeSource !== 'manual'"
      class="mb-4"
      :type="driverAccountError ? 'warning' : 'info'"
      :closable="false"
      show-icon
      :title="driverAccountError || driverAccountHint"
    />

    <ArtForm
      ref="formRef"
      v-model="form.data"
      :items="form.items"
      :rules="form.rules"
      :span="isCompact ? 24 : 12"
      :gutter="20"
      :show-reset="false"
      :show-submit="false"
    >
      <template #basisUrls>
        <ArtUploadImage
          v-model="form.data.basisUrls"
          title="上传附件"
          :size="96"
          :limit="5"
          :resource-tenant-id="attachmentTenantId"
          :disabled="!attachmentTenantId"
          multiple
        />
      </template>
    </ArtForm>

    <ArtSectionCard
      class="reimbursement-dialog__items"
      title="费用上报明细"
      subtitle="原费用单的运输、票据、上报和审核信息将一并关联到报销单。"
      preserve-content-structure
    >
      <template #actions>
        <div class="reimbursement-dialog__items-total">
          <span>合计</span>
          <strong>{{ money(totalAmount) }}</strong>
        </div>
      </template>
      <ArtTable
        :data="state.expenses"
        :columns="columns"
        :pagination="false"
        :border="false"
        height="auto"
        :show-table-header="false"
        table-layout="auto"
        max-height="320px"
      />
    </ArtSectionCard>
  </ArtDialog>
</template>

<script setup lang="tsx">
  import { notifyFriendlyError } from '@/hooks/core/useArtFeedback'
  import { validateArtFormForSubmit } from '@/utils/form/validate-art-form'
  import { normalizeNullableText } from '@/utils/form/normalize'
  import dayjs from 'dayjs'
  import { uniq } from 'lodash-es'
  import { useMediaQuery } from '@vueuse/core'
  import type { ComputedRef } from 'vue'
  import { ElMessage, type FormRules } from 'element-plus'
  import ArtDialog from '@/components/core/dialogs/art-dialog/index.vue'
  import type { ArtDialogExpose } from '@/components/core/dialogs/art-dialog/types'
  import ArtDictDisplay from '@/components/core/base/art-dict-display/index.vue'
  import ArtSvgIcon from '@/components/core/base/art-svg-icon/index.vue'
  import ArtForm, { type FormItem } from '@/components/core/forms/art-form/index.vue'
  import ArtUploadImage from '@/components/core/forms/art-upload-image/index.vue'
  import ArtSectionCard from '@/components/core/surfaces/art-section-card/index.vue'
  import ArtTable from '@/components/core/tables/art-table/index.vue'
  import type { ColumnOption } from '@/types'
  import {
    createExpenseReimbursement,
    fetchWaybillDriverDefaultAccount,
    type WaybillDriverDefaultAccount
  } from '@fms/api'
  import { createTenantScopeReadGuard } from '@/utils/tenant-scope-context'
  import { isReadableFieldAccess } from '@/utils/field-permission'
  import { getFriendlySupabaseErrorMessage } from '@/utils/supabase'
  import { useUserStore } from '@/store/modules/user'
  import { useTenantScopeStore } from '@/store/modules/tenant-scope'
  import { formatWithDayjs } from '@/utils/time'
  import { formatCurrencyValue } from '@/utils/ui'
  import { useDocumentNumberRule } from '@/hooks/core/useDocumentNumberRule'
  import {
    cloneReimbursementExpenses,
    validateReimbursementSelection
  } from './reimbursement-selection'

  defineOptions({ name: 'FinanceWaybillExpenseReimbursementDialog' })

  type Expense = Api.Fms.WaybillCostRecord

  interface ReimbursementForm {
    reimbursementNo: string
    payeeSource: 'manual' | 'cost_driver' | 'current_driver'
    payeeDriverId: string | null
    payeeName: string
    payeeBank: string
    payeeAccount: string
    plannedPaymentDate: string
    paymentMethod: Api.Fms.CashPaymentMethod
    basisUrls: string[]
    remark: string
  }

  interface FormGroup {
    data: ReimbursementForm
    items: ComputedRef<FormItem[]>
    rules: FormRules<ReimbursementForm>
  }

  interface FormExpose {
    validate: () => Promise<boolean>
    clearValidate: () => void
  }

  const emit = defineEmits<{ success: [] }>()
  const isCompact = useMediaQuery('(max-width: 767px)')
  const userStore = useUserStore()
  const { getDictMap, getUserInfo } = storeToRefs(userStore)
  const tenantScopeStore = useTenantScopeStore()
  const dialogRef = ref<ArtDialogExpose<{ expenses: Expense[] }>>()
  const formRef = ref<FormExpose>()
  const state = reactive<{ expenses: Expense[] }>({ expenses: [] })
  const driverDefaultAccount = ref<WaybillDriverDefaultAccount | null>(null)
  const driverAccountError = ref('')
  const driverAccountLoading = ref(false)
  const driverLoadVersion = ref(0)
  const manualPayeeSnapshot = ref<{ name: string; bank: string; account: string } | null>(null)
  const attachmentTenantId = computed(() => {
    const expenseTenantIds = uniq(state.expenses.map((item) => item.tenantId).filter(Boolean))
    if (expenseTenantIds.length > 1) return ''
    return expenseTenantIds[0] || tenantScopeStore.effectiveTenantId || ''
  })
  const reimbursementNumber = useDocumentNumberRule(
    'tms.expense_reimbursement',
    () => attachmentTenantId.value || undefined
  )

  const currentUserName = computed(
    () => getUserInfo.value.nickName || getUserInfo.value.userName || getUserInfo.value.email || ''
  )

  const createInitialForm = (): ReimbursementForm => ({
    reimbursementNo: '',
    payeeSource: 'manual',
    payeeDriverId: null,
    payeeName: currentUserName.value,
    payeeBank: '',
    payeeAccount: '',
    plannedPaymentDate: dayjs().format('YYYY-MM-DD'),
    paymentMethod: 'bank_transfer',
    basisUrls: [],
    remark: ''
  })

  const form = reactive<FormGroup>({
    data: createInitialForm(),
    rules: {
      reimbursementNo: [
        {
          validator: (_rule, value, callback) =>
            reimbursementNumber.manualRequired(false) && !String(value || '').trim()
              ? callback(new Error('请输入费用报销单号'))
              : callback(),
          trigger: 'blur'
        }
      ],
      payeeName: [{ required: true, message: '请填写实际收款人', trigger: 'blur' }],
      plannedPaymentDate: [{ required: true, message: '请选择计划付款日期', trigger: 'change' }],
      paymentMethod: [{ required: true, message: '请选择付款方式', trigger: 'change' }]
    },
    items: computed<FormItem[]>(() => [
      { label: '报销申请', key: 'payeeSection', type: 'divider', span: 24 },
      {
        label: '报销单号',
        key: 'reimbursementNo',
        type: 'input',
        props: {
          maxlength: 50,
          ...reimbursementNumber.inputProps(false, '请输入费用报销单号')
        },
        description: reimbursementNumber.description.value
      },
      {
        label: '收款对象',
        key: 'payeeSource',
        type: 'select',
        span: 24,
        props: {
          options: [
            { label: '手工指定实际收款人', value: 'manual' },
            {
              label: '费用保存时的收款司机',
              value: 'cost_driver',
              disabled: !historicalDriverPayee.value
            },
            {
              label: '当前运单司机',
              value: 'current_driver',
              disabled: !canLoadCurrentDriver.value
            }
          ]
        },
        description: '司机账户仅在主动选择后带入；报销人、司机和实际收款人可能不同。'
      },
      {
        label: '收款人',
        key: 'payeeName',
        type: 'input',
        props: {
          maxlength: 200,
          clearable: true,
          placeholder: '请选择或填写实际垫付员工、司机或收款人'
        },
        description: '可按实际垫付与报销关系修改，保存前请核对账户。'
      },
      {
        label: '计划付款日',
        key: 'plannedPaymentDate',
        type: 'date',
        props: { valueFormat: 'YYYY-MM-DD', class: '!w-full' }
      },
      {
        label: '付款方式',
        key: 'paymentMethod',
        type: 'select',
        props: { options: getDictMap.value.tmsCashPaymentMethod ?? [] }
      },
      {
        label: '开户银行',
        key: 'payeeBank',
        type: 'input',
        props: { maxlength: 200, placeholder: '非转账可不填' }
      },
      {
        label: '收款账号',
        key: 'payeeAccount',
        type: 'input',
        span: 24,
        props: { maxlength: 200, placeholder: '银行卡号或收款账户，可选' }
      },
      { label: '说明与依据', key: 'basisSection', type: 'divider', span: 24 },
      {
        label: '报销说明',
        key: 'remark',
        type: 'textarea',
        span: 24,
        props: {
          rows: 2,
          maxlength: 500,
          showWordLimit: true,
          placeholder: '说明报销用途、收款安排或需财务关注的事项'
        }
      },
      { label: '补充附件', key: 'basisUrls', type: 'input', span: 24 }
    ])
  })

  const totalAmount = computed(() =>
    state.expenses.reduce((sum, item) => sum + Number(item.amount || 0), 0)
  )
  const canReadSelectedPayment = computed(() =>
    state.expenses.every((item) =>
      isReadableFieldAccess(item.fieldAccess?.paymentDetails ?? 'hidden')
    )
  )
  const historicalDriverPayee = computed(() => {
    if (!canReadSelectedPayment.value || !state.expenses.length) return null
    const ids = uniq(
      state.expenses.map((item) => (item.payeeType === 'driver' ? item.payeeDriverId : null))
    )
    const accountSnapshots = uniq(
      state.expenses.map((item) =>
        [item.payeeName || '', item.payeeBank || '', item.payeeAccount || ''].join('|')
      )
    )
    return ids.length === 1 && ids[0] && accountSnapshots.length === 1 ? state.expenses[0] : null
  })
  const canLoadCurrentDriver = computed(
    () => canReadSelectedPayment.value && Boolean(state.expenses[0]?.waybillId)
  )
  const driverAccountHint = computed(() => {
    if (form.data.payeeSource === 'cost_driver')
      return '已取费用保存时的司机收款快照；运单后来更换司机不会改写该账户。'
    if (driverDefaultAccount.value?.hasDefaultAccount)
      return `当前司机档案开票名称：${driverDefaultAccount.value.invoiceName || '未填写'}；纳税人识别号：${driverDefaultAccount.value.taxNo || '未填写'}。仅作收款资料核对，不作为发票购方或实际开票方。`
    if (driverDefaultAccount.value) return '当前司机未启用默认开票账户，请人工核对收款银行与账号。'
    return '正在读取当前运单司机的默认收款账户。'
  })

  watch(
    () => form.data.payeeSource,
    (source, previousSource) => {
      const version = ++driverLoadVersion.value
      driverDefaultAccount.value = null
      driverAccountError.value = ''
      driverAccountLoading.value = false
      form.data.payeeDriverId = null
      if (previousSource === 'manual' && source !== 'manual') {
        manualPayeeSnapshot.value = {
          name: form.data.payeeName,
          bank: form.data.payeeBank,
          account: form.data.payeeAccount
        }
      }
      if (source === 'manual' && manualPayeeSnapshot.value) {
        Object.assign(form.data, {
          payeeName: manualPayeeSnapshot.value.name,
          payeeBank: manualPayeeSnapshot.value.bank,
          payeeAccount: manualPayeeSnapshot.value.account
        })
        manualPayeeSnapshot.value = null
      }
      if (source === 'cost_driver') {
        const saved = historicalDriverPayee.value
        if (!saved) {
          driverAccountError.value = '所选费用没有一致的历史司机收款资料，请手工指定收款人。'
          return
        }
        Object.assign(form.data, {
          payeeDriverId: saved.payeeDriverId || null,
          payeeName: saved.payeeName || saved.driverNameSnapshot || '',
          payeeBank: saved.payeeBank || '',
          payeeAccount: saved.payeeAccount || ''
        })
      } else if (source === 'current_driver') {
        void loadCurrentDriverAccount(version)
      }
    }
  )

  async function loadCurrentDriverAccount(version: number): Promise<void> {
    const waybillId = state.expenses[0]?.waybillId
    if (!waybillId || !canLoadCurrentDriver.value) {
      driverAccountError.value = '当前费用无权读取司机收款资料。'
      return
    }
    const ensureScope = createTenantScopeReadGuard()
    driverAccountLoading.value = true
    try {
      const { data, error } = await fetchWaybillDriverDefaultAccount(
        waybillId,
        state.expenses[0]?.id
      )
      if (version !== driverLoadVersion.value || form.data.payeeSource !== 'current_driver') return
      ensureScope()
      if (error) throw error
      if (!data?.driverId) {
        driverAccountError.value = '当前运单尚未分配司机，请手工指定实际收款人。'
        return
      }
      driverDefaultAccount.value = data
      Object.assign(form.data, {
        payeeDriverId: data.driverId,
        payeeName: data.driverName,
        payeeBank: data.hasDefaultAccount ? data.bankName || '' : '',
        payeeAccount: data.hasDefaultAccount ? data.bankAccount || '' : ''
      })
    } catch (error) {
      if (version === driverLoadVersion.value)
        driverAccountError.value = getFriendlySupabaseErrorMessage(
          error,
          '司机收款资料加载失败，请重试。'
        )
    } finally {
      if (version === driverLoadVersion.value) driverAccountLoading.value = false
    }
  }
  const relatedWaybillLabel = computed(() => {
    const waybillNo = state.expenses.find((item) => item.waybillNoSnapshot)?.waybillNoSnapshot
    return waybillNo ? `关联运单 ${waybillNo}` : '关联同一运单'
  })
  const columns: ColumnOption<Expense>[] = [
    {
      prop: 'costNo',
      label: '费用单 / 运单',
      minWidth: 230,
      formatter: (row) => (
        <div
          class="flex min-w-0 flex-col gap-1"
          title={`${row.costNo} · ${row.waybillNoSnapshot || '--'}`}
        >
          <strong class="truncate text-sm text-[var(--art-gray-800)]">{row.costNo}</strong>
          <span class="truncate text-xs text-[var(--art-gray-600)]">
            {row.waybillNoSnapshot || '--'}
          </span>
        </div>
      )
    },
    {
      prop: 'expenseItem.itemName',
      label: '费用项目',
      width: 130,
      formatter: (row) => row.expenseItem?.itemName || '--'
    },
    {
      prop: 'amount',
      label: '报销金额',
      width: 130,
      align: 'right',
      formatter: (row) => money(row.amount)
    },
    {
      prop: 'occurredOn',
      label: '发生日期',
      width: 120,
      formatter: (row) => formatWithDayjs(row.occurredOn, 'YYYY-MM-DD')
    },
    {
      prop: 'providerName',
      label: '服务商',
      width: 150,
      showOverflowTooltip: true,
      formatter: (row) => emptyText(row.providerName)
    },
    {
      prop: 'attachments',
      label: '附件',
      width: 90,
      align: 'center',
      formatter: (row) => `${row.attachments?.length ?? 0} 份`
    }
  ]

  function money(value: Api.Fms.SensitiveNumber): string {
    if (value === null || value === undefined) return '--'
    const numericValue = Number(value)
    return Number.isFinite(numericValue) ? formatCurrencyValue(numericValue) : String(value)
  }

  function emptyText(value?: string | null): string {
    return value || '--'
  }

  async function handleSubmit(): Promise<boolean> {
    if (driverAccountLoading.value || driverAccountError.value) {
      ElMessage.warning(driverAccountError.value || '请等待司机收款资料加载完成')
      return false
    }
    if (form.data.payeeSource !== 'manual' && !form.data.payeeDriverId) {
      ElMessage.warning('请确认收款司机后再生成报销单')
      return false
    }
    try {
      if (!(await validateArtFormForSubmit(formRef.value))) return false
    } catch (error) {
      notifyFriendlyError(error, '运单报销校验失败，请重试')
      return false
    }
    try {
      await createExpenseReimbursement({
        reimbursementNo: normalizeNullableText(form.data.reimbursementNo),
        costIds: state.expenses.flatMap((item) => (item.id ? [item.id] : [])),
        payeeName: form.data.payeeName.trim(),
        payeeBank: normalizeNullableText(form.data.payeeBank),
        payeeAccount: normalizeNullableText(form.data.payeeAccount),
        payeeDriverId: form.data.payeeSource === 'manual' ? null : form.data.payeeDriverId,
        payeeSource: form.data.payeeSource,
        plannedPaymentDate: form.data.plannedPaymentDate,
        paymentMethod: form.data.paymentMethod,
        basisUrls: [...form.data.basisUrls],
        remark: normalizeNullableText(form.data.remark)
      })
      emit('success')
      return true
    } catch (error) {
      notifyFriendlyError(error, '运单报销保存失败，请检查内容后重试')
      return false
    }
  }

  async function resetForm(): Promise<void> {
    ++driverLoadVersion.value
    driverDefaultAccount.value = null
    driverAccountError.value = ''
    driverAccountLoading.value = false
    manualPayeeSnapshot.value = null
    Object.assign(form.data, createInitialForm())
    state.expenses = []
    await nextTick()
    formRef.value?.clearValidate()
  }

  async function handleOpen(expenses: Expense[]): Promise<void> {
    await userStore.ensureDictLoaded('tmsCashPaymentMethod')
    const validation = validateReimbursementSelection(expenses)
    if (!validation.valid) {
      ElMessage.warning(validation.message)
      return
    }

    await resetForm()
    state.expenses = cloneReimbursementExpenses(expenses)
    const fallbackPayee =
      expenses.find((item) => item.payeeName)?.payeeName ||
      expenses.find((item) => item.driverNameSnapshot)?.driverNameSnapshot ||
      ''
    form.data.payeeName = currentUserName.value || fallbackPayee || ''
    form.data.basisUrls = uniq(expenses.flatMap((item) => item.attachments ?? [])).slice(0, 5)
    await dialogRef.value?.handleOpen(
      { expenses },
      {
        title: `转费用报销 · ${expenses.length} 笔`,
        subtitle: '报销审批通过后由出纳登记付款，付款完成即逐笔核销运单费用',
        confirmText: '生成报销单',
        contentMaxHeight: '78vh',
        loading: true,
        loadingText: '正在加载编号规则…',
        onOpen: async (_openData, api) => {
          try {
            await reimbursementNumber.loadRule()
          } finally {
            api.setLoading(false)
          }
        },
        onConfirm: handleSubmit,
        onReset: () => void resetForm(),
        dialogProps: { appendToBody: true, closeOnClickModal: false }
      }
    )
  }

  defineExpose({ handleOpen })
</script>

<style scoped lang="scss">
  .reimbursement-dialog {
    &__summary {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      padding: 0;
      margin-bottom: var(--art-space-5);
      overflow: hidden;

      article {
        display: flex;
        gap: var(--art-space-3);
        align-items: center;
        min-width: 0;
        padding: var(--art-space-4);

        &:not(:last-child) {
          border-right: 1px solid var(--el-border-color-lighter);
        }

        > span {
          display: grid;
          flex: 0 0 40px;
          place-items: center;
          width: 40px;
          height: 40px;
          font-size: 19px;
          border-radius: var(--el-border-radius-base);

          &.is-primary {
            color: var(--el-color-primary);
            background: var(--el-color-primary-light-9);
          }

          &.is-info {
            color: var(--el-color-info);
            background: var(--el-color-info-light-9);
          }

          &.is-warning {
            color: var(--el-color-warning);
            background: var(--el-color-warning-light-9);
          }
        }

        > div {
          display: grid;
          gap: 2px;
          min-width: 0;
        }

        small,
        p {
          overflow: hidden;
          text-overflow: ellipsis;
          color: var(--el-text-color-secondary);
          white-space: nowrap;
        }

        strong {
          overflow: hidden;
          text-overflow: ellipsis;
          font-size: 18px;
          font-variant-numeric: tabular-nums;
          color: var(--el-text-color-primary);
          white-space: nowrap;
        }

        p {
          margin: 0;
          font-size: 11px;
        }
      }
    }

    &__items {
      min-width: 0;
      margin-top: var(--art-space-5);
    }

    &__items-total {
      display: flex;
      flex: 0 0 auto;
      gap: var(--art-space-2);
      align-items: baseline;

      span {
        font-size: 12px;
        color: var(--el-text-color-secondary);
      }

      strong {
        font-size: 20px;
        font-variant-numeric: tabular-nums;
        color: var(--el-color-primary);
      }
    }

    @media (width <= 767px) {
      &__summary {
        grid-template-columns: 1fr;

        article:not(:last-child) {
          border-right: 0;
          border-bottom: 1px solid var(--el-border-color-lighter);
        }
      }
    }
  }
</style>
