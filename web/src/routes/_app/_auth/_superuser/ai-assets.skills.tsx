import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { AssetFamilyPage } from '@/components/assets/AssetFamilyPage'

export function AssetsSkillsPage() {
  const [queryState, setQueryState] = useState({ q: '', page: 1 })

  return (
    <AssetFamilyPage
      kind="skill"
      title="AI Skills"
      description="Bundled skill packages with structured files, entrypoints, and reusable guidance content."
      createLabel="Add Skill"
      showHeaderCount={false}
      queryState={queryState}
      onQueryStateChange={patch => setQueryState(current => ({ ...current, ...patch }))}
    />
  )
}

export const Route = createFileRoute('/_app/_auth/_superuser/ai-assets/skills' as never)({ component: AssetsSkillsPage })