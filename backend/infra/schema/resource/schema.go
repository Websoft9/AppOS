package resource

import "github.com/pocketbase/pocketbase/core"

func EnsureProviderAccountDependents(app core.App) error {
	if err := EnsureInstancesCollection(app); err != nil {
		return err
	}
	return EnsureConnectorsCollection(app)
}

func EnsureAllCollections(app core.App) error {
	if err := EnsureProviderAccountsCollection(app); err != nil {
		return err
	}
	if err := EnsureProviderAccountDependents(app); err != nil {
		return err
	}
	return EnsureAIProvidersCollection(app)
}
