import type { TagProps } from 'element-plus'

const statuses: Record<string, { label: string; type: TagProps['type'] }> = {
  pending: { label: '待接单', type: 'info' },
  accepted: { label: '已接单', type: 'primary' },
  loading: { label: '装货中', type: 'warning' },
  transporting: { label: '运输中', type: 'primary' },
  unloading: { label: '卸货中', type: 'warning' },
  signed: { label: '已签收', type: 'success' },
  completed: { label: '已完成', type: 'success' },
  cancelled: { label: '已取消', type: 'danger' }
}

export const getWaybillStatusPresentation = (status: string) =>
  statuses[status] ?? { label: '未知状态', type: 'info' as const }
