import { createFileRoute } from "@tanstack/react-router"
import { Badge } from "@/components/ui/badge"
import {
  ResourcePage,
  type Column,
  type FieldDef,
} from "@/components/resources/ResourcePage"

const columns: Column[] = [
  { key: "name", label: "Name" },
  { key: "host", label: "Host" },
  { key: "port", label: "Port" },
  { key: "user", label: "User" },
  {
    key: "auth_type",
    label: "Auth Type",
    render: (v) => <Badge variant="outline">{String(v || "—")}</Badge>,
  },
]

const fields: FieldDef[] = [
  { key: "name", label: "Name", type: "text", required: true, placeholder: "my-server" },
  { key: "host", label: "Host", type: "text", required: true, placeholder: "192.168.1.1" },
  { key: "port", label: "Port", type: "number", defaultValue: 22 },
  { key: "user", label: "User", type: "text", placeholder: "root" },
  {
    key: "auth_type",
    label: "Auth Type",
    type: "select",
    options: [
      { label: "Password", value: "password" },
      { label: "SSH Key", value: "key" },
    ],
  },
  {
    key: "credential",
    label: "Credential (Secret)",
    type: "relation",
    relationApiPath: "/api/ext/resources/secrets",
    relationCreate: {
      label: "New Credential Secret",
      apiPath: "/api/ext/resources/secrets",
      fields: [
        { key: "name", label: "Name", type: "text", required: true, placeholder: "my-server-cred" },
        {
          key: "type",
          label: "Type",
          type: "select",
          required: true,
          options: [
            { label: "Password", value: "password" },
            { label: "Username + Password", value: "username_password" },
            { label: "SSH Key", value: "ssh_key" },
          ],
        },
        {
          key: "username",
          label: "Username",
          type: "text",
          placeholder: "root",
          showWhen: { field: "type", values: ["username_password"] },
        },
        {
          key: "value",
          label: "Password / Key",
          type: "password",
          required: true,
          dynamicType: { field: "type", values: ["ssh_key"], as: "file-textarea" },
          fileAccept: ".pem,.key,.txt",
        },
        { key: "description", label: "Description (optional)", type: "text" },
      ],
    },
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

function ServersPage() {
  const autoCreate = new URLSearchParams(window.location.search).get("create") === "1"
  return (
    <ResourcePage
      config={{
        title: "Servers",
        description: "SSH deployment targets",
        apiPath: "/api/ext/resources/servers",
        columns,
        fields,
        parentNav: { label: "Resources", href: "/resources" },
        autoCreate,
        enableGroupAssign: true,
      }}
    />
  )
}

export const Route = createFileRoute("/_app/_auth/resources/servers")({
  component: ServersPage,
})
