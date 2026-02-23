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
    key: "language",
    label: "Language",
    render: (v) => <Badge variant="outline">{String(v || "—")}</Badge>,
  },
  {
    key: "description",
    label: "Description",
    render: (v) => (
      <span className="max-w-[240px] truncate block text-muted-foreground" title={String(v || "")}>
        {String(v || "—")}
      </span>
    ),
  },
]

const fields: FieldDef[] = [
  { key: "name", label: "Name", type: "text", required: true, placeholder: "backup-db" },
  {
    key: "language",
    label: "Language",
    type: "select",
    required: true,
    options: [
      { label: "Bash", value: "bash" },
      { label: "Python 3", value: "python3" },
    ],
  },
  { key: "code", label: "Code", type: "textarea", required: true, placeholder: "#!/bin/bash\necho 'hello'" },
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

function ScriptsPage() {
  const autoCreate = new URLSearchParams(window.location.search).get("create") === "1"
  return (
    <ResourcePage
      config={{
        title: "Scripts",
        description: "Reusable automation scripts",
        apiPath: "/api/ext/resources/scripts",
        columns,
        fields,
        parentNav: { label: "Resources", href: "/resources" },
        autoCreate,
        enableGroupAssign: true,
      }}
    />
  )
}

export const Route = createFileRoute("/_app/_auth/resources/scripts")({
  component: ScriptsPage,
})
