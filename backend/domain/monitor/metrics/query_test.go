package metrics_test

import (
	"context"
	"fmt"
	metrics "github.com/websoft9/appos/backend/domain/monitor/metrics"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestQueryMetricSeriesQueriesVictoriaMetricsRangeAPI(t *testing.T) {
	var queryString string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		queryString = r.URL.Query().Get("query")
		_, _ = w.Write([]byte(`{"status":"success","data":{"result":[{"values":[[1713096000,"32.1"],[1713096060,"30.8"]]}]}}`))
	}))
	defer server.Close()
	t.Setenv(metrics.EnvVictoriaMetricsURL, server.URL)

	resp, err := metrics.QueryMetricSeries(context.Background(), "server", "srv_1", "1h", []string{"cpu"}, metrics.MetricSeriesQueryOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if queryString != `appos_host_cpu_usage{target_type="server",target_id="srv_1"}` {
		t.Fatalf("unexpected VM query: %s", queryString)
	}
	if len(resp.Series) != 1 || len(resp.Series[0].Points) != 2 {
		t.Fatalf("unexpected series response: %+v", resp)
	}
	if got := fmt.Sprintf("%.1f", resp.Series[0].Points[0][1]); got != "32.1" {
		t.Fatalf("unexpected first point value: %+v", resp.Series[0].Points)
	}
}

func TestQueryMetricSeriesQueriesNetdataPlatformAppOSCoreCPUExpression(t *testing.T) {
	var queryString string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		queryString = r.URL.Query().Get("query")
		_, _ = w.Write([]byte(`{"status":"success","data":{"result":[{"values":[[1713096000,"18.4"]]}]}}`))
	}))
	defer server.Close()
	t.Setenv(metrics.EnvVictoriaMetricsURL, server.URL)

	resp, err := metrics.QueryMetricSeries(context.Background(), "platform", "appos-core", "1h", []string{"cpu"}, metrics.MetricSeriesQueryOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if queryString != `appos_host_cpu_usage{target_type="server",target_id="appos-core"}` {
		t.Fatalf("unexpected VM query: %s", queryString)
	}
	if len(resp.Series) != 1 || len(resp.Series[0].Points) != 1 {
		t.Fatalf("unexpected series response: %+v", resp)
	}
}

func TestQueryMetricSeriesQueriesNetdataPlatformAppOSCoreMemoryExpression(t *testing.T) {
	queries := make([]string, 0, 2)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		queries = append(queries, r.URL.Query().Get("query"))
		_, _ = w.Write([]byte(`{"status":"success","data":{"result":[{"values":[[1713096000,"1"]]}]}}`))
	}))
	defer server.Close()
	t.Setenv(metrics.EnvVictoriaMetricsURL, server.URL)

	resp, err := metrics.QueryMetricSeries(context.Background(), "platform", "appos-core", "1h", []string{"memory"}, metrics.MetricSeriesQueryOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if len(queries) != 2 {
		t.Fatalf("expected two memory queries, got %+v", queries)
	}
	if queries[0] != `sum(appos_host_memory_bytes{target_type="server",target_id="appos-core"})` {
		t.Fatalf("unexpected used query: %s", queries[0])
	}
	if queries[1] != `sum(appos_host_memory_available_bytes{target_type="server",target_id="appos-core"})` {
		t.Fatalf("unexpected available query: %s", queries[1])
	}
	if len(resp.Series) != 1 || len(resp.Series[0].Segments) != 2 {
		t.Fatalf("unexpected series response: %+v", resp)
	}
}

func TestQueryMetricSeriesUsesAppOSPlatformMetricsForNonCoreTarget(t *testing.T) {
	var queryString string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		queryString = r.URL.Query().Get("query")
		_, _ = w.Write([]byte(`{"status":"success","data":{"result":[{"values":[[1713096000,"1"]]}]}}`))
	}))
	defer server.Close()
	t.Setenv(metrics.EnvVictoriaMetricsURL, server.URL)

	_, err := metrics.QueryMetricSeries(context.Background(), "platform", "scheduler", "1h", []string{"cpu"}, metrics.MetricSeriesQueryOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if queryString != `appos_platform_cpu_percent{target_type="platform",target_id="scheduler"}` {
		t.Fatalf("unexpected VM query: %s", queryString)
	}
}

