package main

import (
	"bytes"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"unicode"
)

type swaggerSchemaHint struct {
	container   string
	dataType    string
	description string
}

func (h swaggerSchemaHint) normalizedType() string {
	return strings.TrimSpace(strings.TrimPrefix(h.dataType, "[]"))
}

func (h swaggerSchemaHint) isArray() bool {
	return strings.EqualFold(strings.TrimSpace(h.container), "array") || strings.HasPrefix(strings.TrimSpace(h.dataType), "[]")
}

func (h swaggerSchemaHint) isNil() bool {
	return strings.EqualFold(strings.TrimSpace(h.dataType), "nil")
}

func (h swaggerSchemaHint) isPrimitive() bool {
	_, ok := primitiveSchemaType(h.normalizedType())
	return ok
}

func (h swaggerSchemaHint) isMapLike() bool {
	t := strings.ToLower(strings.TrimSpace(h.normalizedType()))
	return strings.HasPrefix(t, "map[") || t == "interface{}" || t == "any"
}

func (h swaggerSchemaHint) isSchemaRef() bool {
	return !h.isNil() && !h.isPrimitive() && !h.isMapLike() && h.normalizedType() != ""
}

func schemaComponentName(raw string) string {
	name := strings.TrimSpace(raw)
	if name == "" {
		return ""
	}
	if idx := strings.LastIndex(name, "."); idx >= 0 {
		name = name[idx+1:]
	}
	runes := []rune(name)
	if len(runes) == 0 {
		return ""
	}
	runes[0] = unicode.ToUpper(runes[0])
	return string(runes)
}

func primitiveSchemaType(raw string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "string":
		return "string", true
	case "bool", "boolean":
		return "boolean", true
	case "int", "int8", "int16", "int32", "int64", "uint", "uint8", "uint16", "uint32", "uint64", "integer":
		return "integer", true
	case "float32", "float64", "float", "double", "number":
		return "number", true
	default:
		return "", false
	}
}

func parseDirsForSchemas(routeFiles []string) ([]string, error) {
	seen := map[string]struct{}{}
	out := make([]string, 0)
	for _, filePath := range routeFiles {
		dir := filepath.Dir(filePath)
		if _, ok := seen[dir]; ok {
			continue
		}
		seen[dir] = struct{}{}
		entries, err := os.ReadDir(dir)
		if err != nil {
			return nil, err
		}
		for _, entry := range entries {
			if entry.IsDir() {
				continue
			}
			name := entry.Name()
			if !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
				continue
			}
			out = append(out, filepath.Join(dir, name))
		}
	}
	sort.Strings(out)
	return out, nil
}

func collectSchemaTypeRefs(routes map[string]route) map[string]struct{} {
	refs := map[string]struct{}{}
	for _, op := range routes {
		collectSchemaHintRef(refs, op.bodySchema)
		for _, hint := range op.successSchemas {
			h := hint
			collectSchemaHintRef(refs, &h)
		}
		for _, hint := range op.failureSchemas {
			h := hint
			collectSchemaHintRef(refs, &h)
		}
	}
	return refs
}

func collectSchemaHintRef(refs map[string]struct{}, hint *swaggerSchemaHint) {
	if hint == nil || !hint.isSchemaRef() {
		return
	}
	refs[hint.normalizedType()] = struct{}{}
}

func buildSchemaComponents(schemaFiles []string, refs map[string]struct{}) ([]string, map[string]string, error) {
	if len(refs) == 0 {
		return nil, map[string]string{}, nil
	}
	typeExprs, err := parseTypeExpressions(schemaFiles)
	if err != nil {
		return nil, nil, err
	}
	refNames := make([]string, 0, len(refs))
	for name := range refs {
		refNames = append(refNames, name)
	}
	sort.Strings(refNames)

	blocks := make([]string, 0, len(refNames))
	componentNames := map[string]string{}
	for _, refName := range refNames {
		expr, ok := typeExprs[refName]
		if !ok {
			continue
		}
		componentName := schemaComponentName(refName)
		componentNames[refName] = componentName
		var buf bytes.Buffer
		fmt.Fprintf(&buf, "    %s:\n", componentName)
		writeTopLevelSchema(&buf, "      ", expr, typeExprs)
		blocks = append(blocks, buf.String())
	}
	return blocks, componentNames, nil
}

func parseTypeExpressions(schemaFiles []string) (map[string]ast.Expr, error) {
	fset := token.NewFileSet()
	out := map[string]ast.Expr{}
	for _, filePath := range schemaFiles {
		file, err := parser.ParseFile(fset, filePath, nil, parser.ParseComments)
		if err != nil {
			return nil, err
		}
		for _, decl := range file.Decls {
			genDecl, ok := decl.(*ast.GenDecl)
			if !ok || genDecl.Tok != token.TYPE {
				continue
			}
			for _, spec := range genDecl.Specs {
				typeSpec, ok := spec.(*ast.TypeSpec)
				if !ok {
					continue
				}
				out[typeSpec.Name.Name] = typeSpec.Type
			}
		}
	}
	return out, nil
}

func writeTopLevelSchema(buf *bytes.Buffer, indent string, expr ast.Expr, typeExprs map[string]ast.Expr) {
	writeSchemaExpr(buf, indent, expr, typeExprs)
}

