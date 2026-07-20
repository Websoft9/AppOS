import { useEffect, useState } from 'react'
import { ScrollText } from 'lucide-react'
import { createFileRoute } from '@tanstack/react-router'
import { AssetFamilyPage } from '@/components/assets/AssetFamilyPage'
import { IconBreadcrumb } from '@/components/layout/IconBreadcrumb'
import { useOptionalLayout } from '@/contexts/LayoutContext'

export function AssetsSkillsPage() {
  const [queryState, setQueryState] = useState({ q: '', page: 1 })
  const layout = useOptionalLayout()
  const setHeaderRightStartContent = layout?.setHeaderRightStartContent

  useEffect(() => {
    if (!setHeaderRightStartContent) return undefined
    setHeaderRightStartContent(
      <IconBreadcrumb
        icon={<ScrollText className="h-4 w-4" />}
        parentLabel="Assets"
        parentHref="/ai-assets"
        currentPage="AI Skills"
      />
    )
    return () => setHeaderRightStartContent(null)
  }, [setHeaderRightStartContent])

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

export const Route = createFileRoute('/_app/_auth/_superuser/ai-assets/skills' as never)({
  component: AssetsSkillsPage,
})
