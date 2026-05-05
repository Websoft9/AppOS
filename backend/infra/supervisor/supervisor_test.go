package supervisor

import (
	"strings"
	"testing"
)

// ─── atoi ────────────────────────────────────────────────────────────────────

func TestAtoi(t *testing.T) {
	cases := []struct {
		in   string
		want int
	}{
		{"0", 0},
		{"1", 1},
		{"42", 42},
		{"-7", -7},
		{"  10  ", 10}, // leading/trailing whitespace
		{"", 0},
		{"abc", 0},
		{"3.14", 0},
	}
	for _, tc := range cases {
		got := atoi(tc.in)
		if got != tc.want {
			t.Errorf("atoi(%q) = %d, want %d", tc.in, got, tc.want)
		}
	}
}

// ─── firstNonEmpty ────────────────────────────────────────────────────────────

func TestFirstNonEmpty(t *testing.T) {
	cases := []struct {
		in   []string
		want string
	}{
		{[]string{"a", "b"}, "a"},
		{[]string{"", "b"}, "b"},
		{[]string{"", "", "c"}, "c"},
		{[]string{"", "", ""}, ""},
		{[]string{}, ""},
		{[]string{"only"}, "only"},
	}
	for _, tc := range cases {
		got := firstNonEmpty(tc.in...)
		if got != tc.want {
			t.Errorf("firstNonEmpty(%v) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

// ─── xmlEscape ───────────────────────────────────────────────────────────────

func TestXmlEscape(t *testing.T) {
	cases := []struct {
		in      string
		wantSub string // substring that must appear in output
		notSub  string // substring that must NOT appear (empty = skip)
	}{
		{"hello", "hello", ""},
		{"<tag>", "&lt;tag&gt;", "<"},
		{"a&b", "a&amp;b", "&b"},
		{`a"b`, `a&#34;b`, `"`},
		{"plain text", "plain text", ""},
	}
	for _, tc := range cases {
		got := xmlEscape(tc.in)
		if !strings.Contains(got, tc.wantSub) {
			t.Errorf("xmlEscape(%q) = %q; want it to contain %q", tc.in, got, tc.wantSub)
		}
		if tc.notSub != "" && strings.Contains(got, tc.notSub) {
			t.Errorf("xmlEscape(%q) = %q; should not contain raw %q", tc.in, got, tc.notSub)
		}
	}
}

// ─── parseRSS ─────────────────────────────────────────────────────────────────

func TestParseRSS(t *testing.T) {
	cases := []struct {
		in   string
		want int64
	}{
		// Plain KB (default)
		{"1024", 1024 * 1024},
		{"0", 0},
		// Explicit k suffix
		{"512k", 512 * 1024},
		{"512K", 512 * 1024},
		// Megabytes
		{"25m", 25 * 1024 * 1024},
		{"25M", 25 * 1024 * 1024},
		// Gigabytes
		{"2g", 2 * 1024 * 1024 * 1024},
		{"2G", 2 * 1024 * 1024 * 1024},
		// Edge cases
		{"", 0},
		{"  ", 0},
		{"abc", 0},
	}
	for _, tc := range cases {
		got := parseRSS(tc.in)
		if got != tc.want {
			t.Errorf("parseRSS(%q) = %d, want %d", tc.in, got, tc.want)
		}
	}
}

// ─── checkFault ──────────────────────────────────────────────────────────────

func TestCheckFault_NoFault(t *testing.T) {
	// A normal success response should return nil.
	data := []byte(`<?xml version="1.0"?>
<methodResponse>
  <params><param><value><string>OK</string></value></param></params>
</methodResponse>`)
	if err := checkFault(data); err != nil {
		t.Errorf("checkFault(success) = %v, want nil", err)
	}
}

func TestCheckFault_WithFault(t *testing.T) {
	// A fault response must produce a non-nil error mentioning the faultString.
	data := []byte(`<?xml version="1.0"?>
<methodResponse>
  <fault>
    <value>
      <struct>
        <member><name>faultCode</name><value><int>42</int></value></member>
        <member><name>faultString</name><value><string>BAD_NAME</string></value></member>
      </struct>
    </value>
  </fault>
</methodResponse>`)
	err := checkFault(data)
	if err == nil {
		t.Fatal("checkFault(fault response) = nil, want error")
	}
	if !strings.Contains(err.Error(), "BAD_NAME") {
		t.Errorf("error %q should mention faultString BAD_NAME", err.Error())
	}
}

func TestCheckFault_InvalidXML(t *testing.T) {
	// Non-XML input should not return an error (treated as non-fault).
	err := checkFault([]byte("not xml at all"))
	if err != nil {
		t.Errorf("checkFault(invalid XML) = %v, want nil", err)
	}
}

// ─── parseStringResponse ─────────────────────────────────────────────────────

func TestParseStringResponse(t *testing.T) {
	data := []byte(`<?xml version="1.0"?>
<methodResponse>
  <params>
    <param>
      <value><string>hello world</string></value>
    </param>
  </params>
</methodResponse>`)
	got, err := parseStringResponse(data)
	if err != nil {
		t.Fatalf("parseStringResponse: %v", err)
	}
	if got != "hello world" {
		t.Errorf("got %q, want %q", got, "hello world")
	}
}

func TestParseStringResponse_Empty(t *testing.T) {
	data := []byte(`<?xml version="1.0"?>
<methodResponse>
  <params>
    <param>
      <value><string></string></value>
    </param>
  </params>
</methodResponse>`)
	got, err := parseStringResponse(data)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "" {
		t.Errorf("got %q, want empty string", got)
	}
}

func TestParseStringResponse_InvalidXML(t *testing.T) {
	_, err := parseStringResponse([]byte("not xml"))
	if err == nil {
		t.Error("expected error for invalid XML")
	}
}

// ─── parseTailResponse ───────────────────────────────────────────────────────

func TestParseTailResponse_Valid(t *testing.T) {
	data := []byte(`<?xml version="1.0"?>
<methodResponse>
  <params>
    <param>
      <value>
        <array>
          <data>
            <value><string>log content here</string></value>
            <value><int>4096</int></value>
            <value><boolean>0</boolean></value>
          </data>
        </array>
      </value>
    </param>
  </params>
</methodResponse>`)
	content, offset, overflow, err := parseTailResponse(data)
	if err != nil {
		t.Fatalf("parseTailResponse: %v", err)
	}
	if content != "log content here" {
		t.Errorf("content = %q, want %q", content, "log content here")
	}
	if offset != 4096 {
		t.Errorf("offset = %d, want 4096", offset)
	}
	if overflow {
		t.Error("overflow = true, want false")
	}
}

func TestParseTailResponse_Overflow(t *testing.T) {
	data := []byte(`<?xml version="1.0"?>
<methodResponse>
  <params>
    <param>
      <value>
        <array>
          <data>
            <value><string>lots of logs</string></value>
            <value><int>8192</int></value>
            <value><boolean>1</boolean></value>
          </data>
        </array>
      </value>
    </param>
  </params>
</methodResponse>`)
	_, _, overflow, err := parseTailResponse(data)
	if err != nil {
		t.Fatalf("parseTailResponse: %v", err)
	}
	if !overflow {
		t.Error("overflow = false, want true")
	}
}

func TestParseTailResponse_TooFewValues(t *testing.T) {
	data := []byte(`<?xml version="1.0"?>
<methodResponse>
  <params>
    <param>
      <value>
        <array>
          <data>
            <value><string>only one value</string></value>
          </data>
        </array>
      </value>
    </param>
  </params>
</methodResponse>`)
	_, _, _, err := parseTailResponse(data)
	if err == nil {
		t.Error("expected error for fewer than 3 values in tail response")
	}
}

func TestParseTailResponse_InvalidXML(t *testing.T) {
	_, _, _, err := parseTailResponse([]byte("not xml"))
	if err == nil {
		t.Error("expected error for invalid XML")
	}
}

// ─── parseProcessInfo ────────────────────────────────────────────────────────

func TestParseProcessInfo_FullStruct(t *testing.T) {
	// Build an xmlValue that looks like what supervisord returns for a process.
	inner := []byte(`<struct>
  <member><name>name</name><value><string>myapp</string></value></member>
  <member><name>group</name><value><string>mygroup</string></value></member>
  <member><name>state</name><value><int>20</int></value></member>
  <member><name>statename</name><value><string>RUNNING</string></value></member>
  <member><name>pid</name><value><int>12345</int></value></member>
  <member><name>description</name><value><string>pid 12345, uptime 1:00:00</string></value></member>
  <member><name>logfile</name><value><string>/var/log/myapp.log</string></value></member>
  <member><name>stdout_logfile</name><value><string>/var/log/myapp.stdout</string></value></member>
  <member><name>stderr_logfile</name><value><string>/var/log/myapp.stderr</string></value></member>
  <member><name>spawnerr</name><value><string></string></value></member>
  <member><name>now</name><value><int>1700000100</int></value></member>
  <member><name>start</name><value><int>1700000000</int></value></member>
</struct>`)

	v := xmlValue{Inner: inner}
	p := parseProcessInfo(v)

	if p.Name != "myapp" {
		t.Errorf("Name = %q, want %q", p.Name, "myapp")
	}
	if p.Group != "mygroup" {
		t.Errorf("Group = %q, want %q", p.Group, "mygroup")
	}
	if p.State != 20 {
		t.Errorf("State = %d, want 20", p.State)
	}
	if p.StateName != "RUNNING" {
		t.Errorf("StateName = %q, want %q", p.StateName, "RUNNING")
	}
	if p.PID != 12345 {
		t.Errorf("PID = %d, want 12345", p.PID)
	}
	if p.LogFile != "/var/log/myapp.log" {
		t.Errorf("LogFile = %q, want %q", p.LogFile, "/var/log/myapp.log")
	}
	if p.StdoutLog != "/var/log/myapp.stdout" {
		t.Errorf("StdoutLog = %q", p.StdoutLog)
	}
	if p.StderrLog != "/var/log/myapp.stderr" {
		t.Errorf("StderrLog = %q", p.StderrLog)
	}
	// uptime = now - start = 100
	if p.Uptime != 100 {
		t.Errorf("Uptime = %d, want 100", p.Uptime)
	}
}

func TestParseProcessInfo_UptimeZeroWhenNoStart(t *testing.T) {
	inner := []byte(`<struct>
  <member><name>name</name><value><string>idle</string></value></member>
  <member><name>state</name><value><int>0</int></value></member>
</struct>`)

	v := xmlValue{Inner: inner}
	p := parseProcessInfo(v)

	if p.Uptime != 0 {
		t.Errorf("Uptime = %d, want 0 when start is missing", p.Uptime)
	}
}

func TestParseProcessInfo_EmptyInput(t *testing.T) {
	// Must not panic on empty inner XML.
	v := xmlValue{Inner: []byte("")}
	p := parseProcessInfo(v)
	if p.Name != "" {
		t.Errorf("expected empty ProcessInfo for empty input, got Name=%q", p.Name)
	}
}
