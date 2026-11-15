<template>
  <ArtSectionCard class="expense-ocr art-ai-ocr-surface" preserve-content-structure>
    <template #header>
      <header class="expense-ocr__header">
        <div class="expense-ocr__identity">
          <span class="expense-ocr__icon art-ai-ocr-surface__icon">
            <ArtSvgIcon icon="ri:scan-2-line" />
          </span>
          <div>
            <span class="expense-ocr__eyebrow art-ai-ocr-surface__eyebrow">智能票据识别</span>
            <strong>上传票据后自动填写费用要素</strong>
            <small>识别结果仅写入当前草稿，保存前请人工核对金额与日期。</small>
          </div>
        </div>
        <ElButton
          type="primary"
          plain
          :loading="state.analyzing"
          :disabled="!enabled || !imageUrls.length"
          @click="handleAnalyze"
        >
          <ArtSvgIcon v-if="!state.analyzing" icon="ri:sparkling-2-line" />
          {{ state.result ? '重新识别' : '开始识别' }}
        </ElButton>
      </header>
    </template>

    <div class="expense-ocr__body">
      <ArtUploadImage
        v-model="imageUrls"
        title="费用票据"
        :size="82"
        :limit="5"
        :resource-tenant-id="resourceTenantId"
        :disabled="!resourceTenantId"
        multiple
      />
      <div class="expense-ocr__content">
        <ElAlert
          v-if="!resourceTenantId"
          type="warning"
          :closable="false"
          show-icon
          title="无法确定费用所属租户，暂不能上传票据"
        />
        <div v-if="!enabled" class="expense-ocr__disabled">
          <ArtSvgIcon icon="ri:toggle-line" />
          <span
            ><strong>智能识别已停用</strong><small>仍可上传图片并手工填写申报信息。</small></span
          >
        </div>
        <div v-else-if="!state.result" class="expense-ocr__guide">
          <span class="art-icon-label" v-for="item in guideItems" :key="item.title">
            <ArtSvgIcon :icon="item.icon" />
            <span
              ><strong>{{ item.title }}</strong
              ><small>{{ item.description }}</small></span
            >
          </span>
        </div>
        <div v-else class="expense-ocr__result">
          <div>
            <span>
              <strong>识别完成</strong>
              <ElTag :type="confidenceType" effect="light" round>
                可信度 {{ confidencePercent }}%
              </ElTag>
            </span>
            <ElButton type="primary" @click="emit('apply', state.result)">应用到表单</ElButton>
          </div>
          <p>{{ state.result.summary }}</p>
          <small v-if="state.result.warnings.length">
            {{ state.result.warnings.slice(0, 2).join('；') }}
          </small>
          <OcrOriginalText class="expense-ocr__raw-text" :text="state.result.rawText" />
        </div>
      </div>
    </div>
  </ArtSectionCard>
</template>

