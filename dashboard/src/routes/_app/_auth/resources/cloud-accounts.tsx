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
    key: "provider",
    label: "Provider",
    render: (v) => <Badge variant="outline">{String(v || "—").toUpperCase()}</Badge>,
  },
  { key: "region", label: "Region" },
  { key: "access_key_id", label: "Access Key ID" },
]

const fields: FieldDef[] = [
  { key: "name", label: "Name", type: "text", required: true, placeholder: "aws-prod" },
  {
    key: "provider",
    label: "Provider",
    type: "select",
    required: true,
    options: [
      { label: "AWS", value: "aws" },
      { label: "Aliyun", value: "aliyun" },
      { label: "Azure", value: "azure" },
      { label: "GCP", value: "gcp" },
    ],
  },
  { key: "access_key_id", label: "Access Key ID / Client ID", type: "text", placeholder: "AKIAIOSFODNN7EXAMPLE" },
  {
    key: "secret",
    label: "Secret Credential",
    type: "relation",
    relationApiPath: "/api/ext/resources/secrets",
    relationCreate: {
      label: "New Secret",
      apiPath: "/api/ext/resources/secrets",
      fields: [
        { key: "name", label: "Name", type: "text", required: true, placeholder: "aws-secret-key" },
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
  { key: "region", label: "Region", type: "text", placeholder: "us-east-1 (optional)" },
  { key: "extra", label: "Extra Config (JSON)", type: "textarea", placeholder: "{\"tenant_id\": \"…\"}" },
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

function CloudAccountsPage() {
  const autoCreate = new URLSearchParams(window.location.search).get("create") === "1"
  return (
    <ResourcePage
      config={{
        title: "Cloud Accounts",
        description: "Cloud provider credentials",
        apiPath: "/api/ext/resources/cloud-accounts",
        columns,
        fields,
        parentNav: { label: "Resources", href: "/resources" },
        autoCreate,
        enableGroupAssign: true,
      }}
    />
  )
}

export const Route = createFileRoute("/_app/_auth/resources/cloud-accounts")({
  component: CloudAccountsPage,
})
