import assert from 'node:assert/strict'
import test from 'node:test'
import { effectScope, ref } from 'vue'
import { createFinancePrerequisiteOverlay } from '../../src/views/modules/finance-prerequisite-overlay'

function fixture() {
  const visible = ref(true)
  const loading = ref(false)
  const confirming = ref(false)
  let closes = 0
  const api = {
    visible,
    handleClose: async () => {
      closes++
      visible.value = false
      return true
    },
    setLoading: (value: boolean) => {
      loading.value = value
    },
    setConfirmLoading: (value: boolean) => {
      confirming.value = value
    }
  }
  const scope = effectScope()
  const overlay = scope.run(() => createFinancePrerequisiteOverlay(ref(api)))!
  return { overlay, api, visible, loading, confirming, scope, closes: () => closes }
}

for (const first of ['local', 'readiness'] as const) {
  test(`${first} finishing first preserves the other finance loading lock`, () => {
    const state = fixture()
    try {
      const opening = state.overlay.beginOpen()
      opening.setPrerequisiteLoading(true)
      opening.attach(state.api)
      if (first === 'local') opening.finishLoading()
      else opening.setPrerequisiteLoading(false)
      assert.equal(state.loading.value, true)
      assert.equal(state.confirming.value, true)
      if (first === 'local') opening.setPrerequisiteLoading(false)
      else opening.finishLoading()
      assert.equal(state.loading.value, false)
      assert.equal(state.confirming.value, false)
    } finally {
      state.scope.stop()
    }
  })
}

test('pre-open readiness is reapplied when the core resets its loading flags', () => {
  const state = fixture()
  try {
    const opening = state.overlay.beginOpen()
    opening.setPrerequisiteLoading(true)
    opening.finishLoading()
    state.api.setLoading(false)
    state.api.setConfirmLoading(false)
    opening.attach(state.api)
    assert.equal(state.loading.value, true)
    assert.equal(state.confirming.value, true)
    opening.setPrerequisiteLoading(false)
    assert.equal(state.loading.value, false)
  } finally {
    state.scope.stop()
  }
})

for (const finishCurrent of [false, true]) {
  test(`old readiness and local completions cannot change a newer ${finishCurrent ? 'ready' : 'loading'} dialog`, async () => {
    const state = fixture()
    try {
      const old = state.overlay.beginOpen()
      old.attach(state.api)
      old.setPrerequisiteLoading(true)
      const current = state.overlay.beginOpen()
      current.attach(state.api)
      if (finishCurrent) current.finishLoading()
      old.finishLoading()
      old.setPrerequisiteLoading(false)
      old.setPrerequisiteLoading(true)
      old.attach(state.api)
      await old.dismiss()
      assert.equal(old.isCurrent(), false)
      assert.equal(current.isCurrent(), true)
      assert.equal(state.closes(), 0)
      assert.equal(state.visible.value, true)
      assert.equal(state.loading.value, !finishCurrent)
      assert.equal(state.confirming.value, !finishCurrent)
    } finally {
      state.scope.stop()
    }
  })
}

test('direct edit invalidates a deferred Add reservation before its action', () => {
  const state = fixture()
  try {
    const reservation = state.overlay.reserveOpen()
    assert.equal(reservation.isCurrent(), true)
    assert.equal(state.overlay.currentSession(), undefined)
    const edit = state.overlay.beginOpen()
    edit.attach(state.api)
    assert.equal(reservation.isCurrent(), false)
    assert.equal(state.overlay.currentSession(), edit)
  } finally {
    state.scope.stop()
  }
})

for (const ending of ['close', 'reset', 'dispose'] as const) {
  test(`${ending} invalidates pending finance work and reservations`, async () => {
    const state = fixture()
    try {
      const opening = state.overlay.beginOpen()
      opening.attach(state.api)
      if (ending === 'close') state.visible.value = false
      else if (ending === 'reset') state.overlay.invalidate()
      else state.scope.stop()
      state.api.setLoading(false)
      state.api.setConfirmLoading(false)
      opening.setPrerequisiteLoading(true)
      await opening.dismiss()
      assert.equal(opening.isCurrent(), false)
      assert.equal(state.loading.value, false)
      assert.equal(state.confirming.value, false)
      assert.equal(state.closes(), 0)
    } finally {
      state.scope.stop()
    }
  })
}

test('dismissing a pre-open intent prevents its deferred opening from continuing', async () => {
  const state = fixture()
  try {
    state.visible.value = false
    const opening = state.overlay.beginOpen()
    assert.equal(opening.isCurrent(), true)
    await opening.dismiss()
    assert.equal(opening.isCurrent(), false)
  } finally {
    state.scope.stop()
  }
})
