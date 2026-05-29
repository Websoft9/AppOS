import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { AssetFamilyPage } from '@/components/assets/AssetFamilyPage'

export function AssetsScriptsPage() {
  const [queryState, setQueryState] = useState({ q: '', page: 1 })

  return (
    <AssetFamilyPage
      kind="script"
      title="Scripts"
      description="Reusable single-file assets for terminal snippets, operator workflows, and recovery actions."
      createLabel="Add Script"
      showHeaderCount={false}
      hideDescriptionBelowSm
      queryState={queryState}
      onQueryStateChange={patch => setQueryState(current => ({ ...current, ...patch }))}
    />
  )
}

export const Route = createFileRoute('/_app/_auth/_superuser/ai-assets/scripts' as never)({ component: AssetsScriptsPage })