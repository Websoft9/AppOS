# LLM Template Metadata

This directory defines built-in AI provider templates for LLM integrations.

The UI should group providers by `uiGroup`, while backend and frontend logic can use the remaining metadata as secondary labels.

## Metadata Fields

| Field | Type | Allowed Values | Purpose |
| --- | --- | --- | --- |
| `uiGroup` | string | `single_provider`, `cloud_gateway`, `self_hosted` | Primary product-facing grouping shown to users. |
| `hostingMode` | string | `cloud`, `self_hosted`, `hybrid` | Whether the service runs as vendor cloud, local runtime, or can reasonably be either. |
| `serviceMode` | string | `official_provider`, `maas_platform`, `gateway`, `inference_runtime`, `compat_proxy` | Technical/business shape of the service behind the template. |
| `endpointMode` | string | `fixed`, `customizable`, `user_supplied` | How the endpoint field should be treated in the UI. |
| `defaultAuthScheme` | string | `bearer`, `api_key`, `none` | Canonical auth transport used by runtime and fetch-model flows. |
| `providerMode` | string | `vendor`, `gateway` | Whether the template behaves like a direct provider or a model gateway in product UX. |
| `supportsClosedModels` | boolean | `true`, `false` | Whether the service can expose proprietary / closed-weight models, not only open-weight models. |
| `supportsMultiVendorModels` | boolean | `true`, `false` | Whether the service is expected to route or expose models from multiple vendors. |
| `protocols` | array | existing protocol objects | App-supported protocols exposed to users for this template. |
| `hideInChooser` | boolean | `true`, `false` | Hide the template from the `Choose a Product` create picker while keeping it loadable for existing records. |

## UI Group Definitions

| `uiGroup` | User-Facing Label | Meaning |
| --- | --- | --- |
| `single_provider` | Single Provider | A single brand's hosted online API. |
| `cloud_gateway` | LLM Gateway | A platform or gateway that fronts multiple model families or enterprise AI platform workflows. |
| `self_hosted` | Self-Hosted LLM Gateway | A runtime or endpoint primarily intended for local, private, or user-managed deployment. |

## Service Mode Definitions

| `serviceMode` | Meaning |
| --- | --- |
| `official_provider` | Official vendor-run API for that brand. |
| `maas_platform` | Cloud vendor model platform with broader AI workspace / governance semantics. |
| `gateway` | Routing or aggregation layer over multiple model providers. |
| `inference_runtime` | Self-hosted inference runtime. |
| `compat_proxy` | User-supplied compatible endpoint that may point to cloud, local, or internal proxy infrastructure. |

## Current Template Mapping

| Template | uiGroup | hostingMode | serviceMode | endpointMode | Closed Models | Multi-Vendor |
| --- | --- | --- | --- | --- | --- | --- |
| `openai` | `single_provider` | `cloud` | `official_provider` | `customizable` | `true` | `false` |
| `anthropic` | `single_provider` | `cloud` | `official_provider` | `customizable` | `true` | `false` |
| `google-gemini` | `single_provider` | `cloud` | `official_provider` | `customizable` | `true` | `false` |
| `deepseek` | `single_provider` | `cloud` | `official_provider` | `customizable` | `true` | `false` |
| `mistral` | `single_provider` | `cloud` | `official_provider` | `customizable` | `true` | `false` |
| `xai` | `single_provider` | `cloud` | `official_provider` | `customizable` | `true` | `false` |
| `aws-bedrock` | `cloud_gateway` | `cloud` | `maas_platform` | `customizable` | `true` | `true` |
| `azure-openai` | `cloud_gateway` | `cloud` | `maas_platform` | `customizable` | `true` | `true` |
| `alibaba-cloud-bailian` | `cloud_gateway` | `cloud` | `maas_platform` | `customizable` | `true` | `true` |
| `openrouter` | `cloud_gateway` | `cloud` | `gateway` | `customizable` | `true` | `true` |
| `cloudflare-ai-gateway` | `cloud_gateway` | `cloud` | `gateway` | `customizable` | `true` | `true` |
| `vertex-ai` | `cloud_gateway` | `cloud` | `maas_platform` | `user_supplied` | `true` | `true` |
| `ollama` | `self_hosted` | `self_hosted` | `inference_runtime` | `customizable` | `false` | `false` |
| `vllm` | `self_hosted` | `self_hosted` | `inference_runtime` | `user_supplied` | `false` | `false` |
| `sglang` | `self_hosted` | `self_hosted` | `inference_runtime` | `user_supplied` | `false` | `false` |
| `nvidia-nim-local` | `self_hosted` | `self_hosted` | `inference_runtime` | `user_supplied` | `false` | `true` |
| `generic-llm` | `self_hosted` | `hybrid` | `compat_proxy` | `user_supplied` | `false` | `false` |
| `moonshot` | `single_provider` | `cloud` | `official_provider` | `customizable` | `true` | `false` |
| `minimax` | `single_provider` | `cloud` | `official_provider` | `customizable` | `true` | `false` |
| `writer` | `single_provider` | `cloud` | `official_provider` | `user_supplied` | `true` | `false` |
| `z-ai` | `single_provider` | `cloud` | `official_provider` | `customizable` | `true` | `false` |
| `nvidia-nim-cloud` | `cloud_gateway` | `cloud` | `official_provider` | `user_supplied` | `false` | `true` |
| `qwen-dashscope` | `single_provider` | `cloud` | `official_provider` | `customizable` | `true` | `false` |

## Notes

- `protocols` should represent app-supported protocols, not every theoretical vendor-side API shape.
- `providerMode` defaults to `vendor` in the shared LLM base template; gateway products override it explicitly.
- `endpointMode=user_supplied` is reserved for templates where the endpoint has no safe built-in default.
- Hosted `single_provider` and `cloud_gateway` products own their auth transport in template metadata; the UI hides the `auth_scheme` selector for those forms and only self-hosted templates expose the override.
- OpenAI-compatible hosted vendors should default `defaultAuthScheme` to `bearer`; use `api_key` only when the upstream contract explicitly expects `x-api-key` semantics, such as Anthropic.
- If a template defines `defaultEndpoint`, source files should omit matching `protocols[].defaultEndpoint` and `fields[].default` for the `endpoint` field; the loader inherits them automatically.
- `supportsMultiVendorModels=true` is a capability hint, not a guarantee that all model families are enabled for every tenant or region.
- Writer, Vertex AI, and NVIDIA NIM Cloud remain `endpointMode=user_supplied` because this repository still treats their endpoints as tenant- or deployment-specific rather than stable vendor-wide defaults.
- `qwen-dashscope` remains loadable for compatibility but is hidden from the create chooser in favor of the Bailian product entry.