func TestQueryMetricSeriesQueriesNetdataPlatformAppOSCoreDiskExpression(t *testing.T) {
	queries := make([]string, 0, 2)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		queries = append(queries, r.URL.Query().Get("query"))
		_, _ = w.Write([]byte(`{"status":"success","data":{"result":[]}}`))
	}))
	defer server.Close()
	t.Setenv(metrics.EnvVictoriaMetricsURL, server.URL)

	resp, err := metrics.QueryMetricSeries(context.Background(), "platform", "appos-core", "1h", []string{"disk"}, metrics.MetricSeriesQueryOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if len(queries) != 2 {
		t.Fatalf("expected two disk queries, got %+v", queries)
	}
	if queries[0] != `sum(appos_host_disk_read_bytes_per_second{target_type="server",target_id="appos-core"})` {
		t.Fatalf("unexpected read query: %s", queries[0])
	}
	if queries[1] != `sum(appos_host_disk_write_bytes_per_second{target_type="server",target_id="appos-core"})` {
		t.Fatalf("unexpected write query: %s", queries[1])
	}
	if len(resp.Series) != 1 || len(resp.Series[0].Segments) != 2 {
		t.Fatalf("unexpected disk response: %+v", resp)
	}
}

func TestQueryMetricSeriesQueriesNetdataPlatformAppOSCoreNetworkExpression(t *testing.T) {
	queries := make([]string, 0, 2)
	var hitSeriesLookup bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/series":
			hitSeriesLookup = true
			_, _ = w.Write([]byte(`{"status":"success","data":[{"network_interface":"eth0"},{"network_interface":"ens3"}]}`))
		default:
			queries = append(queries, r.URL.Query().Get("query"))
			_, _ = w.Write([]byte(`{"status":"success","data":{"result":[{"values":[[1713096000,"1"]]}]}}`))
		}
	}))
	defer server.Close()
	t.Setenv(metrics.EnvVictoriaMetricsURL, server.URL)

	resp, err := metrics.QueryMetricSeries(context.Background(), "platform", "appos-core", "1h", []string{"network"}, metrics.MetricSeriesQueryOptions{NetworkInterface: "eth0"})
	if err != nil {
		t.Fatal(err)
	}
	if !hitSeriesLookup {
		t.Fatal("expected network interface lookup")
	}
	if len(queries) != 2 {
		t.Fatalf("expected two network queries, got %+v", queries)
	}
	if queries[0] != `sum(appos_host_network_rx_bytes_per_second{target_type="server",target_id="appos-core",network_interface="eth0"})` {
		t.Fatalf("unexpected received query: %s", queries[0])
	}
	if queries[1] != `sum(appos_host_network_tx_bytes_per_second{target_type="server",target_id="appos-core",network_interface="eth0"})` {
		t.Fatalf("unexpected sent query: %s", queries[1])
	}
	if len(resp.Series) != 1 || len(resp.Series[0].Segments) != 2 {
		t.Fatalf("unexpected network response: %+v", resp)
	}
	if resp.SelectedNetworkInterface != "eth0" || len(resp.AvailableNetworkInterfaces) != 2 {
		t.Fatalf("unexpected network selector metadata: %+v", resp)
	}
}

func TestQueryMetricSeriesRejectsNetdataOnlyPlatformSeriesForNonCoreTarget(t *testing.T) {
	_, err := metrics.QueryMetricSeries(context.Background(), "platform", "scheduler", "1h", []string{"disk"}, metrics.MetricSeriesQueryOptions{})
	if err == nil || !strings.Contains(err.Error(), `supported only for platform target "appos-core"`) {
		t.Fatalf("expected appos-core-only rejection, got %v", err)
	}
}

func TestQueryMetricSeriesQueriesNetdataServerMemoryExpression(t *testing.T) {
	queries := make([]string, 0, 2)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		queries = append(queries, r.URL.Query().Get("query"))
		_, _ = w.Write([]byte(`{"status":"success","data":{"result":[{"values":[[1713096000,"1"]]}]}}`))
	}))
	defer server.Close()
	t.Setenv(metrics.EnvVictoriaMetricsURL, server.URL)

	resp, err := metrics.QueryMetricSeries(context.Background(), "server", "srv_2", "1h", []string{"memory"}, metrics.MetricSeriesQueryOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if len(queries) != 2 {
		t.Fatalf("expected two memory queries, got %+v", queries)
	}
	if queries[0] != `sum(appos_host_memory_bytes{target_type="server",target_id="srv_2"})` {
		t.Fatalf("unexpected used query: %s", queries[0])
	}
	if queries[1] != `sum(appos_host_memory_available_bytes{target_type="server",target_id="srv_2"})` {
		t.Fatalf("unexpected available query: %s", queries[1])
	}
	if len(resp.Series) != 1 || len(resp.Series[0].Segments) != 2 {
		t.Fatalf("unexpected series response: %+v", resp)
	}
}

