The app primarily communicates with **each school’s WebUntis server**, using JSON-RPC and a small number of REST endpoints. It also optionally contacts AI providers, GitHub, and Hugging Face.

## WebUntis endpoints

The base URL is dynamically built from the configured school:

```text
https://<school-domain>/WebUntis/jsonrpc.do?school=<school-name>
```

Authenticated requests include:

```http
Cookie: JSESSIONID=<session-id>; schoolname=<school-name>
```

The shared implementation is in [`webuntis_client.dart`](https://github.com/ninocss/UntisPlus/blob/059dc464af5613b1d945caeaef8052862d19e67b/lib/data/webuntis/webuntis_client.dart).

### JSON-RPC calls currently visible in the code

| JSON-RPC method | Purpose | Endpoint |
|---|---|---|
| `authenticate` | Login with username and password and obtain a session ID | `/WebUntis/jsonrpc.do` |
| `getUserData2017` | Login-key/OTP authentication | `/WebUntis/jsonrpc_intern.do` |
| `getTimetable` | Retrieve timetable lessons, including widget/background refresh data | `/WebUntis/jsonrpc.do` |
| `getTimetableWithAbsences` | Retrieve timetable periods with absences | `/WebUntis/jsonrpc.do` |
| `getHomeWork2017` | Retrieve homework and lesson notes | `/WebUntis/jsonrpc.do` |
| `getCurrentSchoolyear` | Retrieve the current school-year ID, used by messaging | `/WebUntis/jsonrpc.do` |

Examples:

- [`authenticate` and `getUserData2017`](https://github.com/ninocss/UntisPlus/blob/059dc464af5613b1d945caeaef8052862d19e67b/lib/data/webuntis/webuntis_session_manager.dart#L108-L203)
- [`getHomeWork2017`](https://github.com/ninocss/UntisPlus/blob/059dc464af5613b1d945caeaef8052862d19e67b/lib/services/homework_service.dart#L25-L61)
- [`getTimetableWithAbsences`](https://github.com/ninocss/UntisPlus/blob/059dc464af5613b1d945caeaef8052862d19e67b/lib/features/absences/data/absence_repository.dart#L35-L61)
- Background/widget `getTimetable` calls [`background_service.dart`](https://github.com/ninocss/UntisPlus/blob/059dc464af5613b1d945caeaef8052862d19e67b/lib/services/background_service.dart#L887-L950)
- `getCurrentSchoolyear` and messaging calls [`webuntis_message_service.dart`](https://github.com/ninocss/UntisPlus/blob/059dc464af5613b1d945caeaef8052862d19e67b/lib/services/webuntis_message_service.dart#L223-L292)

### WebUntis REST endpoints

```text
GET https://<school-domain>/WebUntis/api/rest/view/v1/messages/permissions
```

Retrieves messaging permissions, recipient types, and attachment limits.

```text
GET https://<school-domain>/WebUntis/api/rest/view/v1/messages/recipients/static/persons
```

Retrieves available message recipients.

```text
GET https://<school-domain>/WebUntis/messageFileRequest.do?file=<file-id>
```

Downloads a message attachment.

The attachment download is implemented in [`school_notification_detail_page.dart`](https://github.com/ninocss/UntisPlus/blob/059dc464af5613b1d945caeaef8052862d19e67b/lib/screens/school_notification_detail_page.dart#L123-L177).

## AI provider endpoints

The AI assistant can use several providers.

### Google Gemini

```text
POST https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent
```

Uses the `x-goog-api-key` header or an API-key query parameter, depending on the code path.

### OpenAI

```text
POST https://api.openai.com/v1/chat/completions
```

### Mistral

```text
POST https://api.mistral.ai/v1/chat/completions
```

### Custom AI provider

The app supports a configurable custom base URL using either:

- OpenAI-compatible `/chat/completions`
- Gemini-compatible `:generateContent`

The provider-selection code is in [`main_navigation_screen.dart`](https://github.com/ninocss/UntisPlus/blob/059dc464af5613b1d945caeaef8052862d19e67b/lib/screens/main_navigation_screen.dart#L1043-L1147).

The app also supports local AI models, in which case inference happens on-device and no AI API call is made.

## GitHub endpoints

For changelogs and update checks:

```text
GET https://api.github.com/repos/ninocss/UntisPlus/releases/latest
```

Fallback:

```text
GET https://raw.githubusercontent.com/ninocss/UntisPlus/main/changelog.json
```

The release endpoint is used by both the changelog UI and background update checks.

- [`changelog_bottom_sheet.dart`](https://github.com/ninocss/UntisPlus/blob/059dc464af5613b1d945caeaef8052862d19e67b/lib/widgets/changelog_bottom_sheet.dart#L35-L100)
- [`background_service.dart`](https://github.com/ninocss/UntisPlus/blob/059dc464af5613b1d945caeaef8052862d19e67b/lib/services/background_service.dart#L368-L407)

## Hugging Face endpoints

When a user downloads a local AI model, the app downloads GGUF model files from Hugging Face, for example:

```text
https://huggingface.co/bartowski/google_gemma-3-1b-it-GGUF/resolve/main/google_gemma-3-1b-it-Q4_K_M.gguf
```

Other configured model downloads include Llama, Qwen, and Phi models. The model URLs are listed in [`app_state.dart`](https://github.com/ninocss/UntisPlus/blob/059dc464af5613b1d945caeaef8052862d19e67b/lib/core/app_state.dart#L539-L587).

The code-search results are limited and may not include every WebUntis method, especially message-list, exam, grade, or announcement calls implemented elsewhere. The repository’s full code search can be viewed here:

https://github.com/ninocss/UntisPlus/search?q=WebUntis+OR+jsonrpc+OR+method%3A&type=code