import { createFileRoute } from '@tanstack/react-router'
import { useSettingsPageController } from './-settings-controller'
import { SettingsScreen } from './-settings-screen'

export function SettingsPage() {
  const controller = useSettingsPageController()
  return <SettingsScreen controller={controller} />
}

export const Route = createFileRoute('/_app/_auth/_superuser/settings')({
  component: SettingsPage,
})
