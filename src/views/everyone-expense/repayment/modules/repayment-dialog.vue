<template>
  <ArtDialog ref="dialogRef" size="xl">
    <div class="flex min-w-0 flex-col gap-4">
      <ArtSectionCard v-if="readonly" title="基本信息">
        <ArtDescriptions
          :data="model"
          :items="[
            { key: 'loanId', label: '关联借款', value: selectedLoan?.loanNo || '—' },
            { key: 'repaymentDate', label: '还款日期', field: 'repaymentDate' },
            { key: 'reason', label: '还款事由', field: 'reason' },
            { key: 'payerName', label: '付款人', field: 'payerName' },
            { key: 'payerBank', label: '付款银行', field: 'payerBank' },
            { key: 'bankAccount', label: '付款银行账号', field: 'bankAccount' },
            { key: 'remark', label: '备注', field: 'remark' }
          ]"
        />
      </ArtSectionCard>
      <ArtForm
        v-else
        ref="formRef"
        v-model="model"
        :items="formItems"
        :rules="rules"
        :span="12"
        :gutter="20"
        label-position="top"
        :show-reset="false"
        :show-submit="false"
      >
        <template #loanId>
          <ElSelect
            v-model="model.loanId"
            class="w-full"
            filterable
            :disabled="readonly || Boolean(model.id)"
            placeholder="选择已付款借款单"
            @change="selectLoan"
          >
            <ElOption
              v-for="loan in loanOptions"
              :key="loan.id"
              :value="loan.id"
              :label="`${loan.loanNo} · ${loan.applicantName} · 可还 ${formatCurrencyValue(loan.availableAmount ?? loan.remainingBalance ?? 0)}`"
            />
          </ElSelect>
        </template>
      </ArtForm>
      <ElAlert
        v-if="!loanOptions.length && !readonly"
        class="mx-4 w-auto"
        type="info"
        :closable="false"
        title="暂无可关联的已付款借款单。借款审批并实际付款后，才可登记还款。"
      />
      <ElAlert
        v-if="selectedLoan?.isDemo"
        class="mx-4 w-auto"
        type="warning"
        :closable="false"
        title="此借款为演示付款，后续还款与收款同样只作流程验证。"
      />
      <div
        v-if="selectedLoan"
        class="mx-4 flex items-center gap-3 rounded-lg border border-[var(--el-border-color-light)] px-4 py-3"
      >
        <img
          v-if="selectedLoan.applicantAvatarUrl"
          :src="selectedLoan.applicantAvatarUrl"
          :alt="`${selectedLoan.applicantName}头像`"
          width="40"
          height="40"
          class="size-10 shrink-0 rounded-full object-cover"
        />
        <div
          v-else
          class="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--el-fill-color-light)] text-sm font-medium text-[var(--art-gray-700)]"
        >
          {{ selectedLoan.applicantName.slice(0, 1) }}
        </div>
        <div
          class="grid min-w-0 flex-1 gap-x-6 gap-y-1 text-xs text-[var(--art-gray-700)] sm:grid-cols-2 xl:grid-cols-4"
        >
          <span
            >还款人
            <strong class="font-medium text-[var(--art-gray-900)]">{{
              selectedLoan.applicantName
            }}</strong></span
          >
          <span
            >职位
            <strong class="font-medium text-[var(--art-gray-900)]">{{
              selectedLoan.positionName || '—'
            }}</strong></span
          >
          <span
            >申请人公司
            <strong class="font-medium text-[var(--art-gray-900)]">{{
              selectedLoan.applicantCompanyName
            }}</strong></span
          >
          <span
            >费用承担部门
            <strong class="font-medium text-[var(--art-gray-900)]">{{
              selectedLoan.expenseDepartmentName
            }}</strong></span
          >
          <span
            >费用承担公司
            <strong class="font-medium text-[var(--art-gray-900)]">{{
              selectedLoan.expenseCompanyName
            }}</strong></span
          >
        </div>
      </div>
      <ArtSectionCard
        class="mx-4 min-w-0"
        title="还款明细"
        subtitle="从关联借款带入费用项目、借款事项和币种，录入本次还款金额。"
        :empty="!lines.length"
        empty-title="尚未添加还款明细"
        empty-description="选择已付款借款单后，添加需归还的借款明细。"
        :min-height="185"
      >
        <template #actions>
          <strong class="text-sm font-semibold tabular-nums text-[var(--el-color-warning)]">
            还款合计 {{ formatCurrencyValue(totalAmount) }}
          </strong>
          <ElButton
            v-if="!readonly"
            type="primary"
            plain
            :disabled="!selectedLoan"
            @click="openLine()"
          >
            <ArtSvgIcon icon="ri:add-line" aria-hidden="true" />新增明细
          </ElButton>
        </template>
        <ArtTable
          v-if="lines.length"
          :data="lines"
          :columns="lineColumns"
          :pagination="false"
          :show-table-header="false"
          table-layout="fixed"
          max-height="280px"
        />
      </ArtSectionCard>
      <ArtSectionCard
        v-if="readonly && receipts.length"
        class="mx-4 min-w-0"
        title="收款流水"
        subtitle="已登记的收款记录。"
        :min-height="140"
      >
        <ArtTable
          :data="receipts"
          :columns="receiptColumns"
          :pagination="false"
          :show-table-header="false"
          table-layout="fixed"
          max-height="220px"
        />
      </ArtSectionCard>
      <section class="px-4">
        <ArtSectionTitle>附件</ArtSectionTitle>
        <ArtUploadFile
          v-model="model.attachmentUrls"
          multiple
          :disabled="readonly"
          :limit="8"
          :resource-tenant-id="model.tenantId"
          accept=".pdf,.doc,.docx,.xls,.xlsx,image/*"
          tip="支持文档和图片，单个文件不超过 20 MB"
        />
      </section>
    </div>
    <ArtDialog ref="lineDialogRef" size="md">
      <ArtForm
        ref="lineFormRef"
        v-model="lineModel"
        :items="lineFormItems"
        :rules="lineRules"
        :span="12"
        :show-reset="false"
        :show-submit="false"
        label-position="top"
      >
        <template #loanItemId>
          <ElSelect
            v-model="lineModel.loanItemId"
            class="w-full"
            filterable
            placeholder="选择借款明细"
          >
            <ElOption
              v-for="item in selectedLoan?.items ?? []"
              :key="item.id"
              :value="item.id"
              :label="`${expenseName(item)} · ${formatCurrencyValue(item.amount)}`"
            />
          </ElSelect>
        </template>
      </ArtForm>
    </ArtDialog>
    <MasterDataDeleteGuard ref="lineGuardRef" />
  </ArtDialog>
