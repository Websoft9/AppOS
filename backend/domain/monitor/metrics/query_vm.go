package metrics

func isNetdataPlatformTarget(targetType, targetID string) bool {
	return targetType == targetTypePlatform && targetID == platformTargetAppOSCore
}

func supportsNetworkInterfaceSelection(targetType, targetID string) bool {
	return targetType == targetTypeServer || isNetdataPlatformTarget(targetType, targetID)
}
