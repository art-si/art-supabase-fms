<template>
  <ArtSectionCard class="voucher-entry-lines" aria-label="凭证分录" preserve-content-structure>
    <template #header>
      <div class="voucher-entry-lines__header">
        <div>
          <ArtSectionTitle :show-line="false">凭证分录</ArtSectionTitle>
          <p>
            {{
              isTemplateMode
                ? '设置科目、借贷方向和默认金额；套用后可调整，生成的凭证提交前须借贷平衡。'
                : '借贷金额必须平衡；科目启用外币、数量或辅助核算时，请同步填写对应信息。'
            }}
          </p>
        </div>
        <ElButton v-if="!readonly" type="primary" plain @click="addLine">
          <ArtSvgIcon icon="ri:add-line" />新增分录
        </ElButton>
      </div>
    </template>

    <ArtTable
      :border="false"
      ref="tableRef"
      :data="modelValue"
      :columns="columns"
      :pagination="false"
      height="auto"
      table-layout="fixed"
      empty-text="暂无凭证分录"
      empty-description="至少录入两条借贷平衡的会计分录。"
      empty-height="180px"
    />

    <div class="voucher-entry-lines__totals" :class="{ 'is-balanced': isBalanced }">
      <span>分录 {{ modelValue.length }} 条</span>
      <strong>借方 {{ formatCnyCurrencyValue(totalDebit || 0) }}</strong>
      <strong>贷方 {{ formatCnyCurrencyValue(totalCredit || 0) }}</strong>
      <span>差额 {{ formatCnyCurrencyValue(difference || 0) }}</span>
      <ElTag :type="isBalanced ? 'success' : 'danger'" effect="dark">
        {{ isBalanced ? '借贷平衡' : '借贷不平' }}
      </ElTag>
    </div>
  </ArtSectionCard>
</template>