func TestQueryMetricSeriesQueriesNetdataServerDiskExpression(t *testing.T) {
	queries := make([]string, 0, 2)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		queries = append(queries, r.URL.Query().Get("query"))
		_, _ = w.Write([]byte(`{"status":"success","data":{"result":[]}}`))
	}))
	defer server.Close()
	t.Setenv(metrics.EnvVictoriaMetricsURL, server.URL)

	resp, err := metrics.QueryMetricSeries(context.Background(), "server", "srv_3", "1h", []string{"disk"}, metrics.MetricSeriesQueryOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if len(queries) != 2 {
		t.Fatalf("expected two disk queries, got %+v", queries)
	}
	if queries[0] != `sum(appos_host_disk_read_bytes_per_second{target_type="server",target_id="srv_3"})` {
		t.Fatalf("unexpected read query: %s", queries[0])
	}
	if queries[1] != `sum(appos_host_disk_write_bytes_per_second{target_type="server",target_id="srv_3"})` {
		t.Fatalf("unexpected write query: %s", queries[1])
	}
	if len(resp.Series) != 1 || len(resp.Series[0].Segments) != 2 {
		t.Fatalf("unexpected series response: %+v", resp)
	}
}

func TestQueryMetricSeriesQueriesNetdataServerNetworkExpression(t *testing.T) {
	queries := make([]string, 0, 2)
	var hitSeriesLookup bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/series":
			hitSeriesLookup = true
			_, _ = w.Write([]byte(`{"status":"success","data":[{"network_interface":"eth0"},{"network_interface":"ens3"}]}`))
		default:
			queries = append(queries, r.URL.Query().Get("query"))
			_, _ = w.Write([]byte(`{"status":"success","data":{"result":[{"values":[[1713096000,"1"]]}]}}`))
		}
	}))
	defer server.Close()
	t.Setenv(metrics.EnvVictoriaMetricsURL, server.URL)

	resp, err := metrics.QueryMetricSeries(context.Background(), "server", "srv_4", "1h", []string{"network"}, metrics.MetricSeriesQueryOptions{NetworkInterface: "eth0"})
	if err != nil {
		t.Fatal(err)
	}
	if !hitSeriesLookup {
		t.Fatal("expected network interface lookup")
	}
	if len(queries) != 2 {
		t.Fatalf("expected two network speed queries, got %+v", queries)
	}
	if queries[0] != `sum(appos_host_network_rx_bytes_per_second{target_type="server",target_id="srv_4",network_interface="eth0"})` {
		t.Fatalf("unexpected received query: %s", queries[0])
	}
	if queries[1] != `sum(appos_host_network_tx_bytes_per_second{target_type="server",target_id="srv_4",network_interface="eth0"})` {
		t.Fatalf("unexpected sent query: %s", queries[1])
	}
	if len(resp.Series) != 1 || len(resp.Series[0].Segments) != 2 {
		t.Fatalf("unexpected series response: %+v", resp)
	}
	if resp.SelectedNetworkInterface != "eth0" || len(resp.AvailableNetworkInterfaces) != 2 {
		t.Fatalf("unexpected network selector metadata: %+v", resp)
	}
}

func TestQueryMetricSeriesQueriesCanonicalServerAggregateNetworkExpressionByDefault(t *testing.T) {
	queries := make([]string, 0, 2)
	var hitSeriesLookup bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/series":
			hitSeriesLookup = true
			_, _ = w.Write([]byte(`{"status":"success","data":[{"network_interface":"eth0"},{"network_interface":"ens3"}]}`))
		default:
			queries = append(queries, r.URL.Query().Get("query"))
			_, _ = w.Write([]byte(`{"status":"success","data":{"result":[{"values":[[1713096000,"1"]]}]}}`))
		}
	}))
	defer server.Close()
	t.Setenv(metrics.EnvVictoriaMetricsURL, server.URL)

	resp, err := metrics.QueryMetricSeries(context.Background(), "server", "srv-agg", "1h", []string{"network"}, metrics.MetricSeriesQueryOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if !hitSeriesLookup {
		t.Fatal("expected network interface lookup")
	}
	if len(queries) != 2 {
		t.Fatalf("expected two aggregate network queries, got %+v", queries)
	}
	if queries[0] != `sum(appos_host_network_rx_bytes_per_second{target_type="server",target_id="srv-agg",network_interface=""})` {
		t.Fatalf("unexpected aggregate received query: %s", queries[0])
	}
	if queries[1] != `sum(appos_host_network_tx_bytes_per_second{target_type="server",target_id="srv-agg",network_interface=""})` {
		t.Fatalf("unexpected aggregate sent query: %s", queries[1])
	}
	if resp.SelectedNetworkInterface != "all" || len(resp.AvailableNetworkInterfaces) != 2 {
		t.Fatalf("unexpected network selector metadata: %+v", resp)
	}
}

