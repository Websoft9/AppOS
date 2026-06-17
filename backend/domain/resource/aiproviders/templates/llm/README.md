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
| `supportsClosedModels` | boolean | `true`, `false` | Whether the service can expose proprietary / closed-weight models, not only open-weight models. |
| `supportsMultiVendorModels` | boolean | `true`, `false` | Whether the service is expected to route or expose models from multiple vendors. |
| `protocols` | array | existing protocol objects | App-supported protocols exposed to users for this template. |

## UI Group Definitions

| `uiGroup` | User-Facing Label | Meaning |
| --- | --- | --- |
| `single_provider` | Independent Provider API | A single brand's hosted online API. |
| `cloud_gateway` | AI Platform / Gateway | A platform or gateway that fronts multiple model families or enterprise AI platform workflows. |
| `self_hosted` | Self-Hosted Inference | A runtime or endpoint primarily intended for local, private, or user-managed deployment. |

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
| `groq` | `single_provider` | `cloud` | `official_provider` | `customizable` | `false` | `false` |
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
| `moonshot` | `single_provider` | `cloud` | `official_provider` | `user_supplied` | `true` | `false` |
| `minimax` | `single_provider` | `cloud` | `official_provider` | `user_supplied` | `true` | `false` |
| `writer` | `single_provider` | `cloud` | `official_provider` | `user_supplied` | `true` | `false` |
| `z-ai` | `single_provider` | `cloud` | `official_provider` | `user_supplied` | `true` | `false` |
| `nvidia-nim-cloud` | `single_provider` | `cloud` | `official_provider` | `user_supplied` | `false` | `true` |
| `qwen-dashscope` | `single_provider` | `cloud` | `official_provider` | `customizable` | `true` | `false` |

## Notes

- `protocols` should represent app-supported protocols, not every theoretical vendor-side API shape.
- `endpointMode=user_supplied` is reserved for templates where the endpoint has no safe built-in default.
- `supportsMultiVendorModels=true` is a capability hint, not a guarantee that all model families are enabled for every tenant or region.
- Several new templates intentionally use `endpointMode=user_supplied` because this repository does not currently encode a stable vendor-specific default endpoint for them.