</template>

<script setup lang="tsx">
  import { unref } from 'vue'
  import ArtDescriptions from '@/components/core/base/art-descriptions/index.vue'
  import { ElMessage } from 'element-plus'
  import dayjs from 'dayjs'
  import type { ColumnOption } from '@/types'
  import { notifyFriendlyError } from '@/hooks/core/useArtFeedback'
  import { getDeleteReferenceContext } from '@/utils/supabase/delete-reference'
  import { useRecordDeleteGuard } from '@/hooks/core/useRecordDeleteGuard'
  import { useAuth } from '@/hooks/core/useAuth'
  import { useTenantOperationGuard } from '@/hooks/core/useTenantOperationGuard'
  import { useArtOverlaySession } from '@/hooks/core/useArtOverlay'
  import { createTenantScopeReadGuard } from '@/utils/tenant-scope-context'
  import { useTenantScopeFormPolicy } from '@/hooks/core/useTenantScopeFormPolicy'
  import { validateArtFormForSubmit } from '@/utils/form/validate-art-form'
  import { formatCurrencyValue } from '@/utils/ui'
  import ArtDialog from '@/components/core/dialogs/art-dialog/index.vue'
  import type { ArtDialogExpose } from '@/components/core/dialogs/art-dialog/types'
  import ArtForm, { type FormItem } from '@/components/core/forms/art-form/index.vue'
  import ArtTable from '@/components/core/tables/art-table/index.vue'
  import ArtSectionCard from '@/components/core/surfaces/art-section-card/index.vue'
  import ArtSectionTitle from '@/components/core/surfaces/art-section-title/index.vue'
  import ArtSvgIcon from '@/components/core/base/art-svg-icon/index.vue'
  import ArtUploadFile from '@/components/core/forms/art-upload-file/index.vue'
  import ArtButtonTable from '@/components/core/forms/art-button-table/index.vue'
  import BusinessTableRowActions from '@/components/business/business-table-row-actions/index.vue'
  import MasterDataDeleteGuard from '@/components/business/master-data-delete-guard/index.vue'
  import {
    fetchRepayableLoans,
    fetchTravelLoanDetail,
    fetchTravelRepaymentDetail,
    saveTravelRepaymentDraft,
    type RepayableLoan,
    type TravelLoanItem,
    type TravelLoan,
    type TravelRepayment,
    type TravelRepaymentInput,
    type TravelRepaymentItemInput,
    type TravelRepaymentReceipt
  } from '@fms/api'

  interface OpenData {
    row?: TravelRepayment
    copy?: boolean
    readonly?: boolean
    sourceLoan?: TravelLoan
    isCurrent?: () => boolean
  }
  const emit = defineEmits<{ success: [] }>()
  const { defaultWriteTenantId } = useTenantScopeFormPolicy()
  const dialogRef = ref<ArtDialogExpose<OpenData>>()
  const { hasAuth } = useAuth()
  const captureOperation = useTenantOperationGuard('FinanceRepayment:View')
  const session = useArtOverlaySession(() => Boolean(unref(dialogRef.value?.visible)))
  const lineDialogRef = ref<ArtDialogExpose>()
  const lineSession = useArtOverlaySession(() => Boolean(unref(lineDialogRef.value?.visible)))
  const formRef = ref<InstanceType<typeof ArtForm>>()
  const lineFormRef = ref<InstanceType<typeof ArtForm>>()
  const {
    deleteGuardRef: lineGuardRef,
    deleteRecord,
    inspectDeleteReferences
  } = useRecordDeleteGuard('fms_travel_repayment_item', '还款明细')
  const readonly = ref(false)
  const loanOptions = ref<RepayableLoan[]>([])
  const lines = ref<TravelRepaymentItemInput[]>([])
  const receipts = ref<TravelRepaymentReceipt[]>([])
  const removedLines = ref<Array<{ id: string; label: string }>>([])
  const editingLineIndex = ref<number | null>(null)
  const lineModel = ref<TravelRepaymentItemInput>({ loanItemId: '', amount: 0, remark: null })
  const initial = (): TravelRepaymentInput => ({
    tenantId: defaultWriteTenantId.value ?? '',
    loanId: '',
    repaymentDate: dayjs().format('YYYY-MM-DD'),
    reason: '',
    payerName: null,
    payerBank: null,
    bankAccount: null,
    remark: null,
    attachmentUrls: []
  })
  const model = ref<TravelRepaymentInput>(initial())
  const selectedLoan = computed(() =>
    loanOptions.value.find((loan) => loan.id === model.value.loanId)
  )
  const totalAmount = computed(() =>
    lines.value.reduce((sum, line) => sum + Number(line.amount), 0)
  )
  const formItems: FormItem[] = [
    { key: 'base', label: '基本信息', type: 'divider', span: 24 },
    { key: 'loanId', label: '关联借款', type: 'input' },
    {
      key: 'repaymentDate',
      label: '还款日期',
      type: 'date',
      props: { type: 'date', valueFormat: 'YYYY-MM-DD' }
    },
    { key: 'reason', label: '还款事由', type: 'input', span: 24, props: { maxlength: 500 } },
    { key: 'payerName', label: '付款人', type: 'input' },
    { key: 'payerBank', label: '付款银行', type: 'input' },
    { key: 'bankAccount', label: '付款银行账号', type: 'input', props: { autocomplete: 'off' } },
    {
      key: 'remark',
      label: '备注',
      type: 'input',
      span: 24,
      props: { type: 'textarea', rows: 2, maxlength: 500, showWordLimit: true }
    }
  ]
  const rules = {
    loanId: [{ required: true, message: '请选择关联借款', trigger: 'change' }],
    repaymentDate: [{ required: true, message: '请选择还款日期', trigger: 'change' }],
    reason: [{ required: true, message: '请填写还款事由', trigger: 'blur' }]
  }
  const lineFormItems: FormItem[] = [
    { key: 'loanItemId', label: '关联借款明细', type: 'input' },
    {
      key: 'amount',
      label: '还款金额（元）',
      type: 'number',
      props: { min: 0.01, precision: 2, class: 'w-full' }
    },
    {
      key: 'remark',
      label: '备注',
      type: 'input',
      span: 24,
      props: { type: 'textarea', rows: 2, maxlength: 500 }
    }
  ]
  const lineRules = {
    loanItemId: [{ required: true, message: '请选择借款明细', trigger: 'change' }],
    amount: [
      {
        required: true,
        type: 'number' as const,
        min: 0.01,
        message: '还款金额须大于零',
        trigger: 'change'
      }
    ]
  }
  function expenseName(item: TravelLoanItem | undefined): string {
    return item?.expenseItem?.itemName || item?.purpose || '借款费用'
  }
  function selectLoan(id: string): void {
    lines.value = []
    model.value.loanId = id
    model.value.reason = selectedLoan.value?.reason ?? ''
  }
  const lineColumns: ColumnOption<TravelRepaymentItemInput>[] = [
    {
      prop: 'loanItemId',
      label: '关联借款',
      minWidth: 165,
      formatter: () => selectedLoan.value?.loanNo || '—'
    },
    {
      prop: 'expenseItemId',
      label: '费用项目',
      minWidth: 140,
      formatter: (row) =>
        expenseName(selectedLoan.value?.items.find((item) => item.id === row.loanItemId))
    },
    {
      prop: 'loanPurpose',
      label: '借款事项',
      minWidth: 180,
      formatter: (row) =>
        selectedLoan.value?.items.find((item) => item.id === row.loanItemId)?.purpose ?? '—'
    },
    { prop: 'currency', label: '币种', width: 80, formatter: () => 'CNY' },
    { prop: 'exchangeRate', label: '汇率', width: 80, align: 'right', formatter: () => '1.000000' },
    {
      prop: 'amount',
      label: '还款金额',
      width: 130,
      align: 'right',
      formatter: (row) => formatCurrencyValue(row.amount)
    },
    {
      prop: 'baseAmount',
      label: '还款金额本位币',
      width: 145,
      align: 'right',
      formatter: (row) => formatCurrencyValue(row.amount)
    },
    { prop: 'remark', label: '备注', minWidth: 140, showOverflowTooltip: true },
    {
      prop: 'operation',
      label: '操作',
      width: 140,
      fixed: 'right',
      formatter: (row) =>
        readonly.value ? (
          '—'
        ) : (
          <BusinessTableRowActions>
            <ArtButtonTable
              type="edit"
              permission={model.value.id ? 'FinanceRepayment:Edit' : 'FinanceRepayment:Add'}
              onClick={() => openLine(row)}
            />
            <ArtButtonTable
              icon="ri:file-copy-line"
              label="复制明细"
              permission={model.value.id ? 'FinanceRepayment:CopyItem' : 'FinanceRepayment:Add'}
              onClick={() => openLine(row, true)}
            />
            <ArtButtonTable
              type="delete"
              permission={model.value.id ? 'FinanceRepayment:DeleteItem' : 'FinanceRepayment:Add'}
              onClick={() => void removeLine(row)}
            />
          </BusinessTableRowActions>
        )
    }
  ]
  const receiptColumns: ColumnOption<TravelRepaymentReceipt>[] = [
    { prop: 'receiptDate', label: '收款日期', width: 120 },
    {
      prop: 'amount',
      label: '收款金额（元）',
      width: 140,
      align: 'right',
      formatter: (row) => formatCurrencyValue(row.amount)
    },
    { prop: 'bankReference', label: '银行流水号', minWidth: 160 },
    { prop: 'remark', label: '备注', minWidth: 150, showOverflowTooltip: true }
  ]
  async function openLine(row?: TravelRepaymentItemInput, copy = false): Promise<void> {
    const scopeCurrent = captureOperation()
    const parentVersion = session.version.value
    const parentId = model.value.id
    const permissions = parentId ? ['FinanceRepayment:Edit'] : ['FinanceRepayment:Add']
    if (parentId && copy) permissions.push('FinanceRepayment:CopyItem')
    const contextCurrent = () =>
      scopeCurrent() &&
      session.isCurrent(parentVersion) &&
      model.value.id === parentId &&
      !readonly.value &&
      permissions.every((permission) => hasAuth(permission))
    if (!contextCurrent()) return
    const version = lineSession.invalidate()
    const isCurrent = () => contextCurrent() && lineSession.isCurrent(version)
    editingLineIndex.value = row && !copy ? lines.value.indexOf(row) : null
    lineModel.value = {
      id: copy ? undefined : row?.id,
      loanItemId: row?.loanItemId ?? '',
      amount: row?.amount ?? 0,
      remark: row?.remark ?? null
    }
    await lineDialogRef.value?.handleOpen(undefined, {
      title: copy ? '复制还款明细' : row ? '编辑还款明细' : '新增还款明细',
      subtitle: '费用项目、借款事项、币种和汇率取自原借款；金额可按本次还款调整。',
      confirmText: row && !copy ? '保存明细' : '添加明细',
      onOpen: () => lineFormRef.value?.clearValidate(),
      onClose: () => {
        lineSession.invalidate()
      },
      onConfirm: async () => {
        if (!isCurrent()) {
          ElMessage.warning('操作范围或权限已变化，请重新打开还款明细')
          return false
        }
        if (!(await validateArtFormForSubmit(lineFormRef.value))) return false
        if (!isCurrent()) return false
        const source = selectedLoan.value?.items.find(
          (item) => item.id === lineModel.value.loanItemId
        )
        if (
          !source ||
          Number(lineModel.value.amount) <= 0 ||
          Number(lineModel.value.amount) > source.amount
        ) {
          notifyFriendlyError(new Error('还款金额无效'), '还款金额应大于零且不超过原借款明细金额')
          return false
        }
        if (editingLineIndex.value === null) lines.value.push({ ...lineModel.value })
        else lines.value.splice(editingLineIndex.value, 1, { ...lineModel.value })
        return true
      }
    })
  }
  async function removeLine(row: TravelRepaymentItemInput): Promise<void> {
    const index = lines.value.indexOf(row)
    if (index < 0) return
    if (!row.id) {
      lines.value.splice(index, 1)
      return
    }
    await deleteRecord({
      resource: { id: row.id, label: selectedLoan.value?.loanNo || '还款明细' },
      permission: 'FinanceRepayment:DeleteItem',
      confirmMessage: '从草稿中移除此还款明细？保存还款单后生效。',
      remove: async () => {
        removedLines.value.push({ id: row.id!, label: selectedLoan.value?.loanNo || '还款明细' })
        lines.value.splice(index, 1)
      }
    })
  }
  async function handleOpen(data: OpenData = {}): Promise<void> {
    const scopeCurrent = captureOperation()
    const version = session.invalidate()
    const permissions = data.readonly
      ? []
      : data.copy
        ? ['FinanceRepayment:Add', 'FinanceRepayment:Copy']
        : [data.row ? 'FinanceRepayment:Edit' : 'FinanceRepayment:Add']
    const contextCurrent = () =>
      scopeCurrent() &&
      session.version.value === version &&
      permissions.every((permission) => hasAuth(permission)) &&
      (!data.isCurrent || data.isCurrent())
    if (!contextCurrent()) return
    const isCurrent = () => contextCurrent() && session.isCurrent(version)
    const assertScope = createTenantScopeReadGuard()
    try {
      readonly.value = Boolean(data.readonly)
      const detail = data.row ? (await fetchTravelRepaymentDetail(data.row.id)).data : null
      if (!contextCurrent()) return
      model.value = detail
        ? {
            id: data.copy ? undefined : detail.id,
            tenantId: detail.tenantId,
            loanId: detail.loanId,
            repaymentDate: data.copy ? dayjs().format('YYYY-MM-DD') : detail.repaymentDate,
            reason: detail.reason,
            payerName: detail.payerName,
            payerBank: detail.payerBank,
            bankAccount: detail.bankAccount,
            remark: detail.remark,
            attachmentUrls: [...detail.attachmentUrls]
          }
        : initial()
      lines.value = (detail?.items ?? []).map((item) => ({
        id: data.copy ? undefined : item.id,
        loanItemId: item.loanItemId,
        amount: item.amount,
        remark: item.remark
      }))
      receipts.value = data.copy ? [] : (detail?.receipts ?? [])
      if (data.sourceLoan) {
        model.value.tenantId = data.sourceLoan.tenantId
        model.value.loanId = data.sourceLoan.id
        model.value.reason = data.sourceLoan.reason
      }
      removedLines.value = []
      const [options, sourceLoan] = await Promise.all([
        fetchRepayableLoans(model.value.tenantId),
        detail ? fetchTravelLoanDetail(detail.loanId) : Promise.resolve(null)
      ])
      if (!contextCurrent()) return
      loanOptions.value = options.data ?? []
      const linkedLoan = sourceLoan?.data
      if (data.copy && linkedLoan && !loanOptions.value.some((loan) => loan.id === linkedLoan.id)) {
        model.value.loanId = ''
        lines.value = []
        ElMessage.warning('原借款已无可还余额，请重新选择可还款的借款单并添加明细')
      }
      if (!data.copy && linkedLoan && !loanOptions.value.some((loan) => loan.id === linkedLoan.id))
        loanOptions.value.unshift({ ...linkedLoan, items: linkedLoan.items ?? [] })
      if (data.sourceLoan) {
        const source = data.sourceLoan
        if (!loanOptions.value.some((loan) => loan.id === source.id))
          loanOptions.value.unshift({ ...source, items: source.items ?? [] })
        let remaining = source.availableAmount ?? source.remainingBalance ?? 0
        lines.value = (source.items ?? []).flatMap((item) => {
          const amount = Math.min(item.amount, remaining)
          remaining -= amount
          return amount > 0 ? [{ loanItemId: item.id, amount, remark: null }] : []
        })
      }
      assertScope()
      if (!contextCurrent()) return
      await dialogRef.value?.handleOpen(data, {
        title: data.readonly
          ? `查看还款单 · ${detail?.repaymentNo ?? ''}`
          : data.copy
            ? '复制还款单'
            : detail
              ? `编辑还款单 · ${detail.repaymentNo}`
              : '新增还款单',
        subtitle: '关联已付款借款，核对原借款明细与本次归还金额。',
        confirmText: '保存草稿',
        showFooter: !data.readonly,
        onOpen: () => formRef.value?.clearValidate(),
        onClose: () => {
          session.invalidate()
        },
        onConfirm: async () => {
          if (!isCurrent() || data.readonly) {
            ElMessage.warning('操作范围或权限已变化，请重新打开还款单')
            return false
          }
          try {
            if (!(await validateArtFormForSubmit(formRef.value))) return false
            if (!isCurrent()) return false
            if (!lines.value.length) {
              notifyFriendlyError(new Error('缺少明细'), '请添加至少一条还款明细')
              return false
            }
            await saveTravelRepaymentDraft(model.value, lines.value)
            if (!isCurrent()) return false
            ElMessage.success(data.copy ? '已复制为新的还款草稿' : '还款草稿已保存')
            emit('success')
            return true
          } catch (error) {
            if (!isCurrent()) return false
            if (
              removedLines.value.length &&
              (await inspectDeleteReferences(
                removedLines.value,
                getDeleteReferenceContext(error)?.constraint
              ))
            )
              return false
            if (isCurrent())
              notifyFriendlyError(error, '还款单保存失败，请核对关联借款和金额后重试')
            return false
          }
        }
      })
    } catch (error) {
      if (!contextCurrent()) return
      notifyFriendlyError(error, '还款单打开失败，请重试')
    }
  }
  defineExpose({ handleOpen })
</script>
