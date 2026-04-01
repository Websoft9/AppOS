package routes

import "testing"

func TestTunnelSSHPortFromServices(t *testing.T) {
	tests := []struct {
		name    string
		raw     string
		want    int
		wantErr bool
	}{
		{
			name:    "valid ssh service",
			raw:     `[{"service_name":"ssh","tunnel_port":42001},{"service_name":"http","tunnel_port":42002}]`,
			want:    42001,
			wantErr: false,
		},
		{
			name:    "missing ssh service",
			raw:     `[{"service_name":"http","tunnel_port":42002}]`,
			want:    0,
			wantErr: true,
		},
		{
			name:    "empty services",
			raw:     ``,
			want:    0,
			wantErr: true,
		},
		{
			name:    "invalid json",
			raw:     `{bad json}`,
			want:    0,
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := tunnelSSHPortFromServices(tt.raw)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tt.want {
				t.Fatalf("got %d, want %d", got, tt.want)
			}
		})
	}
}
