# @lunar/storage-http

HTTP implementations of the Lunar run, session, and workflow storage ports.

```ts
import { createHttpStores } from "@lunar/storage-http";

const storage = createHttpStores({
  baseUrl: process.env.STORAGE_HTTP_BASE_URL!,
  token: process.env.STORAGE_HTTP_TOKEN,
});
```

The provider uses idempotent JSON `PUT` and `GET` requests under `/v1`, retries
transient failures with bounded backoff, and treats missing records as absent.
Workflow recovery additionally uses `GET /v1/workflow-runs?status=running`,
which must return a JSON array of matching workflow records. Unknown Planet can
implement the same contract when its API is stable.
