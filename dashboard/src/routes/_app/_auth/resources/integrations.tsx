import { createFileRoute } from "@tanstack/react-router"
import { Badge } from "@/components/ui/badge"
import {
  ResourcePage,
  type Column,
  type FieldDef,
} from "@/components/resources/ResourcePage"

const columns: Column[] = [
  { key: "name", label: "Name" },
  {
    key: "type",
    label: "Type",
    render: (v) => <Badge variant="outline">{String(v || "—").toUpperCase()}</Badge>,
  },
  { key: "url", label: "URL", render: (v) => (
    <span className="max-w-[200px] truncate block" title={String(v || "")}>{String(v || "—")}</span>
  ) },
  {
    key: "auth_type",
    label: "Auth",
    render: (v) => <Badge variant="secondary">{String(v || "none")}</Badge>,
  },
]

const fields: FieldDef[] = [
  { key: "name", label: "Name", type: "text", required: true, placeholder: "my-webhook" },
  {
    key: "type",
    label: "Type",
    type: "select",
    required: true,
    options: [
      { label: "REST API", value: "rest" },
      { label: "Webhook", value: "webhook" },
      { label: "MCP", value: "mcp" },
    ],
  },
  { key: "url", label: "URL", type: "text", required: true, placeholder: "https://api.example.com/v1" },
  {
    key: "auth_type",
    label: "Auth Type",
    type: "select",
    required: true,
    options: [
      { label: "None", value: "none" },
      { label: "API Key", value: "api_key" },
      { label: "Bearer Token", value: "bearer" },
      { label: "Basic Auth", value: "basic" },
    ],
    onValueChange: (v, update) => {
      if (v === "none") update("credential", "")
    },
  },
  {
    key: "credential",
    label: "Credential (Secret)",
    type: "relation",
    relationApiPath: "/api/ext/resources/secrets",
    showWhen: { field: "auth_type", values: ["api_key", "bearer", "basic"] },
    relationCreate: {
      label: "New Secret",
      apiPath: "/api/ext/resources/secrets",
      fields: [
        { key: "name", label: "Name", type: "text", required: true, placeholder: "api-token" },
        {
          key: "type",
          label: "Type",
          type: "select",
          required: true,
          options: [
            { label: "API Key", value: "api_key" },
            { label: "Token", value: "token" },
            { label: "Password", value: "password" },
          ],
        },
        { key: "value", label: "Value", type: "password", required: true },
        { key: "description", label: "Description (optional)", type: "text" },
      ],
    },
  },
  { key: "extra", label: "Extra Config (JSON)", type: "textarea", placeholder: '{"headers": {"X-Custom": "value"}}' },
  { key: "description", label: "Description", type: "textarea" },
  {
    key: "groups",
    label: "Groups",
    type: "relation",
    multiSelect: true,
    relationAutoSelectDefault: true,
    relationApiPath: "/api/ext/resources/groups",
    relationLabelKey: "name",
    defaultValue: [],
  },
]

function IntegrationsPage() {
  const autoCreate = new URLSearchParams(window.location.search).get("create") === "1"
  return (
    <ResourcePage
      config={{
        title: "Integrations",
        description: "External API endpoints, webhooks, and MCP servers",
        apiPath: "/api/ext/resources/integrations",
        columns,
        fields,
        parentNav: { label: "Resources", href: "/resources" },
        autoCreate,
        enableGroupAssign: true,
      }}
    />
  )
}

export const Route = createFileRoute("/_app/_auth/resources/integrations")({
  component: IntegrationsPage,
})
