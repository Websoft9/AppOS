package monitor

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestQueryMetricSeriesQueriesVictoriaMetricsRangeAPI(t *testing.T) {
	var queryString string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		queryString = r.URL.Query().Get("query")
		_, _ = w.Write([]byte(`{"status":"success","data":{"result":[{"values":[[1713096000,"32.1"],[1713096060,"30.8"]]}]}}`))
	}))
	defer server.Close()
	t.Setenv(EnvVictoriaMetricsURL, server.URL)

	resp, err := QueryMetricSeries(context.Background(), TargetTypeServer, "srv_1", "1h", []string{"cpu"}, MetricSeriesQueryOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if queryString != `100 - netdata_system_cpu_percentage_average{instance="srv_1",dimension="idle"}` {
		t.Fatalf("unexpected VM query: %s", queryString)
	}
	if len(resp.Series) != 1 || len(resp.Series[0].Points) != 2 {
		t.Fatalf("unexpected series response: %+v", resp)
	}
	if got := fmt.Sprintf("%.1f", resp.Series[0].Points[0][1]); got != "32.1" {
		t.Fatalf("unexpected first point value: %+v", resp.Series[0].Points)
	}
}

func TestQueryMetricSeriesQueriesNetdataServerMemoryExpression(t *testing.T) {
	queries := make([]string, 0, 2)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		queries = append(queries, r.URL.Query().Get("query"))
		_, _ = w.Write([]byte(`{"status":"success","data":{"result":[]}}`))
	}))
	defer server.Close()
	t.Setenv(EnvVictoriaMetricsURL, server.URL)

	resp, err := QueryMetricSeries(context.Background(), TargetTypeServer, "srv_2", "1h", []string{"memory"}, MetricSeriesQueryOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if len(queries) != 2 {
		t.Fatalf("expected two memory queries, got %+v", queries)
	}
	if queries[0] != `sum(netdata_system_ram_MiB_average{instance="srv_2",dimension="used"}) * 1048576` {
		t.Fatalf("unexpected used query: %s", queries[0])
	}
	if queries[1] != `sum(netdata_system_ram_MiB_average{instance="srv_2",dimension=~"free|cached|buffers"}) * 1048576` {
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
	t.Setenv(EnvVictoriaMetricsURL, server.URL)

	resp, err := QueryMetricSeries(context.Background(), TargetTypeServer, "srv_3", "1h", []string{"disk"}, MetricSeriesQueryOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if len(queries) != 2 {
		t.Fatalf("expected two disk queries, got %+v", queries)
	}
	if queries[0] != `sum(netdata_system_io_KiB_persec_average{instance="srv_3",dimension="reads"}) * 1024` {
		t.Fatalf("unexpected read query: %s", queries[0])
	}
	if queries[1] != `sum(netdata_system_io_KiB_persec_average{instance="srv_3",dimension="writes"}) * 1024` {
		t.Fatalf("unexpected write query: %s", queries[1])
	}
	if len(resp.Series) != 1 || len(resp.Series[0].Segments) != 2 {
		t.Fatalf("unexpected series response: %+v", resp)
	}
}

func TestQueryMetricSeriesQueriesNetdataServerNetworkExpression(t *testing.T) {
	var queryString string
	var hitSeriesLookup bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/series":
			hitSeriesLookup = true
			_, _ = w.Write([]byte(`{"status":"success","data":[{"device":"eth0"},{"device":"ens3"}]}`))
		default:
			queryString = r.URL.Query().Get("query")
			_, _ = w.Write([]byte(`{"status":"success","data":{"result":[]}}`))
		}
	}))
	defer server.Close()
	t.Setenv(EnvVictoriaMetricsURL, server.URL)

	resp, err := QueryMetricSeries(context.Background(), TargetTypeServer, "srv_4", "1h", []string{"network"}, MetricSeriesQueryOptions{NetworkInterface: "eth0"})
	if err != nil {
		t.Fatal(err)
	}
	if !hitSeriesLookup {
		t.Fatal("expected network interface lookup")
	}
	if queryString != `sum(netdata_net_net_kilobits_persec_average{instance="srv_4",device="eth0",dimension=~"received|sent"}) * 125` {
		t.Fatalf("unexpected VM query: %s", queryString)
	}
	if len(resp.Series) != 1 {
		t.Fatalf("unexpected series response: %+v", resp)
	}
	if resp.SelectedNetworkInterface != "eth0" || len(resp.AvailableNetworkInterfaces) != 2 {
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
			_, _ = w.Write([]byte(`{"status":"success","data":[{"device":"eth0"}]}`))
		default:
			queries = append(queries, r.URL.Query().Get("query"))
			_, _ = w.Write([]byte(`{"status":"success","data":{"result":[]}}`))
		}
	}))
	defer server.Close()
	t.Setenv(EnvVictoriaMetricsURL, server.URL)

	resp, err := QueryMetricSeries(context.Background(), TargetTypeServer, "srv_4", "1h", []string{"network_traffic"}, MetricSeriesQueryOptions{NetworkInterface: "eth0"})
	if err != nil {
		t.Fatal(err)
	}
	if !hitSeriesLookup {
		t.Fatal("expected network interface lookup")
	}
	if len(queries) != 2 {
		t.Fatalf("expected two network traffic queries, got %+v", queries)
	}
	if queries[0] != `sum(netdata_net_net_kilobits_persec_average{instance="srv_4",device="eth0",dimension="received"}) * 125` {
		t.Fatalf("unexpected received query: %s", queries[0])
	}
	if queries[1] != `sum(netdata_net_net_kilobits_persec_average{instance="srv_4",device="eth0",dimension="sent"}) * 125` {
		t.Fatalf("unexpected sent query: %s", queries[1])
	}
	if len(resp.Series) != 1 || len(resp.Series[0].Segments) != 2 {
		t.Fatalf("unexpected network traffic response: %+v", resp)
	}
}

func TestQueryMetricSeriesQueriesNetdataServerDiskUsageExpression(t *testing.T) {
	queries := make([]string, 0, 2)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		queries = append(queries, r.URL.Query().Get("query"))
		_, _ = w.Write([]byte(`{"status":"success","data":{"result":[]}}`))
	}))
	defer server.Close()
	t.Setenv(EnvVictoriaMetricsURL, server.URL)

	resp, err := QueryMetricSeries(context.Background(), TargetTypeServer, "srv_5", "1h", []string{"disk_usage"}, MetricSeriesQueryOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if len(queries) != 2 {
		t.Fatalf("expected two disk usage queries, got %+v", queries)
	}
	if queries[0] != `sum(netdata_disk_space_GiB_average{instance="srv_5",family="/",dimension="used"}) * 1073741824` {
		t.Fatalf("unexpected used query: %s", queries[0])
	}
	if queries[1] != `sum(netdata_disk_space_GiB_average{instance="srv_5",family="/",dimension=~"avail|reserved_for_root"}) * 1073741824` {
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
	_, err := QueryMetricSeries(context.Background(), TargetTypeServer, "srv_1", "1h", []string{"bogus"}, MetricSeriesQueryOptions{})
	if err == nil || !strings.Contains(err.Error(), "not allowed") {
		t.Fatalf("expected alias rejection, got %v", err)
	}
}
