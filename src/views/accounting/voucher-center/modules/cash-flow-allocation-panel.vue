<template>
  <ArtSectionCard
    v-if="cashLines.length"
    class="cash-flow-allocation-panel"
    preserve-content-structure
  >
    <template #header
      ><div class="cash-flow-allocation-panel__header">
        <div>
          <ArtSectionTitle :show-line="false">现金流量归集</ArtSectionTitle>
          <p>现金及现金等价物分录需按流入/流出项目全额归集，提交时由数据库再次校验。</p>
        </div>
        <ElTag type="warning" effect="plain">{{ cashLines.length }} 条现金分录</ElTag>
      </div></template
    >

    <ElAlert
      v-if="!statementItems.length"
      type="warning"
      :closable="false"
      show-icon
      title="当前账套尚未初始化现金流量表项目，请先到“财务报表 → 取数口径”完成初始化。"
    />

    <div class="cash-flow-allocation-panel__lines">
      <article
        v-for="line in cashLines"
        :key="line.lineNo"
        class="cash-flow-allocation-panel__line grid-cols-1"
      >
        <header>
          <div class="cash-flow-allocation-panel__identity">
            <span>分录 {{ line.lineNo }}</span>
            <strong>{{ subjectLabel(line) }}</strong>
            <small>{{ line.summary || '未填写摘要' }}</small>
          </div>
          <div class="cash-flow-allocation-panel__amount">
            <ElTag :type="lineDirection(line) === 'receipt' ? 'success' : 'warning'" effect="plain">
              {{
                statementOptionLabel(
                  'fmsCashFlowDirection',
                  lineDirection(line),
                  getDictMap.fmsCashFlowDirection
                )
              }}
            </ElTag>
            <strong>{{ formatCurrencyValue(lineAmount(line)) }}</strong>
            <small>待归集 {{ formatCurrencyValue(remainingAmount(line)) }}</small>
          </div>
        </header>

        <ArtTable
          :border="false"
          ref="allocationTableRefs"
          :data="allocationsFor(line.lineNo)"
          :columns="allocationColumns(line)"
          :pagination="false"
          height="auto"
          table-layout="fixed"
          empty-text="尚未添加归集项目"
          :empty-description="
            readonly ? '该分录尚无现金流归集记录。' : '点击下方按钮添加现金流归集项目。'
          "
        />

        <footer>
          <ElButton
            v-if="!readonly"
            type="primary"
            plain
            :disabled="!statementItems.length || remainingAmount(line) <= 0"
            @click="addAllocation(line)"
          >
            <ArtSvgIcon icon="ri:add-line" />
            {{ allocationsFor(line.lineNo).length ? '拆分归集' : '添加归集' }}
          </ElButton>
        </footer>
      </article>
    </div>
  </ArtSectionCard>
</template>

