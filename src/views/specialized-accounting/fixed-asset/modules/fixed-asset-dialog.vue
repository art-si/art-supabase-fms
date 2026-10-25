<template>
  <ArtDialog ref="dialogRef" size="md">
    <template v-if="!isEditing" #subtitle
      >资产先以草稿登记；确认转固后进入折旧与处置生命周期，核心价值字段不可直接修改。</template
    >
    <ElAlert v-if="categoriesFailed" type="error" :closable="false" show-icon class="mb-4">
      <template #title>资产类别加载失败，请重新加载后再保存。</template>
      <ElButton plain type="primary" @click="loadCategories(form.accountSetId)"
        >重新加载类别</ElButton
      >
    </ElAlert>
    <ArtForm
      root-class="art-form--mobile-stack"
      ref="formRef"
      :model-value="form"
      @update:model-value="replaceReactiveModel(form, $event)"
      :items="items"
      :rules="rules"
      :span="12"
      :gutter="20"
      label-width="104px"
      :show-reset="false"
      :show-submit="false"
    />
  </ArtDialog>
</template>

<script setup lang="ts">
  import { replaceReactiveModel } from '@/utils/form/model'
  import { notifyFriendlyError } from '@/hooks/core/useArtFeedback'
  import { validateArtFormForSubmit } from '@/utils/form/validate-art-form'
  import { useAuth } from '@/hooks/core/useAuth'
  import { ElMessage } from 'element-plus'
  import { createFinancePrerequisiteOverlay } from '../../../modules/use-finance-account-set-prerequisite'
  import { normalizeNullableNumber, normalizeNullableText } from '@/utils/form/normalize'
  import dayjs from 'dayjs'
  import type { FormRules } from 'element-plus'
  import ArtDialog from '@/components/core/dialogs/art-dialog/index.vue'
  import type { ArtDialogExpose } from '@/components/core/dialogs/art-dialog/types'
  import ArtForm, { type FormItem } from '@/components/core/forms/art-form/index.vue'
  import {
    fetchAccountSetOptions,
    fetchAssetCategoryList,
    fetchFixedAssetDetail,
    fetchFixedAssetVehicleOptions,
    saveFixedAsset
  } from '@fms/api'
  import { canEditField, canViewField } from '@/utils/field-permission'
  import { formatSensitiveCurrencyValue as formatProtectedAmount } from '@/utils/ui'

  defineOptions({ name: 'FinanceFixedAssetDialog' })
  const emit = defineEmits<{ success: [] }>()
  const dialogRef = ref<ArtDialogExpose>()
  const prerequisiteOverlay = createFinancePrerequisiteOverlay(dialogRef)
  const formRef = ref<{ validate: () => Promise<boolean>; clearValidate: () => void }>()
  const accountSetOptions = ref<Api.Fms.AccountSetOption[]>([])
  const currentRecord = shallowRef<Api.Fms.FixedAssetRecord>()
  const fieldAccess = ref<Api.Fms.FixedAssetFieldAccessMap>({})
  const categoryOptions = ref<Array<{ label: string; value: string; life: number; rate: number }>>(
    []
  )
  const categoriesLoading = ref(false)
  const categoriesFailed = ref(false)
  const vehicleOptions = ref<Array<{ value: string; label: string }>>([])
  const vehiclesLoading = ref(false)
  let vehicleRequestId = 0
  async function loadVehicles(keyword = ''): Promise<void> {
    const requestId = ++vehicleRequestId
    if (!form.accountSetId || !canView('assetReferences')) {
      vehicleOptions.value = []
      vehiclesLoading.value = false
      return
    }
    vehiclesLoading.value = true
    try {
      const result = await fetchFixedAssetVehicleOptions(form.accountSetId, keyword, form.vehicleId)
      if (requestId !== vehicleRequestId) return
      if (result.error) throw result.error
      vehicleOptions.value = result.data ?? []
    } catch (error) {
      if (requestId === vehicleRequestId) {
        vehicleOptions.value = []
        notifyFriendlyError(error, '车辆选项加载失败，请重新搜索车牌')
      }
    } finally {
      if (requestId === vehicleRequestId) vehiclesLoading.value = false
    }
  }
  let categoryRequestId = 0
  const initial = (): Api.Fms.SaveFixedAssetPayload => ({
    accountSetId: '',
    categoryId: '',
    assetNo: '',
    assetName: '',
    vehicleId: null,
    acquisitionDate: dayjs().format('YYYY-MM-DD'),
    readyForUseDate: dayjs().format('YYYY-MM-DD'),
    depreciationStartDate: dayjs().format('YYYY-MM-DD'),
    originalValue: 0,
    residualValue: 0,
    usefulLifeMonths: 60,
    departmentId: null,
    employeeId: null,
    location: null,
    specification: null,
    serialNo: null,
    sourceType: null,
    sourceId: null,
    sourceNo: null,
    remark: null
  })
  const form = reactive(initial())
  const { hasAuth } = useAuth()
  const savePermission = computed(() =>
    form.id ? 'FinanceFixedAsset:Edit' : 'FinanceFixedAsset:Add'
  )
  function canSave(): boolean {
    if (hasAuth(savePermission.value)) return true
    ElMessage.warning('固定资产操作权限已变化，请刷新页面后重试')
    return false
  }
  const isEditing = computed(() => Boolean(form.id))
  const canView = (field: Api.Fms.FixedAssetFieldKey): boolean =>
    !isEditing.value || canViewField(fieldAccess.value, field)
  const canEdit = (field: Api.Fms.FixedAssetFieldKey): boolean =>
    !isEditing.value || canEditField(fieldAccess.value, field)
  const rules: FormRules = {
    accountSetId: [{ required: true, message: '请选择账套', trigger: 'change' }],
    categoryId: [{ required: true, message: '请选择资产类别', trigger: 'change' }],
    assetName: [{ required: true, whitespace: true, message: '请输入资产名称', trigger: 'blur' }],
    acquisitionDate: [{ required: true, message: '请选择购置日期', trigger: 'change' }],
    readyForUseDate: [{ required: true, message: '请选择达到可用日期', trigger: 'change' }],
    originalValue: [
      {
        validator: (_rule, value, callback) => {
          if (!canEdit('assetValues') || Number(value) > 0) return callback()
          callback(new Error('请输入大于 0 的资产原值'))
        },
        trigger: 'change'
      }
    ]
  }
  const items = computed<FormItem[]>(() => {
    const result: FormItem[] = [
      { label: '资产档案', key: 'identitySection', type: 'divider', span: 24 },
      {
        label: '所属账套',
        key: 'accountSetId',
        type: 'select',
        span: 24,
        props: { options: accountSetOptions.value, filterable: true, disabled: Boolean(form.id) }
      },
      {
        label: '资产类别',
        key: 'categoryId',
        type: 'select',
        span: 24,
        props: {
          options: categoryOptions.value,
          filterable: true,
          loading: categoriesLoading.value,
          disabled: !form.accountSetId || categoriesLoading.value || categoriesFailed.value
        }
      },
      {
        label: '资产编号',
        key: 'assetNo',
        type: 'input',
        props: { maxlength: 60, placeholder: '留空自动生成' }
      },
      { label: '资产名称', key: 'assetName', type: 'input', span: 24, props: { maxlength: 120 } }
    ]

    if (canView('assetReferences')) {
      result.push(
        canEdit('assetReferences')
          ? {
              label: '关联车辆',
              key: 'vehicleId',
              type: 'select',
              span: 24,
              props: {
                options: vehicleOptions.value,
                clearable: true,
                filterable: true,
                remote: true,
                remoteMethod: loadVehicles,
                loading: vehiclesLoading.value,
                disabled: !form.accountSetId,
                placeholder: '非车辆资产可留空，输入车牌搜索'
              }
            }
          : {
              label: '关联车辆',
              key: '__vehicleDisplay',
              type: 'text',
              span: 24,
              props: {
                formatter: () =>
                  vehicleOptions.value.find((item) => item.value === currentRecord.value?.vehicleId)
                    ?.label || (currentRecord.value?.vehicleId ? '车辆资料暂不可用' : '未关联车辆')
              }
            }
      )
      const referenceItems: Array<[string, 'serialNo' | 'specification' | 'sourceNo', string]> = [
        ['序列号', 'serialNo', '设备序列号或唯一标识'],
        ['规格型号', 'specification', '资产规格、品牌或型号'],
        ['来源单号', 'sourceNo', '采购单、验收单或调拨单号']
      ]
      result.push(
        ...referenceItems.map(([label, key, placeholder]) =>
          canEdit('assetReferences')
            ? {
                label,
                key,
                type: 'input' as const,
                props: { maxlength: 160, placeholder }
              }
            : {
                label,
                key: `__${key}Display`,
                type: 'text' as const,
                props: { formatter: () => currentRecord.value?.[key] || '--' }
              }
        )
      )
    }

    result.push(
      { label: '购置与折旧', key: 'depreciationSection', type: 'divider', span: 24 },
      {
        label: '购置日期',
        key: 'acquisitionDate',
        type: 'date',
        props: { valueFormat: 'YYYY-MM-DD', class: '!w-full' }
      },
      {
        label: '达到可用日',
        key: 'readyForUseDate',
        type: 'date',
        props: { valueFormat: 'YYYY-MM-DD', class: '!w-full' }
      },
      {
        label: '折旧起始日',
        key: 'depreciationStartDate',
        type: 'date',
        props: { valueFormat: 'YYYY-MM-DD', class: '!w-full' }
      }
    )

    if (canView('assetValues')) {
      result.push(
        ...(canEdit('assetValues')
          ? [
              {
                label: '资产原值',
                key: 'originalValue',
                type: 'number' as const,
                props: {
                  min: 0.01,
                  precision: 2,
                  controlsPosition: 'right',
                  class: '!w-full'
                }
              },
              {
                label: '预计残值',
                key: 'residualValue',
                type: 'number' as const,
                props: { min: 0, precision: 2, controlsPosition: 'right', class: '!w-full' }
              }
            ]
          : [
              {
                label: '资产原值',
                key: '__originalValueDisplay',
                type: 'text' as const,
                props: {
                  formatter: () => formatProtectedAmount(currentRecord.value?.originalValue)
                }
              },
              {
                label: '预计残值',
                key: '__residualValueDisplay',
                type: 'text' as const,
                props: {
                  formatter: () => formatProtectedAmount(currentRecord.value?.residualValue)
                }
              }
            ])
      )
    }

    result.push({
      label: '使用寿命',
      key: 'usefulLifeMonths',
      type: 'number',
      props: { min: 1, max: 1200, controlsPosition: 'right', class: '!w-full' }
    })

    if (canView('assetCustody')) {
      result.push(
        { label: '保管信息', key: 'custodySection', type: 'divider', span: 24 },
        canEdit('assetCustody')
          ? {
              label: '存放地点',
              key: 'location',
              type: 'input',
              props: { maxlength: 160, placeholder: '仓库、办公室或设备安装地点' }
            }
          : {
              label: '存放地点',
              key: '__locationDisplay',
              type: 'text',
              props: { formatter: () => currentRecord.value?.location || '--' }
            }
      )
    }

    result.push(
      { label: '补充说明', key: 'remarkSection', type: 'divider', span: 24 },
      {
        label: '备注',
        key: 'remark',
        type: 'input',
        span: 24,
        props: { type: 'textarea', rows: 3, maxlength: 500 }
      }
    )
    return result
  })
  async function loadCategories(accountSetId: string): Promise<void> {
    const requestId = ++categoryRequestId
    categoryOptions.value = []
    categoriesFailed.value = false
    categoriesLoading.value = Boolean(accountSetId)
    if (!accountSetId) return
    try {
      const { data, error } = await fetchAssetCategoryList(accountSetId)
      if (requestId !== categoryRequestId || accountSetId !== form.accountSetId) return
      if (error) throw error
      categoryOptions.value = (data ?? [])
        .filter((item) => item.isEnabled)
        .map((item) => ({
          label: `${item.categoryName}（${item.categoryCode}）`,
          value: item.id,
          life: item.defaultUsefulLifeMonths,
          rate: item.defaultResidualRate
        }))
    } catch {
      if (requestId === categoryRequestId) categoriesFailed.value = true
    } finally {
      if (requestId === categoryRequestId) categoriesLoading.value = false
    }
  }
  watch(
    () => form.accountSetId,
    async (value) => {
      if (!form.id) form.categoryId = ''
      if (!form.id) form.vehicleId = null
      await loadCategories(value)
      await loadVehicles()
    }
  )
  watch(
    () => form.categoryId,
    (value) => {
      const item = categoryOptions.value.find((option) => option.value === value)
      if (item && !form.id) {
        form.usefulLifeMonths = item.life
        form.residualValue = Number((Number(form.originalValue ?? 0) * item.rate).toFixed(2))
      }
    }
  )
  async function submit(): Promise<boolean> {
    if (!canSave()) return false
    try {
      if (categoriesLoading.value || categoriesFailed.value) return false
      if (!(await validateArtFormForSubmit(formRef.value))) return false
      if (!canSave()) return false
      if (
        dayjs(form.readyForUseDate).isBefore(form.acquisitionDate) ||
        dayjs(form.depreciationStartDate).isBefore(form.readyForUseDate)
      ) {
        ElMessage.warning('资产日期顺序不正确')
        return false
      }
      const payload: Api.Fms.SaveFixedAssetPayload = {
        id: form.id,
        accountSetId: form.accountSetId,
        categoryId: form.categoryId,
        assetNo: form.assetNo.trim(),
        assetName: form.assetName.trim(),
        acquisitionDate: form.acquisitionDate,
        readyForUseDate: form.readyForUseDate,
        depreciationStartDate: form.depreciationStartDate,
        usefulLifeMonths: form.usefulLifeMonths,
        ...(canEdit('assetValues')
          ? {
              originalValue: Number(form.originalValue),
              residualValue: Number(form.residualValue ?? 0)
            }
          : {}),
        ...(canEdit('assetCustody')
          ? {
              departmentId: form.departmentId || null,
              employeeId: form.employeeId || null,
              location: normalizeNullableText(form.location)
            }
          : {}),
        ...(canEdit('assetReferences')
          ? {
              specification: normalizeNullableText(form.specification),
              vehicleId: form.vehicleId || null,
              serialNo: normalizeNullableText(form.serialNo),
              sourceType: form.sourceType || null,
              sourceId: form.sourceId || null,
              sourceNo: normalizeNullableText(form.sourceNo)
            }
          : {}),
        remark: normalizeNullableText(form.remark)
      }
      await saveFixedAsset(payload)
      emit('success')
      return true
    } catch (error) {
      notifyFriendlyError(error, '固定资产保存失败，请检查内容后重试')
      return false
    }
  }
  async function handleOpen(row?: Api.Fms.FixedAssetRecord, accountSetId?: string): Promise<void> {
    if (!hasAuth(row?.id ? 'FinanceFixedAsset:Edit' : 'FinanceFixedAsset:Add')) {
      ElMessage.warning('当前账号无权新增或编辑固定资产')
      return
    }
    currentRecord.value = row
    form.id = undefined
    Object.assign(form, initial())
    const prepare = async () => {
      const { data: accountSets, error: accountSetError } = await fetchAccountSetOptions({
        status: 'active',
        from: 0,
        to: 999
      })
      if (accountSetError) throw accountSetError
      accountSetOptions.value = accountSets ?? []
      const detailResult = row ? await fetchFixedAssetDetail(row.id) : undefined
      if (detailResult?.error) throw detailResult.error
      if (row && !detailResult?.data) throw new Error('资产记录不存在，请刷新列表后重试')
      const record = detailResult?.data ?? undefined
      currentRecord.value = record
      fieldAccess.value = record?.fieldAccess ?? {}
      Object.assign(
        form,
        initial(),
        record && {
          id: record.id,
          accountSetId: record.accountSetId,
          categoryId: record.categoryId,
          assetNo: record.assetNo,
          assetName: record.assetName,
          vehicleId: canViewField(record.fieldAccess, 'assetReferences') ? record.vehicleId : null,
          acquisitionDate: record.acquisitionDate,
          readyForUseDate: record.readyForUseDate,
          depreciationStartDate: record.depreciationStartDate,
          originalValue: canEditField(record.fieldAccess, 'assetValues')
            ? (normalizeNullableNumber(record.originalValue) ?? undefined)
            : undefined,
          residualValue: canEditField(record.fieldAccess, 'assetValues')
            ? (normalizeNullableNumber(record.residualValue) ?? undefined)
            : undefined,
          usefulLifeMonths: record.usefulLifeMonths,
          departmentId: canEditField(record.fieldAccess, 'assetCustody')
            ? record.departmentId
            : null,
          employeeId: canEditField(record.fieldAccess, 'assetCustody') ? record.employeeId : null,
          location: canEditField(record.fieldAccess, 'assetCustody') ? record.location : null,
          specification: canEditField(record.fieldAccess, 'assetReferences')
            ? record.specification
            : null,
          serialNo: canEditField(record.fieldAccess, 'assetReferences') ? record.serialNo : null,
          sourceType: canEditField(record.fieldAccess, 'assetReferences')
            ? record.sourceType
            : null,
          sourceId: canEditField(record.fieldAccess, 'assetReferences') ? record.sourceId : null,
          sourceNo: canEditField(record.fieldAccess, 'assetReferences') ? record.sourceNo : null,
          remark: record.remark
        }
      )
      if (!record) {
        if (accountSetId && !accountSetOptions.value.some((item) => item.value === accountSetId)) {
          throw new Error('所选账套已不可用，请刷新列表后重试')
        }
        form.accountSetId = accountSetId ?? accountSetOptions.value[0]?.value ?? ''
      }
      if (form.accountSetId) await loadCategories(form.accountSetId)
      await loadVehicles()
    }
    await dialogRef.value?.handleOpen(undefined, {
      title: row ? `编辑资产 · ${row.assetNo}` : '新建固定资产',
      confirmText: row ? '保存修改' : '创建草稿',
      loading: true,
      loadingText: '正在加载资产与账套…',
      onConfirm: submit,
      onOpen: async () => {
        try {
          await prepare()
          formRef.value?.clearValidate()
        } catch (error) {
          notifyFriendlyError(error, '资产资料加载失败，请重新打开重试')
          dialogRef.value?.handleClose()
        } finally {
          prerequisiteOverlay.finishLoading()
        }
      },
      dialogProps: { closeOnClickModal: false }
    })
  }

  defineExpose({ handleOpen, ...prerequisiteOverlay })
</script>
