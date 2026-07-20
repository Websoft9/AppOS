import { type SettingsPageController } from '../-settings-controller'

export function findSchemaEntry(controller: SettingsPageController, entryId: string) {
  return controller.schemaEntries.find(entry => entry.id === entryId)
}

export function connectorSectionDescription(
  controller: SettingsPageController,
  entryId: string,
  fallback: string
) {
  return findSchemaEntry(controller, entryId)?.description ?? fallback
}
