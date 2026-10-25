<template>
  <ArtDialog ref="dialogRef" size="xl" :show-footer="!readOnly">
    <div class="flex min-w-0 flex-col gap-5">
      <ArtForm
        ref="formRef"
        v-model="model"
        :items="items"
        :rules="rules"
        :disabled="readOnly"
        :span="12"
        :gutter="20"
        label-position="top"
        :show-reset="false"
        :show-submit="false"
      >
        <template #applicantEmployeeId>
          <ArtEmployeeSelect
            :model-value="model.applicantEmployeeId || undefined"
            v-model:selected-data="selectedApplicant"
            :tenant-id="model.tenantId"
            :api-fn="fetchTravelApplicantSelector"
            :disabled="readOnly"
            placeholder="选择申请人"
            @update:model-value="setApplicant"
          />
        </template>
      </ArtForm>
      <ElAlert
        v-if="!model.applicantEmployeeId"
        type="warning"
        :closable="false"
        title="当前账号未关联员工花名册，请联系管理员完成员工绑定后再填单。"
      />
      <p v-else class="px-4 text-sm text-[var(--art-gray-700)]">
        申请人公司：{{ applicantCompanyName || '待设置' }} · 费用承担公司：{{
          expenseCompanyName || '待设置'
        }}
      </p>

      <ArtSectionCard
        class="mx-4 min-w-0"
        title="行程信息"
        :subtitle="`费用合计：${formatCurrencyValue(totalAmount)} · 预计天数：${estimatedDays} 天`"
        :empty="!lines.length"
        empty-title="尚未添加行程"
        empty-description="添加出发地、目的地和行程日期后，可保存出差申请草稿。"
        :min-height="200"
      >
        <template #actions>
          <ElButton
            v-if="!readOnly"
            type="primary"
            plain
            :disabled="!model.applicantEmployeeId"
            @click="addLine"
          >
            <ArtSvgIcon icon="ri:add-line" aria-hidden="true" />
            添加行程
          </ElButton>
        </template>
        <div v-if="lines.length" class="grid gap-3 sm:grid-cols-2">
          <article
            v-for="(line, index) in lines"
            :key="line.id || index"
            class="min-w-0 rounded-[var(--art-surface-radius)] border border-[var(--el-border-color-light)] p-4"
          >
            <div class="flex min-w-0 items-start justify-between gap-2">
              <strong
                class="min-w-0 truncate"
                :title="`${line.departurePlace} → ${line.destinationPlace}`"
              >
                {{ line.departurePlace }} → {{ line.destinationPlace }}
              </strong>
              <span class="text-sm font-semibold tabular-nums">{{
                formatCurrencyValue(line.requestedAmount)
              }}</span>
            </div>
            <p class="mt-2 text-xs text-[var(--art-gray-700)]"
              >{{ line.startDate }} 至 {{ line.endDate }}</p
            >
            <div v-if="!readOnly" class="mt-3 flex justify-end">
              <BusinessTableRowActions>
                <ArtButtonTable
                  type="edit"
                  :permission="
                    model.id ? 'FinanceTravelApplication:Edit' : 'FinanceTravelApplication:Add'
                  "
                  @click="editLine(index)"
                />
                <ArtButtonTable
                  type="delete"
                  :permission="
                    model.id
                      ? 'FinanceTravelApplication:DeleteLine'
                      : 'FinanceTravelApplication:Add'
                  "
                  @click="removeLine(index)"
                />
              </BusinessTableRowActions>
            </div>
          </article>
        </div>
      </ArtSectionCard>

      <section class="px-4">
        <ArtSectionTitle>附件</ArtSectionTitle>
        <ArtUploadFile
          v-model="model.attachmentUrls"
          :disabled="readOnly"
          multiple
          :limit="8"
          :resource-tenant-id="model.tenantId"
          accept=".pdf,.doc,.docx,.xls,.xlsx,image/*"
          tip="支持文档和图片，单个文件不超过 20 MB"
        />
      </section>
    </div>
    <TravelItineraryDialog ref="itineraryDialogRef" @save="saveLine" />
    <MasterDataDeleteGuard ref="deleteGuardRef" />
  </ArtDialog>
