package feeds

import (
	"context"
	"encoding/xml"
	"fmt"
	"html"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/websoft9/appos/backend/infra/safefetch"
)

const maxFeedFetchBytes int64 = 2 * 1024 * 1024

type HTTPDoer interface {
	Do(req *http.Request) (*http.Response, error)
}

var htmlTagPattern = regexp.MustCompile(`<[^>]+>`)

type rssDocument struct {
	Channel struct {
		Title string    `xml:"title"`
		Link  string    `xml:"link"`
		Items []rssItem `xml:"item"`
	} `xml:"channel"`
}

type rssItem struct {
	GUID        string `xml:"guid"`
	Title       string `xml:"title"`
	Link        string `xml:"link"`
	Description string `xml:"description"`
	Content     string `xml:"http://purl.org/rss/1.0/modules/content/ encoded"`
	Encoded     string `xml:"encoded"`
	PubDate     string `xml:"pubDate"`
	Updated     string `xml:"updated"`
}

type atomDocument struct {
	Title    string      `xml:"title"`
	SubTitle string      `xml:"subtitle"`
	Links    []atomLink  `xml:"link"`
	Entries []atomEntry `xml:"entry"`
}

type atomEntry struct {
	ID        string        `xml:"id"`
	Title     string        `xml:"title"`
	Summary   atomTextValue `xml:"summary"`
	Content   atomTextValue `xml:"content"`
	Published string        `xml:"published"`
	Updated   string        `xml:"updated"`
	Links     []atomLink    `xml:"link"`
}

type atomTextValue struct {
	Type     string `xml:"type,attr"`
	InnerXML string `xml:",innerxml"`
	Text     string `xml:",chardata"`
}

type atomLink struct {
	Href string `xml:"href,attr"`
	Rel  string `xml:"rel,attr"`
}

type SourceAnalysis struct {
	Name    string `json:"name"`
	FeedURL string `json:"feed_url"`
	SiteURL string `json:"site_url"`
	SiteTitle string `json:"site_title"`
	FaviconURL string `json:"favicon_url"`
	Format  string `json:"format"`
}

type xmlRoot struct {
	XMLName xml.Name
}

func AnalyzeSource(ctx context.Context, feedURL string, client HTTPDoer) (SourceAnalysis, error) {
	data, resolvedURL, err := fetchFeedBytes(ctx, feedURL, client)
	if err != nil {
		return SourceAnalysis{}, err
	}
	analysis, err := AnalyzeFeedBytes(resolvedURL, data)
	if err != nil {
		return SourceAnalysis{}, err
	}

	if strings.TrimSpace(analysis.SiteURL) != "" {
		websiteAnalysis, websiteErr := AnalyzeBookmark(ctx, analysis.SiteURL, client)
		if websiteErr == nil {
			if faviconURL := strings.TrimSpace(websiteAnalysis.FaviconURL); faviconURL != "" {
				analysis.FaviconURL = faviconURL
			}
		}
	}

	return analysis, nil
}

func FetchAndParseSource(ctx context.Context, source SourceSnapshot, client HTTPDoer) ([]ItemCandidate, error) {
	data, _, err := fetchFeedBytes(ctx, source.URL, client)
	if err != nil {
		return nil, err
	}

	return ParseFeedBytes(source.Format, data)
}

