import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { AssetFamilyPage } from '@/components/assets/AssetFamilyPage'

export function AssetsPromptsPage() {
  const [queryState, setQueryState] = useState({ q: '', page: 1 })

  return (
    <AssetFamilyPage
      kind="prompt"
      title="AI Prompts"
      description="Reusable prompts for Copilot and operators."
      createLabel="Add Prompt"
      showHeaderCount={false}
      queryState={queryState}
      onQueryStateChange={patch => setQueryState(current => ({ ...current, ...patch }))}
    />
  )
}

export const Route = createFileRoute('/_app/_auth/_superuser/ai-assets/prompts' as never)({
  component: AssetsPromptsPage,
})