export type RecordMeta = {
  id: string
  created?: string
  updated?: string
}

export type ResourceConfig = Record<string, unknown>

export type AccessResourceRecord = RecordMeta & {
  name?: string
  kind?: string
  is_enabled?: boolean
  template_id?: string
  endpoint?: string
  auth_scheme?: string
  provider_account?: string
  credential?: string
  config?: ResourceConfig
  description?: string
}

export type ResourceTemplateField = {
  id: string
  label: string
  type: string
  required?: boolean
  advanced?: boolean
  secretTemplate?: string
  placeholder?: string
  helpUrl?: string
  helpText?: string
  default?: unknown
  options?: Array<{ label: string; value: string }>
  showWhen?: { field: string; values: string[] }
}

export type ResourceTemplateBase<TField extends ResourceTemplateField = ResourceTemplateField> = {
  id: string
  kind: string
  title: string
  vendor?: string
  category?: string
  description?: string
  helpUrl?: string
  defaultEndpoint?: string
  defaultEndpointTls?: string
  defaultAuthScheme?: string
  authPresentation?: string
  endpointShape?: string
  endpointScheme?: string
  fields?: TField[]
}

export type ResourceSaveInput = {
  name: string
  kind: string
  is_enabled?: boolean
  template_id: string
  endpoint?: string
  auth_scheme?: string
  provider_account?: string
  credential?: string
  config?: ResourceConfig
  description?: string
}