func fetchFeedBytes(ctx context.Context, rawURL string, client HTTPDoer) ([]byte, string, error) {
	if strings.TrimSpace(rawURL) == "" {
		return nil, "", fmt.Errorf("feed source url is required")
	}
	if _, err := safefetch.ValidateURL(rawURL); err != nil {
		return nil, "", err
	}
	if client == nil {
		client = safefetch.NewClient()
	}
	if ctx == nil {
		ctx = context.Background()
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, "", fmt.Errorf("build feed request: %w", err)
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, "", fmt.Errorf("fetch feed source: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return nil, "", fmt.Errorf("feed source returned HTTP %d", resp.StatusCode)
	}

	data, err := io.ReadAll(io.LimitReader(resp.Body, maxFeedFetchBytes+1))
	if err != nil {
		return nil, "", fmt.Errorf("read feed source: %w", err)
	}
	if int64(len(data)) > maxFeedFetchBytes {
		return nil, "", fmt.Errorf("feed source exceeded %d byte limit", maxFeedFetchBytes)
	}

	resolvedURL := strings.TrimSpace(rawURL)
	if resp.Request != nil && resp.Request.URL != nil {
		resolvedURL = resp.Request.URL.String()
	}

	return data, resolvedURL, nil
}

func AnalyzeFeedBytes(feedURL string, data []byte) (SourceAnalysis, error) {
	format, err := detectFeedFormat(data)
	if err != nil {
		return SourceAnalysis{}, err
	}

	analysis := SourceAnalysis{
		Name:    deriveSourceName(feedURL),
		FeedURL: strings.TrimSpace(feedURL),
		Format:  format,
	}

	switch format {
	case FormatRSS:
		var doc rssDocument
		if err := xml.Unmarshal(data, &doc); err != nil {
			return SourceAnalysis{}, fmt.Errorf("parse rss: %w", err)
		}
		if title := strings.TrimSpace(doc.Channel.Title); title != "" {
			analysis.Name = title
			analysis.SiteTitle = title
		}
		analysis.SiteURL = strings.TrimSpace(doc.Channel.Link)
	case FormatAtom:
		var doc atomDocument
		if err := xml.Unmarshal(data, &doc); err != nil {
			return SourceAnalysis{}, fmt.Errorf("parse atom: %w", err)
		}
		if title := strings.TrimSpace(doc.Title); title != "" {
			analysis.Name = title
			analysis.SiteTitle = title
		}
		analysis.SiteURL = strings.TrimSpace(pickAtomLink(doc.Links))
	}

	if analysis.SiteURL == "" {
		analysis.SiteURL = deriveSiteURL(analysis.FeedURL)
	}
	if analysis.SiteTitle == "" {
		analysis.SiteTitle = analysis.Name
	}
	if siteBase, err := safefetch.ValidateURL(analysis.SiteURL); err == nil {
		analysis.FaviconURL = defaultFaviconURL(siteBase)
	}

	return analysis, nil
}

func ParseFeedBytes(format string, data []byte) ([]ItemCandidate, error) {
	switch strings.TrimSpace(strings.ToLower(format)) {
	case FormatRSS:
		return parseRSS(data)
	case FormatAtom:
		return parseAtom(data)
	default:
		return nil, fmt.Errorf("unsupported feed format %q", format)
	}
}

func parseRSS(data []byte) ([]ItemCandidate, error) {
	var doc rssDocument
	if err := xml.Unmarshal(data, &doc); err != nil {
		return nil, fmt.Errorf("parse rss: %w", err)
	}

	items := make([]ItemCandidate, 0, len(doc.Channel.Items))
	for _, item := range doc.Channel.Items {
		publishedAt := parseFeedTime(item.PubDate)
		if publishedAt.IsZero() {
			publishedAt = parseFeedTime(item.Updated)
		}
		items = append(items, ItemCandidate{
			SourceItemID: strings.TrimSpace(item.GUID),
			Link:         strings.TrimSpace(item.Link),
			Title:        strings.TrimSpace(item.Title),
			Summary:      sanitizeSummary(item.Description),
			ContentRaw:   coalesceFeedContent(rssContentRaw(item), item.Description),
			PublishedAt:  publishedAt,
		})
	}
	return items, nil
}

func parseAtom(data []byte) ([]ItemCandidate, error) {
	var doc atomDocument
	if err := xml.Unmarshal(data, &doc); err != nil {
		return nil, fmt.Errorf("parse atom: %w", err)
	}

	items := make([]ItemCandidate, 0, len(doc.Entries))
	for _, entry := range doc.Entries {
		summary := atomPlainText(entry.Summary)
		if strings.TrimSpace(summary) == "" {
			summary = atomPlainText(entry.Content)
		}
		publishedAt := parseFeedTime(entry.Published)
		if publishedAt.IsZero() {
			publishedAt = parseFeedTime(entry.Updated)
		}
		items = append(items, ItemCandidate{
			SourceItemID: strings.TrimSpace(entry.ID),
			Link:         pickAtomLink(entry.Links),
			Title:        strings.TrimSpace(entry.Title),
			Summary:      sanitizeSummary(summary),
			ContentRaw:   coalesceFeedContent(atomContentRaw(entry.Content), atomContentRaw(entry.Summary)),
			PublishedAt:  publishedAt,
		})
	}
	return items, nil
}

func rssContentRaw(item rssItem) string {
	return coalesceFeedContent(item.Content, item.Encoded)
}

func atomContentRaw(value atomTextValue) string {
	typeName := strings.TrimSpace(strings.ToLower(value.Type))
	raw := strings.TrimSpace(value.InnerXML)
	if raw == "" {
		raw = strings.TrimSpace(value.Text)
	}
	if raw == "" {
		return ""
	}
	if typeName == "html" {
		return strings.TrimSpace(html.UnescapeString(raw))
	}
	return raw
}

func atomPlainText(value atomTextValue) string {
	raw := atomContentRaw(value)
	if raw != "" {
		return raw
	}
	return strings.TrimSpace(value.Text)
}

func coalesceFeedContent(values ...string) string {
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func pickAtomLink(links []atomLink) string {
	for _, link := range links {
		if href := strings.TrimSpace(link.Href); href != "" && (link.Rel == "" || link.Rel == "alternate") {
			return href
		}
	}
	for _, link := range links {
		if href := strings.TrimSpace(link.Href); href != "" {
			return href
		}
	}
	return ""
}

func sanitizeSummary(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}
	plain := html.UnescapeString(trimmed)
	plain = htmlTagPattern.ReplaceAllString(plain, " ")
	plain = strings.Join(strings.Fields(plain), " ")
	plain = strings.NewReplacer(" .", ".", " ,", ",", " ;", ";", " :", ":", " !", "!", " ?", "?").Replace(plain)
	return plain
}

func parseFeedTime(value string) time.Time {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return time.Time{}
	}
	layouts := []string{
		time.RFC3339,
		time.RFC3339Nano,
		time.RFC1123Z,
		time.RFC1123,
		time.RFC822Z,
		time.RFC822,
		time.RFC850,
		"Mon, 02 Jan 2006 15:04:05 MST",
	}
	for _, layout := range layouts {
		if parsed, err := time.Parse(layout, trimmed); err == nil {
			return parsed.UTC()
		}
	}
	return time.Time{}
}

func detectFeedFormat(data []byte) (string, error) {
	var root xmlRoot
	if err := xml.Unmarshal(data, &root); err != nil {
		return "", fmt.Errorf("parse feed root: %w", err)
	}

	switch strings.ToLower(strings.TrimSpace(root.XMLName.Local)) {
	case "rss", "rdf":
		return FormatRSS, nil
	case "feed":
		return FormatAtom, nil
	default:
		return "", fmt.Errorf("unsupported feed format %q", root.XMLName.Local)
	}
}

func deriveSourceName(feedURL string) string {
	trimmed := strings.TrimSpace(feedURL)
	if trimmed == "" {
		return ""
	}
	parsed, err := safefetch.ValidateURL(trimmed)
	if err != nil {
		return trimmed
	}
	host := strings.TrimSpace(parsed.Hostname())
	if host == "" {
		return trimmed
	}
	return host
}

func deriveSiteURL(feedURL string) string {
	trimmed := strings.TrimSpace(feedURL)
	if trimmed == "" {
		return ""
	}
	parsed, err := safefetch.ValidateURL(trimmed)
	if err != nil {
		return ""
	}
	if parsed.Scheme == "" || parsed.Host == "" {
		return ""
	}
	return parsed.Scheme + "://" + parsed.Host
}