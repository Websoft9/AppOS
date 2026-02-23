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
    render: (v) => <Badge variant="outline">{String(v || "—")}</Badge>,
  },
  { key: "description", label: "Description" },
]

const fields: FieldDef[] = [
  { key: "name", label: "Name", type: "text", required: true, placeholder: "db-password" },
  {
    key: "type",
    label: "Type",
    type: "select",
    required: true,
    options: [
      { label: "Password", value: "password" },
      { label: "Username + Password", value: "username_password" },
      { label: "API Key", value: "api_key" },
      { label: "Token", value: "token" },
      { label: "SSH Key", value: "ssh_key" },
    ],
  },
  {
    key: "username",
    label: "Username",
    type: "text",
    placeholder: "admin",
    showWhen: { field: "type", values: ["username_password"] },
  },
  {
    key: "value",
    label: "Password / Value",
    type: "password",
    placeholder: "Enter secret value",
    // SSH keys: switch to multi-line textarea with file upload
    dynamicType: { field: "type", values: ["ssh_key"], as: "file-textarea" },
    fileAccept: ".pem,.key,.txt",
  },
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

function SecretsPage() {
  const autoCreate = new URLSearchParams(window.location.search).get("create") === "1"
  return (
    <ResourcePage
      config={{
        title: "Secrets",
        description: "Encrypted credentials, tokens, and keys",
        apiPath: "/api/ext/resources/secrets",
        columns,
        fields,
        parentNav: { label: "Resources", href: "/resources" },
        autoCreate,
        enableGroupAssign: true,
      }}
    />
  )
}

export const Route = createFileRoute("/_app/_auth/resources/secrets")({
  component: SecretsPage,
})
