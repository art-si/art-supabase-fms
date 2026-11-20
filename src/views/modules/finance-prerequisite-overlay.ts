import { getCurrentScope, unref, watch, type MaybeRef, type Ref } from 'vue'
import { useArtOverlaySession } from '@/hooks/core/useArtOverlay'

export interface FinancePrerequisiteSession {
  isCurrent: () => boolean
  attach: (api: FinanceOverlayInstance) => void
  dismiss: () => Promise<void>
  setPrerequisiteLoading: (value: boolean) => void
  finishLoading: () => void
}

export interface FinancePrerequisiteOverlay {
  beginOpen: () => FinancePrerequisiteSession
  currentSession: () => FinancePrerequisiteSession | undefined
  reserveOpen: () => { isCurrent: () => boolean }
  invalidate: () => void
}

interface FinanceOverlayInstance {
  visible: MaybeRef<boolean>
  handleClose: (force?: boolean) => Promise<boolean>
  setConfirmLoading: (value: boolean) => void
  setLoading: (value: boolean) => void
}

export function createFinancePrerequisiteOverlay(
  overlayRef: Readonly<Ref<FinanceOverlayInstance | undefined>>
): FinancePrerequisiteOverlay {
  // An opening intent also owns work before the core overlay becomes visible.
  const scope = getCurrentScope()
  const ownership = useArtOverlaySession(() => !scope || scope.active)
  let current: FinancePrerequisiteSession | undefined
  function invalidate(): void {
    ownership.invalidate()
    current = undefined
  }
  watch(
    () => unref(overlayRef.value?.visible),
    (visible, previous) => {
      if (previous && !visible) invalidate()
    },
    { flush: 'sync' }
  )

  function beginOpen(): FinancePrerequisiteSession {
    const version = ownership.invalidate()
    let api: FinanceOverlayInstance | undefined
    let localLoading = true
    let prerequisiteLoading = false
    const isCurrent = () => ownership.isCurrent(version) && (!api || unref(api.visible))
    function syncLoading(): void {
      if (!isCurrent()) return
      const loading = localLoading || prerequisiteLoading
      api?.setLoading(loading)
      api?.setConfirmLoading(loading)
    }
    const session: FinancePrerequisiteSession = {
      isCurrent,
      attach: (instance) => {
        if (!isCurrent()) return
        api = instance
        syncLoading()
      },
      dismiss: async () => {
        if (!isCurrent()) return
        const target = api ?? overlayRef.value
        invalidate()
        await target?.handleClose(true)
      },
      setPrerequisiteLoading: (value) => {
        if (!isCurrent()) return
        prerequisiteLoading = value
        syncLoading()
      },
      finishLoading: () => {
        if (!isCurrent()) return
        localLoading = false
        syncLoading()
      }
    }
    current = session
    return session
  }

  return {
    beginOpen,
    currentSession: () => current,
    reserveOpen: () => {
      invalidate()
      const version = ownership.version.value
      return { isCurrent: () => ownership.isCurrent(version) }
    },
    invalidate
  }
}
