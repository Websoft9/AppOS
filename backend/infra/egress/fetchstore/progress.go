package fetchstore

const (
	PhaseStarting    = "starting"
	PhaseResuming    = "resuming"
	PhaseDownloading = "downloading"
	PhaseVerifying   = "verifying"
	PhaseCompleted   = "completed"
)

type Progress struct {
	Phase          string
	BytesCompleted int64
	BytesTotal     int64
	ChunkIndex     int
	ChunkCount     int
	SourceURL      string
}

func emitProgress(callback func(Progress), progress Progress) {
	if callback == nil {
		return
	}
	callback(progress)
}