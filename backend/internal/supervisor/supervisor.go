// Package supervisor provides a client for supervisord XML-RPC API
// and process resource monitoring via system commands.
//
// Used by Epic 6 (Services Module) to manage appos container internal services.
package supervisor

import (
	"bytes"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config holds supervisord connection settings.
type Config struct {
	URL      string // e.g. "http://127.0.0.1:9001/RPC2"
	Username string
	Password string
}

// DefaultConfig returns config using environment variables.
func DefaultConfig() Config {
	password := os.Getenv("SUPERVISOR_PASSWORD")
	if password == "" {
		password = "changeme"
	}
	return Config{
		URL:      "http://127.0.0.1:9001/RPC2",
		Username: "admin",
		Password: password,
	}
}

// Client communicates with supervisord via XML-RPC.
type Client struct {
	cfg    Config
	http   *http.Client
}

// NewClient creates a new supervisord client.
func NewClient(cfg Config) *Client {
	return &Client{
		cfg: cfg,
		http: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// ProcessInfo represents a supervisord process.
type ProcessInfo struct {
	Name        string `json:"name"`
	Group       string `json:"group"`
	State       int    `json:"state"`
	StateName   string `json:"stateName"`
	PID         int    `json:"pid"`
	Uptime      int64  `json:"uptime"`      // seconds since start
	Description string `json:"description"`
	LogFile     string `json:"logFile"`
	StdoutLog   string `json:"stdoutLog"`
	StderrLog   string `json:"stderrLog"`
	SpawnErr    string `json:"spawnErr,omitempty"`
	// Resource fields (populated separately via ps)
	CPU    float64 `json:"cpu"`    // percentage
	Memory int64   `json:"memory"` // RSS in bytes
}

// GetAllProcessInfo returns info for all supervised programs.
func (c *Client) GetAllProcessInfo() ([]ProcessInfo, error) {
	resp, err := c.call("supervisor.getAllProcessInfo")
	if err != nil {
		return nil, fmt.Errorf("getAllProcessInfo: %w", err)
	}

	var result struct {
		Params struct {
			Param struct {
				Value struct {
					Array struct {
						Data struct {
							Values []xmlValue `xml:"value"`
						} `xml:"data"`
					} `xml:"array"`
				} `xml:"value"`
			} `xml:"param"`
		} `xml:"params"`
	}
	if err := xml.Unmarshal(resp, &result); err != nil {
		return nil, fmt.Errorf("parse getAllProcessInfo: %w", err)
	}

	var processes []ProcessInfo
	for _, v := range result.Params.Param.Value.Array.Data.Values {
		p := parseProcessInfo(v)
		processes = append(processes, p)
	}
	return processes, nil
}

// StartProcess starts a supervisord program by name.
func (c *Client) StartProcess(name string) error {
	_, err := c.call("supervisor.startProcess", xmlStringParam(name), xmlBoolParam(true))
	if err != nil {
		return fmt.Errorf("startProcess %s: %w", name, err)
	}
	return nil
}

// StopProcess stops a supervisord program by name.
func (c *Client) StopProcess(name string) error {
	_, err := c.call("supervisor.stopProcess", xmlStringParam(name), xmlBoolParam(true))
	if err != nil {
		return fmt.Errorf("stopProcess %s: %w", name, err)
	}
	return nil
}

// RestartProcess stops then starts a supervisord program.
func (c *Client) RestartProcess(name string) error {
	// Try stop first (ignore error if already stopped)
	_ = c.StopProcess(name)
	// Wait briefly for clean shutdown
	time.Sleep(500 * time.Millisecond)
	return c.StartProcess(name)
}

// ReadLog reads the stdout log for a process.
// offset=0, length=0 reads all; negative offset reads from end.
func (c *Client) ReadLog(name string, offset, length int) (string, error) {
	resp, err := c.call("supervisor.readProcessStdoutLog",
		xmlStringParam(name), xmlIntParam(offset), xmlIntParam(length))
	if err != nil {
		return "", fmt.Errorf("readLog %s: %w", name, err)
	}
	return parseStringResponse(resp)
}

// ReadErrLog reads the stderr log for a process.
func (c *Client) ReadErrLog(name string, offset, length int) (string, error) {
	resp, err := c.call("supervisor.readProcessStderrLog",
		xmlStringParam(name), xmlIntParam(offset), xmlIntParam(length))
	if err != nil {
		return "", fmt.Errorf("readErrLog %s: %w", name, err)
	}
	return parseStringResponse(resp)
}

// TailLog reads the last `length` bytes of stdout log.
func (c *Client) TailLog(name string, offset, length int) (string, int, bool, error) {
	resp, err := c.call("supervisor.tailProcessStdoutLog",
		xmlStringParam(name), xmlIntParam(offset), xmlIntParam(length))
	if err != nil {
		return "", 0, false, fmt.Errorf("tailLog %s: %w", name, err)
	}
	return parseTailResponse(resp)
}

// TailErrLog reads the last `length` bytes of stderr log.
func (c *Client) TailErrLog(name string, offset, length int) (string, int, bool, error) {
	resp, err := c.call("supervisor.tailProcessStderrLog",
		xmlStringParam(name), xmlIntParam(offset), xmlIntParam(length))
	if err != nil {
		return "", 0, false, fmt.Errorf("tailErrLog %s: %w", name, err)
	}
	return parseTailResponse(resp)
}

// call executes an XML-RPC method call.
func (c *Client) call(method string, params ...string) ([]byte, error) {
	var paramXML string
	if len(params) > 0 {
		paramXML = "<params>"
		for _, p := range params {
			paramXML += "<param>" + p + "</param>"
		}
		paramXML += "</params>"
	}

	body := fmt.Sprintf(`<?xml version="1.0"?><methodCall><methodName>%s</methodName>%s</methodCall>`, method, paramXML)

	req, err := http.NewRequest("POST", c.cfg.URL, bytes.NewBufferString(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "text/xml")
	req.SetBasicAuth(c.cfg.Username, c.cfg.Password)

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("supervisord unreachable: %w", err)
	}
	defer resp.Body.Close()

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("supervisord HTTP %d: %s", resp.StatusCode, string(data))
	}

	// Check for XML-RPC fault
	if err := checkFault(data); err != nil {
		return nil, err
	}

	return data, nil
}

// XML-RPC helpers

func xmlStringParam(s string) string {
	return "<value><string>" + xmlEscape(s) + "</string></value>"
}

func xmlIntParam(i int) string {
	return "<value><int>" + strconv.Itoa(i) + "</int></value>"
}

func xmlBoolParam(b bool) string {
	v := "0"
	if b {
		v = "1"
	}
	return "<value><boolean>" + v + "</boolean></value>"
}

func xmlEscape(s string) string {
	var buf bytes.Buffer
	xml.EscapeText(&buf, []byte(s))
	return buf.String()
}

// xmlValue represents a raw XML value for deferred parsing.
type xmlValue struct {
	Inner []byte `xml:",innerxml"`
}

type xmlMember struct {
	Name  string `xml:"name"`
	Value struct {
		Str  string `xml:"string"`
		Int  string `xml:"int"`
		I4   string `xml:"i4"`
		Bool string `xml:"boolean"`
	} `xml:"value"`
}

type xmlStruct struct {
	Members []xmlMember `xml:"member"`
}

func parseProcessInfo(v xmlValue) ProcessInfo {
	var s xmlStruct
	// Wrap in <struct> if needed for parsing
	data := v.Inner
	if !bytes.Contains(data, []byte("<struct>")) {
		// The value might directly contain the struct
		xml.Unmarshal(append([]byte("<struct>"), append(data, []byte("</struct>")...)...), &s)
	} else {
		xml.Unmarshal(data, &s)
	}

	p := ProcessInfo{}
	var nowTS, startTS int64
	for _, m := range s.Members {
		switch m.Name {
		case "name":
			p.Name = m.Value.Str
		case "group":
			p.Group = m.Value.Str
		case "state":
			p.State = atoi(firstNonEmpty(m.Value.Int, m.Value.I4))
		case "statename":
			p.StateName = m.Value.Str
		case "pid":
			p.PID = atoi(firstNonEmpty(m.Value.Int, m.Value.I4))
		case "description":
			p.Description = m.Value.Str
		case "logfile":
			p.LogFile = m.Value.Str
		case "stdout_logfile":
			p.StdoutLog = m.Value.Str
		case "stderr_logfile":
			p.StderrLog = m.Value.Str
		case "spawnerr":
			p.SpawnErr = m.Value.Str
		case "now":
			nowTS = int64(atoi(firstNonEmpty(m.Value.Int, m.Value.I4)))
		case "start":
			startTS = int64(atoi(firstNonEmpty(m.Value.Int, m.Value.I4)))
		}
	}
	// Compute uptime from supervisord timestamps (avoids clock-skew vs time.Now)
	if startTS > 0 && nowTS > startTS {
		p.Uptime = nowTS - startTS
	} else if startTS > 0 {
		// Fallback: use local clock
		p.Uptime = time.Now().Unix() - startTS
		if p.Uptime < 0 {
			p.Uptime = 0
		}
	}
	return p
}

func parseStringResponse(data []byte) (string, error) {
	var result struct {
		Params struct {
			Param struct {
				Value struct {
					Str string `xml:"string"`
				} `xml:"value"`
			} `xml:"param"`
		} `xml:"params"`
	}
	if err := xml.Unmarshal(data, &result); err != nil {
		return "", err
	}
	return result.Params.Param.Value.Str, nil
}

func parseTailResponse(data []byte) (string, int, bool, error) {
	var result struct {
		Params struct {
			Param struct {
				Value struct {
					Array struct {
						Data struct {
							Values []struct {
								Str  string `xml:"string"`
								Int  string `xml:"int"`
								Bool string `xml:"boolean"`
							} `xml:"value"`
						} `xml:"data"`
					} `xml:"array"`
				} `xml:"value"`
			} `xml:"param"`
		} `xml:"params"`
	}
	if err := xml.Unmarshal(data, &result); err != nil {
		return "", 0, false, err
	}
	vals := result.Params.Param.Value.Array.Data.Values
	if len(vals) < 3 {
		return "", 0, false, fmt.Errorf("unexpected tail response format")
	}
	logContent := vals[0].Str
	offset := atoi(vals[1].Int)
	overflow := vals[2].Bool == "1" || vals[2].Bool == "true"
	return logContent, offset, overflow, nil
}

type xmlFault struct {
	XMLName xml.Name `xml:"methodResponse"`
	Fault   *struct {
		Value struct {
			Struct xmlStruct `xml:"struct"`
		} `xml:"value"`
	} `xml:"fault"`
}

func checkFault(data []byte) error {
	var f xmlFault
	if err := xml.Unmarshal(data, &f); err != nil {
		return nil // not a fault
	}
	if f.Fault == nil {
		return nil
	}
	faultString := "unknown error"
	for _, m := range f.Fault.Value.Struct.Members {
		if m.Name == "faultString" {
			faultString = m.Value.Str
		}
	}
	return fmt.Errorf("supervisord: %s", faultString)
}

func atoi(s string) int {
	s = strings.TrimSpace(s)
	n, _ := strconv.Atoi(s)
	return n
}

func firstNonEmpty(ss ...string) string {
	for _, s := range ss {
		if s != "" {
			return s
		}
	}
	return ""
}
