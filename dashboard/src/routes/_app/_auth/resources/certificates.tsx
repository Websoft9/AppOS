import { createFileRoute } from "@tanstack/react-router"
import { Badge } from "@/components/ui/badge"
import {
  ResourcePage,
  type Column,
  type FieldDef,
} from "@/components/resources/ResourcePage"

const columns: Column[] = [
  { key: "name", label: "Name" },
  { key: "domain", label: "Domain" },
  {
    key: "auto_renew",
    label: "Auto Renew",
    render: (v) => (
      <Badge variant={v ? "default" : "secondary"}>{v ? "Yes" : "No"}</Badge>
    ),
  },
  {
    key: "expires_at",
    label: "Expires",
    render: (v) =>
      v ? new Date(String(v)).toLocaleDateString() : <span className="text-muted-foreground">—</span>,
  },
]

const fields: FieldDef[] = [
  { key: "name", label: "Name", type: "text", required: true, placeholder: "wildcard-cert" },
  { key: "domain", label: "Domain", type: "text", required: true, placeholder: "*.example.com" },
  {
    key: "cert_pem",
    label: "Full Certificate Chain (fullchain.pem)",
    type: "file-textarea",
    fileAccept: ".pem,.crt,.cer,.txt",
    placeholder: "-----BEGIN CERTIFICATE-----",
  },
  {
    key: "key",
    label: "Private Key (privkey.pem)",
    type: "relation",
    relationApiPath: "/api/ext/resources/secrets",
    relationFilter: { type: "ssh_key" },
    relationCreate: {
      label: "New Private Key Secret",
      apiPath: "/api/ext/resources/secrets",
      fields: [
        { key: "name", label: "Name", type: "text", required: true, placeholder: "example.com-privkey" },
        { key: "type", type: "text", label: "Type", hidden: true, defaultValue: "ssh_key" },
        {
          key: "value",
          label: "Private Key (PEM)",
          type: "file-textarea",
          fileAccept: ".pem,.key,.txt",
          required: true,
          placeholder: "-----BEGIN PRIVATE KEY-----",
        },
        { key: "description", label: "Description (optional)", type: "text" },
      ],
    },
  },
  { key: "auto_renew", label: "Auto Renew", type: "boolean", defaultValue: false },
  { key: "expires_at", label: "Expires At", type: "text", placeholder: "2025-12-31" },
  { key: "description", label: "Description", type: "textarea" },
]

function CertificatesPage() {
  const autoCreate = new URLSearchParams(window.location.search).get("create") === "1"
  return (
    <ResourcePage
      config={{
        title: "Certificates",
        description: "TLS certificates and keys",
        apiPath: "/api/ext/resources/certificates",
        columns,
        fields,
        parentNav: { label: "Resources", href: "/resources" },
        autoCreate,
      }}
    />
  )
}

export const Route = createFileRoute("/_app/_auth/resources/certificates")({
  component: CertificatesPage,
})