func writeSchemaExpr(buf *bytes.Buffer, indent string, expr ast.Expr, typeExprs map[string]ast.Expr) {
	switch t := expr.(type) {
	case *ast.StructType:
		fmt.Fprintf(buf, "%stype: object\n", indent)
		if t.Fields == nil || len(t.Fields.List) == 0 {
			fmt.Fprintf(buf, "%sadditionalProperties: true\n", indent)
			return
		}
		fmt.Fprintf(buf, "%sproperties:\n", indent)
		for _, field := range t.Fields.List {
			if len(field.Names) == 0 {
				continue
			}
			fieldName, skip := jsonFieldName(field)
			if skip {
				continue
			}
			fmt.Fprintf(buf, "%s  %s:\n", indent, fieldName)
			writeSchemaExpr(buf, indent+"    ", field.Type, typeExprs)
		}
	case *ast.ArrayType:
		fmt.Fprintf(buf, "%stype: array\n", indent)
		fmt.Fprintf(buf, "%sitems:\n", indent)
		writeSchemaExpr(buf, indent+"  ", t.Elt, typeExprs)
	case *ast.MapType:
		fmt.Fprintf(buf, "%stype: object\n", indent)
		if isAnyExpr(t.Value) {
			fmt.Fprintf(buf, "%sadditionalProperties: true\n", indent)
			return
		}
		fmt.Fprintf(buf, "%sadditionalProperties:\n", indent)
		writeSchemaExpr(buf, indent+"  ", t.Value, typeExprs)
	case *ast.StarExpr:
		writeSchemaExpr(buf, indent, t.X, typeExprs)
	case *ast.SelectorExpr:
		if isTimeExpr(t) {
			fmt.Fprintf(buf, "%stype: string\n", indent)
			fmt.Fprintf(buf, "%sformat: date-time\n", indent)
			return
		}
		fmt.Fprintf(buf, "%stype: object\n", indent)
		fmt.Fprintf(buf, "%sadditionalProperties: true\n", indent)
	case *ast.InterfaceType:
		fmt.Fprintf(buf, "%stype: object\n", indent)
		fmt.Fprintf(buf, "%sadditionalProperties: true\n", indent)
	case *ast.Ident:
		if primitive, ok := primitiveSchemaType(t.Name); ok {
			fmt.Fprintf(buf, "%stype: %s\n", indent, primitive)
			return
		}
		if isAnyName(t.Name) {
			fmt.Fprintf(buf, "%stype: object\n", indent)
			fmt.Fprintf(buf, "%sadditionalProperties: true\n", indent)
			return
		}
		if _, ok := typeExprs[t.Name]; ok {
			fmt.Fprintf(buf, "%s$ref: '#/components/schemas/%s'\n", indent, schemaComponentName(t.Name))
			return
		}
		fmt.Fprintf(buf, "%stype: object\n", indent)
		fmt.Fprintf(buf, "%sadditionalProperties: true\n", indent)
	default:
		fmt.Fprintf(buf, "%stype: object\n", indent)
		fmt.Fprintf(buf, "%sadditionalProperties: true\n", indent)
	}
}

func jsonFieldName(field *ast.Field) (string, bool) {
	if field.Tag != nil {
		raw, err := strconv.Unquote(field.Tag.Value)
		if err == nil {
			tag := reflect.StructTag(raw).Get("json")
			if tag == "-" {
				return "", true
			}
			if tag != "" {
				name := strings.Split(tag, ",")[0]
				if name != "" {
					return name, false
				}
			}
		}
	}
	if len(field.Names) == 0 {
		return "", true
	}
	return lowerCamel(field.Names[0].Name), false
}

func lowerCamel(name string) string {
	if name == "" {
		return ""
	}
	runes := []rune(name)
	runes[0] = unicode.ToLower(runes[0])
	return string(runes)
}

func isTimeExpr(expr ast.Expr) bool {
	sel, ok := expr.(*ast.SelectorExpr)
	if !ok {
		return false
	}
	ident, ok := sel.X.(*ast.Ident)
	if !ok {
		return false
	}
	return ident.Name == "time" && sel.Sel.Name == "Time"
}

func isAnyExpr(expr ast.Expr) bool {
	ident, ok := expr.(*ast.Ident)
	if !ok {
		return false
	}
	return isAnyName(ident.Name)
}

func isAnyName(name string) bool {
	trimmed := strings.TrimSpace(name)
	return trimmed == "any" || trimmed == "interface{}"
}

func renderSchemaRef(buf *bytes.Buffer, indent string, hint *swaggerSchemaHint, componentNames map[string]string, fallbackRef string) {
	if hint == nil {
		fmt.Fprintf(buf, "%s$ref: '#/components/schemas/%s'\n", indent, fallbackRef)
		return
	}
	if hint.isNil() {
		fmt.Fprintf(buf, "%stype: object\n", indent)
		fmt.Fprintf(buf, "%snullable: true\n", indent)
		return
	}
	if hint.isArray() {
		fmt.Fprintf(buf, "%stype: array\n", indent)
		fmt.Fprintf(buf, "%sitems:\n", indent)
		itemHint := &swaggerSchemaHint{container: "object", dataType: hint.normalizedType()}
		renderSchemaRef(buf, indent+"  ", itemHint, componentNames, fallbackRef)
		return
	}
	if primitive, ok := primitiveSchemaType(hint.normalizedType()); ok {
		fmt.Fprintf(buf, "%stype: %s\n", indent, primitive)
		return
	}
	if hint.isMapLike() {
		fmt.Fprintf(buf, "%stype: object\n", indent)
		fmt.Fprintf(buf, "%sadditionalProperties: true\n", indent)
		return
	}
	if componentName, ok := componentNames[hint.normalizedType()]; ok {
		fmt.Fprintf(buf, "%s$ref: '#/components/schemas/%s'\n", indent, componentName)
		return
	}
	fmt.Fprintf(buf, "%s$ref: '#/components/schemas/%s'\n", indent, fallbackRef)
}