func TestQueryMetricSeriesQueriesNetdataServerNetworkTrafficExpression(t *testing.T) {
	queries := make([]string, 0, 2)
	var hitSeriesLookup bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/series":
			hitSeriesLookup = true
			_, _ = w.Write([]byte(`{"status":"success","data":[{"network_interface":"eth0"}]}`))
		default:
			queries = append(queries, r.URL.Query().Get("query"))
			if strings.Contains(r.URL.Query().Get("query"), "network_rx") {
				_, _ = w.Write([]byte(`{"status":"success","data":{"result":[{"values":[[1713096000,"1024"],[1713096300,"2048"]]}]}}`))
				return
			}
			_, _ = w.Write([]byte(`{"status":"success","data":{"result":[{"values":[[1713096000,"512"],[1713096300,"1024"]]}]}}`))
		}
	}))
	defer server.Close()
	t.Setenv(metrics.EnvVictoriaMetricsURL, server.URL)

	resp, err := metrics.QueryMetricSeries(context.Background(), "server", "srv_4", "5h", []string{"network_traffic"}, metrics.MetricSeriesQueryOptions{NetworkInterface: "eth0"})
	if err != nil {
		t.Fatal(err)
	}
	if !hitSeriesLookup {
		t.Fatal("expected network interface lookup")
	}
	if len(queries) != 2 {
		t.Fatalf("expected two network traffic queries, got %+v", queries)
	}
	if queries[0] != `sum(appos_host_network_rx_bytes_per_second{target_type="server",target_id="srv_4",network_interface="eth0"})` {
		t.Fatalf("unexpected received query: %s", queries[0])
	}
	if queries[1] != `sum(appos_host_network_tx_bytes_per_second{target_type="server",target_id="srv_4",network_interface="eth0"})` {
		t.Fatalf("unexpected sent query: %s", queries[1])
	}
	if len(resp.Series) != 1 || len(resp.Series[0].Segments) != 2 {
		t.Fatalf("unexpected network traffic response: %+v", resp)
	}
	if resp.Series[0].Unit != "bytes" {
		t.Fatalf("unexpected network traffic unit: %+v", resp.Series[0])
	}
	if got := resp.Series[0].Segments[0].Points; len(got) != 2 || got[0][1] != 307200 || got[1][1] != 921600 {
		t.Fatalf("unexpected cumulative inbound traffic points: %+v", got)
	}
	if got := resp.Series[0].Segments[1].Points; len(got) != 2 || got[0][1] != 153600 || got[1][1] != 460800 {
		t.Fatalf("unexpected cumulative outbound traffic points: %+v", got)
	}
}

func TestQueryMetricSeriesQueriesNetdataServerDiskUsageExpression(t *testing.T) {
	queries := make([]string, 0, 2)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		queries = append(queries, r.URL.Query().Get("query"))
		_, _ = w.Write([]byte(`{"status":"success","data":{"result":[{"values":[[1713096000,"1"]]}]}}`))
	}))
	defer server.Close()
	t.Setenv(metrics.EnvVictoriaMetricsURL, server.URL)

	resp, err := metrics.QueryMetricSeries(context.Background(), "server", "srv_5", "1h", []string{"disk_usage"}, metrics.MetricSeriesQueryOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if len(queries) != 2 {
		t.Fatalf("expected two disk usage queries, got %+v", queries)
	}
	if queries[0] != `sum(appos_host_disk_usage_bytes{target_type="server",target_id="srv_5"})` {
		t.Fatalf("unexpected used query: %s", queries[0])
	}
	if queries[1] != `sum(appos_host_disk_free_bytes{target_type="server",target_id="srv_5"})` {
		t.Fatalf("unexpected free query: %s", queries[1])
	}
	if len(resp.Series) != 1 {
		t.Fatalf("unexpected series response: %+v", resp)
	}
	if len(resp.Series[0].Segments) != 2 || resp.Series[0].Unit != "bytes" {
		t.Fatalf("unexpected disk usage payload: %+v", resp.Series[0])
	}
}

func TestQueryMetricSeriesRejectsUnknownAlias(t *testing.T) {
	_, err := metrics.QueryMetricSeries(context.Background(), "server", "srv_1", "1h", []string{"bogus"}, metrics.MetricSeriesQueryOptions{})
	if err == nil || !strings.Contains(err.Error(), "not allowed") {
		t.Fatalf("expected alias rejection, got %v", err)
	}
}