<script setup lang="ts">
  import '@styles/core/ai-ocr-surface.scss'
  import ArtSectionCard from '@/components/core/surfaces/art-section-card/index.vue'
  import { getFriendlySupabaseErrorMessage } from '@/utils/supabase'
  import { ElMessage } from 'element-plus'
  import ArtSvgIcon from '@/components/core/base/art-svg-icon/index.vue'
  import ArtUploadImage from '@/components/core/forms/art-upload-image/index.vue'
  import OcrOriginalText from '@/components/business/ocr-original-text/index.vue'
  import { analyzeWaybillExpenseByAi } from '@fms/api'
  import { artOverlayRequestScopeKey } from '@/hooks/core/useArtOverlay'
  import { createTenantScopeReadGuard } from '@/utils/tenant-scope-context'

  defineOptions({ name: 'FinanceWaybillExpenseOcrPanel' })

  const props = defineProps<{ modelValue: string[]; enabled: boolean; resourceTenantId: string }>()
  const emit = defineEmits<{
    'update:modelValue': [value: string[]]
    apply: [result: Api.Fms.WaybillExpenseOcrAnalyzeResponse]
    failed: []
  }>()

  const guideItems = [
    { icon: 'ri:money-cny-circle-line', title: '金额日期', description: '票面金额、消费时间' },
    { icon: 'ri:gas-station-line', title: '消费信息', description: '服务商、收款方与支付渠道' },
    { icon: 'ri:file-text-line', title: '票据要素', description: '服务商、票号、地点与数量' }
  ]
  const state = reactive<{
    analyzing: boolean
    result?: Api.Fms.WaybillExpenseOcrAnalyzeResponse
  }>({ analyzing: false, result: undefined })
  const overlayScope = inject(artOverlayRequestScopeKey, undefined)
  let requestVersion = 0
  watch(
    [
      () => props.modelValue,
      () => props.enabled,
      () => props.resourceTenantId,
      () => overlayScope?.version.value,
      () => overlayScope?.visible.value
    ],
    reset,
    { deep: true, flush: 'sync' }
  )
  onBeforeUnmount(reset)
  const imageUrls = computed<string[]>({
    get: () => props.modelValue,
    set: (value) => {
      reset()
      emit('update:modelValue', value)
    }
  })
  const confidencePercent = computed(() => Math.round((state.result?.confidence ?? 0) * 100))
  const confidenceType = computed(() =>
    confidencePercent.value >= 85 ? 'success' : confidencePercent.value >= 65 ? 'warning' : 'danger'
  )

  async function handleAnalyze(): Promise<void> {
    if (!props.enabled || !imageUrls.value.length || state.analyzing) return
    if (overlayScope && !overlayScope.visible.value) return
    const version = ++requestVersion
    const ensureScope = createTenantScopeReadGuard()
    const images = [...imageUrls.value]
    state.analyzing = true
    try {
      const response = await analyzeWaybillExpenseByAi(images)
      if (version !== requestVersion) return
      ensureScope()
      if (response.error || !response.data) throw response.error || new Error('未返回识别结果')
      state.result = response.data
      ElMessage.success('票据识别完成，请核对后应用')
    } catch (error) {
      if (version !== requestVersion) return
      emit('failed')
      ElMessage.error(
        getFriendlySupabaseErrorMessage(error, '票据识别失败，请稍后重试或改为手工填写')
      )
    } finally {
      if (version === requestVersion) state.analyzing = false
    }
  }

  function reset(): void {
    requestVersion += 1
    state.analyzing = false
    state.result = undefined
  }

  defineExpose({ reset })
</script>

<style scoped lang="scss">
  .expense-ocr {
    --art-ai-ocr-icon-size: 40px;
    --art-ai-ocr-icon-font-size: 20px;

    padding: var(--art-space-4);
    margin-bottom: var(--art-space-4);

    &__header,
    &__identity,
    &__body,
    &__guide,
    &__guide > span,
    &__disabled,
    &__result > div,
    &__result > div > span {
      display: flex;
      align-items: center;
    }

    &__header {
      gap: var(--art-space-4);
      justify-content: space-between;
    }

    &__identity {
      gap: var(--art-space-3);
      min-width: 0;

      > div,
      > div > span {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }

      strong {
        color: var(--el-text-color-primary);
      }

      small {
        line-height: 1.5;
        color: var(--el-text-color-secondary);
      }
    }

    &__body {
      gap: var(--art-space-4);
      margin-top: var(--art-space-3);
    }

    &__content {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: var(--art-space-2);
      min-width: 0;
    }

    &__guide {
      flex: 1;
      gap: var(--art-space-2);
      min-width: 0;

      > span {
        flex: 1;
        gap: var(--art-space-2);
        min-width: 0;
        padding-block: var(--art-space-2);

        > svg {
          flex: none;
          font-size: 18px;
          color: var(--theme-color);
        }

        > span {
          display: flex;
          flex-direction: column;
          min-width: 0;
        }

        strong,
        small {
          line-height: 1.5;
          overflow-wrap: anywhere;
        }

        strong {
          font-size: 12px;
          color: var(--el-text-color-primary);
        }

        small {
          font-size: 12px;
          color: var(--el-text-color-secondary);
        }
      }
    }

    &__disabled {
      gap: var(--art-space-2);
      color: var(--el-text-color-secondary);

      span {
        display: flex;
        flex-direction: column;
      }
    }

    &__result {
      flex: 1;
      min-width: 0;

      > div {
        gap: var(--art-space-3);
        justify-content: space-between;

        > span {
          gap: var(--art-space-2);
        }
      }

      p,
      > small {
        display: block;
        margin: 6px 0 0;
        color: var(--el-text-color-secondary);
      }

      > small {
        color: var(--el-color-warning-dark-2);
      }

      .expense-ocr__raw-text {
        margin-top: var(--art-space-3);
      }
    }

    @media (width <= 860px) {
      &__header,
      &__body {
        flex-direction: column;
        align-items: stretch;
      }

      &__guide {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
    }

    @media (width <= 540px) {
      &__guide {
        grid-template-columns: 1fr;
      }
    }
  }
</style>
