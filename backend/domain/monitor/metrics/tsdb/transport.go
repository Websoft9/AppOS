package tsdb

import (
	"context"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/websoft9/appos/backend/infra/vmclient"
)

type Service struct {
	client *vmclient.Service
}

func NewService(httpClient *http.Client, baseURL string) *Service {
	return &Service{client: vmclient.NewService(httpClient, baseURL)}
}

func (s *Service) WritePrometheusImport(ctx context.Context, lines []string) error {
	return s.client.WritePrometheusImport(ctx, lines)
}

func (s *Service) ListNetworkInterfaces(ctx context.Context, targetID string, start, end time.Time) ([]string, error) {
	series, err := s.client.ListSeries(ctx, []string{fmt.Sprintf(`netdata_net_net_kilobits_persec_average{instance=%q}`, targetID)}, start, end)
	if err != nil {
		return nil, err
	}
	seen := map[string]struct{}{}
	interfaces := make([]string, 0, len(series))
	for _, item := range series {
		device := strings.TrimSpace(item["device"])
		if device == "" {
			continue
		}
		if _, ok := seen[device]; ok {
			continue
		}
		seen[device] = struct{}{}
		interfaces = append(interfaces, device)
	}
	sort.Strings(interfaces)
	return interfaces, nil
}

func (s *Service) ExecuteQueryRange(ctx context.Context, query string, start, end time.Time, step time.Duration) ([][]float64, error) {
	return s.client.QueryRange(ctx, query, start, end, step)
}

func WritePrometheusImport(ctx context.Context, client *http.Client, baseURL string, lines []string) error {
	return NewService(client, baseURL).WritePrometheusImport(ctx, lines)
}

func ListNetworkInterfaces(ctx context.Context, client *http.Client, baseURL, targetID string, start, end time.Time) ([]string, error) {
	return NewService(client, baseURL).ListNetworkInterfaces(ctx, targetID, start, end)
}

func ExecuteQueryRange(ctx context.Context, client *http.Client, baseURL, query string, start, end time.Time, step time.Duration) ([][]float64, error) {
	return NewService(client, baseURL).ExecuteQueryRange(ctx, query, start, end, step)
}
