<template>
  <div class="voucher-related-layout">
    <div class="voucher-related-layout__grid" :class="{ 'is-collapsed': !expanded }">
      <div class="min-w-0"><slot /></div>
      <aside
        class="voucher-related-layout__aside"
        aria-label="凭证关联信息"
        data-art-dialog-focus-hide
        data-art-overlay-focus-hide
      >
        <ArtIconButton
          v-if="!expanded"
          icon="ri:sidebar-unfold-line"
          label="展开关联信息"
          :aria-expanded="false"
          :aria-controls="panelId"
          @click="expanded = true"
        />
        <ArtSectionCard
          v-show="expanded"
          :id="panelId"
          title="关联信息"
          :loading="loading && !loaded"
          :skeleton-rows="3"
          :error="loaded ? '' : loadError"
          :empty="!references.length && !loadError"
          :empty-title="restricted ? '关联信息不可查看' : '暂无来源单据'"
          :empty-description="
            restricted
              ? '请联系管理员核对来源字段和业务查看权限。'
              : source?.sourceType === 'manual'
                ? '手工凭证可通过摘要和原始附件保留记账依据。'
                : '当前凭证尚未关联可联查的业务资料。'
          "
          :empty-visual-size="56"
          :min-height="148"
          @retry="loadReferences"
        >
          <template #actions>
            <ArtIconButton
              v-if="isWriteoffSource && !restricted"
              icon="ri:refresh-line"
              label="刷新关联信息"
              :loading="loading"
              @click="loadReferences"
            />
            <ArtIconButton
              icon="ri:sidebar-fold-line"
              label="收起关联信息"
              :aria-expanded="true"
              :aria-controls="panelId"
              @click="expanded = false"
            />
          </template>
          <ElAlert
            v-if="loaded && loadError"
            class="mb-4!"
            type="error"
            :title="loadError"
            :closable="false"
            show-icon
          />
          <dl class="m-0 space-y-4">
            <div v-for="reference in references" :key="reference.key" class="min-w-0">
              <dt class="mb-1 text-xs text-g-700">{{ reference.label }}</dt>
              <dd class="m-0 text-sm wrap-anywhere">
                <ElLink
                  v-if="canNavigate(reference)"
                  type="primary"
                  underline="never"
                  :href="router.resolve({ name: reference.routeName, query: reference.query }).href"
                  :aria-label="`查看${reference.label} ${reference.documentNo}`"
                  @click="navigate(reference, $event)"
                >
                  <span class="art-icon-label min-w-0 text-left wrap-anywhere">
                    <span>{{ reference.documentNo }}</span>
                    <ArtSvgIcon class="shrink-0" icon="ri:external-link-line" />
                  </span>
                </ElLink>
                <span v-else>{{ reference.documentNo }}</span>
              </dd>
            </div>
          </dl>
          <p v-if="restricted" class="mt-4 mb-0 text-xs text-g-700">
            仅显示凭证中已有来源；关联业务暂不可查看。
          </p>
          <p v-else class="mt-4 mb-0 text-xs text-g-700">
            关联信息只读；核算金额以左侧会计分录为准。
          </p>
        </ArtSectionCard>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { computed, onBeforeUnmount, ref, shallowRef, useId, watch } from 'vue'
  import { useRouter } from 'vue-router'
  import { ElAlert, ElLink } from 'element-plus'
  import ArtSectionCard from '@/components/core/surfaces/art-section-card/index.vue'
  import ArtIconButton from '@/components/core/widget/art-icon-button/index.vue'
  import ArtSvgIcon from '@/components/core/base/art-svg-icon/index.vue'
  import { useAuth } from '@/hooks/core/useAuth'
  import { notifyFriendlyError } from '@/hooks/core/useArtFeedback'
  import { useTenantScopeStore } from '@/store/modules/tenant-scope'
  import { createTenantScopeReadGuard } from '@/utils/tenant-scope-context'
  import { getFriendlySupabaseErrorMessage, isSupabaseAccessFailure } from '@/utils/supabase/error'
  import {
    buildVoucherBusinessReferences,
    canReadVoucherReferences,
    isPayableWriteoffVoucherSource
  } from '@/utils/finance/voucher-reference'
  import type {
    VoucherBusinessReference,
    VoucherReferenceSource
  } from '@/utils/finance/voucher-reference'
  import { fetchPayableWriteoffRecord } from '@/api/payable-writeoff'
  import type { PayableWriteoffRecord } from '@/api/payable-writeoff'

  const props = defineProps<{
    source?: VoucherReferenceSource
    beforeNavigate?: () => boolean | void | Promise<boolean | void>
  }>()
  const router = useRouter()
  const { hasAuth } = useAuth()
  const tenantScope = useTenantScopeStore()
  const panelId = useId()
  const expanded = ref(true)
  const loading = ref(false)
  const loaded = ref(false)
  const loadError = ref('')
  const accessDenied = ref(false)
  const writeoff = shallowRef<PayableWriteoffRecord>()
  const sourceScopeId = ref(tenantScope.effectiveTenantId)
  let currentSource: VoucherReferenceSource | undefined
  let requestVersion = 0
  const sourceInScope = computed(
    () =>
      sourceScopeId.value === tenantScope.effectiveTenantId &&
      (!tenantScope.effectiveTenantId ||
        !props.source?.tenantId ||
        tenantScope.effectiveTenantId === props.source.tenantId)
  )
  const isWriteoffSource = computed(
    () => sourceInScope.value && isPayableWriteoffVoucherSource(props.source)
  )
  const restricted = computed(
    () =>
      !canReadVoucherReferences(props.source) ||
      !sourceInScope.value ||
      accessDenied.value ||
      (isWriteoffSource.value && !hasAuth('FinancePayableWriteoff:View'))
  )
  const references = computed(() =>
    buildVoucherBusinessReferences(
      sourceInScope.value ? props.source : undefined,
      restricted.value ? undefined : writeoff.value
    )
  )

  async function loadReferences(): Promise<void> {
    const version = ++requestVersion
    const source = props.source
    loadError.value = ''
    accessDenied.value = false
    if (!isPayableWriteoffVoucherSource(source) || !source?.sourceId || restricted.value) {
      loading.value = false
      loaded.value = true
      return
    }
    const assertScope = createTenantScopeReadGuard()
    loading.value = true
    try {
      const result = await fetchPayableWriteoffRecord(source.sourceId)
      assertScope()
      if (version !== requestVersion) return
      buildVoucherBusinessReferences(source, result)
      writeoff.value = result
      loaded.value = true
    } catch (error) {
      if (version !== requestVersion) return
      if (isSupabaseAccessFailure(error)) {
        writeoff.value = undefined
        accessDenied.value = true
        loaded.value = true
      } else loadError.value = getFriendlySupabaseErrorMessage(error, '关联资料加载失败，请重试')
    } finally {
      if (version === requestVersion) loading.value = false
    }
  }

  function canNavigate(reference: VoucherBusinessReference): boolean {
    return Boolean(
      !restricted.value &&
      reference.routeName &&
      reference.permission &&
      hasAuth(reference.permission) &&
      router.hasRoute(reference.routeName)
    )
  }

  async function navigate(reference: VoucherBusinessReference, event: MouseEvent): Promise<void> {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
      return
    event.preventDefault()
    if (!canNavigate(reference) || !reference.routeName) return
    try {
      if ((await props.beforeNavigate?.()) === false) return
      await router.push({ name: reference.routeName, query: reference.query })
    } catch (error) {
      notifyFriendlyError(error, '关联单据暂未打开，请稍后重试')
    }
  }

  watch(
    () => [props.source, tenantScope.effectiveTenantId, hasAuth('FinancePayableWriteoff:View')],
    () => {
      if (props.source !== currentSource) {
        currentSource = props.source
        sourceScopeId.value = tenantScope.effectiveTenantId
      }
      writeoff.value = undefined
      loaded.value = false
      expanded.value = true
      void loadReferences()
    },
    { immediate: true, flush: 'sync' }
  )
  onBeforeUnmount(() => ++requestVersion)
</script>

<style scoped lang="scss">
  .voucher-related-layout {
    min-width: 0;
    container-type: inline-size;

    &__grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: var(--art-space-4);
      align-items: start;
    }

    &__aside {
      position: sticky;
      top: 0;
      width: 280px;
      min-width: 0;
    }

    .is-collapsed &__aside {
      width: 36px;
    }
  }

  @container (width <= 820px) {
    .voucher-related-layout__grid:not(.is-collapsed) {
      grid-template-columns: minmax(0, 1fr);

      .voucher-related-layout__aside {
        position: static;
        width: 100%;
      }
    }
  }

  :is(.art-dialog.is-focus-mode, .art-drawer.is-focus-mode) .voucher-related-layout__grid {
    grid-template-columns: minmax(0, 1fr);
  }
</style>
