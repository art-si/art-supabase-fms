<template>
  <ArtDialog ref="dialogRef" size="lg" @close="() => void invalidateSession()">
    <ElAlert v-if="saveError" type="error" :closable="false" show-icon class="mb-4">
      <template #title>{{ saveError }}</template>
    </ElAlert>
    <ElAlert v-if="ocrLoadError" type="error" :closable="false" show-icon>
      <template #title>{{ ocrLoadError }}</template>
      <ElButton link type="primary" @click="() => loadOcrResult()">重新加载</ElButton>
    </ElAlert>
    <ExpenseOcrPanel
      v-if="canUseOcr"
      ref="ocrPanelRef"
      v-model="form.data.attachments"
      :enabled="state.ocrEnabled"
      :resource-tenant-id="attachmentTenantId"
      @apply="applyOcrResult"
      @failed="form.data.ocrStatus = 'failed'"
    />

    <ArtForm
      :key="attachmentTenantId || 'unbound'"
      ref="formRef"
      v-model="form.data"
      :items="form.items"
      :rules="form.rules"
      :span="isCompact ? 24 : 12"
      :gutter="20"
      label-width="104px"
      :show-reset="false"
      :show-submit="false"
    >
      <template #waybillId>
        <ArtTableSingleSelect
          v-model="form.data.waybillId"
          v-model:selected-data="selection.waybills"
          :api-fn="fetchWaybillSelectorData"
          :columns="waybillColumns"
          title="选择关联运单"
          subtitle="支持按运单号、订单号、车牌号或司机检索，选中后自动带出司机和车辆"
          row-key="id"
          label-key="waybillNo"
          description-key="summary"
          placeholder="请选择运单或输入车牌号检索"
          search-placeholder="运单号、订单号、车牌号、司机"
          empty-text="暂无可关联运单"
          empty-description="请先创建并推进运单业务，当前筛选范围内没有可关联的运单。"
          dialog-width="xl"
          show-pagination
          :page-size="10"
        >
          <template #empty><FinanceDataSourceEmptyActions source="waybill" /></template>
        </ArtTableSingleSelect>
      </template>

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
    </ArtForm>

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
  import { normalizeCoordinatePair } from '@/utils/geo'
  import { validateArtFormForSubmit } from '@/utils/form/validate-art-form'
  import { getFriendlySupabaseErrorMessage } from '@/utils/supabase'
  import { createTenantScopeReadGuard } from '@/utils/tenant-scope-context'
  import dayjs from 'dayjs'
  import { omit } from 'lodash-es'
  import { useMediaQuery } from '@vueuse/core'
  import type { ComputedRef } from 'vue'
  import { useArtOverlaySession } from '@/hooks/core/useArtOverlay'
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
  import ArtTableSingleSelect from '@/components/core/forms/art-data-select/table-single.vue'
  import FinanceDataSourceEmptyActions from '../../../components/finance-data-source-empty-actions.vue'
  import type {
    DataSelectColumn,
    DataSelectFetchParams,
    DataSelectRecord
  } from '@/components/core/forms/art-data-select/types'
  import {
    addWaybillCost,
    editWaybillCost,
    fetchExpenseItemTree,
    fetchFinanceWaybillOptions,
    fetchWaybillFuelCardOptions,
    fetchWaybillCostLegOptions,
    fetchWaybillExpenseOcrEnabled,
    reviewWaybillExpenseOcrArtifact
  } from '@fms/api'
  import type { WaybillFuelCardOption } from '@fms/api'
  import { buildSupabasePageRange } from '@/utils/supabase/pagination'
  import { canEditField, canViewField } from '@/utils/field-permission'
  import { useDocumentNumberRule } from '@/hooks/core/useDocumentNumberRule'
  import { useAuth } from '@/hooks/core/useAuth'
  import TreeUtils from '@/utils/tree'
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
  }

  const emit = defineEmits<{ success: [type: 'add' | 'edit'] }>()
  const { hasAuth } = useAuth()
  const savePermission = ref('FinanceWaybillCost:Add')
  const isCompact = useMediaQuery('(max-width: 767px)')
  const dialogRef = ref<ArtDialogExpose<ExpenseDialogOpenData>>()
  const ocrLoadError = ref('')
  const ocrResultLoader = shallowRef<ExpenseDialogOpenData['loadOcrResult']>()
  const formRef = ref<FormExpose>()
  const addressPickerRef = ref<ArtAddressPickerExpose>()
  const ocrPanelRef = ref<{ reset: () => void }>()
  const selection = reactive<{ waybills: SelectorWaybill[] }>({ waybills: [] })
  const fuelCardOptions = ref<WaybillFuelCardOption[]>([])
  const fuelCardLoadError = ref('')
  const fuelCardLoading = ref(false)
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
    legId: null,
    maintenanceRecordId: null,
    sourceType: null,
    sourceId: null,
    expenseItemId: '',
    costType: 'other',
    amount: 0,
    occurredOn: dayjs().format('YYYY-MM-DD'),
    quantity: null,
    unitPrice: null,
    providerName: '',
    payeeName: '',
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
  const expenseNumber = useDocumentNumberRule(
    'tms.waybill_cost',
    () => formData.tenantId || undefined
  )
  const attachmentTenantId = computed(() => formData.tenantId || '')
  const activeFieldAccess = computed(() => formData.fieldAccess ?? NEW_RECORD_FIELD_ACCESS)
  const canViewCostAmounts = computed(() => canViewField(activeFieldAccess.value, 'costAmounts'))
  const canEditCostAmounts = computed(() => canEditField(activeFieldAccess.value, 'costAmounts'))
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
      expenseItemId: [{ required: true, message: '请选择费用项目', trigger: 'change' }],
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
      { label: '业务关联', key: 'relationSection', type: 'divider', span: 24 },
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
      { label: '运单/车牌', key: 'waybillId', type: 'input' },
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
      { label: '费用信息', key: 'expenseSection', type: 'divider', span: 24 },
      {
        label: '费用项目',
        key: 'expenseItemId',
        type: 'treeSelect',
        span: 24,
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
        hidden: !canViewCostAmounts.value,
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
        props: { valueFormat: 'YYYY-MM-DD', class: '!w-full' }
      },
      {
        label: '数量/用量',
        key: 'quantity',
        type: 'number',
        hidden: !canViewCostAmounts.value,
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
        hidden: !canViewCostAmounts.value,
        props: {
          min: 0,
          precision: 4,
          controlsPosition: 'right',
          class: '!w-full',
          disabled: !canEditCostAmounts.value
        }
      },
      {
        label: '收款与票据',
        key: 'paymentSection',
        type: 'divider',
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
      { label: '地点与说明', key: 'locationSection', type: 'divider', span: 24 },
      {
        label: '',
        key: 'locationPicker',
        type: 'input',
        span: 24,
        labelWidth: 0,
        hidden: !canViewExpenseLocation.value
      },
      {
        label: '费用说明',
        key: 'remark',
        type: 'textarea',
        span: 24,
        props: {
          rows: 3,
          maxlength: 500,
          showWordLimit: true,
          placeholder: '说明费用产生原因、业务背景或票据异常'
        }
      }
    ])
  })

  const selectedWaybill = computed(() => selection.waybills[0])
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
      ocrPanelRef.value?.reset()
      void loadFuelCards(waybillId, selectedTenantId)
    }
  )
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
    return `${waybill.waybillNo} · ${plate} · ${driver}${route ? ` · ${route}` : ''}`
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
    return omit(structuredClone(toRaw(form.data)), ['expenseRegionPath', 'locationPicker'])
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
    saveError.value = ''
    if (!form.data.tenantId || selectedWaybill.value?.tenantId !== form.data.tenantId) {
      saveError.value = '请重新选择关联运单，确认费用所属租户后再保存。'
      ElMessage.warning(saveError.value)
      return false
    }
    if (ocrLoadError.value) return false
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
    const payload = buildExpensePayload()
    const type = payload.id ? 'edit' : 'add'
    const artifactId = canUseOcr.value ? payload.ocrArtifactId : undefined
    const finalPayload = artifactId ? buildOcrFinalPayload() : undefined
    let entityId: string | undefined
    try {
      const response = payload.id
        ? await editWaybillCost(payload, { showMessage: false, showErrorMessage: false })
        : await addWaybillCost(payload, { showMessage: false, showErrorMessage: false })
      if (response.error || !response.data)
        throw response.error ?? new Error('费用保存后未返回单据，请刷新列表核对')
      entityId = payload.id || response.data?.id
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
    state.autoLocateArmed = false
    Object.assign(form.data, createInitialForm())
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