func TestQueryMetricSeriesAcceptsExtendedFixedWindows(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"status":"success","data":{"result":[]}}`))
	}))
	defer server.Close()
	t.Setenv(metrics.EnvVictoriaMetricsURL, server.URL)

	for _, window := range []string{"12h", "1d", "7d"} {
		resp, err := metrics.QueryMetricSeries(context.Background(), "app", "app-1", window, []string{"cpu"}, metrics.MetricSeriesQueryOptions{})
		if err != nil {
			t.Fatalf("window %s should be accepted: %v", window, err)
		}
		if resp.Window != window {
			t.Fatalf("expected window %s, got %+v", window, resp)
		}
	}
}

func TestQueryMetricSeriesUsesCustomRange(t *testing.T) {
	var lastQuery url.Values
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		lastQuery = r.URL.Query()
		_, _ = w.Write([]byte(`{"status":"success","data":{"result":[]}}`))
	}))
	defer server.Close()
	t.Setenv(metrics.EnvVictoriaMetricsURL, server.URL)

	startAt := time.Date(2026, time.April, 14, 8, 0, 0, 0, time.UTC)
	endAt := startAt.Add(36 * time.Hour)
	resp, err := metrics.QueryMetricSeries(context.Background(), "app", "app-2", "custom", []string{"cpu"}, metrics.MetricSeriesQueryOptions{
		StartAt: &startAt,
		EndAt:   &endAt,
	})
	if err != nil {
		t.Fatal(err)
	}
	if resp.Window != "custom" {
		t.Fatalf("expected custom window, got %+v", resp)
	}
	if resp.RangeStartAt != startAt.Format(time.RFC3339) || resp.RangeEndAt != endAt.Format(time.RFC3339) {
		t.Fatalf("unexpected range metadata: %+v", resp)
	}
	if resp.StepSeconds != int(time.Hour.Seconds()) {
		t.Fatalf("expected 1h step for 36h custom range, got %+v", resp)
	}
	if got := lastQuery.Get("start"); got != fmt.Sprintf("%d", startAt.Unix()) {
		t.Fatalf("unexpected start query: %s", got)
	}
	if got := lastQuery.Get("end"); got != fmt.Sprintf("%d", endAt.Unix()) {
		t.Fatalf("unexpected end query: %s", got)
	}
	if got := lastQuery.Get("step"); got != "3600s" {
		t.Fatalf("unexpected step query: %s", got)
	}
}

func TestQueryMetricSeriesRejectsPartialCustomRange(t *testing.T) {
	startAt := time.Date(2026, time.April, 14, 8, 0, 0, 0, time.UTC)
	_, err := metrics.QueryMetricSeries(context.Background(), "app", "app-2", "custom", []string{"cpu"}, metrics.MetricSeriesQueryOptions{StartAt: &startAt})
	if err == nil || !strings.Contains(err.Error(), "requires both") {
		t.Fatalf("expected partial custom range rejection, got %v", err)
	}
}

func TestResolveMetricSeriesWindowAlignsFixedWindowToStepBoundary(t *testing.T) {
	now := time.Date(2026, time.May, 14, 10, 7, 23, 0, time.UTC)
	start, end, step, err := metrics.ResolveMetricSeriesWindowForTest("24h", metrics.MetricSeriesQueryOptions{}, now)
	if err != nil {
		t.Fatal(err)
	}
	wantEnd := time.Date(2026, time.May, 14, 10, 0, 0, 0, time.UTC)
	if !end.Equal(wantEnd) {
		t.Fatalf("expected aligned end %s, got %s", wantEnd, end)
	}
	if got := end.Sub(start); got != 24*time.Hour {
		t.Fatalf("expected 24h duration, got %s", got)
	}
	if step != 15*time.Minute {
		t.Fatalf("expected 15m step, got %s", step)
	}

	_, end7d, step7d, err := metrics.ResolveMetricSeriesWindowForTest("7d", metrics.MetricSeriesQueryOptions{}, now)
	if err != nil {
		t.Fatal(err)
	}
	want7dEnd := time.Date(2026, time.May, 14, 10, 0, 0, 0, time.UTC)
	if !end7d.Equal(want7dEnd) {
		t.Fatalf("expected aligned 7d end %s, got %s", want7dEnd, end7d)
	}
	if step7d != time.Hour {
		t.Fatalf("expected 1h step, got %s", step7d)
	}
}
