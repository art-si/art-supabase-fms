import TreeUtils from '@/utils/tree'

type Organization = Api.SystemManage.OrganizationScopeFilterItem

const organizationTreeUtils = new TreeUtils({
  idKey: 'id',
  parentKey: 'parentId',
  childrenKey: 'children'
})

export function findExpenseCompany(
  organizations: Organization[],
  organizationId: string | null | undefined
): Organization | null {
  if (!organizationId) return null
  const ancestors = organizationTreeUtils.getAncestors(organizations, organizationId)
  return ancestors.reverse().find((item) => item.organizationType === 'company') ?? null
}
