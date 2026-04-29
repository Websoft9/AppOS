package netutil

import (
	"fmt"
	"net"
)

func LookupInterfaceIPv4(name string) (string, error) {
	iface, err := net.InterfaceByName(name)
	if err != nil {
		return "", fmt.Errorf("%s interface not found", name)
	}

	addrs, err := iface.Addrs()
	if err != nil {
		return "", fmt.Errorf("failed to inspect %s interface addresses", name)
	}

	for _, addr := range addrs {
		switch value := addr.(type) {
		case *net.IPNet:
			if ip := value.IP.To4(); ip != nil {
				return ip.String(), nil
			}
		case *net.IPAddr:
			if ip := value.IP.To4(); ip != nil {
				return ip.String(), nil
			}
		}
	}

	return "", fmt.Errorf("%s interface has no IPv4 address", name)
}
