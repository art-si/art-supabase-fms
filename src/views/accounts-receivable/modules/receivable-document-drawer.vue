<template>
  <ArtDrawer ref="drawerRef" size="full" :loading="loading" :show-confirm-button="editable">
    <ArtAsyncState
      :error="loadError"
      :empty="!document"
      empty-title="单据尚未加载"
      empty-description="请重新加载单据，或返回列表选择有权查看的记录。"
      @retry="loadCurrent"
    >
      <template v-if="document">
        <ArtDescriptions :data="identity" :items="identityItems" :columns="4" class="mb-5" />
        <ArtForm
          v-if="editable"
          ref="formRef"
          v-model="form"
          :items="headerItems"
          :rules="rules"
          :show-submit="false"
          :show-reset="false"
          label-position="top"
          :span="6"
        />
        <ArtDescriptions v-else :data="document" :items="detailItems" :columns="4" />
        <ArtDescriptions
          v-if="!editable && bookSnapshot?.configured === true && bookSnapshot.accountSetId"
          class="mt-4"
          :data="bookSnapshot"
          :items="bookSnapshotItems"
          :columns="3"
        />
        <ElAlert
          v-else-if="
            !editable && document.status === 'approved' && bookSnapshot?.configured === false
          "
          class="mt-4"
          type="warning"
          :closable="false"
          :title="bookSnapshot.message || '原账套尚未核实，请先核对历史记账依据。'"
        />
        <ArtSectionCard
          title="应收明细"
          description="数量型按商品数量计价；金额型用于运输与服务。税率须明确选择。"
          class="mt-5"
        >
          <template v-if="editable" #actions>
            <div class="flex flex-wrap items-center gap-2">
              <ElButton :disabled="!editable" @click="materialPicker?.open()"
                ><ArtSvgIcon icon="ri:add-line" />参选物料</ElButton
              >
              <ElButton @click="addService"><ArtSvgIcon icon="ri:add-line" />新增服务行</ElButton>
            </div>
          </template>
          <ArtForm
            v-if="editable"
            v-model="form"
            :items="entryItems"
            :show-submit="false"
            :show-reset="false"
            :span="8"
          />
          <ArtTable
            ref="lineTable"
            :data="lines"
            :columns="lineColumns"
            :pagination="false"
            row-key="id"
            :height="420"
          />
          <div
            class="mt-4 flex flex-wrap justify-end gap-x-6 gap-y-2 text-sm font-medium tabular-nums"
            aria-live="polite"
          >
            <span>金额：{{ money(totals.amount, form.currencyCode) }}</span
            ><span>税额：{{ money(totals.taxAmount, form.currencyCode) }}</span
            ><span>价税合计：{{ money(totals.totalAmount, form.currencyCode) }}</span>
          </div>
        </ArtSectionCard>
      </template>
    </ArtAsyncState>
    <ArtTableMultipleSelect
      ref="materialPicker"
      :show-trigger="false"
      :api-fn="materialOptions"
      :columns="pickerColumns"
      row-key="id"
      label-key="name"
      title="参选物料"
      @confirm="(_keys, rows) => addMaterials(rows)"
    />
    <MasterDataDeleteGuard ref="deleteGuardRef" />
  </ArtDrawer>
</template>

