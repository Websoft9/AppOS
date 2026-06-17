import { useEffect, useState } from 'react'
import { Bot } from 'lucide-react'
import { createFileRoute } from '@tanstack/react-router'
import { AssetFamilyPage } from '@/components/assets/AssetFamilyPage'
import { IconBreadcrumb } from '@/components/layout/IconBreadcrumb'
import { useOptionalLayout } from '@/contexts/LayoutContext'

export function AssetsPromptsPage() {
  const [queryState, setQueryState] = useState({ q: '', page: 1 })
  const layout = useOptionalLayout()
  const setHeaderRightStartContent = layout?.setHeaderRightStartContent

  useEffect(() => {
    if (!setHeaderRightStartContent) return undefined
    setHeaderRightStartContent(
      <IconBreadcrumb
        icon={<Bot className="h-4 w-4" />}
        parentLabel="Assets"
        parentHref="/ai-assets"
        currentPage="AI Prompts"
      />
    )
    return () => setHeaderRightStartContent(null)
  }, [setHeaderRightStartContent])

  return (
    <AssetFamilyPage
      kind="prompt"
      title="AI Prompts"
      description="Reusable system prompts for AI Copilot and operators."
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