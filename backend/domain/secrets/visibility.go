package secrets

const (
	VisibleToServer          = "server"
	VisibleToApplication     = "application"
	VisibleToServiceInstance = "service_instance"
	VisibleToConnector       = "connector"
	VisibleToProviderAccount = "provider_account"
	VisibleToAIProvider      = "ai_provider"
)

var VisibleToValues = []string{
	VisibleToServer,
	VisibleToApplication,
	VisibleToServiceInstance,
	VisibleToConnector,
	VisibleToProviderAccount,
	VisibleToAIProvider,
}
