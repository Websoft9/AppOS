package feeds

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"golang.org/x/net/html"

	"github.com/websoft9/appos/backend/infra/safefetch"
)

const maxBookmarkFetchBytes int64 = 1 * 1024 * 1024

type BookmarkAnalysis struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	FaviconURL  string `json:"favicon_url"`
	ResolvedURL string `json:"resolved_url"`
}

func AnalyzeBookmark(ctx context.Context, rawURL string, client HTTPDoer) (BookmarkAnalysis, error) {
	data, resolvedURL, err := fetchBookmarkBytes(ctx, rawURL, client)
	if err != nil {
		return BookmarkAnalysis{}, err
	}

	analysis, err := AnalyzeBookmarkBytes(resolvedURL, data)
	if err != nil {
		return BookmarkAnalysis{}, err
	}
	analysis.ResolvedURL = resolvedURL
	return analysis, nil
}

func fetchBookmarkBytes(ctx context.Context, rawURL string, client HTTPDoer) ([]byte, string, error) {
	if strings.TrimSpace(rawURL) == "" {
		return nil, "", fmt.Errorf("bookmark url is required")
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
		return nil, "", fmt.Errorf("build bookmark request: %w", err)
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, "", fmt.Errorf("fetch bookmark url: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return nil, "", fmt.Errorf("bookmark url returned HTTP %d", resp.StatusCode)
	}

	data, err := io.ReadAll(io.LimitReader(resp.Body, maxBookmarkFetchBytes+1))
	if err != nil {
		return nil, "", fmt.Errorf("read bookmark page: %w", err)
	}
	if int64(len(data)) > maxBookmarkFetchBytes {
		return nil, "", fmt.Errorf("bookmark page exceeded %d byte limit", maxBookmarkFetchBytes)
	}

	resolvedURL := strings.TrimSpace(rawURL)
	if resp.Request != nil && resp.Request.URL != nil {
		resolvedURL = resp.Request.URL.String()
	}

	return data, resolvedURL, nil
}

func AnalyzeBookmarkBytes(pageURL string, data []byte) (BookmarkAnalysis, error) {
	base, err := safefetch.ValidateURL(pageURL)
	if err != nil {
		return BookmarkAnalysis{}, err
	}

	tokenizer := html.NewTokenizer(strings.NewReader(string(data)))
	analysis := BookmarkAnalysis{}
	var inTitle bool

	for {
		tt := tokenizer.Next()
		switch tt {
		case html.ErrorToken:
			if tokenizer.Err() == io.EOF {
				if analysis.FaviconURL == "" {
					analysis.FaviconURL = defaultFaviconURL(base)
				}
				return analysis, nil
			}
			return BookmarkAnalysis{}, fmt.Errorf("parse bookmark html: %w", tokenizer.Err())
		case html.StartTagToken, html.SelfClosingTagToken:
			token := tokenizer.Token()
			switch strings.ToLower(token.Data) {
			case "title":
				inTitle = true
			case "meta":
				name := strings.ToLower(strings.TrimSpace(getHTMLAttr(token, "name")))
				property := strings.ToLower(strings.TrimSpace(getHTMLAttr(token, "property")))
				content := strings.TrimSpace(html.UnescapeString(getHTMLAttr(token, "content")))
				if content == "" {
					continue
				}
				if property == "og:title" {
					analysis.Title = normalizeMetadataText(content)
				}
				if analysis.Description == "" && (name == "description" || property == "og:description") {
					analysis.Description = normalizeMetadataText(content)
				}
			case "link":
				if analysis.FaviconURL != "" {
					continue
				}
				rel := strings.ToLower(strings.TrimSpace(getHTMLAttr(token, "rel")))
				href := strings.TrimSpace(getHTMLAttr(token, "href"))
				if href == "" || !looksLikeFaviconRel(rel) {
					continue
				}
				analysis.FaviconURL = resolveRelativeURL(base, href)
			}
		case html.TextToken:
			if !inTitle || analysis.Title != "" {
				continue
			}
			text := normalizeMetadataText(string(tokenizer.Text()))
			if text != "" {
				analysis.Title = text
			}
		case html.EndTagToken:
			token := tokenizer.Token()
			if strings.EqualFold(token.Data, "title") {
				inTitle = false
			}
		}
	}
}

func getHTMLAttr(token html.Token, name string) string {
	for _, attr := range token.Attr {
		if strings.EqualFold(attr.Key, name) {
			return attr.Val
		}
	}
	return ""
}

func looksLikeFaviconRel(rel string) bool {
	if rel == "" {
		return false
	}
	return strings.Contains(rel, "icon")
}

func resolveRelativeURL(base *url.URL, raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ""
	}
	parsed, err := url.Parse(trimmed)
	if err != nil {
		return ""
	}
	return base.ResolveReference(parsed).String()
}

func defaultFaviconURL(base *url.URL) string {
	if base == nil {
		return ""
	}
	return base.ResolveReference(&url.URL{Path: "/favicon.ico"}).String()
}

func normalizeMetadataText(value string) string {
	return strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
}
