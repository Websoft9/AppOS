import { FeedsPolicySection } from './-settings-sections/feeds-section'
import { type SettingsPageController } from './-settings-controller'
import { FEEDS_SECTION_IDS, matchesSectionIds } from './-settings-core/section-ids'

export function getFeedsSectionHelp(controller: SettingsPageController) {
  if (!matchesSectionIds(controller.activeSection, FEEDS_SECTION_IDS)) {
    return null
  }
  return {
    title: 'Feeds',
    description:
      'Configure global feed polling cadence, retry backoff, and cleanup retention limits.',
  }
}

export function renderFeedsSection(controller: SettingsPageController) {
  if (!matchesSectionIds(controller.activeSection, FEEDS_SECTION_IDS)) {
    return null
  }

  const entry = controller.schemaEntries.find(schemaEntry => schemaEntry.id === 'feeds-policy')
  if (!entry) {
    return null
  }

  return (
    <FeedsPolicySection
      entry={entry}
      form={controller.feedsPolicyForm}
      errors={controller.feedsPolicyErrors}
      saving={controller.feedsPolicySaving}
      setForm={controller.setFeedsPolicyForm}
      save={controller.saveFeedsPolicy}
      deleteDialogOpen={controller.feedsDeleteDialogOpen}
      deleteLoading={controller.feedsDeleteLoading}
      deleteExecuting={controller.feedsDeleteExecuting}
      deleteCount={controller.feedsDeleteCount}
      deleteMaxCount={controller.feedsDeleteMaxCount}
      openDeleteDialog={controller.openFeedsDeleteDialog}
      closeDeleteDialog={controller.closeFeedsDeleteDialog}
      setDeleteCount={controller.setFeedsDeleteCount}
      executeDelete={controller.executeFeedsDelete}
    />
  )
}