import { useEffect, useState } from 'react'
import * as jsYaml from 'js-yaml'

export type YamlValidationResult =
  | { valid: true; hasServices: boolean }
  | { valid: false; message: string; line?: number }

/** Validates YAML text (debounced). Returns null while the input is empty. */
export function useYamlValidation(yaml: string, debounceMs = 400): YamlValidationResult | null {
  const [result, setResult] = useState<YamlValidationResult | null>(null)

  useEffect(() => {
    const trimmed = yaml.trim()
    if (!trimmed) {
      setResult(null)
      return
    }

    const timer = window.setTimeout(() => {
      try {
        const doc = jsYaml.load(trimmed)
        const hasServices =
          doc !== null &&
          typeof doc === 'object' &&
          !Array.isArray(doc) &&
          'services' in (doc as object)
        setResult({ valid: true, hasServices })
      } catch (err) {
        if (err instanceof jsYaml.YAMLException) {
          setResult({
            valid: false,
            message: err.reason ?? err.message,
            line: err.mark?.line !== undefined ? err.mark.line + 1 : undefined,
          })
        } else {
          setResult({ valid: false, message: 'Invalid YAML' })
        }
      }
    }, debounceMs)

    return () => window.clearTimeout(timer)
  }, [yaml, debounceMs])

  return result
}