<script setup lang="tsx">
  import TreeUtils from '@/utils/tree'
  import ArtSectionCard from '@/components/core/surfaces/art-section-card/index.vue'
  import { ElButton, ElInput, ElInputNumber, ElMessage, ElTreeSelect } from 'element-plus'
  import { storeToRefs } from 'pinia'
  import ArtSectionTitle from '@/components/core/surfaces/art-section-title/index.vue'
  import ArtSvgIcon from '@/components/core/base/art-svg-icon/index.vue'
  import ArtTable, { type ArtTableExpose } from '@/components/core/tables/art-table/index.vue'
  import ArtButtonTable from '@/components/core/forms/art-button-table/index.vue'
  import type { ColumnOption } from '@/types'
  import { useUserStore } from '@/store/modules/user'
  import { formatCurrencyValue } from '@/utils/ui'
  import { statementOptionLabel } from '../../../modules/financial-statement-options'

  defineOptions({ name: 'FinanceCashFlowAllocationPanel' })

  type VoucherLine = Api.Fms.VoucherLineRecord
  type Draft = Api.Fms.VoucherCashFlowAllocationDraft

  const props = withDefaults(
    defineProps<{
      lines: VoucherLine[]
      subjects: Api.Fms.SubjectRecord[]
      statementItems: Api.Fms.FinancialStatementItemRecord[]
      readonly?: boolean
    }>(),
    { readonly: false }
  )
  const optionTree = new TreeUtils({ idKey: 'value', parentKey: 'parentId' })
  const model = defineModel<Draft[]>({ default: () => [] })
  const userStore = useUserStore()
  const { getDictMap } = storeToRefs(userStore)
  onMounted(() => void userStore.ensureDictLoaded('fmsCashFlowDirection'))
  const allocationTableRefs = ref<ArtTableExpose[]>([])

  const cashLines = computed(() => props.lines.filter((line) => subjectFor(line)?.cashFlowRequired))

  watch(
    () => props.lines.map((line) => `${line.lineNo}:${line.subjectId}`).join('|'),
    () => {
      const validLineNos = new Set(cashLines.value.map((line) => line.lineNo))
      model.value = model.value.filter((item) => validLineNos.has(item.voucherLineNo))
    }
  )

  function subjectFor(line: VoucherLine): Api.Fms.SubjectRecord | undefined {
    return props.subjects.find((item) => item.id === line.subjectId)
  }

  function subjectLabel(line: VoucherLine): string {
    const subject = subjectFor(line)
    return subject ? `${subject.subjectCode} ${subject.subjectName}` : '未选择现金科目'
  }

  function lineDirection(line: VoucherLine): Api.Fms.CashFlowDirection {
    return Number(line.debitAmount || 0) > 0 ? 'receipt' : 'payment'
  }

  function lineAmount(line: VoucherLine): number {
    return Math.max(Number(line.debitAmount || 0), Number(line.creditAmount || 0))
  }

  function allocationsFor(lineNo: number): Draft[] {
    return model.value.filter((item) => item.voucherLineNo === lineNo)
  }

  function allocatedAmount(lineNo: number): number {
    return allocationsFor(lineNo).reduce((sum, item) => sum + Number(item.amount || 0), 0)
  }

  function remainingAmount(line: VoucherLine): number {
    return Math.max(lineAmount(line) - allocatedAmount(line.lineNo), 0)
  }

  function itemOptions(line: VoucherLine) {
    const direction = lineDirection(line)
    return optionTree.listToTree(
      props.statementItems.map((item) => ({
        label: `${item.itemCode} ${item.itemName}`,
        value: item.id,
        parentId: item.parentId,
        disabled:
          !item.isEnabled ||
          item.calculationMethod !== 'mapping' ||
          item.cashFlowDirection !== direction
      }))
    )
  }

  function addAllocation(line: VoucherLine): void {
    const remaining = remainingAmount(line)
    if (remaining <= 0) return
    model.value.push({
      voucherLineNo: line.lineNo,
      statementItemId: '',
      amount: remaining,
      remark: null
    })
  }

  function removeAllocation(row: Draft): void {
    const index = model.value.indexOf(row)
    if (index >= 0) model.value.splice(index, 1)
  }

  function allocationColumns(line: VoucherLine): ColumnOption<Draft>[] {
    return [
      {
        prop: 'statementItemId',
        label: '现金流量项目',
        minWidth: 280,
        required: !props.readonly,
        requiredMessage: ({ rowIndex }) =>
          `分录 ${line.lineNo} 的第 ${rowIndex + 1} 行未选择现金流量项目`,
        formatter: (row) => (
          <ElTreeSelect
            v-model={row.statementItemId}
            filterable
            class="w-full!"
            placeholder="请选择现金流量项目"
            disabled={props.readonly}
            data={itemOptions(line)}
            checkStrictly
          />
        )
      },
      {
        prop: 'amount',
        label: '归集金额',
        width: 180,
        required: !props.readonly,
        requiredMessage: ({ rowIndex }) =>
          `分录 ${line.lineNo} 的第 ${rowIndex + 1} 行归集金额必须大于 0`,
        rules: [
          {
            validator: ({ value }) => Number(value) > 0,
            message: ({ rowIndex }) =>
              `分录 ${line.lineNo} 的第 ${rowIndex + 1} 行归集金额必须大于 0`
          }
        ],
        formatter: (row) => (
          <ElInputNumber
            v-model={row.amount}
            min={0.01}
            max={lineAmount(line)}
            precision={2}
            step={100}
            controlsPosition="right"
            class="w-full!"
            disabled={props.readonly}
          />
        )
      },
      {
        prop: 'remark',
        label: '备注',
        minWidth: 180,
        formatter: (row) => (
          <ElInput
            v-model={row.remark}
            maxlength={200}
            placeholder="可选"
            disabled={props.readonly}
          />
        )
      },
      ...(props.readonly
        ? []
        : [
            {
              prop: 'operation',
              label: '操作',
              width: 78,
              fixed: 'right' as const,
              align: 'center' as const,
              formatter: (row: Draft) => (
                <ArtButtonTable
                  type="delete"
                  label="删除归集项目"
                  permission=""
                  onClick={() => removeAllocation(row)}
                />
              )
            }
          ])
    ]
  }

  async function validate(requireComplete = true): Promise<boolean> {
    if (!cashLines.value.length) return true
    if (!props.statementItems.length) {
      if (!requireComplete) return true
      ElMessage.warning('请先初始化现金流量表项目')
      return false
    }
    for (const tableRef of allocationTableRefs.value) {
      const tableValidation = await tableRef.validate()
      if (!tableValidation.valid) {
        return false
      }
    }
    for (const line of cashLines.value) {
      const allocated = allocatedAmount(line.lineNo)
      const amount = lineAmount(line)
      if (allocated - amount > 0.005) {
        ElMessage.warning(`第 ${line.lineNo} 条现金分录的归集金额超过分录金额`)
        return false
      }
      if (requireComplete && Math.abs(allocated - amount) > 0.005) {
        ElMessage.warning(`第 ${line.lineNo} 条现金分录尚未完成全额归集`)
        return false
      }
    }
    return true
  }

  defineExpose({ validate })