</template>

<script setup lang="ts">
  import { ElMessage } from 'element-plus'
  import dayjs from 'dayjs'
  import { storeToRefs } from 'pinia'
  import {
    fetchEmployeeReferencesByIds,
    type EmployeeIntegrationItem
  } from '@/api/integration/employees'
  import { fetchEnabledOrganizationTree } from '@/api/system-manage'
  import { useDictionaryOptions } from '@/hooks/core/useDictionaryOptions'
  import { useTenantScopeFormPolicy } from '@/hooks/core/useTenantScopeFormPolicy'
  import { notifyFriendlyError } from '@/hooks/core/useArtFeedback'
  import { useRecordDeleteGuard } from '@/hooks/core/useRecordDeleteGuard'
  import { useAuth } from '@/hooks/core/useAuth'
  import { useTenantOperationGuard } from '@/hooks/core/useTenantOperationGuard'
  import { useArtOverlaySession } from '@/hooks/core/useArtOverlay'
  import { unref } from 'vue'
  import { getDeleteReferenceContext } from '@/utils/supabase/delete-reference'
  import { validateArtFormForSubmit } from '@/utils/form/validate-art-form'
  import { formatCurrencyValue } from '@/utils/ui'
  import { calculateDistinctTravelDays } from '@fms/utils/travel-itinerary'
  import ArtDialog from '@/components/core/dialogs/art-dialog/index.vue'
  import type { ArtDialogExpose } from '@/components/core/dialogs/art-dialog/types'
  import ArtForm, { type FormItem } from '@/components/core/forms/art-form/index.vue'
  import ArtEmployeeSelect from '@/components/business/art-employee-select/index.vue'
  import ArtSectionTitle from '@/components/core/surfaces/art-section-title/index.vue'
  import ArtSectionCard from '@/components/core/surfaces/art-section-card/index.vue'
  import ArtSvgIcon from '@/components/core/base/art-svg-icon/index.vue'
  import ArtButtonTable from '@/components/core/forms/art-button-table/index.vue'
  import BusinessTableRowActions from '@/components/business/business-table-row-actions/index.vue'
  import ArtUploadFile from '@/components/core/forms/art-upload-file/index.vue'
  import MasterDataDeleteGuard from '@/components/business/master-data-delete-guard/index.vue'
  import { useUserStore } from '@/store/modules/user'
  import {
    fetchTravelApplicationDetail,
    fetchTravelAssignmentOptions,
    fetchTravelApplicantSelector,
    saveTravelApplicationDraft,
    type TravelApplication,
    type TravelApplicationInput,
    type TravelItineraryInput
  } from '@fms/api'
  import TravelItineraryDialog from './travel-itinerary-dialog.vue'
  import { findExpenseCompany } from '../../shared/expense-company'
  import { usePrimaryAssignment } from '../../shared/use-primary-assignment'

  interface OpenData {
    row?: TravelApplication
    copy?: boolean
    readonly?: boolean
  }
  type EditableLine = TravelItineraryInput & { id?: string }
  interface ItineraryDialogExpose {
    handleOpen: (data: {
      line?: TravelItineraryInput
      tenantId: string
      applicantEmployeeId: string
      multipleTravelers: boolean
    }) => Promise<void>
  }
  type Organization = Api.SystemManage.OrganizationScopeFilterItem

  const emit = defineEmits<{ success: [] }>()
  const dialogRef = ref<ArtDialogExpose<OpenData>>()
  const { hasAuth } = useAuth()
  const captureOperation = useTenantOperationGuard('FinanceTravelApplication:View')
  const session = useArtOverlaySession(() => Boolean(unref(dialogRef.value?.visible)))
  const formRef = ref<InstanceType<typeof ArtForm>>()
  const itineraryDialogRef = ref<ItineraryDialogExpose>()
  const { deleteGuardRef, deleteRecord, inspectDeleteReferences } = useRecordDeleteGuard(
    'fms_travel_itinerary',
    '行程'
  )
  const { defaultWriteTenantId } = useTenantScopeFormPolicy()
  const userStore = useUserStore()
  const { getUserInfo } = storeToRefs(userStore)
  const travelTypeOptions = useDictionaryOptions('fmsTravelType')
  const organizations = ref<Organization[]>([])
  const selectedApplicant = ref<EmployeeIntegrationItem[]>([])
  const lines = ref<EditableLine[]>([])
  const removedLines = ref<Array<{ id: string; label: string }>>([])
  const editingLineIndex = ref<number | null>(null)
  const initial = (): TravelApplicationInput => ({
    tenantId: defaultWriteTenantId.value ?? '',
    applicantEmployeeId: getUserInfo.value.hrEmployeeId ?? '',
    assignmentId: null,
    applicationDate: dayjs().format('YYYY-MM-DD'),
    expenseDepartmentId: getUserInfo.value.hrEmployee?.organizationId ?? null,
    travelType: 'general',
    multipleTravelers: false,
    reason: '',
    remark: null,
    attachmentUrls: []
  })
  const model = ref<TravelApplicationInput>(initial())
  const readOnly = ref(false)
  const { selectPrimaryAssignment } = usePrimaryAssignment(model)
  const totalAmount = computed(() =>
    lines.value.reduce((sum, line) => sum + Number(line.requestedAmount), 0)
  )
  const estimatedDays = computed(() => calculateDistinctTravelDays(lines.value))

  const applicantCompanyName = computed(
    () =>
      findExpenseCompany(organizations.value, selectedApplicant.value[0]?.organizationId)
        ?.organizationName
  )
  const expenseCompanyName = computed(
    () => findExpenseCompany(organizations.value, model.value.expenseDepartmentId)?.organizationName
  )
  const items = computed<FormItem[]>(() => [
    { key: 'base', label: '基本信息', type: 'divider', span: 24 },
    { key: 'applicantEmployeeId', label: '申请人', type: 'input' },
    {
      key: 'assignmentId',
      label: '职位',
      type: 'select',
      params: { tenantId: model.value.tenantId, employeeId: model.value.applicantEmployeeId },
      api: () =>
        model.value.applicantEmployeeId
          ? fetchTravelAssignmentOptions(model.value.tenantId, model.value.applicantEmployeeId)
          : Promise.resolve({ data: [], error: null }),
      resultField: 'data',
      labelField: 'businessTitle',
      valueField: 'id',
      props: { clearable: true, placeholder: '默认主职；可切换兼职职位' }
    },
    {
      key: 'applicationDate',
      label: '申请日期',
      type: 'date',
      props: { type: 'date', valueFormat: 'YYYY-MM-DD' }
    },
    {
      key: 'expenseDepartmentId',
      label: '费用承担部门',
      type: 'treeSelect',
      api: () => fetchEnabledOrganizationTree({ tenantId: model.value.tenantId }),
      resultField: 'data',
      labelField: 'organizationName',
      valueField: 'id',
      childrenField: 'children',
      props: { checkStrictly: true, placeholder: '选择费用承担部门' }
    },
    { key: 'travelType', label: '出差类型', type: 'select', props: { options: travelTypeOptions } },
    { key: 'multipleTravelers', label: '多出差人', type: 'switch' },
    {
      key: 'reason',
      label: '事由',
      type: 'input',
      span: 24,
      props: { type: 'textarea', rows: 2, maxlength: 500, showWordLimit: true }
    },
    {
      key: 'remark',
      label: '备注',
      type: 'input',
      span: 24,
      props: { type: 'textarea', rows: 2, maxlength: 500, showWordLimit: true }
    }
  ])
  const rules = {
    applicantEmployeeId: [{ required: true, message: '请选择申请人', trigger: 'change' }],
    applicationDate: [{ required: true, message: '请选择申请日期', trigger: 'change' }],
    expenseDepartmentId: [{ required: true, message: '请选择费用承担部门', trigger: 'change' }],
    reason: [{ required: true, message: '请输入出差事由', trigger: 'blur' }]
  }

  function setApplicant(id: string | undefined): void {
    model.value.applicantEmployeeId = id ?? ''
    model.value.assignmentId = null
    const organizationId = selectedApplicant.value[0]?.organizationId
    if (organizationId) model.value.expenseDepartmentId = organizationId
    void selectPrimaryAssignment()
  }
  function addLine(): void {
    if (readOnly.value) return
    editingLineIndex.value = null
    void itineraryDialogRef.value?.handleOpen({
      tenantId: model.value.tenantId,
      applicantEmployeeId: model.value.applicantEmployeeId,
      multipleTravelers: model.value.multipleTravelers
    })
  }
  function editLine(index: number): void {
    if (readOnly.value) return
    editingLineIndex.value = index
    void itineraryDialogRef.value?.handleOpen({
      line: lines.value[index],
      tenantId: model.value.tenantId,
      applicantEmployeeId: model.value.applicantEmployeeId,
      multipleTravelers: model.value.multipleTravelers
    })
  }
  function saveLine(line: TravelItineraryInput): void {
    if (readOnly.value) return
    if (editingLineIndex.value === null) lines.value.push(line)
    else
      lines.value.splice(editingLineIndex.value, 1, {
        ...line,
        id: lines.value[editingLineIndex.value]?.id
      })
    editingLineIndex.value = null
  }
  async function removeLine(index: number): Promise<void> {
    if (readOnly.value) return
    const line = lines.value[index]
    if (!line) return
    if (!line.id) {
      lines.value.splice(index, 1)
      return
    }
    await deleteRecord({
      resource: { id: line.id, label: `${line.departurePlace} → ${line.destinationPlace}` },
      permission: 'FinanceTravelApplication:DeleteLine',
      confirmMessage: '从草稿中移除此行程？保存申请单后生效。',
      remove: async () => {
        removedLines.value.push({
          id: line.id!,
          label: `${line.departurePlace} → ${line.destinationPlace}`
        })
        lines.value.splice(index, 1)
      }
    })
  }

  async function handleOpen(data: OpenData = {}): Promise<void> {
    const scopeCurrent = captureOperation()
    const version = session.invalidate()
    const permissions = data.readonly
      ? ['FinanceTravelApplication:View']
      : data.copy
        ? ['FinanceTravelApplication:Add', 'FinanceTravelApplication:Copy']
        : [data.row ? 'FinanceTravelApplication:Edit' : 'FinanceTravelApplication:Add']
    const contextCurrent = () =>
      scopeCurrent() &&
      session.version.value === version &&
      permissions.every((permission) => hasAuth(permission))
    if (!contextCurrent()) return
    const isCurrent = () => contextCurrent() && session.isCurrent(version)
    try {
      const detail = data.row ? (await fetchTravelApplicationDetail(data.row.id)).data : null
      if (!contextCurrent()) return
      if (data.row && !detail) throw new Error('出差申请已变化，请刷新后重试')
      if (detail && !data.copy && !data.readonly && !['draft', 'rejected'].includes(detail.status))
        throw new Error('当前出差申请状态不可编辑，请刷新后查看')
      readOnly.value = Boolean(data.readonly)
      model.value = detail
        ? {
            id: data.copy ? undefined : detail.id,
            copySourceId: data.copy ? detail.id : undefined,
            tenantId: detail.tenantId,
            applicantEmployeeId: detail.applicantEmployeeId,
            assignmentId: detail.assignmentId,
            applicationDate: data.copy ? dayjs().format('YYYY-MM-DD') : detail.applicationDate,
            expenseDepartmentId: detail.expenseDepartmentId,
            travelType: detail.travelType,
            multipleTravelers: detail.multipleTravelers,
            reason: detail.reason,
            remark: detail.remark,
            attachmentUrls: detail.attachmentUrls
          }
        : initial()
      lines.value = (detail?.itineraries ?? []).map((line) => ({
        id: data.copy ? undefined : line.id,
        departureRegionPath: line.departureRegionPath,
        departurePlace: line.departurePlace,
        destinationRegionPath: line.destinationRegionPath,
        destinationPlace: line.destinationPlace,
        startDate: line.startDate,
        endDate: line.endDate,
        transportModes: line.transportModes,
        travelerEmployeeIds: line.travelerEmployeeIds,
        expenseItemId: line.expenseItemId,
        projectId: line.projectId,
        requestedAmount: line.requestedAmount,
        remark: line.remark
      }))
      removedLines.value = []
      const applicantReferences = detail
        ? [
            {
              id: detail.applicantEmployeeId,
              tenantId: detail.tenantId,
              employeeNo: detail.applicantEmployeeNo,
              employeeName: detail.applicantName,
              organizationId: detail.applicantOrganizationId,
              avatarUrl: detail.applicantAvatarUrl,
              jobTitle: detail.positionName,
              employmentStatus: ''
            }
          ]
        : model.value.applicantEmployeeId
          ? await fetchEmployeeReferencesByIds(model.value.tenantId, [
              model.value.applicantEmployeeId
            ])
          : []
      if (!contextCurrent()) return
      selectedApplicant.value = applicantReferences
      await selectPrimaryAssignment()
      if (!contextCurrent()) return
      const organizationsResult = await fetchEnabledOrganizationTree({
        tenantId: model.value.tenantId
      })
      if (!contextCurrent()) return
      organizations.value = organizationsResult.data ?? []
      await dialogRef.value?.handleOpen(data, {
        title: detail
          ? `${data.readonly ? '查看' : data.copy ? '复制' : '编辑'}出差申请 · ${detail.applicationNo}`
          : '新增出差申请',
        subtitle: '登记出差行程与预算，提交审批后锁定内容；通过后可关联差旅报销。',
        confirmText: '保存草稿',
        onOpen: () => formRef.value?.clearValidate(),
        onClose: () => {
          session.invalidate()
        },
        onConfirm: async () => {
          if (readOnly.value) return false
          if (!isCurrent()) {
            ElMessage.warning('操作范围或权限已变化，请重新打开出差申请')
            return false
          }
          try {
            if (!(await validateArtFormForSubmit(formRef.value))) return false
            if (!isCurrent()) return false
            if (!applicantCompanyName.value || !expenseCompanyName.value) {
              notifyFriendlyError(
                new Error('公司信息未配置'),
                '申请人或费用承担公司为空，请联系管理员设置组织'
              )
              return false
            }
            await saveTravelApplicationDraft(model.value, lines.value)
            if (!isCurrent()) return false
            ElMessage.success(data.copy ? '出差申请已复制为新草稿' : '出差申请草稿已保存')
            emit('success')
            return true
          } catch (error) {
            if (!isCurrent()) return false
            if (
              removedLines.value.length &&
              (await inspectDeleteReferences(
                removedLines.value,
                getDeleteReferenceContext(error)?.constraint
              ))
            ) {
              return false
            }
            if (isCurrent())
              notifyFriendlyError(error, '出差申请保存失败，请核对员工、费用项目和行程后重试')
            return false
          }
        }
      })
    } catch (error) {
      if (!contextCurrent()) return
      notifyFriendlyError(error, '出差申请加载失败，请刷新列表后重试')
    }
  }
  defineExpose({ handleOpen })
</script>
