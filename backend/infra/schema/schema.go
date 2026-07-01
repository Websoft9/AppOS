package schema

import "github.com/pocketbase/pocketbase/core"

func EnsureAllCollections(app core.App) error {
	steps := []func(core.App) error{
		EnsureUsersCollectionPatch,
		EnsureSecretsCollection,
		EnsureDatabasesCollection,
		EnsureCloudAccountsCollection,
		EnsureCertificatesCollection,
		EnsureServersCollection,
		EnsureProviderAccountsCollection,
		EnsureConnectorsCollection,
		EnsureInstancesCollection,
		EnsureAIProvidersCollection,
		EnsureAppsCollection,
		EnsureUserFilesCollection,
		EnsureGroupsCollection,
		EnsureGroupItemsCollection,
		EnsureAuditLogsCollection,
		EnsureCustomSettingsCollection,
		EnsureStoreUserAppsCollection,
		EnsureStoreCustomAppsCollection,
		EnsureTopicsCollection,
		EnsureTopicCommentsCollection,
		EnsureEnvSetsCollection,
		EnsureEnvSetVarsCollection,
		EnsureDeploymentsCollection,
		EnsureAppInstancesCollection,
		EnsureAppOperationsCollection,
		EnsureAppReleasesCollection,
		EnsureAppExposuresCollection,
		EnsurePipelineRunsCollection,
		EnsurePipelineNodeRunsCollection,
		EnsureMonitorLatestStatusCollection,
		EnsureSoftwareOperationsCollection,
		EnsureSoftwareInventorySnapshotsCollection,
		EnsureDockerImagePullOperationsCollection,
		EnsureFeedSourcesCollection,
		EnsureFeedItemsCollection,
		EnsureAssetsCollection,
		EnsureAICopilotSessionsCollection,
		EnsureAICopilotMessagesCollection,
		EnsureMediaCollection,
	}

	for _, step := range steps {
		if err := step(app); err != nil {
			return err
		}
	}
	return nil
}

func EnsureProviderAccountDependents(app core.App) error {
	if err := EnsureInstancesCollection(app); err != nil {
		return err
	}
	return EnsureConnectorsCollection(app)
}