</script>

<style scoped lang="scss">
  .cash-flow-allocation-panel {
    display: grid;
    gap: var(--art-space-4);
    min-width: 0;
    padding: var(--art-space-4);

    &__header,
    &__line > header,
    &__line > footer {
      display: flex;
      gap: var(--art-space-3);
      align-items: center;
      justify-content: space-between;
    }

    &__header p {
      margin: 4px 0 0;
      font-size: 13px;
      line-height: 1.5;
      color: var(--el-text-color-secondary);
    }

    &__lines {
      display: grid;
      gap: var(--art-space-3);
    }

    &__line {
      display: grid;
      gap: var(--art-space-3);
      min-width: 0;
      padding: var(--art-space-3);
      background: var(--el-fill-color-extra-light);
      border: 1px solid var(--el-border-color-lighter);
      border-radius: var(--el-border-radius-base);

      > footer {
        justify-content: flex-end;
      }
    }

    &__identity,
    &__amount {
      display: flex;
      min-width: 0;
    }

    &__identity {
      flex-direction: column;
      gap: 3px;

      span,
      small {
        font-size: 12px;
        color: var(--el-text-color-secondary);
      }

      strong {
        color: var(--el-text-color-primary);
      }
    }

    &__amount {
      gap: var(--art-space-2);
      align-items: center;

      strong {
        font-size: 16px;
        color: var(--el-text-color-primary);
      }

      small {
        color: var(--el-text-color-secondary);
      }
    }
  }

  @media (width <= 720px) {
    .cash-flow-allocation-panel {
      &__header,
      &__line > header {
        flex-direction: column;
        align-items: flex-start;
      }

      &__amount {
        flex-wrap: wrap;
      }
    }
  }
</style>
