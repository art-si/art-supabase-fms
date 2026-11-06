<template>
  <ArtDialog
    ref="dialogRef"
    :confirm-disabled="!formRef?.readyToSubmit"
    @open="
      () => {
        activeTab = ''
      }
    "
    size="lg"
    @close="() => void invalidateSession()"
  >
    <ElAlert v-if="saveError" type="error" :closable="false" show-icon class="mb-4">
      <template #title>{{ saveError }}</template>
    </ElAlert>
    <ElAlert v-if="ocrLoadError" type="error" :closable="false" show-icon>
      <template #title>{{ ocrLoadError }}</template>
      <ElButton link type="primary" @click="() => loadOcrResult()">重新加载</ElButton>
    </ElAlert>

    <ArtForm
      :key="attachmentTenantId || 'unbound'"
      ref="formRef"
      v-model:active-tab="activeTab"
      v-model="form.data"
      :items="form.items"
      :rules="form.rules"
      :span="isCompact ? 24 : 12"
      :gutter="20"
      label-width="104px"
    >
      <template #maintenanceRecordId>
        <MaintenanceSourceSelector
          :key="form.data.waybillId"
          :waybill-id="form.data.waybillId"
          @select="applyMaintenanceSource"
          @clear="form.data.maintenanceRecordId = null"
        />
      </template>
      <template v-if="canViewExpenseLocation" #locationPicker>
        <ArtAddressPicker
          ref="addressPickerRef"
          v-model:region-path="form.data.expenseRegionPath"
          v-model:address-detail="expenseLocationModel"
          v-model:region-adcode="form.data.expenseRegionAdcode"
          v-model:longitude="form.data.expenseLongitude"
          v-model:latitude="form.data.expenseLatitude"
          v-model:coordinate-system="form.data.expenseCoordinateSystem"
          v-model:coordinate-source="form.data.expenseCoordinateSource"
          v-model:coordinate-status="form.data.expenseCoordinateStatus"
          v-model:geocode-provider="form.data.expenseGeocodeProvider"
          v-model:geocoded-at="form.data.expenseGeocodedAt"
          :region-api="fetchRegionOptions"
          :disabled="!canEditExpenseLocation"
          detail-label="发生地点"
          detail-placeholder="定位当前位置，或搜索/点击地图选择加油站等消费地点"
          address-detail-prop="expenseLocation"
          label-width="104px"
          hide-region-selector
          show-locate-button
          @address-change="syncExpenseLocation"
          @locate-success="syncExpenseLocation"
          @pick-confirm="syncExpenseLocation"
        />
      </template>
      <template #expenseEvidence
        ><ExpenseOcrPanel
          v-if="canUseOcr"
          ref="ocrPanelRef"
          v-model="form.data.attachments"
          :enabled="state.ocrEnabled"
          :resource-tenant-id="attachmentTenantId"
          @apply="applyOcrResult"
          @failed="form.data.ocrStatus = 'failed'"
      /></template>
      <template #expenseLines>
        <section class="min-w-0">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <ArtSectionTitle>费用明细</ArtSectionTitle>
            <ElButton
              v-if="!form.data.id && canEditCostAmounts && !form.data.maintenanceRecordId"
              v-auth="'FinanceWaybillCost:Add'"
              :disabled="extraLines.length >= 19"
              @click="addExtraLine"
              >添加费用行</ElButton
            >
          </div>
          <p class="my-2 text-sm text-[var(--art-gray-700)]"
            >费用明细按 10、20、30… 编号；多条费用将一起保存。</p
          >
          <ElAlert
            v-if="lineValidationMessage"
            :title="lineValidationMessage"
            type="warning"
            :closable="false"
            show-icon
            class="mb-3"
          />
          <div
            v-if="!form.data.id && canEditCostAmounts && !form.data.maintenanceRecordId"
            class="mb-3 flex flex-wrap items-center gap-2"
          >
            <ElSelect
              v-model="batchExpenseItemIds"
              multiple
              filterable
              collapse-tags
              collapse-tags-tooltip
              class="min-w-0 flex-1"
              placeholder="批量选择费用项目"
              aria-label="批量选择费用项目"
            >
              <ElOption
                v-for="item in selectableExpenseItems"
                :key="item.id"
                :label="item.itemName"
                :value="item.id || ''"
              />
            </ElSelect>
            <ElButton
              v-auth="'FinanceWaybillCost:Add'"
              :disabled="!batchExpenseItemIds.length || extraLines.length >= 19"
              @click="addSelectedExpenseItems"
              >批量加入</ElButton
            >
          </div>
          <ArtTable ref="lineTableRef" :data="tableLines" :columns="lineColumns" row-key="key">
            <template #costNo="{ row }"
              ><ElInput
                :model-value="row.costNo"
                @update:model-value="updateLineField(row, 'costNo', $event)"
                maxlength="50"
                :placeholder="row.key === 'base' ? '与上方费用单号一致' : '自动编号可留空'"
                aria-label="费用单号"
                :disabled="row.key === 'base'"
            /></template>
            <template #expenseItemId="{ row }"
              ><ElSelect
                :model-value="row.expenseItemId"
                @update:model-value="updateLineField(row, 'expenseItemId', $event)"
                class="w-full"
                filterable
                placeholder="费用项目"
                aria-label="费用项目"
                ><ElOption
                  v-for="item in selectableExpenseItems"
                  :key="item.id"
                  :label="item.itemName"
                  :value="item.id || ''" /></ElSelect
            ></template>
            <template #amount="{ row }"
              ><ElInputNumber
                :model-value="row.amount"
                @update:model-value="updateLineField(row, 'amount', $event)"
                class="w-full!"
                :min="0.01"
                :precision="2"
                :controls="false"
                placeholder="请输入金额"
                :disabled="
                  !canEditCostAmounts || (row.key === 'base' && !!form.data.maintenanceRecordId)
                "
                aria-label="费用金额"
            /></template>
            <template #occurredOn="{ row }"
              ><ElDatePicker
                :model-value="row.occurredOn"
                @update:model-value="updateLineField(row, 'occurredOn', $event)"
                class="w-full!"
                type="date"
                value-format="YYYY-MM-DD"
                aria-label="发生日期"
            /></template>
            <template #quantity="{ row }"
              ><ElInputNumber
                :model-value="row.quantity"
                @update:model-value="updateLineField(row, 'quantity', $event)"
                class="w-full!"
                :min="0"
                :precision="3"
                :controls="false"
                :disabled="!canEditCostAmounts"
                aria-label="数量"
            /></template>
            <template #unitPrice="{ row }"
              ><ElInputNumber
                :model-value="row.unitPrice"
                @update:model-value="updateLineField(row, 'unitPrice', $event)"
                class="w-full!"
                :min="0"
                :precision="4"
                :controls="false"
                :disabled="!canEditCostAmounts"
                aria-label="单价"
            /></template>
            <template #remark="{ row }"
              ><ElInput
                :model-value="row.remark"
                @update:model-value="updateLineField(row, 'remark', $event)"
                maxlength="500"
                aria-label="费用说明"
            /></template>
            <template #expenseClassification="{ row }"
              ><ElSelect
                :model-value="row.expenseClassification"
                @update:model-value="updateLineField(row, 'expenseClassification', $event)"
                class="w-full"
                aria-label="费用划分"
                ><ElOption
                  v-for="item in classificationOptions"
                  :key="item.value"
                  :label="item.label"
                  :value="item.value" /></ElSelect
            ></template>
            <template #operation="{ row }"
              ><ArtIconButton
                v-if="row.key !== 'base'"
                icon="ri:delete-bin-line"
                tone="danger"
                label="移除费用明细"
                @click="removeExtraLine(row.key)"
            /></template>
          </ArtTable>
        </section>
      </template>
    </ArtForm>

    <ElAlert
      v-if="canViewPaymentDetails && form.data.payeeType === 'driver'"
      class="mt-4"
      :type="driverAccountError ? 'warning' : 'info'"
      :closable="false"
      show-icon
    >
      <template #title>
        {{
          driverAccountError ||
          (driverDefaultAccount?.hasDefaultAccount
            ? `司机档案开票名称：${driverDefaultAccount.invoiceName || '未填写'}；纳税人识别号：${driverDefaultAccount.taxNo || '未填写'}。此处仅供核对收款资料，不作为发票购方或实际开票方。`
            : '当前显示费用保存时的司机收款资料；更换运单司机不会改写历史收款账户。')
        }}
      </template>
    </ElAlert>

    <ElAlert
      v-if="selectedWaybill"
      class="expense-dialog__waybill-summary"
      type="info"
      :closable="false"
      show-icon
      :title="waybillSummary"
    />
  </ArtDialog>
