import { createFileRoute } from '@tanstack/react-router'
import { Badge } from '@/components/ui/badge'
import { ResourcePage, type Column, type FieldDef } from '@/components/resources/ResourcePage'

const columns: Column[] = [
  { key: 'name', label: 'Name' },
  {
    key: 'language',
    label: 'Language',
    render: v => <Badge variant="outline">{String(v || '—')}</Badge>,
  },
  {
    key: 'description',
    label: 'Description',
    render: v => (
      <span className="block max-w-[240px] truncate text-muted-foreground" title={String(v || '')}>
        {String(v || '—')}
      </span>
    ),
  },
]

const fields: FieldDef[] = [
  { key: 'name', label: 'Name', type: 'text', required: true, placeholder: 'backup-db' },
  {
    key: 'language',
    label: 'Language',
    type: 'select',
    required: true,
    options: [
      { label: 'Bash', value: 'bash' },
      { label: 'Python 3', value: 'python3' },
    ],
  },
  {
    key: 'code',
    label: 'Code',
    type: 'textarea',
    required: true,
    placeholder: "#!/bin/bash\necho 'hello'",
  },
  { key: 'description', label: 'Description', type: 'textarea' },
  {
    key: 'groups',
    label: 'Groups',
    type: 'relation',
    multiSelect: true,
    relationAutoSelectDefault: true,
    relationApiPath: '/api/collections/groups/records?perPage=500&sort=name',
    relationLabelKey: 'name',
    defaultValue: [],
  },
]

function AssetsScriptsPage() {
  const autoCreate = new URLSearchParams(window.location.search).get('create') === '1'
  return (
    <ResourcePage
      config={{
        title: 'Scripts',
        description: 'Reusable automation scripts',
        apiPath: '/api/ext/resources/scripts',
        columns,
        fields,
        resourceType: 'script',
        parentNav: { label: 'Assets', href: '/assets' },
        autoCreate,
        enableGroupAssign: true,
      }}
    />
  )
}

export const Route = createFileRoute('/_app/_auth/_superuser/assets/scripts')({
  component: AssetsScriptsPage,
})