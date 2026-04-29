package vmclient

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type Client struct {
	httpClient *http.Client
}

type Service struct {
	baseURL string
	client  *Client
}

type QueryRangeMatrixSeries struct {
	Metric map[string]string
	Values [][]float64
}

func New(httpClient *http.Client) *Client {
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	return &Client{httpClient: httpClient}
}

func NewService(httpClient *http.Client, baseURL string) *Service {
	return &Service{
		baseURL: strings.TrimRight(strings.TrimSpace(baseURL), "/"),
		client:  New(httpClient),
	}
}

func (s *Service) WritePrometheusImport(ctx context.Context, lines []string) error {
	return s.client.WritePrometheusImport(ctx, s.endpoint("/api/v1/import/prometheus"), lines)
}

func (s *Service) ListSeries(ctx context.Context, matchers []string, start, end time.Time) ([]map[string]string, error) {
	return s.client.ListSeries(ctx, s.endpoint("/api/v1/series"), matchers, start, end)
}

func (s *Service) QueryRange(ctx context.Context, query string, start, end time.Time, step time.Duration) ([][]float64, error) {
	return s.client.QueryRange(ctx, s.endpoint("/api/v1/query_range"), query, start, end, step)
}

func (s *Service) QueryRangeMatrix(ctx context.Context, query string, start, end time.Time, step time.Duration) ([]QueryRangeMatrixSeries, error) {
	return s.client.QueryRangeMatrix(ctx, s.endpoint("/api/v1/query_range"), query, start, end, step)
}

func (s *Service) endpoint(path string) string {
	return s.baseURL + path
}

func (c *Client) WritePrometheusImport(ctx context.Context, endpoint string, lines []string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewBufferString(strings.Join(lines, "\n")+"\n"))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "text/plain; charset=utf-8")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("victoriametrics write failed with status %d", resp.StatusCode)
	}
	return nil
}

func (c *Client) ListSeries(ctx context.Context, endpoint string, matchers []string, start, end time.Time) ([]map[string]string, error) {
	params := url.Values{}
	for _, matcher := range matchers {
		matcher = strings.TrimSpace(matcher)
		if matcher == "" {
			continue
		}
		params.Add("match[]", matcher)
	}
	params.Set("start", fmt.Sprintf("%d", start.Unix()))
	params.Set("end", fmt.Sprintf("%d", end.Unix()))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint+"?"+params.Encode(), nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("victoriametrics series lookup failed with status %d", resp.StatusCode)
	}
	var payload struct {
		Status string              `json:"status"`
		Data   []map[string]string `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, err
	}
	if payload.Status != "success" {
		return nil, fmt.Errorf("victoriametrics series lookup did not succeed")
	}
	return payload.Data, nil
}

func (c *Client) QueryRange(ctx context.Context, endpoint, query string, start, end time.Time, step time.Duration) ([][]float64, error) {
	series, err := c.QueryRangeMatrix(ctx, endpoint, query, start, end, step)
	if err != nil {
		return nil, err
	}
	if len(series) == 0 {
		return [][]float64{}, nil
	}
	return series[0].Values, nil
}

func (c *Client) QueryRangeMatrix(ctx context.Context, endpoint, query string, start, end time.Time, step time.Duration) ([]QueryRangeMatrixSeries, error) {
	params := url.Values{}
	params.Set("query", query)
	params.Set("start", fmt.Sprintf("%d", start.Unix()))
	params.Set("end", fmt.Sprintf("%d", end.Unix()))
	params.Set("step", fmt.Sprintf("%ds", int(step.Seconds())))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint+"?"+params.Encode(), nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("victoriametrics query failed with status %d", resp.StatusCode)
	}
	var payload struct {
		Status string `json:"status"`
		Data   struct {
			Result []struct {
				Metric map[string]string `json:"metric"`
				Values [][]any           `json:"values"`
			} `json:"result"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, err
	}
	if payload.Status != "success" {
		return nil, fmt.Errorf("victoriametrics query did not succeed")
	}
	series := make([]QueryRangeMatrixSeries, 0, len(payload.Data.Result))
	for _, rawSeries := range payload.Data.Result {
		points := make([][]float64, 0, len(rawSeries.Values))
		for _, raw := range rawSeries.Values {
			if len(raw) != 2 {
				continue
			}
			timestamp, ok := coerceMetricFloat(raw[0])
			if !ok {
				continue
			}
			value, ok := coerceMetricFloat(raw[1])
			if !ok {
				continue
			}
			points = append(points, []float64{timestamp, value})
		}
		series = append(series, QueryRangeMatrixSeries{Metric: rawSeries.Metric, Values: points})
	}
	return series, nil
}

func coerceMetricFloat(value any) (float64, bool) {
	switch typed := value.(type) {
	case float64:
		return typed, true
	case string:
		result, err := strconv.ParseFloat(typed, 64)
		if err != nil {
			return 0, false
		}
		return result, true
	case json.Number:
		result, err := typed.Float64()
		if err != nil {
			return 0, false
		}
		return result, true
	default:
		return 0, false
	}
}
