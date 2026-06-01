package secrets

const (
	VisibleToServer          = "server"
	VisibleToServiceInstance = "service_instance"
	VisibleToConnector       = "connector"
	VisibleToProviderAccount = "provider_account"
	VisibleToAIProvider      = "ai_provider"
)

var VisibleToValues = []string{
	VisibleToServer,
	VisibleToServiceInstance,
	VisibleToConnector,
	VisibleToProviderAccount,
	VisibleToAIProvider,
}
