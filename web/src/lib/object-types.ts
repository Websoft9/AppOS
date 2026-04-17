/**
 * Shared object-type definitions for Groups (group_items.object_type).
 *
 * This is the single source of truth for valid object_type values.
 * The backend stores them as plain text; validation lives here.
 */

export interface ObjectTypeDef {
  /** Value stored in group_items.object_type */
  type: string
  /** Display name for UI */
  label: string
  /** PocketBase collection to query when resolving object_id */
  collection: string
  /** Field used as the item Name column */
  nameField: string
  /** Field shown in the Summary column (undefined → show '—') */
  summaryField?: string
  /** TanStack Router path template; $id is replaced with object_id */
  detailRoute: string
  /** If set, link to list page with this search key instead of detail route (for types without a detail page) */
  listSearchKey?: string
  /** Route to navigate to when creating a new object of this type (shown in empty state) */
  createRoute?: string
}

export const OBJECT_TYPES: ObjectTypeDef[] = [
  {
    type: 'app',
    label: 'App',
    collection: 'apps',
    nameField: 'name',
    summaryField: 'status',
    detailRoute: '/apps/$id',
  },
  {
    type: 'server',
    label: 'Server',
    collection: 'servers',
    nameField: 'name',
    summaryField: 'ip',
    detailRoute: '/servers/$id',
    createRoute: '/resources/servers',
  },
  {
    type: 'topic',
    label: 'Topic',
    collection: 'topics',
    nameField: 'title',
    detailRoute: '/topics/$id',
    createRoute: '/topics',
  },
  {
    type: 'secret',
    label: 'Secret',
    collection: 'secrets',
    nameField: 'name',
    summaryField: 'type',
    detailRoute: '/secrets',
    listSearchKey: 'id',
    createRoute: '/secrets',
  },
  {
    type: 'env_set',
    label: 'Shared Env',
    collection: 'env_sets',
    nameField: 'name',
    summaryField: undefined,
    detailRoute: '/resources/shared-envs',
  },
  {
    type: 'instance',
    label: 'Service Instance',
    collection: 'instances',
    nameField: 'name',
    summaryField: 'kind',
    detailRoute: '/resources/service-instances',
    listSearchKey: 'id',
    createRoute: '/resources/service-instances',
  },
  {
    type: 'ai_provider',
    label: 'AI Provider',
    collection: 'ai_providers',
    nameField: 'name',
    summaryField: 'template_id',
    detailRoute: '/resources/ai-providers',
    listSearchKey: 'id',
    createRoute: '/resources/ai-providers',
  },
  {
    type: 'provider_account',
    label: 'Platform Account',
    collection: 'provider_accounts',
    nameField: 'name',
    summaryField: 'kind',
    detailRoute: '/resources/platform-accounts',
    listSearchKey: 'id',
    createRoute: '/resources/platform-accounts',
  },
  {
    type: 'certificate',
    label: 'Certificate',
    collection: 'certificates',
    nameField: 'domain',
    summaryField: 'expires',
    detailRoute: '/certificates/$id',
  },
  {
    type: 'connector',
    label: 'Connector',
    collection: 'connectors',
    nameField: 'name',
    summaryField: 'kind',
    detailRoute: '/resources/connectors',
    listSearchKey: 'id',
    createRoute: '/resources/connectors',
  },
  {
    type: 'script',
    label: 'Script',
    collection: 'scripts',
    nameField: 'name',
    summaryField: undefined,
    detailRoute: '/scripts/$id',
  },
]

/** Lookup map by type string */
export const OBJECT_TYPE_MAP = Object.fromEntries(OBJECT_TYPES.map(t => [t.type, t])) as Record<
  string,
  ObjectTypeDef
>

/** Get label for a type, falling back to the raw value */
export function getObjectTypeLabel(type: string): string {
  return OBJECT_TYPE_MAP[type]?.label ?? type
}
