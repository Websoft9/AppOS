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
  { key: "host", label: "Host" },
  { key: "port", label: "Port" },
  { key: "db_name", label: "Database" },
]

const fields: FieldDef[] = [
  { key: "name", label: "Name", type: "text", required: true, placeholder: "prod-mysql" },
  {
    key: "type",
    label: "Type",
    type: "select",
    required: true,
    options: [
      { label: "MySQL", value: "mysql" },
      { label: "PostgreSQL", value: "postgres" },
      { label: "Redis", value: "redis" },
      { label: "MongoDB", value: "mongodb" },
    ],
    // Auto-fill default port when DB type changes
    onValueChange: (v, update) => {
      const defaults: Record<string, number> = { mysql: 3306, postgres: 5432, redis: 6379, mongodb: 27017 }
      const port = defaults[String(v)]
      if (port) update("port", port)
    },
  },
  { key: "host", label: "Host", type: "text", placeholder: "db.example.com" },
  { key: "port", label: "Port", type: "number", placeholder: "3306" },
  { key: "db_name", label: "Database Name", type: "text", placeholder: "myapp" },
  { key: "user", label: "User", type: "text", placeholder: "admin" },
  {
    key: "password",
    label: "Password (Secret)",
    type: "relation",
    relationApiPath: "/api/ext/resources/secrets",
    relationFilter: { type: "password" },
    relationCreate: {
      label: "New Password Secret",
      apiPath: "/api/ext/resources/secrets",
      fields: [
        { key: "name", label: "Name", type: "text", required: true, placeholder: "db-mysql-password" },
        { key: "type", type: "text", label: "Type", hidden: true, defaultValue: "password" },
        { key: "value", label: "Password", type: "password", required: true },
        { key: "description", label: "Description (optional)", type: "text" },
      ],
    },
  },
  { key: "description", label: "Description", type: "textarea" },
]

function DatabasesPage() {
  const autoCreate = new URLSearchParams(window.location.search).get("create") === "1"
  return (
    <ResourcePage
      config={{
        title: "Databases",
        description: "External database connections",
        apiPath: "/api/ext/resources/databases",
        columns,
        fields,
        parentNav: { label: "Resources", href: "/resources" },
        autoCreate,
      }}
    />
  )
}

export const Route = createFileRoute("/_app/_auth/resources/databases")({
  component: DatabasesPage,
})