<script setup lang="tsx">
  import ArtSectionCard from '@/components/core/surfaces/art-section-card/index.vue'
  import { keyBy, round, sumBy } from 'lodash-es'
  import { useMediaQuery } from '@vueuse/core'
  import { ElInput, ElInputNumber, ElOption, ElSelect, ElTag } from 'element-plus'
  import ArtButtonTable from '@/components/core/forms/art-button-table/index.vue'
  import ArtSectionTitle from '@/components/core/surfaces/art-section-title/index.vue'
  import ArtSvgIcon from '@/components/core/base/art-svg-icon/index.vue'
  import BusinessTableIdentityCell from '@/components/business/business-table-identity-cell/index.vue'
  import ArtTable, {
    type ArtTableExpose,
    type ArtTableValidationResult
  } from '@/components/core/tables/art-table/index.vue'
  import type { ColumnOption, TableColumnValidationContext } from '@/types'
  import { formatCnyCurrencyValue, formatNumberValue } from '@/utils/ui'

  defineOptions({ name: 'FmsVoucherEntryLines' })

  type Line = Api.Fms.VoucherLineRecord
  type Subject = Api.Fms.SubjectRecord

  interface Props {
    modelValue: Line[]
    subjects: Subject[]
    currencies: Api.Fms.CurrencyRecord[]
    auxiliaryItems: Api.Fms.AuxiliaryItemRecord[]
    readonly?: boolean
    allowZeroAmount?: boolean
    mode?: 'voucher' | 'template'
    directionOptions?: Array<{ label: string; value: Api.Fms.BalanceDirection }>
  }

  const props = withDefaults(defineProps<Props>(), {
    readonly: false,
    allowZeroAmount: false,
    mode: 'voucher',
    directionOptions: () => []
  })
  const emit = defineEmits<{ 'update:modelValue': [value: Line[]] }>()
  const tableRef = ref<ArtTableExpose>()
  const isCompact = useMediaQuery('(max-width: 900px)')
  const subjectsById = computed(() => keyBy(props.subjects, 'id'))
  const parentSubjectIds = computed(
    () => new Set(props.subjects.map((subject) => subject.parentId))
  )

  const subjectOptions = computed(() =>
    props.subjects
      .filter((subject) => subject.isEnabled && !parentSubjectIds.value.has(subject.id))
      .map((subject) => ({
        label: `${subject.subjectCode} ${subject.subjectName}`,
        value: subject.id
      }))
  )
  const foreignCurrencies = computed(() =>
    props.currencies.filter((item) => !item.isBase && item.isEnabled)
  )
  const totalDebit = computed(() =>
    round(
      sumBy(props.modelValue, (row) => Number(row.debitAmount || 0)),
      2
    )
  )
  const totalCredit = computed(() =>
    round(
      sumBy(props.modelValue, (row) => Number(row.creditAmount || 0)),
      2
    )
  )
  const difference = computed(() => round(totalDebit.value - totalCredit.value, 2))
  const isTemplateMode = computed(() => props.mode === 'template')
  const isBalanced = computed(
    () => totalDebit.value === totalCredit.value && (props.allowZeroAmount || totalDebit.value > 0)
  )

  function createLine(): Line {
    return {
      lineNo: props.modelValue.length + 1,
      summary: '',
      subjectId: '',
      auxiliaryValues: {},
      currencyId: null,
      exchangeRate: 1,
      originalAmount: 0,
      quantity: 0,
      debitAmount: 0,
      creditAmount: 0,
      entryDirection: isTemplateMode.value ? 'debit' : undefined
    }
  }

  function subjectFor(row: Line): Subject | undefined {
    return subjectsById.value[row.subjectId]
  }

  function updateLine(row: Line, patch: Partial<Line>): void {
    emit(
      'update:modelValue',
      props.modelValue.map((item) => (item === row ? { ...item, ...patch } : item))
    )
  }

  function handleSubjectChange(row: Line, subjectId: string): void {
    updateLine(row, {
      subjectId,
      auxiliaryValues: {},
      currencyId: null,
      exchangeRate: 1,
      originalAmount: 0,
      quantity: 0
    })
  }

  function handleOriginalAmountChange(row: Line, value: number): void {
    const amount = round(Number(value || 0) * Number(row.exchangeRate || 1), 2)
    const patch: Partial<Line> = { originalAmount: Number(value || 0) }
    if (
      row.entryDirection === 'debit' ||
      (row.entryDirection == null &&
        (row.debitAmount > 0 || (row.creditAmount === 0 && row.debitAmount === 0)))
    ) {
      patch.debitAmount = amount
      patch.creditAmount = 0
    } else {
      patch.creditAmount = amount
      patch.debitAmount = 0
    }
    updateLine(row, patch)
  }

  function handleRateChange(row: Line, value: number): void {
    const rate = Number(value || 1)
    const amount = round(Number(row.originalAmount || 0) * rate, 2)
    updateLine(row, {
      exchangeRate: rate,
      debitAmount: row.debitAmount > 0 ? amount : 0,
      creditAmount: row.creditAmount > 0 ? amount : 0
    })
  }

  function handleDirectionChange(row: Line, direction: Api.Fms.BalanceDirection): void {
    const amount = Math.max(Number(row.debitAmount || 0), Number(row.creditAmount || 0))
    updateLine(row, {
      entryDirection: direction,
      debitAmount: direction === 'debit' ? amount : 0,
      creditAmount: direction === 'credit' ? amount : 0
    })
  }

  function handleTemplateAmountChange(row: Line, value: number): void {
    const amount = Number(value ?? 0)
    const direction = row.entryDirection ?? 'debit'
    updateLine(row, {
      entryDirection: direction,
      debitAmount: direction === 'debit' ? amount : 0,
      creditAmount: direction === 'credit' ? amount : 0
    })
  }

  function addLine(): void {
    emit('update:modelValue', [...props.modelValue, createLine()])
  }

  function removeLine(row: Line): void {
    emit(
      'update:modelValue',
      props.modelValue
        .filter((item) => item !== row)
        .map((item, index) => ({ ...item, lineNo: index + 1 }))
    )
  }

  const hasForeignCurrency = computed(() =>
    props.modelValue.some((line) =>
      Boolean(line.currencyId || subjectFor(line)?.allowForeignCurrency)
    )
  )
  const hasQuantity = computed(() =>
    props.modelValue.some((line) =>
      Boolean(Number(line.quantity) || subjectFor(line)?.allowQuantity)
    )
  )
  const hasAuxiliary = computed(() =>
    props.modelValue.some((line) => Boolean(subjectFor(line)?.auxiliaryConfigs?.length))
  )

  const allColumns = computed<ColumnOption<Line>[]>(() => [
    { prop: 'lineNo', label: '行号', width: 64, fixed: 'left', align: 'center' },
    {
      prop: 'summary',
      label: '摘要',
      required: !props.readonly,
      requiredMessage: ({ rowIndex }) => `第 ${rowIndex + 1} 条分录缺少摘要`,
      minWidth: 170,
      formatter: (row) =>
        props.readonly ? (
          row.summary || '—'
        ) : (
          <ElInput
            v-model={row.summary}
            aria-label={`第 ${row.lineNo} 条分录摘要`}
            maxlength={120}
            placeholder="分录摘要"
            onChange={() => updateLine(row, { summary: row.summary })}
          />
        )
    },
    {
      prop: 'subjectId',
      label: '会计科目',
      required: !props.readonly,
      requiredMessage: ({ rowIndex }) => `第 ${rowIndex + 1} 条分录未选择会计科目`,
      minWidth: 220,
      formatter: (row) => {
        const subject = subjectFor(row)
        if (props.readonly)
          return subject ? (
            <BusinessTableIdentityCell
              primary={subject.subjectName}
              secondary={subject.subjectCode}
            />
          ) : (
            row.subjectNameSnapshot || '—'
          )
        return (
          <ElSelect
            v-model={row.subjectId}
            aria-label={`第 ${row.lineNo} 条分录会计科目`}
            filterable
            placeholder="选择末级科目"
            class="w-full!"
            onChange={() => handleSubjectChange(row, row.subjectId)}
          >
            {subjectOptions.value.map((item) => (
              <ElOption key={item.value} label={item.label} value={item.value} />
            ))}
          </ElSelect>
        )
      }
    },
    ...(isTemplateMode.value
      ? [
          {
            prop: 'entryDirection',
            label: '借贷方向',
            width: 128,
            formatter: (row: Line) =>
              props.readonly ? (
                (props.directionOptions.find((item) => item.value === row.entryDirection)?.label ??
                '—')
              ) : (
                <ElSelect
                  v-model={row.entryDirection}
                  aria-label={`第 ${row.lineNo} 条分录借贷方向`}
                  class="w-full!"
                  onChange={() => handleDirectionChange(row, row.entryDirection ?? 'debit')}
                >
                  {props.directionOptions.map((item) => (
                    <ElOption key={item.value} label={item.label} value={item.value} />
                  ))}
                </ElSelect>
              )
          }
        ]
      : []),
    {
      prop: 'auxiliaryValues',
      label: '辅助核算',
      required: !props.readonly,
      rules: [
        {
          validator: ({ row }) =>
            (subjectFor(row)?.auxiliaryConfigs ?? []).every(
              (config) => !config.isRequired || Boolean(row.auxiliaryValues[config.auxiliaryTypeId])
            ),
          message: ({ rowIndex }) => `第 ${rowIndex + 1} 条分录缺少必填核算维度`
        }
      ],
      minWidth: 210,
      formatter: (row) => {
        const configs = subjectFor(row)?.auxiliaryConfigs ?? []
        if (!configs.length) return '—'
        if (props.readonly) {
          return (
            configs
              .map((config) => {
                const item = props.auxiliaryItems.find(
                  (candidate) => candidate.id === row.auxiliaryValues[config.auxiliaryTypeId]
                )
                return item ? `${config.auxiliaryType?.typeName}：${item.itemName}` : ''
              })
              .filter(Boolean)
              .join('；') || '—'
          )
        }
        return (
          <div class="grid gap-1.5">
            {configs.map((config) => (
              <ElSelect
                key={config.auxiliaryTypeId}
                v-model={row.auxiliaryValues[config.auxiliaryTypeId]}
                aria-label={`第 ${row.lineNo} 条分录${config.auxiliaryType?.typeName ?? '核算维度'}`}
                filterable
                class="w-full!"
                clearable={!config.isRequired}
                placeholder={`${config.auxiliaryType?.typeName ?? '核算维度'}${config.isRequired ? '*' : ''}`}
                onChange={() =>
                  updateLine(row, {
                    auxiliaryValues: { ...row.auxiliaryValues }
                  })
                }
              >
                {props.auxiliaryItems
                  .filter(
                    (item) => item.auxiliaryTypeId === config.auxiliaryTypeId && item.isEnabled
                  )
                  .map((item) => (
                    <ElOption
                      key={item.id}
                      label={`${item.itemCode} ${item.itemName}`}
                      value={item.id}
                    />
                  ))}
              </ElSelect>
            ))}
          </div>
        )
      }
    },
    {
      prop: 'currencyId',
      label: '外币 / 原币',
      rules: [
        {
          validator: ({ row }) => !row.currencyId || Number(row.originalAmount) > 0,
          message: ({ rowIndex }) => `第 ${rowIndex + 1} 条分录原币金额必须大于 0`
        }
      ],
      minWidth: 234,
      formatter: (row) => {
        const subject = subjectFor(row)
        if (!subject?.allowForeignCurrency) return '—'
        if (props.readonly) {
          return row.currencyCodeSnapshot
            ? `${row.currencyCodeSnapshot} ${formatNumberValue(Number(row.originalAmount))}`
            : '—'
        }
        return (
          <div class="grid grid-cols-[96px_minmax(100px,1fr)] gap-1.5">
            <ElSelect
              v-model={row.currencyId}
              aria-label={`第 ${row.lineNo} 条分录币种`}
              clearable
              class="w-full!"
              placeholder="币种"
              onChange={() =>
                updateLine(row, {
                  currencyId: row.currencyId || null,
                  originalAmount: row.currencyId ? row.originalAmount : 0,
                  exchangeRate: row.currencyId ? row.exchangeRate : 1
                })
              }
            >
              {foreignCurrencies.value.map((item) => (
                <ElOption key={item.id} label={item.currencyCode} value={item.id} />
              ))}
            </ElSelect>
            <ElInputNumber
              v-model={row.originalAmount}
              aria-label={`第 ${row.lineNo} 条分录原币金额`}
              min={0}
              precision={2}
              controls={false}
              disabled={!row.currencyId}
              class="w-full!"
              placeholder="原币金额"
              onChange={() => handleOriginalAmountChange(row, Number(row.originalAmount ?? 0))}
            />
          </div>
        )
      }
    },
    {
      prop: 'exchangeRate',
      label: '汇率',
      rules: [
        {
          validator: ({ row, value }) => !row.currencyId || Number(value) > 0,
          message: ({ rowIndex }) => `第 ${rowIndex + 1} 条分录汇率必须大于 0`
        }
      ],
      width: 120,
      formatter: (row) =>
        props.readonly ? (
          row.currencyId ? (
            Number(row.exchangeRate).toFixed(6)
          ) : (
            '—'
          )
        ) : (
          <ElInputNumber
            v-model={row.exchangeRate}
            aria-label={`第 ${row.lineNo} 条分录汇率`}
            min={0.0000000001}
            precision={6}
            controls={false}
            disabled={!row.currencyId}
            class="w-full!"
            onChange={() => handleRateChange(row, Number(row.exchangeRate ?? 1))}
          />
        )
    },
    {
      prop: 'quantity',
      label: '数量',
      width: 120,
      formatter: (row) => {
        const subject = subjectFor(row)
        if (!subject?.allowQuantity) return '—'
        return props.readonly ? (
          `${formatNumberValue(Number(row.quantity))} ${subject.unitName ?? ''}`
        ) : (
          <ElInputNumber
            v-model={row.quantity}
            aria-label={`第 ${row.lineNo} 条分录数量`}
            min={0}
            precision={4}
            controls={false}
            class="w-full!"
            onChange={() => updateLine(row, { quantity: Number(row.quantity ?? 0) })}
          />
        )
      }
    },
    ...(isTemplateMode.value
      ? [
          {
            prop: 'defaultAmount',
            label: '默认金额',
            width: 150,
            align: 'right' as const,
            formatter: (row: Line) => {
              if (props.readonly) {
                return formatCnyCurrencyValue(
                  Math.max(Number(row.debitAmount || 0), Number(row.creditAmount || 0))
                )
              }
              const amountField = row.entryDirection === 'credit' ? 'creditAmount' : 'debitAmount'
              return (
                <ElInputNumber
                  v-model={row[amountField]}
                  aria-label={`第 ${row.lineNo} 条分录默认金额`}
                  min={0}
                  precision={2}
                  controls={false}
                  class="w-full!"
                  onChange={() => handleTemplateAmountChange(row, Number(row[amountField] ?? 0))}
                />
              )
            }
          }
        ]
      : [
          {
            prop: 'debitAmount',
            label: '借方金额',
            required: !props.readonly,
            rules: [
              {
                validator: ({ row }: TableColumnValidationContext<Line>) =>
                  Number(row.debitAmount > 0) + Number(row.creditAmount > 0) === 1,
                message: ({ rowIndex }: TableColumnValidationContext<Line>) =>
                  `第 ${rowIndex + 1} 条分录只能填写一侧借贷金额`
              }
            ],
            width: 145,
            align: 'right' as const,
            formatter: (row: Line) =>
              props.readonly ? (
                formatCnyCurrencyValue(row.debitAmount || 0)
              ) : (
                <ElInputNumber
                  v-model={row.debitAmount}
                  aria-label={`第 ${row.lineNo} 条分录借方金额`}
                  min={0}
                  precision={2}
                  controls={false}
                  class="w-full!"
                  onChange={() =>
                    updateLine(row, {
                      debitAmount: Number(row.debitAmount ?? 0),
                      creditAmount: Number(row.debitAmount ?? 0) > 0 ? 0 : row.creditAmount
                    })
                  }
                />
              )
          },
          {
            prop: 'creditAmount',
            label: '贷方金额',
            width: 145,
            align: 'right' as const,
            formatter: (row: Line) =>
              props.readonly ? (
                formatCnyCurrencyValue(row.creditAmount || 0)
              ) : (
                <ElInputNumber
                  v-model={row.creditAmount}
                  aria-label={`第 ${row.lineNo} 条分录贷方金额`}
                  min={0}
                  precision={2}
                  controls={false}
                  class="w-full!"
                  onChange={() =>
                    updateLine(row, {
                      creditAmount: Number(row.creditAmount ?? 0),
                      debitAmount: Number(row.creditAmount ?? 0) > 0 ? 0 : row.debitAmount
                    })
                  }
                />
              )
          }
        ]),
    ...(props.readonly
      ? []
      : [
          {
            prop: 'operation',
            label: '操作',
            width: 72,
            fixed: isCompact.value ? undefined : ('right' as const),
            formatter: (row: Line) => (
              <ArtButtonTable
                type="delete"
                label="删除分录"
                permission=""
                onClick={() => removeLine(row)}
              />
            )
          }
        ])
  ])
  const columns = computed(() =>
    allColumns.value.filter((column) => {
      if (column.prop === 'currencyId' || column.prop === 'exchangeRate')
        return hasForeignCurrency.value
      if (column.prop === 'quantity') return hasQuantity.value
      if (column.prop === 'auxiliaryValues') return hasAuxiliary.value
      return true
    })
  )

  const validate = async (): Promise<ArtTableValidationResult> =>
    (await tableRef.value?.validate()) ?? { valid: true, errors: [] }
  const clearValidate = (): void => tableRef.value?.clearValidate()

  defineExpose({ addLine, isBalanced, totalDebit, totalCredit, validate, clearValidate })
</script>

<style scoped lang="scss">
  .voucher-entry-lines {
    min-width: 0;
    padding: var(--art-space-4);

    :deep(.el-table__body .el-input),
    :deep(.el-table__body .el-select),
    :deep(.el-table__body .el-input-number) {
      width: 100%;
    }

    &__header,
    &__totals {
      display: flex;
      gap: var(--art-space-3);
      align-items: center;
      justify-content: space-between;
    }

    &__header {
      margin-bottom: var(--art-space-3);

      p {
        margin: 4px 0 0;
        font-size: 13px;
        color: var(--el-text-color-secondary);
      }
    }

    &__totals {
      justify-content: flex-end;
      padding-top: var(--art-space-3);
      color: var(--el-color-danger);

      &.is-balanced {
        color: var(--el-color-success);
      }
    }

    @media (width <= 680px) {
      &__header,
      &__totals {
        flex-wrap: wrap;
      }

      &__header {
        align-items: flex-start;
      }
    }
  }
</style>
