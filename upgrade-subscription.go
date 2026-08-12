package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"strings"
)

const keysURL = "https://libs.websoft9.com/test-key.json"

type keysPayload struct {
	Keys []string `json:"keys"`
}

func fetchKeys(url string) ([]string, error) {
	resp, err := http.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("获取 keys 失败，HTTP 状态码: %d", resp.StatusCode)
	}

	var payload keysPayload
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, fmt.Errorf("解析 keys 响应失败: %w", err)
	}
	return payload.Keys, nil
}

func contains(haystack []string, needle string) bool {
	for _, s := range haystack {
		if s == needle {
			return true
		}
	}
	return false
}

func promptKey() (string, error) {
	fmt.Print("请输入您的升级 key: ")
	reader := bufio.NewReader(os.Stdin)
	input, err := reader.ReadString('\n')
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(input), nil
}

func runUpgrade() error {
	cmd := exec.Command("docker", "exec", "-it", "websoft9", "websoft9", "setedition", "standard")
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

func main() {
	keys, err := fetchKeys(keysURL)
	if err != nil {
		fmt.Fprintln(os.Stderr, "错误:", err)
		os.Exit(1)
	}

	key, err := promptKey()
	if err != nil {
		fmt.Fprintln(os.Stderr, "错误: 读取 key 失败:", err)
		os.Exit(1)
	}

	if !contains(keys, key) {
		fmt.Println("key 错误，无法升级。请检查后重试。")
		os.Exit(1)
	}

	fmt.Println("key 匹配成功，正在执行升级...")
	if err := runUpgrade(); err != nil {
		fmt.Fprintln(os.Stderr, "错误: 执行升级失败:", err)
		os.Exit(1)
	}
	fmt.Println("升级完成。")
}
