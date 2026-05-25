package metrics

func isAppOSCorePlatformTarget(targetType, targetID string) bool {
	return targetType == targetTypePlatform && targetID == platformTargetAppOSCore
}

func supportsNetworkInterfaceSelection(targetType, targetID string) bool {
	return targetType == targetTypeServer || isAppOSCorePlatformTarget(targetType, targetID)
}