<script setup lang="tsx">
  import type {
    DataSelectColumn,
    DataSelectKey
  } from '@/components/core/forms/art-data-select/types'
  import { ref, computed, watch, unref } from 'vue'
  import { useTenantOperationGuard } from '@/hooks/core/useTenantOperationGuard'
  import { useArtOverlaySession } from '@/hooks/core/useArtOverlay'
  import dayjs from 'dayjs'
  import { cloneDeep, sumBy } from 'lodash-es'
  import {
    ElInput,
    ElInputNumber,
    ElSelect,
    ElTreeSelect,
    ElOption,
    ElCheckbox,
    ElMessage
  } from 'element-plus'
  import {
    fetchArWorkspace,
    fetchArOptions,
    fetchArOrganizationTree,
    fetchArDeleteDependencies,
    saveReceivableDocument,
    type ReceivableDocument,
    type ReceivableWriteLine,
    type ReceivableWritePayload,
    type ArOption,
    type ArOrganizationOption
  } from '@/api/receivables'
  import { useTenantScopeStore } from '@/store/modules/tenant-scope'
  import TreeUtils from '@/utils/tree'
  import { useUserStore } from '@/store/modules/user'
  import { useDictionaryOptions } from '@/hooks/core/useDictionaryOptions'
  import { notifyFriendlyError } from '@/hooks/core/useArtFeedback'
  import { useRecordDeleteGuard } from '@/hooks/core/useRecordDeleteGuard'
  import { useAuth } from '@/hooks/core/useAuth'
  import MasterDataDeleteGuard from '@/components/business/master-data-delete-guard/index.vue'
  import { createArDeleteMetadata } from './ar-delete-metadata'
  import type { MasterDataDeleteResource } from '@/components/business/master-data-delete-guard/index.vue'
  import { getDeleteReferenceContext } from '@/utils/supabase/delete-reference'
  import { validateArtFormForSubmit } from '@/utils/form/validate-art-form'
  import {
    formatSensitiveCurrencyValue as money,
    formatNumberValue,
    formatPercentValue
  } from '@/utils/ui/format'
  import ArtDrawer from '@/components/core/drawers/art-drawer/index.vue'
  import type { ArtDrawerExpose } from '@/components/core/drawers/art-drawer/types'
  import ArtAsyncState from '@/components/core/feedback/art-async-state/index.vue'
  import ArtForm, { type FormItem } from '@/components/core/forms/art-form/index.vue'
  import ArtTable, { type ArtTableExpose } from '@/components/core/tables/art-table/index.vue'
  import ArtSectionCard from '@/components/core/surfaces/art-section-card/index.vue'
  import ArtDescriptions from '@/components/core/base/art-descriptions/index.vue'
  import type { ArtDescriptionItem } from '@/components/core/base/art-descriptions/types'
  import ArtTableMultipleSelect from '@/components/core/forms/art-data-select/table-multiple.vue'
  import type {
    ArtDataSelectExpose,
    DataSelectFetchParams
  } from '@/components/core/forms/art-data-select/types'
  import ArtButtonTable from '@/components/core/forms/art-button-table/index.vue'
  import type { ColumnOption } from '@/types'
  import { calculateReceivableLine } from './receivable-model'

  defineOptions({ name: 'ReceivableDocumentDrawer' })
  const props = defineProps<{ kind: 'estimate' | 'financial'; editPermission: string }>()
  const emit = defineEmits<{ success: [] }>()
  interface EditLine extends ReceivableWriteLine {
    id: string
    persisted: boolean
    materialCode: string
    specificationModel: string
    amount: number | null
    taxAmount: number | null
    totalAmount: number | null
    linkedFinancialAmount?: number | null
    reversedAmount?: number | null
    linkedQuantity?: number
    reversedQuantity?: number
  }
  const drawerRef = ref<ArtDrawerExpose>()
  const formRef = ref<InstanceType<typeof ArtForm>>()
  const lineTable = ref<ArtTableExpose>()
  const materialPicker = ref<ArtDataSelectExpose>()
  const loading = ref(false)
  const loadError = ref<Error>()
  const editable = ref(false)
  const document = ref<ReceivableDocument>()
  const form = ref<ReceivableWritePayload>(emptyForm())
  const lines = ref<EditLine[]>([])
  const removedPersistedLine = ref(false)
  const { hasAuth } = useAuth()
  const captureOperation = useTenantOperationGuard(
    props.kind === 'estimate'
      ? 'FinanceEstimatedReceivable:View'
      : 'FinanceFinancialReceivable:View'
  )
  const session = useArtOverlaySession(() => Boolean(unref(drawerRef.value?.visible)))
  const { deleteGuardRef, deleteRecord } = useRecordDeleteGuard(
    'fms_receivable_document',
    '应收明细'
  )
  let currentId: string | undefined
  let copying = false
  let generation = 0
  const taxOptions = useDictionaryOptions('arTaxRate', Number)
  const discountOptions = useDictionaryOptions('arDiscountMethod')
  const basisOptions = useDictionaryOptions('arBasis')
  const settlementOptions = useDictionaryOptions('arSettlementMethod')
  const currencyOptions = useDictionaryOptions('mdmCurrency')
  const title = computed(() => (props.kind === 'estimate' ? '暂估应收单' : '财务应收单'))
  const writePermission = computed(() =>
    form.value.id
      ? props.editPermission
      : props.kind === 'estimate'
        ? 'FinanceEstimatedReceivable:Add'
        : 'FinanceFinancialReceivable:Add'
  )
  const pickerColumns: DataSelectColumn<ArOption>[] = [
    { prop: 'code', label: '编码', minWidth: 150 },
    { prop: 'name', label: '名称', minWidth: 220 },
    { prop: 'specificationModel', label: '规格型号', minWidth: 150 }
  ]
  function emptyForm(): ReceivableWritePayload {
    return {
      requestId: crypto.randomUUID(),
      kind: props.kind,
      tenantId: useTenantScopeStore().effectiveTenantId ?? useUserStore().getUserInfo.tenantId,
      documentTypeId: '',
      customerId: '',
      payerCustomerId: '',
      settlementOrganizationId: '',
      projectId: '',
      requestDepartmentId: '',
      businessDate: dayjs().format('YYYY-MM-DD'),
      currencyCode: 'CNY',
      paymentTermId: '',
      settlementMethod: 'cash',
      remark: '',
      lines: [],
      isCredit: false,
      inputTaxInclusivePrice: true,
      inputAmount: false,
      discountIncludesTax: true
    }
  }
  const rules = {
    documentTypeId: [{ required: true, message: '请选择单据类型' }],
    customerId: [{ required: true, message: '请选择结算客户' }],
    settlementOrganizationId: [{ required: true, message: '请选择收款组织' }],
    businessDate: [{ required: true, message: '请选择业务日期' }],
    settlementMethod: [{ required: true, message: '请选择结算方式' }]
  }
  function remoteItem(key: string, label: string, type: string, picker = false): FormItem {
    if (type === 'company' || type === 'organization') {
      return {
        key,
        label,
        type: 'treeSelect',
        api: () => fetchArOrganizationTree(type, form.value.tenantId),
        labelField: 'name',
        valueField: 'id',
        childrenField: 'children',
        ...(key === 'settlementOrganizationId'
          ? {
              autoSelect: (options) =>
                new TreeUtils().treeToList(options).find((option) => option.isDefault === true)
            }
          : {}),
        props: { clearable: true, filterable: true, checkStrictly: true }
      }
    }
    return {
      key,
      label,
      type: picker ? 'dataSelect' : 'select',
      api: () => fetchArOptions(type, form.value.tenantId),
      labelField: 'name',
      valueField: 'id',
      ...(key === 'documentTypeId' ? { autoSelect: 'first' as const } : {}),
      props: picker
        ? {
            rowKey: 'id',
            labelKey: 'name',
            columns: pickerColumns,
            title: `参选${label}`,
            resolveSelected: async (keys: DataSelectKey[]) =>
              (await fetchArOptions(type, form.value.tenantId)).filter((row) =>
                keys.includes(row.id)
              ),
            clearable: true
          }
        : { clearable: true, filterable: true }
    }
  }
  const headerItems = computed<FormItem[]>(() => [
    remoteItem('documentTypeId', '单据类型', `${props.kind}_type`),
    { key: 'businessDate', label: '业务日期', type: 'date', props: { valueFormat: 'YYYY-MM-DD' } },
    remoteItem('customerId', '结算客户', 'customer', true),
    remoteItem('payerCustomerId', '付款客户', 'customer', true),
    remoteItem('settlementOrganizationId', '收款组织', 'company'),
    remoteItem('projectId', '项目名称', 'project', true),
    remoteItem('requestDepartmentId', '申请部门', 'organization'),
    remoteItem('paymentTermId', '收款条件', 'condition'),
    { key: 'currencyCode', label: '收款币种', type: 'select', props: { options: currencyOptions } },
    {
      key: 'settlementMethod',
      label: '结算方式',
      type: 'select',
      props: { options: settlementOptions }
    },
    {
      key: 'isCredit',
      label: '贷方应收',
      type: 'switch',
      hidden: props.kind !== 'financial' || Boolean(form.value.estimateId)
    },
    {
      key: 'remark',
      label: '备注',
      type: 'textarea',
      span: 24,
      props: { maxlength: 2000, rows: 2 }
    }
  ])
  const entryItems: FormItem[] = [
    { key: 'inputTaxInclusivePrice', label: '录入含税单价', type: 'switch' },
    { key: 'inputAmount', label: '录入金额', type: 'switch' },
    { key: 'discountIncludesTax', label: '折扣额含税', type: 'switch' }
  ]
  const identity = computed(() => ({
    documentNo: copying ? '保存后自动编号' : document.value?.documentNo || '保存后自动编号',
    accountingDate: form.value.businessDate,
    status: copying ? 'draft' : document.value?.status || 'draft',
    sourceNo: copying ? '复制新单' : document.value?.sourceNo || '手工录入'
  }))
  const identityItems: ArtDescriptionItem<typeof identity.value>[] = [
    { key: 'documentNo', label: '单据编号', field: 'documentNo' },
    { key: 'status', label: '单据状态', field: 'status', dictCode: 'arDocumentStatus' },
    { key: 'accountingDate', label: '记账日期', field: 'accountingDate' },
    { key: 'sourceNo', label: '来源单据', field: 'sourceNo' }
  ]
  const bookSnapshot = computed<ReceivableDocument['bookContext']>(
    () =>
      document.value?.bookContext ??
      (document.value?.bookSnapshotVersion === 1
        ? {
            configured: true,
            accountSetId: document.value.accountSetId,
            accountSetName: document.value.accountSetName,
            baseCurrencyCode: document.value.baseCurrencyCode,
            exchangeRate: document.value.exchangeRate
          }
        : undefined)
  )
  const bookSnapshotItems: ArtDescriptionItem<NonNullable<ReceivableDocument['bookContext']>>[] = [
    {
      key: 'accountSetName',
      label: '核算账套',
      value: (record: NonNullable<ReceivableDocument['bookContext']>) =>
        record.accountSetName || '原账套已确认'
    },
    { key: 'baseCurrencyCode', label: '本位币', field: 'baseCurrencyCode' },
    {
      key: 'exchangeRate',
      label: '原记账汇率',
      field: 'exchangeRate',
      formatter: (value) =>
        typeof document.value?.totalAmount === 'number' &&
        Number.isFinite(document.value.totalAmount) &&
        typeof value === 'number' &&
        Number.isFinite(value) &&
        value > 0
          ? formatNumberValue(value, 'zh-CN', { maximumFractionDigits: 12 })
          : '—'
    }
  ]
  const detailItems: ArtDescriptionItem<ReceivableDocument>[] = [
    { key: 'kind', label: '单据类别', field: 'kind', dictCode: 'arDocumentKind' },
    {
      key: 'isCredit',
      label: '借贷方向',
      field: 'isCredit',
      formatter: (_value, row) =>
        row.kind === 'reversal' ? '冲回原暂估' : row.isCredit ? '贷方' : '借方'
    },
    { key: 'documentTypeName', label: '单据类型', field: 'documentTypeName' },
    { key: 'customerName', label: '结算客户', field: 'customerName' },
    { key: 'organizationName', label: '收款组织', field: 'organizationName' },
    { key: 'projectName', label: '项目名称', field: 'projectName' },
    { key: 'paymentTermName', label: '收款条件', field: 'paymentTermName' },
    { key: 'currencyCode', label: '币种', field: 'currencyCode' },
    { key: 'dueDate', label: '计划到期日', field: 'dueDate' },
    { key: 'voucherNo', label: '凭证号', field: 'voucherNo' },
    { key: 'remark', label: '备注', field: 'remark', span: 4 }
  ]
  const totals = computed(() => ({
    amount: lines.value.some((row) => row.amount === null)
      ? null
      : sumBy(lines.value, (row) => row.amount ?? 0),
    taxAmount: lines.value.some((row) => row.taxAmount === null)
      ? null
      : sumBy(lines.value, (row) => row.taxAmount ?? 0),
    totalAmount: lines.value.some((row) => row.totalAmount === null)
      ? null
      : sumBy(lines.value, (row) => row.totalAmount ?? 0)
  }))
  const references = ref<Record<string, ArOption[]>>({})
  const organizationTree = ref<ArOrganizationOption[]>([])
  async function loadReferences(batch: number): Promise<void> {
    const types = ['unit', 'project', 'customer', 'contract']
    const [values, organizations] = await Promise.all([
      Promise.all(types.map((type) => fetchArOptions(type, form.value.tenantId))),
      fetchArOrganizationTree('organization', form.value.tenantId)
    ])
    if (batch === generation) {
      organizationTree.value = organizations
      references.value = {
        ...Object.fromEntries(types.map((type, index) => [type, values[index]])),
        organization: new TreeUtils().treeToList(organizations)
      }
    }
  }
  function recalculate(row: EditLine): void {
    try {
      const discount =
        row.discountMethod === 'amount' && !form.value.discountIncludesTax
          ? row.discountAmount * (1 + (row.taxRate ?? 0) / 100)
          : row.discountAmount
      const calculated = calculateReceivableLine({
        ...row,
        taxRate: row.taxRate ?? 0,
        discountAmount: discount,
        basis: form.value.inputAmount ? 'amount' : row.basis,
        priceBasis: form.value.inputTaxInclusivePrice ? 'taxed' : 'untaxed'
      })
      Object.assign(row, {
        unitPrice: calculated.unitPrice,
        taxInclusiveUnitPrice: calculated.taxInclusiveUnitPrice,
        amount: calculated.amount,
        taxAmount: calculated.taxAmount,
        totalAmount: calculated.totalAmount
      })
      if (row.estimatedLineId && row.basis === 'quantity') row.matchedQuantity = row.quantity
      if (row.estimatedLineId && row.basis === 'amount')
        row.matchedAmount = Math.min(
          row.matchedAmount || calculated.totalAmount,
          calculated.totalAmount
        )
    } catch (error) {
      notifyFriendlyError(error, '请检查数量、价格与折扣')
    }
  }
  function numberColumn(
    key:
      | 'quantity'
      | 'baseQuantity'
      | 'unitPrice'
      | 'taxInclusiveUnitPrice'
      | 'enteredGrossAmount'
      | 'discountRate'
      | 'discountAmount',
    label: string
  ): ColumnOption<EditLine> {
    return {
      prop: key,
      label,
      width: 145,
      required: editable.value && key === 'quantity',
      rules:
        key === 'quantity'
          ? {
              validator: ({ row }) => row.basis === 'amount' || row.quantity > 0,
              message: '数量型明细数量须大于0'
            }
          : undefined,
      formatter: (row) => {
        const allowed =
          editable.value &&
          (key === 'unitPrice'
            ? !form.value.inputTaxInclusivePrice
            : key === 'taxInclusiveUnitPrice'
              ? form.value.inputTaxInclusivePrice
              : key === 'enteredGrossAmount'
                ? row.basis === 'amount' || form.value.inputAmount
                : key === 'discountRate'
                  ? row.discountMethod === 'rate'
                  : key === 'discountAmount'
                    ? row.discountMethod === 'amount'
                    : true)
        if (!allowed)
          return key === 'quantity' || key === 'baseQuantity'
            ? formatNumberValue(row[key])
            : row.totalAmount === null
              ? '—'
              : key === 'discountRate'
                ? formatPercentValue(Number(row[key]) * 100)
                : money(row[key], form.value.currencyCode)
        return (
          <ElInputNumber
            v-model={row[key]}
            min={0}
            max={key === 'discountRate' ? 1 : undefined}
            precision={
              key === 'quantity' || key === 'baseQuantity' || key === 'unitPrice'
                ? 6
                : key === 'discountRate'
                  ? 4
                  : 2
            }
            step={key === 'discountRate' ? 0.01 : 1}
            controls={false}
            aria-label={`${label} 第${row.lineNo}行`}
            class="w-full!"
            onChange={() => recalculate(row)}
          />
        )
      }
    }
  }
  function referenceColumn(
    key:
      | 'inventoryUnitId'
      | 'baseUnitId'
      | 'projectId'
      | 'customerId'
      | 'contractId'
      | 'expenseDepartmentId',
    label: string,
    type: string
  ): ColumnOption<EditLine> {
    return {
      prop: key,
      label,
      minWidth: 170,
      rules:
        key === 'inventoryUnitId'
          ? {
              validator: ({ row }) => row.basis === 'amount' || Boolean(row.inventoryUnitId),
              message: '数量型明细须选择库存单位'
            }
          : undefined,
      formatter: (row) =>
        editable.value && type === 'organization' ? (
          <ElTreeSelect
            v-model={row[key]}
            data={organizationTree.value}
            props={{ label: 'name', children: 'children' }}
            node-key="id"
            check-strictly
            clearable
            filterable
            class="w-full!"
            aria-label={`${label} 第${row.lineNo}行`}
          />
        ) : editable.value ? (
          <ElSelect
            v-model={row[key]}
            clearable
            filterable
            class="w-full!"
            aria-label={`${label} 第${row.lineNo}行`}
          >
            {(references.value[type] || []).map((item) => (
              <ElOption key={item.id} label={item.name} value={item.id} />
            ))}
          </ElSelect>
        ) : (
          references.value[type]?.find((item) => item.id === row[key])?.name || '—'
        )
    }
  }
  const lineColumns = computed<ColumnOption<EditLine>[]>(() => [
    { prop: 'lineNo', label: '行号', width: 65, fixed: 'left' },
    {
      prop: 'basis',
      label: '立账依据',
      width: 110,
      formatter: (row) =>
        editable.value ? (
          <ElSelect
            v-model={row.basis}
            aria-label={`立账依据 第${row.lineNo}行`}
            disabled={Boolean(row.estimatedLineId)}
            onChange={() => recalculate(row)}
          >
            {basisOptions.map((option) => (
              <ElOption key={option.value} {...option} />
            ))}
          </ElSelect>
        ) : row.basis === 'amount' ? (
          '金额'
        ) : (
          '数量'
        )
    },
    {
      prop: 'materialDescription',
      label: '物料/服务描述',
      minWidth: 220,
      required: editable.value,
      formatter: (row) =>
        editable.value ? (
          <ElInput
            v-model={row.materialDescription}
            maxlength={200}
            aria-label={`物料或服务描述 第${row.lineNo}行`}
          />
        ) : (
          row.materialDescription
        )
    },
    { prop: 'materialCode', label: '物料编码', minWidth: 140 },
    { prop: 'specificationModel', label: '规格型号', minWidth: 140 },
    referenceColumn('projectId', '项目名称', 'project'),
    {
      prop: 'projectCode',
      label: '项目编码',
      minWidth: 140,
      formatter: (row) =>
        references.value.project?.find((item) => item.id === row.projectId)?.code || '—'
    },
    referenceColumn('inventoryUnitId', '库存单位', 'unit'),
    numberColumn('quantity', '数量'),
    referenceColumn('baseUnitId', '基本单位', 'unit'),
    numberColumn('baseQuantity', '基本数量'),
    numberColumn('unitPrice', '单价(元)'),
    numberColumn('taxInclusiveUnitPrice', '含税单价(元)'),
    {
      prop: 'taxRate',
      label: '税率(%)',
      width: 115,
      required: editable.value,
      formatter: (row) =>
        editable.value ? (
          <ElSelect
            v-model={row.taxRate}
            aria-label={`税率 第${row.lineNo}行`}
            placeholder="请选择"
            onChange={() => recalculate(row)}
          >
            {taxOptions.map((option) => (
              <ElOption key={option.value} {...option} />
            ))}
          </ElSelect>
        ) : row.taxRate === null ? (
          '待确认'
        ) : (
          `${row.taxRate}%`
        )
    },
    {
      prop: 'discountMethod',
      label: '折扣方式',
      width: 120,
      formatter: (row) =>
        editable.value ? (
          <ElSelect
            v-model={row.discountMethod}
            onChange={() => recalculate(row)}
            aria-label={`折扣方式 第${row.lineNo}行`}
          >
            {discountOptions.map((option) => (
              <ElOption key={option.value} {...option} />
            ))}
          </ElSelect>
        ) : (
          discountOptions.find((option) => option.value === row.discountMethod)?.label || '—'
        )
    },
    numberColumn('discountRate', '单位折扣(率)'),
    numberColumn('discountAmount', '折扣额(元)'),
    numberColumn('enteredGrossAmount', '录入价税合计(元)'),
    {
      prop: 'amount',
      label: '金额(元)',
      width: 145,
      formatter: (row) => (row.amount === null ? '—' : money(row.amount))
    },
    {
      prop: 'taxAmount',
      label: '税额(元)',
      width: 135,
      formatter: (row) => (row.taxAmount === null ? '—' : money(row.taxAmount))
    },
    {
      prop: 'totalAmount',
      label: '价税合计(元)',
      width: 150,
      formatter: (row) => (row.totalAmount === null ? '—' : money(row.totalAmount))
    },
    {
      prop: 'gift',
      label: '赠品',
      width: 90,
      formatter: (row) =>
        editable.value ? (
          <ElCheckbox
            v-model={row.gift}
            aria-label={`第${row.lineNo}行赠品`}
            onChange={() => recalculate(row)}
          />
        ) : row.gift ? (
          '是'
        ) : (
          '否'
        )
    },
    ...(props.kind === 'financial'
      ? [
          {
            prop: 'advanceInvoice',
            label: '先开票',
            width: 100,
            formatter: (row: EditLine) =>
              editable.value ? (
                <ElCheckbox v-model={row.advanceInvoice} aria-label={`第${row.lineNo}行先开票`} />
              ) : row.advanceInvoice ? (
                '是'
              ) : (
                '否'
              )
          }
        ]
      : []),
    referenceColumn('customerId', '客户', 'customer'),
    referenceColumn('contractId', '销售合同', 'contract'),
    referenceColumn('expenseDepartmentId', '费用承担部门', 'organization'),
    ...(props.kind === 'financial'
      ? [
          {
            prop: 'matchedAmount',
            label: '本次冲回暂估(元)',
            width: 180,
            formatter: (row: EditLine) =>
              row.estimatedLineId && row.basis === 'amount' && editable.value ? (
                <ElInputNumber
                  v-model={row.matchedAmount}
                  aria-label={`本次冲回暂估金额 第${row.lineNo}行`}
                  min={0.01}
                  precision={2}
                  controls={false}
                  class="w-full!"
                />
              ) : row.estimatedLineId ? (
                money(row.matchedAmount || 0)
              ) : (
                '—'
              )
          }
        ]
      : []),
    {
      prop: 'linkedFinancialAmount',
      label: '已关联财务应收(元)',
      width: 180,
      formatter: (row) =>
        row.linkedFinancialAmount === null ? '—' : money(row.linkedFinancialAmount || 0)
    },
    {
      prop: 'unlinkedFinancialAmount',
      label: '未关联财务应收(元)',
      width: 180,
      formatter: (row) =>
        row.totalAmount === null
          ? '—'
          : money((row.totalAmount || 0) - (row.linkedFinancialAmount || 0))
    },
    {
      prop: 'reversedAmount',
      label: '已冲回金额(元)',
      width: 165,
      formatter: (row) => (row.reversedAmount === null ? '—' : money(row.reversedAmount || 0))
    },
    {
      prop: 'unreversedAmount',
      label: '未冲回金额(元)',
      width: 165,
      formatter: (row) =>
        row.totalAmount === null ? '—' : money((row.totalAmount || 0) - (row.reversedAmount || 0))
    },
    {
      prop: 'fullyReversed',
      label: '已冲回',
      width: 100,
      formatter: (row) =>
        (
          row.basis === 'quantity'
            ? (row.reversedQuantity || 0) >= row.quantity
            : (row.reversedAmount || 0) >= (row.totalAmount || 0) && Boolean(row.totalAmount)
        )
          ? '是'
          : '否'
    },
    {
      prop: 'fullyMatched',
      label: '完全勾稽',
      width: 110,
      formatter: (row) =>
        row.estimatedLineId
          ? '是'
          : row.basis === 'quantity'
            ? (row.linkedQuantity || 0) >= row.quantity
              ? '是'
              : '否'
            : (row.linkedFinancialAmount || 0) >= (row.totalAmount || 0) && Boolean(row.totalAmount)
              ? '是'
              : '否'
    },
    { prop: 'sourceLineNo', label: '源行号', minWidth: 140 },
    {
      prop: 'settlementLineMark',
      label: '结算行标识',
      minWidth: 160,
      formatter: (row) =>
        editable.value ? (
          <ElInput v-model={row.settlementLineMark} aria-label={`结算行标识 第${row.lineNo}行`} />
        ) : (
          row.settlementLineMark || '—'
        )
    },
    {
      prop: 'remark',
      label: '备注',
      minWidth: 200,
      formatter: (row) =>
        editable.value ? (
          <ElInput v-model={row.remark} maxlength={1000} aria-label={`备注 第${row.lineNo}行`} />
        ) : (
          row.remark || '—'
        )
    },
    ...(editable.value
      ? [
          {
            prop: 'operation',
            label: '操作',
            width: 80,
            fixed: 'right' as const,
            formatter: (row: EditLine) => (
              <ArtButtonTable
                type="delete"
                permission={writePermission.value}
                label="移除明细"
                onClick={() => void removeLine(row)}
              />
            )
          }
        ]
      : [])
  ])
  async function materialOptions(params: DataSelectFetchParams) {
    return fetchArOptions('material', form.value.tenantId, params.keyword)
  }
  async function removeLine(row: EditLine): Promise<void> {
    const remove = async () => {
      lines.value = lines.value.filter((item) => item.id !== row.id)
      lines.value.forEach((item, index) => {
        item.lineNo = (index + 1) * 10
      })
      if (row.persisted) removedPersistedLine.value = true
    }
    if (!row.persisted || !currentId) {
      await remove()
      return
    }
    await deleteRecord({
      resource: { id: currentId, label: `${document.value?.documentNo} · 第 ${row.lineNo} 行` },
      permission: props.editPermission,
      confirmMessage: '移除此应收明细？保存应收单后生效。',
      inspectReferences: inspectLineReferences,
      remove
    })
  }
  function inspectLineReferences(resources: MasterDataDeleteResource[]): Promise<boolean> {
    return (
      deleteGuardRef.value?.inspect({
        resourceLabel: '应收明细',
        resources,
        fetchDependencies: (ids) => fetchArDeleteDependencies(props.kind, ids),
        dependencyMeta: createArDeleteMetadata(props.kind, hasAuth)
      }) ?? Promise.resolve(true)
    )
  }
  function newLine(): EditLine {
    return {
      id: crypto.randomUUID(),
      persisted: false,
      lineNo: (lines.value.length + 1) * 10,
      basis: 'amount',
      materialCode: '',
      specificationModel: '',
      materialDescription: '',
      quantity: 0,
      baseQuantity: 0,
      priceBasis: 'taxed',
      unitPrice: 0,
      taxInclusiveUnitPrice: 0,
      taxRate: null,
      discountMethod: 'none',
      discountRate: 0,
      discountAmount: 0,
      enteredGrossAmount: 0,
      gift: false,
      advanceInvoice: false,
      amount: 0,
      taxAmount: 0,
      totalAmount: 0,
      customerId: form.value.customerId,
      remark: ''
    }
  }
  function addService(): void {
    lines.value.push(newLine())
  }
  function addMaterials(materials: ArOption[]): void {
    for (const material of materials)
      lines.value.push({
        ...newLine(),
        basis: 'quantity',
        materialId: material.id,
        materialCode: material.code,
        materialDescription: material.description || material.name,
        specificationModel: material.specificationModel || '',
        inventoryUnitId: material.inventoryUnitId,
        baseUnitId: material.baseUnitId,
        quantity: 1,
        baseQuantity: 1
      })
  }
  async function loadCurrent(): Promise<void> {
    removedPersistedLine.value = false
    const version = ++generation
    loading.value = true
    loadError.value = undefined
    try {
      if (currentId) {
        const response = await fetchArWorkspace(props.kind, { id: currentId, size: 1 })
        const row = response.data[0]
        if (!row) throw new Error('单据不存在或无权查看')
        if (version !== generation) return
        document.value = row
        form.value = {
          ...emptyForm(),
          ...cloneDeep(row),
          requestId: crypto.randomUUID(),
          id: copying ? undefined : row.id,
          businessDate: copying ? dayjs().format('YYYY-MM-DD') : row.businessDate,
          kind: props.kind,
          documentTypeId: row.documentTypeId || '',
          lines: [],
          estimateId: copying ? null : row.estimateId
        }
        lines.value = (row.lines || []).map((line) => ({
          ...cloneDeep(line),
          id: crypto.randomUUID(),
          persisted: !copying,
          materialCode: line.materialCode || '',
          specificationModel: line.specificationModel || '',
          priceBasis: form.value.inputTaxInclusivePrice ? 'taxed' : 'untaxed',
          enteredGrossAmount: line.totalAmount,
          estimatedLineId: copying ? null : line.estimatedLineId,
          sourceLineId: copying ? null : line.sourceLineId,
          sourceLineNo: copying ? null : line.sourceLineNo,
          matchedAmount: copying ? 0 : line.matchedAmount,
          matchedQuantity: copying ? 0 : line.matchedQuantity
        }))
      } else {
        form.value = emptyForm()
        document.value = {
          id: '',
          documentNo: '',
          status: 'draft',
          ...form.value,
          lines: [],
          kind: props.kind,
          tenantId: form.value.tenantId || '',
          documentTypeId: null,
          estimateId: null,
          financialId: null,
          sourceType: null,
          sourceId: null,
          sourceNo: null,
          isInitialization: false,
          payerCustomerId: null,
          settlementOrganizationId: null,
          projectId: null,
          requestDepartmentId: null,
          accountingDate: form.value.businessDate,
          paymentTermId: null,
          amount: 0,
          taxAmount: 0,
          totalAmount: 0,
          remark: null,
          voucherId: null,
          submittedAt: null,
          approvedAt: null,
          createdAt: '',
          updatedAt: ''
        }
        lines.value = []
      }
      await loadReferences(version)
    } catch (error) {
      if (version === generation)
        loadError.value =
          error instanceof Error ? error : new Error('资料加载失败，请重试', { cause: error })
    } finally {
      if (version === generation) loading.value = false
    }
  }
  async function save(isCurrent: () => boolean): Promise<boolean> {
    if (!isCurrent()) {
      ElMessage.warning('操作范围或权限已变化，请重新打开应收单')
      return false
    }
    if (loading.value || loadError.value || !editable.value) return false
    if (!(await validateArtFormForSubmit(formRef.value))) return false
    if (!isCurrent()) return false
    if (!lines.value.length) {
      ElMessage.warning('请至少添加一行应收明细')
      return false
    }
    const validation = await lineTable.value?.validate()
    if (!isCurrent()) return false
    if (validation && !validation.valid) {
      ElMessage.warning(validation.firstError?.message || '请补全明细')
      return false
    }
    try {
      await saveReceivableDocument({
        ...form.value,
        lines: lines.value.map((line) => ({
          ...line,
          basis: line.basis,
          priceBasis: form.value.inputTaxInclusivePrice ? 'taxed' : 'untaxed'
        }))
      })
      if (!isCurrent()) return false
      ElMessage.success('应收单已保存')
      emit('success')
      return true
    } catch (error) {
      if (!isCurrent()) return false
      if (
        removedPersistedLine.value &&
        currentId &&
        getDeleteReferenceContext(error) &&
        (await inspectLineReferences([
          { id: currentId, label: document.value?.documentNo || '应收单据' }
        ]))
      )
        return false
      if (isCurrent()) notifyFriendlyError(error, '应收单未保存，请检查后重试')
      return false
    }
  }
  async function open(id?: string, edit = false, copy = false): Promise<void> {
    const addPermission =
      props.kind === 'estimate'
        ? 'FinanceEstimatedReceivable:Add'
        : 'FinanceFinancialReceivable:Add'
    const copyPermission =
      props.kind === 'estimate'
        ? 'FinanceEstimatedReceivable:Copy'
        : 'FinanceFinancialReceivable:Copy'
    const permission = id && !copy ? props.editPermission : addPermission
    const scopeCurrent = captureOperation()
    if (!scopeCurrent() || (edit && (!hasAuth(permission) || (copy && !hasAuth(copyPermission)))))
      return
    const version = session.invalidate()
    const isCurrent = () =>
      scopeCurrent() &&
      session.isCurrent(version) &&
      (!edit || (hasAuth(permission) && (!copy || hasAuth(copyPermission))))
    const confirmSave = () => save(isCurrent)
    currentId = id
    copying = copy
    editable.value = edit
    document.value = undefined
    await drawerRef.value?.handleOpen(undefined, {
      title: `${copy ? '复制' : edit ? (id ? '编辑' : '新增') : ''}${title.value}`,
      confirmText: '保存应收单',
      showConfirmButton: edit,
      onConfirm: confirmSave,
      onClose: () => {
        session.invalidate()
        generation++
      }
    })
    await loadCurrent()
    if (isCurrent()) drawerRef.value?.setOptions({ onConfirm: confirmSave })
  }
  watch(
    () => form.value.customerId,
    (value, old) => {
      if (value && (!form.value.payerCustomerId || form.value.payerCustomerId === old))
        form.value.payerCustomerId = value
    }
  )
  watch(
    () => [
      form.value.inputTaxInclusivePrice,
      form.value.inputAmount,
      form.value.discountIncludesTax
    ],
    () => {
      if (editable.value && !loading.value) lines.value.forEach(recalculate)
    }
  )
  defineExpose({ open })
</script>
