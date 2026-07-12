import { createFileRoute } from '@tanstack/react-router'
import { ExternalLink } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { pb } from '@/lib/pb'

export function AIAgentPage() {
	const { t } = useTranslation('aiAgent')
	const token = pb.authStore.token
	const iframeSrc = token ? `/api/ai/agent?token=${encodeURIComponent(token)}` : '/api/ai/agent'

	return (
		<div className="-m-6 flex h-[calc(100%+3rem)] min-h-0 flex-col overflow-hidden px-6 py-6">
			<div className="shrink-0 pb-4">
				<div className="flex items-start justify-between gap-4">
					<div>
						<h1 className="text-2xl font-bold tracking-tight">{t('page.title')}</h1>
						<p className="mt-0.5 text-sm text-muted-foreground">{t('page.subtitle')}</p>
					</div>
					<Button asChild size="sm" variant="outline">
						<a href="/api/ai/agent" target="_blank" rel="noreferrer">
							<ExternalLink className="mr-2 h-4 w-4" />
							{t('actions.openNewTab')}
						</a>
					</Button>
				</div>
			</div>

			<div className="min-h-0 flex-1 overflow-hidden rounded-xl border bg-background">
				<iframe
					title={t('page.frameTitle')}
					src={iframeSrc}
					className="h-full w-full border-0"
					allow="clipboard-read; clipboard-write"
				/>
			</div>
		</div>
	)
}

export const Route = createFileRoute('/_app/_auth/ai-agent' as never)({
	component: AIAgentPage,
})
