package metrics

func isNetdataPlatformTarget(targetType, targetID string) bool {
	return targetType == targetTypePlatform && targetID == platformTargetAppOSCore
}

func supportsNetworkInterfaceSelection(targetType, targetID string) bool {
	if targetType == targetTypeServer {
		return true
	}
	return isNetdataPlatformTarget(targetType, targetID)
}
