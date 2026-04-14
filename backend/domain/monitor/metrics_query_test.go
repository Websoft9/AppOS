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

	resp, err := QueryMetricSeries(context.Background(), TargetTypeServer, "srv_1", "1h", []string{"cpu"})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(queryString, `appos_host_cpu_usage{target_type="server",target_id="srv_1"}`) {
		t.Fatalf("unexpected VM query: %s", queryString)
	}
	if len(resp.Series) != 1 || len(resp.Series[0].Points) != 2 {
		t.Fatalf("unexpected series response: %+v", resp)
	}
	if got := fmt.Sprintf("%.1f", resp.Series[0].Points[0][1]); got != "32.1" {
		t.Fatalf("unexpected first point value: %+v", resp.Series[0].Points)
	}
}

func TestQueryMetricSeriesRejectsUnknownAlias(t *testing.T) {
	_, err := QueryMetricSeries(context.Background(), TargetTypeServer, "srv_1", "1h", []string{"disk"})
	if err == nil || !strings.Contains(err.Error(), "not allowed") {
		t.Fatalf("expected alias rejection, got %v", err)
	}
}
