<template>
  <ArtSectionCard class="invoice-ocr-panel art-ai-ocr-surface" preserve-content-structure>
    <template #header>
      <header class="invoice-ocr-panel__header">
        <div class="invoice-ocr-panel__identity">
          <span class="invoice-ocr-panel__icon art-ai-ocr-surface__icon" aria-hidden="true">
            <ArtSvgIcon icon="ri-scan-2-line" />
          </span>
          <div>
            <div class="invoice-ocr-panel__eyebrow art-ai-ocr-surface__eyebrow">AI 智能识别</div>
            <h3>上传发票，自动提取关键字段</h3>
            <p>识别结果先预览、再回填，不会自动保存或改变审核状态。</p>
          </div>
        </div>
        <ElButton
          type="primary"
          :loading="analyzing"
          :disabled="!imageUrls.length"
          @click="handleAnalyze"
        >
          <ArtSvgIcon v-if="!analyzing" icon="ri-sparkling-2-line" />
          {{ result ? '重新识别' : '识别票面' }}
        </ElButton>
      </header>
    </template>

    <div class="invoice-ocr-panel__body" :class="{ 'is-ready': !result }">
      <div class="invoice-ocr-panel__upload">
        <ArtUploadImage
          v-model="imageUrls"
          title="上传发票"
          :size="76"
          :limit="3"
          :resource-tenant-id="resourceTenantId"
          :disabled="!resourceTenantId"
          multiple
        />
        <div class="invoice-ocr-panel__upload-copy">
          <strong>{{
            imageUrls.length ? `已上传 ${imageUrls.length} 张票面` : '上传 1–3 张票面'
          }}</strong>
          <span>保持票面完整、端正，号码与金额区域清晰可见。</span>
        </div>
      </div>

      <div class="invoice-ocr-panel__content">
        <ElAlert
          v-if="!resourceTenantId"
          type="warning"
          :closable="false"
          show-icon
          title="无法确定发票所属租户，暂不能上传票面"
        />

        <div v-if="!result" class="invoice-ocr-panel__guide">
          <div v-for="item in guideItems" :key="item.title" class="invoice-ocr-panel__guide-item">
            <ArtSvgIcon :icon="item.icon" />
            <div>
              <strong>{{ item.title }}</strong>
              <span>{{ item.description }}</span>
            </div>
          </div>
        </div>
        <div v-else class="invoice-ocr-panel__result">
          <div class="invoice-ocr-panel__result-head">
            <div>
              <span class="invoice-ocr-panel__status-dot" />
              <strong>识别完成</strong>
              <ElTag :type="confidenceTagType" effect="light" round>
                可信度 {{ confidencePercent }}%
              </ElTag>
            </div>
            <ElButton type="primary" plain @click="handleApply">
              {{ applyLabel }}
              <ArtSvgIcon icon="ri-arrow-right-line" />
            </ElButton>
          </div>
          <p v-if="result.summary" class="invoice-ocr-panel__summary">{{ result.summary }}</p>
          <ElProgress
            :percentage="confidencePercent"
            :stroke-width="6"
            :show-text="false"
            :status="confidenceProgressStatus"
          />

          <OcrOriginalText
            class="invoice-ocr-panel__raw-text"
            :text="result.rawText"
            :min-rows="4"
            :max-rows="8"
          />

          <div class="invoice-ocr-panel__fields">
            <div v-for="field in visibleFields" :key="field.key" class="invoice-ocr-panel__field">
              <span>{{ field.label }}</span>
              <strong :class="{ 'is-empty': field.value === '未识别' }">{{ field.value }}</strong>
              <small :class="confidenceClass(field.confidence)">
                {{
                  field.confidence === undefined
                    ? '待人工核对'
                    : `${Math.round(field.confidence * 100)}%`
                }}
              </small>
            </div>
          </div>

          <div
            v-if="result.warnings.length || result.missingFields.length"
            class="invoice-ocr-panel__notice"
          >
            <ArtSvgIcon icon="ri-error-warning-line" />
            <div>
              <strong>应用前请核对</strong>
              <span v-if="result.missingFields.length">
                未识别：{{ result.missingFields.join('、') }}
              </span>
              <span v-for="warning in result.warnings" :key="warning">{{ warning }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </ArtSectionCard>
</template>

<script setup lang="ts">
  import '@styles/core/ai-ocr-surface.scss'
  import { formatSensitiveNumberWithAffix } from '@/utils/field-permission'
  import ArtSectionCard from '@/components/core/surfaces/art-section-card/index.vue'
  import { getFriendlySupabaseErrorMessage } from '@/utils/supabase'
  import { ElMessage } from 'element-plus'
  import ArtSvgIcon from '@/components/core/base/art-svg-icon/index.vue'
  import ArtUploadImage from '@/components/core/forms/art-upload-image/index.vue'
  import OcrOriginalText from '@/components/business/ocr-original-text/index.vue'
  import { analyzeInvoiceAttachmentByAi } from '@fms/api'

  defineOptions({ name: 'FinanceInvoiceOcrPanel' })

  const props = defineProps<{
    modelValue: string[]
    direction: Api.Fms.InvoiceDirection
    resourceTenantId: string
    applyLabel?: string
  }>()

  const applyLabel = computed(() => props.applyLabel || '应用识别结果')

  const emit = defineEmits<{
    'update:modelValue': [value: string[]]
    apply: [result: Api.Fms.InvoiceOcrAnalyzeResponse]
  }>()

  type OcrResponse = Api.Fms.InvoiceOcrAnalyzeResponse
  type OcrField = Api.Fms.InvoiceOcrField

  interface FieldView {
    key: OcrField
    label: string
    value: string
    confidence?: number
  }

  const guideItems = [
    { icon: 'ri-file-search-line', title: '票面字段', description: '号码、日期、购销双方与税号' },
    { icon: 'ri-calculator-line', title: '金额校验', description: '不含税金额、税额与价税合计' },
    { icon: 'ri-shield-check-line', title: '人工确认', description: '低置信字段会明确提示复核' }
  ]

  const analyzing = ref(false)
  const result = ref<OcrResponse>()

  const imageUrls = computed<string[]>({
    get: () => props.modelValue,
    set: (value) => {
      result.value = undefined
      emit('update:modelValue', value)
    }
  })

  const confidencePercent = computed(() => Math.round((result.value?.confidence ?? 0) * 100))
  const confidenceTagType = computed(() =>
    confidencePercent.value >= 85 ? 'success' : confidencePercent.value >= 65 ? 'warning' : 'danger'
  )
  const confidenceProgressStatus = computed(() =>
    confidencePercent.value >= 85
      ? 'success'
      : confidencePercent.value < 65
        ? 'exception'
        : undefined
  )

  const visibleFields = computed<FieldView[]>(() => {
    if (!result.value) return []
    const invoice = result.value.invoice
    const confidence = result.value.fieldConfidence
    return [
      fieldView('invoiceNo', '发票号码', invoice.invoiceNo, confidence),
      fieldView('issueDate', '开票日期', invoice.issueDate, confidence),
      fieldView('invoiceTitle', '发票抬头', invoice.invoiceTitle, confidence),
      fieldView('taxNumber', '纳税人识别号', invoice.taxNumber, confidence),
      fieldView(
        'amountExcludingTax',
        '不含税金额',
        formatSensitiveNumberWithAffix(invoice.amountExcludingTax, {
          prefix: '¥',
          emptyText: '未识别'
        }),
        confidence
      ),
      fieldView(
        'taxAmount',
        '税额',
        formatSensitiveNumberWithAffix(invoice.taxAmount, { prefix: '¥', emptyText: '未识别' }),
        confidence
      ),
      fieldView(
        'totalAmount',
        '价税合计',
        formatSensitiveNumberWithAffix(invoice.totalAmount, { prefix: '¥', emptyText: '未识别' }),
        confidence
      ),
      fieldView(
        'taxRate',
        '税率',
        invoice.taxRate === null || invoice.taxRate === undefined ? null : `${invoice.taxRate}%`,
        confidence
      )
    ]
  })

  function fieldView(
    key: OcrField,
    label: string,
    value: string | null | undefined,
    confidence: Partial<Record<OcrField, number>>
  ): FieldView {
    return { key, label, value: value || '未识别', confidence: confidence[key] }
  }

  function confidenceClass(confidence?: number): string {
    if (confidence === undefined) return 'is-neutral'
    if (confidence >= 0.85) return 'is-high'
    if (confidence >= 0.65) return 'is-medium'
    return 'is-low'
  }

  async function handleAnalyze(): Promise<void> {
    if (!imageUrls.value.length || analyzing.value) return
    analyzing.value = true
    try {
      const response = await analyzeInvoiceAttachmentByAi(
        {
          action: 'analyze',
          imageUrls: imageUrls.value,
          direction: props.direction
        },
        props.resourceTenantId
      )
      if (response.error || !response.data) throw response.error || new Error('未返回识别结果')
      result.value = response.data
      ElMessage.success('发票识别完成，请核对后应用')
    } catch (error) {
      ElMessage.error(getFriendlySupabaseErrorMessage(error, 'AI 发票识别失败，请稍后重试'))
    } finally {
      analyzing.value = false
    }
  }

  function handleApply(): void {
    if (!result.value) return
    emit('apply', result.value)
  }

  function reset(): void {
    result.value = undefined
    analyzing.value = false
  }

  defineExpose({ reset })
</script>

<style scoped lang="scss">
  @use '@/assets/styles/core/ai-surface-mixins' as ai;

  .invoice-ocr-panel {
    padding: 14px 16px;
    margin-bottom: 16px;

    &__header,
    &__identity,
    &__upload,
    &__result-head,
    &__result-head > div,
    &__notice {
      display: flex;
      align-items: center;
    }

    &__header {
      gap: 16px;
      justify-content: space-between;
    }

    &__identity {
      gap: 10px;
      min-width: 0;

      h3 {
        margin: 1px 0 2px;
        font-size: 15px;
        font-weight: 600;
        color: var(--el-text-color-primary);
      }

      p {
        margin: 0;
        font-size: 12px;
        color: var(--el-text-color-secondary);
      }
    }

    &__body {
      display: grid;
      grid-template-columns: minmax(300px, 0.78fr) minmax(0, 2.22fr);
      gap: 16px;
      align-items: start;
      padding-top: 12px;
      margin-top: 12px;
      border-top: 1px solid var(--el-border-color-lighter);

      &.is-ready {
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);

        .invoice-ocr-panel__upload {
          flex-direction: row;
          gap: 12px;
          align-items: center;
          padding: 0;
          background: transparent;
          border: 0;
        }

        .invoice-ocr-panel__upload-copy {
          flex: 1;
        }

        .invoice-ocr-panel__guide {
          grid-template-columns: 1fr;
          gap: 8px;
        }

        .invoice-ocr-panel__guide-item {
          align-items: center;
          min-height: 0;
          padding: 0;
          background: transparent;
          border: 0;
          box-shadow: none;

          > div {
            flex-flow: row wrap;
            gap: 4px 8px;
          }
        }
      }
    }

    &__upload {
      flex-direction: column;
      gap: 8px;
      align-items: flex-start;
      align-self: start;
      width: 100%;
      min-width: 0;
      padding: 10px;
      background: var(--art-gray-100);
      border: 1px solid var(--art-card-border);
      border-radius: var(--custom-radius, 8px);
    }

    &__content {
      display: flex;
      flex-direction: column;
      gap: 12px;
      min-width: 0;
    }

    &__upload-copy,
    &__guide-item > div,
    &__notice > div {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    &__upload-copy {
      width: 100%;
      min-width: 0;

      strong {
        font-size: 13px;
        color: var(--el-text-color-primary);
        white-space: nowrap;
      }

      span {
        font-size: 12px;
        line-height: 1.55;
        color: var(--el-text-color-regular);
        overflow-wrap: anywhere;
      }
    }

    &__guide {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
    }

    &__guide-item {
      @include ai.capability-item;

      display: flex;
      gap: 8px;
      align-items: flex-start;
      min-width: 0;
      min-height: 76px;
      padding: 10px;
      border-radius: var(--custom-radius, 8px);

      > svg {
        @include ai.capability-icon;

        margin-top: 2px;
      }

      &:nth-child(2) {
        --ai-capability-color: #d97706;
      }

      &:nth-child(3) {
        --ai-capability-color: #059669;
      }

      strong {
        font-size: 12px;
        color: var(--el-text-color-primary);
      }

      span {
        font-size: 12px;
        line-height: 1.5;
        color: var(--el-text-color-regular);
      }
    }

    &__result {
      min-width: 0;
    }

    &__result-head {
      gap: 12px;
      justify-content: space-between;

      > div {
        gap: 8px;
      }
    }

    &__status-dot {
      width: 7px;
      height: 7px;
      background: var(--el-color-success);
      border-radius: 50%;
      box-shadow: 0 0 0 4px var(--el-color-success-light-9);
    }

    &__summary {
      margin: 8px 0;
      font-size: 12px;
      line-height: 1.5;
      color: var(--el-text-color-secondary);
    }

    &__fields {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 8px;
      margin-top: 10px;
    }

    &__raw-text {
      margin-top: 10px;
    }

    &__field {
      position: relative;
      min-width: 0;
      min-height: 70px;
      padding: 9px 10px;
      background: var(--art-gray-100);
      border: 1px solid var(--art-card-border);
      border-radius: var(--custom-radius, 8px);

      span,
      strong,
      small {
        display: block;
      }

      span {
        margin-bottom: 5px;
        font-size: 11px;
        color: var(--el-text-color-secondary);
      }

      strong {
        overflow: hidden;
        text-overflow: ellipsis;
        font-size: 13px;
        color: var(--el-text-color-primary);
        white-space: nowrap;

        &.is-empty {
          font-weight: 500;
          color: var(--el-text-color-secondary);
        }
      }

      small {
        margin-top: 5px;
        font-size: 10px;

        &.is-high {
          color: var(--el-color-success);
        }

        &.is-medium {
          color: var(--el-color-warning);
        }

        &.is-low {
          color: var(--el-color-danger);
        }

        &.is-neutral {
          color: var(--el-text-color-secondary);
        }
      }
    }

    &__notice {
      gap: 9px;
      align-items: flex-start;
      padding: 9px 11px;
      margin-top: 8px;
      color: var(--el-color-warning-dark-2);
      background: var(--el-color-warning-light-9);
      border: 1px solid var(--el-color-warning-light-7);
      border-radius: var(--custom-radius, 8px);

      > svg {
        flex: 0 0 auto;
        margin-top: 2px;
      }

      strong,
      span {
        font-size: 12px;
        line-height: 1.55;
      }
    }
  }

  @media (width <= 900px) {
    .invoice-ocr-panel {
      &__body {
        grid-template-columns: 1fr;

        &.is-ready {
          grid-template-columns: 1fr;
        }
      }

      &__upload {
        min-height: auto;
      }

      &__fields {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
  }

  @media (width <= 640px) {
    .invoice-ocr-panel {
      padding: 14px;

      &__header,
      &__result-head {
        flex-direction: column;
        align-items: flex-start;
      }

      &__header > .el-button,
      &__result-head > .el-button {
        width: 100%;
      }

      &__guide,
      &__fields {
        grid-template-columns: 1fr;
      }
    }
  }
</style>
