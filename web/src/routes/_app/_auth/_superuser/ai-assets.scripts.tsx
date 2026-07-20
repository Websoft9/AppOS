import { useEffect, useState } from 'react'
import { FileCode2 } from 'lucide-react'
import { createFileRoute } from '@tanstack/react-router'
import { AssetFamilyPage } from '@/components/assets/AssetFamilyPage'
import { IconBreadcrumb } from '@/components/layout/IconBreadcrumb'
import { useOptionalLayout } from '@/contexts/LayoutContext'

export function AssetsScriptsPage() {
  const [queryState, setQueryState] = useState({ q: '', page: 1 })
  const layout = useOptionalLayout()
  const setHeaderRightStartContent = layout?.setHeaderRightStartContent

  useEffect(() => {
    if (!setHeaderRightStartContent) return undefined
    setHeaderRightStartContent(
      <IconBreadcrumb
        icon={<FileCode2 className="h-4 w-4" />}
        parentLabel="Assets"
        parentHref="/ai-assets"
        currentPage="Scripts"
      />
    )
    return () => setHeaderRightStartContent(null)
  }, [setHeaderRightStartContent])

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

export const Route = createFileRoute('/_app/_auth/_superuser/ai-assets/scripts' as never)({
  component: AssetsScriptsPage,
})
