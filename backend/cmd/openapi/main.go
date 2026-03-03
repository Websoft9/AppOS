package main

import (
	"fmt"
	"os"
)

func main() {
	if len(os.Args) < 2 {
		printUsage()
		os.Exit(1)
	}

	var err error
	switch os.Args[1] {
	case "gen":
		err = runGen()
	case "merge":
		err = runMerge()
	case "sync":
		if err = runGen(); err == nil {
			err = runMerge()
		}
	default:
		printUsage()
		os.Exit(1)
	}

	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func printUsage() {
	fmt.Fprintln(os.Stderr, "Usage: go run ./cmd/openapi <gen|merge|sync>")
}