</template>

<script setup lang="ts">
  import { notifyFriendlyError } from '@/hooks/core/useArtFeedback'
  import { normalizeNullableText } from '@/utils/form/normalize'
  import { normalizeCoordinatePair } from '@/utils/geo'
  import { validateArtFormForSubmit } from '@/utils/form/validate-art-form'
  import { getFriendlySupabaseErrorMessage } from '@/utils/supabase'
  import { createTenantScopeReadGuard } from '@/utils/tenant-scope-context'
  import dayjs from 'dayjs'
  import { omit } from 'lodash-es'
  import { useMediaQuery } from '@vueuse/core'
  import type { ComputedRef } from 'vue'
  import { useArtOverlaySession } from '@/hooks/core/useArtOverlay'
  import { useDictionaryOptions } from '@/hooks/core/useDictionaryOptions'
  import { ElMessage, type FormRules } from 'element-plus'
  import { fetchRegionOptions } from '@/api/region-options'
  import ArtDialog from '@/components/core/dialogs/art-dialog/index.vue'
  import type { ArtDialogExpose } from '@/components/core/dialogs/art-dialog/types'
  import ArtAddressPicker from '@/components/core/forms/art-address-picker/index.vue'
  import type {
    AddressLocationPayload,
    ArtAddressPickerExpose
  } from '@/components/core/forms/art-address-picker/types'
  import ArtForm, { type FormItem } from '@/components/core/forms/art-form/index.vue'
  import ArtTable, { type ArtTableExpose } from '@/components/core/tables/art-table/index.vue'
  import ArtSectionTitle from '@/components/core/surfaces/art-section-title/index.vue'
  import ArtIconButton from '@/components/core/widget/art-icon-button/index.vue'
  import type { ColumnOption } from '@/types'
  import FinanceDataSourceEmptyActions from '../../../components/finance-data-source-empty-actions.vue'
  import type {
    DataSelectColumn,
    DataSelectFetchParams,
    DataSelectRecord
  } from '@/components/core/forms/art-data-select/types'
  import {
    addWaybillCost,
    addWaybillCostBatch,
    editWaybillCost,
    fetchExpenseItemTree,
    fetchFinanceWaybillOptions,
    fetchWaybillFuelCardOptions,
    fetchWaybillDriverDefaultAccount,
    fetchWaybillCostLegOptions,
    fetchWaybillExpenseOcrEnabled,
    reviewWaybillExpenseOcrArtifact
  } from '@fms/api'
  import type { WaybillFuelCardOption, WaybillDriverDefaultAccount } from '@fms/api'
  import { buildSupabasePageRange } from '@/utils/supabase/pagination'
  import { canEditField, canViewField } from '@/utils/field-permission'
  import { useDocumentNumberRule } from '@/hooks/core/useDocumentNumberRule'
  import { useAuth } from '@/hooks/core/useAuth'
  import TreeUtils from '@/utils/tree'
  import { useUserStore } from '@/store/modules/user'
  import ExpenseOcrPanel from './expense-ocr-panel.vue'
  import MaintenanceSourceSelector from './maintenance-source-selector.vue'

  defineOptions({ name: 'FinanceWaybillExpenseDialog' })

  type Expense = Api.Fms.WaybillCostRecord
  type ExpenseForm = Omit<
    Expense,
    'attachments' | 'expenseItem' | 'waybill' | 'reimbursement' | 'expensePayment'
  > & {
    attachments: string[]
    expenseRegionPath: string[]
    locationPicker?: string
    driverOwnershipDisplay: string
    companyNameDisplay: string
    carrierNameDisplay: string
  }
  type ExpenseLine = {
    key: string
    lineNo?: number | null
    costNo: string
    expenseItemId: string
    amount: number | null
    occurredOn: string
    quantity: number | null
    unitPrice: number | null
    remark: string
    expenseClassification: 'normal' | 'abnormal'
  }
  type Waybill = Api.Fms.WaybillOption
  const expenseOptionTreeUtils = new TreeUtils({ parentKey: 'parentId' })

  interface SelectorWaybill extends Waybill, DataSelectRecord {
    orderNo: string
    plateNo: string
    driverName: string
    route: string
    summary: string
  }

  interface ExpenseDialogOpenData {
    row?: Expense
    orderId?: string
    ocrResult?: Api.Fms.WaybillExpenseOcrAnalyzeResponse
    loadOcrResult?: () => Promise<Api.Fms.WaybillExpenseOcrAnalyzeResponse>
  }

  interface ExpenseFormGroup {
    data: ExpenseForm
    items: ComputedRef<FormItem[]>
    rules: ComputedRef<FormRules<ExpenseForm>>
  }

  interface FormExpose {
    validate: () => Promise<boolean>
    clearValidate: () => void
    readyToSubmit: boolean
  }

  const emit = defineEmits<{ success: [type: 'add' | 'edit'] }>()
  const { hasAuth } = useAuth()
  const userStore = useUserStore()
  const { getDictMap } = storeToRefs(userStore)
  const classificationOptions = computed(() => getDictMap.value.tmsExpenseClassification ?? [])
  const driverOwnershipOptions = useDictionaryOptions('tmsDriverOwnership')
  const selectableExpenseItems = ref<Api.Fms.ExpenseItem[]>([])
  const extraLines = ref<ExpenseLine[]>([])
  const lineTableRef = ref<ArtTableExpose<ExpenseLine>>()
  const lineValidationMessage = ref('')
  const batchExpenseItemIds = ref<string[]>([])
  const extraColumns: ColumnOption<ExpenseLine>[] = [
    {
      prop: 'lineNo',
      label: '行号',
      width: 65,
      formatter: (row) =>
        row.key === 'base'
          ? (row.lineNo ?? 10)
          : (extraLines.value.findIndex((line) => line.key === row.key) + 2) * 10
    },
    { prop: 'costNo', label: '费用单号', minWidth: 150, useSlot: true },
    {
      prop: 'expenseItemId',
      label: '费用项目',
      minWidth: 150,
      useSlot: true,
      required: true,
      requiredMessage: '请选择费用项目'
    },
    {
      prop: 'amount',
      label: '金额',
      width: 130,
      useSlot: true,
      required: true,
      requiredMessage: '费用金额必须大于 0',
      rules: {
        validator: ({ value }) => typeof value === 'number' && Number.isFinite(value) && value > 0,
        message: '费用金额必须大于 0'
      }
    },
    {
      prop: 'occurredOn',
      label: '发生日期',
      width: 165,
      useSlot: true,
      required: true,
      requiredMessage: '请选择费用发生日期'
    },
    { prop: 'quantity', label: '数量', width: 115, useSlot: true },
    { prop: 'unitPrice', label: '单价', width: 115, useSlot: true },
    { prop: 'remark', label: '说明', minWidth: 160, useSlot: true },
    {
      prop: 'expenseClassification',
      label: '费用划分',
      width: 120,
      useSlot: true,
      required: true,
      requiredMessage: '请选择正常或异常费用分类'
    },
    { prop: 'operation', label: '操作', width: 70, useSlot: true }
  ]
  function addExtraLine() {
    extraLines.value.push({
      key: crypto.randomUUID(),
      costNo: '',
      expenseItemId: '',
      amount: null,
      occurredOn: dayjs().format('YYYY-MM-DD'),
      quantity: null,
      unitPrice: null,
      remark: '',
      expenseClassification: 'normal'
    })
  }
  function addSelectedExpenseItems() {
    const remaining = 19 - extraLines.value.length
    if (batchExpenseItemIds.value.length > remaining) {
      ElMessage.warning(`最多还能添加 ${remaining} 行费用`)
      return
    }
    for (const expenseItemId of batchExpenseItemIds.value) {
      addExtraLine()
      extraLines.value[extraLines.value.length - 1].expenseItemId = expenseItemId
    }
    batchExpenseItemIds.value = []
  }
  function removeExtraLine(key: string) {
    extraLines.value = extraLines.value.filter((line) => line.key !== key)
  }
  const savePermission = ref('FinanceWaybillCost:Add')
  const isCompact = useMediaQuery('(max-width: 767px)')
  const dialogRef = ref<ArtDialogExpose<ExpenseDialogOpenData>>()
  const ocrLoadError = ref('')
  const ocrResultLoader = shallowRef<ExpenseDialogOpenData['loadOcrResult']>()
  const activeTab = ref('')
  const formRef = ref<FormExpose>()
  const addressPickerRef = ref<ArtAddressPickerExpose>()
  const ocrPanelRef = ref<{ reset: () => void }>()
  const selection = reactive<{ waybills: SelectorWaybill[] }>({ waybills: [] })
  const fuelCardOptions = ref<WaybillFuelCardOption[]>([])
  const fuelCardLoadError = ref('')
  const fuelCardLoading = ref(false)
  const driverDefaultAccount = ref<WaybillDriverDefaultAccount | null>(null)
  const driverAccountError = ref('')
  const driverAccountLoading = ref(false)
  const manualPayeeSnapshot = ref<{ name: string; bank: string; account: string } | null>(null)
  const state = reactive({ autoLocateArmed: false, ocrEnabled: true, hydrating: false })
  const saveError = ref('')
  const {
    version: formSession,
    invalidate,
    isCurrent
  } = useArtOverlaySession(() => Boolean(unref(dialogRef.value?.visible)))
  function invalidateSession(): number {
    invalidate()
    state.autoLocateArmed = false
    addressPickerRef.value?.cancelLocate()
    ocrPanelRef.value?.reset()
    return formSession.value
  }
  onBeforeUnmount(invalidateSession)
  const NEW_RECORD_FIELD_ACCESS: Api.Fms.WaybillCostFieldAccessMap = {
    costAmounts: 'edit',
    paymentDetails: 'edit',
    driverPhone: 'edit',
    expenseLocation: 'edit',
    expenseEvidence: 'edit'
  }

  const createInitialForm = (): ExpenseForm => ({
    id: undefined,
    tenantId: '',
    costNo: '',
    waybillId: '',
    plateNoSnapshot: '',
    driverNameSnapshot: '',
    driverPhoneSnapshot: '',
    driverOwnershipDisplay: '',
    companyNameDisplay: '',
    carrierNameDisplay: '',
    legId: null,
    maintenanceRecordId: null,
    sourceType: null,
    sourceId: null,
    expenseItemId: '',
    costType: 'other',
    expenseClassification: 'normal',
    amount: null,
    occurredOn: dayjs().format('YYYY-MM-DD'),
    quantity: null,
    unitPrice: null,
    providerName: '',
    payeeName: '',
    payeeType: 'manual',
    payeeDriverId: null,
    payeeBank: '',
    payeeAccount: '',
    paymentChannel: '',
    fuelCardId: null,
    fuelCardNo: null,
    invoiceNo: '',
    meterNo: '',
    expenseLocation: '',
    expenseRegion: '',
    expenseRegionPath: [],
    expenseRegionAdcode: '',
    expenseLongitude: null,
    expenseLatitude: null,
    expenseCoordinateSystem: 'gcj02',
    expenseCoordinateSource: '',
    expenseCoordinateStatus: 'pending',
    expenseGeocodeProvider: '',
    expenseGeocodedAt: null,
    remark: '',
    attachments: [],
    latestOcrRunId: null,
    ocrArtifactId: null,
    ocrStatus: 'not_started',
    auditStatus: 'draft',
    settlementStatus: 'unsettled',
    fieldAccess: { ...NEW_RECORD_FIELD_ACCESS }
  })

  const formData = reactive<ExpenseForm>(createInitialForm())
  const tableLines = computed<ExpenseLine[]>(() => [
    {
      key: 'base',
      lineNo: formData.lineNo,
      costNo: formData.costNo || '',
      expenseItemId: formData.expenseItemId || '',
      amount: formData.amount === null || formData.amount === '' ? null : Number(formData.amount),
      occurredOn: formData.occurredOn || '',
      quantity: formData.quantity == null ? null : Number(formData.quantity),
      unitPrice: formData.unitPrice == null ? null : Number(formData.unitPrice),
      remark: formData.remark || '',
      expenseClassification: formData.expenseClassification || 'normal'
    },
    ...extraLines.value
  ])
  function updateLineField(row: ExpenseLine, field: keyof ExpenseLine, value: unknown): void {
    lineValidationMessage.value = ''
    const target = row.key === 'base' ? formData : row
    ;(target as unknown as Record<string, unknown>)[field] = value
  }
  const expenseNumber = useDocumentNumberRule(
    'tms.waybill_cost',
    () => formData.tenantId || undefined
  )
  const attachmentTenantId = computed(() => formData.tenantId || '')
  const activeFieldAccess = computed(() => formData.fieldAccess ?? NEW_RECORD_FIELD_ACCESS)
  const canViewCostAmounts = computed(() => canViewField(activeFieldAccess.value, 'costAmounts'))
  const canEditCostAmounts = computed(() => canEditField(activeFieldAccess.value, 'costAmounts'))
  const lineColumns = computed<ColumnOption<ExpenseLine>[]>(() =>
    extraColumns.filter(
      (column) =>
        canViewCostAmounts.value ||
        !['amount', 'quantity', 'unitPrice'].includes(String(column.prop))
    )
  )
  const canViewPaymentDetails = computed(() =>
    canViewField(activeFieldAccess.value, 'paymentDetails')
  )
  const canEditPaymentDetails = computed(() =>
    canEditField(activeFieldAccess.value, 'paymentDetails')
  )
  const paymentChannelOptions = computed(() => {
    const options = ['现金', '油卡', '微信', '支付宝', '银行转账', '其他'].map((value) => ({
      label: value,
      value
    }))
    const existing = formData.paymentChannel?.trim()
    if (existing && !options.some((option) => option.value === existing)) {
      options.unshift({ label: existing, value: existing })
    }
    return options
  })
  const canViewExpenseLocation = computed(() =>
    canViewField(activeFieldAccess.value, 'expenseLocation')
  )
  const canEditExpenseLocation = computed(() =>
    canEditField(activeFieldAccess.value, 'expenseLocation')
  )
  const canUseOcr = computed(
    () =>
      !formData.maintenanceRecordId &&
      formData.sourceType !== 'vehicle_maintenance' &&
      canEditCostAmounts.value &&
      canEditPaymentDetails.value &&
      canEditExpenseLocation.value &&
      canEditField(activeFieldAccess.value, 'expenseEvidence')
  )
  const form = reactive<ExpenseFormGroup>({
    data: formData,
    rules: computed<FormRules<ExpenseForm>>(() => ({
      costNo: [
        {
          validator: (_rule, value, callback) =>
            expenseNumber.manualRequired(Boolean(formData.id)) && !String(value || '').trim()
              ? callback(new Error('请输入运单费用单号'))
              : callback(),
          trigger: 'blur'
        }
      ],
      waybillId: [{ required: true, message: '请选择关联运单', trigger: 'change' }],
      payeeDriverId: [
        {
          validator: (_rule, value, callback) =>
            formData.payeeType === 'driver' && !value
              ? callback(new Error('请选择已分配司机的运单并确认收款司机'))
              : callback(),
          trigger: 'change'
        }
      ],
      expenseItemId: [{ required: true, message: '请选择费用项目', trigger: 'change' }],
      expenseClassification: [
        { required: true, message: '请选择正常或异常费用分类', trigger: 'change' }
      ],
      amount: [
        {
          required: canEditCostAmounts.value,
          validator: (_rule, value, callback) => {
            if (!canEditCostAmounts.value) return callback()
            return Number(value) > 0 ? callback() : callback(new Error('费用金额必须大于 0'))
          },
          trigger: 'change'
        }
      ],
      occurredOn: [{ required: true, message: '请选择费用发生日期', trigger: 'change' }],
      fuelCardId: [
        {
          validator: (_rule, value, callback) =>
            formData.paymentChannel === '油卡' && !value
              ? callback(new Error('请选择当前车辆的油卡'))
              : callback(),
          trigger: 'change'
        }
      ],
      expenseLocation: [
        {
          validator: (_rule, value, callback) => {
            if (!canEditExpenseLocation.value) return callback()
            if (String(value || '').trim() && !hasValidExpenseCoordinate.value) {
              callback(new Error('请确认发生地点并获取有效经纬度'))
              return
            }
            callback()
          },
          trigger: 'change'
        }
      ]
    })),
    items: computed<FormItem[]>(() => [
      { label: '业务关联', key: 'relationSection', type: 'tab', span: 24 },
      {
        label: '费用单号',
        key: 'costNo',
        type: 'input',
        props: {
          maxlength: 50,
          ...expenseNumber.inputProps(Boolean(formData.id), '请输入运单费用单号', true)
        },
        description: formData.id ? undefined : expenseNumber.description.value
      },
      {
        slots: { empty: () => h(FinanceDataSourceEmptyActions, { source: 'waybill' }) },
        props: {
          mode: 'table',
          multiple: false,
          showSelectedPanel: false,

          selectedData: selection.waybills,
          'onUpdate:selectedData': ($event: typeof selection.waybills) => {
            selection.waybills = $event
          },
          apiFn: fetchWaybillSelectorData,
          columns: waybillColumns,
          title: '选择关联运单',
          subtitle: '支持按运单号、订单号、车牌号或司机检索，选中后自动带出司机和车辆',
          rowKey: 'id',
          labelKey: 'waybillNo',
          descriptionKey: 'summary',
          placeholder: '请选择运单或输入车牌号检索',
          searchPlaceholder: '运单号、订单号、车牌号、司机',
          emptyText: '暂无可关联运单',
          emptyDescription: '请先创建并推进运单业务，当前筛选范围内没有可关联的运单。',
          dialogWidth: 'xl',
          showPagination: true,
          pageSize: 10
        },
        label: '运单/车牌',
        key: 'waybillId',
        type: 'dataSelect'
      },
      {
        label: '运单司机',
        key: 'driverNameSnapshot',
        type: 'input',
        props: { readonly: true, placeholder: '选择运单后自动带出' }
      },
      {
        label: '运单车辆',
        key: 'plateNoSnapshot',
        type: 'input',
        props: { readonly: true, placeholder: '选择运单后自动带出' }
      },
      {
        label: '司机归属',
        key: 'driverOwnershipDisplay',
        type: 'select',
        props: {
          options: driverOwnershipOptions,
          disabled: true,
          placeholder: '选择运单后自动带出'
        }
      },
      {
        label: '所属公司',
        key: 'companyNameDisplay',
        type: 'input',
        props: { readonly: true, placeholder: '选择运单后自动带出' }
      },
      {
        label: '承运商',
        key: 'carrierNameDisplay',
        type: 'input',
        props: { readonly: true, placeholder: '选择运单后自动带出' }
      },
      {
        label: '司机电话',
        key: 'driverPhoneSnapshot',
        type: 'input',
        props: { readonly: true, placeholder: '选择运单后自动带出' }
      },
      {
        label: '费用归属',
        key: 'legId',
        type: 'select',
        span: 24,
        api: fetchWaybillCostLegOptions,
        params: { waybillId: formData.waybillId },
        shouldFetch: (params) => Boolean(params?.waybillId),
        resultField: 'data',
        labelField: 'name',
        valueField: 'id',
        props: { placeholder: '默认归集主单 / 共用费用', clearable: true },
        description: '返程专属费用选返程货单；共用路桥费留在主单，按返程分摊比例计算一次。'
      },
      {
        label: '维修来源',
        key: 'maintenanceRecordId',
        type: 'input',
        span: 24,
        hidden: Boolean(formData.id) || !hasAuth('VehicleMaintenance:View'),
        description: '选择后自动带入维修金额；费用项目请选择维修保养，审核后计入成本。'
      },
      {
        label: formData.id ? '费用信息' : '费用明细 · 10',
        key: 'expenseSection',
        type: 'divider',
        span: 24
      },
      {
        label: '费用划分',
        key: 'expenseClassification',
        type: 'select',
        span: 12,
        hidden: true,
        options: classificationOptions.value,
        description: '默认正常费用；异常费用单独标记，便于审核与筛选。'
      },
      {
        label: '费用项目',
        key: 'expenseItemId',
        type: 'treeSelect',
        span: 24,
        hidden: true,
        api: () => fetchSelectableExpenseItems(formData.tenantId || ''),
        params: { tenantId: formData.tenantId },
        shouldFetch: (params) => Boolean(params?.tenantId),
        resultField: 'data',
        labelField: 'itemName',
        valueField: 'id',
        childrenField: 'children',
        props: {
          placeholder: '请选择可记账的费用项目',
          checkStrictly: true,
          defaultExpandAll: true,
          renderAfterExpand: false
        }
      },
      {
        label: '费用金额',
        key: 'amount',
        type: 'number',
        hidden: true,
        props: {
          min: 0.01,
          precision: 2,
          controlsPosition: 'right',
          class: '!w-full',
          disabled:
            !canEditCostAmounts.value ||
            Boolean(formData.maintenanceRecordId) ||
            formData.sourceType === 'vehicle_maintenance'
        }
      },
      {
        label: '发生日期',
        key: 'occurredOn',
        type: 'date',
        hidden: true,
        props: { valueFormat: 'YYYY-MM-DD', class: '!w-full' }
      },
      {
        label: '数量/用量',
        key: 'quantity',
        type: 'number',
        hidden: true,
        props: {
          min: 0,
          precision: 3,
          controlsPosition: 'right',
          class: '!w-full',
          disabled: !canEditCostAmounts.value
        }
      },
      {
        label: '单价',
        key: 'unitPrice',
        type: 'number',
        hidden: true,
        props: {
          min: 0,
          precision: 4,
          controlsPosition: 'right',
          class: '!w-full',
          disabled: !canEditCostAmounts.value
        }
      },
      {
        label: '费用说明',
        key: 'remark',
        type: 'textarea',
        span: 24,
        hidden: true,
        props: {
          rows: 3,
          maxlength: 500,
          showWordLimit: true,
          placeholder: '说明费用产生原因、业务背景或票据异常'
        }
      },
      { label: '', key: 'expenseLines', span: 24, labelWidth: 0 },
      {
        label: '收款与票据',
        key: 'paymentSection',
        type: 'tab',
        span: 24,
        hidden: !canViewPaymentDetails.value
      },
      {
        label: '服务商',
        key: 'providerName',
        type: 'input',
        hidden: !canViewPaymentDetails.value,
        props: {
          maxlength: 200,
          placeholder: '加油站、充电站或服务商',
          disabled: !canEditPaymentDetails.value
        }
      },
      {
        label: '收款对象',
        key: 'payeeType',
        type: 'select',
        hidden: !canViewPaymentDetails.value,
        props: {
          options: [
            { label: '手工指定', value: 'manual' },
            { label: '服务商', value: 'provider' },
            { label: '运单司机', value: 'driver', disabled: !selectedWaybill.value?.driverId }
          ],
          disabled: !canEditPaymentDetails.value
        },
        description: '选择运单司机后，可带入其默认收款账户；历史费用保留保存时的账户。'
      },
      {
        label: '收款方',
        key: 'payeeName',
        type: 'input',
        hidden: !canViewPaymentDetails.value,
        props: {
          maxlength: 200,
          placeholder: '司机、服务商或实际收款人',
          disabled: !canEditPaymentDetails.value
        }
      },
      {
        label: '收款银行',
        key: 'payeeBank',
        type: 'input',
        hidden: !canViewPaymentDetails.value,
        props: {
          maxlength: 200,
          placeholder: '司机默认账户或手工填写',
          disabled: !canEditPaymentDetails.value
        }
      },
      {
        label: '收款账号',
        key: 'payeeAccount',
        type: 'input',
        hidden: !canViewPaymentDetails.value,
        props: {
          maxlength: 200,
          placeholder: '请核对实际收款账号',
          disabled: !canEditPaymentDetails.value
        }
      },
      {
        label: '支付渠道',
        key: 'paymentChannel',
        type: 'select',
        hidden: !canViewPaymentDetails.value,
        props: {
          options: paymentChannelOptions.value,
          placeholder: '请选择支付渠道',
          clearable: true,
          disabled: !canEditPaymentDetails.value
        }
      },
      {
        label: '关联油卡',
        key: 'fuelCardId',
        type: 'select',
        hidden: !canViewPaymentDetails.value || formData.paymentChannel !== '油卡',
        props: {
          options: fuelCardOptions.value.map((card) => ({ label: card.cardNo, value: card.id })),
          placeholder: fuelCardLoading.value ? '正在加载当前车辆油卡' : '请选择当前车辆油卡',
          disabled: !canEditPaymentDetails.value || fuelCardLoading.value,
          clearable: fuelCardOptions.value.length > 1
        },
        description:
          fuelCardLoadError.value ||
          (fuelCardOptions.value.length === 0
            ? '当前车辆没有可用油卡，请先维护油卡档案。'
            : fuelCardOptions.value.length === 1
              ? '已按运单车牌自动关联唯一可用油卡。'
              : '同车有多张油卡，请确认本次消费使用的卡。')
      },
      {
        label: '油卡号',
        key: 'fuelCardNo',
        type: 'input',
        hidden: !canViewPaymentDetails.value || formData.paymentChannel !== '油卡',
        props: { readonly: true, placeholder: '选择油卡后自动带出' }
      },
      {
        label: '票据号码',
        key: 'invoiceNo',
        type: 'input',
        hidden: !canViewPaymentDetails.value,
        props: {
          maxlength: 120,
          placeholder: '发票号、订单号或交易号',
          disabled: !canEditPaymentDetails.value
        }
      },
      {
        label: '表号/桩号',
        key: 'meterNo',
        type: 'input',
        hidden: !canViewPaymentDetails.value,
        props: {
          maxlength: 120,
          placeholder: '油枪号、充电桩号或设备号',
          disabled: !canEditPaymentDetails.value
        }
      },
      {
        label: '地点与说明',
        key: 'locationSection',
        type: 'tab',
        span: 24,
        hidden: !canViewExpenseLocation.value
      },
      {
        label: '',
        key: 'locationPicker',
        type: 'input',
        span: 24,
        labelWidth: 0,
        hidden: !canViewExpenseLocation.value
      },

      { key: 'expenseEvidenceSection', label: '票据与识别', type: 'tab', hidden: !canUseOcr.value },
      { key: 'expenseEvidence', label: '', span: 24, labelWidth: 0, hidden: !canUseOcr.value }
    ])
  })

  const selectedWaybill = computed(() => selection.waybills[0])
  watch(selectedWaybill, (waybill) => {
    if (state.hydrating) return
    form.data.driverNameSnapshot = waybill?.driverName || ''
    form.data.plateNoSnapshot = waybill?.plateNo || waybill?.order?.dispatchPlateNo || ''
    form.data.driverPhoneSnapshot =
      waybill?.driver?.phone || waybill?.order?.dispatchDriverPhone || ''
    form.data.driverOwnershipDisplay = waybill?.driverOwnership || ''
    form.data.companyNameDisplay = waybill?.companyName || ''
    form.data.carrierNameDisplay = waybill?.carrierName || waybill?.carrier?.companyName || ''
  })
  function applyMaintenanceSource(source: { id: string; amount: number }): void {
    Object.assign(form.data, { maintenanceRecordId: source.id, amount: source.amount })
  }
  watch(
    [
      () => form.data.waybillId,
      () => selectedWaybill.value?.id,
      () => selectedWaybill.value?.tenantId
    ],
    ([waybillId], [previousWaybillId]) => {
      if (state.hydrating) return
      const selectedTenantId =
        selectedWaybill.value?.id === waybillId ? selectedWaybill.value.tenantId || '' : ''
      if (waybillId === previousWaybillId && selectedTenantId === form.data.tenantId) return
      Object.assign(form.data, {
        tenantId: selectedTenantId,
        payeeName: '',
        payeeType: 'manual',
        payeeDriverId: null,
        payeeBank: '',
        payeeAccount: '',
        legId: null,
        expenseItemId: '',
        fuelCardId: null,
        fuelCardNo: null,
        maintenanceRecordId: null,
        attachments: [],
        latestOcrRunId: null,
        ocrArtifactId: null,
        ocrStatus: 'not_started',
        ...(!form.data.id ? { costNo: '' } : {})
      })
      saveError.value = ''
      driverDefaultAccount.value = null
      driverAccountError.value = ''
      driverAccountLoading.value = false
      manualPayeeSnapshot.value = null
      ocrPanelRef.value?.reset()
      void loadFuelCards(waybillId, selectedTenantId)
    }
  )
  watch(
    () => form.data.payeeType,
    (payeeType, previousType) => {
      if (state.hydrating || payeeType === previousType) return
      driverDefaultAccount.value = null
      driverAccountError.value = ''
      if (payeeType === 'driver') {
        manualPayeeSnapshot.value = {
          name: form.data.payeeName || '',
          bank: form.data.payeeBank || '',
          account: form.data.payeeAccount || ''
        }
        Object.assign(form.data, {
          payeeDriverId: null,
          payeeName: '',
          payeeBank: '',
          payeeAccount: ''
        })
        void loadDriverDefaultAccount()
      } else {
        if (previousType === 'driver' && manualPayeeSnapshot.value) {
          Object.assign(form.data, {
            payeeName: manualPayeeSnapshot.value.name,
            payeeBank: manualPayeeSnapshot.value.bank,
            payeeAccount: manualPayeeSnapshot.value.account
          })
          manualPayeeSnapshot.value = null
        }
        form.data.payeeDriverId = null
      }
    }
  )

  async function loadDriverDefaultAccount(): Promise<void> {
    const waybillId = form.data.waybillId
    if (!waybillId || !selectedWaybill.value?.driverId) {
      driverAccountError.value = '请先选择已分配司机的运单。'
      return
    }
    const session = formSession.value
    const ensureScope = createTenantScopeReadGuard()
    driverAccountLoading.value = true
    try {
      const { data, error } = await fetchWaybillDriverDefaultAccount(waybillId, form.data.id)
      if (
        !isCurrent(session) ||
        form.data.waybillId !== waybillId ||
        form.data.payeeType !== 'driver'
      )
        return
      ensureScope()
      if (error) throw error
      if (!data?.driverId) {
        driverAccountError.value = '关联运单尚未分配司机，请重新选择运单。'
        return
      }
      driverDefaultAccount.value = data
      form.data.payeeDriverId = data.driverId
      form.data.payeeName = data.driverName
      if (data.hasDefaultAccount) {
        form.data.payeeBank = data.bankName || ''
        form.data.payeeAccount = data.bankAccount || ''
      } else {
        driverAccountError.value = '该司机未启用默认开票账户，请人工核对收款银行与账号。'
      }
    } catch (error) {
      if (isCurrent(session))
        driverAccountError.value = getFriendlySupabaseErrorMessage(
          error,
          '司机收款资料加载失败，请重试。'
        )
    } finally {
      if (isCurrent(session)) driverAccountLoading.value = false
    }
  }
  watch(
    () => form.data.paymentChannel,
    (channel) => {
      if (state.hydrating) return
      if (channel !== '油卡') {
        form.data.fuelCardId = null
        form.data.fuelCardNo = null
      } else if (!form.data.fuelCardId && fuelCardOptions.value.length === 1) {
        form.data.fuelCardId = fuelCardOptions.value[0].id
      }
    }
  )
  watch(
    () => form.data.fuelCardId,
    (id) => {
      if (state.hydrating) return
      form.data.fuelCardNo = fuelCardOptions.value.find((card) => card.id === id)?.cardNo || null
    }
  )

  async function loadFuelCards(waybillId: string, tenantId: string): Promise<void> {
    fuelCardOptions.value = []
    driverDefaultAccount.value = null
    driverAccountError.value = ''
    driverAccountLoading.value = false
    manualPayeeSnapshot.value = null
    fuelCardLoadError.value = ''
    if (!waybillId || !tenantId) return
    const session = formSession.value
    const ensureScope = createTenantScopeReadGuard()
    fuelCardLoading.value = true
    try {
      const result = await fetchWaybillFuelCardOptions(waybillId)
      if (!isCurrent(session) || form.data.waybillId !== waybillId) return
      ensureScope()
      if (result.error) throw result.error
      fuelCardOptions.value = result.data || []
      if (
        form.data.id &&
        form.data.fuelCardId &&
        form.data.fuelCardNo &&
        !fuelCardOptions.value.some((card) => card.id === form.data.fuelCardId)
      ) {
        fuelCardOptions.value.push({
          id: form.data.fuelCardId,
          cardNo: `${form.data.fuelCardNo}（原关联卡）`,
          plateNo: ''
        })
      }
      if (
        form.data.paymentChannel === '油卡' &&
        !form.data.fuelCardId &&
        fuelCardOptions.value.length === 1
      ) {
        form.data.fuelCardId = fuelCardOptions.value[0].id
      }
    } catch (error) {
      if (isCurrent(session))
        fuelCardLoadError.value = getFriendlySupabaseErrorMessage(
          error,
          '油卡加载失败，请重试或更换支付渠道'
        )
    } finally {
      if (isCurrent(session)) fuelCardLoading.value = false
    }
  }
  const expenseLocationModel = computed({
    get: () => form.data.expenseLocation || '',
    set: (value: string) => {
      form.data.expenseLocation = value
    }
  })
  const hasValidExpenseCoordinate = computed(
    () => normalizeCoordinatePair(form.data.expenseLongitude, form.data.expenseLatitude) !== null
  )
  const waybillSummary = computed(() => {
    const waybill = selectedWaybill.value
    if (!waybill) return ''
    const driver =
      waybill.driverName ||
      waybill.driver?.driverName ||
      waybill.order?.dispatchDriverName ||
      '司机待补充'
    const plate = waybill.plateNo || waybill.order?.dispatchPlateNo || '车牌待补充'
    const route =
      waybill.route || [waybill.originCity, waybill.destinationCity].filter(Boolean).join(' → ')
    return `${waybill.orderNo || '关联订单待补充'} · ${waybill.waybillNo} · ${plate} · ${driver}${route ? ` · ${route}` : ''}`
  })
  const waybillColumns: DataSelectColumn[] = [
    { prop: 'waybillNo', label: '运单号', width: 180 },
    { prop: 'orderNo', label: '订单号', width: 170 },
    { prop: 'plateNo', label: '车牌号', width: 120 },
    { prop: 'driverName', label: '司机', width: 110 },
    { prop: 'route', label: '运输路线', minWidth: 220 }
  ]

  async function fetchSelectableExpenseItems(tenantId: string) {
    if (!tenantId) return { data: [], error: null }
    const result = await fetchExpenseItemTree({ tenantId })
    const enabledItems = expenseOptionTreeUtils.removeNodesByCondition(
      result.data,
      (item) => !item.isEnabled
    ).tree
    return {
      ...result,
      data: expenseOptionTreeUtils.mapTree(enabledItems, (item) => ({
        ...item,
        disabled: !item.isSelectable
      }))
    }
  }

  watch(
    () => form.data.tenantId,
    async (tenantId) => {
      selectableExpenseItems.value = []
      if (!tenantId) return
      const session = formSession.value
      try {
        const result = await fetchSelectableExpenseItems(tenantId)
        if (!isCurrent(session) || form.data.tenantId !== tenantId) return
        selectableExpenseItems.value = expenseOptionTreeUtils
          .treeToList(result.data)
          .filter((item) => item.isSelectable && item.isEnabled)
      } catch {
        if (isCurrent(session)) saveError.value = '费用项目加载失败，请重新选择运单后重试'
      }
    }
  )

  async function fetchWaybillSelectorData(params: DataSelectFetchParams) {
    const { from, to } = buildSupabasePageRange({ current: params.page, size: params.pageSize })
    const { data, total } = await fetchFinanceWaybillOptions({
      keyword: params.keyword,
      from,
      to
    })
    return {
      data: (data ?? []).map(toSelectorWaybill),
      total: total ?? 0
    }
  }

  function toSelectorWaybill(item: Waybill): SelectorWaybill {
    const plateNo = item.order?.dispatchPlateNo || item.plateNo || ''
    const driverName = item.driver?.driverName || item.order?.dispatchDriverName || ''
    const route = [item.originCity, item.destinationCity].filter(Boolean).join(' → ')
    return {
      ...item,
      orderNo: item.order?.orderNo || '',
      plateNo,
      driverName,
      route,
      summary: [plateNo, driverName, route].filter(Boolean).join(' · ')
    }
  }

  function toEditSelectedWaybill(expense: Expense): SelectorWaybill {
    if (expense.waybill)
      return { ...toSelectorWaybill(expense.waybill), tenantId: expense.tenantId }

    const plateNo = expense.plateNoSnapshot || ''
    const driverName = expense.driverNameSnapshot || ''
    const route = expense.routeSnapshot || ''
    return {
      id: expense.waybillId,
      tenantId: expense.tenantId,
      waybillNo: expense.waybillNoSnapshot || '关联运单',
      status: '',
      orderNo: expense.orderNoSnapshot || '',
      plateNo,
      driverName,
      route,
      summary: [plateNo, driverName, route].filter(Boolean).join(' · ')
    }
  }

  function applyOcrResult(result: Api.Fms.WaybillExpenseOcrAnalyzeResponse): void {
    if (!canUseOcr.value) return
    const value = result.expense
    const ocrLocation = value.expenseLocation?.trim()
    const shouldApplyOcrLocation = Boolean(ocrLocation) && !hasValidExpenseCoordinate.value
    Object.assign(form.data, {
      amount: value.amount ?? form.data.amount,
      occurredOn: value.occurredOn ?? form.data.occurredOn,
      quantity: value.quantity,
      unitPrice: value.unitPrice,
      providerName: value.providerName ?? form.data.providerName,
      payeeName: value.payeeName ?? form.data.payeeName,
      paymentChannel: value.paymentChannel ?? form.data.paymentChannel,
      invoiceNo: value.invoiceNo ?? form.data.invoiceNo,
      meterNo: value.meterNo ?? form.data.meterNo,
      expenseLocation: shouldApplyOcrLocation ? ocrLocation : form.data.expenseLocation,
      remark: value.remark ?? form.data.remark,
      latestOcrRunId: result.runId,
      ocrArtifactId: result.artifactId,
      ocrStatus: 'succeeded'
    })
    if (shouldApplyOcrLocation) clearExpenseCoordinate()
  }

  function clearExpenseCoordinate(): void {
    Object.assign(form.data, {
      expenseRegion: '',
      expenseRegionPath: [],
      expenseRegionAdcode: '',
      expenseLongitude: null,
      expenseLatitude: null,
      expenseCoordinateSystem: 'gcj02',
      expenseCoordinateSource: '',
      expenseCoordinateStatus: 'pending',
      expenseGeocodeProvider: '',
      expenseGeocodedAt: null
    })
  }

  function syncExpenseLocation(payload: AddressLocationPayload): void {
    form.data.expenseRegion = payload.region || form.data.expenseRegionPath.join('/')
    void nextTick(() => {
      form.data.expenseRegion = form.data.expenseRegionPath.join('/')
    })
  }

  function buildOcrFinalPayload(): Record<string, unknown> {
    return {
      expenseItemId: form.data.expenseItemId,
      amount: Number(form.data.amount),
      occurredOn: form.data.occurredOn,
      quantity: form.data.quantity,
      unitPrice: form.data.unitPrice,
      providerName: form.data.providerName || null,
      payeeName: form.data.payeeName || null,
      paymentChannel: form.data.paymentChannel || null,
      invoiceNo: form.data.invoiceNo || null,
      meterNo: form.data.meterNo || null,
      expenseLocation: form.data.expenseLocation || null,
      expenseRegion: form.data.expenseRegion || null,
      expenseRegionAdcode: form.data.expenseRegionAdcode || null,
      expenseLongitude: form.data.expenseLongitude ?? null,
      expenseLatitude: form.data.expenseLatitude ?? null,
      expenseCoordinateSystem: form.data.expenseCoordinateSystem || null,
      expenseCoordinateSource: form.data.expenseCoordinateSource || null,
      expenseCoordinateStatus: form.data.expenseCoordinateStatus || 'pending',
      expenseGeocodeProvider: form.data.expenseGeocodeProvider || null,
      expenseGeocodedAt: form.data.expenseGeocodedAt || null,
      remark: form.data.remark || null
    }
  }

  function buildExpensePayload(): Expense {
    return {
      ...omit(structuredClone(toRaw(form.data)), [
        'expenseRegionPath',
        'locationPicker',
        'driverOwnershipDisplay',
        'companyNameDisplay',
        'carrierNameDisplay'
      ]),
      payeeType: form.data.payeeType || 'manual',
      payeeDriverId: form.data.payeeType === 'driver' ? form.data.payeeDriverId || null : null,
      payeeBank: normalizeNullableText(form.data.payeeBank),
      payeeAccount: normalizeNullableText(form.data.payeeAccount)
    }
  }

  function canSave(): boolean {
    if (hasAuth(savePermission.value)) return true
    ElMessage.warning('运单费用操作权限已变化，请刷新页面后重试')
    return false
  }

  async function handleSubmit(): Promise<boolean> {
    const session = formSession.value
    const ensureScope = createTenantScopeReadGuard()
    if (!canSave()) return false
    if (
      canEditPaymentDetails.value &&
      form.data.payeeType === 'driver' &&
      (driverAccountLoading.value || !form.data.payeeDriverId)
    ) {
      ElMessage.warning('请等待司机收款资料加载完成并确认收款司机')
      return false
    }
    saveError.value = ''
    if (!form.data.tenantId || selectedWaybill.value?.tenantId !== form.data.tenantId) {
      saveError.value = '请重新选择关联运单，确认费用所属租户后再保存。'
      ElMessage.warning(saveError.value)
      return false
    }
    if (ocrLoadError.value) return false
    if (!formRef.value?.readyToSubmit) {
      ElMessage.warning('表单控件仍在加载，请稍后再保存')
      return false
    }
    try {
      if (!(await validateArtFormForSubmit(formRef.value))) return false
      if (!isCurrent(session)) return false
      ensureScope()
      if (!canSave()) return false
    } catch (error) {
      if (!isCurrent(session)) return false
      notifyFriendlyError(error, '运单费用校验失败，请重试')
      return false
    }
    if (isCompact.value && canEditExpenseLocation.value && !hasValidExpenseCoordinate.value) {
      await addressPickerRef.value?.locateCurrent()
      if (!isCurrent(session)) return false
      try {
        if (!(await validateArtFormForSubmit(formRef.value))) return false
      } catch (error) {
        if (isCurrent(session)) notifyFriendlyError(error, '运单费用校验失败，请重试')
        return false
      }
    }
    if (!isCurrent(session)) return false
    try {
      ensureScope()
    } catch (error) {
      notifyFriendlyError(error, '租户范围已变化，请刷新后重试')
      return false
    }
    if (!canSave()) return false
    const lineValidation = await lineTableRef.value?.validate()
    if (!lineValidation) {
      lineValidationMessage.value = '费用明细尚未准备完成，请稍后再保存'
      return false
    }
    if (!lineValidation.valid) {
      const firstError = lineValidation.firstError
      lineValidationMessage.value = firstError
        ? `第 ${(firstError.rowIndex + 1) * 10} 行：${firstError.message}`
        : '请检查费用明细'
      return false
    }
    lineValidationMessage.value = ''
    if (
      !form.data.expenseItemId ||
      !form.data.occurredOn ||
      !['normal', 'abnormal'].includes(form.data.expenseClassification || '') ||
      (canEditCostAmounts.value &&
        (!Number.isFinite(Number(form.data.amount)) || Number(form.data.amount) <= 0))
    ) {
      ElMessage.warning('请完善第 10 行的费用项目、分类、金额和日期')
      return false
    }
    if (extraLines.value.length) {
      for (const [index, line] of extraLines.value.entries()) {
        if (
          !selectableExpenseItems.value.some((item) => item.id === line.expenseItemId) ||
          line.amount === null ||
          !Number.isFinite(line.amount) ||
          line.amount <= 0 ||
          !line.occurredOn ||
          !['normal', 'abnormal'].includes(line.expenseClassification) ||
          (expenseNumber.manualRequired(false) && !line.costNo.trim())
        ) {
          ElMessage.warning(`请完善第 ${(index + 2) * 10} 行的费用项目、分类、金额、日期和单号`)
          return false
        }
      }
    }
    const payload = buildExpensePayload()
    const type = payload.id ? 'edit' : 'add'
    const artifactId = canUseOcr.value ? payload.ocrArtifactId : undefined
    const finalPayload = artifactId ? buildOcrFinalPayload() : undefined
    let entityId: string | undefined
    try {
      if (!payload.id && extraLines.value.length) {
        const lines = [payload, ...extraLines.value].map((line) => ({
          costNo: line.costNo || '',
          expenseItemId: line.expenseItemId,
          amount: Number(line.amount),
          occurredOn: line.occurredOn,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          remark: line.remark,
          expenseClassification: line.expenseClassification || ('normal' as const)
        }))
        const response = await addWaybillCostBatch(payload, lines)
        if (response.error || !response.data?.[0]?.id)
          throw response.error ?? new Error('费用保存后未返回单据，请刷新列表核对')
        entityId = response.data[0].id
      } else {
        const response = payload.id
          ? await editWaybillCost(payload, { showMessage: false, showErrorMessage: false })
          : await addWaybillCost(payload, { showMessage: false, showErrorMessage: false })
        if (response.error || !response.data)
          throw response.error ?? new Error('费用保存后未返回单据，请刷新列表核对')
        entityId = payload.id || response.data.id
      }
    } catch (error) {
      if (isCurrent(session)) {
        saveError.value = getFriendlySupabaseErrorMessage(
          error,
          '运单费用保存失败，请重新选择当前运单的费用项目后重试'
        )
        ElMessage.error(saveError.value)
      }
      return false
    }
    if (artifactId && finalPayload && entityId) {
      try {
        const { error } = await reviewWaybillExpenseOcrArtifact({
          artifactId,
          entityId,
          finalPayload
        })
        if (error && isCurrent(session))
          ElMessage.warning('运单费用已保存，但 AI 质量记录失败；不影响正式业务数据')
      } catch {
        if (isCurrent(session))
          ElMessage.warning('运单费用已保存，但 AI 质量记录失败；不影响正式业务数据')
      }
    }
    emit('success', type)
    if (isCurrent(session)) ElMessage.success('运单费用已保存')
    return true
  }

  async function loadOcrResult(session = formSession.value): Promise<void> {
    const loader = ocrResultLoader.value
    if (!loader || !isCurrent(session)) return
    const ensureScope = createTenantScopeReadGuard()
    ocrLoadError.value = ''
    dialogRef.value?.setLoading(true)
    try {
      const result = await loader()
      if (!isCurrent(session)) return
      ensureScope()
      if (!state.ocrEnabled) throw new Error('票据识别功能当前不可用')
      applyOcrResult(result)
    } catch (error) {
      if (isCurrent(session))
        ocrLoadError.value = getFriendlySupabaseErrorMessage(error, '识别结果加载失败')
    } finally {
      if (isCurrent(session)) dialogRef.value?.setLoading(false)
    }
  }

  async function resetForm(): Promise<number> {
    const session = invalidateSession()
    state.hydrating = true
    saveError.value = ''
    lineValidationMessage.value = ''
    state.autoLocateArmed = false
    Object.assign(form.data, createInitialForm())
    extraLines.value = []
    batchExpenseItemIds.value = []
    selection.waybills = []
    fuelCardOptions.value = []
    fuelCardLoadError.value = ''
    fuelCardLoading.value = false
    ocrPanelRef.value?.reset()
    await nextTick()
    state.hydrating = false
    if (session === formSession.value) formRef.value?.clearValidate()
    return session
  }

  async function prefillByOrderId(orderId: string, session: number): Promise<void> {
    const ensureScope = createTenantScopeReadGuard()
    const { data, error } = await fetchFinanceWaybillOptions(
      { orderId, from: 0, to: 9 },
      { showErrorMessage: false }
    )
    if (!isCurrent(session)) return
    ensureScope()
    if (error) throw error
    const waybill = data?.[0]
    if (!waybill || !isCurrent(session)) return
    form.data.waybillId = waybill.id
    selection.waybills = [toSelectorWaybill(waybill)]
  }

  async function handleOpen(data: ExpenseDialogOpenData = {}): Promise<void> {
    const permission = data.row ? 'FinanceWaybillCost:Edit' : 'FinanceWaybillCost:Add'
    if (!hasAuth(permission)) {
      ElMessage.warning('没有运单费用操作权限，请联系管理员')
      return
    }
    savePermission.value = permission
    const session = await resetForm()
    if (session !== formSession.value) return
    ocrLoadError.value = ''
    ocrResultLoader.value = data.loadOcrResult
    if (data.row) {
      state.hydrating = true
      Object.assign(form.data, createInitialForm(), structuredClone(toRaw(data.row)))
      selection.waybills = [toEditSelectedWaybill(data.row)]
      form.data.driverOwnershipDisplay = data.row.waybill?.driverOwnership || ''
      form.data.companyNameDisplay = data.row.waybill?.companyName || ''
      form.data.carrierNameDisplay =
        data.row.waybill?.carrierName || data.row.waybill?.carrier?.companyName || ''
      form.data.expenseRegionPath = String(form.data.expenseRegion || '')
        .split('/')
        .map((item) => item.trim())
        .filter(Boolean)
      form.data.expenseLocation = form.data.expenseLocation || ''
      await nextTick()
      state.hydrating = false
    }
    await dialogRef.value?.handleOpen(data, {
      title: data.row
        ? `编辑运单费用 · ${data.row.costNo}`
        : data.ocrResult || data.loadOcrResult
          ? '复核识别结果 · 新增运单费用'
          : '新增运单费用',
      subtitle:
        data.ocrResult || data.loadOcrResult
          ? '识别字段已恢复为草稿，请绑定运单并完成人工核对后再保存'
          : '按费用项目和运单统一归集承运、在途及其他业务成本',
      confirmText: data.row ? '保存修改' : '保存草稿',
      contentMaxHeight: '78vh',
      loading: true,
      loadingText: '正在准备运单费用…',
      onOpen: async (_openData, api) => {
        const ensureScope = createTenantScopeReadGuard()
        try {
          const [, enabled] = await Promise.all([
            expenseNumber.loadRule(),
            fetchWaybillExpenseOcrEnabled(),
            userStore.ensureDictLoaded('tmsExpenseClassification'),
            data.row
              ? loadFuelCards(form.data.waybillId, form.data.tenantId || '')
              : Promise.resolve(),
            data.orderId ? prefillByOrderId(data.orderId, session) : Promise.resolve()
          ])
          if (!isCurrent(session)) return
          ensureScope()
          state.ocrEnabled = enabled
          if (data.loadOcrResult) await loadOcrResult(session)
          else if (data.ocrResult && enabled) applyOcrResult(data.ocrResult)
        } catch (error) {
          if (isCurrent(session)) {
            state.ocrEnabled = false
            notifyFriendlyError(error, '费用信息准备失败，请关闭后重新打开表单')
          }
        } finally {
          if (isCurrent(session)) {
            state.autoLocateArmed = true
            api.setLoading(false)
          }
        }
      },
      onConfirm: handleSubmit,
      onReset: async () => {
        const resetSession = await resetForm()
        if (resetSession === formSession.value) state.autoLocateArmed = true
      },
      dialogProps: { appendToBody: true, closeOnClickModal: false }
    })
  }

  watch(
    () => form.data.attachments.length,
    (count, previousCount) => {
      if (
        !state.autoLocateArmed ||
        !isCompact.value ||
        !canEditExpenseLocation.value ||
        count <= previousCount ||
        hasValidExpenseCoordinate.value
      ) {
        return
      }
      const session = formSession.value
      void nextTick(() => {
        if (
          !isCurrent(session) ||
          !state.autoLocateArmed ||
          !hasAuth(savePermission.value) ||
          !canEditExpenseLocation.value ||
          hasValidExpenseCoordinate.value ||
          form.data.attachments.length < count
        )
          return
        void addressPickerRef.value?.locateCurrent()
      })
    }
  )

  defineExpose({ handleOpen })
</script>

<style scoped lang="scss">
  .expense-dialog {
    &__waybill-summary {
      margin-top: var(--art-space-4);
    }
  }
</style>
